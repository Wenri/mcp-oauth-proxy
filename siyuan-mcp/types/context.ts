/**
 * Context types for SiYuan MCP
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
  filterNotebooks?: string;
  filterDocuments?: string;
  appId?: string;
  autoApproveLocalChange?: boolean;
  rag?: {
    baseUrl: string;
    apiKey?: string;
  };
}

export interface ContextOptions {
  /** SiYuan kernel URL (e.g., https://siyuan.example.com) */
  kernelBaseUrl: string;
  /** SiYuan API token for authentication */
  kernelToken?: string;
  /** RAG server config */
  ragConfig?: {
    baseUrl: string;
    apiKey?: string;
  };
  /** Newline-separated notebook IDs to exclude */
  filterNotebooks?: string;
  /** Newline-separated document IDs to exclude */
  filterDocuments?: string;
  /** App ID for dailynote creation */
  appId?: string;
  /** Auto-approve local changes */
  autoApproveLocalChange?: boolean;
}
