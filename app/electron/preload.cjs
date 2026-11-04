// Sandboxed preload: the page gets exactly these functions, nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kc', {
  platform: ipcRenderer.sendSync('platform'),
  async call(method, params) {
    const r = await ipcRenderer.invoke('core', method, params);
    if (r.error !== undefined) throw new Error(r.error);
    return r.result;
  },
  onEvent(fn) {
    ipcRenderer.on('core-event', (_e, m) => fn(m));
  },
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  fileIcon: (p) => ipcRenderer.invoke('file-icon', p),
  openStartupSettings: () => ipcRenderer.invoke('open-startup-settings'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  setCleaning: (on) => ipcRenderer.send('cleaning', !!on),
  setTheme: (t) => ipcRenderer.send('theme', String(t)),
  appVersion: () => ipcRenderer.invoke('app-version'),
  onBackdrop(fn) {
    ipcRenderer.on('backdrop', (_e, b) => fn(String(b)));
    ipcRenderer.invoke('backdrop').then((b) => fn(String(b)));
  },
});
