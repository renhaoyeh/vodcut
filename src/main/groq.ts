import { BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { getProjectById, updateProject, projectPaths, readProjectFile, writeProjectFile, saveGroqRateLimits, saveGroqError, clearGroqError, settingsStore, type TranscriptionProgress } from './store';
import { type SrtSegment, segmentsToSrt } from './whisper';
import { getGroqClient, extractRateLimitHeaders } from './groq-client';
import { isDenoiseAvailable, denoiseAudio } from './denoise';
import * as OpenCC from 'opencc-js';

const s2tw: (text: string) => string = OpenCC.Converter({ from: 'cn', to: 'twp' });

// ffmpeg-static exports the absolute path to the platform-specific binary
const ffmpegPath: string = require('ffmpeg-static');

// Max chunk duration in seconds (~5 min, well under 25MB WAV limit)
const MAX_CHUNK_SEC = 300;
// Whisper avg_logprob threshold — segments below this are flagged/refined.
// Keep in sync with LOW_CONFIDENCE_THRESHOLD in player.tsx.
const LOW_CONFIDENCE_THRESHOLD = -0.8;
// When merging low-confidence runs for auto-refinement, allow up to this many
// good segments between runs before splitting into separate passes.
const AUTO_REFINE_GAP_TOLERANCE = 1;
// Silence detection parameters
const SILENCE_THRESH_DB = -35;
const SILENCE_MIN_DURATION = 0.5; // seconds

// Max characters per subtitle line when grouping words into segments.
const MAX_SUBTITLE_CHARS = 18;
// Silence gap (seconds) between words that forces a subtitle break.
const WORD_GAP_BREAK_SEC = 0.5;

interface SilenceGap {
  startSec: number;
  endSec: number;
}

function getAudioDuration(audioPath: string): number {
  const stat = fs.statSync(audioPath);
  const pcmBytes = stat.size - 44; // strip WAV header
  const bytesPerSec = 16000 * 2;  // 16kHz, 16-bit mono
  return pcmBytes / bytesPerSec;
}

/**
 * Use FFmpeg silencedetect to find silence gaps in the audio.
 * Returns an array of { startSec, endSec } for each detected silence period.
 */
function detectSilences(audioPath: string): Promise<SilenceGap[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-i', audioPath,
      // Bandpass 300-3000Hz isolates human speech, so silence detection
      // works even when background music is playing continuously.
      '-af', `highpass=f=300,lowpass=f=3000,silencedetect=noise=${SILENCE_THRESH_DB}dB:d=${SILENCE_MIN_DURATION}`,
      '-f', 'null', '-',
    ], { windowsHide: true });

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`silencedetect exited with code ${code}`));
        return;
      }

      const gaps: SilenceGap[] = [];
      // Parse: [silencedetect @ ...] silence_start: 1.234
      // Parse: [silencedetect @ ...] silence_end: 2.567 | silence_duration: 1.333
      const startRegex = /silence_start:\s*([\d.]+)/g;
      const endRegex = /silence_end:\s*([\d.]+)/g;

      const starts: number[] = [];
      const ends: number[] = [];
      let m: RegExpExecArray | null;
      while ((m = startRegex.exec(stderr))) starts.push(parseFloat(m[1]));
      while ((m = endRegex.exec(stderr))) ends.push(parseFloat(m[1]));

      for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
        gaps.push({ startSec: starts[i], endSec: ends[i] });
      }

      resolve(gaps);
    });
    proc.on('error', reject);
  });
}

interface ChunkRange {
  startSec: number;
  endSec: number;
}

/**
 * Derive speech regions from silence gaps, then group them into chunks.
 * Only regions that contain speech are returned — pure silence/music is skipped.
 * Each chunk is at most MAX_CHUNK_SEC.
 */
