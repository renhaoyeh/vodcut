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

  // Whisper
  getModelInfo: () => ipcRenderer.invoke('whisper:getModelInfo'),
  selectModel: (modelSize: string) => ipcRenderer.invoke('whisper:selectModel', modelSize),
  downloadModel: (modelSize: string) => ipcRenderer.invoke('whisper:downloadModel', modelSize),
  transcribe: (projectId: string) => ipcRenderer.invoke('whisper:transcribe', projectId),
  pauseTranscription: (projectId: string) => ipcRenderer.invoke('whisper:pause', projectId),
  resumeTranscription: (projectId: string) => ipcRenderer.invoke('whisper:resume', projectId),
  releaseModel: () => ipcRenderer.invoke('whisper:releaseModel'),
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
  onDownloadProgress: (callback: (modelSize: string, percent: number) => void) => {
    const listener = (_event: any, modelSize: string, percent: number) => callback(modelSize, percent);
    ipcRenderer.on('whisper:downloadProgress', listener);
    return () => ipcRenderer.removeListener('whisper:downloadProgress', listener);
  },
});
