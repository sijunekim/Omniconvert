const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron'); // Added dialog
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');

let mainWindow;
let serverProcess;
let isJobRunning = false; // NEW: Track if React is busy

const logPath = path.join(app.getPath('desktop'), 'omniconvert-log.txt');
const logStream = fs.createWriteStream(logPath, { flags: 'w' });

function log(message) {
    if (logStream) logStream.write(`[Main] ${message}\n`);
    console.log(message);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        title: "OmniConvert",
        // --- ADD THIS LINE ---
        // We use the png or ico for the window frame
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

    // --- NEW: Prevent accidental closing ---
    mainWindow.on('close', (e) => {
        if (isJobRunning) {
            // Show a dialog box
            const choice = dialog.showMessageBoxSync(mainWindow, {
                type: 'question',
                buttons: ['Quit Anyway', 'Cancel'],
                defaultId: 1,
                cancelId: 1,
                title: 'Conversion in Progress',
                message: 'A file is currently converting. If you quit now, the process will be lost.',
                detail: 'Do you really want to quit?'
            });

            // If user clicked 'Cancel' (index 1), stop the window from closing
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

// NEW: Receive status from React
ipcMain.on('set-job-status', (event, isBusy) => {
    isJobRunning = isBusy;
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
        WRITABLE_PATH: writablePath
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
    startServer();
    setTimeout(createWindow, 2000);
});

app.on('window-all-closed', function () {
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