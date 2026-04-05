import Store from 'electron-store';
import { ipcMain } from 'electron';

export interface StoredProject {
  id: string;
  fileName: string;
  filePath: string;
  addedAt: string;
  status: 'imported' | 'converting' | 'completed';
}

interface StoreSchema {
  projects: StoredProject[];
}

const store = new Store<StoreSchema>({
  defaults: {
    projects: [],
  },
});

export function registerStoreHandlers(): void {
  ipcMain.handle('store:getProjects', () => {
    return store.get('projects');
  });

  ipcMain.handle('store:addProjects', (_event, projects: StoredProject[]) => {
    const current = store.get('projects');
    store.set('projects', [...current, ...projects]);
    return store.get('projects');
  });

  ipcMain.handle('store:removeProject', (_event, id: string) => {
    const current = store.get('projects');
    store.set('projects', current.filter((p) => p.id !== id));
    return store.get('projects');
  });

  ipcMain.handle('store:updateProjectStatus', (_event, id: string, status: StoredProject['status']) => {
    const current = store.get('projects');
    store.set('projects', current.map((p) => (p.id === id ? { ...p, status } : p)));
    return store.get('projects');
  });
}
