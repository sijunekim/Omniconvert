class AppError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

const ERROR_CODES = {
    INPUT_ERROR: 'INPUT_ERROR',        // File is empty or corrupted
    UNSUPPORTED: 'UNSUPPORTED_FORMAT', // We don't support .xyz
    TOOL_MISSING: 'TOOL_MISSING',      // FFmpeg/Magick not installed
    TOOL_CRASH: 'TOOL_CRASH',          // The tool failed (exit code 1)
    TIMEOUT: 'JOB_TIMEOUT',            // Took too long
    SECURITY_RISK: 'SECURITY_RISK',    // Zip bomb or malicious file
    SYSTEM_ERROR: 'INTERNAL_ERROR'     // Disk full, etc.
};

module.exports = { AppError, ERROR_CODES };