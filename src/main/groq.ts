import { BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { getProjectById, updateProject, projectPaths, readProjectFile, writeProjectFile, saveGroqRateLimits, type TranscriptionProgress } from './store';
import { type SrtSegment, segmentsToSrt } from './whisper';
import { getGroqClient, extractRateLimitHeaders } from './groq-client';

const ffmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');

// 12 minutes per chunk ≈ 23MB WAV (under 25MB API limit)
const CHUNK_SEC = 720;

function getAudioDuration(audioPath: string): number {
  const stat = fs.statSync(audioPath);
  const pcmBytes = stat.size - 44; // strip WAV header
  const bytesPerSec = 16000 * 2;  // 16kHz, 16-bit mono
  return pcmBytes / bytesPerSec;
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
}

interface GroqResponse {
  segments: GroqSegment[];
}

async function uploadToGroq(filePath: string, apiKey: string, model: string): Promise<GroqResponse> {
  const client = getGroqClient(apiKey);
  const { data, response } = await client.audio.transcriptions
    .create({
      file: fs.createReadStream(filePath),
      model,
      language: 'zh',
      response_format: 'verbose_json',
      temperature: 0,
    })
    .withResponse();

  saveGroqRateLimits(apiKey, extractRateLimitHeaders(response));

  return data as unknown as GroqResponse;
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
    const numChunks = Math.ceil(totalSec / CHUNK_SEC);

    // Resume from saved progress
    const saved = readProjectFile<TranscriptionProgress>(projectId, paths.progress);
    const allSegments: SrtSegment[] = saved?.segments ?? [];
    let segIdx = saved?.segIdx ?? 1;
    let c = saved?.currentChunk ?? 0;

    if (saved && c > 0) {
      win?.webContents.send('whisper:stage', projectId, JSON.stringify({ key: 'player.resumeRecognizing', current: c, total: numChunks }));
      win?.webContents.send('whisper:progress', projectId, Math.round((c / numChunks) * 100));
    }

    const tmpDir = app.getPath('temp');

    while (c < numChunks) {
      const startSec = c * CHUNK_SEC;
      const duration = Math.min(CHUNK_SEC, totalSec - startSec);
      const chunkPath = path.join(tmpDir, `vodcut-groq-chunk-${projectId}-${c}.wav`);

      win?.webContents.send('whisper:stage', projectId, JSON.stringify({ key: 'player.recognizingProgress', current: c + 1, total: numChunks }));
      win?.webContents.send('whisper:progress', projectId, Math.round((c / numChunks) * 100));

      // Extract chunk WAV
      await extractChunk(audioPath, startSec, duration, chunkPath);

      // Upload to Groq — rotate API keys across chunks
      const keyIndex = c % apiKeys.length;
      const apiKey = apiKeys[keyIndex];
      console.log(`[whisper] chunk ${c + 1}/${numChunks} using key #${keyIndex + 1}`);
      const result = await uploadToGroq(chunkPath, apiKey, model);

      // Clean up temp file
      try { fs.unlinkSync(chunkPath); } catch {}

      const offsetMs = startSec * 1000;
      for (const seg of result.segments) {
        allSegments.push({
          index: segIdx++,
          startMs: Math.round(seg.start * 1000) + offsetMs,
          endMs: Math.round(seg.end * 1000) + offsetMs,
          text: seg.text.trim(),
        });
      }
      c++;

      // Persist progress after each chunk
      writeProjectFile(paths.progress, { currentChunk: c, numChunks, segments: allSegments, segIdx });
    }

    win?.webContents.send('whisper:progress', projectId, 100);

    const srtContent = segmentsToSrt(allSegments);
    fs.writeFileSync(paths.srt, srtContent, 'utf8');

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
