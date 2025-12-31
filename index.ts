import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import CFAccessHandler, { decodeJWTClaims } from "./cf-access-handler";

// Define the authentication context type
export interface AuthContext {
  claims: {
    sub: string;
    email?: string;
    name?: string;
    groups?: string[];
    [key: string]: unknown;
  };
  accessToken: string;
  refreshToken?: string;
}

// Environment bindings
export interface Env {
  OAUTH_KV: KVNamespace;
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
  CF_ACCESS_TEAM_DOMAIN: string; // e.g., "myteam.cloudflareaccess.com"
  COOKIE_ENCRYPTION_KEY: string;
  // Downstream MCP server URL (e.g., "https://sy.wenri.me/mcp")
  DOWNSTREAM_MCP_URL: string;
}

// Proxy MCP requests to downstream server with authentication
async function proxyToDownstream(
  request: Request,
  authContext: AuthContext,
  env: Env
): Promise<Response> {
  const downstreamUrl = env.DOWNSTREAM_MCP_URL;

  if (!downstreamUrl) {
    return new Response(
      JSON.stringify({ error: "DOWNSTREAM_MCP_URL not configured" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Clone the request to forward to downstream
  const downstreamRequest = new Request(downstreamUrl, {
    method: request.method,
    headers: {
      ...Object.fromEntries(request.headers),
      // Add Cloudflare Access token for downstream authentication
      Authorization: `Bearer ${authContext.accessToken}`,
      // Add user context as custom headers for downstream server
      "X-User-Email": authContext.claims.email || "",
      "X-User-Name": authContext.claims.name || "",
      "X-User-Sub": authContext.claims.sub,
      "X-User-Groups": authContext.claims.groups?.join(",") || "",
    },
    body: request.body,
    // @ts-ignore - duplex is needed for streaming
    duplex: request.body ? "half" : undefined,
  });

  try {
    const response = await fetch(downstreamRequest);

    // Return the downstream response as-is, preserving headers and streaming
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        ...Object.fromEntries(response.headers),
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Error proxying to downstream MCP server:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to connect to downstream MCP server",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// MCP API handler that proxies requests to downstream server
const McpApiHandler = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    let authContext: AuthContext;

    // Try X-Auth-Context header first (set by OAuthProvider)
    const xAuthContext = request.headers.get("X-Auth-Context");
    if (xAuthContext) {
      try {
        authContext = JSON.parse(xAuthContext);
      } catch {
        return new Response("Invalid auth context", { status: 400 });
      }
    } else {
      // Fall back to decoding JWT from Authorization header
      // This supports clients sending CF Access JWT directly
      const authHeader = request.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "invalid_token", error_description: "Missing or invalid access token" }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }

      const token = authHeader.slice(7); // Remove "Bearer " prefix
      try {
        const claims = decodeJWTClaims(token);
        authContext = {
          claims: {
            sub: claims.sub,
            email: claims.email,
            name: claims.name,
            groups: claims.groups,
          },
          accessToken: token,
        };
      } catch {
        return new Response(
          JSON.stringify({ error: "invalid_token", error_description: "Invalid JWT token" }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Proxy all requests to downstream MCP server
    return proxyToDownstream(request, authContext, env);
  },
};

// Export the OAuthProvider as the default handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: McpApiHandler as any,
  defaultHandler: CFAccessHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
