/**
 * Cryptographic utilities for download URL tokens
 *
 * Uses HKDF + XOR for lightweight encryption of grantKey,
 * with 7-bit packing for userId and base64 decoding for grantId
 * to minimize URL length.
 */

// ============================================================================
// HKDF - Key Derivation
// ============================================================================

/**
 * Derive a mask using HKDF (RFC 5869)
 * @param filename - Salt (binds derived key to specific file)
 * @param secret - Master secret (COOKIE_ENCRYPTION_KEY)
 * @param length - Output length in bytes
 */
export async function deriveMask(
  filename: string,
  secret: string,
  length: number
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'HKDF',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(filename),
      info: new TextEncoder().encode('siyuan-download'),
    },
    keyMaterial,
    length * 8
  );

  return new Uint8Array(bits);
}

// ============================================================================
// 7-bit ASCII Packing (GSM-style)
// ============================================================================

/**
 * Pack ASCII string into 7-bit format (8 chars → 7 bytes)
 * Saves 12.5% space for ASCII-only strings
 */
export function pack7bit(str: string): Uint8Array {
  const bits: number[] = [];

  // Convert each char to 7 bits
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i) & 0x7f; // Keep only 7 bits
    for (let b = 6; b >= 0; b--) {
      bits.push((code >> b) & 1);
    }
  }

  // Pack bits into bytes
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    bytes[Math.floor(i / 8)] |= bits[i] << (7 - (i % 8));
  }

  return bytes;
}

/**
 * Unpack 7-bit format back to ASCII string
 */
export function unpack7bit(bytes: Uint8Array, charCount: number): string {
  const bits: number[] = [];

  // Extract all bits
  for (let i = 0; i < bytes.length; i++) {
    for (let b = 7; b >= 0; b--) {
      bits.push((bytes[i] >> b) & 1);
    }
  }

  // Convert every 7 bits to a char
  let result = '';
  for (let i = 0; i < charCount; i++) {
    let code = 0;
    for (let b = 0; b < 7; b++) {
      code = (code << 1) | (bits[i * 7 + b] || 0);
    }
    result += String.fromCharCode(code);
  }

  return result;
}

// ============================================================================
// Base64URL Encoding/Decoding
// ============================================================================

const BASE64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Decode base64url string to bytes (no padding required)
 */
export function base64urlDecode(str: string): Uint8Array {
  // Build lookup table
  const lookup: Record<string, number> = {};
  for (let i = 0; i < BASE64URL_CHARS.length; i++) {
    lookup[BASE64URL_CHARS[i]] = i;
  }

  // Each 4 chars = 3 bytes, handle remainder
  const bytes: number[] = [];
  let buffer = 0;
  let bitsCollected = 0;

  for (const char of str) {
    const value = lookup[char];
    if (value === undefined) continue; // Skip invalid chars

    buffer = (buffer << 6) | value;
    bitsCollected += 6;

    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      bytes.push((buffer >> bitsCollected) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Encode bytes to base64url string (no padding)
 */
export function base64urlEncode(bytes: Uint8Array): string {
  let result = '';
  let buffer = 0;
  let bitsCollected = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsCollected += 8;

    while (bitsCollected >= 6) {
      bitsCollected -= 6;
      result += BASE64URL_CHARS[(buffer >> bitsCollected) & 0x3f];
    }
  }

  // Handle remaining bits
  if (bitsCollected > 0) {
    result += BASE64URL_CHARS[(buffer << (6 - bitsCollected)) & 0x3f];
  }

  return result;
}

// ============================================================================
// Grant Encryption/Decryption
// ============================================================================

/** grantId is always 16 base64url chars = 12 bytes */
const GRANT_ID_BYTES = 12;

/**
 * Binary format for grantKey:
 * [N bytes: 7-bit packed userId] [12 bytes: grantId]
 * No length prefix needed - grantId is fixed 12 bytes, so userId length is inferred.
 */

/**
 * Encode grantKey (userId:grantId) to compact binary format
 */
export function encodeGrantKey(userId: string, grantId: string): Uint8Array {
  // Pack userId with 7-bit encoding
  const packedUserId = pack7bit(userId);

  // Decode grantId from base64url (16 chars → 12 bytes)
  const decodedGrantId = base64urlDecode(grantId);

  // Format: [packedUserId:N] [grantId:12]
  const result = new Uint8Array(packedUserId.length + decodedGrantId.length);
  result.set(packedUserId, 0);
  result.set(decodedGrantId, packedUserId.length);

  return result;
}

/**
 * Decode compact binary format back to userId and grantId
 */
export function decodeGrantKey(bytes: Uint8Array): { userId: string; grantId: string } {
  // grantId is always last 12 bytes
  const packedUserIdLength = bytes.length - GRANT_ID_BYTES;

  // Calculate max possible userId chars from packed length
  // Then unpack and trim trailing nulls
  const maxChars = Math.floor((packedUserIdLength * 8) / 7);
  const packedUserId = bytes.slice(0, packedUserIdLength);
  const userId = unpack7bit(packedUserId, maxChars).replace(/\0+$/, '');

  // Decode grantId back to base64url
  const decodedGrantId = bytes.slice(packedUserIdLength);
  const grantId = base64urlEncode(decodedGrantId);

  return { userId, grantId };
}

/**
 * Encrypt grantKey for download URL
 * @param grantKey - "userId:grantId" string
 * @param filename - File path (used as HKDF salt)
 * @param secret - Encryption key (COOKIE_ENCRYPTION_KEY)
 * @returns Base64url encoded encrypted token
 */
export async function encryptGrant(
  grantKey: string,
  filename: string,
  secret: string
): Promise<string> {
  // Parse grantKey
  const colonIndex = grantKey.indexOf(':');
  if (colonIndex === -1) {
    throw new Error('Invalid grantKey format, expected userId:grantId');
  }
  const userId = grantKey.slice(0, colonIndex);
  const grantId = grantKey.slice(colonIndex + 1);

  // Encode to compact binary
  const plaintext = encodeGrantKey(userId, grantId);

  // Derive mask using HKDF
  const mask = await deriveMask(filename, secret, plaintext.length);

  // XOR to encrypt
  const ciphertext = new Uint8Array(plaintext.length);
  for (let i = 0; i < plaintext.length; i++) {
    ciphertext[i] = plaintext[i] ^ mask[i];
  }

  return base64urlEncode(ciphertext);
}

/**
 * Decrypt grantKey from download URL token
 * @param token - Base64url encoded encrypted token
 * @param filename - File path (used as HKDF salt)
 * @param secret - Encryption key (COOKIE_ENCRYPTION_KEY)
 * @returns "userId:grantId" string
 */
export async function decryptGrant(
  token: string,
  filename: string,
  secret: string
): Promise<string> {
  // Decode token
  const ciphertext = base64urlDecode(token);

  // Derive mask using HKDF
  const mask = await deriveMask(filename, secret, ciphertext.length);

  // XOR to decrypt
  const plaintext = new Uint8Array(ciphertext.length);
  for (let i = 0; i < ciphertext.length; i++) {
    plaintext[i] = ciphertext[i] ^ mask[i];
  }

  // Decode from compact binary
  const { userId, grantId } = decodeGrantKey(plaintext);

  return `${userId}:${grantId}`;
}
