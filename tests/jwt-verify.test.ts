/**
 * Tests for workers/auth-cfaccess/jwt.ts
 *
 * Covers: parseJWT, fetchAccessPublicKey, verifyToken.
 * The same suite is used as the contract when swapping the implementation
 * to Hono's jwt helper — all tests must stay green after the swap.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { parseJWT, fetchAccessPublicKey, verifyToken } from '../workers/auth-cfaccess/jwt';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JWKS_URL = 'https://test.example.com/.well-known/jwks.json';
const TEST_KID = 'test-key-1';

/** Generate a real RSA-2048 key pair once for the whole suite. */
async function generateRS256KeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as Promise<CryptoKeyPair>;
}

function b64url(data: ArrayBuffer | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/** Build a compact JWT string signed with the given private key. */
async function signToken(
  payload: Record<string, unknown>,
  privateKey: CryptoKey,
  kid = TEST_KID,
): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(sig)}`;
}

/** Build a minimal JWKS payload from an exported public JWK. */
function buildJwks(kid: string, publicJwk: JsonWebKey) {
  return { keys: [{ ...publicJwk, kid, use: 'sig', alg: 'RS256' }] };
}

/** Replace globalThis.fetch with a stub that returns the given JWKS. */
function mockFetchWithJwks(jwks: object) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(jwks),
    }),
  );
}

// ---------------------------------------------------------------------------
// Shared fixture — generated once, reused by all tests
// ---------------------------------------------------------------------------

let keyPair: CryptoKeyPair;
let publicJwk: JsonWebKey;
let validToken: string;
const now = Math.floor(Date.now() / 1000);

beforeAll(async () => {
  keyPair = await generateRS256KeyPair();
  publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey) as JsonWebKey;
  validToken = await signToken({ sub: 'user-1', email: 'a@example.com', name: 'Alice', exp: now + 3600 }, keyPair.privateKey);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// parseJWT
// ---------------------------------------------------------------------------

describe('parseJWT', () => {
  it('splits a valid token into header, payload, data, and signature', async () => {
    const token = await signToken({ sub: 'u1' }, keyPair.privateKey);
    const parsed = parseJWT(token);

    expect(parsed.header.alg).toBe('RS256');
    expect(parsed.header.kid).toBe(TEST_KID);
    expect(parsed.payload.sub).toBe('u1');
    expect(parsed.signature).toBeTruthy();
    // data is the signable portion (header.payload)
    const [h, p] = token.split('.');
    expect(parsed.data).toBe(`${h}.${p}`);
  });

  it('throws when token does not have 3 parts', () => {
    expect(() => parseJWT('only.two')).toThrow('token must have 3 parts');
    expect(() => parseJWT('one')).toThrow('token must have 3 parts');
    expect(() => parseJWT('a.b.c.d')).toThrow('token must have 3 parts');
  });

  it('correctly base64url-decodes header and payload', async () => {
    const payload = { iss: 'test', sub: 'abc', custom: 123 };
    const token = await signToken(payload, keyPair.privateKey, 'my-kid');
    const parsed = parseJWT(token);
    expect(parsed.header.kid).toBe('my-kid');
    expect(parsed.payload.iss).toBe('test');
    expect(parsed.payload.sub).toBe('abc');
    expect(parsed.payload.custom).toBe(123);
  });
});

// ---------------------------------------------------------------------------
// fetchAccessPublicKey
// ---------------------------------------------------------------------------

describe('fetchAccessPublicKey', () => {
  it('returns a CryptoKey for a known kid', async () => {
    mockFetchWithJwks(buildJwks(TEST_KID, publicJwk));
    const key = await fetchAccessPublicKey({ ACCESS_JWKS_URL: JWKS_URL }, TEST_KID);
    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.type).toBe('public');
  });

  it('throws when ACCESS_JWKS_URL is empty', async () => {
    await expect(
      fetchAccessPublicKey({ ACCESS_JWKS_URL: '' }, TEST_KID),
    ).rejects.toThrow('ACCESS_JWKS_URL not provided');
  });

  it('throws when the JWKS endpoint returns an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(
      fetchAccessPublicKey({ ACCESS_JWKS_URL: JWKS_URL }, TEST_KID),
    ).rejects.toThrow('Failed to fetch JWKS');
  });

  it('throws when the kid is not in the JWKS', async () => {
    mockFetchWithJwks(buildJwks('other-kid', publicJwk));
    await expect(
      fetchAccessPublicKey({ ACCESS_JWKS_URL: JWKS_URL }, TEST_KID),
    ).rejects.toThrow(`Key with kid ${TEST_KID} not found`);
  });
});

// ---------------------------------------------------------------------------
// verifyToken
// ---------------------------------------------------------------------------

const env = { ACCESS_JWKS_URL: JWKS_URL };

describe('verifyToken', () => {
  it('returns claims for a valid token', async () => {
    mockFetchWithJwks(buildJwks(TEST_KID, publicJwk));
    const claims = await verifyToken(env, validToken);
    expect(claims.sub).toBe('user-1');
    expect(claims.email).toBe('a@example.com');
    expect(claims.name).toBe('Alice');
  });

  it('throws for a token with a tampered signature', async () => {
    mockFetchWithJwks(buildJwks(TEST_KID, publicJwk));
    const [h, p] = validToken.split('.');
    const tampered = `${h}.${p}.AAAAAAAAAAAAAAAAAAAAAA`;
    await expect(verifyToken(env, tampered)).rejects.toThrow('signature mismatched');
  });

  it('throws for a token with a tampered payload', async () => {
    mockFetchWithJwks(buildJwks(TEST_KID, publicJwk));
    const [h, , s] = validToken.split('.');
    const newPayload = b64url(JSON.stringify({ sub: 'attacker', exp: now + 9999 }));
    await expect(verifyToken(env, `${h}.${newPayload}.${s}`)).rejects.toThrow('signature mismatched');
  });

  it('throws for an expired token (exp in the past)', async () => {
    mockFetchWithJwks(buildJwks(TEST_KID, publicJwk));
    const expiredToken = await signToken({ sub: 'u', exp: now - 60 }, keyPair.privateKey);
    await expect(verifyToken(env, expiredToken)).rejects.toThrow('expired');
  });

  it('rejects a token that expired exactly 1 second ago', async () => {
    mockFetchWithJwks(buildJwks(TEST_KID, publicJwk));
    const token = await signToken({ sub: 'u', exp: now - 1 }, keyPair.privateKey);
    await expect(verifyToken(env, token)).rejects.toThrow('expired');
  });

  it('accepts a token with no exp claim', async () => {
    mockFetchWithJwks(buildJwks(TEST_KID, publicJwk));
    const token = await signToken({ sub: 'u' }, keyPair.privateKey);
    const claims = await verifyToken(env, token);
    expect(claims.sub).toBe('u');
  });

  it('rejects a token whose exp is exactly now', async () => {
    mockFetchWithJwks(buildJwks(TEST_KID, publicJwk));
    // exp === now: expired (Hono uses exp <= now)
    const token = await signToken({ sub: 'u', exp: now }, keyPair.privateKey);
    await expect(verifyToken(env, token)).rejects.toThrow('expired');
  });

  it('accepts a token with a future exp', async () => {
    mockFetchWithJwks(buildJwks(TEST_KID, publicJwk));
    const token = await signToken({ sub: 'u', exp: now + 3600 }, keyPair.privateKey);
    const claims = await verifyToken(env, token);
    expect(claims.sub).toBe('u');
  });

  it('propagates JWKS errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(verifyToken(env, validToken)).rejects.toThrow('Failed to fetch JWKS');
  });

  it('throws for a token signed by a different key', async () => {
    mockFetchWithJwks(buildJwks(TEST_KID, publicJwk)); // correct key in JWKS
    const otherPair = await generateRS256KeyPair();
    const foreignToken = await signToken({ sub: 'u', exp: now + 3600 }, otherPair.privateKey);
    await expect(verifyToken(env, foreignToken)).rejects.toThrow('signature mismatched');
  });
});
