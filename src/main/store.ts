import Store from 'electron-store';
import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

export interface TranscriptionProgress {
  currentChunk: number;
  numChunks: number;
  segments: Array<{ index: number; startMs: number; endMs: number; text: string }>;
  segIdx: number;
}

export interface AnalysisData {
  sections: Array<{ title: string; startMs: number; endMs: number; summary: string }>;
  clips: Array<{ title: string; startMs: number; endMs: number; reason: string }>;
}

export interface StoredProject {
  id: string;
  fileName: string;
  filePath: string;
  audioPath?: string;
  srtPath?: string;
  addedAt: string;
  status: 'imported' | 'converting' | 'completed';
  transcriptionProgress?: TranscriptionProgress;
  analysisData?: AnalysisData;
  analysisPath?: string;
}

export type GroqModel = 'whisper-large-v3' | 'whisper-large-v3-turbo';

interface StoreSchema {
  projects: StoredProject[];
  groqApiKey: string;
  groqModel: GroqModel;
  groqAnalysisApiKey: string;
}

export const store = new Store<StoreSchema>({
  defaults: {
    projects: [],
    groqApiKey: '',
    groqModel: 'whisper-large-v3-turbo',
    groqAnalysisApiKey: '',
  },
});

export function getProjectById(id: string): StoredProject | undefined {
  return store.get('projects').find((p) => p.id === id);
}

export function updateProject(id: string, updates: Partial<StoredProject>): void {
  const current = store.get('projects');
  store.set('projects', current.map((p) => (p.id === id ? { ...p, ...updates } : p)));
}

export function registerStoreHandlers(): void {
  ipcMain.handle('store:getProjects', () => {
    return store.get('projects');
  });

  ipcMain.handle('store:addProjects', (_event, projects: StoredProject[]) => {
    const current = store.get('projects');
    // Auto-detect existing SRT file next to the video
    const enriched = projects.map((p) => {
      const ext = path.extname(p.filePath);
      const baseName = path.basename(p.filePath, ext);
      const dir = path.dirname(p.filePath);
      const srtPath = path.join(dir, baseName + '.srt');
      const analysisPath = path.join(dir, baseName + '.analysis.json');

      let enriched = { ...p };

      if (fs.existsSync(srtPath)) {
        enriched = { ...enriched, srtPath, status: 'completed' as const };
      }

      if (fs.existsSync(analysisPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
          enriched = { ...enriched, analysisData: data, analysisPath };
        } catch {}
      }

      return enriched;
    });
    store.set('projects', [...current, ...enriched]);
    return store.get('projects');
  });

  ipcMain.handle('store:removeProject', (_event, id: string) => {
    const current = store.get('projects');
    const project = current.find((p) => p.id === id);
    if (project?.audioPath) {
      try { fs.unlinkSync(project.audioPath); } catch {}
    }
    store.set('projects', current.filter((p) => p.id !== id));
    return store.get('projects');
  });

  ipcMain.handle('store:updateProjectStatus', (_event, id: string, status: StoredProject['status']) => {
    const current = store.get('projects');
    store.set('projects', current.map((p) => (p.id === id ? { ...p, status } : p)));
    return store.get('projects');
  });

  ipcMain.handle('store:readSrt', (_event, projectId: string) => {
    const project = store.get('projects').find((p) => p.id === projectId);
    if (!project?.srtPath) return null;
    try {
      return fs.readFileSync(project.srtPath, 'utf8');
    } catch {
      return null;
    }
  });
}
