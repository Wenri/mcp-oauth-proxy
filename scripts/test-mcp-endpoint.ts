/**
 * Test MCP Endpoint with OAuth Token
 *
 * Tests the full MCP protocol flow using SSE transport with an OAuth access token.
 *
 * Usage:
 *   npx tsx scripts/test-mcp-endpoint.ts <access_token> [url]
 *
 * Examples:
 *   npx tsx scripts/test-mcp-endpoint.ts "your-access-token"
 *   npx tsx scripts/test-mcp-endpoint.ts "your-access-token" https://sy.wenri.me/sse
 */

const accessToken = process.argv[2];
const serverUrl = process.argv[3] || "https://sy.wenri.me/sse";

if (!accessToken) {
  console.error("Usage: npx tsx scripts/test-mcp-endpoint.ts <access_token> [url]");
  console.error("\nExample:");
  console.error('  npx tsx scripts/test-mcp-endpoint.ts "a260e4f6-..."');
  process.exit(1);
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

let messageEndpoint: string | null = null;
let requestId = 0;
const pendingRequests = new Map<
  number,
  { resolve: (value: JsonRpcResponse) => void; reject: (error: Error) => void }
>();

// Parse SSE stream
async function* parseSSE(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<{ event?: string; data: string }> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let event: string | undefined;
    let data = "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data = line.slice(5).trim();
      } else if (line === "" && data) {
        yield { event, data };
        event = undefined;
        data = "";
      }
    }
  }
}

async function sendRequest(
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = 15000
): Promise<JsonRpcResponse> {
  if (!messageEndpoint) {
    throw new Error("SSE connection not established - no message endpoint");
  }

  const id = ++requestId;
  const request: JsonRpcRequest = {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };

  const url = new URL(messageEndpoint, serverUrl);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  // Wait for response via pending requests map
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

async function sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
  if (!messageEndpoint) {
    throw new Error("SSE connection not established");
  }

  const request: JsonRpcRequest = {
    jsonrpc: "2.0",
    method,
    params,
  };

  const url = new URL(messageEndpoint, serverUrl);
  await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(request),
  });
}

async function testMcpEndpoint() {
  console.log("=".repeat(60));
  console.log(`Testing MCP Endpoint: ${serverUrl}`);
  console.log(`Token: ${accessToken.substring(0, 20)}...`);
  console.log("=".repeat(60));

  // Step 1: Establish SSE connection
  console.log("\n[Step 1] Establishing SSE connection...");

  const sseResponse = await fetch(serverUrl, {
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!sseResponse.ok) {
    throw new Error(`SSE connection failed: ${sseResponse.status} ${await sseResponse.text()}`);
  }

  const reader = sseResponse.body!.getReader();

  // Start reading SSE in background
  const sseReader = (async () => {
    try {
      for await (const { event, data } of parseSSE(reader)) {
        if (event === "endpoint") {
          messageEndpoint = data;
          console.log(`  ✓ Connected! Message endpoint: ${messageEndpoint}`);
        } else if (event === "message" || !event) {
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
    } catch (error) {
      console.error("SSE read error:", error);
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
      reject(new Error("Timeout waiting for SSE endpoint"));
    }, 10000);
  });

  try {
    // Step 2: Initialize MCP session
    console.log("\n[Step 2] Sending initialize request...");
    const initResponse = await sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-mcp-endpoint", version: "1.0.0" },
    });

    if (initResponse.error) {
      console.log(`  ✗ Error: ${initResponse.error.message}`);
    } else {
      console.log("  ✓ Initialize successful!");
      console.log("  Server info:", JSON.stringify(initResponse.result, null, 2));
    }

    // Step 3: Send initialized notification
    console.log("\n[Step 3] Sending initialized notification...");
    await sendNotification("notifications/initialized");
    console.log("  ✓ Sent initialized notification");

    // Step 4: List available tools
    console.log("\n[Step 4] Listing available tools...");
    const toolsResponse = await sendRequest("tools/list");

    if (toolsResponse.error) {
      console.log(`  ✗ Error: ${toolsResponse.error.message}`);
    } else {
      const result = toolsResponse.result as { tools: Array<{ name: string; description: string }> };
      console.log(`  ✓ Found ${result.tools.length} tools:`);
      for (const tool of result.tools.slice(0, 10)) {
        console.log(`    - ${tool.name}: ${tool.description.substring(0, 50)}...`);
      }
      if (result.tools.length > 10) {
        console.log(`    ... and ${result.tools.length - 10} more`);
      }
    }

    // Step 5: Call get_current_time tool
    console.log("\n[Step 5] Calling get_current_time tool...");
    const timeResponse = await sendRequest("tools/call", {
      name: "get_current_time",
      arguments: {},
    });

    if (timeResponse.error) {
      console.log(`  ✗ Error: ${timeResponse.error.message}`);
    } else {
      const result = timeResponse.result as { content: Array<{ type: string; text: string }> };
      console.log("  ✓ Tool call successful!");
      if (result.content?.[0]?.text) {
        console.log(`  Current time: ${result.content[0].text}`);
      }
    }

    // Step 6: Call siyuan_list_notebook tool
    console.log("\n[Step 6] Calling siyuan_list_notebook tool...");
    const notebookResponse = await sendRequest("tools/call", {
      name: "siyuan_list_notebook",
      arguments: {},
    });

    if (notebookResponse.error) {
      console.log(`  ✗ Error: ${notebookResponse.error.message}`);
    } else {
      const result = notebookResponse.result as { content: Array<{ type: string; text: string }> };
      console.log("  ✓ Tool call successful!");
      if (result.content?.[0]?.text) {
        const text = result.content[0].text;
        console.log(`  Response preview: ${text.substring(0, 300)}${text.length > 300 ? "..." : ""}`);
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ MCP Endpoint test complete!");
    console.log("=".repeat(60));
  } finally {
    reader.cancel();
  }
}

testMcpEndpoint().catch((error) => {
  console.error("\n❌ Test failed:", error.message);
  process.exit(1);
});
