const { spawn } = require('child_process');
const fs = require('fs');

const TOOLS = {
    ffmpeg: { cmd: 'ffmpeg', args: ['-version'] },
    magick: { cmd: 'magick', args: ['-version'] },
    pandoc: { cmd: 'pandoc', args: ['--version'] },
    // On macOS, we check the specific path for LibreOffice & Calibre
    libreoffice: { 
        path: '/Applications/LibreOffice.app/Contents/MacOS/soffice',
        args: ['--version'] 
    },
    calibre: { 
        path: '/Applications/calibre.app/Contents/MacOS/ebook-convert', 
        args: ['--version'] 
    },
    ghostscript: { cmd: 'gs', args: ['--version'] } // Critical for PDF->Image
};

function checkTool(name) {
    return new Promise((resolve) => {
        const toolDef = TOOLS[name];
        
        // If it's a specific path (LibreOffice/Calibre), check file existence first
        if (toolDef.path) {
            if (fs.existsSync(toolDef.path)) {
                resolve({ tool: name, status: 'OK' });
            } else {
                resolve({ tool: name, status: 'MISSING' });
            }
            return;
        }

        // For global commands (ffmpeg, magick), try to run them
        const child = spawn(toolDef.cmd, toolDef.args);
        
        child.on('error', () => {
            resolve({ tool: name, status: 'MISSING' });
        });

        child.on('close', (code) => {
            resolve({ tool: name, status: code === 0 ? 'OK' : 'MISSING' });
        });
    });
}

async function runSelfTest() {
    console.log('[SelfTest] Starting diagnostic...');
    const results = {};
    
    // Check all tools in parallel
    const checks = Object.keys(TOOLS).map(key => checkTool(key));
    const outcomes = await Promise.all(checks);

    outcomes.forEach(o => {
        results[o.tool] = o.status;
        console.log(`[SelfTest] ${o.tool}: ${o.status}`);
    });

    return results;
}

module.exports = { runSelfTest };