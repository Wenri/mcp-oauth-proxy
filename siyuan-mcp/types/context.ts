/**
 * Context types for SiYuan MCP
 */

/**
 * Configuration for SiYuan MCP server
 * Uses SCREAMING_SNAKE_CASE to match CF Workers env bindings
 * Can pass Cloudflare Workers env directly to initializeSiyuanMCPServer()
 */
export interface SiyuanMCPConfig {
  /** SiYuan kernel URL (e.g., https://siyuan.example.com) */
  SIYUAN_KERNEL_URL: string;
  /** SiYuan API token for authentication */
  SIYUAN_KERNEL_TOKEN?: string;
  /** RAG backend URL */
  RAG_BASE_URL?: string;
  /** RAG API key */
  RAG_API_KEY?: string;
  /** Newline-separated notebook IDs to exclude */
  FILTER_NOTEBOOKS?: string;
  /** Newline-separated document IDs to exclude */
  FILTER_DOCUMENTS?: string;
  /** Read-only mode for tools */
  READ_ONLY_MODE?: 'allow_all' | 'allow_non_destructive' | 'deny_all';
  /** Auto-approve local changes (default: true) */
  AUTO_APPROVE_LOCAL_CHANGE?: boolean;
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
