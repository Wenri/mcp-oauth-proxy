/**
 * Tests for packState / unpackState roundtrip (all 3 variants)
 */

import { describe, it, expect } from 'vitest';
import type { AuthRequest } from '@cloudflare/workers-oauth-provider';
import {
	packState,
	unpackState,
	deflateToBase64url,
	inflateFromBase64url,
} from '../workers/auth-cfaccess/workers-oauth-utils';

const baseOAuthReq: AuthRequest = {
	responseType: 'code',
	clientId: 'client-abc-123',
	redirectUri: 'https://example.com/callback',
	scope: ['openid', 'email', 'profile'],
	state: 'random-state-value',
};

const oauthReqWithChallenge: AuthRequest = {
	...baseOAuthReq,
	codeChallenge: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
	codeChallengeMethod: 'S256',
};

const oauthReqWithResource: AuthRequest = {
	...baseOAuthReq,
	resource: 'https://api.example.com',
};

const oauthReqWithMultiResource: AuthRequest = {
	...baseOAuthReq,
	resource: ['https://api.example.com', 'https://cdn.example.com'],
};

const testUser = { email: 'alice@example.com', name: 'Alice Smith', sub: 'user-sub-456' };

// Hex-encoded 32 bytes
const testVerifier = 'a'.repeat(64);

describe('packState / unpackState', () => {
	describe('oauthReqInfo only (form approval state)', () => {
		it('roundtrips basic AuthRequest', () => {
			const packed = packState({ oauthReqInfo: baseOAuthReq });
			const result = unpackState(packed);

			expect(result.oauthReqInfo.clientId).toBe(baseOAuthReq.clientId);
			expect(result.oauthReqInfo.redirectUri).toBe(baseOAuthReq.redirectUri);
			expect(result.oauthReqInfo.scope).toEqual(baseOAuthReq.scope);
			expect(result.oauthReqInfo.state).toBe(baseOAuthReq.state);
			expect(result.oauthReqInfo.responseType).toBe('code');
			expect(result.codeVerifier).toBeUndefined();
			expect(result.user).toBeUndefined();
		});

		it('roundtrips AuthRequest with single resource', () => {
			const packed = packState({ oauthReqInfo: oauthReqWithResource });
			const result = unpackState(packed);
			expect(result.oauthReqInfo.resource).toBe('https://api.example.com');
		});

		it('roundtrips AuthRequest with multiple resources', () => {
			const packed = packState({ oauthReqInfo: oauthReqWithMultiResource });
			const result = unpackState(packed);
			expect(result.oauthReqInfo.resource).toEqual(['https://api.example.com', 'https://cdn.example.com']);
		});
	});

	describe('oauthReqInfo + codeVerifier (URL state)', () => {
		it('roundtrips with codeVerifier', () => {
			const packed = packState({ oauthReqInfo: baseOAuthReq, codeVerifier: testVerifier });
			const result = unpackState(packed);

			expect(result.oauthReqInfo.clientId).toBe(baseOAuthReq.clientId);
			expect(result.codeVerifier).toBe(testVerifier);
			expect(result.oauthReqInfo.codeChallenge).toBeUndefined();
			expect(result.user).toBeUndefined();
		});

		it('roundtrips with codeVerifier and codeChallenge', () => {
			const packed = packState({ oauthReqInfo: oauthReqWithChallenge, codeVerifier: testVerifier });
			const result = unpackState(packed);

			expect(result.codeVerifier).toBe(testVerifier);
			expect(result.oauthReqInfo.codeChallenge).toBe(oauthReqWithChallenge.codeChallenge);
			expect(result.oauthReqInfo.codeChallengeMethod).toBe('S256');
		});
	});

	describe('oauthReqInfo + user (form consent state)', () => {
		it('roundtrips with user info', () => {
			const packed = packState({ oauthReqInfo: baseOAuthReq, user: testUser });
			const result = unpackState(packed);

			expect(result.oauthReqInfo.clientId).toBe(baseOAuthReq.clientId);
			expect(result.user).toEqual(testUser);
			expect(result.codeVerifier).toBeUndefined();
		});
	});

	describe('full pipeline with deflate', () => {
		it('roundtrips through deflate + base64url (form state)', async () => {
			const packed = packState({ oauthReqInfo: baseOAuthReq, user: testUser });
			const encoded = await deflateToBase64url(packed);

			// Should be URL-safe
			expect(encoded).not.toContain('+');
			expect(encoded).not.toContain('/');
			expect(encoded).not.toContain('=');

			const decoded = await inflateFromBase64url(encoded);
			const result = unpackState(decoded);

			expect(result.oauthReqInfo.clientId).toBe(baseOAuthReq.clientId);
			expect(result.user).toEqual(testUser);
		});

		it('roundtrips through deflate + base64url (URL state)', async () => {
			const packed = packState({ oauthReqInfo: oauthReqWithChallenge, codeVerifier: testVerifier });
			const encoded = await deflateToBase64url(packed);
			const decoded = await inflateFromBase64url(encoded);
			const result = unpackState(decoded);

			expect(result.codeVerifier).toBe(testVerifier);
			expect(result.oauthReqInfo.codeChallenge).toBe(oauthReqWithChallenge.codeChallenge);
		});
	});
});
