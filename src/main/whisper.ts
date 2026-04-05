import { initWhisper } from '@fugood/whisper.node';
import { ipcMain, BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { getProjectById, updateProject, WHISPER_MODELS, type WhisperModelSize } from './store';
import Store from 'electron-store';

type WhisperContext = Awaited<ReturnType<typeof initWhisper>>;

let context: WhisperContext | null = null;
let loadedModelPath: string | null = null;

const store = new Store();

function getModelsDir(): string {
  const dir = path.join(app.getPath('userData'), 'models');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getModelPath(modelSize: WhisperModelSize): string {
  return path.join(getModelsDir(), `ggml-${modelSize}.bin`);
}

function isModelDownloaded(modelSize: WhisperModelSize): boolean {
  return fs.existsSync(getModelPath(modelSize));
}

function downloadModel(
  modelSize: WhisperModelSize,
  onProgress: (percent: number) => void,
): Promise<string> {
  const model = WHISPER_MODELS[modelSize];
  const outputPath = getModelPath(modelSize);
  const tmpPath = outputPath + '.tmp';

  return new Promise((resolve, reject) => {
    const follow = (url: string) => {
      https.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          follow(res.headers.location!);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;

        const file = fs.createWriteStream(tmpPath);
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          if (totalBytes > 0) {
            onProgress(Math.round((downloaded / totalBytes) * 100));
          }
        });
        res.pipe(file);

        file.on('finish', () => {
          file.close(() => {
            fs.renameSync(tmpPath, outputPath);
            resolve(outputPath);
          });
        });

        file.on('error', (err) => {
          fs.unlinkSync(tmpPath);
          reject(err);
        });
      }).on('error', reject);
    };
    follow(model.url);
  });
}

async function getContext(modelSize: WhisperModelSize): Promise<WhisperContext> {
  const modelPath = getModelPath(modelSize);

  if (context && loadedModelPath === modelPath) return context;

  // Release old context if switching models
  if (context) {
    await context.release();
    context = null;
    loadedModelPath = null;
  }

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model not downloaded. Download it first from Settings.`);
  }

  console.log('[whisper] Loading model:', modelPath);
  context = await initWhisper({ filePath: modelPath, useGpu: true });
  loadedModelPath = modelPath;
  console.log('[whisper] Model loaded');
  return context;
}

export interface SrtSegment {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

function formatTimestamp(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

function segmentsToSrt(segments: SrtSegment[]): string {
  return segments
    .map((seg) =>
      `${seg.index}\n${formatTimestamp(seg.startMs)} --> ${formatTimestamp(seg.endMs)}\n${seg.text}\n`
    )
    .join('\n');
}

export function registerWhisperHandlers(): void {
  ipcMain.handle('whisper:getModelInfo', () => {
    const selectedModel = store.get('whisperModel', 'base') as WhisperModelSize;
    const models = Object.entries(WHISPER_MODELS).map(([key, val]) => ({
      id: key as WhisperModelSize,
      ...val,
      downloaded: isModelDownloaded(key as WhisperModelSize),
      selected: key === selectedModel,
    }));
    return { models, selectedModel, modelsDir: getModelsDir() };
  });

  ipcMain.handle('whisper:selectModel', (_event, modelSize: WhisperModelSize) => {
    store.set('whisperModel', modelSize);
    return { success: true };
  });

  ipcMain.handle('whisper:downloadModel', async (event, modelSize: WhisperModelSize) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    try {
      await downloadModel(modelSize, (percent) => {
        win?.webContents.send('whisper:downloadProgress', modelSize, percent);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('whisper:transcribe', async (event, projectId: string) => {
    const project = getProjectById(projectId);
    if (!project) {
      return { success: false, error: 'Project not found' };
    }
    if (!project.audioPath) {
      return { success: false, error: 'Audio not extracted yet. Run extract audio first.' };
    }
    if (!fs.existsSync(project.audioPath)) {
      return { success: false, error: `Audio file not found: ${project.audioPath}` };
    }

    const selectedModel = store.get('whisperModel', 'base') as WhisperModelSize;
    const win = BrowserWindow.fromWebContents(event.sender);

    try {
      const ctx = await getContext(selectedModel);

      // Read WAV as buffer to bypass Unicode path issues with transcribeFile
      const wavBuffer = fs.readFileSync(project.audioPath);
      // Strip WAV header (44 bytes) to get raw PCM data
      const pcmData = wavBuffer.buffer.slice(44);

      // Split into 30-second chunks (16kHz, 16-bit mono = 32000 bytes/sec)
      const CHUNK_SEC = 30;
      const BYTES_PER_SEC = 16000 * 2;
      const CHUNK_BYTES = CHUNK_SEC * BYTES_PER_SEC;
      const totalBytes = pcmData.byteLength;
      const numChunks = Math.ceil(totalBytes / CHUNK_BYTES);

      const allSegments: SrtSegment[] = [];
      let segIdx = 1;

      for (let c = 0; c < numChunks; c++) {
        const start = c * CHUNK_BYTES;
        const end = Math.min(start + CHUNK_BYTES, totalBytes);
        const chunkData = pcmData.slice(start, end);
        const offsetMs = c * CHUNK_SEC * 1000;

        win?.webContents.send('whisper:stage', projectId, `Step 2 辨識中 (${c + 1}/${numChunks})...`);

        const { promise } = ctx.transcribeData(chunkData, {
          language: 'zh',
          temperature: 0.0,
          onProgress: (progress: number) => {
            const overall = Math.round((c * 100 + progress) / numChunks);
            win?.webContents.send('whisper:progress', projectId, overall);
          },
        });

        const result = await promise;

        for (const seg of result.segments) {
          allSegments.push({
            index: segIdx++,
            startMs: seg.t0 + offsetMs,
            endMs: seg.t1 + offsetMs,
            text: seg.text.trim(),
          });
        }
      }

      const srtSegments = allSegments;

      const srtContent = segmentsToSrt(srtSegments);

      // Save SRT next to original video
      const videoDir = path.dirname(project.filePath);
      const videoName = path.basename(project.filePath, path.extname(project.filePath));
      const srtPath = path.join(videoDir, `${videoName}.srt`);
      fs.writeFileSync(srtPath, srtContent, 'utf8');

      updateProject(projectId, { status: 'completed', srtPath });

      return { success: true, srtPath, segments: srtSegments };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('whisper:releaseModel', async () => {
    if (context) {
      await context.release();
      context = null;
      loadedModelPath = null;
    }
  });
}
