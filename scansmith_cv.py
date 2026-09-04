#!/usr/bin/env python3
"""
Advanced Document Computer Vision & Preprocessing Pipeline
ScanSmith AI Studio
Features:
- Smart 2-Page Book Split with Center Spine & Gutter Valley Detection
- Auto Orientation Correction via System Tesseract OSD & Directional Gradient Fallback
- High-Precision Text Deskew via Projection Profile Variance & Morphological Lines
- Intelligent Dark Scanner Border Trimming, Content Detection & Uniform Margins
- Shadow & Crease Removal (Illumination Equalization)
- Multi-mode Document Enhancement: Color Document, Clean Grayscale, B&W Binarized, Original
- Denoise & Despeckle Filter
"""

import sys
import json
import os
import shutil
import subprocess
import argparse
import tempfile

try:
    import cv2
    import numpy as np
    # Use all available CPU cores for OpenCV C++ operations
    cv2.setNumThreads(0)
except ImportError as e:
    print(json.dumps({
        "success": False,
        "error": f"Missing Python dependency ({e}). Please run: pip install opencv-python numpy",
        "files": []
    }))
    sys.exit(0)

def imread_unicode(path):
    """Safely read image files supporting Windows Unicode paths and long paths"""
    try:
        data = np.fromfile(path, dtype=np.uint8)
        img = cv2.imdecode(data, cv2.IMREAD_COLOR)
        if img is not None:
            return img
    except Exception:
        pass
    return cv2.imread(path)

def imwrite_unicode(path, image):
    """Safely write image files supporting Windows Unicode paths and long paths"""
    try:
        ext = os.path.splitext(path)[1]
        if not ext:
            ext = ".png"
        success, buffer = cv2.imencode(ext, image)
        if success:
            with open(path, "wb") as f:
                f.write(buffer)
            return True
    except Exception:
        pass
    return cv2.imwrite(path, image)

# Check Windows and Unix paths for tesseract binary
def find_tesseract_binary():
    bin_path = shutil.which("tesseract")
    if bin_path:
        return bin_path

    if sys.platform == "win32":
        candidates = [
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Tesseract-OCR", "tesseract.exe"),
            os.path.join(os.environ.get("USERPROFILE", ""), "AppData", "Local", "Programs", "Tesseract-OCR", "tesseract.exe"),
        ]
        for c in candidates:
            if c and os.path.exists(c):
                return c
    else:
        candidates = [
            "/usr/bin/tesseract",
            "/usr/local/bin/tesseract",
            "/opt/homebrew/bin/tesseract",
        ]
        for c in candidates:
            if os.path.exists(c):
                return c
    return None

TESSERACT_BIN = find_tesseract_binary()

def detect_orientation_tesseract(image):
    """Detect rotation angle needed using Tesseract OSD (0, 90, 180, 270)"""
    try:
        # Downsample if image is huge to speed up OSD detection (max dimension 1600px)
        h, w = image.shape[:2]
        max_dim = max(h, w)
        if max_dim > 1600:
            scale = 1600.0 / max_dim
            proc_img = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        else:
            proc_img = image

        # Method 1: Direct tesseract CLI (fastest and most reliable without python bindings)
        if TESSERACT_BIN:
            tmp_path = None
            try:
                tmp_fd, tmp_path = tempfile.mkstemp(suffix=".png")
                os.close(tmp_fd)
                if imwrite_unicode(tmp_path, proc_img):
                    subp_kwargs = {}
                    if sys.platform == "win32":
                        subp_kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
                    
                    res = subprocess.run(
                        [TESSERACT_BIN, tmp_path, "stdout", "--psm", "0"],
                        capture_output=True,
                        text=True,
                        timeout=10,
                        **subp_kwargs
                    )
                    output = res.stdout or ""
                    for line in output.splitlines():
                        if "Rotate:" in line:
                            rot_str = line.split("Rotate:")[1].strip().split()[0]
                            return int(rot_str)
                        elif "Orientation in degrees:" in line:
                            deg_str = line.split("Orientation in degrees:")[1].strip().split()[0]
                            deg = int(deg_str)
                            if deg == 90:
                                return 270
                            elif deg == 180:
                                return 180
                            elif deg == 270:
                                return 90
            except Exception:
                pass
            finally:
                if tmp_path and os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except Exception:
                        pass

        # Method 2: pytesseract if installed
        try:
            import pytesseract
            osd = pytesseract.image_to_osd(proc_img)
            if "Rotate: " in osd:
                angle = int(osd.split("Rotate: ")[1].split("\n")[0].strip())
                return angle
        except Exception:
            pass

    except Exception:
        pass

    return 0

