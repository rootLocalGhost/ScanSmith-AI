# 🏗️ ScanSmith AI Studio — System Architecture

This document details the architectural layout, IPC mechanisms, multi-threaded pipelines, and data storage design of **ScanSmith AI Studio**.

---

## 1. High-Level System Architecture

```mermaid
graph TD
    User([User Scan Photos / PDF Pages]) --> UI[SolidJS Neo-Brutalist UI]
    
    subgraph "Desktop Frontend (Webview / SolidJS)"
        UI --> TabCtrl[Sidebar Tab Controller]
        UI --> Canvas[Interactive Stage & Lightbox]
        UI --> QuotaUI[Live API Quota & Usage Monitor]
    end

    UI -->|Tauri IPC Invoke| TauriBackend[Tauri v2 Rust Core]

    subgraph "Native Backend (Rust / Tokio)"
        TauriBackend --> TempMgr[Temp Directory Manager (Ephemeral)]
        TauriBackend --> PyBridge[Python Subprocess Manager]
        TauriBackend --> GeminiClient[Gemini Multimodal Client (reqwest)]
        TauriBackend --> DocxEngine[Native Word DOCX Synthesizer (docx-rs)]
        TauriBackend --> StorageMgr[Dual-Storage Manager]
    end

    subgraph "Local Vision Runtime (Python 3.12+)"
        PyBridge -->|CLI --engine| EngineRouter{Engine Router}
        EngineRouter -->|--engine neural| NeuralEngine[ScanSmith Neural AI (Auto-Detected GPU/NPU/CPU)]
        EngineRouter -->|--engine opencv| CVEngine[Classical OpenCV Pipeline (CPU Math)]
        NeuralEngine --> OpenVINO[OpenVINO Runtime + Hardware Drivers (Level-Zero / OpenCL)]
        CVEngine --> OpenCV[OpenCV + NumPy + Tesseract OSD]
    end

    subgraph "Cloud AI (Google Gemini)"
        GeminiClient -->|REST API (HTTPS)| GeminiAPI[Google Gemini 2.5/3.1/3.5 Models]
    end

    DocxEngine --> StorageMgr
    StorageMgr --> OutUser[User Output Folder]
    StorageMgr --> OutArchive[App History Archive (~/.config/scansmith_ai/history)]
```

---

## 2. Core Subsystems

### 2.1 Native Desktop Shell (Tauri v2)
- **Framework**: Tauri v2 (`src-tauri/`) using native WebKitGTK on Linux, WebView2 on Windows.
- **Benefits**: Near-zero memory footprint compared to Electron (< 80 MB baseline RAM), fast native thread execution, and secure sandboxed system calls.
- **Frameless Window Management**: Custom titlebar with minimize, maximize/unmaximize, and close handlers, integrated with native window shadow and resize borders.

### 2.2 Frontend Layer (SolidJS + TypeScript)
- **File**: `src/App.tsx`, `src/App.css`
- **Reactivity Model**: SolidJS fine-grained signals (`createSignal`, `createMemo`, `createEffect`) ensure surgical DOM updates without virtual DOM diffing overhead.
- **Design System**: Neo-brutalist styling:
  - 3px solid ink borders (`#121826`).
  - High-contrast color tokens: Electric Purple (`#7c3aed`), Cyan (`#0284c7`), Emerald (`#059669`).
  - Hard rectangular shadows (`box-shadow: 3px 3px 0px #121826`).
- **High-Density Non-Scrolling Sidebar**:
  - Engineered to fit all essential correction tools into `< 300px` height.
  - Interactive 2-column chip toggles with instant checkmark feedback.
  - Horizontally segmented engine switch and 4-pill enhancement style selector.
- **Draggable & Retractable Drawer**:
  - Border resizer handle clamped between `280px` and `650px`, saved in `localStorage`.
  - Header retract button (`◀`) animates width to `0px` with `overflow: hidden`, allocating 100% of workspace width to the document canvas.
  - Floating pill button (`▶ Panel [⚡ AI / 📐 CV]`) enables one-click reopening.

### 2.3 Local Processing Subprocess (`scansmith_cv.py`)
- **Execution**: Spawned from Rust via `std::process::Command` to isolate compute-heavy native C++ and OpenVINO libraries from the GUI process.
- **Inter-Process Protocol**:
  - Arguments passed via CLI flags: `--split`, `--orient`, `--deskew`, `--margins`, `--shadows`, `--denoise`, `--mode`, `--engine`, `--overrides`.
  - Diagnostics and results communicated via standard JSON payloads on `stdout`.
  - GPU hardware queries supported via `--check-neural-gpu`.

### 2.4 Ephemeral Workspace & RAII Lifecycle
- **Location**: System temporary directory (`/tmp/scansmith_<random>`).
- **Guaranteed Cleanup**:
  - The path is isolated from user working directories.
  - Managed via an atomic cleanup routine executed when Tauri exits or when a new session begins.
  - Prevents gigabytes of processed intermediate scans from cluttering user disks.

### 2.5 Dual-Storage Output Engine
To prevent accidental document loss, every synthesized `.docx` is written to two locations in parallel:
1. **User Working Directory**: Alongside the user's source scan photos for immediate access.
2. **App History Archive**: A permanent local repository located at `~/.config/scansmith_ai/history/`.
3. **Collision Prevention**:
   - Filenames are dynamically deduplicated using a monotonic incrementer (`Filename (1).docx`, `Filename (2).docx`).
   - Supports **AI Smart Naming**, where Gemini inspects document headings and extracts a concise, semantic filename.

---

## 3. Communication Protocols & Dataflow

| Stage | Producer | Consumer | Format | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Hardware Detection** | `scansmith_cv.py` | Rust `get_neural_engine_status` | JSON (`stdout`) | Queries OpenVINO available devices (`GPU`, `CPU`). |
| **Image Preprocessing** | Rust `preprocess_images` | `scansmith_cv.py` | CLI Args + File paths | Processes images in-place or into temp directory. |
| **Progress Reporting** | Rust Backend | SolidJS Frontend | Tauri Event (`progress-update`) | Emits percentage (`0`–`100%`) and descriptive message. |
| **Cloud OCR Request** | Rust Backend | Google Gemini API | HTTPS POST (JSON) | Sends image bytes as base64 with preset instructions. |
| **Word DOCX Output** | Rust `docx-rs` | Local Filesystem | Binary `.docx` (ZIP of XMLs) | Builds runs, headings, equations, and tables. |
