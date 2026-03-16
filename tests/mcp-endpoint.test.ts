/**
 * Integration tests for MCP endpoint via API key auth
 * Converted from scripts/test-mcp-endpoint.ts
 *
 * Requires:
 * - MCP_TEST_API_KEY: SiYuan API key for authentication
 * - MCP_TEST_API_URL: API endpoint (default: https://api-sy.wenri.org/sse)
 *
 * Skipped automatically if MCP_TEST_API_KEY is not set.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const apiKey = process.env.MCP_TEST_API_KEY;
const serverUrl = process.env.MCP_TEST_API_URL || 'https://api-sy.wenri.org/sse';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Parse SSE stream into events */
async function* parseSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<{ event?: string; data: string }> {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let event: string | undefined;
    let data = '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data = line.slice(5).trim();
      } else if (line === '' && data) {
        yield { event, data };
        event = undefined;
        data = '';
      }
    }
  }
}

describe.skipIf(!apiKey)('MCP Endpoint (API key)', { timeout: 30000 }, () => {
  let messageEndpoint: string | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let requestId = 0;
  const pendingRequests = new Map<
    number,
    { resolve: (value: JsonRpcResponse) => void; reject: (error: Error) => void }
  >();

  async function sendRequest(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 15000
  ): Promise<JsonRpcResponse> {
    if (!messageEndpoint) {
      throw new Error('SSE connection not established');
    }

    const id = ++requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const url = new URL(messageEndpoint, serverUrl);
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SiYuan-Key': apiKey!,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error(`Request ${id} (${method}) timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
    });
  }

  async function sendNotification(
    method: string,
    params?: Record<string, unknown>
  ): Promise<void> {
    if (!messageEndpoint) {
      throw new Error('SSE connection not established');
    }

    const request: JsonRpcRequest = { jsonrpc: '2.0', method, params };
    const url = new URL(messageEndpoint, serverUrl);
    await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SiYuan-Key': apiKey!,
      },
      body: JSON.stringify(request),
    });
  }

  beforeAll(async () => {
    // Establish SSE connection
    const sseResponse = await fetch(serverUrl, {
      headers: {
        Accept: 'text/event-stream',
        'X-SiYuan-Key': apiKey!,
      },
    });

    if (!sseResponse.ok) {
      throw new Error(`SSE connection failed: ${sseResponse.status}`);
    }

    reader = sseResponse.body!.getReader();

    // Start reading SSE in background
    (async () => {
      try {
        for await (const { event, data } of parseSSE(reader!)) {
          if (event === 'endpoint') {
            messageEndpoint = data;
          } else if (event === 'message' || !event) {
            try {
              const json = JSON.parse(data) as JsonRpcResponse;
              if (json.id && pendingRequests.has(json.id)) {
                const { resolve } = pendingRequests.get(json.id)!;
                pendingRequests.delete(json.id);
                resolve(json);
              }
            } catch {
              // Not JSON, ignore
            }
          }
        }
      } catch {
        // Stream ended
      }
    })();

    // Wait for endpoint event
    await new Promise<void>((resolve, reject) => {
      const check = setInterval(() => {
        if (messageEndpoint) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(check);
        reject(new Error('Timeout waiting for SSE endpoint'));
      }, 10000);
    });
  });

  afterAll(() => {
    reader?.cancel();
  });

  it('initializes MCP session', async () => {
    const response = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'vitest-mcp-endpoint', version: '1.0.0' },
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const result = response.result as { serverInfo: { name: string } };
    expect(result.serverInfo.name).toBe('siyuan-mcp');

    // Send initialized notification
    await sendNotification('notifications/initialized');
  });

  it('lists available tools', async () => {
    const response = await sendRequest('tools/list');

    expect(response.error).toBeUndefined();
    const result = response.result as { tools: Array<{ name: string; description: string }> };
    expect(result.tools.length).toBeGreaterThan(0);

    // Verify some expected tools exist
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain('get_current_time');
    expect(toolNames).toContain('siyuan_list_notebook');
  });

  it('calls get_current_time tool', async () => {
    const response = await sendRequest('tools/call', {
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
    const response = await sendRequest('tools/call', {
      name: 'siyuan_list_notebook',
      arguments: {},
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    expect(result.content).toBeDefined();
    expect(result.content[0].text).toBeTruthy();
  });
});
