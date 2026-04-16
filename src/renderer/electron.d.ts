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
  analyzeProject: (projectId: string, model?: string) => Promise<{ success: boolean; data?: AnalysisData; model?: string; error?: string }>;
  getAnalysisData: (projectId: string) => Promise<AnalysisData | null>;
  listAnalysisModels: (projectId: string) => Promise<string[]>;
  getAnalysisDataForModel: (projectId: string, model: string) => Promise<AnalysisData | null>;
  onAnalyzerStatus: (callback: (projectId: string, status: string) => void) => () => void;

  // Settings
  getBackendSettings: () => Promise<{
    transcriptionApiKeys: string[];
  }>;
  setTranscriptionApiKeys: (keys: string[]) => Promise<{ success: boolean }>;
  getRateLimits: () => Promise<Record<string, RateLimitInfo>>;
  getTranscriptionProgress: (projectId: string) => Promise<TranscriptionProgress | null>;
  transcribe: (projectId: string, model: string, autoRefine?: boolean) => Promise<{ success: boolean; srtPath?: string; error?: string }>;
  retranscribeSegment: (
    projectId: string,
    startMs: number,
    endMs: number,
    contextBefore: string,
    contextAfter: string,
    model: string,
  ) => Promise<{ success: boolean; text?: string; error?: string }>;
  retranscribeRange: (
    projectId: string,
    startMs: number,
    endMs: number,
    contextBefore: string,
    contextAfter: string,
    model: string,
  ) => Promise<{ success: boolean; segments?: Array<{ startMs: number; endMs: number; text: string }>; error?: string }>;
  readSrt: (projectId: string) => Promise<string | null>;
  saveSrt: (projectId: string, content: string) => Promise<{ success: boolean; error?: string }>;
  readSegments: (projectId: string) => Promise<Array<{ index: number; startMs: number; endMs: number; text: string; confidence?: number }> | null>;
  saveSegments: (projectId: string, segments: unknown) => Promise<{ success: boolean; error?: string }>;
  onWhisperProgress: (callback: (projectId: string, percent: number) => void) => () => void;
  onWhisperStage: (callback: (projectId: string, stage: string) => void) => () => void;

  // Denoise (DeepFilterNet)
  isDenoiseAvailable: () => Promise<boolean>;
  getDenoiseEnabled: () => Promise<boolean>;
  setDenoiseEnabled: (enabled: boolean) => Promise<{ success: boolean }>;

  // Clip export (C1/C2)
  exportClip: (
    projectId: string,
    clip: { title: string; startMs: number; endMs: number },
    options: { burnSubtitles: boolean; precise: boolean },
  ) => Promise<{ success: boolean; outputPath?: string; error?: string }>;
  revealInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  onExportProgress: (callback: (projectId: string, clipKey: string, percent: number) => void) => () => void;

  // Vocabulary extraction (A2)
  extractVocabulary: (projectId: string) => Promise<{ success: boolean; terms?: string[]; error?: string }>;
  saveVocabulary: (projectId: string, terms: string[]) => Promise<{ success: boolean; error?: string }>;
  readVocabulary: (projectId: string) => Promise<string[]>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
