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

// --- Settings store (API keys, model preferences) ---

interface SettingsSchema {
  transcriptionApiKey: string;
  transcriptionModel: GroqModel;
  analysisApiKey: string;
}

export const settingsStore = new Store<SettingsSchema>({
  name: 'settings',
  defaults: {
    transcriptionApiKey: '',
    transcriptionModel: 'whisper-large-v3-turbo',
    analysisApiKey: '',
  },
});

// --- Project store (video records) ---

interface ProjectSchema {
  projects: StoredProject[];
}

export const projectStore = new Store<ProjectSchema>({
  name: 'projects',
  defaults: {
    projects: [],
  },
});

export function getProjectById(id: string): StoredProject | undefined {
  return projectStore.get('projects').find((p) => p.id === id);
}

export function updateProject(id: string, updates: Partial<StoredProject>): void {
  const current = projectStore.get('projects');
  projectStore.set('projects', current.map((p) => (p.id === id ? { ...p, ...updates } : p)));
}

export function registerStoreHandlers(): void {
  ipcMain.handle('store:getProjects', () => {
    return projectStore.get('projects');
  });

  ipcMain.handle('store:addProjects', (_event, projects: StoredProject[]) => {
    const current = projectStore.get('projects');
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
    projectStore.set('projects', [...current, ...enriched]);
    return projectStore.get('projects');
  });

  ipcMain.handle('store:removeProject', (_event, id: string) => {
    const current = projectStore.get('projects');
    const project = current.find((p) => p.id === id);
    if (project?.audioPath) {
      try { fs.unlinkSync(project.audioPath); } catch {}
    }
    projectStore.set('projects', current.filter((p) => p.id !== id));
    return projectStore.get('projects');
  });

  ipcMain.handle('store:updateProjectStatus', (_event, id: string, status: StoredProject['status']) => {
    const current = projectStore.get('projects');
    projectStore.set('projects', current.map((p) => (p.id === id ? { ...p, status } : p)));
    return projectStore.get('projects');
  });

  ipcMain.handle('store:readSrt', (_event, projectId: string) => {
    const project = projectStore.get('projects').find((p) => p.id === projectId);
    if (!project?.srtPath) return null;
    try {
      return fs.readFileSync(project.srtPath, 'utf8');
    } catch {
      return null;
    }
  });
}
