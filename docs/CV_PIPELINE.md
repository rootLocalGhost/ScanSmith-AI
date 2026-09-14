# 📐 Classical Computer Vision Pipeline — Algorithmic Reference

The **Classical Computer Vision Pipeline** in ScanSmith AI Studio (`scansmith_cv.py`) provides high-speed, CPU-based mathematical image transformations for document cleanup, orientation, deskewing, and binarization.

---

## 1. Pipeline Overview

When an image is processed through the classical CV engine, it progresses through the following sequential stages:

```
Raw Scan / Photo
       │
       ▼
1. Dual-Page Spread Spine Detection & Split
       │
       ▼
2. Tesseract OSD Auto-Orientation (90° / 180° / 270°)
       │
       ▼
3. Radon Projection Variance Auto-Deskew
       │
       ▼
4. Content Bounding-Box Crop & Uniform Margin Application
       │
       ▼
5. Morphological Background Illumination Flattening
       │
       ▼
6. Contrast-Ratio Bleed-Through & Speckle Purge
       │
       ▼
7. Style Filter Rendering (Color, Grayscale, B&W, Natural)
       │
       ▼
Cleaned Document Output
```

---

## 2. Detailed Algorithms

### 2.1 Dual-Page Spread Splitting (`--split`)
- **Objective**: Automatically detect the central gutter/spine of an open book scan and split it into two distinct left and right pages.
- **Algorithm**:
  1. Checks image aspect ratio ($W/H > 1.15$). If portrait, the image is skipped.
  2. Computes the vertical projection profile: sums pixel intensities vertically across the center 30%–70% horizontal span.
  3. Applies Gaussian smoothing ($\sigma = 15$) to the profile to avoid local minima caused by text spaces.
  4. Identifies the deepest valley minimum (the dark spine shadow) and bisects the image into Left and Right sub-images with slight overlap compensation.

### 2.2 Auto-Orientation (`--orient`)
- **Objective**: Correct scans that were captured upside down, sideways, or rotated 90°.
- **Algorithm**:
  1. Queries **Tesseract Orientation and Script Detection (OSD)** engine via `pytesseract.image_to_osd`.
  2. Parses the detected rotation angle (`0`, `90`, `180`, `270`).
  3. If orientation confidence exceeds $1.5$, rotates the image using lossless affine matrix transforms (`cv2.ROTATE_90_CLOCKWISE`, `cv2.ROTATE_180`, etc.).

### 2.3 Radon Projection Variance Deskew (`--deskew`)
- **Objective**: Straighten documents with slanted text lines without distorting aspect ratios.
- **Algorithm**:
  1. Downscales the image to $1024$ px max dimension for real-time speed.
  2. Binarizes via Otsu thresholding and crops center content to minimize border noise.
  3. Evaluates horizontal projection profile variance across angles $\theta \in [-25^\circ, +25^\circ]$ in $0.5^\circ$ increments (refined to $0.1^\circ$ around the optimum).
  4. At the true skew angle, text lines align perfectly horizontally, yielding maximal projection variance between dense text lines and empty line spaces.
  5. Rotates the original full-resolution image using bicubic interpolation with white border fill.

### 2.4 Auto Crop & Margins (`--margins`)
- **Objective**: Eliminate dark scanner borders, phone shadow fringes, and apply clean, standardized white borders.
- **Algorithm**:
  1. Detects the outermost bounding box enclosing all foreground content using morphological dilation.
  2. Clips outlier edge noise within $2\%$ of image margins.
  3. Crops to the content rectangle and injects uniform $4\%$ white margin padding around all four edges.

### 2.5 Shadow & Crease Illumination Flattening (`--shadows`)
- **Objective**: Equalize lighting gradients caused by uneven room lights or book curvature.
- **Algorithm**:
  1. Downscales image to $512$ px lightness channel.
  2. Applies a large morphological closing operation using a rectangular structuring element ($kernel \approx 51 \times 51$).
  3. The resulting image represents the estimated background paper illumination field ($B_{\text{illum}}$).
  4. Divides original lightness by the illumination field: $L_{\text{norm}} = (L / B_{\text{illum}}) \times 255$.
  5. Eliminates gradual shadows while preserving high-frequency text strokes.

### 2.6 High-Grade Denoise & Despeckle (`--denoise`)
- **Objective**: Eradicate scanner glass dust, toner specks, and reverse-side bleed-through text without eroding front text.
- **Algorithm**:
  1. **Optical Contrast Ratio**: Evaluates $R = L / B_{\text{illum}}$.
     - Faint reverse bleed-through text exhibits $R \ge 0.86$.
     - Primary front-page ink strokes exhibit $R < 0.82$.
  2. **High-Key Remapping**: Any pixel with $R \ge 0.87$ is mapped to pure paper white ($255$).
  3. **Non-Linear Stroke Solidification**: Ink pixels ($R < 0.87$) are darkened with an exponential power curve:
     $$\text{Pixel}_{\text{out}} = 255 \times \left(\frac{R}{0.87}\right)^{1.3}$$
  4. **Connected-Component Blob Purge**:
     - Performs 8-connectivity connected component labeling (`cv2.connectedComponentsWithStats`).
     - Vectorized lookup table purges isolated noise specks (area $\le 6$ px, or area $\le 14$ px with thin stroke widths $\le 3$ px).
     - Punctuation marks (periods, dots on `i`/`j`, colons) are preserved via centroid proximity and bounding-box ratio validation.
  5. **Paper Chroma Neutralization**: In LAB color space, neutralizes yellow/brown paper tint ($a=128, b=128$) where lightness $L \ge 248$, while retaining vibrant ink saturation for colored stamps and signatures.

---

## 3. Enhancement Styles

ScanSmith AI Studio provides 4 distinct color rendering modes:

| Style Mode | CLI Flag | Description | Best For |
| :--- | :--- | :--- | :--- |
| **Color Doc** | `--mode color` | Whitens background paper while preserving full RGB ink, colored pens, and stamps. | Question papers, certificates, forms with colored ink. |
| **Grayscale** | `--mode grayscale` | High-contrast, smoothed grayscale document representation with crisp text. | Technical book chapters, photocopies. |
| **Clean B&W** | `--mode bw` | Adaptive thresholded binary ($0$ or $255$) with high stroke clarity. | High-speed OCR, legal text, contracts. |
| **Natural** | `--mode original` | Applies geometric deskew, split, and crop only; preserves raw original camera photo colors. | Archival preservation, photo cards. |
