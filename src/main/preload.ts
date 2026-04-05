import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getProjects: () => ipcRenderer.invoke('store:getProjects'),
  addProjects: (projects: any[]) => ipcRenderer.invoke('store:addProjects', projects),
  removeProject: (id: string) => ipcRenderer.invoke('store:removeProject', id),
  updateProjectStatus: (id: string, status: string) =>
    ipcRenderer.invoke('store:updateProjectStatus', id, status),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  extractAudio: (projectId: string) =>
    ipcRenderer.invoke('ffmpeg:extractAudio', projectId),
  onFfmpegProgress: (callback: (projectId: string, percent: number) => void) => {
    const listener = (_event: any, projectId: string, percent: number) => callback(projectId, percent);
    ipcRenderer.on('ffmpeg:progress', listener);
    return () => ipcRenderer.removeListener('ffmpeg:progress', listener);
  },
});
