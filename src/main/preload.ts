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

  // Whisper / Groq
  getBackendSettings: () => ipcRenderer.invoke('whisper:getBackendSettings'),
  setGroqApiKey: (key: string) => ipcRenderer.invoke('whisper:setGroqApiKey', key),
  setGroqModel: (model: string) => ipcRenderer.invoke('whisper:setGroqModel', model),
  transcribe: (projectId: string) => ipcRenderer.invoke('whisper:transcribe', projectId),
  readSrt: (projectId: string) => ipcRenderer.invoke('store:readSrt', projectId),
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
