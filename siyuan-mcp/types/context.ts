/**
 * Context types for SiYuan MCP
 */

/**
 * Cloudflare Workers environment bindings
 * Single source of truth for all env vars
 */
export interface Env {
  // KV namespace for OAuth state and indexing queue
  OAUTH_KV: KVNamespace;

  // Cloudflare Access OAuth settings
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  COOKIE_ENCRYPTION_KEY: string;

  // MCP proxy settings
  DOWNSTREAM_MCP_URL: string;

  // SiYuan kernel settings
  SIYUAN_KERNEL_URL: string;
  SIYUAN_KERNEL_TOKEN?: string;

  // RAG backend settings
  RAG_BASE_URL?: string;
  RAG_API_KEY?: string;

  // Filter settings
  FILTER_NOTEBOOKS?: string;
  FILTER_DOCUMENTS?: string;

  // Tool settings
  READ_ONLY_MODE?: 'allow_all' | 'allow_non_destructive' | 'deny_all';
  AUTO_APPROVE_LOCAL_CHANGE?: boolean;
}

/**
 * SiYuan-specific config subset
 * Used by initializeSiyuanMCPServer() - can pass full Env or just these fields
 */
export type SiyuanMCPConfig = Pick<
  Env,
  | 'SIYUAN_KERNEL_URL'
  | 'SIYUAN_KERNEL_TOKEN'
  | 'RAG_BASE_URL'
  | 'RAG_API_KEY'
  | 'FILTER_NOTEBOOKS'
  | 'FILTER_DOCUMENTS'
  | 'READ_ONLY_MODE'
  | 'AUTO_APPROVE_LOCAL_CHANGE'
>;

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
