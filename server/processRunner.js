const { spawn } = require('child_process');

function runSafeJob(tool, args, options = {}) {
    return new Promise((resolve, reject) => {
        const timeoutMs = options.timeoutMs || 120000;
        
        // --- THIS LINE IS CRITICAL ---
        // It forces the tool to run inside the Job Folder, not Root
        const workingDir = options.cwd || process.cwd(); 

        const child = spawn(tool, args, {
            cwd: workingDir, // <--- Apply it here
            env: process.env, 
            detached: false,
            stdio: 'pipe' 
        });

        let stdout = '';
        let stderr = '';

        const timer = setTimeout(() => {
            if (!child.killed) {
                child.kill('SIGTERM'); 
                setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 2000);
                reject(new Error(`Job timed out after ${timeoutMs/1000}s`));
            }
        }, timeoutMs);

        if (child.stdout) child.stdout.on('data', (data) => stdout += data.toString());
        if (child.stderr) child.stderr.on('data', (data) => stderr += data.toString());

        child.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`Failed to spawn ${tool}: ${err.message}`));
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                reject({ 
                    message: `Tool ${tool} exited with code ${code}`,
                    stderr: stderr.slice(-1000) 
                });
            }
        });
    });
}
module.exports = { runSafeJob };