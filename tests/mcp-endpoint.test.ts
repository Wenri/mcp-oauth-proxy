/**
 * Integration tests for MCP endpoint via API key auth
 * Converted from scripts/test-mcp-endpoint.ts
 *
 * Requires:
 * - MCP_TEST_API_KEY: SiYuan API key for authentication
 * - MCP_TEST_API_URL: API endpoint (default: https://sy.wenri.org/mcp)
 *
 * Auth header is determined by the endpoint:
 * - api-sy.* uses X-SiYuan-Key header
 * - sy.* uses Authorization: Bearer (resolveExternalToken)
 *
 * Skipped automatically if MCP_TEST_API_KEY is not set.
 */

import { describe, it, expect } from 'vitest';

const apiKey = process.env.MCP_TEST_API_KEY;
const serverUrl = process.env.MCP_TEST_API_URL || 'https://sy.wenri.org/mcp';

/** Build auth headers based on the endpoint */
function authHeaders(): Record<string, string> {
  const url = new URL(serverUrl);
  if (url.hostname.startsWith('api-')) {
    return { 'X-SiYuan-Key': apiKey! };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

let sessionId: string | undefined;

/**
 * Send a JSON-RPC request via Streamable HTTP transport.
 * The server returns SSE events; we parse to extract the JSON-RPC response.
 */
async function sendRequest(
  method: string,
  id: number,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...authHeaders(),
  };
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }

  const response = await fetch(serverUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  // Capture session ID from response
  const newSessionId = response.headers.get('mcp-session-id');
  if (newSessionId) {
    sessionId = newSessionId;
  }

  const contentType = response.headers.get('Content-Type') || '';

  // If JSON response, parse directly
  if (contentType.includes('application/json')) {
    return response.json() as Promise<JsonRpcResponse>;
  }

  // If SSE response, parse events to find the JSON-RPC response
  if (contentType.includes('text/event-stream')) {
    const text = await response.text();
    for (const line of text.split('\n')) {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        try {
          const json = JSON.parse(data) as JsonRpcResponse;
          if (json.id === id) return json;
        } catch {
          // Not JSON, continue
        }
      }
    }
    throw new Error(`No response found for request ${id} in SSE stream`);
  }

  throw new Error(`Unexpected content type: ${contentType}`);
}

/** Send a JSON-RPC notification (no id, no response expected) */
async function sendNotification(
  method: string,
  params?: Record<string, unknown>,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...authHeaders(),
  };
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }

  await fetch(serverUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method, params }),
  });
}

describe.skipIf(!apiKey)('MCP Endpoint (API key)', { timeout: 30000 }, () => {
  it('initializes MCP session', async () => {
    const response = await sendRequest('initialize', 1, {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'vitest-mcp-endpoint', version: '1.0.0' },
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const result = response.result as { serverInfo: { name: string } };
    expect(result.serverInfo.name).toBe('siyuan-mcp');
    expect(sessionId).toBeTruthy();

    await sendNotification('notifications/initialized');
  });

  it('lists available tools', async () => {
    const response = await sendRequest('tools/list', 2);

    expect(response.error).toBeUndefined();
    const result = response.result as { tools: Array<{ name: string; description: string }> };
    expect(result.tools.length).toBeGreaterThan(0);

    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain('get_current_time');
    expect(toolNames).toContain('siyuan_list_notebook');
  });

  it('calls get_current_time tool', async () => {
    const response = await sendRequest('tools/call', 3, {
      name: 'get_current_time',
      arguments: {},
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBeTruthy();
  });

  it('calls siyuan_list_notebook tool', async () => {
    const response = await sendRequest('tools/call', 4, {
      name: 'siyuan_list_notebook',
      arguments: {},
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    expect(result.content).toBeDefined();
    expect(result.content[0].text).toBeTruthy();
  });
});
