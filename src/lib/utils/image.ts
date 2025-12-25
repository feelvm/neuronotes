export interface WebPConversionOptions {
    quality?: number;
    maxWidth?: number;
    maxHeight?: number;
    adaptiveQuality?: boolean; // Automatically adjust quality based on file size
    minQuality?: number; // Minimum quality when using adaptive quality
    maxQuality?: number; // Maximum quality when using adaptive quality
    skipIfSmall?: number; // Skip compression if file is already small (bytes threshold)
}

export interface WebPConversionResult {
    blob: Blob;
    width: number;
    height: number;
    originalSize?: number; // Original file size in bytes
    compressedSize?: number; // Compressed size in bytes
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(err);
        };
        img.src = url;
    });
}

/**
 * Calculates adaptive quality based on file size.
 * Larger files get lower quality for better compression.
 */
function calculateAdaptiveQuality(
    fileSize: number,
    minQuality: number = 0.65,
    maxQuality: number = 0.8
): number {
    // Files over 5MB get minimum quality
    // Files under 500KB get maximum quality
    // Linear interpolation between
    const minSize = 500 * 1024; // 500KB
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (fileSize <= minSize) return maxQuality;
    if (fileSize >= maxSize) return minQuality;

    const ratio = (fileSize - minSize) / (maxSize - minSize);
    return maxQuality - (maxQuality - minQuality) * ratio;
}

export async function convertToWebP(
    file: File,
    options: WebPConversionOptions = {}
): Promise<WebPConversionResult> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        throw new Error('Image conversion is only available in the browser');
    }

    const {
        quality: baseQuality = 0.75,
        maxWidth,
        maxHeight,
        adaptiveQuality = false,
        minQuality = 0.65,
        maxQuality = 0.8,
        skipIfSmall = 200 * 1024 // 200KB default
    } = options;

    const originalSize = file.size;

    // Skip compression if file is already small enough
    if (skipIfSmall !== undefined && originalSize <= skipIfSmall) {
        // Check if already WebP
        if (file.type === 'image/webp') {
            const image = await loadImageFromBlob(file);
            return {
                blob: file,
                width: image.width,
                height: image.height,
                originalSize,
                compressedSize: originalSize
            };
        }
    }

    // Calculate quality
    let quality = baseQuality;
    if (adaptiveQuality) {
        quality = calculateAdaptiveQuality(originalSize, minQuality, maxQuality);
    }

    const image = await loadImageFromBlob(file);

    let targetWidth = image.width;
    let targetHeight = image.height;

    if (maxWidth || maxHeight) {
        const ratio = image.width / image.height;
        if (maxWidth && targetWidth > maxWidth) {
            targetWidth = maxWidth;
            targetHeight = Math.round(targetWidth / ratio);
        }
        if (maxHeight && targetHeight > maxHeight) {
            targetHeight = maxHeight;
            targetWidth = Math.round(targetHeight * ratio);
        }
    }

    const canvas = createCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Failed to get 2D context for image conversion');
    }

    // Use better image smoothing for downscaling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (result) => {
                if (result) {
                    resolve(result);
                } else {
                    reject(new Error('Failed to convert image to WebP'));
                }
            },
            'image/webp',
            quality
        );
    });

    return {
        blob,
        width: targetWidth,
        height: targetHeight,
        originalSize,
        compressedSize: blob.size
    };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error('Unexpected result type when reading blob'));
            }
        };
        reader.onerror = () => reject(reader.error || new Error('Failed to read blob as data URL'));
        reader.readAsDataURL(blob);
    });
}


