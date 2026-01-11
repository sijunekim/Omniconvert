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
const sanitize = require('sanitize-filename');
const { exec } = require('child_process');
const execPromise = util.promisify(exec);

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

// --- PERSISTENCE HELPERS ---
function saveTokens(tokens) {
    try {
        fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens));
        console.log('[AUTH] Tokens saved to disk.');
    } catch (e) {
        console.error('[AUTH] Failed to save tokens:', e.message);
    }
}

function loadTokens() {
    if (fs.existsSync(TOKENS_PATH)) {
        try {
            const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH));
            oauth2Client.setCredentials(tokens);
            console.log('[AUTH] Tokens loaded from disk. User is logged in.');
            return true;
        } catch (e) {
            console.error('[AUTH] Failed to load tokens:', e.message);
        }
    }
    return false;
}

ffmpeg.setFfmpegPath(ffmpegPath);
const convertAsync = util.promisify(libre.convert);

const GOOGLE_CLIENT_ID = '856374856193-3njg929585b8o2qje7ul8nbhs2c92eug.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);

// Load tokens on startup
loadTokens();

app.use(cors({ origin: true, credentials: true, exposedHeaders: ['Content-Disposition'] }));

const upload = multer({ dest: UPLOADS_DIR });
const wss = new WebSocket.Server({ noServer: true });
const tokenStore = {}; // Temp store for handshake

const CATEGORIES = {
    // Standard & Web Images
    IMAGE: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.ico', '.tiff', '.tga', '.jp2', '.heic'],
    // Professional/Raw Photos
    RAW_IMAGE: ['.cr2', '.nef', '.arw', '.orf', '.raf', '.dng', '.rw2', '.sr2', '.pef', '.crw', '.erf'],
    // Vector Graphics (New!)
    VECTOR: ['.svg', '.eps', '.ai', '.pdf'],
    // Documents
    DOCUMENT: ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.ods', '.odp', '.rtf', '.txt', '.html', '.xml', '.csv', '.pages', '.numbers', '.key'],
    // Video
    VIDEO: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.3g2', '.ts', '.mts', '.m2ts', '.vob', '.ogv'],
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
    AUDIO:  ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'wma', 'aiff', 'm4r', 'opus'],
    ARCHIVE: ['extract', 'zip'],
    EBOOK:  ['pdf', 'epub', 'mobi', 'docx', 'txt', 'azw3'],
    MODEL_3D: ['obj', 'stl', 'ply', 'glb', 'gltf'],
};
function getFileCategory(extension) { for (const category in CATEGORIES) { if (CATEGORIES[category].includes(extension)) return category; } return 'UNSUPPORTED'; }

