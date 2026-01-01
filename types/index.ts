/**
 * Shared types for MCP OAuth Proxy
 */

/**
 * SiYuan-specific config subset
 * Used by initializeSiyuanMCPServer() - can pass full Env or just these fields
 * Uses string types (not literals) for CLI compatibility
 */
export interface SiyuanMCPConfig {
  SIYUAN_KERNEL_URL: string;
  SIYUAN_KERNEL_TOKEN?: string;
  RAG_BASE_URL?: string;
  RAG_API_KEY?: string;
  FILTER_NOTEBOOKS?: string;
  FILTER_DOCUMENTS?: string;
  READ_ONLY_MODE?: 'allow_all' | 'allow_non_destructive' | 'deny_all';
  AUTO_APPROVE_LOCAL_CHANGE?: boolean;
}

/**
 * Secrets that must be set via wrangler secret put
 */
interface EnvSecrets {
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
}

/**
 * Cloudflare Workers environment bindings
 * Combines Cloudflare.Env (KV, vars), SiyuanMCPConfig (SiYuan settings), and secrets
 */
export type Env = Cloudflare.Env & SiyuanMCPConfig & EnvSecrets;

/**
 * Runtime config fetched from SiYuan kernel + merged user options
 * This is what getConfig() returns
 */
export interface SiyuanConfig {
  system: {
    id: string;
    os: string;
    kernelVersion: string;
  };
  editor: {
    markdown: {
      inlineMath: boolean;
    };
  };
  export: {
    addTitle: boolean;
  };
  flashcard: {
    deck: boolean;
  };
  fileTree: {
    sort: number;
  };
  notebooks?: any[];
  // Merged from SiyuanMCPConfig
  filterNotebooks?: string;
  filterDocuments?: string;
  appId?: string;
  autoApproveLocalChange?: boolean;
  rag?: {
    baseUrl: string;
    apiKey?: string;
  };
}
