import { BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { getProjectById, updateProject, projectPaths, readProjectFile, writeProjectFile, type TranscriptionProgress } from './store';
import { type SrtSegment, segmentsToSrt } from './whisper';

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

function uploadToGroq(filePath: string, apiKey: string, model: string): Promise<GroqResponse> {
  const boundary = '----FormBoundary' + crypto.randomBytes(16).toString('hex');
  const fileData = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const fields: Array<[string, string]> = [
    ['model', model],
    ['language', 'zh'],
    ['response_format', 'verbose_json'],
    ['temperature', '0'],
  ];

  const parts: Buffer[] = [];
  for (const [key, val] of fields) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`
    ));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: audio/wav\r\n\r\n`
  ));
  parts.push(fileData);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) {
          try {
            const err = JSON.parse(text);
            if (err?.error?.message) { reject(new Error(err.error.message)); return; }
          } catch { /* fall through */ }
          reject(new Error(`Groq API error (${res.statusCode}): ${text}`));
          return;
        }
        try {
          resolve(JSON.parse(text) as GroqResponse);
        } catch {
          reject(new Error(`Invalid Groq response: ${text}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
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
