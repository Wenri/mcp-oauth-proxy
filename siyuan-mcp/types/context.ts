/**
 * Context types for SiYuan MCP
 */

// Re-export shared types for convenience
export type { Env, SiyuanMCPConfig } from '../../types/env';

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
