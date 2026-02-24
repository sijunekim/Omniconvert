console.log("🔥 I AM THE NEW CODE - VERSION 9001 🔥");
const { scanArchive } = require('./services/archiveScanner');
const { runSelfTest } = require('./services/selfTest');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const { google } = require('googleapis');
const crypto = require('crypto');
const sharp = require('sharp');
const libre = require('libreoffice-convert');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const util = require('util');
const cors = require('cors');
const archiver = require('archiver');
const PDFDocument = require('pdfkit');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const sanitize = require('sanitize-filename');
const { runSafeJob } = require('./processRunner');
const { pathToFileURL } = require('url'); // <--- ADD THIS


// --- DIRECTORY SETUP ---
const BASE_DIR = process.env.WRITABLE_PATH || __dirname;
const UPLOADS_DIR = path.join(BASE_DIR, 'uploads');
const CONVERTED_DIR = path.join(BASE_DIR, 'converted');
const TOKENS_PATH = path.join(BASE_DIR, 'tokens.json'); // <-- Token storage

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(CONVERTED_DIR)) fs.mkdirSync(CONVERTED_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const port = 5001;

console.log("📍 SERVER IS WRITING FILES HERE:", BASE_DIR);

// --- PERSISTENCE HELPERS ---
function saveTokens(tokens) {
    try {
        console.log("Saving tokens specifically to:", path.resolve(TOKENS_PATH));
        fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens));
        console.log('[AUTH] Tokens saved to disk.');
    } catch (e) {
        console.error('[AUTH] Failed to save tokens:', e.message);
    }
}

function loadTokens() {
    console.log(`[AUTH] Looking for tokens at: ${TOKENS_PATH}`);
    if (fs.existsSync(TOKENS_PATH)) {
        try {
            const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH));
            oauth2Client.setCredentials(tokens);
            console.log('[AUTH] Tokens loaded successfully. User is logged in.');
            return true;
        } catch (e) {
            console.error('[AUTH] Corrupted token file. Deleting it.', e.message);
            fs.unlinkSync(TOKENS_PATH); // Delete bad file so user can re-login
        }
    } else {
        console.log('[AUTH] No tokens found. User must log in.');
    }
    return false;
}

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET
);


// Load tokens on startup
loadTokens();

app.use(cors({ origin: true, credentials: true, exposedHeaders: ['Content-Disposition'] }));

const upload = multer({ dest: UPLOADS_DIR });
const wss = new WebSocket.Server({ noServer: true });

// --- LOGGING INTERCEPTOR ---
const logBuffer = []; // Store history here (The new part)

const broadcastLog = (level, args) => {
    // Convert all arguments to a single string
    const msg = args.map(arg => {
        if (typeof arg === 'object') {
            try { return JSON.stringify(arg); } catch(e) { return '[Object]'; }
        }
        return String(arg);
    }).join(' ');

    // Use 24-Hour Time format
    const now = new Date();
    const timeString = now.toISOString().split('T')[1].split('.')[0]; 
    
    const logObj = { level, message: msg, time: timeString };

    // 1. Save to History (Limit to 100 lines)
    logBuffer.push(logObj);
    if (logBuffer.length > 100) logBuffer.shift();

    // 2. Broadcast to active clients
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'SERVER_LOG', payload: logObj }));
        }
    });
};

const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => { originalLog(...args); broadcastLog('INFO', args); };
console.error = (...args) => { originalError(...args); broadcastLog('ERROR', args); };


const tokenStore = {}; // Temp store for handshake

const CATEGORIES = {
    // Standard & Web Images
    IMAGE: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.ico', '.tiff', '.tga', '.jp2', '.heic'],
    // Professional/Raw Photos
    RAW_IMAGE: ['.cr2', '.nef', '.arw', '.orf', '.raf', '.dng', '.rw2', '.sr2', '.pef', '.crw', '.erf'],
    // Vector Graphics (New!)
    VECTOR: ['.svg', '.eps', '.ai'],
    // Documents
    DOCUMENT: ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.ods', '.odp', '.rtf', '.txt', '.html', '.xml', '.csv', '.pages', '.numbers', '.key'],
    // Video
    VIDEO: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.3g2', '.ts', '.mts', '.m2ts', '.vob', '.ogv', '.m4a', '.m4r'],
    // Audio
    AUDIO: ['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg', '.wma', '.aiff', '.alac', '.opus', '.amr', '.m4r'],
    // Archives
    ARCHIVE: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso'],
    // eBooks
    EBOOK: ['.epub', '.mobi', '.azw3', '.fb2', '.lit', '.lrf', '.pdb', '.rb', '.tcr'],
    // 3D Models
    MODEL_3D: ['.obj', '.stl', '.fbx', '.dae', '.ply', '.glb', '.gltf', '.3ds', '.blend', '.x'],
};

