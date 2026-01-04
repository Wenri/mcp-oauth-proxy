/**
 * Base resource provider for MCP resources
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Abstract base class for resource providers.
 * Each provider registers one or more resources with the MCP server.
 */
export abstract class McpResourceProvider {
  /**
   * Register resources with the MCP server.
   * Called during server initialization.
   */
  abstract registerResources(server: McpServer): Promise<void>;
}
