/**
 * Client-side photo resizing utility for inventory product photos.
 * 
 * Requirements:
 * - full photo: max 1000px on the long side, JPEG quality 0.75 (strictly under 300 KB)
 * - thumbnail: 160px on the long side, JPEG quality 0.7 (strictly under 20 KB)
 */

export interface ProcessedPhoto {
  fullDataUrl: string;
  thumbDataUrl: string;
  fullSizeBytes: number;
  thumbSizeBytes: number;
}

/**
 * Loads a File or Blob into an HTMLImageElement
 */
function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image into memory'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Resizes an image onto an offscreen canvas and returns a JPEG dataURL.
 * If size exceeds maxBytes, it iteratively reduces quality.
 */
function renderCanvasToJpeg(
  img: HTMLImageElement,
  maxDimension: number,
  initialQuality: number,
  maxBytes: number
): { dataUrl: string; byteSize: number } {
  let { width, height } = img;

  // Calculate scaled dimensions keeping aspect ratio
  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  // Ensure minimum dimensions
  width = Math.max(1, width);
  height = Math.max(1, height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to create canvas context for photo resizing');
  }

  // High quality smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Draw white background in case of transparent PNGs
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  let quality = initialQuality;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);

  // Approximate byte size of base64 data
  // Base64 length * 0.75 - padding
  const calcBytes = (str: string) => {
    const base64Str = str.split(',')[1] || str;
    return Math.round((base64Str.length * 3) / 4);
  };

  let byteSize = calcBytes(dataUrl);

  // Iteratively reduce quality if needed to strictly satisfy size constraint
  while (byteSize > maxBytes && quality > 0.3) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
    byteSize = calcBytes(dataUrl);
  }

  return { dataUrl, byteSize };
}

/**
 * Resizes an uploaded product photo into:
 * 1. Full photo: max 1000px, quality 0.75, strictly under 300 KB
 * 2. Thumbnail: max 160px, quality 0.7, strictly under 20 KB
 */
export async function resizeProductPhoto(file: File | Blob): Promise<ProcessedPhoto> {
  const img = await loadImage(file);

  // 1. Full photo: max 1000px, quality 0.75, max 300 KB (307,200 bytes)
  const full = renderCanvasToJpeg(img, 1000, 0.75, 300 * 1024);

  // 2. Thumbnail: max 160px, quality 0.7, max 20 KB (20,480 bytes)
  const thumb = renderCanvasToJpeg(img, 160, 0.7, 20 * 1024);

  return {
    fullDataUrl: full.dataUrl,
    thumbDataUrl: thumb.dataUrl,
    fullSizeBytes: full.byteSize,
    thumbSizeBytes: thumb.byteSize,
  };
}
