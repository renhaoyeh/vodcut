import Store from 'electron-store';
import { ipcMain } from 'electron';

export interface StoredProject {
  id: string;
  fileName: string;
  filePath: string;
  audioPath?: string;
  srtPath?: string;
  addedAt: string;
  status: 'imported' | 'converting' | 'completed';
}

export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3-turbo';

export const WHISPER_MODELS: Record<WhisperModelSize, { label: string; size: string; url: string }> = {
  'tiny':             { label: 'Tiny',              size: '75 MB',   url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin' },
  'base':             { label: 'Base',              size: '142 MB',  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin' },
  'small':            { label: 'Small',             size: '466 MB',  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin' },
  'medium':           { label: 'Medium',            size: '1.5 GB',  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin' },
  'large-v3-turbo':   { label: 'Large V3 Turbo',    size: '1.6 GB',  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin' },
};

interface StoreSchema {
  projects: StoredProject[];
  whisperModel: WhisperModelSize;
}

const store = new Store<StoreSchema>({
  defaults: {
    projects: [],
    whisperModel: 'base',
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
    store.set('projects', [...current, ...projects]);
    return store.get('projects');
  });

  ipcMain.handle('store:removeProject', (_event, id: string) => {
    const current = store.get('projects');
    store.set('projects', current.filter((p) => p.id !== id));
    return store.get('projects');
  });

  ipcMain.handle('store:updateProjectStatus', (_event, id: string, status: StoredProject['status']) => {
    const current = store.get('projects');
    store.set('projects', current.map((p) => (p.id === id ? { ...p, status } : p)));
    return store.get('projects');
  });
}
