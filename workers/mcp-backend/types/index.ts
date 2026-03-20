/**
 * SiYuan MCP type exports
 *
 * Note: Most SiYuan types (Block, BlockId, Notebook, McpTool, etc.) are
 * declared as global types in kernel.d.ts and mcp.ts - they don't need
 * explicit imports.
 */

// Zod schemas for runtime JSON validation
export { jsonValueSchema, type JsonValue } from './schemas';

/**
 * Runtime config fetched from SiYuan kernel + merged user options
 * This is what getConfig() returns
 */
export type SiyuanConfig = {
  system: {
    id: string;
    os: string;
    kernelVersion: string;
    workspaceDir?: string;
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
  // Merged from SiyuanMCPConfig
  filterNotebooks?: string;
  filterDocuments?: string;
  appId?: string;
  autoApproveLocalChange?: boolean;
  rag?: {
    baseUrl: string;
    apiKey?: string;
  };
};
