/**
 * Integration tests for OAuth discovery endpoints
 * Converted from scripts/test-oauth-discovery.ts
 *
 * Requires network access to the deployed worker.
 * Set MCP_TEST_SERVER_URL to override the default (https://sy.wenri.org/sse).
 * Skipped automatically if the server is unreachable.
 */

import { describe, it, expect } from 'vitest';
import {
  discoverAuthorizationServerMetadata,
  extractWWWAuthenticateParams,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { resourceUrlFromServerUrl, checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js';

const serverUrl = process.env.MCP_TEST_SERVER_URL || 'https://sy.wenri.org/sse';
const url = new URL(serverUrl);

// Top-level await: check reachability before tests run
let serverReachable = false;
try {
  const response = await fetch(url.origin, { signal: AbortSignal.timeout(5000) });
  serverReachable = response.status > 0;
} catch {
  serverReachable = false;
}

describe.skipIf(!serverReachable)('OAuth Discovery', { timeout: 15000 }, () => {
  it('returns 401 with WWW-Authenticate header on unauthenticated request', async () => {
    const response = await fetch(serverUrl, {
      headers: { 'MCP-Protocol-Version': '2025-03-26' },
    });

    expect(response.status).toBe(401);
    const wwwAuth = response.headers.get('WWW-Authenticate');
    expect(wwwAuth).toBeTruthy();

    const params = extractWWWAuthenticateParams(response);
    expect(params).toBeDefined();
  });

  it('discovers Authorization Server Metadata', async () => {
    const authServerUrl = new URL('/', serverUrl);
    const metadata = await discoverAuthorizationServerMetadata(authServerUrl, {});

    expect(metadata).toBeDefined();
    if (!metadata) return;
    expect(metadata.issuer).toBe(url.origin);
    expect(metadata.authorization_endpoint).toBeDefined();
    expect(metadata.token_endpoint).toBeDefined();
    expect(metadata.registration_endpoint).toBeDefined();
    expect(metadata.code_challenge_methods_supported).toContain('S256');
  });

  it('serves Authorization Server Metadata as JSON', async () => {
    const metadataUrl = `${url.origin}/.well-known/oauth-authorization-server`;
    const response = await fetch(metadataUrl);

    expect(response.ok).toBe(true);
    const data = await response.json() as { issuer?: string; authorization_endpoint?: string };
    expect(data.issuer).toBe(url.origin);
    expect(data.authorization_endpoint).toContain('/authorize');
  });

  it('handles CORS preflight for Authorization Server Metadata', async () => {
    const metadataUrl = `${url.origin}/.well-known/oauth-authorization-server`;
    const response = await fetch(metadataUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'MCP-Protocol-Version',
      },
    });

    // Should return 200 or 204 for preflight
    expect(response.status).toBeLessThan(400);
    const allowOrigin = response.headers.get('Access-Control-Allow-Origin');
    expect(allowOrigin).toBeTruthy();
  });

  it('returns Protected Resource Metadata (RFC 9728)', async () => {
    const response = await fetch(`${url.origin}/.well-known/oauth-protected-resource`);
    expect(response.status).toBe(200);
    const data = await response.json() as { resource: string };
    expect(data.resource).toBeTruthy();
  });
});

describe('Resource URL validation (offline)', () => {
  it('computes default resource URL from server URL', () => {
    const resource = resourceUrlFromServerUrl(serverUrl);
    expect(resource).toBeDefined();
    expect(resource.toString()).toContain(url.origin);
  });

  it('validates resource against origin', () => {
    const defaultResource = resourceUrlFromServerUrl(serverUrl);
    const originResource = url.origin;
    const allowed = checkResourceAllowed({
      requestedResource: defaultResource,
      configuredResource: originResource,
    });
    expect(allowed).toBe(true);
  });

  it('validates resource against full path', () => {
    const defaultResource = resourceUrlFromServerUrl(serverUrl);
    const pathResource = `${url.origin}${url.pathname}`;
    const allowed = checkResourceAllowed({
      requestedResource: defaultResource,
      configuredResource: pathResource,
    });
    expect(allowed).toBe(true);
  });
});
