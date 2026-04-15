import { ipcMain, BrowserWindow } from 'electron';
import fs from 'fs';
import { getProjectById, settingsStore, projectPaths, readProjectFile, rateLimitsStore } from './store';
import type { GroqModel, TranscriptionProgress } from './store';
import { transcribeWithGroq } from './groq';

export interface SrtSegment {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  /** Whisper `avg_logprob` (roughly -inf..0; higher is more confident). */
  confidence?: number;
}

function formatTimestamp(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = Math.round(ms % 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

export function segmentsToSrt(segments: SrtSegment[]): string {
  return segments
    .map((seg) =>
      `${seg.index}\n${formatTimestamp(seg.startMs)} --> ${formatTimestamp(seg.endMs)}\n${seg.text}\n`
    )
    .join('\n');
}

export function registerWhisperHandlers(): void {
  ipcMain.handle('settings:getAll', () => {
    // Migrate old single-key format to array
    const oldKey = (settingsStore as any).get('transcriptionApiKey') as string | undefined;
    if (oldKey && typeof oldKey === 'string') {
      settingsStore.set('transcriptionApiKeys', [oldKey]);
      (settingsStore as any).delete('transcriptionApiKey');
    }

    return {
      transcriptionApiKeys: settingsStore.get('transcriptionApiKeys', []),
    };
  });

  ipcMain.handle('settings:setTranscriptionApiKeys', (_event, keys: string[]) => {
    settingsStore.set('transcriptionApiKeys', keys);
    return { success: true };
  });

  ipcMain.handle('settings:getRateLimits', () => {
    return rateLimitsStore.get('keys', {});
  });

  ipcMain.handle('whisper:getProgress', (_event, projectId: string) => {
    const paths = projectPaths(projectId);
    return readProjectFile<TranscriptionProgress>(projectId, paths.progress);
  });

  ipcMain.handle('whisper:transcribe', async (event, projectId: string, model: string) => {
    const project = getProjectById(projectId);
    if (!project) {
      return { success: false, error: 'Project not found' };
    }

    const paths = projectPaths(projectId);
    if (!fs.existsSync(paths.audio)) {
      return { success: false, error: 'Audio not extracted yet. Run extract audio first.' };
    }

    const apiKeys = (settingsStore.get('transcriptionApiKeys', []) as string[]).filter(Boolean);
    if (apiKeys.length === 0) {
      return { success: false, error: 'Groq API key not configured. Set it in Settings.' };
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    return transcribeWithGroq(projectId, paths.audio, apiKeys, model as GroqModel, win);
  });
}
