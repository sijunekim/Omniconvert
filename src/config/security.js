// src/config/security.js

module.exports = {
  // 1. LIMITS: 2GB input limit (Hard cap)
  MAX_INPUT_SIZE_BYTES: 2 * 1024 * 1024 * 1024, 


  // Extensions that rarely have magic bytes (Plain Text)
  TEXT_EXTENSIONS: [
    'html', 'htm', 'txt', 'csv', 'xml', 'css', 'json', 'md', 'svg', 'rtf'
  ],

  
  // 2. DENY LIST: MIME types that are strictly forbidden
  // These are dangerous executables and scripts.
  BLOCKED_MIMES: [
    'application/x-dosexec',    // .exe, .dll
    'application/x-msdownload', // .exe
    'application/x-sh',         // .sh script
    'application/x-bat',        // .bat script
    'application/javascript',   // .js files
    'application/java-archive', // .jar
    'application/x-shockwave-flash' // .swf
  ],

  // 3. SAFE EXTENSIONS: We only allow these if the magic bytes MATCH.
  // This acts as a secondary whitelist.
  ALLOWED_EXTENSIONS: [
    // Images
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'tiff', 'bmp', 'svg',
    // Documents
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt',
    // Audio
    'mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a',
    // Video
    'mp4', 'mov', 'mkv', 'avi', 'webm',
    // Archives
    'zip', 'rar', '7z', 'tar', 'gz'
  ]
};