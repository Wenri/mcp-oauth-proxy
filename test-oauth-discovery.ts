/**
 * Test OAuth Discovery using the same MCP SDK as the Inspector
 *
 * Usage: npx tsx test-oauth-discovery.ts [url]
 * Default URL: https://sy.wenri.me/sse
 */

import { ProxyAgent, fetch as undiciFetch } from "undici";
import {
  discoverOAuthProtectedResourceMetadata,
  discoverAuthorizationServerMetadata,
  extractWWWAuthenticateParams,
  selectResourceURL,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { resourceUrlFromServerUrl, checkResourceAllowed } from "@modelcontextprotocol/sdk/shared/auth-utils.js";

// Configure proxy from environment
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
let proxyFetch: typeof fetch = fetch;

if (proxyUrl) {
  console.log(`Using proxy: ${proxyUrl.replace(/jwt_[^@]+@/, "jwt_***@")}`);
  const proxyAgent = new ProxyAgent(proxyUrl);
  proxyFetch = ((url: string | URL, init?: RequestInit) => {
    return undiciFetch(url, { ...init, dispatcher: proxyAgent } as any);
  }) as typeof fetch;
}

const serverUrl = process.argv[2] || "https://sy.wenri.me/sse";

async function testDiscovery() {
  console.log("=".repeat(60));
  console.log(`Testing OAuth Discovery for: ${serverUrl}`);
  console.log("=".repeat(60));

  // Step 1: Try to fetch the server URL to get WWW-Authenticate header
  console.log("\n[Step 1] Fetching server URL to check WWW-Authenticate header...");
  try {
    const response = await proxyFetch(serverUrl, {
      headers: {
        "MCP-Protocol-Version": "2025-03-26",
      },
    });
    console.log(`  Status: ${response.status}`);
    console.log(`  WWW-Authenticate: ${response.headers.get("WWW-Authenticate") || "(none)"}`);

    if (response.status === 401) {
      const params = extractWWWAuthenticateParams(response);
      console.log(`  Extracted params:`, JSON.stringify(params, null, 2));
    }
  } catch (error) {
    console.log(`  Error: ${error}`);
  }

  // Step 2: Test Protected Resource Metadata discovery
  console.log("\n[Step 2] Testing discoverOAuthProtectedResourceMetadata...");
  try {
    const resourceMetadata = await discoverOAuthProtectedResourceMetadata(serverUrl, {}, proxyFetch);
    console.log("  Success! Resource Metadata:");
    console.log(JSON.stringify(resourceMetadata, null, 2));
  } catch (error) {
    console.log(`  Error: ${error}`);
  }

  // Step 3: Test path-aware discovery manually
  const url = new URL(serverUrl);
  const pathAwareUrl = `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
  const rootUrl = `${url.origin}/.well-known/oauth-protected-resource`;

  console.log("\n[Step 3] Testing path-aware discovery manually...");
  console.log(`  Path-aware URL: ${pathAwareUrl}`);
  try {
    const response = await proxyFetch(pathAwareUrl, {
      headers: { "MCP-Protocol-Version": "2025-03-26" },
    });
    console.log(`  Status: ${response.status}`);
    if (response.ok) {
      const data = await response.json();
      console.log("  Response:", JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.log(`  Error: ${error}`);
  }

  console.log(`\n  Root URL: ${rootUrl}`);
  try {
    const response = await proxyFetch(rootUrl, {
      headers: { "MCP-Protocol-Version": "2025-03-26" },
    });
    console.log(`  Status: ${response.status}`);
    if (response.ok) {
      const data = await response.json();
      console.log("  Response:", JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.log(`  Error: ${error}`);
  }

  // Step 4: Test Authorization Server Metadata discovery
  console.log("\n[Step 4] Testing discoverAuthorizationServerMetadata...");
  try {
    const authServerUrl = new URL("/", serverUrl);
    const metadata = await discoverAuthorizationServerMetadata(authServerUrl, { fetchFn: proxyFetch });
    console.log("  Success! Authorization Server Metadata:");
    console.log(JSON.stringify(metadata, null, 2));
  } catch (error) {
    console.log(`  Error: ${error}`);
  }

  // Step 5: Test CORS preflight
  console.log("\n[Step 5] Testing CORS preflight (OPTIONS)...");
  const corsUrls = [
    `${url.origin}/.well-known/oauth-protected-resource`,
    `${url.origin}/.well-known/oauth-authorization-server`,
  ];
  for (const corsUrl of corsUrls) {
    console.log(`\n  OPTIONS ${corsUrl}`);
    try {
      const response = await proxyFetch(corsUrl, {
        method: "OPTIONS",
        headers: {
          "Origin": "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "MCP-Protocol-Version",
        },
      });
      console.log(`  Status: ${response.status}`);
      console.log(`  Access-Control-Allow-Origin: ${response.headers.get("Access-Control-Allow-Origin") || "(none)"}`);
      console.log(`  Access-Control-Allow-Headers: ${response.headers.get("Access-Control-Allow-Headers") || "(none)"}`);
    } catch (error) {
      console.log(`  Error: ${error}`);
    }
  }

  // Step 6: Test resource URL validation
  console.log("\n[Step 6] Testing resource URL validation...");
  const defaultResource = resourceUrlFromServerUrl(serverUrl);
  console.log(`  Server URL: ${serverUrl}`);
  console.log(`  Default resource (from SDK): ${defaultResource}`);

  // Test against sy.wenri.me resource (origin only)
  const syResource = "https://sy.wenri.me";
  const syAllowed = checkResourceAllowed({
    requestedResource: defaultResource,
    configuredResource: syResource,
  });
  console.log(`  checkResourceAllowed("${defaultResource}", "${syResource}"): ${syAllowed}`);

  // Test against mcp.wenri.me style resource (with path)
  const mcpResource = `${new URL(serverUrl).origin}${new URL(serverUrl).pathname}`;
  const mcpAllowed = checkResourceAllowed({
    requestedResource: defaultResource,
    configuredResource: mcpResource,
  });
  console.log(`  checkResourceAllowed("${defaultResource}", "${mcpResource}"): ${mcpAllowed}`);

  console.log("\n" + "=".repeat(60));
  console.log("Discovery test complete");
  console.log("=".repeat(60));
}

testDiscovery().catch(console.error);