const SUPPORTED_OUTPUTS = {
    IMAGE:  ['jpg', 'png', 'webp', 'gif', 'bmp', 'ico', 'tiff', 'tga', 'pdf'],
    RAW_IMAGE: ['jpg', 'png', 'tiff', 'webp'],
    VECTOR: ['png', 'jpg', 'pdf', 'svg'],
    DOCUMENT: ['pdf', 'docx', 'txt', 'html', 'rtf', 'jpg', 'png'],
    VIDEO:  ['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'gif', 'mp3', 'wav', 'flac'],
    AUDIO:  ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'wma', 'aiff', 'm4r', 'opus', 'm4a', 'm4r'],
    ARCHIVE: ['extract', 'zip'],
    EBOOK:  ['pdf', 'epub', 'mobi', 'docx', 'txt', 'azw3'],
    MODEL_3D: ['obj', 'stl', 'ply', 'glb', 'gltf'],
};
function getFileCategory(extension) { for (const category in CATEGORIES) { if (CATEGORIES[category].includes(extension)) return category; } return 'UNSUPPORTED'; }

app.get('/auth/google', (req, res) => {
    const uniqueId = crypto.randomBytes(16).toString('hex');
    oauth2Client.redirectUri = 'http://localhost:5001/auth/google/callback';
    const scopes = ['https://www.googleapis.com/auth/drive.readonly'];
    
    // --- FIX: ADD prompt: 'consent' ---
    const url = oauth2Client.generateAuthUrl({ 
        access_type: 'offline', 
        scope: scopes, 
        state: uniqueId,
        prompt: 'consent' // <--- THIS IS THE KEY TO STAYING LOGGED IN
    });
    
    res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
    console.log("🔎 [AUTH] Google Callback Triggered!");
    const { code, state } = req.query;
    
    if (!code) {
        console.error("❌ [AUTH] No code received from Google.");
        return res.send('Error: No code received');
    }

    try {
        console.log("⏳ [AUTH] Exchanging code for tokens...");
        const { tokens } = await oauth2Client.getToken(code);
        
        console.log("✅ [AUTH] Tokens received from Google!");
        console.log("🔑 [AUTH] Access Token present?", !!tokens.access_token);
        console.log("🔄 [AUTH] Refresh Token present?", !!tokens.refresh_token);

        oauth2Client.setCredentials(tokens); // Set in memory
        
        // This calls the save function you added earlier
        saveTokens(tokens); 
        
        tokenStore[state] = tokens; // Store for frontend handshake
        
        console.log("🚀 [AUTH] Sending success message to popup...");
        res.send(`<script>window.opener.postMessage({ type: "google_auth_success", tokenId: "${state}" }, "*"); window.close();</script>`);
    
    } catch (error) {
        console.error("🔥 [AUTH] CRASH inside callback:", error.message);
        res.send('<script>window.opener.postMessage({ type: "google_auth_error" }, "*"); window.close();</script>');
    }
});

app.post('/upload', upload.array('files'), (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded.' });
    const fileData = req.files.map(file => ({ originalName: file.originalname, path: file.path }));
    res.status(200).json({ files: fileData });
});

app.get('/download/:filename', (req, res) => {
    const { filename } = req.params;
    const filePath = path.join(CONVERTED_DIR, filename);
    res.download(filePath, filename, (err) => {
        if (err) console.error(`[DOWNLOAD ERROR]`, err);
    });
});

