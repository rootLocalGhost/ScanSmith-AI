# ⚡ ScanSmith AI Studio

> **Intelligent Document Scan Digitizer, Hardware-Accelerated Neural Vision Restoration & Native DOCX Synthesis Studio.**

ScanSmith AI Studio is a high-performance desktop application built with **Tauri v2**, **SolidJS**, **OpenVINO (Auto-Detected GPU/NPU/CPU Acceleration)**, **OpenCV**, and **Google Gemini Multimodal AI**. It transforms camera photos, degraded scans, and two-page book spreads into clean, structured, editable Microsoft Word (`.docx`) files.

---

## ✨ Features at a Glance

### ⚡ ScanSmith Neural AI Engine (Dynamic Hardware Acceleration)
- **Deep Visual Transformer**: Uses the **DocRes (CVPR 2024 / Restormer)** architecture converted to OpenVINO FP16.
- **Dynamic System Hardware Detection**: Automatically detects and queries your host system's GPU (e.g. Intel Arc, Iris Xe, NVIDIA GeForce, AMD Radeon), NPU, or CPU at runtime via OpenVINO without hardcoded configurations.
- **Hardware Acceleration**: Executes fast matrix operations using available hardware acceleration (such as Intel Level-Zero and Xe Matrix Extensions XMX FP16 kernels) with automatic fallback.
- **Problem Scan Eradication**: Eliminates reverse-side bleed-through/show-through text, book spine shadows, and page creases with zero front-page ink loss.

### 📐 High-Speed Classical Computer Vision Pipeline
- **Dual-Page Spread Splitting**: Automated valley-profile detection to split open book scans into separate single pages.
- **Tesseract OSD Orientation**: Automated 90°/180°/270° orientation detection.
- **Radon Projection Variance Deskew**: Straightens skewed documents with sub-degree accuracy.
- **Edge Trimming & Uniform Margins**: Eliminates dark scanner borders and applies clean white margins.
- **Illumination Equalization & Despeckle**: Morphological background division and 8-connectivity toner speckle purge.

### 🖥️ High-Density, Non-Scrolling Neo-Brutalist Interface
- **All Controls in View**: Thoughtfully engineered so that all correction tools, engine toggles, styles, and action buttons fit into `< 300px` without vertical scrolling.
- **Resizable & Retractable Sidebar**: Drag handle on the right border (`280px`–`650px`) and full `0px` retraction (`◀`) to maximize canvas space, with a floating reopen button (`▶ Panel`).
- **Engine & Device Transparency**: High-contrast hero indicators dynamically display the detected hardware name (e.g., active GPU model) or classical CPU fallback.

### 📝 Gemini Multimodal OCR & Native DOCX Synthesis
- **Structure-Aware Extraction**: Powered by Google Gemini (`gemini-2.5-flash`, `gemini-3.7-flash`, `gemini-pro-latest`).
- **LaTeX Math & Tables**: Extracts inline `$math$`, display `$$equations$$`, and complex multi-column tables.
- **Multilingual Typography**: Native support for Latin scripts, Bengali/Bangla (`Tiro Bangla`), Arabic, Devanagari, and CJK.
- **Native WordprocessingML**: Constructs native `.docx` files via Rust `docx-rs` (no fragile HTML-to-DOCX conversions).
- **AI Smart Name (`✨`)**: Automatically generates semantic filenames from document titles and subjects.
- **Dual-Storage & Zero Collision**: Saves simultaneously to your working folder and a permanent local archive (`~/.config/scansmith_ai/history/`), incrementing filenames (`Doc (1).docx`) to prevent overwrites.

### 📊 Live API Quota & Usage Monitor
- **Model-Tier Limits**: Live tracking of Daily Request Limits (RPD) and RPM across Flash (1,500 RPD) and Pro (50 RPD) tiers.
- **Midnight Pacific Time Rollover**: Tracks exact reset countdowns based on Google's midnight PT schedule.
- **Token Analytics**: Real-time aggregation of Prompt and Candidate tokens via Rust `usageMetadata`.

