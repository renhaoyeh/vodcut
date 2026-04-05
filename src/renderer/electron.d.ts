import type { StoredProject } from '../main/store';

interface ModelInfo {
  id: string;
  label: string;
  size: string;
  url: string;
  downloaded: boolean;
  selected: boolean;
}

interface ElectronAPI {
  // Store
  getProjects: () => Promise<StoredProject[]>;
  addProjects: (projects: StoredProject[]) => Promise<StoredProject[]>;
  removeProject: (id: string) => Promise<StoredProject[]>;
  updateProjectStatus: (id: string, status: string) => Promise<StoredProject[]>;

  // File utils
  getPathForFile: (file: File) => string;

  // FFmpeg
  extractAudio: (projectId: string) => Promise<{ success: boolean; audioPath?: string; error?: string }>;
  onFfmpegProgress: (callback: (projectId: string, percent: number) => void) => () => void;

  // Whisper
  getModelInfo: () => Promise<{ models: ModelInfo[]; selectedModel: string; modelsDir: string }>;
  selectModel: (modelSize: string) => Promise<{ success: boolean }>;
  downloadModel: (modelSize: string) => Promise<{ success: boolean; error?: string }>;
  transcribe: (projectId: string) => Promise<{ success: boolean; srtPath?: string; error?: string }>;
  pauseTranscription: (projectId: string) => Promise<void>;
  resumeTranscription: (projectId: string) => Promise<void>;
  releaseModel: () => Promise<void>;
  onWhisperProgress: (callback: (projectId: string, percent: number) => void) => () => void;
  onWhisperStage: (callback: (projectId: string, stage: string) => void) => () => void;
  onDownloadProgress: (callback: (modelSize: string, percent: number) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
