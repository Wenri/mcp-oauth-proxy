/**
 * Common utility functions
 * Adapted from upstream - removed DOM-dependent functions
 */

import { warnPush } from '../logger';

/**
 * Sleep for a specified time
 */
export function sleep(time: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, time));
}

/**
 * Parse date string in format 'YYYYMMDDHHmmss'
 */
export function parseDateString(dateString: string): Date | null {
  if (dateString.length !== 14) {
    warnPush("Invalid date string length. Expected format: 'YYYYMMDDHHmmss'");
    return null;
  }

  const year = parseInt(dateString.slice(0, 4), 10);
  const month = parseInt(dateString.slice(4, 6), 10) - 1;
  const day = parseInt(dateString.slice(6, 8), 10);
  const hours = parseInt(dateString.slice(8, 10), 10);
  const minutes = parseInt(dateString.slice(10, 12), 10);
  const seconds = parseInt(dateString.slice(12, 14), 10);

  const date = new Date(year, month, day, hours, minutes, seconds);

  if (isNaN(date.getTime())) {
    warnPush('Invalid date components.');
    return null;
  }

  return date;
}

/**
 * Generate a UUID
 */
export function generateUUID(): string {
  let uuid = '';
  let random = 0;

  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4';
    } else {
      random = (Math.random() * 16) | 0;
      if (i === 19) {
        random = (random & 0x3) | 0x8;
      }
      uuid += random.toString(16);
    }
  }

  return uuid;
}

/**
 * Convert base64 string to Blob
 */
export function base64ToBlob(base64: string, mimeType: string = 'application/octet-stream'): Blob {
  const base64Data = base64.replace(/^data:[^;]+;base64,/, '');
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Convert blob to base64 object (works in both browser and CF Worker)
 */
export async function blobToBase64Object(blob: Blob): Promise<{
  type: string;
  data: string;
  mimeType: string;
}> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Data = btoa(binary);
  const mimeType = blob.type || 'application/octet-stream';

  return {
    type: mimeType.split('/')[0],
    data: base64Data,
    mimeType: mimeType,
  };
}
