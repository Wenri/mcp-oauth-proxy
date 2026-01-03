/**
 * Cryptographic utilities for download URL tokens
 *
 * Uses HKDF + XOR for lightweight encryption of grantKey,
 * with GSM 7-bit packing for userId and base64 decoding for grantId
 * to minimize URL length.
 */

import { utils } from 'node-pdu';

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
// GSM 7-bit Packing (using node-pdu)
// ============================================================================

/**
 * Pack string into GSM 7-bit format (8 chars → 7 bytes)
 * Zero padding may create trailing @ (GSM position 0)
 */
export function pack7bit(str: string): Uint8Array {
  const { result } = utils.Helper.encode7Bit(str);
  return utils.Helper.hexToUint8Array(result);
}

/**
 * Unpack GSM 7-bit format back to string
 * Trims trailing @ from zero padding (safe for emails/UUIDs)
 */
export function unpack7bit(bytes: Uint8Array, charCount: number): string {
  const hex = Array.from(bytes)
    .map((b) => utils.Helper.toStringHex(b, 2))
    .join('');
  return utils.Helper.decode7Bit(hex, charCount).replace(/@+$/, '');
}

// ============================================================================
// Base64URL Encoding/Decoding (using Uint8Array.fromBase64/toBase64)
// ============================================================================

/**
 * Decode base64url string to bytes (no padding required)
 */
export function base64urlDecode(str: string): Uint8Array {
  return Uint8Array.fromBase64(str, { alphabet: 'base64url' });
}

/**
 * Encode bytes to base64url string (no padding)
 */
export function base64urlEncode(bytes: Uint8Array): string {
  return bytes.toBase64({ alphabet: 'base64url', omitPadding: true });
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
