# 📖 ScanSmith AI Studio — Technical Documentation Hub

Welcome to the official technical documentation for **ScanSmith AI Studio**, a high-performance desktop document scan digitizer, computer vision restoration engine, and native Microsoft Word (`.docx`) synthesis studio.

---

## 📚 Documentation Index

| Guide | Description |
| :--- | :--- |
| **[Architecture Overview](ARCHITECTURE.md)** | End-to-end system design, Tauri v2 IPC, Rust backend, SolidJS frontend, and pipeline dataflow. |
| **[ScanSmith Neural AI Engine](NEURAL_ENGINE.md)** | Deep dive into the DocRes Restormer model, dynamic system hardware acceleration, OpenVINO FP16, and tensor execution. |
| **[Classical Computer Vision Pipeline](CV_PIPELINE.md)** | Algorithms for dual-page book splitting, auto-orientation, deskew, margins, shadow removal, and despeckling. |
| **[Gemini OCR & DOCX Synthesis](GEMINI_DOCX_SYNTHESIS.md)** | Multimodal prompt architecture, presets, AI Smart Naming, and native Word XML generation via Rust. |
| **[API Quota & Usage Guide](API_QUOTA_AND_LIMITS.md)** | Daily request ceilings, token metrics, Pacific Time midnight rollover, and rate limit tiers. |
| **[User Guide & Workflows](USER_GUIDE.md)** | Step-by-step instructions on importing scans, tuning the UI, choosing engines, and exporting documents. |

---

## ⚡ Core Highlights

- **Dual Restoration Engines**:
  - **ScanSmith Neural AI Engine**: Deep-learning document appearance restoration powered by DocRes (CVPR 2024 / Restormer) hardware-accelerated on your system's auto-detected GPU/accelerator via **OpenVINO FP16**.
  - **Classical OpenCV Engine**: Lightweight, instant CPU mathematical vision pipeline for high-speed batch corrections.
- **High-Density Non-Scrolling Interface**:
  - Tactile Neo-Brutalist design where all correction controls, engine toggles, and styles fit into `< 300px` without requiring vertical scrolling.
  - Draggable resizer (`280px`–`650px`) and full `0px` retraction with floating canvas expander.
- **AI-Powered Native DOCX Engine**:
  - Direct synthesis of editable Microsoft Word documents from Google Gemini multimodal analysis.
  - Preserves complex tables, headings, and multilingual fonts (including Tiro Bangla and Calibri).
  - AI Smart Filename generator and dual-storage persistence (User Folder + Guaranteed History Archive).