function buildChunkRanges(totalSec: number, silences: SilenceGap[]): ChunkRange[] {
  if (silences.length === 0) {
    // No silence detected — whole audio has speech, use fixed-size chunks
    const ranges: ChunkRange[] = [];
    for (let s = 0; s < totalSec; s += MAX_CHUNK_SEC) {
      ranges.push({ startSec: s, endSec: Math.min(s + MAX_CHUNK_SEC, totalSec) });
    }
    return ranges;
  }

  // Extract speech regions = gaps between silences
  const speechRegions: ChunkRange[] = [];

  // Before first silence
  if (silences[0].startSec > 0.5) {
    speechRegions.push({ startSec: 0, endSec: silences[0].startSec });
  }
  // Between consecutive silences
  for (let i = 0; i < silences.length - 1; i++) {
    const gapStart = silences[i].endSec;
    const gapEnd = silences[i + 1].startSec;
    if (gapEnd - gapStart > 0.1) {
      speechRegions.push({ startSec: gapStart, endSec: gapEnd });
    }
  }
  // After last silence
  const lastEnd = silences[silences.length - 1].endSec;
  if (totalSec - lastEnd > 0.5) {
    speechRegions.push({ startSec: lastEnd, endSec: totalSec });
  }

  if (speechRegions.length === 0) {
    // Entire audio is silence — nothing to transcribe
    return [];
  }

  // Merge nearby speech regions into chunks up to MAX_CHUNK_SEC.
  // Keep a small padding around each region for context.
  const PAD = 0.3; // seconds of padding
  const chunks: ChunkRange[] = [];
  let chunkStart = Math.max(0, speechRegions[0].startSec - PAD);
  let chunkEnd = Math.min(totalSec, speechRegions[0].endSec + PAD);

  for (let i = 1; i < speechRegions.length; i++) {
    const regionStart = Math.max(0, speechRegions[i].startSec - PAD);
    const regionEnd = Math.min(totalSec, speechRegions[i].endSec + PAD);

    if (regionEnd - chunkStart <= MAX_CHUNK_SEC) {
      // Fits in the current chunk — extend it
      chunkEnd = regionEnd;
    } else {
      // Doesn't fit — flush current chunk, start a new one
      chunks.push({ startSec: chunkStart, endSec: chunkEnd });
      chunkStart = regionStart;
      chunkEnd = regionEnd;
    }
  }
  chunks.push({ startSec: chunkStart, endSec: chunkEnd });

  return chunks;
}

/**
 * Group word-level timestamps into subtitle segments of at most
 * MAX_SUBTITLE_CHARS. A new segment is also started when the gap between
 * consecutive words exceeds WORD_GAP_BREAK_SEC (a natural speech pause).
 *
 * @param words  - Whisper word-level timestamps (with offset already applied)
 * @param confidence - optional avg_logprob to attach to every produced segment
 */
function groupWordsIntoSegments(
  words: Array<{ word: string; startMs: number; endMs: number }>,
  confidence?: number,
): SrtSegment[] {
  if (words.length === 0) return [];

  const segments: SrtSegment[] = [];
  let buf = words[0].word;
  let segStart = words[0].startMs;
  let segEnd = words[0].endMs;

  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const gap = (w.startMs - segEnd) / 1000; // seconds
    const wouldExceed = (buf + w.word).length > MAX_SUBTITLE_CHARS;

    if (wouldExceed || gap >= WORD_GAP_BREAK_SEC) {
      // Flush current buffer
      segments.push({ index: 0, startMs: segStart, endMs: segEnd, text: buf.trim(), confidence });
      buf = w.word;
      segStart = w.startMs;
    } else {
      buf += w.word;
    }
    segEnd = w.endMs;
  }
  // Flush remaining
  if (buf.trim()) {
    segments.push({ index: 0, startMs: segStart, endMs: segEnd, text: buf.trim(), confidence });
  }

  for (let i = 0; i < segments.length; i++) segments[i].index = i + 1;
  return segments;
}

function extractChunk(audioPath: string, startSec: number, durationSec: number, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-i', audioPath,
      '-ss', String(startSec),
      '-t', String(durationSec),
      '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
      '-y', outPath,
    ], { windowsHide: true });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg chunk extract exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

interface GroqSegment {
  start: number;
  end: number;
  text: string;
  avg_logprob?: number;
}

interface GroqWord {
  word: string;
  start: number;
  end: number;
}

interface GroqResponse {
  segments: GroqSegment[];
  words?: GroqWord[];
}

/** Whisper `prompt` parameter has a 244-token limit. Keep well under it. */
const PROMPT_MAX_CHARS = 200;
const DEFAULT_PROMPT_SEED = '以下是繁體中文直播內容。';