def detect_orientation_gradient_fallback(image):
    """Fallback: detect if text lines are predominantly vertical (needs 90/270 rotation)"""
    try:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
        # Downsample
        h, w = gray.shape[:2]
        small = cv2.resize(gray, (400, int(400 * (h / w))))
        
        # Horizontal and vertical Sobel gradients
        sobel_x = np.abs(cv2.Sobel(small, cv2.CV_32F, 1, 0, ksize=3))
        sobel_y = np.abs(cv2.Sobel(small, cv2.CV_32F, 0, 1, ksize=3))
        
        # In upright Latin/standard text, vertical gradient (across horizontal lines) is stronger
        sum_x = np.sum(sobel_x)
        sum_y = np.sum(sobel_y)
        
        if sum_x > sum_y * 1.35 and w > h:
            # Strong vertical lines on landscape text suggests 90 deg rotation
            return 90
    except Exception:
        pass
    return 0

def fix_orientation(image):
    """Rotates image to upright reading orientation"""
    try:
        angle = detect_orientation_tesseract(image)
        if angle == 0:
            angle = detect_orientation_gradient_fallback(image)
            
        # Tesseract 'Rotate: 90' means current orientation is CW 90 -> needs CCW 90 to restore upright
        # Tesseract 'Rotate: 270' means current orientation is CCW 90 -> needs CW 90 to restore upright
        if angle == 90:
            return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
        elif angle == 180:
            return cv2.rotate(image, cv2.ROTATE_180)
        elif angle == 270:
            return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    except Exception:
        pass
    return image

