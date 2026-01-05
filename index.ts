/**
 * MCP OAuth Proxy for Cloudflare Workers
 *
 * Entry point - exports OAuthProvider and shared types.
 */

// ============================================================================
// Shared Types
// ============================================================================

/**
 * SiYuan-specific config subset
 * Used by initializeSiyuanMCPServer() - can pass full Env or just these fields
 * Uses string types (not literals) for CLI compatibility
 */
export type SiyuanMCPConfig = {
  SIYUAN_KERNEL_URL?: string;
  SIYUAN_KERNEL_TOKEN?: string;
  RAG_BASE_URL?: string;
  RAG_API_KEY?: string;
  FILTER_NOTEBOOKS?: string;
  FILTER_DOCUMENTS?: string;
  READ_ONLY_MODE?: 'allow_all' | 'allow_non_destructive' | 'deny_all';
  AUTO_APPROVE_LOCAL_CHANGE?: boolean;
  // CF Access Service Token for kernel API authentication
  CF_ACCESS_SERVICE_CLIENT_ID?: string;
  CF_ACCESS_SERVICE_CLIENT_SECRET?: string;
};

/**
 * Cloudflare Access OAuth configuration
 * Based on: https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-cf-access
 */
type AccessOAuthConfig = {
  ACCESS_CLIENT_ID: string;
  ACCESS_CLIENT_SECRET: string;
  ACCESS_TOKEN_URL: string;
  ACCESS_AUTHORIZATION_URL: string;
  ACCESS_JWKS_URL: string;
  COOKIE_ENCRYPTION_KEY: string;
};

/**
 * Cloudflare Workers environment bindings
 * Combines Cloudflare.Env (KV, vars), SiyuanMCPConfig, and Access OAuth config
 */
export type Env = Cloudflare.Env & SiyuanMCPConfig & AccessOAuthConfig;

// ============================================================================
// Exports
// ============================================================================

export { default, SiyuanMCP } from './handlers';