/**
 * Build a Whisper prompt from the tail of previously transcribed text + optional vocabulary.
 * This helps Whisper carry context across chunk boundaries (most errors cluster there).
 */
function buildChunkPrompt(priorSegments: SrtSegment[], vocabulary?: string): string {
  const parts: string[] = [];
  if (vocabulary && vocabulary.trim()) {
    // Keep vocabulary section short — budget shared with rolling context.
    parts.push(vocabulary.trim().slice(0, 80));
  }

  if (priorSegments.length === 0) {
    parts.push(DEFAULT_PROMPT_SEED);
  } else {
    // Use the last N chars of prior transcription as rolling context.
    const joined = priorSegments.map((s) => s.text).join('');
    parts.push(joined.slice(-PROMPT_MAX_CHARS));
  }

  return parts.join(' ').slice(-PROMPT_MAX_CHARS);
}

async function uploadToGroq(
  filePath: string,
  apiKey: string,
  model: string,
  prompt?: string,
): Promise<GroqResponse> {
  const client = getGroqClient(apiKey);
  try {
    const { data, response } = await client.audio.transcriptions
      .create({
        file: fs.createReadStream(filePath),
        model,
        language: 'zh',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment', 'word'],
        temperature: 0,
        ...(prompt ? { prompt } : {}),
      })
      .withResponse();

    saveGroqRateLimits(apiKey, extractRateLimitHeaders(response));
    clearGroqError(apiKey);

    return data as unknown as GroqResponse;
  } catch (err) {
    saveGroqError(apiKey, (err as Error).message);
    throw err;
  }
}

export async function retranscribeRangeSegments(
  projectId: string,
  startMs: number,
  endMs: number,
  contextBefore: string,
  contextAfter: string,
  apiKeys: string[],
  model: string,
): Promise<{ success: boolean; segments?: Array<{ startMs: number; endMs: number; text: string }>; error?: string }> {
  const project = getProjectById(projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const paths = projectPaths(projectId);
  if (!fs.existsSync(paths.audio)) return { success: false, error: 'Audio not extracted yet.' };
  if (apiKeys.length === 0) return { success: false, error: 'Groq API key not configured.' };

  const totalSec = getAudioDuration(paths.audio);
  const PAD_SEC = 0.3;
  const chunkStartSec = Math.max(0, startMs / 1000 - PAD_SEC);
  const chunkEndSec = Math.min(totalSec, endMs / 1000 + PAD_SEC);
  const duration = chunkEndSec - chunkStartSec;
  if (duration <= 0) return { success: false, error: 'Invalid time range.' };

  let vocabulary: string | undefined;
  try {
    const raw = fs.readFileSync(paths.vocabulary, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.terms)) {
      vocabulary = (parsed.terms as string[]).filter(Boolean).join('、');
    }
  } catch { /* no vocabulary */ }

  const promptParts: string[] = [];
  if (vocabulary) promptParts.push(vocabulary.slice(0, 80));
  const ctx = `${contextBefore}${contextAfter}`.trim();
  promptParts.push(ctx || DEFAULT_PROMPT_SEED);
  const prompt = promptParts.join(' ').slice(-PROMPT_MAX_CHARS);

  const tmpDir = app.getPath('temp');
  const chunkPath = path.join(tmpDir, `vodcut-groq-retry-range-${projectId}-${Date.now()}.wav`);

  try {
    await extractChunk(paths.audio, chunkStartSec, duration, chunkPath);
    const apiKey = apiKeys[0];
    console.log(`[whisper] retranscribe range [${chunkStartSec.toFixed(1)}s-${chunkEndSec.toFixed(1)}s] prompt=${prompt.length}ch`);
    const result = await uploadToGroq(chunkPath, apiKey, model, prompt);

    const offsetMs = Math.round(chunkStartSec * 1000);
    let out: Array<{ startMs: number; endMs: number; text: string }>;

    if (result.words && result.words.length > 0) {
      // Use word-level timestamps for accurate subtitle boundaries
      const words = result.words
        .map((w) => ({
          word: s2tw(w.word),
          startMs: Math.round(w.start * 1000) + offsetMs,
          endMs: Math.round(w.end * 1000) + offsetMs,
        }))
        .filter((w) => w.endMs > startMs && w.startMs < endMs); // within range
      const grouped = groupWordsIntoSegments(words);
      out = grouped.map(({ startMs: s, endMs: e, text }) => ({
        startMs: Math.max(startMs, s),
        endMs: Math.min(endMs, e),
        text,
      }));
    } else {
      // Fallback: segment-level
      out = [];
      for (const seg of result.segments) {
        const segStartMs = Math.round(seg.start * 1000) + offsetMs;
        const segEndMs = Math.round(seg.end * 1000) + offsetMs;
        if (segEndMs <= startMs || segStartMs >= endMs) continue;
        const text = s2tw(seg.text.trim()).trim();
        if (!text) continue;
        out.push({
          startMs: Math.max(startMs, segStartMs),
          endMs: Math.min(endMs, segEndMs),
          text,
        });
      }
    }

    if (out.length === 0) return { success: false, error: 'No speech detected in range.' };
    return { success: true, segments: out };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  } finally {
    try { fs.unlinkSync(chunkPath); } catch {}
  }
}

