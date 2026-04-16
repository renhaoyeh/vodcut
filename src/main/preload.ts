import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Store
  getProjects: () => ipcRenderer.invoke('store:getProjects'),
  addProjects: (projects: any[]) => ipcRenderer.invoke('store:addProjects', projects),
  removeProject: (id: string) => ipcRenderer.invoke('store:removeProject', id),
  updateProjectStatus: (id: string, status: string) =>
    ipcRenderer.invoke('store:updateProjectStatus', id, status),

  // File utils
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  // FFmpeg
  extractAudio: (projectId: string) =>
    ipcRenderer.invoke('ffmpeg:extractAudio', projectId),
  onFfmpegProgress: (callback: (projectId: string, percent: number) => void) => {
    const listener = (_event: any, projectId: string, percent: number) => callback(projectId, percent);
    ipcRenderer.on('ffmpeg:progress', listener);
    return () => ipcRenderer.removeListener('ffmpeg:progress', listener);
  },

  // Analyzer
  analyzeProject: (projectId: string, model?: string) => ipcRenderer.invoke('analyzer:analyze', projectId, model),
  getAnalysisData: (projectId: string) => ipcRenderer.invoke('analyzer:getData', projectId),
  listAnalysisModels: (projectId: string) => ipcRenderer.invoke('analyzer:listModels', projectId),
  getAnalysisDataForModel: (projectId: string, model: string) => ipcRenderer.invoke('analyzer:getDataForModel', projectId, model),
  onAnalyzerStatus: (callback: (projectId: string, status: string) => void) => {
    const listener = (_event: any, projectId: string, status: string) => callback(projectId, status);
    ipcRenderer.on('analyzer:status', listener);
    return () => ipcRenderer.removeListener('analyzer:status', listener);
  },

  // Settings
  getBackendSettings: () => ipcRenderer.invoke('settings:getAll'),
  setTranscriptionApiKeys: (keys: string[]) => ipcRenderer.invoke('settings:setTranscriptionApiKeys', keys),
  getRateLimits: () => ipcRenderer.invoke('settings:getRateLimits'),
  getTranscriptionProgress: (projectId: string) => ipcRenderer.invoke('whisper:getProgress', projectId),
  transcribe: (projectId: string, model: string, autoRefine: boolean = true) =>
    ipcRenderer.invoke('whisper:transcribe', projectId, model, autoRefine),
  retranscribeSegment: (
    projectId: string,
    startMs: number,
    endMs: number,
    contextBefore: string,
    contextAfter: string,
    model: string,
  ) => ipcRenderer.invoke('whisper:retranscribeSegment', projectId, startMs, endMs, contextBefore, contextAfter, model),
  retranscribeRange: (
    projectId: string,
    startMs: number,
    endMs: number,
    contextBefore: string,
    contextAfter: string,
    model: string,
  ) => ipcRenderer.invoke('whisper:retranscribeRange', projectId, startMs, endMs, contextBefore, contextAfter, model),
  readSrt: (projectId: string) => ipcRenderer.invoke('store:readSrt', projectId),
  saveSrt: (projectId: string, content: string) => ipcRenderer.invoke('store:saveSrt', projectId, content),
  readSegments: (projectId: string) => ipcRenderer.invoke('store:readSegments', projectId),
  saveSegments: (projectId: string, segments: unknown) => ipcRenderer.invoke('store:saveSegments', projectId, segments),

  // Clip export (C1/C2)
  exportClip: (projectId: string, clip: { title: string; startMs: number; endMs: number }, options: { burnSubtitles: boolean; precise: boolean }) =>
    ipcRenderer.invoke('exporter:exportClip', projectId, clip, options),
  revealInFolder: (filePath: string) => ipcRenderer.invoke('exporter:revealInFolder', filePath),
  onExportProgress: (callback: (projectId: string, clipKey: string, percent: number) => void) => {
    const listener = (_event: any, projectId: string, clipKey: string, percent: number) => callback(projectId, clipKey, percent);
    ipcRenderer.on('exporter:progress', listener);
    return () => ipcRenderer.removeListener('exporter:progress', listener);
  },

  // Vocabulary extraction (A2)
  extractVocabulary: (projectId: string) => ipcRenderer.invoke('analyzer:extractVocabulary', projectId),
  saveVocabulary: (projectId: string, terms: string[]) => ipcRenderer.invoke('store:saveVocabulary', projectId, terms),
  readVocabulary: (projectId: string) => ipcRenderer.invoke('store:readVocabulary', projectId),
  // Denoise (DeepFilterNet)
  isDenoiseAvailable: () => ipcRenderer.invoke('denoise:isAvailable'),
  getDenoiseEnabled: () => ipcRenderer.invoke('denoise:getEnabled'),
  setDenoiseEnabled: (enabled: boolean) => ipcRenderer.invoke('denoise:setEnabled', enabled),

  onWhisperProgress: (callback: (projectId: string, percent: number) => void) => {
    const listener = (_event: any, projectId: string, percent: number) => callback(projectId, percent);
    ipcRenderer.on('whisper:progress', listener);
    return () => ipcRenderer.removeListener('whisper:progress', listener);
  },
  onWhisperStage: (callback: (projectId: string, stage: string) => void) => {
    const listener = (_event: any, projectId: string, stage: string) => callback(projectId, stage);
    ipcRenderer.on('whisper:stage', listener);
    return () => ipcRenderer.removeListener('whisper:stage', listener);
  },
});
