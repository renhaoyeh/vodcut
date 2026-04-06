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
  analyzeProject: (projectId: string, provider: string, model: string) => ipcRenderer.invoke('analyzer:analyze', projectId, provider, model),
  getAnalysisProgress: (projectId: string) => ipcRenderer.invoke('analyzer:getProgress', projectId),
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
  setGroqApiKey: (key: string) => ipcRenderer.invoke('settings:setGroqApiKey', key),
  getRateLimits: () => ipcRenderer.invoke('settings:getRateLimits'),
  getTranscriptionProgress: (projectId: string) => ipcRenderer.invoke('whisper:getProgress', projectId),
  transcribe: (projectId: string, model: string) => ipcRenderer.invoke('whisper:transcribe', projectId, model),
  readSrt: (projectId: string) => ipcRenderer.invoke('store:readSrt', projectId),
  saveSrt: (projectId: string, content: string) => ipcRenderer.invoke('store:saveSrt', projectId, content),
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
