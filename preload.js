const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    triggerDownload: (url) => ipcRenderer.send('trigger-download', url),
    setJobStatus: (status) => ipcRenderer.send('set-job-status', status),
    uploadFile: (filePath) => ipcRenderer.invoke('process-file-upload', filePath),
    selectFiles: () => ipcRenderer.invoke('open-file-dialog'),
    
    // Developer Mode Tools
    openPath: (path) => ipcRenderer.invoke('open-path', path),
    clearCache: () => ipcRenderer.invoke('nuke-cache'),
    
    // Helper to get paths from Drag & Drop
    getFilePath: (file) => {
        try {
            return webUtils.getPathForFile(file);
        } catch (e) {
            console.warn("Could not retrieve path:", e);
            return null;
        }
    },

    // --- FIX: Returns a "Remove Listener" function ---
    onMainLog: (callback) => {
        // 1. Define the wrapper
        const subscription = (event, logObj) => callback(logObj);
        
        // 2. Start listening
        ipcRenderer.on('main-log', subscription);
        
        // 3. Return a function to STOP listening (Cleanup)
        return () => ipcRenderer.removeListener('main-log', subscription);
    }
});