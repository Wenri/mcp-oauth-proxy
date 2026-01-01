/**
 * Platform abstraction types
 * Allows the same code to run in browser (SiYuan plugin) or Cloudflare Workers
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
  // Extended config fields for platform abstraction
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

export interface PlatformContext {
  /** SiYuan configuration - replaces window.siyuan.config */
  config: SiyuanConfig;

  /** Generate unique node ID - replaces window.Lute.NewNodeID() */
  generateNodeID: () => string;

  /** Fetch function with kernel base URL and auth - replaces relative fetch */
  kernelFetch: (url: string, init?: RequestInit) => Promise<Response>;

  /** Platform identifier */
  platform: 'browser' | 'cloudflare';
}

// Global context holder
let currentContext: PlatformContext | null = null;

export function setPlatformContext(ctx: PlatformContext): void {
  currentContext = ctx;
}

export function getPlatformContext(): PlatformContext {
  if (!currentContext) {
    throw new Error('Platform context not initialized. Call setPlatformContext first.');
  }
  return currentContext;
}

export function hasPlatformContext(): boolean {
  return currentContext !== null;
}
