/**
 * SiYuan MCP - Main entry point
 *
 * This module provides a Model Context Protocol (MCP) server for SiYuan Note
 * running on Cloudflare Workers.
 */

// Server initialization (main public API)
export { initializeSiyuanMCPServer, createSiyuanMCPServer } from './server';

// Logger (used by handlers)
export { logPush } from './logger';

// Re-export types for convenience (canonical source is ../types)
export type { Env, SiyuanConfig, SiyuanMCPConfig } from '../types';
