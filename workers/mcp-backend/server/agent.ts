/**
 * SiYuan MCP Agent for Cloudflare Workers
 *
 * This class extends McpAgent to provide SiYuan MCP functionality.
 * It receives auth context from auth workers and manages MCP sessions.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import type { MCPBackendEnv, AuthContext } from '../../../index';
import {
  initializeSiyuanMCPServer,
  setDownloadContext,
  logPush,
} from '.';
import pkg from '../../../package.json' with { type: 'json' };

/**
 * SiYuan MCP Agent
 *
 * - Receives props from auth workers via ctx.props
 * - Stores props in DO storage for session persistence
 * - Initializes MCP server with SiYuan tools
 */
export class SiyuanMCP extends McpAgent<MCPBackendEnv, Record<string, never>, AuthContext> {
  server = new McpServer({
    name: pkg.name,
    version: pkg.version,
  });

  async init() {
    // Restore props from storage if not provided (subsequent requests)
    if (!this.props) {
      this.props = await this.ctx.storage.get('props');
    }

    if (!this.props?.kernelUrl && !this.env.SIYUAN_KERNEL_URL) {
      logPush('Warning: No kernel URL available');
      return;
    }

    // Set download context from props + env (for buildDownloadUrl)
    if (this.props?.secret && this.env.COOKIE_ENCRYPTION_KEY && this.props?.fetchBaseUrl) {
      setDownloadContext({
        secret: this.props.secret,
        encryptionKey: this.env.COOKIE_ENCRYPTION_KEY,
        fetchBaseUrl: this.props.fetchBaseUrl,
      });
    }

    // props.kernelUrl is always resolved by auth workers; env is fallback for legacy sessions
    const mcpConfig = {
      ...this.env,
      SIYUAN_KERNEL_URL: this.props?.kernelUrl || this.env.SIYUAN_KERNEL_URL,
      SIYUAN_KERNEL_TOKEN: this.props?.kernelToken || this.env.SIYUAN_KERNEL_TOKEN,
    };

    // Initialize MCP server with SiYuan tools
    await initializeSiyuanMCPServer(
      this.server,
      mcpConfig,
      this.props?.fetchBaseUrl,
      this.env.COOKIE_ENCRYPTION_KEY
    );

    // Log authenticated user info
    if (this.props?.email) {
      logPush(`Authenticated user: ${this.props.email}`);
    }
  }
}


