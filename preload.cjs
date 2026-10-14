const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('frameDesktop', {
  saveProject: (project, saveAs = false) => ipcRenderer.invoke('project:save', { project, saveAs }),
  openProject: () => ipcRenderer.invoke('project:open'),
  newProject: () => ipcRenderer.invoke('project:new'),
  loadAutosave: () => ipcRenderer.invoke('project:load-autosave'),
  autosave: (project) => ipcRenderer.invoke('project:autosave', project),
  getProjectInfo: () => ipcRenderer.invoke('project:info'),
  getRecentProjects: () => ipcRenderer.invoke('project:recent'),
  openRecentProject: (filePath) => ipcRenderer.invoke('project:open-recent', filePath),
  renameProject: (name) => ipcRenderer.invoke('project:rename', name),
  zoomWindowByStep: (step) => ipcRenderer.invoke('window:zoom-step', step),
  resetWindowZoom: () => ipcRenderer.invoke('window:zoom-reset'),
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  }
});
