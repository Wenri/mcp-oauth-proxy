/**
 * SiYuan MCP - Main entry point
 *
 * This module provides a Model Context Protocol (MCP) server for SiYuan Note
 * that can run in both browser and Cloudflare Workers environments.
 */

// Platform abstraction
export {
  PlatformContext,
  SiyuanConfig,
  setPlatformContext,
  getPlatformContext,
  hasPlatformContext,
  createCloudflareContext,
  createBrowserContext,
} from './platform';

// API functions
export * from './syapi';
export * from './syapi/custom';

// Tools
export * from './tools';

// Server
export { createSiyuanMCPServer, runStdioServer, SiyuanMCPConfig } from './server';

// Utilities
export { isValidStr, isValidNotebookId, isMobile, isMacOs } from './utils/commonCheck';
export { createErrorResponse, createSuccessResponse, createJsonResponse } from './utils/mcpResponse';
export { filterBlock, filterNotebook } from './utils/filterCheck';
export { sleep, generateUUID, blobToBase64Object } from './utils/common';
export { lang } from './utils/lang';

// Logger
export { debugPush, logPush, warnPush, errorPush } from './logger';