def split_page(image):
    """Detects dual-page book spread and separates into individual pages using spine valley detection"""
    try:
        h, w = image.shape[:2]
        # Check if spread is landscape (w > h * 1.05) or vertical double page (h > w * 1.65)
        if w > h * 1.05:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
            
            # Spine must be in the center zone: 35% to 65% of page width
            start_x = int(w * 0.35)
            end_x = int(w * 0.65)
            center_band = gray[:, start_x:end_x]
            
            # Vertical projection: sum of intensities per column
            col_sums = np.sum(center_band, axis=0, dtype=np.float32)
            
            # Smooth with box/gaussian kernel (about 2% of width)
            ksize = max(5, int(w * 0.02) | 1)
            smoothed = cv2.GaussianBlur(col_sums.reshape(1, -1), (ksize, 1), 0)[0]
            
            # In book scans, the center spine is either a shadow valley (dark crease)
            # or a white gutter between columns of text.
            # Check text density via inverted threshold
            _, thresh_inv = cv2.threshold(center_band, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
            text_density = np.sum(thresh_inv, axis=0, dtype=np.float32)
            text_smoothed = cv2.GaussianBlur(text_density.reshape(1, -1), (ksize, 1), 0)[0]
            
            # Check if there's a strong dark valley in intensity
            mean_intensity = np.mean(smoothed)
            min_intensity_idx = np.argmin(smoothed)
            
            # Check if there is a minimum text density column (gutter)
            min_text_idx = np.argmin(text_smoothed)
            
            # Determine split column
            if smoothed[min_intensity_idx] < mean_intensity * 0.92:
                # Strong spine shadow detected
                split_offset = min_intensity_idx
            else:
                # Use gutter between text columns
                split_offset = min_text_idx
                
            split_x = start_x + split_offset
            
            # Safety check: ensure split isn't at the extreme boundaries of the center band
            if split_x < int(w * 0.38) or split_x > int(w * 0.62):
                split_x = w // 2
                
            left_page = image[:, :split_x]
            right_page = image[:, split_x:]
            return [left_page, right_page]
            
        elif h > w * 1.65:
            # Vertical double page spread (e.g. receipt or vertical brochure)
            mid = h // 2
            return [image[:mid, :], image[mid:, :]]
            
    except Exception:
        pass
    return [image]

def deskew(image):
    """Detects text line slant and rotates image to straighten text"""
    try:
        h, w = image.shape[:2]
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
        
        # Downscale for high speed
        scale = 700.0 / max(h, w)
        small = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        
        # Binarize inverted so text pixels are 255 and background is 0
        _, binary = cv2.threshold(small, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
        
        # Remove small specks
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 1))
        binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
        
        sh, sw = binary.shape[:2]
        s_center = (sw // 2, sh // 2)
        
        # Radon / Projection Profile Variance Maximization
        # Horizontal text rows produce alternating high and low sum peaks -> maximum variance when upright
        best_angle = 0.0
        best_var = -1.0
        
        # Step 1: Coarse search (-15° to +15° in 1.5° steps)
        for angle in np.arange(-15.0, 16.5, 1.5):
            M_rot = cv2.getRotationMatrix2D(s_center, angle, 1.0)
            rot = cv2.warpAffine(binary, M_rot, (sw, sh), flags=cv2.INTER_NEAREST)
            proj = np.sum(rot, axis=1)
            var = np.var(proj)
            if var > best_var:
                best_var = var
                best_angle = angle
                
        # Step 2: Fine search around coarse best in 0.25° steps
        refined_angle = best_angle
        for angle in np.arange(best_angle - 1.0, best_angle + 1.25, 0.25):
            M_rot = cv2.getRotationMatrix2D(s_center, angle, 1.0)
            rot = cv2.warpAffine(binary, M_rot, (sw, sh), flags=cv2.INTER_NEAREST)
            proj = np.sum(rot, axis=1)
            var = np.var(proj)
            if var > best_var:
                best_var = var
                refined_angle = angle
                
        # Only rotate if slant is meaningful (> 0.3 degrees)
        if abs(refined_angle) >= 0.3:
            center = (w // 2, h // 2)
            M = cv2.getRotationMatrix2D(center, refined_angle, 1.0)
            return cv2.warpAffine(
                image,
                M,
                (w, h),
                flags=cv2.INTER_CUBIC,
                borderMode=cv2.BORDER_REPLICATE
            )
    except Exception:
        pass
    return image

def trim_dark_borders(image, dark_thresh=65, max_trim_pct=0.15):
    """Detects and trims black/dark scanner bed border artifacts along the edges"""
    try:
        h, w = image.shape[:2]
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
        
        top = 0
        while top < int(h * max_trim_pct) and np.median(gray[top, :]) < dark_thresh:
            top += 1
            
        bottom = h - 1
        while bottom > int(h * (1 - max_trim_pct)) and np.median(gray[bottom, :]) < dark_thresh:
            bottom -= 1
            
        left = 0
        while left < int(w * max_trim_pct) and np.median(gray[:, left]) < dark_thresh:
            left += 1
            
        right = w - 1
        while right > int(w * (1 - max_trim_pct)) and np.median(gray[:, right]) < dark_thresh:
            right -= 1
            
        if bottom > top + 100 and right > left + 100:
            return image[top:bottom+1, left:right+1]
    except Exception:
        pass
    return image

def crop_content_and_margins(image, margin=50):
    """Trims outer non-content edges and dark scanner borders, adding uniform white margins"""
    try:
        # First trim dark scanner glass borders
        clean_img = trim_dark_borders(image)
        h, w = clean_img.shape[:2]
        
        gray = cv2.cvtColor(clean_img, cv2.COLOR_BGR2GRAY) if len(clean_img.shape) == 3 else clean_img
        
        # Downscale for ultra-fast spatial contour analysis
        scale = 1000.0 / max(h, w)
        if scale < 1.0:
            small_gray = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
            sh, sw = small_gray.shape[:2]
            thresh = cv2.threshold(small_gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
            border_x = max(2, int(sw * 0.01))
            border_y = max(2, int(sh * 0.01))
            thresh[:border_y, :] = 0
            thresh[-border_y:, :] = 0
            thresh[:, :border_x] = 0
            thresh[:, -border_x:] = 0
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                return clean_img
            x_min, y_min, x_max, y_max = sw, sh, 0, 0
            content_found = False
            for c in contours:
                if cv2.contourArea(c) > 20:
                    x, y, cw, ch = cv2.boundingRect(c)
                    x_min = min(x_min, x)
                    y_min = min(y_min, y)
                    x_max = max(x_max, x + cw)
                    y_max = max(y_max, y + ch)
                    content_found = True
            if not content_found or x_max <= x_min or y_max <= y_min:
                return clean_img
            x_min = int(x_min / scale)
            y_min = int(y_min / scale)
            x_max = int(x_max / scale)
            y_max = int(y_max / scale)
        else:
            thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
            border_x = max(2, int(w * 0.01))
            border_y = max(2, int(h * 0.01))
            thresh[:border_y, :] = 0
            thresh[-border_y:, :] = 0
            thresh[:, :border_x] = 0
            thresh[:, -border_x:] = 0
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                return clean_img
            x_min, y_min, x_max, y_max = w, h, 0, 0
            content_found = False
            for c in contours:
                if cv2.contourArea(c) > 40:
                    x, y, cw, ch = cv2.boundingRect(c)
                    x_min = min(x_min, x)
                    y_min = min(y_min, y)
                    x_max = max(x_max, x + cw)
                    y_max = max(y_max, y + ch)
                    content_found = True
            if not content_found or x_max <= x_min or y_max <= y_min:
                return clean_img
            
        # Add uniform margins
        x_min = max(0, x_min - margin)
        y_min = max(0, y_min - margin)
        x_max = min(w, x_max + margin)
        y_max = min(h, y_max + margin)
        
        cropped = clean_img[y_min:y_max, x_min:x_max]
        
        # Pad with clean white border if at image boundary
        pad_top = margin if y_min == 0 else 0
        pad_bottom = margin if y_max == h else 0
        pad_left = margin if x_min == 0 else 0
        pad_right = margin if x_max == w else 0
        
        if pad_top or pad_bottom or pad_left or pad_right:
            cropped = cv2.copyMakeBorder(
                cropped,
                pad_top, pad_bottom, pad_left, pad_right,
                cv2.BORDER_CONSTANT,
                value=(255, 255, 255) if len(cropped.shape) == 3 else 255
            )
            
        return cropped
    except Exception:
        return image

def remove_shadows(image):
    """Eliminates uneven camera lighting, phone shadows, and spine gradient darkness"""
    try:
        h, w = image.shape[:2]
        scale = 600.0 / max(h, w)
        
        if len(image.shape) == 3:
            lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            
            if scale < 1.0:
                small_l = cv2.resize(l, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
                dilated = cv2.dilate(small_l, cv2.getStructuringElement(cv2.MORPH_RECT, (11, 11)))
                bg_small = cv2.medianBlur(dilated, 15)
                bg_illum = cv2.resize(bg_small, (w, h), interpolation=cv2.INTER_LINEAR)
            else:
                dilated = cv2.dilate(l, cv2.getStructuringElement(cv2.MORPH_RECT, (35, 35)))
                bg_illum = cv2.medianBlur(dilated, 31)
                
            bg_illum = np.maximum(bg_illum, 1)
            diff = 255 - cv2.absdiff(l, bg_illum)
            norm_l = cv2.normalize(diff, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX, dtype=cv2.CV_8U)
            merged = cv2.merge((norm_l, a, b))
            return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)
        else:
            if scale < 1.0:
                small = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
                dilated = cv2.dilate(small, cv2.getStructuringElement(cv2.MORPH_RECT, (11, 11)))
                bg_small = cv2.medianBlur(dilated, 15)
                bg_illum = cv2.resize(bg_small, (w, h), interpolation=cv2.INTER_LINEAR)
            else:
                dilated = cv2.dilate(image, cv2.getStructuringElement(cv2.MORPH_RECT, (35, 35)))
                bg_illum = cv2.medianBlur(dilated, 31)
                
            bg_illum = np.maximum(bg_illum, 1)
            diff = 255 - cv2.absdiff(image, bg_illum)
            return cv2.normalize(diff, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX, dtype=cv2.CV_8U)
    except Exception:
        return image

def despeckle_image(image):
    """
    Fast edge-preserving document denoise and despeckle filter.
    Smooths scanner grain and sensor noise in uniform paper areas
    while strictly preserving crisp high-contrast text and ink edges.
    Runs in tens of milliseconds instead of dozens of seconds.
    """
    try:
        if image is None:
            return image

        # Handle 4-channel BGRA images
        if len(image.shape) == 3 and image.shape[2] == 4:
            bgr = image[:, :, :3]
            alpha = image[:, :, 3]
            denoised = cv2.bilateralFilter(bgr, d=7, sigmaColor=35, sigmaSpace=35)
            return cv2.merge([denoised, alpha])

        # 3-channel BGR or 1-channel Grayscale
        return cv2.bilateralFilter(image, d=7, sigmaColor=35, sigmaSpace=35)
    except Exception:
        return image

def enhance_output(image, mode="color"):
    """
    Applies document enhancement filter based on selected mode:
    - 'color': Whitens paper background, enhances ink/highlighter colors and sharpens text
    - 'grayscale': Clean contrast-enhanced document grayscale
    - 'bw': Crisp Sauvola/Adaptive binarization with speckle cleaning
    - 'original': Retains natural photo colors without thresholding
    """
    try:
        if mode == "original":
            return image
            
        elif mode == "grayscale":
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
            # CLAHE contrast enhancement
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            enhanced = clahe.apply(gray)
            return enhanced
            
        elif mode == "bw":
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
            # High-quality Gaussian adaptive threshold
            binary = cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 25, 12
            )
            # Remove isolated single-pixel noise
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
            cleaned = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
            return cleaned
            
        else: # Default: 'color'
            if len(image.shape) != 3:
                return image
            # Enhance lightness in LAB space
            lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=1.8, tileGridSize=(8, 8))
            cl = clahe.apply(l)
            merged = cv2.merge((cl, a, b))
            enhanced = cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)
            
            # Subtle unsharp mask for crisp text
            gaussian = cv2.GaussianBlur(enhanced, (0, 0), 2.0)
            sharpened = cv2.addWeighted(enhanced, 1.25, gaussian, -0.25, 0)
            return sharpened
    except Exception:
        return image

