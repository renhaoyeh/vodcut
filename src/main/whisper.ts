import { ipcMain, BrowserWindow } from 'electron';
import fs from 'fs';
import { getProjectById, settingsStore, type GroqModel } from './store';
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
      transcriptionModel: settingsStore.get('transcriptionModel', 'whisper-large-v3-turbo') as GroqModel,
      analysisApiKey: settingsStore.get('analysisApiKey', ''),
      analysisModel: settingsStore.get('analysisModel', 'llama-3.3-70b-versatile'),
    };
  });

  ipcMain.handle('settings:setAnalysisApiKey', (_event, key: string) => {
    settingsStore.set('analysisApiKey', key);
    return { success: true };
  });

  ipcMain.handle('settings:setAnalysisModel', (_event, model: string) => {
    settingsStore.set('analysisModel', model);
    return { success: true };
  });

  ipcMain.handle('settings:setTranscriptionApiKey', (_event, key: string) => {
    settingsStore.set('transcriptionApiKey', key);
    return { success: true };
  });

  ipcMain.handle('settings:setTranscriptionModel', (_event, model: GroqModel) => {
    settingsStore.set('transcriptionModel', model);
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

    const apiKey = settingsStore.get('transcriptionApiKey', '') as string;
    if (!apiKey) {
      return { success: false, error: 'Groq API key not configured. Set it in Settings.' };
    }
    const transcriptionModel = settingsStore.get('transcriptionModel', 'whisper-large-v3-turbo') as GroqModel;
    const win = BrowserWindow.fromWebContents(event.sender);
    return transcribeWithGroq(projectId, project.audioPath!, apiKey, transcriptionModel, win);
  });
}
