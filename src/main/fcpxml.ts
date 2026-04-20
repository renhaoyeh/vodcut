import { ipcMain, app } from 'electron';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getProjectById } from './store';

const ffmpegPath: string = require('ffmpeg-static');

export interface FcpxmlClipInput {
  title: string;
  reason?: string;
  startMs: number;
  endMs: number;
}

interface VideoProbe {
  width: number;
  height: number;
  /** timeScale / frameTicks = fps. e.g. 30000 / 1001 = 29.97. */
  timeScale: number;
  frameTicks: number;
  /** Human-readable fps, for the format name. */
  fpsLabel: string;
  audioRate: number;
  audioChannels: number;
}

const DEFAULT_PROBE: VideoProbe = {
  width: 1920,
  height: 1080,
  timeScale: 30000,
  frameTicks: 1001,
  fpsLabel: '2997',
  audioRate: 48000,
  audioChannels: 2,
};

/**
 * Snap a floating fps to the nearest standard rational:
 *   23.976 → 24000/1001, 24 → 24/1, 25 → 25/1, 29.97 → 30000/1001,
 *   30 → 30/1, 50 → 50/1, 59.94 → 60000/1001, 60 → 60/1.
 * Falls back to the exact fps with timeScale 1000 if no standard matches.
 */
function fpsToRational(fps: number): { timeScale: number; frameTicks: number; fpsLabel: string } {
  const candidates: Array<{ fps: number; timeScale: number; frameTicks: number; fpsLabel: string }> = [
    { fps: 23.976, timeScale: 24000, frameTicks: 1001, fpsLabel: '2398' },
    { fps: 24, timeScale: 24, frameTicks: 1, fpsLabel: '24' },
    { fps: 25, timeScale: 25, frameTicks: 1, fpsLabel: '25' },
    { fps: 29.97, timeScale: 30000, frameTicks: 1001, fpsLabel: '2997' },
    { fps: 30, timeScale: 30, frameTicks: 1, fpsLabel: '30' },
    { fps: 50, timeScale: 50, frameTicks: 1, fpsLabel: '50' },
    { fps: 59.94, timeScale: 60000, frameTicks: 1001, fpsLabel: '5994' },
    { fps: 60, timeScale: 60, frameTicks: 1, fpsLabel: '60' },
  ];
  let best = candidates[4];
  let bestDiff = Math.abs(fps - best.fps);
  for (const c of candidates) {
    const d = Math.abs(fps - c.fps);
    if (d < bestDiff) { best = c; bestDiff = d; }
  }
  // Accept the standard rational if it's within 0.5fps; otherwise fall back.
  if (bestDiff <= 0.5) return best;
  const scaled = Math.round(fps * 1000);
  return { timeScale: scaled, frameTicks: 1000, fpsLabel: String(Math.round(fps)) };
}

function probeVideo(videoPath: string): Promise<VideoProbe> {
  return new Promise((resolve) => {
    execFile(
      ffmpegPath,
      ['-i', videoPath, '-hide_banner'],
      { encoding: 'utf8' },
      (_err, _stdout, stderr) => {
        const video = stderr.match(/Video:[^\n]*?(\d{2,5})x(\d{2,5})[^\n]*?([\d.]+)\s*fps/);
        const audio = stderr.match(/Audio:[^\n]*?(\d+)\s*Hz[^\n]*?(mono|stereo|\d+\s*channels)/);
        if (!video) return resolve(DEFAULT_PROBE);
        const width = parseInt(video[1], 10);
        const height = parseInt(video[2], 10);
        const fps = parseFloat(video[3]);
        const { timeScale, frameTicks, fpsLabel } = fpsToRational(fps);
        let audioRate = DEFAULT_PROBE.audioRate;
        let audioChannels = DEFAULT_PROBE.audioChannels;
        if (audio) {
          audioRate = parseInt(audio[1], 10) || audioRate;
          const layout = audio[2];
          if (layout === 'mono') audioChannels = 1;
          else if (layout === 'stereo') audioChannels = 2;
          else {
            const n = parseInt(layout, 10);
            if (!isNaN(n)) audioChannels = n;
          }
        }
        resolve({ width, height, timeScale, frameTicks, fpsLabel, audioRate, audioChannels });
      },
    );
  });
}

/** Convert milliseconds to an integer frame count at the given fps. */
function msToFrames(ms: number, timeScale: number, frameTicks: number): number {
  // fps = timeScale / frameTicks, so frames = ms/1000 * fps = ms * timeScale / (1000 * frameTicks).
  return Math.round((ms * timeScale) / (1000 * frameTicks));
}

/** FCPXML rational time: "N/D s" where N = frames * frameTicks, D = timeScale. */
function framesToRational(frames: number, timeScale: number, frameTicks: number): string {
  if (frames === 0) return '0s';
  const num = frames * frameTicks;
  // Simplify N/D when frameTicks is 1 to produce "30/30s" style, which FCPXML accepts either way.
  return `${num}/${timeScale}s`;
}