def process_image(input_path, output_dir, idx, do_split, do_orient, do_deskew, do_margins, do_shadows=True, do_denoise=True, filter_mode="color"):
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input image not found: {input_path}")

    image = imread_unicode(input_path)
    if image is None:
        raise ValueError(f"Could not read image file format: {input_path}")

    # Step 1: Split dual-page spreads if enabled
    if do_split:
        try:
            pages = split_page(image)
        except Exception as e:
            print(f"[Warning] Split failed for {input_path}: {e}", file=sys.stderr)
            pages = [image]
    else:
        pages = [image]

    results = []
    os.makedirs(output_dir, exist_ok=True)

    for sub_idx, page in enumerate(pages):
        current = page

        # Step 2: Auto orientation
        if do_orient:
            try:
                current = fix_orientation(current)
            except Exception as e:
                print(f"[Warning] Orientation failed for page {idx}_{sub_idx}: {e}", file=sys.stderr)

        # Step 3: Auto deskew slant
        if do_deskew:
            try:
                current = deskew(current)
            except Exception as e:
                print(f"[Warning] Deskew failed for page {idx}_{sub_idx}: {e}", file=sys.stderr)

        # Step 4: Shadow & crease removal
        if do_shadows:
            try:
                current = remove_shadows(current)
            except Exception as e:
                print(f"[Warning] Shadow removal failed for page {idx}_{sub_idx}: {e}", file=sys.stderr)

        # Step 5: Auto crop & uniform margins
        if do_margins:
            try:
                current = crop_content_and_margins(current, margin=50)
            except Exception as e:
                print(f"[Warning] Margin crop failed for page {idx}_{sub_idx}: {e}", file=sys.stderr)

        # Step 6: Denoise & despeckle
        if do_denoise:
            try:
                current = despeckle_image(current)
            except Exception as e:
                print(f"[Warning] Denoise failed for page {idx}_{sub_idx}: {e}", file=sys.stderr)

        # Step 7: Filter enhancement mode (Color / Grayscale / B&W / Original)
        try:
            current = enhance_output(current, mode=filter_mode)
        except Exception as e:
            print(f"[Warning] Enhancement mode failed for page {idx}_{sub_idx}: {e}", file=sys.stderr)

        out_name = os.path.join(output_dir, f"page_{idx}_{sub_idx}_cv.png")
        if not imwrite_unicode(out_name, current):
            cv2.imwrite(out_name, current)
        results.append(out_name)

    return results

if __name__ == "__main__":
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument("--input", required=True)
        parser.add_argument("--outdir", required=True)
        parser.add_argument("--idx", type=int, required=True)
        parser.add_argument("--split", type=int, default=1)
        parser.add_argument("--orient", type=int, default=1)
        parser.add_argument("--deskew", type=int, default=1)
        parser.add_argument("--margins", type=int, default=1)
        parser.add_argument("--shadows", type=int, default=1)
        parser.add_argument("--denoise", type=int, default=0)
        parser.add_argument("--mode", type=str, default="color")
        args = parser.parse_args()

        generated_files = process_image(
            input_path=args.input,
            output_dir=args.outdir,
            idx=args.idx,
            do_split=bool(args.split),
            do_orient=bool(args.orient),
            do_deskew=bool(args.deskew),
            do_margins=bool(args.margins),
            do_shadows=bool(args.shadows),
            do_denoise=bool(args.denoise),
            filter_mode=args.mode
        )
        print(json.dumps({"success": True, "files": generated_files}))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e),
            "files": []
        }))
        sys.exit(0)