export interface WebPConversionOptions {
    quality?: number;
    maxWidth?: number;
    maxHeight?: number;
}

export interface WebPConversionResult {
    blob: Blob;
    width: number;
    height: number;
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

export async function convertToWebP(
    file: File,
    options: WebPConversionOptions = {}
): Promise<WebPConversionResult> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        throw new Error('Image conversion is only available in the browser');
    }

    const { quality = 0.8, maxWidth, maxHeight } = options;
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
        height: targetHeight
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