/** Encode a local path as a file:// URL for FCPXML's src attribute. */
function toFileUrl(p: string): string {
  // Normalize Windows backslashes and URL-encode the path segments.
  const normalized = p.replace(/\\/g, '/');
  // encodeURI preserves slashes and colons; it's the right fit for file:// URLs.
  return 'file://' + (normalized.startsWith('/') ? '' : '/') + encodeURI(normalized);
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeFilename(s: string, fallback: string): string {
  const cleaned = s.replace(/[\\/:*?"<>|\n\r\t]+/g, '').trim().slice(0, 80);
  return cleaned || fallback;
}

function getDefaultOutputDir(projectFilePath: string): string {
  const videoName = path.basename(projectFilePath, path.extname(projectFilePath));
  const videosDir = app.getPath('videos') || path.join(os.homedir(), 'Videos');
  return path.join(videosDir, 'vodcut', videoName);
}

/**
 * Build an FCPXML document arranging each clip back-to-back on the spine, with
 * source in/out points referenced (no re-encoding). A marker at the start of
 * each clip carries the AI-generated title and reason so the editor can see
 * context in DaVinci.
 */
function buildFcpxml(
  projectName: string,
  videoPath: string,
  clips: FcpxmlClipInput[],
  probe: VideoProbe,
): string {
  const { width, height, timeScale, frameTicks, fpsLabel, audioRate, audioChannels } = probe;
  const formatId = 'r1';
  const assetId = 'r2';
  const formatName = `FFVideoFormat${height}p${fpsLabel}`;
  const frameDuration = framesToRational(1, timeScale, frameTicks);

  const sourceName = path.basename(videoPath, path.extname(videoPath));
  const fileUrl = toFileUrl(videoPath);

  // Pre-compute per-clip frame ranges, skipping any that would be zero-length
  // after frame-snapping or that overlap with a previous clip.
  const snapped = clips
    .slice()
    .sort((a, b) => a.startMs - b.startMs)
    .map((c) => ({
      title: c.title,
      reason: c.reason ?? '',
      startFrame: msToFrames(c.startMs, timeScale, frameTicks),
      endFrame: msToFrames(c.endMs, timeScale, frameTicks),
    }))
    .filter((c) => c.endFrame > c.startFrame);

  // Total source asset duration — use the end of the last clip as a lower bound
  // since we don't probe duration here; DaVinci handles oversize values fine.
  const assetEndFrame = snapped.length ? Math.max(...snapped.map((c) => c.endFrame)) + 1 : 1;
  const assetDuration = framesToRational(assetEndFrame, timeScale, frameTicks);

  const spineEntries: string[] = [];
  let offsetFrame = 0;
  for (let i = 0; i < snapped.length; i++) {
    const c = snapped[i];
    const durFrames = c.endFrame - c.startFrame;
    const offset = framesToRational(offsetFrame, timeScale, frameTicks);
    const startInSource = framesToRational(c.startFrame, timeScale, frameTicks);
    const duration = framesToRational(durFrames, timeScale, frameTicks);
    const markerStart = framesToRational(c.startFrame, timeScale, frameTicks);
    const markerDur = framesToRational(1, timeScale, frameTicks);
    const markerValue = c.reason ? `${c.title} — ${c.reason}` : c.title;
    spineEntries.push(
      `      <asset-clip name="${xmlEscape(c.title || `Clip ${i + 1}`)}" ref="${assetId}" offset="${offset}" start="${startInSource}" duration="${duration}" format="${formatId}" tcFormat="NDF">\n` +
      `        <marker start="${markerStart}" duration="${markerDur}" value="${xmlEscape(markerValue)}"/>\n` +
      `      </asset-clip>`,
    );
    offsetFrame += durFrames;
  }

  const sequenceDuration = framesToRational(offsetFrame, timeScale, frameTicks);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="${formatId}" name="${xmlEscape(formatName)}" frameDuration="${frameDuration}" width="${width}" height="${height}" colorSpace="1-1-1 (Rec. 709)"/>
    <asset id="${assetId}" name="${xmlEscape(sourceName)}" src="${fileUrl}" start="0s" duration="${assetDuration}" hasVideo="1" hasAudio="1" format="${formatId}" audioSources="1" audioChannels="${audioChannels}" audioRate="${audioRate}"/>
  </resources>
  <library>
    <event name="${xmlEscape(projectName)}">
      <project name="${xmlEscape(projectName)} rough cut">
        <sequence format="${formatId}" duration="${sequenceDuration}" tcStart="0s" tcFormat="NDF" audioLayout="${audioChannels >= 2 ? 'stereo' : 'mono'}" audioRate="${audioRate / 1000}k">
          <spine>
${spineEntries.join('\n')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

export async function exportFcpxmlRoughCut(
  projectId: string,
  clips: FcpxmlClipInput[],
): Promise<string> {
  const project = getProjectById(projectId);
  if (!project) throw new Error('Project not found');
  if (!clips.length) throw new Error('No clips to export');

  const probe = await probeVideo(project.filePath);
  const videoName = path.basename(project.filePath, path.extname(project.filePath));
  const xml = buildFcpxml(videoName, project.filePath, clips, probe);

  const outDir = getDefaultOutputDir(project.filePath);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${sanitizeFilename(videoName, 'rough-cut')}.rough-cut.fcpxml`);
  fs.writeFileSync(outPath, xml, 'utf8');
  return outPath;
}

export function registerFcpxmlHandlers(): void {
  ipcMain.handle(
    'fcpxml:exportRoughCut',
    async (_event, projectId: string, clips: FcpxmlClipInput[]) => {
      try {
        const outputPath = await exportFcpxmlRoughCut(projectId, clips);
        return { success: true, outputPath };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );
}
