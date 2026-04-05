import { ipcMain, BrowserWindow } from 'electron';
import fs from 'fs';
import { getProjectById, store, type GroqModel } from './store';
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
  ipcMain.handle('whisper:getBackendSettings', () => {
    return {
      groqApiKey: store.get('groqApiKey', ''),
      groqModel: store.get('groqModel', 'whisper-large-v3-turbo') as GroqModel,
      groqAnalysisApiKey: store.get('groqAnalysisApiKey', ''),
    };
  });

  ipcMain.handle('whisper:setGroqAnalysisApiKey', (_event, key: string) => {
    store.set('groqAnalysisApiKey', key);
    return { success: true };
  });

  ipcMain.handle('whisper:setGroqApiKey', (_event, key: string) => {
    store.set('groqApiKey', key);
    return { success: true };
  });

  ipcMain.handle('whisper:setGroqModel', (_event, model: GroqModel) => {
    store.set('groqModel', model);
    return { success: true };
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

    const apiKey = store.get('groqApiKey', '') as string;
    if (!apiKey) {
      return { success: false, error: 'Groq API key not configured. Set it in Settings.' };
    }
    const groqModel = store.get('groqModel', 'whisper-large-v3-turbo') as GroqModel;
    const win = BrowserWindow.fromWebContents(event.sender);
    return transcribeWithGroq(projectId, project.audioPath!, apiKey, groqModel, win);
  });
}
