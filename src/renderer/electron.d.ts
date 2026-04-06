import type { StoredProject, AnalysisData, TranscriptionProgress, RateLimitInfo } from '../main/store';

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

  // Analyzer
  analyzeProject: (projectId: string, provider: string, model: string) => Promise<{ success: boolean; data?: AnalysisData; error?: string }>;
  getAnalysisData: (projectId: string) => Promise<AnalysisData | null>;
  onAnalyzerStatus: (callback: (projectId: string, status: string) => void) => () => void;

  // Settings
  getBackendSettings: () => Promise<{
    transcriptionApiKeys: string[];
    groqApiKey: string;
  }>;
  setTranscriptionApiKeys: (keys: string[]) => Promise<{ success: boolean }>;
  setGroqApiKey: (key: string) => Promise<{ success: boolean }>;
  getRateLimits: () => Promise<Record<string, RateLimitInfo>>;
  getTranscriptionProgress: (projectId: string) => Promise<TranscriptionProgress | null>;
  transcribe: (projectId: string, model: string) => Promise<{ success: boolean; srtPath?: string; error?: string }>;
  readSrt: (projectId: string) => Promise<string | null>;
  saveSrt: (projectId: string, content: string) => Promise<{ success: boolean; error?: string }>;
  onWhisperProgress: (callback: (projectId: string, percent: number) => void) => () => void;
  onWhisperStage: (callback: (projectId: string, stage: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