export async function retranscribeSingleSegment(
  projectId: string,
  startMs: number,
  endMs: number,
  contextBefore: string,
  contextAfter: string,
  apiKeys: string[],
  model: string,
): Promise<{ success: boolean; text?: string; error?: string }> {
  const project = getProjectById(projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const paths = projectPaths(projectId);
  if (!fs.existsSync(paths.audio)) return { success: false, error: 'Audio not extracted yet.' };
  if (apiKeys.length === 0) return { success: false, error: 'Groq API key not configured.' };

  const totalSec = getAudioDuration(paths.audio);
  const PAD_SEC = 0.3;
  const startSec = Math.max(0, startMs / 1000 - PAD_SEC);
  const endSec = Math.min(totalSec, endMs / 1000 + PAD_SEC);
  const duration = endSec - startSec;
  if (duration <= 0) return { success: false, error: 'Invalid time range.' };

  let vocabulary: string | undefined;
  try {
    const raw = fs.readFileSync(paths.vocabulary, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.terms)) {
      vocabulary = (parsed.terms as string[]).filter(Boolean).join('、');
    }
  } catch { /* no vocabulary */ }

  const promptParts: string[] = [];
  if (vocabulary) promptParts.push(vocabulary.slice(0, 80));
  const ctx = `${contextBefore}${contextAfter}`.trim();
  promptParts.push(ctx || DEFAULT_PROMPT_SEED);
  const prompt = promptParts.join(' ').slice(-PROMPT_MAX_CHARS);

  const tmpDir = app.getPath('temp');
  const chunkPath = path.join(tmpDir, `vodcut-groq-retry-${projectId}-${Date.now()}.wav`);

  try {
    await extractChunk(paths.audio, startSec, duration, chunkPath);
    const apiKey = apiKeys[0];
    console.log(`[whisper] retranscribe [${startSec.toFixed(1)}s-${endSec.toFixed(1)}s] prompt=${prompt.length}ch`);
    const result = await uploadToGroq(chunkPath, apiKey, model, prompt);
    const joined = result.segments.map((s) => s.text.trim()).join('');
    const text = s2tw(joined).trim();
    return { success: true, text };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  } finally {
    try { fs.unlinkSync(chunkPath); } catch {}
  }
}

/**
 * Group indices of low-confidence segments into contiguous runs, allowing
 * up to `gapTolerance` good segments between runs before splitting.
 */
function findLowConfidenceRuns(
  segments: SrtSegment[],
  gapTolerance: number,
): Array<{ lo: number; hi: number }> {
  const flagged: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    const c = segments[i].confidence;
    if (typeof c === 'number' && c < LOW_CONFIDENCE_THRESHOLD) flagged.push(i);
  }
  if (flagged.length === 0) return [];

  const runs: Array<{ lo: number; hi: number }> = [];
  let lo = flagged[0];
  let hi = flagged[0];
  for (let i = 1; i < flagged.length; i++) {
    const idx = flagged[i];
    if (idx - hi <= gapTolerance + 1) hi = idx;
    else { runs.push({ lo, hi }); lo = idx; hi = idx; }
  }
  runs.push({ lo, hi });
  return runs;
}