---

## 📚 In-Depth Technical Documentation

Comprehensive documentation is available in the [`docs/`](docs/) directory:

- 📖 **[Documentation Index](docs/README.md)** — Central documentation hub.
- 🏗️ **[System Architecture](docs/ARCHITECTURE.md)** — Tauri v2 IPC, multi-threading, ephemeral temp lifecycle, and data flow.
- ⚡ **[ScanSmith Neural AI Engine](docs/NEURAL_ENGINE.md)** — DocRes Restormer, OpenVINO FP16, Intel Arc XMX kernels, and tensor shaping.
- 📐 **[Classical Computer Vision Pipeline](docs/CV_PIPELINE.md)** — Radon deskew, spine splitting, Tesseract OSD, and despeckle algorithms.
- 📝 **[Gemini OCR & DOCX Synthesis](docs/GEMINI_DOCX_SYNTHESIS.md)** — Prompt presets, LaTeX math, typography, and native OOXML generation.
- 📊 **[API Quota & Usage Guide](docs/API_QUOTA_AND_LIMITS.md)** — Gemini rate limit tiers, token counters, and Pacific Time rollover.
- 🧭 **[User Guide & Workflows](docs/USER_GUIDE.md)** — Step-by-step instructions for importing, tuning, and exporting.

---

## 🚀 Quick Start

### Prerequisites

1. **Node / Bun**: [Bun](https://bun.sh/) (v1.1+) or Node.js (v20+).
2. **Rust & Cargo**: [Rust toolchain](https://www.rust-lang.org/) (v1.75+).
3. **Python Vision Environment**:
   ```bash
   python3 -m pip install opencv-python numpy pytesseract openvino
   ```
4. **Intel Arc GPU Acceleration (Optional but Recommended)**:
   - Install Intel Compute Runtime and Level-Zero driver (`intel-compute-runtime`, `level-zero-loader` on Arch/Ubuntu).
   - Ensure the user is part of the `render` or `video` group: `sudo usermod -aG render $USER`.

### Running Locally

```bash
# Install frontend dependencies
bun install

# Launch desktop application in development mode
bun run start
```

### Automated Packaging & Distribution

```bash
# Build native Arch Linux package (.pkg.tar.zst)
bun run build:arch

# Build Debian / Ubuntu package (.deb)
bun run build:deb

# Build Windows installer (.exe / .msi)
bun run build:win
```

---

## 🏛️ Project Structure

```
├── docs/                      # Comprehensive technical documentation
│   ├── ARCHITECTURE.md        # System design & IPC
│   ├── NEURAL_ENGINE.md       # Hardware Acceleration & DocRes Restormer
│   ├── CV_PIPELINE.md         # Classical OpenCV algorithms
│   ├── GEMINI_DOCX_SYNTHESIS.md# Multimodal OCR & DOCX generation
│   ├── API_QUOTA_AND_LIMITS.md# Quotas, rate limits & tokens
│   └── USER_GUIDE.md          # Step-by-step user guide
├── models/                    # OpenVINO FP16 Neural IR models
│   ├── docres_fp16.xml        # DocRes model graph
│   └── docres_fp16.bin        # Quantized FP16 weights (29 MB)
├── scansmith_cv.py            # Local vision runtime & CLI interface
├── src/                       # SolidJS Neo-Brutalist UI
│   ├── App.tsx                # Main workspace, signals, and controls
│   └── App.css                # High-density responsive stylesheet
└── src-tauri/                 # Tauri v2 Rust native core
    ├── src/
    │   ├── main.rs            # Application entrypoint
    │   └── lib.rs             # Tauri commands, DOCX synthesis & IPC
    └── Cargo.toml             # Rust dependencies
```

---

## 📜 License

PolyForm Noncommercial License 1.0.0 © 2026 ScanSmith AI Studio
