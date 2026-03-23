/**
 * MCP SaaS - Shared Types
 *
 * This file exports shared types used across workers.
 * The actual worker implementations are in workers/ directory.
 */

import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

// ============================================================================
// Shared Types
// ============================================================================

/**
 * Kernel connection config — shared by all three workers.
 * Includes CF Access Service Token for authenticating worker-to-kernel requests.
 */
export type KernelConfig = {
  SIYUAN_KERNEL_URL?: string;
  SIYUAN_KERNEL_TOKEN?: string;
  CF_ACCESS_SERVICE_CLIENT_ID?: string;
  CF_ACCESS_SERVICE_CLIENT_SECRET?: string;
};

/**
 * Tool behaviour tunables — mcp-backend only.
 */
export type SiyuanToolConfig = {
  RAG_BASE_URL?: string;
  RAG_API_KEY?: string;
  FILTER_NOTEBOOKS?: string;
  FILTER_DOCUMENTS?: string;
  READ_ONLY_MODE?: 'allow_all' | 'allow_non_destructive' | 'deny_all';
  AUTO_APPROVE_LOCAL_CHANGE?: boolean;
};


/**
 * Cloudflare Access OAuth configuration — auth-cfaccess worker only.
 */
export type AccessOAuthConfig = {
  ACCESS_CLIENT_ID: string;
  ACCESS_CLIENT_SECRET: string;
  ACCESS_TOKEN_URL: string;
  ACCESS_AUTHORIZATION_URL: string;
  ACCESS_JWKS_URL: string;
};

/**
 * Metadata stored alongside OAuth grants in KV
 */
export type GrantMetadata = {
  label: string;             // User-friendly grant label
  fetchBaseUrl: string;      // Auth worker origin for download URLs
  kernelUrl: string;         // Per-user SiYuan kernel URL
};

/**
 * Props passed from auth workers to MCP backend
 * Stored in DO storage for session persistence
 */
export type Props = {
  email: string;
  login: string;
  name: string;
  kernelToken?: string;
};

/**
 * Auth context passed from auth workers to MCP backend via RPC
 */
export type AuthContext = GrantMetadata & Props & {
  secret: string;            // For download URL encryption (grant key)
};

/**
 * MCP Backend Worker environment
 */
export type MCPBackendEnv = Cloudflare.Env & KernelConfig & SiyuanToolConfig & {
  MCP_OBJECT: DurableObjectNamespace;
  COOKIE_ENCRYPTION_KEY: string;
};

// Import backend entrypoint type for Service<> binding
import type McpRpc from './workers/mcp-backend/index';

/**
 * Auth Worker environment (CF Access)
 */
export type AuthCfAccessEnv = Cloudflare.Env & KernelConfig & AccessOAuthConfig & {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  MCP_BACKEND: Service<typeof McpRpc>;
  COOKIE_ENCRYPTION_KEY: string;
};

/**
 * Auth Worker environment (API Key)
 */
export type AuthApiKeyEnv = Cloudflare.Env & KernelConfig & {
  MCP_BACKEND: Service<typeof McpRpc>;
  SIYUAN_KERNEL_TOKEN: string;  // required: primary auth mechanism
  COOKIE_ENCRYPTION_KEY: string;
};

/**
 * Legacy Env type for CLI compatibility
 */
export type Env = Cloudflare.Env & KernelConfig & SiyuanToolConfig & AccessOAuthConfig;
