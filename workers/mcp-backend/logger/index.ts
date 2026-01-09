/**
 * Logger utilities
 * Platform-agnostic logging
 */

const DEBUG = false;

export function logPush(...args: any[]): void {
  console.log('[SiYuan MCP]', ...args);
}

export function debugPush(...args: any[]): void {
  if (DEBUG) {
    console.debug('[SiYuan MCP Debug]', ...args);
  }
}

export function warnPush(...args: any[]): void {
  console.warn('[SiYuan MCP]', ...args);
}

export function errorPush(...args: any[]): void {
  console.error('[SiYuan MCP]', ...args);
}
