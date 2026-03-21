/**
 * MCP SaaS - Shared Types
 *
 * This file exports shared types used across workers.
 * The actual worker implementations are in workers/ directory.
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
 * Used by auth-cfaccess worker
 */
export type AccessOAuthConfig = {
  ACCESS_CLIENT_ID: string;
  ACCESS_CLIENT_SECRET: string;
  ACCESS_TOKEN_URL: string;
  ACCESS_AUTHORIZATION_URL: string;
  ACCESS_JWKS_URL: string;
  COOKIE_ENCRYPTION_KEY: string;
};

/**
 * Props passed from auth workers to MCP backend
 * Stored in DO storage for session persistence
 */
export interface Props {
  accessToken: string;
  email: string;
  login: string;
  name: string;
  workerBaseUrl: string;
  kernelUrl?: string;
  kernelToken?: string;
  [key: string]: unknown;
}

/**
 * Auth context passed via HTTP headers from auth workers to MCP backend
 */
export interface AuthContext {
  props: Props;
  secret: string;           // For download URL encryption
  workerBaseUrl: string;    // Download URL domain
  encryptionKey: string;    // For encryption
}

/**
 * MCP Backend Worker environment
 */
export type MCPBackendEnv = Cloudflare.Env & SiyuanMCPConfig & {
  MCP_OBJECT: DurableObjectNamespace;
};

/**
 * Auth Worker environment (CF Access)
 */
export type AuthCfAccessEnv = Cloudflare.Env & AccessOAuthConfig & {
  OAUTH_KV: KVNamespace;
  MCP_BACKEND: Fetcher;
  SIYUAN_KERNEL_TOKEN?: string;
  SIYUAN_KERNEL_URL?: string;
  CF_ACCESS_SERVICE_CLIENT_ID?: string;
  CF_ACCESS_SERVICE_CLIENT_SECRET?: string;
};

/**
 * Auth Worker environment (API Key)
 */
export type AuthApiKeyEnv = Cloudflare.Env & {
  MCP_BACKEND: Fetcher;
  SIYUAN_KERNEL_TOKEN: string;
  SIYUAN_KERNEL_URL?: string;
  COOKIE_ENCRYPTION_KEY: string;
  CF_ACCESS_SERVICE_CLIENT_ID?: string;
  CF_ACCESS_SERVICE_CLIENT_SECRET?: string;
};

/**
 * Legacy Env type for CLI compatibility
 */
export type Env = Cloudflare.Env & SiyuanMCPConfig & AccessOAuthConfig;
