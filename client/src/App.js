import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const CATEGORIES = {
    // Standard & Web Images
    IMAGE: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'ico', 'tiff', 'tga', 'jp2', 'heic'],
    // Professional/Raw Photos
    RAW_IMAGE: ['cr2', 'nef', 'arw', 'orf', 'raf', 'dng', 'rw2', 'sr2', 'pef', 'crw', 'erf'],
    // Vector Graphics (New!)
    VECTOR: ['svg', 'eps', 'ai', 'pdf'],
    // Documents
    DOCUMENT: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'html', 'xml', 'csv', 'pages', 'numbers', 'key'],
    // Video
    VIDEO: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', '3gp', '3g2', 'ts', 'mts', 'm2ts', 'vob', 'ogv'],
    // Audio
    AUDIO: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'wma', 'aiff', 'alac', 'opus', 'amr', 'm4r'],
    // Archives
    ARCHIVE: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'],
    // eBooks
    EBOOK: ['epub', 'mobi', 'azw3', 'fb2', 'lit', 'lrf', 'pdb', 'rb', 'tcr'],
    // 3D Models
    MODEL_3D: ['obj', 'stl', 'fbx', 'dae', 'ply', 'glb', 'gltf', '3ds', 'blend', 'x'],
};

const SUPPORTED_OUTPUTS = {
    IMAGE:  ['jpg', 'png', 'webp', 'gif', 'bmp', 'ico', 'tiff', 'tga', 'pdf'],
    RAW_IMAGE: ['jpg', 'png', 'tiff', 'webp'],
    VECTOR: ['png', 'jpg', 'pdf', 'svg'],
    DOCUMENT: ['pdf', 'docx', 'txt', 'html', 'rtf', 'jpg', 'png'],
    VIDEO:  ['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'gif', 'mp3', 'wav', 'flac'],
    AUDIO:  ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'wma', 'aiff', 'm4r', 'opus'],
    ARCHIVE: ['extract', 'zip'], // Can extract or convert to zip
    EBOOK:  ['pdf', 'epub', 'mobi', 'docx', 'txt', 'azw3'],
    MODEL_3D: ['obj', 'stl', 'ply', 'glb', 'gltf'],
};

function getFileCategory(fileName) {
    const extension = (fileName || '').split('.').pop().toLowerCase();
    for (const category in CATEGORIES) {
        if (CATEGORIES[category].includes(extension)) return category;
    }
    return 'UNSUPPORTED';
}

