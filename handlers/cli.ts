#!/usr/bin/env node
/**
 * CLI entry point for SiYuan MCP Server
 *
 * Runs the MCP server with stdio transport for use with Claude Desktop
 * and other MCP clients.
 *
 * Usage:
 *   npx tsx handlers/cli.ts --kernel-url https://siyuan.example.com --token xxx
 *
 * Or add to Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "siyuan": {
 *         "command": "npx",
 *         "args": ["tsx", "handlers/cli.ts", "--kernel-url", "http://localhost:6806"]
 *       }
 *     }
 *   }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSiyuanMCPServer, initializeSiyuanMCPServer, type SiyuanMCPConfig } from '../siyuan-mcp';

// Parse command line arguments
function parseArgs(): SiyuanMCPConfig {
  const args = process.argv.slice(2);
  const config: SiyuanMCPConfig = {
    SIYUAN_KERNEL_URL: '',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--kernel-url':
      case '-u':
        config.SIYUAN_KERNEL_URL = args[++i] || '';
        break;
      case '--token':
      case '-t':
        config.SIYUAN_KERNEL_TOKEN = args[++i];
        break;
      case '--rag-url':
        config.RAG_BASE_URL = args[++i];
        break;
      case '--rag-key':
        config.RAG_API_KEY = args[++i];
        break;
      case '--filter-notebooks':
        config.FILTER_NOTEBOOKS = args[++i];
        break;
      case '--filter-documents':
        config.FILTER_DOCUMENTS = args[++i];
        break;
      case '--read-only':
        config.READ_ONLY_MODE = args[++i] as SiyuanMCPConfig['READ_ONLY_MODE'];
        break;
      case '--help':
      case '-h':
        console.log(`
SiYuan MCP Server - CLI

Usage:
  npx tsx handlers/cli.ts [options]

Options:
  -u, --kernel-url <url>     SiYuan kernel URL (required)
  -t, --token <token>        SiYuan API token
  --rag-url <url>            RAG backend URL
  --rag-key <key>            RAG API key
  --filter-notebooks <ids>   Notebook IDs to filter (newline-separated)
  --filter-documents <ids>   Document IDs to filter (newline-separated)
  --read-only <mode>         Read-only mode: allow_all, allow_non_destructive, deny_all
  -h, --help                 Show this help message

Environment Variables:
  SIYUAN_KERNEL_URL          SiYuan kernel URL
  SIYUAN_KERNEL_TOKEN        SiYuan API token
  RAG_BASE_URL               RAG backend URL
  RAG_API_KEY                RAG API key
`);
        process.exit(0);
    }
  }

  // Fall back to environment variables
  config.SIYUAN_KERNEL_URL = config.SIYUAN_KERNEL_URL || process.env.SIYUAN_KERNEL_URL || '';
  config.SIYUAN_KERNEL_TOKEN = config.SIYUAN_KERNEL_TOKEN || process.env.SIYUAN_KERNEL_TOKEN;
  config.RAG_BASE_URL = config.RAG_BASE_URL || process.env.RAG_BASE_URL;
  config.RAG_API_KEY = config.RAG_API_KEY || process.env.RAG_API_KEY;

  if (!config.SIYUAN_KERNEL_URL) {
    console.error('Error: --kernel-url or SIYUAN_KERNEL_URL is required');
    process.exit(1);
  }

  return config;
}

// Main
async function main() {
  const config = parseArgs();
  const server = createSiyuanMCPServer();
  await initializeSiyuanMCPServer(server, config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
