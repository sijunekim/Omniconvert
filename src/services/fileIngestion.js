const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
// Import the new list
const { MAX_INPUT_SIZE_BYTES, BLOCKED_MIMES, ALLOWED_EXTENSIONS, TEXT_EXTENSIONS } = require('../config/security');

async function getFileType(filePath) {
  const { fileTypeFromFile } = await import('file-type');
  return await fileTypeFromFile(filePath);
}

async function ingestFile(rawFilePath, safeStorageDir) {

  rawFilePath = rawFilePath.normalize('NFC'); 
  
  // 1. Basic Validation
  if (!await fs.pathExists(rawFilePath)) {
    throw new Error('FILE_MISSING: The file could not be found.');
  }

  const stats = await fs.stat(rawFilePath);
  if (stats.size > MAX_INPUT_SIZE_BYTES) {
    throw new Error(`FILE_TOO_LARGE: Max size is ${MAX_INPUT_SIZE_BYTES / 1024 / 1024}MB.`);
  }

  // 2. Magic Byte Detection
  let detection = await getFileType(rawFilePath);
  let finalExt = '';
  let finalMime = '';

  // --- LOGIC UPDATE STARTS HERE ---
  if (detection) {
    // Case A: Binary Signature Found (Images, Videos, PDFs, Exes)
    
    // Check if it's a disguised virus (e.g. virus.exe renamed to note.txt)
    if (BLOCKED_MIMES.includes(detection.mime)) {
      throw new Error('SECURITY_RISK: File type rejected (Executable/Script detected).');
    }
    
    finalExt = detection.ext;
    finalMime = detection.mime;

  } else {
    // Case B: No Signature (Text Files: HTML, TXT, CSV)
    
    // Get the extension from the filename (e.g. '.html' -> 'html')
    const ext = path.extname(rawFilePath).toLowerCase().replace('.', '');
    
    // Check if this extension is allowed to be "Plain Text"
    if (TEXT_EXTENSIONS.includes(ext)) {
      finalExt = ext;
      finalMime = 'text/plain'; // Generic mime for text
    } else {
      // It's unknown AND not a known text type. Block it.
      throw new Error('SECURITY_RISK: Could not identify file type.');
    }
  }
  // --- LOGIC UPDATE ENDS HERE ---

  // 3. UUID Sanitization
  const internalId = crypto.randomUUID();
  const safeFilename = `${internalId}.${finalExt}`;
  const safePath = path.join(safeStorageDir, safeFilename);

  // 4. Isolation
  await fs.ensureDir(safeStorageDir);
  await fs.copy(rawFilePath, safePath);

  console.log(`[Security] Ingested: ${rawFilePath} -> ${safePath}`);

  return {
    id: internalId,
    safePath: safePath,
    originalPath: rawFilePath,
    originalName: path.basename(rawFilePath),
    detectedExt: finalExt,
    mime: finalMime,
    size: stats.size
  };
}

module.exports = { ingestFile };