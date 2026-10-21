const { contextBridge, ipcRenderer } = require('electron');
const call = (c) => (a) => ipcRenderer.invoke(c, a);
contextBridge.exposeInMainWorld('srv', Object.fromEntries(['status', 'start', 'stop', 'install', 'backup', 'restore', 'schedule', 'password', 'firewall', 'copy', 'open-web'].map((c) => [c.replace(/-(\w)/g, (_, x) => x.toUpperCase()), call(c)])));
