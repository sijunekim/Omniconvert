const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    triggerDownload: (url) => ipcRenderer.send('trigger-download', url),
    // NEW: Allow React to tell Electron if a job is running
    setJobStatus: (isBusy) => ipcRenderer.send('set-job-status', isBusy)
});