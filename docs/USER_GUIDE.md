# 📖 ScanSmith AI Studio — User Guide & Workflows

A practical, step-by-step guide for getting the most out of **ScanSmith AI Studio**.

---

## 1. Initial Setup: Adding Your Gemini API Key

1. Launch ScanSmith AI Studio.
2. Click the **⚙️ Settings** icon in the top-right corner of the application window.
3. Paste your **Google Gemini API Key**.
   - *Don't have a key?* Click the link inside the dialog to generate one for free from [Google AI Studio](https://aistudio.google.com/app/apikey).
4. Click **Save Settings**. Your API key is securely encrypted and persisted locally on your device.

---

## 2. Importing Scanned Images

- **Drag & Drop**: Drag one or more images (`.jpg`, `.jpeg`, `.png`, `.webp`) directly onto the central canvas.
- **File Picker**: Click the **Import Scans** button in the header or on the empty stage.
- **Reordering & Deletion**:
  - The left stage list shows your imported pages in sequential order.
  - Hover over any page thumbnail to delete, reorder, or preview it in high resolution.

---

## 3. Sidebar Controls & Workspace Customization

### 3.1 Resizing the Sidebar
- Hover over the right border of the left sidebar. The cursor will change to a horizontal resize cursor (`↔`).
- Click and drag to expand (up to `650px`) or shrink (down to `280px`).
- Your preferred width is automatically saved and remembered across app sessions.

### 3.2 Full 0px Retraction (Maximize Document Canvas)
- Click the **`◀`** retract button located at the top-right of the sidebar tab bar.
- The sidebar smoothly animates to `0px`, giving your document canvas 100% of the screen width.
- To reopen the sidebar, click the floating **`▶ Panel`** button that appears on the top-left of the canvas.

---

## 4. Selecting Your Processing Engine

In the **⚡ Scan & CV** tab, choose the engine that matches your document type:

### ⚡ ScanSmith Neural AI (`Auto-Detected Hardware`) — Recommended for Problem Scans
- **Powered By**: DocRes Visual Transformer dynamically accelerated on your system's GPU (e.g. Arc A770, Iris Xe, GeForce, Radeon) or host processor.
- **Best Used For**:
  - Thin paper with strong reverse-side ink bleed-through.
  - Phone photos taken under uneven room lights with deep shadows.
  - Creased, crumpled, or curved book pages.
- **Execution Time**: ~5 seconds per page.

### 📐 OpenCV Fast (`CPU Math`) — Recommended for Clean Batches
- **Powered By**: Classical computer vision algorithms running on CPU.
- **Best Used For**:
  - Flatbed scanner output.
  - Straightforward deskewing and orientation correction.
  - High-speed processing of large document batches (sub-150ms per page).

---

## 5. Fine-Tuning Correction Tools & Styles

All tools on the **Scan & CV** tab are accessible without scrolling:

### 5.1 Enhancement Styles
- **🎨 Color Doc**: Whitens paper to pure `#ffffff` while keeping colored ink, stamps, and highlighters vibrant.
- **🌑 Grayscale**: Converts to crisp, high-contrast monochrome gray.
- **📄 Clean B&W**: Pure binary black-and-white for razor-sharp text legibility.
- **🖼️ Natural**: Applies geometric fixes (deskew/crop) while preserving the original photograph colors.

### 5.2 Correction Tool Toggles
- **📖 Book Split**: Automatically detects the central spine of 2-page open book spreads and divides them into separate single pages.
- **🧭 Auto Rotate**: Uses Tesseract OSD to detect upside-down or sideways pages and rotates them upright.
- **📐 Auto Deskew**: Corrects tilted scans using Radon projection variance.
- **✂️ Crop Margins**: Eliminates black border frames and adds clean, uniform white margins.
- **💡 De-Shadow**: Removes lighting gradients and page curvature shadows.
- **✨ Despeckle**: Purges scanner glass dust, sensor grain, and stray toner specks.

---

## 6. Synthesizing Editable Microsoft Word (`.docx`) Documents

1. Switch to the **🤖 Presets** tab:
   - Select the document preset that matches your content (**Question Paper**, **Book Chapter**, **Invoice & Receipt**, **Legal Contract**, etc.).
   - Choose your Gemini model (e.g. `Gemini 2.5 Flash` for free, fast processing).
2. Switch to the **⚙️ Export** tab:
   - **AI Smart Name (`✨`)**: Leave enabled to allow Gemini to analyze your document's title and automatically name the file.
   - Or, type a custom filename in the input box.
3. Click the primary **⚡ Synthesize Word DOCX** button.
4. **Live Progress**: Watch the live progress banner as the system cleans images, executes OCR, and constructs Word XML runs.
5. **Open Document**: Once finished, click **Open DOCX** to immediately open the generated document in Microsoft Word, LibreOffice Writer, or your default word processor.
