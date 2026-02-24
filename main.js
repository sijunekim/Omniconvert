const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');

// --- NEW IMPORTS (SECURITY) ---
const { ingestFile } = require('./src/services/fileIngestion');
// ------------------------------

// Add this near your other requires
let secrets = {};
try {
    // We try to load the secrets. If the file is missing (e.g. on GitHub CI), it won't crash.
    secrets = require('./src/config/secrets');
} catch (e) {
    console.log('[Main] Notice: No secrets.js file found. Cloud features may fail.');
}


let mainWindow;
let serverProcess;
let isJobRunning = false;

// --- LOGGING BRIDGE (Send logs to React) ---
const originalLog = console.log;
console.log = (...args) => {
    // 1. Print to real terminal (VS Code)
    originalLog(...args);
    
    // 2. Send to React Window (if it exists)
    if (mainWindow && mainWindow.webContents) {
        const msg = args.map(a => String(a)).join(' ');
        // Use 24-hour time format
        const time = new Date().toISOString().split('T')[1].split('.')[0];
        
        mainWindow.webContents.send('main-log', { 
            level: 'INFO', 
            message: msg, 
            time: time 
        });
    }
};

const originalError = console.error;
console.error = (...args) => {
    originalError(...args);
    if (mainWindow && mainWindow.webContents) {
        const msg = args.map(a => String(a)).join(' ');
        const time = new Date().toISOString().split('T')[1].split('.')[0];
        mainWindow.webContents.send('main-log', { 
            level: 'ERROR', 
            message: msg, 
            time: time 
        });
    }
};
// -------------------------------------------

const logPath = path.join(app.getPath('desktop'), 'omniconvert-log.txt');
const logStream = fs.createWriteStream(logPath, { flags: 'w' });

function log(message) {
    if (logStream) logStream.write(`[Main] ${message}\n`);
    console.log(message);
}

function clearCache() {
    const userDataPath = app.getPath('userData');
    const uploadDir = path.join(userDataPath, 'secure_uploads');
    
    try {
        if (fs.existsSync(uploadDir)) {
            // Delete the folder and everything inside it
            fs.rmSync(uploadDir, { recursive: true, force: true });
            console.log('[Main] Cache cleared successfully.');
        }
    } catch (e) {
        console.error('[Main] Failed to clear cache:', e.message);
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        title: "OmniConvert",
        icon: path.join(__dirname, 'assets/icon.png'), 
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    if (app.isPackaged) {
        mainWindow.loadFile(path.join(__dirname, 'client/build/index.html'));
    } else {
        mainWindow.loadURL('http://localhost:3000');
    }

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        return { 
            action: 'allow', 
            overrideBrowserWindowOptions: {
                autoHideMenuBar: true,
                nodeIntegration: false,
                contextIsolation: true,
            }
        };
    });

    mainWindow.webContents.session.on('will-download', (event, item, webContents) => {
        item.once('done', (event, state) => {
            if (state === 'completed') {
                console.log('Download successfully');
            } else {
                console.log(`Download failed: ${state}`);
            }
        });
    });

    mainWindow.on('close', (e) => {
        if (isJobRunning) {
            const choice = dialog.showMessageBoxSync(mainWindow, {
                type: 'question',
                buttons: ['Quit Anyway', 'Cancel'],
                defaultId: 1,
                cancelId: 1,
                title: 'Conversion in Progress',
                message: 'A file is currently converting. If you quit now, the process will be lost.',
                detail: 'Do you really want to quit?'
            });

            if (choice === 1) {
                e.preventDefault();
            }
        }
    });

    mainWindow.on('closed', function () { mainWindow = null; });
}

// --- IPC HANDLERS ---

ipcMain.on('trigger-download', (event, url) => {
    if (mainWindow) {
        setImmediate(() => {
            mainWindow.webContents.downloadURL(url);
        });
    }
});

ipcMain.on('set-job-status', (event, isBusy) => {
    isJobRunning = isBusy;
});

