import type { StoredProject } from '../main/store';

interface ElectronAPI {
  getPathForFile: (file: File) => string;
  getProjects: () => Promise<StoredProject[]>;
  addProjects: (projects: StoredProject[]) => Promise<StoredProject[]>;
  removeProject: (id: string) => Promise<StoredProject[]>;
  updateProjectStatus: (id: string, status: string) => Promise<StoredProject[]>;
  extractAudio: (projectId: string) => Promise<{ success: boolean; audioPath?: string; error?: string }>;
  onFfmpegProgress: (callback: (projectId: string, percent: number) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