app.get('/download-extracted', (req, res) => {
    const { sessionId, file } = req.query;
    if (!sessionId || !file) return res.status(400).send('Missing session or file information.');
    const safeSessionId = sanitize(sessionId);
    const safeFilePath = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(UPLOADS_DIR, safeSessionId, safeFilePath);
    res.download(fullPath, path.basename(fullPath), (err) => {
        if (err && !res.headersSent) res.status(404).send('File not found or session expired.');
    });
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', async (ws, req) => {
    console.log('[WSS] Client connected');

    // Send previous logs so the terminal isn't empty on reload
    ws.send(JSON.stringify({ type: 'LOG_HISTORY', payload: logBuffer }));

    // 1. Send System Health (Existing)
    const healthReport = await runSelfTest();
    ws.send(JSON.stringify({ 
        type: 'SYSTEM_HEALTH', 
        payload: healthReport 
    }));

    // 2. Send Auth Status IMMEDIATELY (New Fix)
    // Check if we have valid credentials loaded in memory
    const creds = oauth2Client.credentials;
    const hasCreds = creds && Object.keys(creds).length > 0;
    
    // Validate them (Optional: simple check for now to make UI snappy)
    const isLoggedIn = hasCreds; // You can add a deeper check if needed later
    
    console.log(`[WSS] Auto-sending Auth Status: ${isLoggedIn ? 'LOGGED IN' : 'LOGGED OUT'}`);
    
    ws.send(JSON.stringify({ 
        type: 'GOOGLE_AUTH_STATUS', 
        payload: { isLoggedIn: isLoggedIn } 
    }));

    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        const { tokenId } = data;
        
        // --- AUTH CHECK ---
        const sendProgress = (progress) => ws.send(JSON.stringify({ type: 'PROGRESS', payload: { progress } }));
        const sendError = (errorMessage) => ws.send(JSON.stringify({ type: 'ERROR', payload: { message: errorMessage } }));

        try {
            if (data.type === 'CHECK_GOOGLE_AUTH') {
                console.log("------------------------------------------------");
                console.log("🕵️‍♂️ [AUTH CHECK] Frontend asked: Am I logged in?");
                
                // 1. Check Memory
                const creds = oauth2Client.credentials;
                if (!creds || Object.keys(creds).length === 0) {
                    console.log("❌ [AUTH CHECK] No credentials in memory.");
                    ws.send(JSON.stringify({ type: 'GOOGLE_AUTH_STATUS', payload: { isLoggedIn: false } }));
                    return;
                }

                console.log("✅ [AUTH CHECK] Credentials found in memory.");

                // 2. Validate Token with Google
                try {
                    console.log("⏳ [AUTH CHECK] Verifying validity with Google...");
                    // This checks if the token is alive and refreshes it if needed
                    const res = await oauth2Client.getAccessToken();
                    
                    if (res && res.token) {
                        console.log("🚀 [AUTH CHECK] Token is VALID! Sending 'true' to client.");
                        ws.send(JSON.stringify({ type: 'GOOGLE_AUTH_STATUS', payload: { isLoggedIn: true } }));
                    } else {
                        console.log("⚠️ [AUTH CHECK] Token refresh returned no token.");
                        ws.send(JSON.stringify({ type: 'GOOGLE_AUTH_STATUS', payload: { isLoggedIn: false } }));
                    }
                } catch (e) {
                    console.log("🔥 [AUTH CHECK] Token validation FAILED:", e.message);
                    console.log("🗑️ [AUTH CHECK] Deleting bad token file to force re-login.");
                    // Optional: Delete the bad file so we don't get stuck in a loop
                    if (fs.existsSync(TOKENS_PATH)) fs.unlinkSync(TOKENS_PATH);
                    oauth2Client.setCredentials({});
                    
                    ws.send(JSON.stringify({ type: 'GOOGLE_AUTH_STATUS', payload: { isLoggedIn: false } }));
                }
                console.log("------------------------------------------------");
                return;
            }

            if (data.type === 'LOGOUT_GOOGLE') {
                oauth2Client.setCredentials({});
                if (fs.existsSync(TOKENS_PATH)) fs.unlinkSync(TOKENS_PATH);
                ws.send(JSON.stringify({ type: 'GOOGLE_AUTH_STATUS', payload: { isLoggedIn: false } }));
                return;
            }

            // Ensure authentication for Drive actions
            if (['LIST_DRIVE_FILES', 'CONVERT_DRIVE_FILE'].includes(data.type)) {
                try { await oauth2Client.getAccessToken(); } 
                catch (e) { return sendError('Not authenticated with Google.'); }
            }

            if (data.type === 'LIST_DRIVE_FILES') {
                const drive = google.drive({ version: 'v3', auth: oauth2Client });
                const { searchTerm } = data.payload;
                let query = "trashed = false and mimeType != 'application/vnd.google-apps.folder'";
                if (searchTerm) query += ` and name contains '${searchTerm.replace(/'/g, "\\'")}'`;
                const response = await drive.files.list({ pageSize: 50, fields: 'files(id, name, size, modifiedTime, iconLink, mimeType)', q: query, orderBy: 'modifiedTime desc' });
                const files = response.data.files.map(file => ({ id: file.id, name: file.name, size: file.size ? `${(parseInt(file.size) / 1024 / 1024).toFixed(2)} MB` : '', modifiedTime: new Date(file.modifiedTime).toLocaleDateString(), iconLink: file.iconLink, mimeType: file.mimeType }));
                ws.send(JSON.stringify({ type: 'DRIVE_FILES_LIST', payload: { files } }));
                return;
            }

            if (data.type === 'CONVERT_DRIVE_FILE') {
                const drive = google.drive({ version: 'v3', auth: oauth2Client });
                const { file, settings } = data.payload;
                
                // Use UUID for storage to prevent filename issues
                const safeExt = (file.mimeType && file.mimeType.startsWith('application/vnd')) ? '.pdf' : path.extname(file.name) || '';
                const tempFileName = `cloud_${crypto.randomUUID()}${safeExt}`;
                const tempFilePath = path.join(UPLOADS_DIR, tempFileName);
                
                const dest = fs.createWriteStream(tempFilePath);
                
                // --- NEW: DOWNLOAD PROGRESS TIMER ---
                // Simulates progress from 0% to 30% while downloading
                let downloadPercent = 0;
                const downloadTimer = setInterval(() => {
                    if (downloadPercent < 30) {
                        downloadPercent += 5;
                        sendProgress(downloadPercent);
                    }
                }, 500);

                try {
                    let res;
                    if (file.mimeType && file.mimeType.startsWith('application/vnd.google-apps')) {
                        res = await drive.files.export({ fileId: file.id, mimeType: 'application/pdf' }, { responseType: 'stream' });
                    } else {
                        res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'stream' });
                    }

                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => { 
                            res.data.destroy(); 
                            dest.destroy(); 
                            reject(new Error("Download timeout")); 
                        }, 120000);
                        
                        res.data
                            .on('error', reject)
                            .on('end', () => { 
                                clearTimeout(timeout); 
                                resolve(); 
                            })
                            .pipe(dest);
                            
                        dest.on('error', reject);
                    });

                    // Download complete! Stop timer and prep for conversion.
                    clearInterval(downloadTimer);
                    
                    // --- FIX: Ensure extension exists for proper categorization ---
                    // If file name is "Report" but mime is pdf, make it "Report.pdf"
                    let finalName = file.name;
                    if (file.mimeType.startsWith('application/vnd') && !finalName.toLowerCase().endsWith('.pdf')) {
                        finalName += '.pdf';
                    } else if (!path.extname(finalName)) {
                        // Fallback for extensionless files
                        finalName += safeExt; 
                    }

                    data.type = 'CONVERT';
                    data.payload.files = [{ 
                        path: tempFilePath, 
                        originalName: finalName
                    }];
                    data.payload.settings = settings;

                } catch(e) { 
                    clearInterval(downloadTimer);
                    return sendError('Download Failed: ' + e.message); 
                }
            }

            if (data.type === 'CONVERT') {
                const { files, outputFormat, settings } = data.payload;

                const sessionId = `session_${Date.now()}`;
                const tempOutputDir = path.join(UPLOADS_DIR, sessionId);

                console.log('[Debug] Server received files:', JSON.stringify(files, null, 2));

                const sendProgress = (p) =>
                    ws.send(JSON.stringify({ type: 'PROGRESS', payload: { progress: p } }));

                try {
                    await fsp.mkdir(tempOutputDir, { recursive: true });

                    const results = [];
                    const conversionErrors = [];
                    let extractedCount = 0;

                    for (let i = 0; i < files.length; i++) {
                        const file = files[i];

                        const originalName = file.name || file.originalName || file.originalname || 'unknown_file';
                        
                        if (!file.path) throw new Error(`File path missing for ${originalName}`);

                        const ext = path.extname(originalName).toLowerCase(); 
                        const category = getFileCategory(ext);

                        // --- FIX: SAFE INTERMEDIATE NAMING ---
                        // 1. Calculate the "Pretty" name we want at the end
                        let prettyName = sanitize(path.parse(originalName).name);
                        if (!prettyName || prettyName.replace(/\./g, '').trim().length === 0) {
                            prettyName = `file_${Date.now()}_${i}`;
                        }
                        
                        // 2. Define a "Safe" name for the tool to use (No brackets, no spaces, no unicode)
                        // This prevents ImageMagick from getting confused by '[' or ']'
                        const tempSafeName = `process_temp_${Date.now()}_${i}.${outputFormat}`;
                        const tempOutputPath = path.join(tempOutputDir, tempSafeName);
                        
                        // 3. Define the Final path (where we rename it to later)
                        const finalOutputPath = path.join(tempOutputDir, `${prettyName}.${outputFormat}`);
                        // -------------------------------------

                        console.log(`[Processing] ${originalName} -> ${tempSafeName}`);

                        try {
                            console.log('[DEBUG]', originalName, 'Category:', category, 'Ext:', ext, 'Output:', outputFormat);
                            

                            /* ================= IMAGE ================= */
                            if (category === 'IMAGE') {
                                // 1. Determine if we must use ImageMagick
                                // We use Magick for:
                                // - HEIC (Complex format, Magick handles it better than Sharp)
                                // - PDF/ICO/TIFF (Formats Sharp handles poorly or not at all)
                                const isHeic = ext === '.heic' || ext === '.heif';
                                const complexFormats = ['bmp', 'ico', 'tiff', 'tga', 'pdf'];
                                
                                const useMagick = isHeic || complexFormats.includes(outputFormat);

                                if (ext === '.pdf' && outputFormat === 'html') {
                                    throw new Error('PDF to HTML must be handled in DOCUMENT pipeline only.');
                                }


                                if (useMagick) {
                                    const args = [file.path];

                                    if (outputFormat === 'ico') {
                                        args.push('-resize', '256x256>');
                                    }

                                    args.push(tempOutputPath);
                                    
                                    // HEIC conversion can be slow, give it 60 seconds
                                    await runSafeJob('magick', args, { timeoutMs: 60000 });
                                } else {
                                    // Use Sharp for standard, fast conversions (JPG, PNG, WebP)
                                    await sharp(file.path)
                                        .toFormat(outputFormat)
                                        .toFile(tempOutputPath); // Was outputPath
                                }
                            }

                            /* ================= VECTOR ================= */
                            else if (category === 'VECTOR') {
                                // Was: outputPath
                                await runSafeJob('magick', [file.path, tempOutputPath]);
                            }

                            /* ================= RAW IMAGE ================= */
                            else if (category === 'RAW_IMAGE') {
                                const { spawn } = require('child_process');

                                await new Promise((resolve, reject) => {
                                    const dcraw = spawn(
                                        'dcraw',
                                        ['-c', '-w', '-T', file.path],
                                        { stdio: ['ignore', 'pipe', 'pipe'] }
                                    );

                                    // Was: outputPath
                                    const magick = spawn(
                                        'magick',
                                        ['-', tempOutputPath], 
                                        { stdio: ['pipe', 'ignore', 'pipe'] }
                                    );

                                    dcraw.stdout.pipe(magick.stdin);
                                    dcraw.on('error', reject);
                                    magick.on('error', reject);
                                    magick.on('close', (code) =>
                                        code === 0 ? resolve() : reject(new Error(`RAW conversion failed (${code})`))
                                    );
                                });
                            }

                            /* ================= DOCUMENT (Final Fixed Version) ================= */
                            else if (category === 'DOCUMENT') {
                                const isTextSource = ['.txt', '.md', '.html', '.htm', '.rtf'].includes(ext);
                                const isImageOutput = ['jpg', 'png', 'bmp', 'tiff'].includes(outputFormat);
                                const isPdfSource = ext === '.pdf';

                                // --- UNIVERSAL PROGRESS TIMER ---
                                let currentFakeProgress = 0;
                                sendProgress(Math.round(((i * 100) + 1) / files.length)); 

                                const progressTimer = setInterval(() => {
                                    if (currentFakeProgress < 95) {
                                        currentFakeProgress += 2;
                                        const total = ((i * 100) + currentFakeProgress) / files.length;
                                        sendProgress(Math.round(total));
                                    }
                                }, 250);

                                // 1. PREPARE CLEAN ROOM
                                const jobDir = path.join(tempOutputDir, `job_${i}_${Date.now()}`);
                                await fsp.mkdir(jobDir);
                                
                                const safeInputName = `source${ext}`;
                                const safeInputPath = path.join(jobDir, safeInputName);
                                const expectedOutputName = `output.${outputFormat}`;
                                const expectedOutputPath = path.join(jobDir, expectedOutputName);

                                try {
                                    await fsp.copyFile(file.path, safeInputPath);

                                    // --- CASE 0: SAME FORMAT (Passthrough) ---
                                    // If input is PDF and output is PDF (common for Google Sheets), just copy it.
                                    if (ext === `.${outputFormat}` || (isPdfSource && outputFormat === 'pdf')) {
                                        console.log(`[Passthrough] Input is already ${outputFormat}, skipping conversion tool.`);
                                        await fsp.copyFile(safeInputPath, expectedOutputPath);
                                    }

                                    // --- CASE 1: PDF -> IMAGE ---
                                    if (isPdfSource && isImageOutput) {
                                        await runSafeJob('magick', [
                                            '-density', '150',          
                                            'source.pdf[0]',            
                                            '-background', 'white',     
                                            '-alpha', 'remove', '-alpha', 'off',
                                            '-quality', '100',          
                                            expectedOutputName 
                                        ], { cwd: jobDir });
                                    }

                                    // --- CASE 2: TEXT/HTML -> IMAGE ---
                                    else if (isTextSource && isImageOutput) {
                                        const sofficePath = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
                                        const profileDir = path.join(jobDir, 'user_profile');
                                        const profileUri = require('url').pathToFileURL(profileDir).href;

                                        await runSafeJob(sofficePath, [
                                            `-env:UserInstallation=${profileUri}`,
                                            '--headless', '--norestore',
                                            '--convert-to', 'pdf', 
                                            '--outdir', '.', 
                                            safeInputName
                                        ], { timeoutMs: 180000, cwd: jobDir });

                                        const files = await fsp.readdir(jobDir);
                                        const pdf = files.find(f => f.endsWith('.pdf') && f !== safeInputName) || safeInputName;
                                        
                                        await runSafeJob('magick', [
                                            '-density', '150', 
                                            `${pdf}[0]`, 
                                            '-background', 'white', '-alpha', 'remove', '-alpha', 'off', 
                                            '-quality', '100', 
                                            expectedOutputName
                                        ], { cwd: jobDir });
                                    }

                                    // --- CASE 3: TEXT -> TEXT (Skip if output is PDF) ---
                                    else if (isTextSource && outputFormat !== 'pdf') {
                                        await runSafeJob('pandoc', [safeInputName, '-o', expectedOutputName], { cwd: jobDir });
                                    }

                                    // --- CASE 4: PDF -> HTML (Specific Handler) ---
                                    else if (isPdfSource && outputFormat === 'html') {
                                        const sofficePath = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
                                        const profileDir = path.join(jobDir, 'user_profile');
                                        const profileUri = require('url').pathToFileURL(profileDir).href;

                                        await runSafeJob(sofficePath, [
                                            `-env:UserInstallation=${profileUri}`,
                                            '--headless', '--norestore',
                                            '--infilter=writer_pdf_import',
                                            '--convert-to', 'html:XHTML Writer File:UTF8',
                                            '--outdir', '.',
                                            safeInputName
                                        ], { timeoutMs: 180000, cwd: jobDir });

                                        // Try to find the HTML immediately
                                        const allFiles = await fsp.readdir(jobDir);
                                        const htmlFile = allFiles.find(f => f.toLowerCase().endsWith('.html'));
                                        if (htmlFile) {
                                            await fsp.rename(path.join(jobDir, htmlFile), tempOutputPath);
                                        }
                                    }

                                    // --- CASE 5: OFFICE/GENERIC (LibreOffice) ---
                                    else {
                                        const sofficePath = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
                                        const profileDir = path.join(jobDir, 'user_profile');
                                        const profileUri = require('url').pathToFileURL(profileDir).href;
                                        
                                        await runSafeJob(sofficePath, [
                                            `-env:UserInstallation=${profileUri}`,
                                            '--headless', '--norestore',
                                            '--convert-to', outputFormat,
                                            '--outdir', '.', 
                                            safeInputName
                                        ], { timeoutMs: 180000, cwd: jobDir });
                                    }

                                    // --- 3. FINAL GRABBER (The part that was failing) ---
                                    // Only run if we haven't already moved the file (like in Case 4)
                                    if (!fs.existsSync(tempOutputPath)) {
                                        
                                        // Strategy A: Check for exact expected name
                                        if (fs.existsSync(expectedOutputPath)) {
                                            await fsp.rename(expectedOutputPath, tempOutputPath);
                                        } 
                                        else {
                                            // Strategy B: Scan folder for ANY result file
                                            const allFiles = await fsp.readdir(jobDir);
                                            
                                            const resultFile = allFiles.find(f => 
                                                f !== safeInputName &&             // Not the input
                                                !f.startsWith('user_profile') &&   // Not the profile folder
                                                // I REMOVED THE PDF FILTER HERE. IT WILL NOW FIND source.pdf
                                                f.toLowerCase().endsWith(`.${outputFormat}`)
                                            );

                                            if (resultFile) {
                                                await fsp.rename(path.join(jobDir, resultFile), tempOutputPath);
                                            } else {
                                                // Strategy C: Check for Magick suffix (output-0.jpg)
                                                const fallback = allFiles.find(f => f.includes(`-0.${outputFormat}`));
                                                if (fallback) {
                                                    await fsp.rename(path.join(jobDir, fallback), tempOutputPath);
                                                } else {
                                                    console.log(`[Job Failed] Dir content: ${JSON.stringify(allFiles)}`);
                                                    throw new Error(`Output missing in Clean Room.`);
                                                }
                                            }
                                        }
                                    }

                                    // --- BONUS CLEANUP ---
                                    if (outputFormat === 'html') {
                                        const allFiles = await fsp.readdir(jobDir);
                                        for (const file of allFiles) {
                                            if (file.endsWith('_files')) {
                                                await fsp.rm(path.join(jobDir, file), { recursive: true, force: true }).catch(()=>{});
                                            }
                                        }
                                    }

                                } finally {
                                    clearInterval(progressTimer);
                                    await fsp.rm(jobDir, { recursive: true, force: true }).catch(()=>{});
                                }
                            }


                            /* ================= VIDEO / AUDIO (Fixed) ================= */
                            else if (category === 'VIDEO' || category === 'AUDIO') {
                                // ---- Enforce output compatibility ----
                                const allowedOutputs = SUPPORTED_OUTPUTS[category];
                                if (!allowedOutputs || !allowedOutputs.includes(outputFormat)) {
                                    // Soft fallback: if audio is requested from video, allow it
                                    if (category === 'VIDEO' && SUPPORTED_OUTPUTS.AUDIO.includes(outputFormat)) {
                                        // Allowed (Video -> Audio extraction)
                                    } else {
                                         throw new Error(`${outputFormat} is not supported for ${category}`);
                                    }
                                }

                                await new Promise((resolve, reject) => {
                                    let cmd = ffmpeg(file.path);

                                    /* ---------- VIDEO → AUDIO ---------- */
                                    const isAudioOutput = SUPPORTED_OUTPUTS.AUDIO.includes(outputFormat);
                                    if (category === 'VIDEO' && isAudioOutput) {
                                        cmd = cmd.noVideo();
                                    }

                                    /* ---------- VIDEO-ONLY CONTROLS ---------- */
                                    if (category === 'VIDEO') {
                                        if (settings?.resolution && settings.resolution !== 'original') {
                                            cmd = cmd.size(settings.resolution);
                                        }
                                    }

                                    /* ---------- AUDIO CONTROLS ---------- */
                                    if (settings?.audioBitrate && settings.audioBitrate !== 'original') {
                                        cmd = cmd.audioBitrate(settings.audioBitrate);
                                    }

                                    /* ---------- FIX: M4A / M4R MAPPING ---------- */
                                    // This is the part that was missing in your paste!
                                    if (outputFormat === 'm4a' || outputFormat === 'm4r') {
                                        cmd.format('ipod'); 
                                        cmd.audioCodec('aac');
                                        if (outputFormat === 'm4r') cmd.audioBitrate('128k');
                                    } else {
                                        // For standard formats (mp4, mp3, avi), use the name directly
                                        cmd.toFormat(outputFormat);
                                    }

                                    /* ---------- HARD TIMEOUT ---------- */
                                    const timeout = setTimeout(() => {
                                        cmd.kill('SIGKILL');
                                        reject(new Error('FFmpeg timed out'));
                                    }, 5 * 60 * 1000); // 5 minutes

                                    /* ---------- EXECUTE ---------- */
                                    cmd
                                        .on('progress', (progress) => {
                                            if (progress.percent) {
                                                const currentFilePercent = progress.percent;
                                                const totalProgress = ((i * 100) + currentFilePercent) / files.length;
                                                sendProgress(Math.round(totalProgress));
                                            }
                                        })
                                        .on('error', (err) => {
                                            clearTimeout(timeout);
                                            // Handle "output is empty" bug (common with some formats)
                                            if (fs.existsSync(tempOutputPath) && fs.statSync(tempOutputPath).size > 0) {
                                                resolve();
                                            } else {
                                                reject(err);
                                            }
                                        })
                                        .on('end', () => {
                                            clearTimeout(timeout);
                                            resolve();
                                        })
                                        .save(tempOutputPath);
                                });
                            }
                            /* ================= EBOOK ================= */
                            else if (category === 'EBOOK') {
                                const calibrePath = '/Applications/calibre.app/Contents/MacOS/ebook-convert';
                                // Was: outputPath
                                await runSafeJob(calibrePath, [file.path, tempOutputPath]);
                            }

                            /* ================= 3D MODEL ================= */
                            else if (category === 'MODEL_3D') {
                                // Was: outputPath
                                await runSafeJob('assimp', ['export', file.path, tempOutputPath]);
                            }

                            /* ================= ARCHIVE (New Secure Block) ================= */
                            else if (category === 'ARCHIVE') {
                                if (outputFormat === 'extract') {
                                    console.log(`[Security] Scanning archive: ${originalName}`);

                                    // 1. SCAN FIRST (Anti-Zip Bomb)
                                    // 'scanArchive' throws an error if the file is dangerous.
                                    // Currently supports .zip. We skip scan for others (or add parsers later).
                                    if (ext === '.zip') {
                                        await scanArchive(file.path);
                                    }

                                    // 2. PREPARE EXTRACTION
                                    // We create a specific folder for this extraction
                                    const extractDir = path.join(tempOutputDir, 'extracted');
                                    await fsp.mkdir(extractDir);

                                    // 3. RUN UNAR (Sandboxed)
                                    await runSafeJob('unar', [
                                        '-o', extractDir, // Output directory
                                        '-f',             // Force overwrite
                                        '-no-directory',  // Don't create an extra folder inside
                                        '-p', '',         // Try with empty password (avoids hanging on prompts)
                                        file.path
                                    ]);

                                    // 4. HANDLING RESULTS
                                    // Extraction is special. The frontend expects a list of files to browse,
                                    // not a single download link.
                                    const extractedFiles = await fsp.readdir(extractDir);
                                    
                                    // Send the special "EXTRACT_COMPLETE" message to React
                                    ws.send(JSON.stringify({
                                        type: 'EXTRACT_COMPLETE',
                                        payload: { 
                                            fileList: extractedFiles,
                                            sessionId: sessionId 
                                        }
                                    }));

                                    // We use 'continue' here because we successfully handled this file
                                    // and we don't want the standard "Zip the results" logic at the bottom to run.
                                    extractedCount++;
                                    continue;
                                }
                            }

                            else {
                                throw new Error(`Unsupported category: ${category} (ext: ${ext})`);
                            }

                            // --- FIX: RENAME TO PRETTY NAME ---
                            if (fs.existsSync(tempOutputPath)) {
                                // Rename "temp_123.jpg" -> "My Cool File [Final].jpg"
                                await fsp.rename(tempOutputPath, finalOutputPath);
                                results.push(finalOutputPath);
                            } else {
                                throw new Error(`Tool finished but output missing: ${tempOutputPath}`);
                            }

                        } catch (err) {
                            console.error(`[CONVERT FAILED] ${originalName}:`, err.message);
                            
                            // --- NEW: Log the Tool's StdErr (The real error) ---
                            if (err.stderr) {
                                console.error(`[TOOL OUTPUT]`, err.stderr);
                                console.error('[STDERR]', err.stderr);

                            }
                            // ---------------------------------------------------

                            conversionErrors.push(err.message);
                        }

                        sendProgress(Math.round(((i + 1) / files.length) * 100));
                    }

                    // If we have no results AND no extractions, then it failed.
                    if (!results.length && extractedCount === 0) {
                        // If we have specific errors, show the first one to the user
                        if (conversionErrors.length > 0) {
                            throw new Error(conversionErrors[0]); 
                        }
                        throw new Error('No files could be converted.');
                    }

                    // If we only did extraction, stop here (don't try to zip a folder)
                    if (results.length === 0 && extractedCount > 0) return;

                    let finalName;
                    if (results.length === 1) {
                        finalName = path.basename(results[0]);
                        await fsp.rename(results[0], path.join(CONVERTED_DIR, finalName));
                    } else {
                        finalName = `OmniConvert_${sessionId}.zip`;
                        const zipPath = path.join(CONVERTED_DIR, finalName);

                        await new Promise((resolve, reject) => {
                            const output = fs.createWriteStream(zipPath);
                            const archive = archiver('zip');

                            archive.pipe(output);
                            archive.on('error', reject);
                            output.on('close', resolve);

                            results.forEach(p =>
                                archive.file(p, { name: path.basename(p) })
                            );

                            archive.finalize();
                        });
                    }

                    ws.send(JSON.stringify({
                        type: 'COMPLETE',
                        payload: { downloadUrl: `/download/${encodeURIComponent(finalName)}` }
                    }));

                } catch (err) {
                    console.error('[JOB ERROR]', err);
                    ws.send(JSON.stringify({
                        type: 'ERROR',
                        payload: { message: err.message }
                    }));
                } finally {
                    // Cleanup
                    await fsp.rm(tempOutputDir, { recursive: true, force: true }).catch(() => {});
                    // Note: We don't delete the secure_uploads source file here to allow re-runs.
                    // The main process cleans that up on restart.
                }
            }

        } catch (error) {
            console.error('[WEBSOCKET ERROR]', error);
            sendError('An unexpected server error occurred.');
        }
    });
    ws.on('close', () => console.log('[WSS] Client disconnected.'));
});

try {
    fs.accessSync(BASE_DIR, fs.constants.W_OK);
    console.log('[TEST] Write permission confirmed.');
} catch (e) {
    console.error('[TEST] ❌ No write permission to BASE_DIR:', e.message);
}

server.listen(port, async () => {
    try {
        if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        if (!fs.existsSync(CONVERTED_DIR)) fs.mkdirSync(CONVERTED_DIR, { recursive: true });

        // Cleanup on startup
        try {
            const oldFiles = await fsp.readdir(CONVERTED_DIR);
            for (const file of oldFiles) await fsp.unlink(path.join(CONVERTED_DIR, file)).catch(e => {});
            const oldUploads = await fsp.readdir(UPLOADS_DIR);
            for (const item of oldUploads) await fsp.rm(path.join(UPLOADS_DIR, item), { recursive: true, force: true }).catch(e => {});
            console.log('[STARTUP] Cleaned up old temporary files.');
        } catch (cleanupErr) {
            console.error('[STARTUP] Warning: Cleanup failed', cleanupErr);
        }

        console.log(`OmniConvert server listening on http://localhost:${port}`);
    } catch (error) {
        console.error('Failed to create necessary directories:', error);
    }
});