function App() {
    const [uiState, setUiState] = useState('selectSource');
    const [selection, setSelection] = useState(null);
    const [outputFormat, setOutputFormat] = useState('');
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    
    // Connection state
    const [isSocketConnected, setIsSocketConnected] = useState(false);
    
    // Google Drive state
    const [isGoogleLoggedIn, setIsGoogleLoggedIn] = useState(false);
    const [isDrivePickerOpen, setIsDrivePickerOpen] = useState(false);
    const [driveFiles, setDriveFiles] = useState([]);
    const [driveSearchTerm, setDriveSearchTerm] = useState('');
    const [driveLoading, setDriveLoading] = useState(false);
    const [tokenId, setTokenId] = useState(null);

    // --- ADD THIS ---
    const [conversionSettings, setConversionSettings] = useState({
        resolution: 'original',
        audioBitrate: 'original'
    });

    // Drag and Drop state
    const [isDragging, setIsDragging] = useState(false);

    const socket = useRef(null);
    const fileInputRef = useRef(null);

    // Tell Electron if we are busy converting
    useEffect(() => {
        const isBusy = uiState === 'processing';
        if (window.electron && window.electron.setJobStatus) {
            window.electron.setJobStatus(isBusy);
        }
    }, [uiState]);

    useEffect(() => {
        const connect = () => {
            socket.current = new WebSocket('ws://localhost:5001');

            socket.current.onopen = () => {
                console.log('WebSocket Connected to ws://localhost:5001');
                setIsSocketConnected(true);
                sendMessage('CHECK_GOOGLE_AUTH', {});
            };
            socket.current.onclose = () => {
                console.log('WebSocket Disconnected.');
                setIsSocketConnected(false);
            };
            socket.current.onmessage = (event) => {
                const data = JSON.parse(event.data);
                switch (data.type) {
                    case 'PROGRESS': setUiState('processing'); setProgress(data.payload.progress); break;
                    case 'COMPLETE': setUiState('complete'); setResult({ downloadUrl: data.payload.downloadUrl }); break;
                    case 'ERROR': setUiState('error'); setError(data.payload.message); break;
                    case 'EXTRACT_COMPLETE': setUiState('extracted'); setResult({ fileList: data.payload.fileList, sessionId: data.payload.sessionId }); break;
                    case 'GOOGLE_AUTH_STATUS': setIsGoogleLoggedIn(data.payload.isLoggedIn); break;
                    case 'DRIVE_FILES_LIST': setDriveFiles(data.payload.files); setDriveLoading(false); break;
                    default: break;
                }
            };
        };
        connect();
        
        const handleAuthMessage = (event) => {
            if (event.origin !== 'http://localhost:5001') return;
            const { type, tokenId } = event.data;
            if (type === 'google_auth_success' && tokenId) {
                setTokenId(tokenId);
                setIsGoogleLoggedIn(true);
            } else if (type === 'google_auth_error') {
                setUiState('error');
                setError('Google login failed. Please try again.');
            }
        };
        window.addEventListener('message', handleAuthMessage);

        return () => {
            if (socket.current) socket.current.close();
            window.removeEventListener('message', handleAuthMessage);
        };
    }, []);

    const sendMessage = (type, payload) => {
        if (socket.current?.readyState === WebSocket.OPEN) {
            socket.current.send(JSON.stringify({ type, payload, tokenId }));
        }
    };

    const resetState = () => {
        setUiState('selectSource');
        setSelection(null);
        setOutputFormat('');
        setProgress(0);
        setError('');
        setResult(null);
        setConversionSettings({ resolution: 'original', audioBitrate: 'original' });
        if (fileInputRef.current) fileInputRef.current.value = null;
    };

    const processFiles = (files) => {
        if (!files || files.length === 0) return;
        
        setError('');
        setProgress(0);
        setResult(null);

        const firstFileCategory = getFileCategory(files[0]?.name);
        let defaultOutput = '';
        if (files.length > 1 && firstFileCategory !== 'ARCHIVE') {
            defaultOutput = 'zip';
        } else if (files.length === 1 && firstFileCategory === 'ARCHIVE') {
            defaultOutput = 'extract';
        }
        
        setSelection({ type: 'local', files });
        setOutputFormat(defaultOutput);
        setUiState('configure');
    };

    const handleFileChange = (event) => {
        processFiles(Array.from(event.target.files));
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processFiles(Array.from(e.dataTransfer.files));
        }
    };
    
    const handleGoogleLogin = () => { window.open('http://localhost:5001/auth/google', 'auth-popup', 'width=500,height=600'); };
    
    // --- THIS IS THE MISSING FUNCTION ---
    const handleGoogleLogout = () => {
        sendMessage('LOGOUT_GOOGLE', {});
        setIsDrivePickerOpen(false);
        setDriveFiles([]);
    };
    // ------------------------------------

    const handleOpenDrivePicker = () => {
        setDriveFiles([]);
        setDriveSearchTerm('');
        setDriveLoading(true);
        setIsDrivePickerOpen(true);
        sendMessage('LIST_DRIVE_FILES', { searchTerm: '' });
    };
    const handleDriveSearch = () => { setDriveLoading(true); sendMessage('LIST_DRIVE_FILES', { searchTerm: driveSearchTerm }); };
    
    const handleSelectDriveFile = (file) => {
        setIsDrivePickerOpen(false);
        setSelection({ type: 'drive', files: [file] });
        if (file.mimeType && file.mimeType.startsWith('application/vnd.google-apps')) {
            setOutputFormat('pdf');
        } else {
             setOutputFormat('');
        }
        setUiState('configure');
    };

    const handleStartConversion = async () => {
        // 1. Validation checks
        if (!selection || !outputFormat) {
            setError('Selection or output format is missing.');
            setUiState('error');
            return;
        }

        // 2. Update UI to "Processing"
        setUiState('processing');
        setError('');
        setProgress(0);

        // 3. Handle Local Files (Upload then Convert)
        if (selection.type === 'local') {
            const formData = new FormData();
            selection.files.forEach(file => formData.append('files', file));
            try {
                const response = await fetch('http://localhost:5001/upload', { method: 'POST', body: formData });
                if (!response.ok) throw new Error('Upload failed.');
                const data = await response.json();
                
                // --- THIS IS THE CHANGE ---
                // We allow pass 'settings: conversionSettings' to the server
                sendMessage('CONVERT', { 
                    files: data.files, 
                    outputFormat: outputFormat,
                    settings: conversionSettings 
                });
                // --------------------------

            } catch (err) {
                setUiState('error');
                setError(err.message);
            }
        } 
        // 4. Handle Google Drive Files
        else if (selection.type === 'drive') {
            // --- THIS IS THE CHANGE ---
            // We pass 'settings: conversionSettings' here too
            sendMessage('CONVERT_DRIVE_FILE', { 
                file: selection.files[0], 
                outputFormat: outputFormat,
                settings: conversionSettings
            });
            // --------------------------
        }
    };
  
    const getOutputOptions = () => {
        if (!selection) return [];
        const file = selection.files[0];
        
        if (file.mimeType && file.mimeType.startsWith('application/vnd.google-apps')) {
            return [{ value: 'pdf', label: 'PDF (Default Export)' }];
        }

        const files = selection.files;
        const firstFileCategory = getFileCategory(files[0].name);
        if (firstFileCategory === 'UNSUPPORTED') return [{ value: '', label: 'Unsupported file type', disabled: true }];
        if (files.length > 1 && firstFileCategory !== 'ARCHIVE') return [{ value: 'zip', label: 'Create ZIP Archive' }];
        const isMixedBatch = files.some(file => getFileCategory(file.name) !== firstFileCategory);
        if (isMixedBatch) return [{ value: '', label: 'Mixed file types not supported', disabled: true }];
        const outputs = SUPPORTED_OUTPUTS[firstFileCategory] || [];
        if (firstFileCategory === 'ARCHIVE') return [{ value: 'extract', label: 'Extract Contents' }];
        return outputs.map(f => ({ value: f, label: f.toUpperCase() }));
    };

    const renderSettings = () => {
        if (!selection || !selection.files[0]) return null;
        const category = getFileCategory(selection.files[0].name);

        if (category === 'VIDEO') {
            return (
                <div className="settings-box">
                    <label>Video Resolution:</label>
                    <select 
                        value={conversionSettings.resolution} 
                        onChange={(e) => setConversionSettings({...conversionSettings, resolution: e.target.value})}
                    >
                        <option value="original">Same as Source</option>
                        <option value="3840x2160">4K (2160p)</option>
                        <option value="1920x1080">Full HD (1080p)</option>
                        <option value="1280x720">HD (720p)</option>
                        <option value="480x?">480p (Mobile)</option>
                    </select>
                </div>
            );
        }
        if (category === 'AUDIO' || (category === 'VIDEO' && ['mp3', 'aac', 'wav'].includes(outputFormat))) {
            return (
                <div className="settings-box">
                    <label>Audio Quality:</label>
                    <select 
                        value={conversionSettings.audioBitrate} 
                        onChange={(e) => setConversionSettings({...conversionSettings, audioBitrate: e.target.value})}
                    >
                        <option value="original">Same as Source</option>
                        <option value="320k">High (320 kbps)</option>
                        <option value="192k">Medium (192 kbps)</option>
                        <option value="128k">Standard (128 kbps)</option>
                        <option value="64k">Low (Voice)</option>
                    </select>
                </div>
            );
        }
        return null;
    };

    const renderMainContent = () => {
        if (isDrivePickerOpen) {
            return (
                <div className="drive-picker">
                    <div className="drive-header">
                        <h3>Google Drive</h3>
                        <div className="drive-actions">
                            <button className="logout-link" onClick={handleGoogleLogout}>Sign Out</button>
                            <button className="close-icon" onClick={() => setIsDrivePickerOpen(false)}>×</button>
                        </div>
                    </div>
                    
                    <div className="drive-search">
                        <input 
                            type="text" 
                            placeholder="Search your files..." 
                            value={driveSearchTerm}
                            onChange={(e) => setDriveSearchTerm(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleDriveSearch()} 
                        />
                        <button onClick={handleDriveSearch}>
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg>
                        </button>
                    </div>

                    <div className="file-list drive">
                        {driveLoading ? (
                            <div className="drive-loading">Loading files...</div>
                        ) : (
                            <ul>
                                {driveFiles.length > 0 ? driveFiles.map(file => (
                                    <li key={file.id} onClick={() => handleSelectDriveFile(file)} className="drive-item">
                                        <div className="drive-item-left">
                                            <img src={file.iconLink} alt="" className="drive-icon" /> 
                                            <span className="drive-name" title={file.name}>{file.name}</span>
                                        </div>
                                        <div className="drive-item-right">
                                            <span className="drive-date">{file.modifiedTime}</span>
                                            <span className="drive-size">{file.size}</span>
                                        </div>
                                    </li>
                                )) : <div className="drive-empty">No files found.</div>}
                            </ul>
                        )}
                    </div>
                </div>
            );
        }
        
        switch (uiState) {
            case 'selectSource':
                return (
                    <>
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple style={{ display: 'none' }} />
                        <div className="source-options">
                            <div 
                                className={`upload-box-wrapper ${isDragging ? 'dragging' : ''}`}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                style={{ flex: 1, display: 'flex' }}
                            >
                                <button className="source-button" onClick={() => fileInputRef.current.click()} style={{ width: '100%', height: '100%' }}>
                                    <span className="source-icon">💻</span>
                                    <span className="source-title">From Computer</span>
                                    <span className="source-desc">
                                        {isDragging ? 'Drop files here!' : 'Click or Drop Files'}
                                    </span>
                                </button>
                            </div>
                            <div className="upload-box-wrapper" style={{ flex: 1, display: 'flex' }}>
                                <button className="source-button" onClick={isGoogleLoggedIn ? handleOpenDrivePicker : handleGoogleLogin} style={{ width: '100%', height: '100%' }}>
                                    <span className="source-icon">☁️</span>
                                    <span className="source-title">From Google Drive</span>
                                    <span className="source-desc">{isGoogleLoggedIn ? 'Select a file' : 'Connect Account'}</span>
                                </button>
                            </div>
                        </div>
                        {!isSocketConnected && <div className="socket-status">Connecting to server...</div>}
                    </>
                );
            case 'configure':
                return (
                    <div className="configure-section">
                        <div className="file-list">
                            <h4>Selected File(s):</h4>
                            <ul>{selection.files.map((file, index) => <li key={index}>{file.name}</li>)}</ul>
                        </div>
                        <div className="options-box">
                            <label htmlFor="format">Action:</label>
                            <select id="format" value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)}>
                                <option value="">Select Action</option>
                                {getOutputOptions().map(opt => (<option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>))}
                            </select>
                        </div>
                        {renderSettings()}
                        <div className="button-group">
                            <button className="secondary-button" onClick={resetState}>Back</button>
                            <button className="primary-button" onClick={handleStartConversion} disabled={!outputFormat}>Convert</button>
                        </div>
                    </div>
                );
            case 'processing':
                return ( <div className="progress-section"><h3>Converting...</h3><div className="progress-bar-container"><div className="progress-bar" style={{ width: `${progress}%` }}>{progress}%</div></div></div> );
            case 'complete':
                return (
                    <div className="download-box">
                        <h3>Conversion Complete!</h3>
                        <a className="download-button" href={`http://localhost:5001${result.downloadUrl}`} download>Download File</a>
                        <button className="reset-button" onClick={resetState}>Convert More Files</button>
                    </div>
                );
            case 'extracted':
                return (
                    <div className="extracted-files-section">
                        <h3>Extraction Complete!</h3>
                        <div className="file-list extracted">
                            <ul>{result.fileList.map((file, index) => (
                                <li key={index}>
                                    <span className="file-name">{file}</span>
                                    <a 
                                        className="file-download-button icon" 
                                        href={`http://localhost:5001/download-extracted?sessionId=${result.sessionId}&file=${encodeURIComponent(file)}`} 
                                        download 
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/></svg>
                                    </a>
                                </li>
                            ))}</ul>
                        </div>
                        <button className="reset-button" onClick={resetState}>Start Over</button>
                    </div>
                );
            case 'error':
                return ( <div className="error-section"><h3>Processing Failed</h3><p className="error-message">{error}</p><button className="reset-button" onClick={resetState}>Try Again</button></div> );
            default: return null;
        }
    };

    return (
        <div className="app-wrapper" onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!isDragging) setIsDragging(true); }}>
            {isDragging && (
                <div 
                    className="drag-overlay"
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
                    onDrop={handleDrop}
                >
                    <h2>Drop Files Here</h2>
                    <p>Release to start converting</p>
                </div>
            )}
            <div className="container">
                <header><h1>OmniConvert</h1><p>The Ultimate File Conversion Utility</p></header>
                <main>{renderMainContent()}</main>
            </div>
        </div>
    );
}

export default App;