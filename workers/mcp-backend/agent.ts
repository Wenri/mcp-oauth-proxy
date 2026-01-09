/**
 * SiYuan MCP Agent for Cloudflare Workers
 *
 * This class extends McpAgent to provide SiYuan MCP functionality.
 * It receives auth context from auth workers and manages MCP sessions.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import type { MCPBackendEnv, Props, AuthContext } from '../../index';
import {
  initializeSiyuanMCPServer,
  setDownloadContext,
  logPush,
} from './server';
import pkg from '../../package.json' with { type: 'json' };

/**
 * Extended Props with auth context from auth workers
 */
export interface MCPProps extends Props {
  secret?: string;
  encryptionKey?: string;
}

/**
 * SiYuan MCP Agent
 *
 * - Receives props from auth workers via ctx.props
 * - Stores props in DO storage for session persistence
 * - Initializes MCP server with SiYuan tools
 */
export class SiyuanMCP extends McpAgent<MCPBackendEnv, Record<string, never>, MCPProps> {
  server = new McpServer({
    name: pkg.name,
    version: pkg.version,
  });

  async init() {
    // Restore props from storage if not provided (subsequent requests)
    if (!this.props) {
      this.props = await this.ctx.storage.get('props');
    }

    if (!this.env.SIYUAN_KERNEL_URL && !this.props?.workerBaseUrl) {
      logPush('Warning: Neither SIYUAN_KERNEL_URL nor workerBaseUrl available');
      return;
    }

    // Set download context from props (for buildDownloadUrl)
    if (this.props?.secret && this.props?.encryptionKey && this.props?.workerBaseUrl) {
      setDownloadContext({
        secret: this.props.secret,
        encryptionKey: this.props.encryptionKey,
        workerBaseUrl: this.props.workerBaseUrl,
      });
    }

    // Initialize MCP server with SiYuan tools
    await initializeSiyuanMCPServer(
      this.server,
      this.env,
      this.props?.workerBaseUrl,
      this.props?.encryptionKey
    );

    // Log authenticated user info
    if (this.props?.email) {
      logPush(`Authenticated user: ${this.props.email}`);
    }
  }
}

/**
 * Extract auth context from request headers
 * Headers are set by auth workers before forwarding via service binding
 */
export function extractAuthContext(request: Request): AuthContext | null {
  const propsHeader = request.headers.get('X-Auth-Props');
  if (!propsHeader) return null;

  try {
    const props = JSON.parse(atob(propsHeader)) as Props;
    return {
      props,
      secret: request.headers.get('X-Auth-Secret') || '',
      workerBaseUrl: request.headers.get('X-Auth-Worker-Base-Url') || '',
      encryptionKey: request.headers.get('X-Auth-Encryption-Key') || '',
    };
  } catch {
    return null;
  }
}

/**
 * Build MCPProps from AuthContext
 */
export function buildMCPProps(authContext: AuthContext): MCPProps {
  return {
    ...authContext.props,
    secret: authContext.secret,
    encryptionKey: authContext.encryptionKey,
    workerBaseUrl: authContext.workerBaseUrl || authContext.props.workerBaseUrl,
  };
}
