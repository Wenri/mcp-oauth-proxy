/**
 * Tests for crypto utilities (GSM 7-bit packing, base64url, grant encryption)
 * Converted from scripts/test-pack7bit.ts
 */

import { describe, it, expect } from 'vitest';
import {
  pack7bit,
  unpack7bit,
  base64urlDecode,
  base64urlEncode,
  encodeGrantKey,
  decodeGrantKey,
  encryptGrant,
  decryptGrant,
  deriveMask,
} from '../workers/mcp-backend/utils/crypto';


describe('pack7bit / unpack7bit', () => {
  const testStrings = [
    'user123',           // 7 septets - ESC padding case (septets % 8 == 7)
    'test123',           // 7 septets - ESC padding case
    'user@example.com',  // 16 septets - perfect alignment
    'hello world',       // 11 septets
    'a',                 // 1 septet
    'ab',                // 2 septets
    'abcdefgh',          // 8 septets - perfect alignment
    'aaaaaaaaaaaaaaa',   // 15 septets - ESC padding case
  ];

  it.each(testStrings)('roundtrips "%s"', (str) => {
    const packed = pack7bit(str);
    const maxSeptets = Math.floor((packed.length * 8) / 7);
    const unpacked = unpack7bit(packed, maxSeptets);
    expect(unpacked).toBe(str);
  });

  it('handles extended GSM chars', () => {
    const testStrings = ['a]b[c', 'test[1]', '€100'];
    for (const str of testStrings) {
      const packed = pack7bit(str);
      const maxSeptets = Math.floor((packed.length * 8) / 7);
      const unpacked = unpack7bit(packed, maxSeptets);
      expect(unpacked).toBe(str);
    }
  });

  it('avoids phantom @ when septets % 8 == 7', () => {
    // 'user123' has 7 septets (7 % 8 == 7) - the ESC padding case
    const packed = pack7bit('user123');
    const maxSeptets = Math.floor((packed.length * 8) / 7);
    // Decoding with maxSeptets should give exact string, no phantom char
    const unpacked = unpack7bit(packed, maxSeptets);
    expect(unpacked).toBe('user123');
    // The packed last byte should have ESC padding (0x1B << 1 in upper bits)
    expect(packed[packed.length - 1] & 0xfe).toBe(0x1b << 1);
  });
});

describe('base64url encode/decode', () => {
  it('roundtrips arbitrary bytes', () => {
    const original = new Uint8Array([0, 1, 2, 255, 128, 64]);
    const encoded = base64urlEncode(original);
    const decoded = base64urlDecode(encoded);
    expect(decoded).toEqual(original);
  });

  it('produces URL-safe output (no +, /, =)', () => {
    // Use bytes that would produce + and / in standard base64
    const bytes = new Uint8Array([251, 255, 254]);
    const encoded = base64urlEncode(bytes);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });
});

describe('encodeGrantKey / decodeGrantKey', () => {
  it('roundtrips userId and grantId', () => {
    const userId = 'user@example.com';
    // 16 base64url chars = 12 bytes
    const grantId = 'AAAAAAAAAAAAAAAA';

    const encoded = encodeGrantKey(userId, grantId);
    const decoded = decodeGrantKey(encoded);

    expect(decoded.userId).toBe(userId);
    expect(decoded.grantId).toBe(grantId);
  });

  it('handles short userIds', () => {
    const userId = 'a';
    const grantId = 'BBBBBBBBBBBBBBBB';

    const encoded = encodeGrantKey(userId, grantId);
    const decoded = decodeGrantKey(encoded);

    expect(decoded.userId).toBe(userId);
    expect(decoded.grantId).toBe(grantId);
  });
});

describe('encryptGrant / decryptGrant', () => {
  const secret = 'test-secret-key-for-encryption';
  const filename = '/data/assets/test-file.png';

  it('roundtrips grantKey through encryption', async () => {
    const grantKey = 'user@example.com:AAAAAAAAAAAAAAAA';
    const token = await encryptGrant(grantKey, filename, secret);
    const decrypted = await decryptGrant(token, filename, secret);
    expect(decrypted).toBe(grantKey);
  });

  it('produces different tokens for different filenames', async () => {
    const grantKey = 'user@example.com:AAAAAAAAAAAAAAAA';
    const token1 = await encryptGrant(grantKey, '/file1.png', secret);
    const token2 = await encryptGrant(grantKey, '/file2.png', secret);
    expect(token1).not.toBe(token2);
  });

  it('produces different tokens for different secrets', async () => {
    const grantKey = 'user@example.com:AAAAAAAAAAAAAAAA';
    const token1 = await encryptGrant(grantKey, filename, 'secret1');
    const token2 = await encryptGrant(grantKey, filename, 'secret2');
    expect(token1).not.toBe(token2);
  });

  it('throws on invalid grantKey format', async () => {
    await expect(
      encryptGrant('no-colon-here', filename, secret)
    ).rejects.toThrow('Invalid grantKey format');
  });
});

describe('deriveMask', () => {
  it('produces deterministic output', async () => {
    const mask1 = await deriveMask('salt', 'secret', 16);
    const mask2 = await deriveMask('salt', 'secret', 16);
    expect(mask1).toEqual(mask2);
  });

  it('produces different output for different salts', async () => {
    const mask1 = await deriveMask('salt1', 'secret', 16);
    const mask2 = await deriveMask('salt2', 'secret', 16);
    expect(mask1).not.toEqual(mask2);
  });

  it('produces requested length', async () => {
    const mask = await deriveMask('salt', 'secret', 32);
    expect(mask.length).toBe(32);
  });
});
