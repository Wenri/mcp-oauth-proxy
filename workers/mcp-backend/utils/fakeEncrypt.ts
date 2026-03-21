/**
 * Cryptographic utilities for download URL tokens
 *
 * Uses HKDF + XOR for lightweight encryption of grantKey,
 * with GSM 7-bit packing for userId and base64 decoding for grantId
 * to minimize URL length.
 */

import { utils } from 'node-pdu';

// ============================================================================
// SHA-256 Hashing
// ============================================================================

/**
 * Calculate SHA-256 hash of a string or Blob, returning a hex string.
 * Uses the Web Crypto API (compatible with CF Workers).
 */
export async function calculateSHA256(fileOrString: string | Blob): Promise<string> {
  let data: ArrayBuffer | Uint8Array;
  if (typeof fileOrString === 'string') {
    const encoder = new TextEncoder();
    data = encoder.encode(fileOrString);
  } else if (fileOrString instanceof Blob) {
    data = await fileOrString.arrayBuffer();
  } else {
    throw new Error('Unsupported input type');
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

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
 * Uses ESC (0x1B) padding when septets % 8 == 7 to avoid phantom @ character
 * Note: Extended chars like []{}~\^€| take 2 septets each
 */
export function pack7bit(str: string): Uint8Array {
  const { length: septets, result } = utils.Helper.encode7Bit(str);
  const bytes = utils.Helper.hexToUint8Array(result);

  // When septets % 8 == 7, we have 7 padding bits in the last byte
  // Use ESC (0x1B) padding instead of zero to avoid phantom @ on decode
  // ESC at end of stream is ignored by GSM decoder
  if (septets % 8 === 7) {
    bytes[bytes.length - 1] = (0x1b << 1) | (bytes[bytes.length - 1] & 0x01);
  }

  return bytes;
}

/**
 * Unpack GSM 7-bit format back to string
 * @param septetCount - Number of septets (not chars - extended chars use 2 septets)
 */
export function unpack7bit(bytes: Uint8Array, septetCount: number): string {
  return utils.Helper.decode7Bit(bytes.toHex(), septetCount);
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

  // Calculate max possible septets from packed byte length
  const maxSeptets = Math.floor((packedUserIdLength * 8) / 7);
  const packedUserId = bytes.slice(0, packedUserIdLength);
  const userId = unpack7bit(packedUserId, maxSeptets);

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

// ============================================================================
// Legacy: Printable-ASCII Vigenère cipher keyed by SiYuan system ID
// From upstream SiYuan source. NOT real encryption — kept for reference only.
// ============================================================================

// /** Get SiYuan system ID (browser-only) or fall back to a fixed UUID */
// function getSystemId(): string {
// 	return (
// 		(window as any)?.siyuan?.config?.system?.id ??
// 		"a1b2c3d4-e5f6-7890-g1h2-i3j4k5l6m7n8"
// 	);
// }
//
// /** Build per-position shift array from key (range 3–12) */
// function buildShifts(input: string, key: string): number[] {
// 	const cleanKey = key.replace(/[^A-Za-z0-9]/g, "");
// 	const shifts: number[] = [];
// 	for (let i = 0; i < input.length; ++i) {
// 		const code = cleanKey.charCodeAt(i % cleanKey.length);
// 		shifts.push(3 + (code % 10));
// 	}
// 	return shifts;
// }
//
// /** Encrypt: shift each printable-ASCII char forward */
// export function EXTRAVAGANZA(text: string): string {
// 	const systemId = getSystemId();
// 	const shifts = buildShifts(text, systemId);
// 	let result = "";
// 	for (let i = 0; i < text.length; ++i) {
// 		const code = text.charCodeAt(i);
// 		result += String.fromCharCode(((code - 0x20 + shifts[i]) % 0x5f) + 0x20);
// 	}
// 	return result;
// }
//
// /** Decrypt: shift each printable-ASCII char backward */
// export function INVERSE_EXTRAVAGANZA(text: string): string {
// 	const systemId = getSystemId();
// 	const shifts = buildShifts(text, systemId);
// 	let result = "";
// 	for (let i = 0; i < text.length; ++i) {
// 		const code = text.charCodeAt(i);
// 		result += String.fromCharCode(
// 			((code - 0x20 - shifts[i] + 0x5f) % 0x5f) + 0x20,
// 		);
// 	}
// 	return result;
// }
