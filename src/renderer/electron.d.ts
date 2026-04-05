interface ElectronAPI {
  getProjects: () => Promise<import('../main/store').StoredProject[]>;
  addProjects: (projects: import('../main/store').StoredProject[]) => Promise<import('../main/store').StoredProject[]>;
  removeProject: (id: string) => Promise<import('../main/store').StoredProject[]>;
  updateProjectStatus: (id: string, status: string) => Promise<import('../main/store').StoredProject[]>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
