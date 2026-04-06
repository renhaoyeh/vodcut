import Store from 'electron-store';
import { ipcMain, app } from 'electron';
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
  addedAt: string;
  status: 'imported' | 'converting' | 'completed';
}

export type GroqModel = 'whisper-large-v3' | 'whisper-large-v3-turbo';

// --- Settings store (API keys, model preferences) ---

interface SettingsSchema {
  transcriptionApiKeys: string[];
  groqApiKey: string;
  geminiApiKey: string;
}

export const settingsStore = new Store<SettingsSchema>({
  name: 'settings',
  defaults: {
    transcriptionApiKeys: [],
    groqApiKey: '',
    geminiApiKey: '',
  },
});

// --- Rate limit store (Groq API usage per key) ---

export interface RateLimitInfo {
  limitRequests: number;
  remainingRequests: number;
  limitTokens: number;
  remainingTokens: number;
  resetRequests: string;
  resetTokens: string;
  updatedAt: string;
  lastError?: string;
  lastErrorAt?: string;
}

interface RateLimitsSchema {
  /** Keyed by last-8-chars of API key */
  keys: Record<string, RateLimitInfo>;
}

export const rateLimitsStore = new Store<RateLimitsSchema>({
  name: 'rate-limits',
  defaults: { keys: {} },
});

/** Extract rate limit headers from a Groq HTTP response and persist them. */
export function saveGroqRateLimits(apiKey: string, headers: Record<string, string | string[] | undefined>): void {
  const keyId = apiKey.slice(-8);
  const info: RateLimitInfo = {
    limitRequests: Number(headers['x-ratelimit-limit-requests']) || 0,
    remainingRequests: Number(headers['x-ratelimit-remaining-requests']) || 0,
    limitTokens: Number(headers['x-ratelimit-limit-tokens']) || 0,
    remainingTokens: Number(headers['x-ratelimit-remaining-tokens']) || 0,
    resetRequests: String(headers['x-ratelimit-reset-requests'] ?? ''),
    resetTokens: String(headers['x-ratelimit-reset-tokens'] ?? ''),
    updatedAt: new Date().toISOString(),
  };
  const all = rateLimitsStore.get('keys', {});
  // Preserve existing error info when updating rate limits
  const existing = all[keyId];
  if (existing?.lastError) {
    info.lastError = existing.lastError;
    info.lastErrorAt = existing.lastErrorAt;
  }
  all[keyId] = info;
  rateLimitsStore.set('keys', all);
}

/** Save an API error for a specific key so it can be displayed in Settings. */
export function saveGroqError(apiKey: string, error: string): void {
  const keyId = apiKey.slice(-8);
  const all = rateLimitsStore.get('keys', {});
  const existing = all[keyId] ?? {
    limitRequests: 0, remainingRequests: 0,
    limitTokens: 0, remainingTokens: 0,
    resetRequests: '', resetTokens: '',
    updatedAt: new Date().toISOString(),
  };
  existing.lastError = error;
  existing.lastErrorAt = new Date().toISOString();
  all[keyId] = existing;
  rateLimitsStore.set('keys', all);
}

/** Clear the stored error for a specific key (e.g. after a successful call). */
export function clearGroqError(apiKey: string): void {
  const keyId = apiKey.slice(-8);
  const all = rateLimitsStore.get('keys', {});
  if (all[keyId]) {
    delete all[keyId].lastError;
    delete all[keyId].lastErrorAt;
    rateLimitsStore.set('keys', all);
  }
}

// --- Project store (lightweight index) ---

interface ProjectSchema {
  projects: StoredProject[];
}

export const projectStore = new Store<ProjectSchema>({
  name: 'projects',
  defaults: {
    projects: [],
  },
});

// --- Per-project folder helpers ---

/** Return the project's dedicated folder, creating it if needed. */
export function getProjectDir(projectId: string): string {
  const dir = path.join(app.getPath('userData'), 'projects', projectId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Well-known file paths inside a project folder. */
export function projectPaths(projectId: string) {
  const dir = getProjectDir(projectId);
  return {
    dir,
    audio: path.join(dir, 'audio.wav'),
    srt: path.join(dir, 'subtitles.srt'),
    analysis: path.join(dir, 'analysis.json'),
    progress: path.join(dir, 'transcription-progress.json'),
  };
}

// --- Helpers ---

export function getProjectById(id: string): StoredProject | undefined {
  return projectStore.get('projects').find((p) => p.id === id);
}

export function updateProject(id: string, updates: Partial<StoredProject>): void {
  const current = projectStore.get('projects');
  projectStore.set('projects', current.map((p) => (p.id === id ? { ...p, ...updates } : p)));
}

/** Read JSON from a project file, returning null if missing. */
export function readProjectFile<T>(projectId: string, filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** Write JSON to a project file. */
export function writeProjectFile(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// --- IPC handlers ---

export function registerStoreHandlers(): void {
  ipcMain.handle('store:getProjects', () => {
    return projectStore.get('projects');
  });

  ipcMain.handle('store:addProjects', (_event, projects: StoredProject[]) => {
    const current = projectStore.get('projects');

    const newProjects = projects.map((p) => {
      // Ensure project folder exists
      getProjectDir(p.id);

      // Auto-detect existing SRT file next to the video
      const ext = path.extname(p.filePath);
      const baseName = path.basename(p.filePath, ext);
      const videoDir = path.dirname(p.filePath);
      const existingSrt = path.join(videoDir, baseName + '.srt');
      const existingAnalysis = path.join(videoDir, baseName + '.analysis.json');

      const paths = projectPaths(p.id);
      let enriched = { ...p };

      if (fs.existsSync(existingSrt)) {
        // Copy SRT into project folder
        fs.copyFileSync(existingSrt, paths.srt);
        enriched = { ...enriched, status: 'completed' as const };
      }

      if (fs.existsSync(existingAnalysis)) {
        try {
          // Copy analysis into project folder
          fs.copyFileSync(existingAnalysis, paths.analysis);
        } catch {}
      }

      return enriched;
    });

    projectStore.set('projects', [...current, ...newProjects]);
    return projectStore.get('projects');
  });

  ipcMain.handle('store:removeProject', (_event, id: string) => {
    const current = projectStore.get('projects');
    // Remove entire project folder
    const dir = path.join(app.getPath('userData'), 'projects', id);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    projectStore.set('projects', current.filter((p) => p.id !== id));
    return projectStore.get('projects');
  });

  ipcMain.handle('store:updateProjectStatus', (_event, id: string, status: StoredProject['status']) => {
    updateProject(id, { status });
    return projectStore.get('projects');
  });

  ipcMain.handle('store:readSrt', (_event, projectId: string) => {
    const paths = projectPaths(projectId);
    try {
      return fs.readFileSync(paths.srt, 'utf8');
    } catch {
      return null;
    }
  });

  ipcMain.handle('store:saveSrt', (_event, projectId: string, content: string) => {
    const paths = projectPaths(projectId);
    const project = getProjectById(projectId);
    try {
      fs.writeFileSync(paths.srt, content, 'utf8');
      // Also update the copy next to the video
      if (project) {
        const videoDir = path.dirname(project.filePath);
        const videoName = path.basename(project.filePath, path.extname(project.filePath));
        try { fs.writeFileSync(path.join(videoDir, `${videoName}.srt`), content, 'utf8'); } catch {}
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  });
}