// ---------------------------------------------------------
// 1. HANDLER FOR DRAG & DROP (The one that is missing)
// ---------------------------------------------------------
ipcMain.handle('process-file-upload', async (event, rawFilePath) => {
    try {
        console.log(`[Ingest] Processing file: ${rawFilePath}`);
        const userDataPath = app.getPath('userData');
        const uploadDir = path.join(userDataPath, 'secure_uploads');

        // Run the security check
        const safeFile = await ingestFile(rawFilePath, uploadDir);

        console.log(`[Ingest] File secured: ${safeFile.safePath}`);
        return { success: true, file: safeFile };

    } catch (error) {
        console.error(`[Ingest Error] ${error.message}`);
        return { success: false, error: error.message };
    }
});

// ---------------------------------------------------------
// 2. HANDLER FOR "FROM COMPUTER" BUTTON (The new one)
// ---------------------------------------------------------
ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        title: 'Select Files to Convert',
        buttonLabel: 'Select'
    });

    if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
    }

    const safeFiles = [];
    const errors = [];
    const userDataPath = app.getPath('userData');
    const uploadDir = path.join(userDataPath, 'secure_uploads');

    for (const rawPath of result.filePaths) {
        try {
            const safeFile = await ingestFile(rawPath, uploadDir);
            safeFiles.push(safeFile);
        } catch (err) {
            errors.push(`${path.basename(rawPath)}: ${err.message}`);
        }
    }

    return { 
        canceled: false, 
        files: safeFiles, 
        errors: errors 
    };
});

// --- DEV TOOLS HANDLERS ---

// 1. Open a folder in Finder/Explorer (For Dev Mode)

ipcMain.handle('open-path', async (event, target) => {
    const userDataPath = app.getPath('userData');
    let fullPath;

    if (target === 'sandbox') {
        fullPath = path.join(userDataPath, 'secure_uploads');
        // --- FIX: Create if missing ---
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        }
    } else if (target === 'logs') {
        fullPath = path.join(app.getPath('desktop'), 'omniconvert-log.txt');
        if (!fs.existsSync(fullPath)) return; // Don't crash if log is missing
        shell.showItemInFolder(fullPath);
        return;
    }

    await shell.openPath(fullPath);
});

// 2. Nuke Cache (Delete all temp files)
ipcMain.handle('nuke-cache', async () => {
    const userDataPath = app.getPath('userData');
    const uploadDir = path.join(userDataPath, 'secure_uploads');
    
    try {
        // Delete the folder
        await fs.promises.rm(uploadDir, { recursive: true, force: true });
        // Re-create it immediately so the app doesn't break
        await fs.promises.mkdir(uploadDir, { recursive: true });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

function startServer() {
    if (serverProcess) return;

    let serverPath;
    if (app.isPackaged) {
        serverPath = path.join(process.resourcesPath, 'server', 'server.js');
    } else {
        serverPath = path.join(__dirname, 'server', 'server.js');
    }
    
    log(`Starting server at: ${serverPath}`);

    const fixPath = process.platform === 'darwin' 
        ? '/opt/homebrew/bin:/usr/local/bin:' + process.env.PATH 
        : process.env.PATH;

    const writablePath = app.isPackaged ? app.getPath('userData') : __dirname;

    const env = { 
        ...process.env, 
        UNO_PATH: "/Applications/LibreOffice.app/Contents/MacOS/", 
        PORT: 5001,
        PATH: fixPath,
        WRITABLE_PATH: writablePath,

        // USE THE SECRETS HERE
        GOOGLE_CLIENT_ID: secrets.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: secrets.GOOGLE_CLIENT_SECRET
    };

    try {
        serverProcess = fork(serverPath, [], {
            env: env,
            stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        });

        serverProcess.stdout.on('data', (data) => log(`[Server] ${data}`));
        serverProcess.stderr.on('data', (data) => log(`[Server ERR] ${data}`));
        serverProcess.on('error', (err) => log(`Server Spawn Error: ${err.message}`));
        serverProcess.on('exit', (code) => {
            log(`Server exited with code ${code}`);
            serverProcess = null;
        });

    } catch (e) {
        log(`CRITICAL ERROR: ${e.message}`);
    }
}

app.on('ready', () => {
    // 1. Clean up old files from previous runs
    clearCache();

    // 2. Start the backend
    startServer();
    
    // 3. Open the UI
    setTimeout(createWindow, 2000);
});

app.on('window-all-closed', function () {
    clearCache(); // <--- Add this
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    if (serverProcess) {
        serverProcess.kill();
    }
});

app.on('activate', function () {
    if (mainWindow === null) createWindow();
});