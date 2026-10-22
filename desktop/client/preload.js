const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('erpDesktop', {
  config: () => ipcRenderer.invoke('cfg'),
  setServer: (a) => ipcRenderer.invoke('set-server', a),
  discover: () => ipcRenderer.invoke('discover'),
  retry: () => ipcRenderer.invoke('retry'),
  change: () => ipcRenderer.invoke('change'),
  print: () => ipcRenderer.invoke('print'),
});
