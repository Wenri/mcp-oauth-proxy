/**
 * SiYuan MCP type exports
 *
 * Note: Most SiYuan types (Block, BlockId, Notebook, McpTool, etc.) are
 * declared as global types in kernel.d.ts and mcp.ts - they don't need
 * explicit imports.
 *
 * This barrel export provides Zod schemas for runtime JSON validation.
 */

export { jsonValueSchema, type JsonValue } from './schemas';
