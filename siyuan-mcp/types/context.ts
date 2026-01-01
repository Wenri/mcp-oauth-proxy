/**
 * Context types for SiYuan MCP
 */

/**
 * Environment-style config (SCREAMING_SNAKE_CASE)
 * Can pass Cloudflare Workers env directly to initializeSiyuanMCPServer()
 */
export interface SiyuanEnvConfig {
  SIYUAN_KERNEL_URL: string;
  SIYUAN_KERNEL_TOKEN?: string;
  RAG_BASE_URL?: string;
  RAG_API_KEY?: string;
  FILTER_NOTEBOOKS?: string;
  FILTER_DOCUMENTS?: string;
  READ_ONLY_MODE?: 'allow_all' | 'allow_non_destructive' | 'deny_all';
}

/**
 * Internal configuration options (camelCase)
 * Used by initializeContext() and internal functions
 */
export interface SiyuanMCPConfig {
  /** SiYuan kernel URL (e.g., https://siyuan.example.com) */
  kernelBaseUrl: string;
  /** SiYuan API token for authentication */
  kernelToken?: string;
  /** RAG backend URL */
  ragBaseUrl?: string;
  /** RAG API key */
  ragApiKey?: string;
  /** Newline-separated notebook IDs to exclude */
  filterNotebooks?: string;
  /** Newline-separated document IDs to exclude */
  filterDocuments?: string;
  /** App ID for dailynote creation */
  appId?: string;
  /** Read-only mode for tools */
  readOnlyMode?: 'allow_all' | 'allow_non_destructive' | 'deny_all';
  /** Auto-approve local changes (default: true) */
  autoApproveLocalChange?: boolean;
}

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