export async function transcribeWithGroq(
  projectId: string,
  audioPath: string,
  apiKeys: string[],
  model: string,
  win: BrowserWindow | null,
  autoRefineLowConfidence: boolean = true,
): Promise<{ success: boolean; srtPath?: string; segments?: SrtSegment[]; error?: string }> {
  const project = getProjectById(projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const paths = projectPaths(projectId);

  try {
    // Optional: denoise audio before transcription (DeepFilterNet)
    let workingAudio = audioPath;
    const denoiseEnabled = settingsStore.get('denoiseEnabled');
    if (denoiseEnabled && isDenoiseAvailable()) {
      if (!fs.existsSync(paths.audioDenoised)) {
        win?.webContents.send('whisper:stage', projectId, JSON.stringify({ key: 'player.denoising' }));
        console.log('[whisper] denoising audio with DeepFilterNet...');
        await denoiseAudio(audioPath, paths.audioDenoised, (pct) => {
          win?.webContents.send('whisper:progress', projectId, pct);
        });
        console.log('[whisper] denoise complete');
      } else {
        console.log('[whisper] using cached denoised audio');
      }
      workingAudio = paths.audioDenoised;
    }

    const totalSec = getAudioDuration(workingAudio);

    // Resume from saved progress
    const saved = readProjectFile<TranscriptionProgress>(projectId, paths.progress);
    const allSegments: SrtSegment[] = saved?.segments ?? [];
    let segIdx = saved?.segIdx ?? 1;
    let c = saved?.currentChunk ?? 0;

    // Reuse cached chunk ranges when resuming; otherwise detect silence gaps
    let chunkRanges: ChunkRange[];
    if (saved?.chunkRanges && c > 0) {
      chunkRanges = saved.chunkRanges;
      console.log(`[whisper] resuming with ${chunkRanges.length} cached chunks (skipped silence detection)`);
    } else {
      win?.webContents.send('whisper:stage', projectId, JSON.stringify({ key: 'player.detectingSilence' }));
      const silences = await detectSilences(workingAudio);
      chunkRanges = buildChunkRanges(totalSec, silences);
      console.log(`[whisper] detected ${silences.length} silence gaps -> ${chunkRanges.length} chunks`);
    }
    const numChunks = chunkRanges.length;

    if (saved && c > 0) {
      win?.webContents.send('whisper:stage', projectId, JSON.stringify({ key: 'player.resumeRecognizing', current: c, total: numChunks }));
      win?.webContents.send('whisper:progress', projectId, Math.round((c / numChunks) * 100));
    }

    const tmpDir = app.getPath('temp');

    // Optional per-project vocabulary (A2). Read once at start; updated between retries.
    let vocabulary: string | undefined;
    try {
      const raw = fs.readFileSync(paths.vocabulary, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.terms)) {
        vocabulary = (parsed.terms as string[]).filter(Boolean).join('、');
      }
    } catch { /* no vocabulary yet */ }

    while (c < numChunks) {
      const range = chunkRanges[c];
      const startSec = range.startSec;
      const duration = range.endSec - range.startSec;
      const chunkPath = path.join(tmpDir, `vodcut-groq-chunk-${projectId}-${c}.wav`);

      win?.webContents.send('whisper:stage', projectId, JSON.stringify({ key: 'player.recognizingProgress', current: c + 1, total: numChunks }));
      win?.webContents.send('whisper:progress', projectId, Math.round((c / numChunks) * 100));

      // Extract chunk WAV
      await extractChunk(workingAudio, startSec, duration, chunkPath);

      // Upload to Groq — rotate API keys across chunks
      const keyIndex = c % apiKeys.length;
      const apiKey = apiKeys[keyIndex];
      // Build rolling-context prompt from prior chunks (A1)
      const prompt = buildChunkPrompt(allSegments, vocabulary);
      console.log(`[whisper] chunk ${c + 1}/${numChunks} [${startSec.toFixed(1)}s-${range.endSec.toFixed(1)}s] using key #${keyIndex + 1} prompt=${prompt.length}ch`);
      const result = await uploadToGroq(chunkPath, apiKey, model, prompt);

      // Clean up temp file
      try { fs.unlinkSync(chunkPath); } catch {}

      const offsetMs = startSec * 1000;

      if (result.words && result.words.length > 0) {
        // Word-level timestamps available — group into short subtitle lines
        // with real speech timing boundaries.
        const words = result.words.map((w) => ({
          word: s2tw(w.word),
          startMs: Math.round(w.start * 1000) + offsetMs,
          endMs: Math.round(w.end * 1000) + offsetMs,
        }));
        // Compute an average confidence from the segment-level logprobs.
        const logprobs = result.segments
          .map((s) => s.avg_logprob)
          .filter((v): v is number => typeof v === 'number');
        const avgConf = logprobs.length > 0
          ? logprobs.reduce((a, b) => a + b, 0) / logprobs.length
          : undefined;
        const grouped = groupWordsIntoSegments(words, avgConf);
        for (const seg of grouped) {
          seg.index = segIdx++;
          allSegments.push(seg);
        }
      } else {
        // Fallback: no word timestamps, use segment-level as before
        for (const seg of result.segments) {
          allSegments.push({
            index: segIdx++,
            startMs: Math.round(seg.start * 1000) + offsetMs,
            endMs: Math.round(seg.end * 1000) + offsetMs,
            text: s2tw(seg.text.trim()),
            confidence: typeof seg.avg_logprob === 'number' ? seg.avg_logprob : undefined,
          });
        }
      }
      c++;

      // Persist progress after each chunk
      writeProjectFile(paths.progress, { currentChunk: c, numChunks, chunkRanges, segments: allSegments, segIdx });
    }

    // Auto-refine low-confidence runs with surrounding context as prompt.
    // This only runs once (no recursion); refined segments may still be low
    // confidence but we keep them to avoid infinite retries.
    if (autoRefineLowConfidence) {
      const runs = findLowConfidenceRuns(allSegments, AUTO_REFINE_GAP_TOLERANCE);
      if (runs.length > 0) {
        console.log(`[whisper] auto-refining ${runs.length} low-confidence run(s)`);
        const CONTEXT_SPAN = 3;
        // Iterate in reverse so splice-style replacements don't invalidate earlier indices.
        for (let r = runs.length - 1; r >= 0; r--) {
          const { lo, hi } = runs[r];
          const first = allSegments[lo];
          const last = allSegments[hi];
          if (!first || !last) continue;

          const displayIdx = runs.length - r;
          win?.webContents.send('whisper:stage', projectId, JSON.stringify({
            key: 'player.autoRefining', current: displayIdx, total: runs.length,
          }));

          const before = allSegments
            .slice(Math.max(0, lo - CONTEXT_SPAN), lo)
            .map((s) => s.text).join('');
          const after = allSegments
            .slice(hi + 1, hi + 1 + CONTEXT_SPAN)
            .map((s) => s.text).join('');

          const refined = await retranscribeRangeSegments(
            projectId, first.startMs, last.endMs, before, after, apiKeys, model,
          );
          if (!refined.success || !refined.segments || refined.segments.length === 0) {
            console.warn(`[whisper] refine run ${displayIdx}/${runs.length} failed: ${refined.error || 'no segments'}`);
            continue;
          }

          const replacement: SrtSegment[] = refined.segments.map((s) => ({
            index: 0, // reindexed below
            startMs: s.startMs,
            endMs: s.endMs,
            text: s.text,
            // Clear confidence: these are the refined replacements and user-facing
            // code treats missing confidence as "not flagged".
            confidence: undefined as number | undefined,
          }));
          allSegments.splice(lo, hi - lo + 1, ...replacement);
        }

        // Renumber sequential indices after all splices.
        for (let i = 0; i < allSegments.length; i++) allSegments[i].index = i + 1;
      }
    }

    win?.webContents.send('whisper:progress', projectId, 100);

    const srtContent = segmentsToSrt(allSegments);
    fs.writeFileSync(paths.srt, srtContent, 'utf8');

    // Save confidence-aware segments.json (SRT can't carry metadata).
    writeProjectFile(paths.segments, allSegments);

    // Also save a copy next to the video
    const videoDir = path.dirname(project.filePath);
    const videoName = path.basename(project.filePath, path.extname(project.filePath));
    try { fs.writeFileSync(path.join(videoDir, `${videoName}.srt`), srtContent, 'utf8'); } catch {}

    // Clean up progress file
    try { fs.unlinkSync(paths.progress); } catch {}

    updateProject(projectId, { status: 'completed' });

    return { success: true, srtPath: paths.srt, segments: allSegments };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
