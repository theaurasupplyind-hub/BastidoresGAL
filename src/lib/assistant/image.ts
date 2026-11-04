import { newId } from './storage';
import type { PendingAttachment } from './types';

export const MAX_ATTACHMENTS = 3;
const MAX_DIMENSION = 1920;
const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Comprime y redimensiona una imagen para mandarla al modelo. */
export async function prepareAttachment(file: File): Promise<PendingAttachment> {
  if (!SUPPORTED_TYPES.has(file.type)) {
    throw new Error('Formato no soportado. Usá JPG, PNG o WEBP.');
  }
  if (file.size > MAX_ORIGINAL_BYTES) {
    throw new Error('La imagen supera los 15 MB.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('No se pudo leer la imagen. Probá con otra foto.');
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('No se pudo procesar la imagen.');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('No se pudo comprimir la imagen.'))),
      'image/jpeg',
      0.9,
    );
  });

  return {
    attachment: {
      id: newId(),
      name: file.name || 'comprobante.jpg',
      mime: 'image/jpeg',
      size: blob.size,
      width,
      height,
    },
    blob,
  };
}

/** Convierte un blob a data URL para OpenRouter. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(blob);
  });
}
