const yauzl = require('yauzl');
const { AppError, ERROR_CODES } = require('./errors'); // Make sure you created errors.js earlier!

// --- SECURITY QUOTAS ---
const LIMITS = {
    MAX_FILES: 2000,                  // Max files allowed inside one zip
    MAX_SIZE: 2 * 1024 * 1024 * 1024, // Max uncompressed size (2 GB)
    BLOCK_NESTED: true                // Block zips inside zips
};

/**
 * Scans a zip file WITHOUT extracting it.
 * Reads headers to detect Zip Bombs and malicious paths.
 */
function scanArchive(filePath) {
    return new Promise((resolve, reject) => {
        let fileCount = 0;
        let totalUncompressedSize = 0;
        let isRejected = false;

        yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(new AppError(ERROR_CODES.INPUT_ERROR, 'Invalid or corrupted archive'));

            zipfile.readEntry();

            zipfile.on('entry', (entry) => {
                if (isRejected) return;

                // 1. CHECK: Zip Bomb (Total Size)
                totalUncompressedSize += entry.uncompressedSize;
                if (totalUncompressedSize > LIMITS.MAX_SIZE) {
                    isRejected = true;
                    zipfile.close();
                    return reject(new AppError(ERROR_CODES.SECURITY_RISK, 'Archive exceeds max uncompressed size (Zip Bomb Risk)'));
                }

                // 2. CHECK: File Count Denial of Service
                fileCount++;
                if (fileCount > LIMITS.MAX_FILES) {
                    isRejected = true;
                    zipfile.close();
                    return reject(new AppError(ERROR_CODES.SECURITY_RISK, 'Archive contains too many files'));
                }

                // 3. CHECK: Nested Archives (Recursive Bombs)
                // If we see a zip inside a zip, we block it.
                if (LIMITS.BLOCK_NESTED && entry.fileName.match(/\.(zip|rar|7z|tar|gz)$/i)) {
                    isRejected = true;
                    zipfile.close();
                    return reject(new AppError(ERROR_CODES.SECURITY_RISK, 'Nested archives are not allowed'));
                }

                // 4. CHECK: Path Traversal (The "Hacker Hat 3" check but for Zips)
                if (entry.fileName.includes('../') || entry.fileName.startsWith('/')) {
                    isRejected = true;
                    zipfile.close();
                    return reject(new AppError(ERROR_CODES.SECURITY_RISK, 'Archive contains malicious file paths'));
                }

                // If safe, read next file
                zipfile.readEntry();
            });

            zipfile.on('end', () => {
                if (!isRejected) {
                    resolve({ fileCount, totalSize: totalUncompressedSize });
                }
            });

            zipfile.on('error', (err) => {
                if (!isRejected) reject(new AppError(ERROR_CODES.INPUT_ERROR, 'Error reading archive structure'));
            });
        });
    });
}

module.exports = { scanArchive };