const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  checkProject: (args) => ipcRenderer.invoke('project:check', args),
  createProject: (args) => ipcRenderer.invoke('project:create', args),
  scanOrganise: () => ipcRenderer.invoke('organise:scan'),
  convertOrganise: (items) => ipcRenderer.invoke('organise:convert', items),
  undoOrganise: () => ipcRenderer.invoke('organise:undo'),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
});
