/**
 * Browser platform implementation (for SiYuan plugin)
 * This maintains compatibility with the original plugin code
 */

import type { PlatformContext, SiyuanConfig } from './types';

declare global {
  interface Window {
    siyuan: {
      config: SiyuanConfig;
      notebooks: any[];
      layout: any;
    };
    Lute: {
      NewNodeID: () => string;
    };
  }
}

/**
 * Create a platform context for browser (SiYuan plugin)
 * Uses window.siyuan and window.Lute directly
 */
export function createBrowserContext(): PlatformContext {
  return {
    config: window.siyuan.config,
    generateNodeID: () => window.Lute.NewNodeID(),
    kernelFetch: (url: string, init?: RequestInit) => fetch(url, init),
    platform: 'browser',
  };
}
