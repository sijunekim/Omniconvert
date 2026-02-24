import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const CATEGORIES = {
    // Standard & Web Images
    IMAGE: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'ico', 'tiff', 'tga', 'jp2', 'heic'],
    // Professional/Raw Photos
    RAW_IMAGE: ['cr2', 'nef', 'arw', 'orf', 'raf', 'dng', 'rw2', 'sr2', 'pef', 'crw', 'erf'],
    // Vector Graphics
    VECTOR: ['svg', 'eps', 'ai'],
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
    ARCHIVE: ['extract', 'zip'], 
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
    const [systemHealth, setSystemHealth] = useState(null);
    // Inside App() function
    const [devClickCount, setDevClickCount] = useState(0);
    // Terminal Logs State
    const [serverLogs, setServerLogs] = useState([]);
    const [settingsTab, setSettingsTab] = useState('general'); // 'general' or 'developer'

    // Settings State (Load from localStorage if available)
    const [showSettings, setShowSettings] = useState(false);
    const [preferences, setPreferences] = useState(() => {
        const saved = localStorage.getItem('omni_preferences');
        // Added autoReset: true
        return saved ? JSON.parse(saved) : { darkMode: false, devMode: false, autoReset: true };
    });

    // Apply Theme Effect
    useEffect(() => {
        document.body.setAttribute('data-theme', preferences.darkMode ? 'dark' : 'light');
        localStorage.setItem('omni_preferences', JSON.stringify(preferences));
    }, [preferences]);

    const toggleSetting = (key) => {
        setPreferences(prev => ({ ...prev, [key]: !prev[key] }));
    };
    
    // Connection state
    const [isSocketConnected, setIsSocketConnected] = useState(false);
    
    // Google Drive state
    const [isGoogleLoggedIn, setIsGoogleLoggedIn] = useState(false);
    const [isDrivePickerOpen, setIsDrivePickerOpen] = useState(false);
    const [driveFiles, setDriveFiles] = useState([]);
    const [driveSearchTerm, setDriveSearchTerm] = useState('');
    const [driveLoading, setDriveLoading] = useState(false);
    const [tokenId, setTokenId] = useState(null);

    const [conversionSettings, setConversionSettings] = useState({
        resolution: 'original',
        audioBitrate: 'original'
    });

    // Drag and Drop state
    const [isDragging, setIsDragging] = useState(false);

    const socket = useRef(null);
    const fileInputRef = useRef(null); // Ref kept for fallback, though largely unused now

    // Tell Electron if we are busy converting
    useEffect(() => {
        const isBusy = uiState === 'processing';
        if (window.electron && window.electron.setJobStatus) {
            window.electron.setJobStatus(isBusy);
        }
    }, [uiState]);

   // Replace the main useEffect with this:
    useEffect(() => {
        let isMounted = true; // Track if component is valid

        const connect = () => {
            // If connection exists and is active, don't create a new one
            if (socket.current && (socket.current.readyState === WebSocket.OPEN || socket.current.readyState === WebSocket.CONNECTING)) {
                return;
            }

            socket.current = new WebSocket('ws://localhost:5001');

            socket.current.onopen = () => {
                if (!isMounted) return;
                console.log('✅ WebSocket Connected');
                setIsSocketConnected(true);
                
                // Ask "Am I logged in?" immediately upon connection
                sendMessage('CHECK_GOOGLE_AUTH', {});
            };

            socket.current.onclose = () => {
                if (!isMounted) return;
                console.log('❌ WebSocket Disconnected');
                setIsSocketConnected(false);
                
                // Try to reconnect after 3 seconds if not intentionally closed
                setTimeout(() => {
                    if (isMounted) connect();
                }, 3000);
            };

            socket.current.onmessage = (event) => {
                if (!isMounted) return;
                try {
                    const data = JSON.parse(event.data);
                    
                    // Debug Auth messages
                    if (data.type === 'GOOGLE_AUTH_STATUS') {
                        console.log("🔐 Auth Status Received:", data.payload);
                    }

                    switch (data.type) {
                        case 'PROGRESS': setUiState('processing'); setProgress(data.payload.progress); break;
                        case 'COMPLETE': setUiState('complete'); setResult({ downloadUrl: data.payload.downloadUrl }); break;
                        case 'ERROR': setUiState('error'); setError(data.payload.message); break;
                        case 'EXTRACT_COMPLETE': setUiState('extracted'); setResult({ fileList: data.payload.fileList, sessionId: data.payload.sessionId }); break;
                        case 'GOOGLE_AUTH_STATUS': setIsGoogleLoggedIn(data.payload.isLoggedIn); break;
                        case 'DRIVE_FILES_LIST': setDriveFiles(data.payload.files); setDriveLoading(false); break;
                        case 'SYSTEM_HEALTH': setSystemHealth(data.payload); break;
                        // --- NEW: Handle Incoming Logs ---
                        case 'SERVER_LOG':
                            setServerLogs(prevLogs => {
                                // Keep only the last 100 lines to prevent lag
                                const newLogs = [...prevLogs, data.payload];
                                if (newLogs.length > 100) return newLogs.slice(-100);
                                return newLogs;
                            });
                            break;
                        default: break;
                        case 'LOG_HISTORY':
                            // Load history immediately
                            setServerLogs(data.payload);
                            break;
                    }
                } catch (e) {
                    console.error("Error parsing message:", e);
                }
            };
        };

        connect();
        
        // Listener for the Google Popup window
        const handleAuthMessage = (event) => {
            if (event.origin !== 'http://localhost:5001') return;
            const { type, tokenId } = event.data;
            if (type === 'google_auth_success' && tokenId) {
                setTokenId(tokenId);
                // Force a re-check after successful popup login
                sendMessage('CHECK_GOOGLE_AUTH', {});
            } else if (type === 'google_auth_error') {
                setUiState('error');
                setError('Google login failed. Please try again.');
            }
        };
        window.addEventListener('message', handleAuthMessage);

        // Cleanup function
        return () => {
            isMounted = false;
            window.removeEventListener('message', handleAuthMessage);
            if (socket.current) {
                socket.current.close();
            }
        };
    }, []);

    // --- NEW: Effect to listen for Main Process (Electron) logs ---
    useEffect(() => {
        // Check if bridge exists
        if (window.electron && window.electron.onMainLog) {
            
            // 1. Subscribe and GET the cleanup function
            const removeListener = window.electron.onMainLog((logObj) => {
                setServerLogs(prevLogs => {
                    // Prevent duplicates based on timestamp + message
                    // (Optional extra safety, but the cleanup below is the real fix)
                    const isDuplicate = prevLogs.length > 0 && 
                        prevLogs[prevLogs.length - 1].message === logObj.message &&
                        prevLogs[prevLogs.length - 1].time === logObj.time;

                    if (isDuplicate) return prevLogs;

                    const newLogs = [...prevLogs, logObj];
                    if (newLogs.length > 100) return newLogs.slice(-100);
                    return newLogs;
                });
            });

            // 2. React calls this when the component updates or unmounts
            return () => {
                removeListener(); // <--- THIS STOPS THE DOUBLE LOGS
            };
        }
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

    const processFiles = async (files) => {
        if (!files || files.length === 0) return;
        
        // Reset UI
        setError('');
        setProgress(0);
        setResult(null);
        setUiState('processing'); 
        
        const safeFiles = [];

        try {
            for (const file of files) {
                // --- DEBUG LOG ---
                console.log("Processing File Object:", file);
                console.log("File Path:", file.path); 
                // -----------------

                if (window.electron && window.electron.uploadFile) {
                    
                    // 1. Try to get the path normally
                    let pathToSend = file.path;

                    // 2. If missing (Drag & Drop), use the new helper
                    if (!pathToSend && window.electron.getFilePath) {
                        pathToSend = window.electron.getFilePath(file);
                    }

                    // 3. Final Check
                    if (!pathToSend) {
                        throw new Error(`System Error: Could not read file path. Please use the 'From Computer' button.`);
                    }

                    console.log(`[Security] Scanning ${file.name} at ${pathToSend}...`);

                    console.log(`[Security] Scanning ${file.name} at ${pathToSend}...`);
                    
                    const result = await window.electron.uploadFile(pathToSend);

                    if (!result.success) {
                        throw new Error(`Security Blocked: ${result.error}`);
                    }

                    safeFiles.push({
                        name: result.file.originalName,
                        path: result.file.safePath,
                        type: file.type,
                        size: file.size,
                        id: result.file.id
                    });
                } else {
                    console.warn("Security check skipped (Not in Electron)");
                    safeFiles.push(file);
                }
            }

            const firstFileCategory = getFileCategory(safeFiles[0]?.name);
            let defaultOutput = '';
            if (safeFiles.length > 1 && firstFileCategory !== 'ARCHIVE') {
                defaultOutput = 'zip';
            } else if (safeFiles.length === 1 && firstFileCategory === 'ARCHIVE') {
                defaultOutput = 'extract';
            }
            
            setSelection({ type: 'local', files: safeFiles });
            setOutputFormat(defaultOutput);
            setUiState('configure');

        } catch (err) {
            console.error(err);
            setUiState('error');
            setError(err.message);
        }
    };

    // --- NEW NATIVE FILE SELECTION FUNCTION ---
    const handleNativeSelection = async () => {
        try {
            if (window.electron && window.electron.selectFiles) {
                
                
                // Open the Native Dialog via Electron Main Process
                const result = await window.electron.selectFiles();
                
                if (result.canceled) {
                    setUiState('selectSource');
                    return;
                }

                // If some files failed (e.g. viruses), show error
                if (result.errors && result.errors.length > 0) {
                    setError(`Some files were rejected: ${result.errors.join(', ')}`);
                }

                // If valid files exist, load them
                if (result.files && result.files.length > 0) {
                    // Map backend safe objects to frontend format
                    const safeFiles = result.files.map(f => ({
                        name: f.originalName,
                        path: f.safePath, // The UUID path
                        type: f.mime,
                        size: f.size,
                        id: f.id
                    }));
                    
                    const firstFileCategory = getFileCategory(safeFiles[0]?.name);
                    let defaultOutput = '';
                    if (safeFiles.length > 1 && firstFileCategory !== 'ARCHIVE') {
                        defaultOutput = 'zip';
                    } else if (safeFiles.length === 1 && firstFileCategory === 'ARCHIVE') {
                        defaultOutput = 'extract';
                    }
                    
                    setSelection({ type: 'local', files: safeFiles });
                    setOutputFormat(defaultOutput);
                    setUiState('configure');
                } else if (!result.errors.length) {
                    setUiState('selectSource');
                }
            } else {
                console.error("Native selection not supported (Web Mode?)");
                // Fallback for browser testing
                if(fileInputRef.current) fileInputRef.current.click();
            }
        } catch (err) {
            console.error(err);
            setUiState('error');
            setError(err.message);
        }
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
    
    const handleGoogleLogout = () => {
        sendMessage('LOGOUT_GOOGLE', {});
        setIsDrivePickerOpen(false);
        setDriveFiles([]);
    };

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

        // 3. Handle Local Files
        if (selection.type === 'local') {
            try {
                // Since files are already "Secured" (moved to uuid path), 
                // we just tell the server where they are.
                console.log("Requesting conversion for:", selection.files);

                sendMessage('CONVERT', { 
                    files: selection.files, 
                    outputFormat: outputFormat,
                    settings: conversionSettings 
                });

            } catch (err) {
                setUiState('error');
                setError(err.message);
            }
        } 
        // 4. Handle Google Drive Files
        else if (selection.type === 'drive') {
            sendMessage('CONVERT_DRIVE_FILE', { 
                file: selection.files[0], 
                outputFormat: outputFormat,
                settings: conversionSettings
            });
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

    const renderSystemWarnings = () => {
        if (!systemHealth) return null;
        
        const missingTools = Object.keys(systemHealth).filter(key => systemHealth[key] === 'MISSING');
        
        if (missingTools.length === 0) return null;

        return (
            <div className="warning-banner" style={{ background: '#ff4444', color: 'white', padding: '10px', fontSize: '0.9rem', textAlign: 'center' }}>
                ⚠️ <strong>System Warning:</strong> The following tools are missing: {missingTools.join(', ')}. 
                Some conversions may fail. Please install them via Homebrew.
            </div>
        );
    };

    const renderSettingsModal = () => {
        if (!showSettings) return null;
        
        const openSandbox = () => window.electron.openPath('sandbox');

        // Check if Dev Mode is unlocked
        const isDevUnlocked = preferences.devMode || devClickCount >= 5;

        // --- NEW: HANDLE TOGGLE OFF ---
        const handleDevToggle = () => {
            const isTurningOff = preferences.devMode; // If it's currently true, we are turning it off
            
            toggleSetting('devMode');

            if (isTurningOff) {
                setDevClickCount(0);       // Reset the "Easter Egg" count
                setSettingsTab('general'); // Send user back to General tab
            }
        };

        return (
            <div className="settings-overlay" onClick={() => setShowSettings(false)}>
                <div className="settings-modal" onClick={e => e.stopPropagation()}>
                    
                    {/* HEADER */}
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                        <h3 style={{margin:0}}>Settings</h3>
                        <button className="icon-btn" onClick={() => setShowSettings(false)}>✕</button>
                    </div>

                    {/* TABS (Only show if Unlocked) */}
                    {isDevUnlocked && (
                        <div className="settings-tabs">
                            <button 
                                className={`tab-btn ${settingsTab === 'general' ? 'active' : ''}`} 
                                onClick={() => setSettingsTab('general')}
                            >
                                General
                            </button>
                            <button 
                                className={`tab-btn ${settingsTab === 'developer' ? 'active' : ''}`} 
                                onClick={() => setSettingsTab('developer')}
                            >
                                Developer
                            </button>
                        </div>
                    )}

                    {/* --- TAB 1: GENERAL --- */}
                    {(settingsTab === 'general' || !isDevUnlocked) && (
                        <div className="tab-content">
                            <div className="settings-row">
                                <label>🌙 Dark Mode</label>
                                <label className="switch">
                                    <input type="checkbox" checked={preferences.darkMode} onChange={() => toggleSetting('darkMode')} />
                                    <span className="slider"></span>
                                </label>
                            </div>

                            <div className="settings-row">
                                <label>✨ Auto-Reset after Download</label>
                                <label className="switch">
                                    <input type="checkbox" checked={preferences.autoReset} onChange={() => toggleSetting('autoReset')} />
                                    <span className="slider"></span>
                                </label>
                            </div>


                            {/* Easter Egg Click Area */}
                            <div 
                                style={{marginTop:'30px', fontSize:'0.8rem', color:'var(--text-secondary)', textAlign:'center', cursor: 'pointer', userSelect: 'none'}}
                                onClick={() => {
                                    // If already unlocked, do nothing
                                    if (preferences.devMode) return;

                                    const newCount = devClickCount + 1;
                                    setDevClickCount(newCount);
                                    if (newCount === 5) {
                                        alert("👨‍💻 Developer Mode Unlocked!");
                                        toggleSetting('devMode');
                                        setSettingsTab('developer'); // Auto switch to the new tab
                                    }
                                }}
                            >
                                OmniConvert v1.0.0 (Hardened Build)
                                {devClickCount > 0 && devClickCount < 5 && !preferences.devMode && (
                                    <span style={{display:'block', color:'var(--accent-color)'}}>{5 - devClickCount} steps...</span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* --- TAB 2: DEVELOPER --- */}
                    {settingsTab === 'developer' && isDevUnlocked && (
                        <div className="tab-content">
                            <div className="settings-row">
                                <label style={{color: 'var(--accent-color)'}}>Enable Developer Mode</label>
                                <label className="switch">
                                    {/* Use the new Safe Handler here */}
                                    <input type="checkbox" checked={preferences.devMode} onChange={handleDevToggle} />
                                    <span className="slider"></span>
                                </label>
                            </div>

                            {preferences.devMode && (
                                <div style={{background: 'rgba(0,0,0,0.05)', padding: '15px', borderRadius: '10px', marginTop:'10px'}}>
                                    <h4 style={{marginTop:0, fontSize:'0.9rem', marginBottom: '15px'}}>System Telemetry</h4>
                                    
                                    {/* --- TOP ACTIONS --- */}
                                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'15px'}}>
                                        <button className="secondary-button" onClick={openSandbox} style={{fontSize:'0.8rem'}}>
                                            <span style={{fontSize:'1.1rem', verticalAlign:'middle', marginRight:'5px'}}>📂</span> Open Sandbox
                                        </button>
                                        <button className="secondary-button" onClick={() => setServerLogs([])} style={{fontSize:'0.8rem'}}>
                                            <span style={{fontSize:'1.1rem', verticalAlign:'middle', marginRight:'5px'}}>🧹</span> Clear Logs
                                        </button>
                                    </div>

                                    {/* TERMINAL */}
                                    <div className="terminal-window">
                                        {serverLogs.length === 0 && <div style={{opacity:0.5}}>Waiting for logs...</div>}
                                        {serverLogs.map((log, i) => {
                                            // --- KEYWORD SCANNER ---
                                            // If it's officially an error, OR contains bad words, make it RED.
                                            const text = log.message.toLowerCase();
                                            const isError = log.level === 'ERROR' || 
                                                            text.includes('error') || 
                                                            text.includes('fail') || 
                                                            text.includes('missing') ||
                                                            text.includes('timeout') ||
                                                            text.includes('crash');
                                            
                                            return (
                                                <div key={i} className={`log-line ${isError ? 'ERROR' : 'INFO'}`}>
                                                    <span className="log-time">[{log.time}]</span>
                                                    <span className="log-msg">{log.message}</span>
                                                </div>
                                            );
                                        })}
                                        <div ref={(el) => el?.scrollIntoView({ behavior: "smooth" })} />
                                    </div>
                                    
                                    {/* --- BOTTOM ACTIONS --- */}
                                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginTop:'15px'}}>
                                        <button 
                                            className="secondary-button" 
                                            onClick={async () => {
                                                if(window.confirm("Delete all temp files?")) { 
                                                    await window.electron.clearCache(); 
                                                    alert("Sandbox Purged."); 
                                                }
                                            }}
                                            style={{fontSize:'0.8rem'}}
                                        >
                                            {/* Making the emoji slightly larger helps visibility on macOS */}
                                            <span style={{fontSize:'1.1rem', verticalAlign:'middle', marginRight:'5px'}}>🗑️</span> Clear Cache
                                        </button>

                                        <button 
                                            className="secondary-button" 
                                            onClick={() => { 
                                                // 1. Generate a fake terminal log
                                                const timeString = new Date().toISOString().split('T')[1].split('.')[0];
                                                const crashLog = {
                                                    level: 'ERROR',
                                                    message: '[UI_TEST] 💥 System halted: Simulated Crash Initiated.',
                                                    time: timeString
                                                };
                                                
                                                // 2. Push it to the terminal screen
                                                setServerLogs(prev => {
                                                    const newLogs = [...prev, crashLog];
                                                    if (newLogs.length > 100) return newLogs.slice(-100);
                                                    return newLogs;
                                                });

                                                // 3. Trigger the actual UI error screen
                                                setError("Simulated Crash"); 
                                                setUiState('error'); 
                                                setShowSettings(false); 
                                            }} 
                                            style={{fontSize:'0.8rem', background:'var(--danger-color)', color:'white', border:'none'}}
                                        >
                                            <span style={{fontSize:'1.1rem', verticalAlign:'middle', marginRight:'5px'}}>💥</span> Simulate Crash
                                        </button>
                                    </div>

                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
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
                        {/* Hidden input removed, replaced by Native logic */}
                        <div className="source-options">
                            <div 
                                className={`upload-box-wrapper ${isDragging ? 'dragging' : ''}`}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                style={{ flex: 1, display: 'flex' }}
                            >
                                <button 
                                    className="source-button" 
                                    onClick={handleNativeSelection} 
                                    style={{ width: '100%', height: '100%' }}
                                >
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
                        <div style={{fontSize: '4rem', marginBottom: '10px'}}>🎉</div>
                        <h3>Conversion Complete!</h3>
                        
                        {/* WRAPPER FOR SIDE-BY-SIDE BUTTONS */}
                        <div className="action-row">
                            <a 
                                className="primary-action download-btn" 
                                href={`http://localhost:5001${result.downloadUrl}`} 
                                download
                                onClick={() => {
                                    if (preferences.autoReset) setTimeout(() => resetState(), 1000);
                                }}
                            >
                                ⬇ Download File
                            </a>
                            
                            <button className="secondary-action" onClick={resetState}>
                                ↺ Convert Another
                            </button>
                        </div>
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
                <header style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
                    <div>
                        <h1 style={{margin:0}}>OmniConvert</h1>
                        <p style={{margin:0, opacity:0.7}}>The Ultimate File Conversion Utility</p>
                    </div>
                    {/* Gear Button */}
                    <button className="icon-btn" onClick={() => setShowSettings(true)}>⚙️</button>
                </header>
                
                {renderSystemWarnings()}
                {renderSettingsModal()} {/* <--- Render the modal here */}
                
                <main>{renderMainContent()}</main>
            </div>
        </div>
    );
}

export default App;