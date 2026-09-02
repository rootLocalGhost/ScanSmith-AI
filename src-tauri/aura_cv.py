#!/usr/bin/env python3
"""
OpenCV ScanTailor & Document Processing Pipeline for ScanSmith AI Studio
"""

import sys
import json
import os
import argparse

# Defensive imports with clean JSON error reporting
try:
    import cv2
    import numpy as np
except ImportError as e:
    print(json.dumps({
        "success": False,
        "error": f"Missing Python dependency ({e}). Please run: pip install opencv-python numpy",
        "files": []
    }))
    sys.exit(0)

# Optional tesseract for orientation
try:
    import pytesseract
    HAS_TESSERACT = True
except ImportError:
    HAS_TESSERACT = False

def split_page(image):
    try:
        h, w = image.shape[:2]
        # If the image is landscape (width > height * 1.2), it's likely a 2-page book spread
        if w > h * 1.2:
            mid = w // 2
            return [image[:, :mid], image[:, mid:]]
    except Exception:
        pass
    return [image]

def fix_orientation(image):
    if not HAS_TESSERACT:
        return image
    try:
        osd = pytesseract.image_to_osd(image)
        angle = int(osd.split("Rotate: ")[1].split("\n")[0])
        if angle == 90:
            return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
        elif angle == 180:
            return cv2.rotate(image, cv2.ROTATE_180)
        elif angle == 270:
            return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    except Exception:
        pass
    return image

def dewarp_and_select(image):
    try:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        edged = cv2.Canny(blur, 75, 200)
        
        cnts, _ = cv2.findContours(edged, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        cnts = sorted(cnts, key=cv2.contourArea, reverse=True)[:5]
        
        screenCnt = None
        for c in cnts:
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)
            if len(approx) == 4:
                screenCnt = approx
                break
                
        if screenCnt is None:
            return image
            
        pts = screenCnt.reshape(4, 2)
        rect = np.zeros((4, 2), dtype="float32")
        
        s = pts.sum(axis=1)
        rect[0] = pts[np.argmin(s)]
        rect[2] = pts[np.argmax(s)]
        
        diff = np.diff(pts, axis=1)
        rect[1] = pts[np.argmin(diff)]
        rect[3] = pts[np.argmax(diff)]
        
        (tl, tr, br, bl) = rect
        widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
        widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
        maxWidth = max(int(widthA), int(widthB))
        
        heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
        heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
        maxHeight = max(int(heightA), int(heightB))
        
        dst = np.array([
            [0, 0],
            [maxWidth - 1, 0],
            [maxWidth - 1, maxHeight - 1],
            [0, maxHeight - 1]
        ], dtype="float32")
        
        M = cv2.getPerspectiveTransform(rect, dst)
        return cv2.warpPerspective(image, M, (maxWidth, maxHeight))
    except Exception:
        return image

def deskew(image):
    try:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        gray = cv2.bitwise_not(gray)
        thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
        
        coords = np.column_stack(np.where(thresh > 0))
        angle = cv2.minAreaRect(coords)[-1]
        
        if angle < -45:
            angle = -(90 + angle)
        else:
            angle = -angle
            
        if abs(angle) > 45 or abs(angle) < 0.2:
            return image
            
        (h, w) = image.shape[:2]
        center = (w // 2, h // 2)
        M = cv2.getRotationMatrix2D(center, angle, 1.0)
        return cv2.warpAffine(image, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    except Exception:
        return image

def crop_content_and_margins(image, margin=40):
    try:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
        
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return image
            
        h, w = image.shape[:2]
        x_min, y_min, x_max, y_max = w, h, 0, 0
        
        for c in contours:
            if cv2.contourArea(c) > 50:
                x, y, cw, ch = cv2.boundingRect(c)
                x_min = min(x_min, x)
                y_min = min(y_min, y)
                x_max = max(x_max, x + cw)
                y_max = max(y_max, y + ch)
                
        x_min = max(0, x_min - margin)
        y_min = max(0, y_min - margin)
        x_max = min(w, x_max + margin)
        y_max = min(h, y_max + margin)
        
        if x_max > x_min and y_max > y_min:
            return image[y_min:y_max, x_min:x_max]
    except Exception:
        pass
    return image

def enhance_output(image):
    try:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 15)
    except Exception:
        return image

def process_image(input_path, output_dir, idx, do_split, do_orient, do_deskew, do_margins):
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input image not found: {input_path}")

    image = cv2.imread(input_path)
    if image is None:
        raise ValueError(f"Could not read image file format: {input_path}")

    pages = split_page(image) if do_split else [image]
    results = []

    os.makedirs(output_dir, exist_ok=True)

    for sub_idx, page in enumerate(pages):
        try:
            if do_orient:
                page = fix_orientation(page)
            page = dewarp_and_select(page)
            if do_deskew:
                page = deskew(page)
            if do_margins:
                page = crop_content_and_margins(page, margin=60)
            final = enhance_output(page)

            out_name = os.path.join(output_dir, f"page_{idx}_{sub_idx}_cv.png")
            cv2.imwrite(out_name, final)
            results.append(out_name)
        except Exception as err:
            # If sub-processing fails, attempt direct save of raw page
            out_name = os.path.join(output_dir, f"page_{idx}_{sub_idx}_cv.png")
            cv2.imwrite(out_name, page)
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
        args = parser.parse_args()

        generated_files = process_image(
            args.input,
            args.outdir,
            args.idx,
            bool(args.split),
            bool(args.orient),
            bool(args.deskew),
            bool(args.margins)
        )
        print(json.dumps({"success": True, "files": generated_files}))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e),
            "files": []
        }))
        sys.exit(0)