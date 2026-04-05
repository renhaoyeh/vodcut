import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getProjects: () => ipcRenderer.invoke('store:getProjects'),
  addProjects: (projects: any[]) => ipcRenderer.invoke('store:addProjects', projects),
  removeProject: (id: string) => ipcRenderer.invoke('store:removeProject', id),
  updateProjectStatus: (id: string, status: string) =>
    ipcRenderer.invoke('store:updateProjectStatus', id, status),
});
