/**
 * Platform abstraction module
 * Re-exports all platform types and functions
 */

export type { PlatformContext, SiyuanConfig } from './types';
export { getPlatformContext, setPlatformContext, hasPlatformContext } from './types';
export { createCloudflareContext, type CloudflareContextOptions } from './cloudflare';
export { createBrowserContext } from './browser';
