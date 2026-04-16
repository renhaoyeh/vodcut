import { BrowserWindow, ipcMain, app, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import { getProjectById, projectPaths } from './store';

// ffmpeg-static exports the absolute path to the platform-specific binary
const ffmpegPath: string = require('ffmpeg-static');

export interface ExportClipOptions {
  /** Burn subtitles into the video (requires re-encoding, therefore `precise`). */
  burnSubtitles: boolean;
  /** True = re-encode for exact ms-accurate cuts; False = fast copy (keyframe-aligned, slight drift). */
  precise: boolean;
}

export interface ExportClipInput {
  title: string;
  startMs: number;
  endMs: number;
}

/** Sanitize a string for use in filenames. */
function sanitizeFilename(s: string, fallback: string): string {
  const cleaned = s.replace(/[\\/:*?"<>|\n\r\t]+/g, '').trim().slice(0, 60);
  return cleaned || fallback;
}

/** FFmpeg needs subtitle paths with forward slashes and escaped colons (Windows drive letter). */
function ffmpegSubtitlePath(p: string): string {
  // Replace backslashes with forward slashes, then escape the drive-letter colon.
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
}

function msToFfmpegTime(ms: number): string {
  const s = ms / 1000;
  return s.toFixed(3);
}

function formatSrtTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = Math.round(ms % 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

/**
 * Read the project's SRT and rewrite it with timestamps shifted so that
 * `clipStartMs` becomes 0 — required when burning subtitles onto a clipped
 * output whose timeline restarts at 0.
 */
function writeShiftedSrtForClip(srtPath: string, clipStartMs: number, clipEndMs: number, outPath: string): void {
  const content = fs.readFileSync(srtPath, 'utf8');
  const blocks = content.trim().split(/\n\s*\n/);
  const shifted: string[] = [];
  let idx = 1;
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const m = lines[1].match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (!m) continue;
    const startMs = +m[1] * 3600000 + +m[2] * 60000 + +m[3] * 1000 + +m[4];
    const endMs = +m[5] * 3600000 + +m[6] * 60000 + +m[7] * 1000 + +m[8];
    // Skip cues entirely outside the clip range.
    if (endMs < clipStartMs || startMs > clipEndMs) continue;
    const clampedStart = Math.max(0, startMs - clipStartMs);
    const clampedEnd = Math.min(clipEndMs - clipStartMs, endMs - clipStartMs);
    if (clampedEnd <= clampedStart) continue;
    shifted.push(
      `${idx++}\n${formatSrtTime(clampedStart)} --> ${formatSrtTime(clampedEnd)}\n${lines.slice(2).join('\n')}\n`,
    );
  }
  fs.writeFileSync(outPath, shifted.join('\n'), 'utf8');
}

/** Default output directory: the user's Videos folder + vodcut/<videoName>/. */
function getDefaultOutputDir(projectFilePath: string): string {
  const videoName = path.basename(projectFilePath, path.extname(projectFilePath));
  const videosDir = app.getPath('videos') || path.join(os.homedir(), 'Videos');
  return path.join(videosDir, 'vodcut', videoName);
}

async function runFfmpeg(
  args: string[],
  durationSec: number,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      // `-progress pipe:1` outputs `out_time_us=<microseconds>` lines.
      const m = text.match(/out_time_us=(\d+)/);
      if (m && durationSec > 0) {
        const cur = parseInt(m[1], 10) / 1_000_000;
        const pct = Math.min(100, Math.max(0, Math.round((cur / durationSec) * 100)));
        onProgress(pct);
      }
    });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
      }
    });
    proc.on('error', reject);
  });
}

export async function exportClip(
  projectId: string,
  clip: ExportClipInput,
  options: ExportClipOptions,
  onProgress: (percent: number) => void,
): Promise<string> {
  const project = getProjectById(projectId);
  if (!project) throw new Error('Project not found');

  const paths = projectPaths(projectId);
  const outDir = getDefaultOutputDir(project.filePath);
  fs.mkdirSync(outDir, { recursive: true });

  const baseName = sanitizeFilename(clip.title, `clip-${clip.startMs}`);
  const outPath = path.join(outDir, `${baseName}.mp4`);

  const startSec = clip.startMs / 1000;
  const endSec = clip.endMs / 1000;
  const durationSec = Math.max(0.1, endSec - startSec);

  const args: string[] = [];
  // Track any temp subtitle file we create so we can clean up after.
  let shiftedSrtPath: string | null = null;

  if (options.burnSubtitles && fs.existsSync(paths.srt)) {
    // Burn subtitles onto a clipped output. Because `-ss` before `-i` restarts
    // the output timeline at 0, we must supply an SRT whose timestamps are
    // shifted to match.
    shiftedSrtPath = path.join(os.tmpdir(), `vodcut-clipsrt-${Date.now()}.srt`);
    writeShiftedSrtForClip(paths.srt, clip.startMs, clip.endMs, shiftedSrtPath);
    args.push(
      '-ss', msToFfmpegTime(clip.startMs),
      '-i', project.filePath,
      '-t', msToFfmpegTime(clip.endMs - clip.startMs),
      '-vf', `subtitles='${ffmpegSubtitlePath(shiftedSrtPath)}'`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-c:a', 'aac', '-b:a', '192k',
    );
  } else if (options.precise) {
    // Precise re-encode, ms-accurate but slower.
    args.push(
      '-ss', msToFfmpegTime(clip.startMs),
      '-i', project.filePath,
      '-t', msToFfmpegTime(clip.endMs - clip.startMs),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-c:a', 'aac', '-b:a', '192k',
    );
  } else {
    // Fast copy: keyframe-aligned, slightly drifted but very fast.
    args.push(
      '-ss', msToFfmpegTime(clip.startMs),
      '-i', project.filePath,
      '-t', msToFfmpegTime(clip.endMs - clip.startMs),
      '-c', 'copy',
    );
  }

  args.push('-progress', 'pipe:1', '-y', outPath);

  console.log('[exporter]', 'ffmpeg', args.join(' '));
  try {
    await runFfmpeg(args, durationSec, onProgress);
  } finally {
    if (shiftedSrtPath) {
      try { fs.unlinkSync(shiftedSrtPath); } catch {}
    }
  }
  return outPath;
}

export function registerExporterHandlers(): void {
  ipcMain.handle(
    'exporter:exportClip',
    async (event, projectId: string, clip: ExportClipInput, options: ExportClipOptions) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const clipKey = `${clip.startMs}-${clip.endMs}`;
        const outputPath = await exportClip(projectId, clip, options, (percent) => {
          win?.webContents.send('exporter:progress', projectId, clipKey, percent);
        });
        return { success: true, outputPath };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  ipcMain.handle('exporter:revealInFolder', (_event, filePath: string) => {
    try {
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