app.get('/auth/google', (req, res) => {
    const uniqueId = crypto.randomBytes(16).toString('hex');
    oauth2Client.redirectUri = 'http://localhost:5001/auth/google/callback';
    const scopes = ['https://www.googleapis.com/auth/drive.readonly'];
    const url = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: scopes, state: uniqueId });
    res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
    const { code, state } = req.query;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens); // Set in memory
        saveTokens(tokens); // Save to file
        tokenStore[state] = tokens; // Store for frontend handshake
        res.send(`<script>window.opener.postMessage({ type: "google_auth_success", tokenId: "${state}" }, "*"); window.close();</script>`);
    } catch (error) {
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

wss.on('connection', (ws, req) => {
    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        const { tokenId } = data;
        
        // --- AUTH CHECK ---
        const sendProgress = (progress) => ws.send(JSON.stringify({ type: 'PROGRESS', payload: { progress } }));
        const sendError = (errorMessage) => ws.send(JSON.stringify({ type: 'ERROR', payload: { message: errorMessage } }));

        try {
            if (data.type === 'CHECK_GOOGLE_AUTH') {
                try {
                    await oauth2Client.getAccessToken(); // Check global client
                    ws.send(JSON.stringify({ type: 'GOOGLE_AUTH_STATUS', payload: { isLoggedIn: true } }));
                } catch (e) {
                    ws.send(JSON.stringify({ type: 'GOOGLE_AUTH_STATUS', payload: { isLoggedIn: false } }));
                }
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
                const tempFilePath = path.join(UPLOADS_DIR, sanitize(file.name));
                const dest = fs.createWriteStream(tempFilePath);
                
                if (file.mimeType && file.mimeType.startsWith('application/vnd.google-apps')) {
                    const res = await drive.files.export({ fileId: file.id, mimeType: 'application/pdf' }, { responseType: 'stream' });
                    await new Promise((resolve, reject) => { res.data.on('end', resolve).on('error', reject).pipe(dest); });
                    data.type = 'CONVERT';
                    data.payload.files = [{ path: tempFilePath, originalName: file.name + '.pdf' }]; 
                } else {
                    const res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'stream' });
                    await new Promise((resolve, reject) => { res.data.on('end', resolve).on('error', reject).pipe(dest); });
                    data.type = 'CONVERT';
                    data.payload.files = [{ path: tempFilePath, originalName: file.name }];
                }
                data.payload.settings = settings;
            }

            if (data.type === 'CONVERT') {
                const { files, outputFormat, settings } = data.payload;
                const sessionId = `session_${Date.now()}`;
                const tempOutputDir = path.join(UPLOADS_DIR, sessionId);
                let isArchiveJob = getFileCategory(path.extname(files[0].originalName).toLowerCase()) === 'ARCHIVE';

                try {
                    await fsp.mkdir(tempOutputDir, { recursive: true });
                    const successfulProcessingPaths = [];
                    const areAllFilesInBatchImages = files.every(file => getFileCategory(path.extname(file.originalName).toLowerCase()) === 'IMAGE');
                    const isCreateArchiveJob = files.length > 1 && !isArchiveJob;

                    if (isArchiveJob) {
                        sendProgress(50);
                        const command = `unar -o "${tempOutputDir}" "${files[0].path}"`;
                        await execPromise(command);
                        const readdirRecursive = async (dir) => {
                            const entries = await fsp.readdir(dir, { withFileTypes: true });
                            const filePaths = await Promise.all(entries.map((entry) => {
                                const res = path.resolve(dir, entry.name);
                                return entry.isDirectory() ? readdirRecursive(res) : res;
                            }));
                            return Array.prototype.concat(...filePaths);
                        };
                        const allFiles = await readdirRecursive(tempOutputDir);
                        const fileList = allFiles.map(fullPath => path.relative(tempOutputDir, fullPath));
                        sendProgress(100);
                        ws.send(JSON.stringify({ type: 'EXTRACT_COMPLETE', payload: { fileList, sessionId: sessionId } }));
                        setTimeout(() => { fsp.rm(tempOutputDir, { recursive: true, force: true }).catch(err => {}); }, 30 * 60 * 1000);
                        return;
                    }

                    if (areAllFilesInBatchImages && outputFormat === 'pdf') {
                        const pdfName = `OmniConvert_${sessionId}.pdf`;
                        const outputPath = path.join(tempOutputDir, pdfName);
                        await new Promise(async (resolve, reject) => {
                            const doc = new PDFDocument({ autoFirstPage: false });
                            const stream = fs.createWriteStream(outputPath);
                            doc.pipe(stream);
                            for (const file of files) {
                                const imageBuffer = await fsp.readFile(file.path);
                                const metadata = await sharp(imageBuffer).metadata();
                                doc.addPage({ size: [metadata.width, metadata.height] });
                                doc.image(imageBuffer, { fit: [metadata.width, metadata.height] });
                            }
                            doc.end();
                            stream.on('finish', resolve);
                            stream.on('error', reject);
                        });
                        successfulProcessingPaths.push(outputPath);
                    } else if (isCreateArchiveJob) {
                        for (const file of files) {
                            const newPath = path.join(tempOutputDir, file.originalName);
                            await fsp.rename(file.path, newPath);
                            successfulProcessingPaths.push(newPath);
                        }
                    } else {
                        for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const safeName = sanitize(path.parse(file.originalName).name);
                    const outputPath = path.join(tempOutputDir, `${safeName}.${outputFormat}`);
                    const fileExt = path.extname(file.originalName).toLowerCase().replace('.', '');
                    const fileCategory = getFileCategory(path.extname(file.originalName).toLowerCase());

                    try {
                        // 1. STANDARD IMAGES (Smart Router: Sharp vs Magick)
                        if (fileCategory === 'IMAGE' || fileCategory === 'VECTOR') {
                            // Sharp handles web formats fast. Magick handles everything else (BMP, ICO, TIFF, PDF).
                            const useMagick = fileCategory === 'VECTOR' || ['bmp', 'ico', 'tiff', 'tga', 'pdf'].includes(outputFormat);

                            if (useMagick) {
                                let command = `magick "${file.path}" "${outputPath}"`;
                                
                                // Special fix for ICO sizing
                                if (outputFormat === 'ico') {
                                    command = `magick "${file.path}" -resize "256x256>" "${outputPath}"`;
                                }
                                
                                await execPromise(command);
                            } else {
                                // Use Sharp for speed on JPG, PNG, WEBP, GIF
                                await sharp(file.path).toFormat(outputFormat).toFile(outputPath);
                            }
                        }
                        // 2. VECTORS (Magick)
                        else if (fileCategory === 'VECTOR') {
                            const command = `magick "${file.path}" "${outputPath}"`;
                            await execPromise(command);
                        }
                        // 3. RAW PHOTOS (DCRAW -> MAGICK)
                        else if (fileCategory === 'RAW_IMAGE') {
                            const command = `dcraw -c -w -T "${file.path}" | magick - "${outputPath}"`;
                            await execPromise(command);
                        }
                        // 4. DOCUMENTS (Pandoc for Text/HTML, LibreOffice for Office)
                        else if (fileCategory === 'DOCUMENT') {
                            const ext = path.extname(file.originalName).toLowerCase();
                            // Use Pandoc for web/text formats (Fixes HTML conversion)
                            if (['.html', '.htm', '.txt', '.md', '.rtf'].includes(ext)) {
                                const command = `pandoc "${file.path}" -o "${outputPath}"`;
                                await execPromise(command);
                            } else {
                                // Use LibreOffice CLI for Word/Excel/PPT
                                const sofficePath = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
                                const tempProfileDir = path.join(tempOutputDir, `LO_Profile_${i}`);
                                const profileUri = `file://${tempProfileDir.startsWith('/') ? '' : '/'}${tempProfileDir}`;
                                const command = `"${sofficePath}" "-env:UserInstallation=${profileUri}" --headless --convert-to "${outputFormat}" --outdir "${tempOutputDir}" "${file.path}"`;
                                
                                try { await execPromise(command); } catch (e) {}

                                // Retry loop to wait for LibreOffice to finish writing
                                const loOutput = path.join(tempOutputDir, `${path.parse(file.path).name}.${outputFormat}`);
                                for (let k=0; k<30; k++) {
                                    if (fs.existsSync(loOutput)) { await fsp.rename(loOutput, outputPath); break; }
                                    await new Promise(r => setTimeout(r, 100));
                                }
                            }
                        }
                        // 5. VIDEO & AUDIO (FFmpeg)
                        else if (fileCategory === 'VIDEO' || fileCategory === 'AUDIO') {
                            await new Promise((resolve, reject) => {
                                const command = ffmpeg(file.path);
                                if (settings) {
                                    if (settings.resolution && settings.resolution !== 'original') command.size(settings.resolution);
                                    if (settings.audioBitrate && settings.audioBitrate !== 'original') command.audioBitrate(settings.audioBitrate);
                                }
                                if (outputFormat === 'm4a') command.audioCodec('aac');
                                
                                command.toFormat(outputFormat)
                                    .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
                                    .on('end', () => resolve())
                                    .save(outputPath);
                            });
                        }
                        // 6. EBOOK (Calibre)
                        else if (fileCategory === 'EBOOK') {
                            const calibrePath = '/Applications/calibre.app/Contents/MacOS/ebook-convert';
                            const inputWithExt = path.join(tempOutputDir, `temp_${Date.now()}.${fileExt}`);
                            await fsp.copyFile(file.path, inputWithExt);
                            const command = `"${calibrePath}" "${inputWithExt}" "${outputPath}"`;
                            await execPromise(command);
                        }
                        // 7. 3D MODELS (Assimp)
                        else if (fileCategory === 'MODEL_3D') {
                            const command = `assimp export "${file.path}" "${outputPath}"`;
                            await execPromise(command);
                        }

                        successfulProcessingPaths.push(outputPath);

                    } catch (err) {
                        console.error(`Failed to process ${file.originalName}:`, err.message);
                    }
                    sendProgress(Math.round(((i + 1) / files.length) * 100));
                }
                    }

                    if (successfulProcessingPaths.length === 0) throw new Error("No files could be processed.");

                    let finalFileName;
                    if (successfulProcessingPaths.length === 1 && !isCreateArchiveJob) {
                        const oldPath = successfulProcessingPaths[0];
                        finalFileName = path.basename(oldPath);
                        const newPath = path.join(CONVERTED_DIR, finalFileName);
                        await fsp.rename(oldPath, newPath);
                    } else {
                        finalFileName = `OmniConvert_${sessionId}.zip`;
                        const zipPath = path.join(CONVERTED_DIR, finalFileName);
                        await new Promise((resolve, reject) => {
                            const output = fs.createWriteStream(zipPath);
                            const archive = archiver('zip');
                            output.on('close', resolve);
                            archive.on('error', reject);
                            archive.pipe(output);
                            for (const p of successfulProcessingPaths) {
                                if (fs.statSync(p).isDirectory()) archive.directory(p, path.basename(p));
                                else archive.file(p, { name: path.basename(p) });
                            }
                            archive.finalize();
                        });
                    }
                    const downloadUrl = `/download/${encodeURIComponent(finalFileName)}`;
                    ws.send(JSON.stringify({ type: 'COMPLETE', payload: { downloadUrl } }));
                } catch (error) {
                    sendError(error.message);
                } finally {
                    if (!isArchiveJob) await fsp.rm(tempOutputDir, { recursive: true, force: true }).catch(e => {});
                    await Promise.allSettled(files.map(f => fsp.unlink(f.path)));
                }
            }
        } catch (error) {
            console.error('[WEBSOCKET ERROR]', error);
            sendError('An unexpected server error occurred.');
        }
    });
    ws.on('close', () => console.log('[WSS] Client disconnected.'));
});

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