import { ipcMain, BrowserWindow } from 'electron';
import fs from 'fs';
import { getProjectById, settingsStore, projectPaths } from './store';
import type { GroqModel } from './store';
import { transcribeWithGroq } from './groq';

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

export function segmentsToSrt(segments: SrtSegment[]): string {
  return segments
    .map((seg) =>
      `${seg.index}\n${formatTimestamp(seg.startMs)} --> ${formatTimestamp(seg.endMs)}\n${seg.text}\n`
    )
    .join('\n');
}

export function registerWhisperHandlers(): void {
  ipcMain.handle('settings:getAll', () => {
    return {
      transcriptionApiKey: settingsStore.get('transcriptionApiKey', ''),
      groqApiKey: settingsStore.get('groqApiKey', ''),
      geminiApiKey: settingsStore.get('geminiApiKey', ''),
    };
  });

  ipcMain.handle('settings:setGroqApiKey', (_event, key: string) => {
    settingsStore.set('groqApiKey', key);
    return { success: true };
  });

  ipcMain.handle('settings:setGeminiApiKey', (_event, key: string) => {
    settingsStore.set('geminiApiKey', key);
    return { success: true };
  });

  ipcMain.handle('settings:setTranscriptionApiKey', (_event, key: string) => {
    settingsStore.set('transcriptionApiKey', key);
    return { success: true };
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

    const apiKey = settingsStore.get('transcriptionApiKey', '') as string;
    if (!apiKey) {
      return { success: false, error: 'Groq API key not configured. Set it in Settings.' };
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    return transcribeWithGroq(projectId, paths.audio, apiKey, model as GroqModel, win);
  });
}
