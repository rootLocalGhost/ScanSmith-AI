# ⚡ ScanSmith AI Studio

> **Intelligent Document Scan Digitizer, OpenCV Preprocessing & Native DOCX Synthesis Studio.**

ScanSmith AI Studio is a modern desktop application built with **Tauri v2**, **SolidJS**, **OpenCV**, and **Google Gemini AI**. It transforms rough book scans, smartphone photos, and dual-page documents into clean, properly formatted, editable Microsoft Word (`.docx`) files.

---

## ✨ Features

- **⚡ Modern Neo-Brutalist UI**: High-contrast, tactile design system with electric lime accents, custom frameless window controls, and dark/light modes.
- **📷 4-Stage Processing Pipeline**: Import ➔ OpenCV Enhancement ➔ AI OCR & Structure Extraction ➔ Native Word DOCX Export.
- **📐 Computer Vision Preprocessing**: Automated auto-orientation, perspective deskewing, margin cleanup, and dual-page splitting.
- **🤖 Multimodal Gemini Integration**: Supports `gemini-pro-latest`, `gemini-3.7-flash`, `gemini-3.5-flash`, `gemini-3.1-flash-lite`, and more.
- **📋 Extraction Presets**: Preconfigured prompts for Question Papers, Receipts & Invoices, Book Chapters, Legal Contracts, and Custom OCR.
- **📦 Multi-Platform Packaging**: Automated packages for Arch Linux (`.pkg.tar.zst`), Debian/Ubuntu (`.deb`), and Windows (`.exe`, `.msi`).

---

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh/)
- [Rust](https://www.rust-lang.org/)
- [OpenCV](https://opencv.org/) (`python3 -m pip install opencv-python numpy`)

### Development

```bash
# Run desktop development app
bun run start
```

### Packaging & Builds

```bash
# Build native Arch Linux package (.pkg.tar.zst)
bun run build:arch

# Build Debian / Ubuntu package (.deb)
bun run build:deb

# Build Windows installer (.exe / .msi)
bun run build:win
```

---

## 📜 License

MIT License © 2026 ScanSmith AI Studio
