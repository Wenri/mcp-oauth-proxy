import CFAccessHandler from "./cf-access-handler";

// Environment bindings
export interface Env {
  OAUTH_KV: KVNamespace;
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
  CF_ACCESS_TEAM_DOMAIN: string; // e.g., "myteam.cloudflareaccess.com"
  COOKIE_ENCRYPTION_KEY: string;
  // Downstream MCP server URL - returned in OAuth metadata for client discovery
  DOWNSTREAM_MCP_URL: string;
}

// Export the CF Access handler directly - no proxy needed
// Clients get CF Access JWT and talk to downstream MCP server directly
export default CFAccessHandler;
