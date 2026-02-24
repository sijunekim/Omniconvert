# 🛡️ OmniConvert
> **The Zero-Trust, Offline-First Desktop Media Pipeline**

**OmniConvert** is a comprehensive, security-hardened file conversion utility built with **Electron**, **React**, and **Node.js**. 

I engineered this project from scratch (starting at age 13) to solve a fundamental problem: online file converters are fragmented, ad-riddled, and force users to upload private files to unknown servers. OmniConvert brings enterprise-grade conversion engines directly to the user's local machine, ensuring **100% privacy, offline capability, and no file-size limits.**

![OmniConvert UI](https://via.placeholder.com/800x450.png?text=Add+Screenshot+Of+Your+App+Here)

---

## ✨ Application Features

### 🔄 Universal Conversion Engine (100+ Formats)
*   **Video & Audio:** Full format swapping, resolution scaling, and bitrate controls (`FFmpeg` & `ffprobe`).
*   **Documents:** Cross-suite conversion (DOCX, PDF, HTML, TXT, RTF) with layout preservation (`LibreOffice Headless` & `Pandoc`).
*   **Images & Vectors:** RAW photo processing, SVG/EPS vector rendering, and Apple HEIC support (`ImageMagick`, `dcraw`, & `Sharp`).
*   **eBooks & 3D Models:** EPUB/MOBI generation and CAD format interoperability (`Calibre` & `Assimp`).
*   **Archives:** Extract ZIP, RAR, 7Z, TAR safely.

### ☁️ Resilient Cloud Bridge (Google Drive)
*   Native Google Drive OAuth 2.0 integration.
*   Browse, search, and securely download cloud files directly inside the app.
*   **Offline-First:** Decouples the download and conversion phases. Once a cloud file is secured locally, conversion proceeds entirely offline, preventing data loss during network drops.

### 🎨 Premium UI / UX
*   **Native Integration:** Uses macOS/Windows native file dialogs for secure file selection.
*   **Dynamic Theme Engine:** Pure CSS-variable-based Glassmorphism UI with smooth transitions between Light Mode and "Midnight Glass" Dark Mode.
*   **Real-Time Feedback:** WebSockets push live progress bars (1%... 50%... 100%) from backend C++ binaries directly to the React frontend.

---

## 🔒 Security Engineering (Defense-in-Depth)

To ensure OmniConvert could handle malicious files without compromising the host OS, I implemented a strict **4-Layer Security Architecture**:

1.  **Zero-Trust Ingestion ("The Bouncer"):** Ignores user-provided file extensions. Analyzes **Magic Bytes** (binary signatures) to detect disguised malware (e.g., `virus.exe` renamed to `invoice.pdf`).
2.  **Process Sandboxing:** Eliminated Command Injection by strictly using Node's `spawn()` with argument arrays instead of `exec()`.
3.  **Privacy Vaults:** Strips original filenames and assigns cryptographic UUIDs to prevent **Path Traversal** attacks.
4.  **Anti-DoS (Zip Bomb Protection):** Uses a streaming parser (`yauzl`) to scan `.zip` headers *before* extraction. Aborts if it detects Matryoshka bombs (nested zips) or compression ratios > 2GB.

---

## 🧠 Major Engineering Struggles & Solutions

Building a bridge between a React UI, a Node.js microservice, and raw C++ binaries resulted in severe edge cases. Here is how I solved them.

### Struggle 1: The "Korean Filename" Ghostscript Crash
*   **The Problem:** When converting PDFs to Images, the underlying Ghostscript engine would silently crash (Exit Code 1) if the filename contained Unicode characters (Korean, Emojis, or brackets like `[Final].pdf`).
*   **The Solution:** I engineered a **"Clean Room" Strategy**. The app generates an isolated UUID folder, copies the Unicode file into it under a safe ASCII name (`source.pdf`), and forces the CLI tool to run exclusively inside that directory (`cwd: jobDir`). 

### Struggle 2: Unpredictable Output Names & "Junk" Files
*   **The Problem:** Tools like LibreOffice ignore requested output names and name files based on internal PDF metadata (e.g., `source.pdf` becomes `KoreanTitle.html`). Furthermore, ImageMagick dumps `.map` sidecar files into the root directory, causing the server to crash with "Output Missing".
*   **The Solution:** By isolating jobs in the "Clean Room", I implemented a **Fuzzy Finder Algorithm**. The server scans the isolated folder for *any* file matching the target extension, renames it to the expected UUID, and then completely nukes the folder—automatically wiping out any zombie sidecar files.

### Struggle 3: React Strict Mode vs. WebSocket Handshakes
*   **The Problem:** The app's auth state was desyncing, and the real-time developer terminal was receiving duplicate logs. React's Strict Mode was mounting the component twice, creating "ghost" WebSocket connections.
*   **The Solution:** I mastered `useEffect` cleanup functions. I returned a dismount function that actively destroys IPC listeners (`removeListener`) and closes sockets. I also updated the backend to auto-broadcast a `LOG_HISTORY` buffer upon connection, ensuring the terminal UI is perfectly synced regardless of render cycles.

### Struggle 4: Silent Network Drops (Google Drive)
*   **The Problem:** If a user's WiFi disconnected halfway through streaming a 1GB file from Google Drive, the Node stream wouldn't throw an error; it would hang indefinitely, freezing the app forever.
*   **The Solution:** I wrapped the `fs.createWriteStream` in a **Watchdog Timer**. If the stream doesn't emit an `'end'` event within a strict 120-second timeframe, the server aggressively destroys the socket (`res.data.destroy()`), wipes the corrupted file, and pushes a safe Error state to the UI.

### Struggle 5: FFmpeg M4A/M4R Rejection
*   **The Problem:** Asking FFmpeg to output `.m4a` via `cmd.toFormat('m4a')` causes an instant crash because FFmpeg doesn't recognize "m4a" as a container format.
*   **The Solution:** I wrote custom routing logic to intercept Apple audio formats, mapping them to the internal `ipod` format container and forcing the `aac` audio codec.

---

## 👨‍💻 Developer Mode & Telemetry

I built a hidden developer dashboard for debugging without an IDE. 
*   **The Secret Handshake:** Clicking the App Version text 5 times unlocks a hidden "Developer" tab.
*   **In-App Terminal:** Hooks into Node's `console.log` and `console.error`, broadcasting backend telemetry to a custom-styled React terminal with keyword-based syntax highlighting (Errors turn red).
*   **System Health:** On startup, the app automatically pings the host OS to verify the installation of `ffmpeg`, `magick`, `pandoc`, etc., displaying a health matrix and degrading gracefully if tools are missing.

---

## 💻 Tech Stack

| Component | Technologies Used |
| :--- | :--- |
| **Frontend** | React.js, CSS3 (Glassmorphism, CSS Variables) |
| **Backend** | Node.js, Express, WebSockets (`ws`), Multer |
| **Desktop Core** | Electron (Context Isolation, Native IPC) |
| **Engines** | FFmpeg, ImageMagick, LibreOffice (Headless), Pandoc, Yauzl |

---

## 🚀 How to Run Locally

**Prerequisites:**
Ensure you have Node.js installed, along with the underlying conversion binaries for your OS (e.g., `brew install ffmpeg imagemagick ghostscript pandoc unar`).

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/OmniConvert.git

# 2. Install dependencies (Root, Server, and Client)
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# 3. Start Development Mode
npm run electron:dev

# 4. Build for Production (.app / .dmg / .exe)
npm run dist



Here is the story of how OmniConvert evolved. It is the story of a project that started as a 13-year-old’s "learning to code" experiment and rapidly mutated into a professional, enterprise-grade desktop application.


🌱 Phase 1: The "Make It Work" Prototype (Oct 2025 - Jan 2026)
The Goal: Build a "Swiss Army Knife" to replace sketchy online converters.
Where you started:
Basic Web Stack: You started with a simple React frontend and an Express Node.js backend.
Simple Uploads: You used standard HTTP requests to upload files. If a file was too big or took too long, the browser would just freeze or time out.
Basic Routing: The server looked at the file extension (e.g., .pdf) to decide what tool to use.
The "Dependency Hell": You successfully wrapped the web app into a macOS Desktop app using Electron, but had to fight through native C++ binary crashes (like sharp) using @electron/rebuild.
Cloud MVP: You added Google Drive OAuth, storing session tokens locally so users didn't have to re-login every time the app restarted.
The Reality: It worked, but it was fragile. It trusted the user too much.
🛡️ Phase 2: The "Zero-Trust" Hardening (The Turning Point)
The Goal: Stop acting like a beginner and start engineering for security.
You realized that trusting file extensions and names is how computers get hacked. You implemented a Defense-in-Depth architecture.
The Bouncer (Magic Bytes): You stopped looking at extensions. You installed file-type to read the binary headers of uploaded files. If someone renamed a virus.exe to invoice.pdf, your new code caught the lie and killed it instantly.
The Privacy Vault: You stopped saving files with their original names (which prevents hackers from using names like ../../system32/ to delete computer files). You converted all incoming files to random cryptographic UUIDs.
Anti-Zip Bombs: You added a streaming parser (yauzl) to scan archives before extracting them. You set quotas to block Matryoshka (nested) bombs and files that uncompress to 100GB, preventing Denial of Service (DoS) attacks.
🏗️ Phase 3: The "Clean Room" Architecture (Systems Engineering)
The Goal: Stop the app from crashing when C++ tools behave unpredictably.
The hardest bugs you faced were tools like ImageMagick and LibreOffice silently crashing or leaving junk files (.map files) on your hard drive.
Killing the Shell: You removed dangerous exec() commands and replaced them with spawn(), treating filenames as raw data rather than executable code. You added strict 3-minute timeouts and memory limits so the app would never freeze.
The Unicode / Korean Filename Fix: Ghostscript and LibreOffice would crash if a file was named 26년 정규 수업.pdf or had brackets like [Final]. You engineered a brilliant Clean Room Strategy:
Create an isolated job_UUID folder.
Copy the file inside and rename it to a safe, purely English name (source.pdf).
Run the tool exclusively inside that folder (cwd: jobDir).
Scan the folder for whatever file the tool spit out (Fuzzy Finding), move it, and nuke the entire folder to clean up temporary junk files.
🎨 Phase 4: The Professional Polish (UX & Telemetry)
The Goal: Make it look and feel like a $50 premium Mac app.
Native Integration: You ripped out the clunky browser HTML upload buttons and wired up Electron's Native macOS/Windows File Dialogs.
Real-Time WebSockets: You replaced HTTP requests with a continuous WebSocket connection. You hooked into FFmpeg's ffprobe to stream actual 1%... 5%... 100% progress bars for video, and built mathematical "simulated" progress bars for silent tools like LibreOffice.
Dynamic Theming: You built a pure CSS-variable engine to support a sleek "Midnight Glass" Dark Mode with inset shadows and side-by-side flexbox action buttons.
The Secret Developer Dashboard: Instead of just a generic error screen, you built a hidden telemetry dashboard. Users unlock it by clicking the version number 5 times (like Android developer mode). It intercepts Node.js console.log events and streams them to a hacker-style terminal in the UI, highlighting errors in red.
Self-Healing Diagnostics: When the app opens, it silently pings the OS to check if FFmpeg, Pandoc, and Ghostscript are actually installed, warning the user if dependencies are missing.
🏆 The Summary of Your Growth
October 2025: "How do I upload a file to a Node server?"
February 2026: "I am orchestrating isolated C++ child processes inside dynamic sandboxes, validating binary magic bytes over WebSocket streams, and mitigating filesystem race conditions."