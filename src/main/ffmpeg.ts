import { execFile } from 'child_process';
import { spawn } from 'child_process';
import { ipcMain, BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { getProjectById, updateProject } from './store';

const ffmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');

function getOutputDir(): string {
  const dir = path.join(app.getPath('userData'), 'audio');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Write a temporary ffmpeg concat-style file list to pass Unicode paths safely.
 * ffmpeg reads the file in UTF-8, bypassing Windows codepage issues.
 */
function writeTempInputFile(videoPath: string): string {
  const tmpDir = app.getPath('temp');
  const tmpFile = path.join(tmpDir, `vodcut-input-${Date.now()}.txt`);
  // ffmpeg concat demuxer format: file 'path'
  // Escape single quotes in path
  const escaped = videoPath.replace(/'/g, "'\\''");
  fs.writeFileSync(tmpFile, `file '${escaped}'\n`, 'utf8');
  return tmpFile;
}

function getDuration(videoPath: string): Promise<number> {
  const inputFile = writeTempInputFile(videoPath);
  return new Promise((resolve) => {
    execFile(ffmpegPath, [
      '-f', 'concat', '-safe', '0',
      '-i', inputFile,
      '-hide_banner',
    ], { encoding: 'utf8' }, (_err, _stdout, stderr) => {
      fs.unlinkSync(inputFile);
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
      if (match) {
        resolve(parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]));
      } else {
        resolve(0);
      }
    });
  });
}

export async function extractAudio(
  videoPath: string,
  onProgress: (percent: number) => void,
): Promise<string> {
  const outputPath = path.join(
    getOutputDir(),
    `${path.basename(videoPath, path.extname(videoPath))}.wav`,
  );

  const durationSec = await getDuration(videoPath);
  const inputFile = writeTempInputFile(videoPath);

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-f', 'concat', '-safe', '0',
      '-i', inputFile,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '-progress', 'pipe:1',
      '-y',
      outputPath,
    ], { windowsHide: true });

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      const timeMatch = text.match(/out_time_us=(\d+)/);
      if (timeMatch && durationSec > 0) {
        const currentSec = parseInt(timeMatch[1]) / 1_000_000;
        const percent = Math.min(100, Math.round((currentSec / durationSec) * 100));
        onProgress(percent);
      }
    });

    proc.stderr.on('data', () => {});

    proc.on('close', (code) => {
      try { fs.unlinkSync(inputFile); } catch {}
      if (code === 0) {
        onProgress(100);
        resolve(outputPath);
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      try { fs.unlinkSync(inputFile); } catch {}
      reject(err);
    });
  });
}

export function registerFfmpegHandlers(): void {
  ipcMain.handle('ffmpeg:extractAudio', async (event, projectId: string) => {
    const project = getProjectById(projectId);
    if (!project) {
      return { success: false, error: 'Project not found' };
    }
    // Skip if audio already extracted
    if (project.audioPath && fs.existsSync(project.audioPath)) {
      return { success: true, audioPath: project.audioPath };
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    try {
      const audioPath = await extractAudio(project.filePath, (percent) => {
        win?.webContents.send('ffmpeg:progress', projectId, percent);
      });
      updateProject(projectId, { status: 'completed', audioPath });
      return { success: true, audioPath };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
