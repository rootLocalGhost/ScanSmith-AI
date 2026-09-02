import cv2
import numpy as np
import sys
import json
import os
import argparse

# Try to import pytesseract for Auto-Orientation
try:
    import pytesseract
    HAS_TESSERACT = True
except ImportError:
    HAS_TESSERACT = False

def split_page(image):
    h, w = image.shape[:2]
    # If the image is landscape (width > height * 1.2), it's likely a 2-page book spread
    if w > h * 1.2:
        mid = w // 2
        return [image[:, :mid], image[:, mid:]]
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
    except:
        pass
    return image

def dewarp_and_select(image):
    # Find the physical paper and apply a 4-point perspective transform
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
        return image # Fallback if paper edges aren't visible
        
    pts = screenCnt.reshape(4, 2)
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0], rect[2] = pts[np.argmin(s)], pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1], rect[3] = pts[np.argmin(diff)], pts[np.argmax(diff)]
    
    (tl, tr, br, bl) = rect
    widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
    widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
    maxWidth = max(int(widthA), int(widthB))
    
    heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
    heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
    maxHeight = max(int(heightA), int(heightB))
    
    dst = np.array([[0, 0], [maxWidth - 1, 0], [maxWidth - 1, maxHeight - 1], [0, maxHeight - 1]], dtype="float32")
    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(image, M, (maxWidth, maxHeight))

def deskew(image):
    # Detect exact text slant using minAreaRect and straighten it
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.bitwise_not(gray)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
    
    coords = np.column_stack(np.where(thresh > 0))
    if len(coords) == 0: return image
    
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45: angle = -(90 + angle)
    else: angle = -angle
        
    (h, w) = image.shape[:2]
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    return cv2.warpAffine(image, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)

def crop_content_and_margins(image, margin=50):
    # Find bounding box of actual text, crop away empty desk/paper, add uniform white margin
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    dilate = cv2.dilate(thresh, kernel, iterations=4)
    cnts, _ = cv2.findContours(dilate, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not cnts: return image
    
    x_min, y_min = float('inf'), float('inf')
    x_max, y_max = 0, 0
    
    for c in cnts:
        x, y, w, h = cv2.boundingRect(c)
        x_min, y_min = min(x_min, x), min(y_min, y)
        x_max, y_max = max(x_max, x + w), max(y_max, y + h)
        
    cropped = image[y_min:y_max, x_min:x_max]
    return cv2.copyMakeBorder(cropped, margin, margin, margin, margin, cv2.BORDER_CONSTANT, value=[255, 255, 255])

def enhance_output(image):
    # Adaptive thresholding to bleach background and pop text
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 15)

def process_image(input_path, output_dir, idx, do_split, do_orient, do_deskew, do_margins):
    image = cv2.imread(input_path)
    if image is None: return []

    pages = split_page(image) if do_split else [image]
    results = []

    for sub_idx, page in enumerate(pages):
        # The ScanTailor Pipeline
        if do_orient: page = fix_orientation(page)
        page = dewarp_and_select(page)
        if do_deskew: page = deskew(page)
        if do_margins: page = crop_content_and_margins(page, margin=60)
        final = enhance_output(page)

        out_name = f"{output_dir}/page_{idx}_{sub_idx}_cv.png"
        cv2.imwrite(out_name, final)
        results.append(out_name)
        
    return results

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--idx", type=int, required=True)
    parser.add_argument("--split", type=int, default=1)
    parser.add_argument("--orient", type=int, default=1)
    parser.add_argument("--deskew", type=int, default=1)
    parser.add_argument("--margins", type=int, default=1)
    args = parser.parse_args()

    generated_files = process_image(args.input, args.outdir, args.idx, args.split, args.orient, args.deskew, args.margins)
    print(json.dumps({"success": True, "files": generated_files}))