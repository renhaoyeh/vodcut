import { BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { getProjectById, updateProject, projectPaths, readProjectFile, writeProjectFile, saveGroqRateLimits, saveGroqError, clearGroqError, type TranscriptionProgress } from './store';
import { type SrtSegment, segmentsToSrt } from './whisper';
import { getGroqClient, extractRateLimitHeaders } from './groq-client';
import * as OpenCC from 'opencc-js';

const s2tw: (text: string) => string = OpenCC.Converter({ from: 'cn', to: 'twp' });

const ffmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');

// Max chunk duration in seconds (~5 min, well under 25MB WAV limit)
const MAX_CHUNK_SEC = 300;
// Silence detection parameters
const SILENCE_THRESH_DB = -35;
const SILENCE_MIN_DURATION = 0.5; // seconds

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

interface GroqResponse {
  segments: GroqSegment[];
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

export async function transcribeWithGroq(
  projectId: string,
  audioPath: string,
  apiKeys: string[],
  model: string,
  win: BrowserWindow | null,
): Promise<{ success: boolean; srtPath?: string; segments?: SrtSegment[]; error?: string }> {
  const project = getProjectById(projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const paths = projectPaths(projectId);

  try {
    const totalSec = getAudioDuration(audioPath);

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
      const silences = await detectSilences(audioPath);
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
      await extractChunk(audioPath, startSec, duration, chunkPath);

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
      for (const seg of result.segments) {
        allSegments.push({
          index: segIdx++,
          startMs: Math.round(seg.start * 1000) + offsetMs,
          endMs: Math.round(seg.end * 1000) + offsetMs,
          text: s2tw(seg.text.trim()),
          confidence: typeof seg.avg_logprob === 'number' ? seg.avg_logprob : undefined,
        });
      }
      c++;

      // Persist progress after each chunk
      writeProjectFile(paths.progress, { currentChunk: c, numChunks, chunkRanges, segments: allSegments, segIdx });
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
