# SiYuan MCP Server

A Model Context Protocol (MCP) server for [SiYuan Note](https://b3log.org/siyuan/) with OAuth authentication via Cloudflare Access. Enables AI assistants like Claude to interact with your SiYuan knowledge base through a secure, authenticated API.

## Features

- **Full SiYuan Integration**: Read, write, search, and manage documents, blocks, flashcards, and more
- **OAuth 2.1 + PKCE**: Secure authentication via Cloudflare Access (supports Okta, Azure AD, Google, etc.)
- **Two Deployment Modes**:
  - **Cloudflare Workers**: OAuth-protected MCP server accessible via HTTP/SSE
  - **CLI (stdio)**: Standalone MCP server for direct Claude Desktop integration
- **RAG Support**: Optional vector search integration for semantic document retrieval
- **Read-Only Mode**: Configurable restrictions for safe read-only access

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Workers Mode                          │
├─────────────────────────────────────────────────────────────────────────┤
│  MCP Client → OAuth → Cloudflare Access → SiYuan MCP → SiYuan Kernel   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                            CLI Mode (stdio)                             │
├─────────────────────────────────────────────────────────────────────────┤
│  Claude Desktop ←──stdio──→ handlers/cli.ts ←──HTTP──→ SiYuan Kernel   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Available MCP Tools

| Tool Category | Tools |
|---------------|-------|
| **Document Read** | List notebooks, get document tree, read document content |
| **Document Write** | Create, rename, move, delete documents |
| **Block Operations** | Insert, update, delete blocks |
| **Search** | Full-text search, SQL queries |
| **Vector Search** | RAG-based semantic search (requires RAG backend) |
| **Daily Notes** | Create and manage daily notes |
| **Flashcards** | Create and review flashcards |
| **Attributes** | Manage custom attributes on documents/blocks |
| **Relations** | Document linking and backreferences |
| **Time Queries** | Query documents by creation/modification time |

## Quick Start

### Option 1: CLI Mode (Local Development)

Use stdio transport for direct Claude Desktop integration:

```bash
# Clone and install
git clone <repo-url>
cd mcp_saas
npm install

# Run with SiYuan kernel URL
npx tsx handlers/cli.ts --kernel-url http://localhost:6806

# Or with authentication token
npx tsx handlers/cli.ts --kernel-url http://localhost:6806 --token YOUR_TOKEN
```

Add to Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "npx",
      "args": ["tsx", "/path/to/handlers/cli.ts", "--kernel-url", "http://localhost:6806"]
    }
  }
}
```

### Option 2: Cloudflare Workers (Production)

Deploy OAuth-protected MCP server to Cloudflare Workers:

#### Prerequisites

1. Cloudflare account with Zero Trust enabled
2. Cloudflare Access application configured with your IdP
3. SiYuan kernel accessible from Cloudflare (or use Cloudflare Tunnel)
4. Node.js 18+ and Wrangler CLI

#### Setup

1. **Create KV namespace**:
   ```bash
   npx wrangler kv namespace create "OAUTH_KV"
   ```
   Update the namespace ID in `wrangler.jsonc`.

2. **Create Cloudflare Access SaaS Application**:
   - Go to [Cloudflare One Dashboard](https://one.dash.cloudflare.com) → Access → Applications
   - Create SaaS application with OIDC
   - Set redirect URL: `https://your-worker.workers.dev/callback`
   - Copy Client ID and Client Secret

3. **Set secrets**:
   ```bash
   wrangler secret put CF_ACCESS_CLIENT_ID
   wrangler secret put CF_ACCESS_CLIENT_SECRET
   wrangler secret put COOKIE_ENCRYPTION_KEY  # openssl rand -hex 32
   wrangler secret put SIYUAN_KERNEL_TOKEN    # if SiYuan auth is enabled
   ```

4. **Configure environment** in `wrangler.jsonc`:
   ```jsonc
   {
     "vars": {
       "CF_ACCESS_TEAM_DOMAIN": "your-team.cloudflareaccess.com",
       "SIYUAN_KERNEL_URL": "https://siyuan.example.com"
     }
   }
   ```

5. **Deploy**:
   ```bash
   npm run deploy
   ```

#### Connect with Claude Desktop

Use `mcp-remote` for OAuth-authenticated connections:

```json
{
  "mcpServers": {
    "siyuan-cloud": {
      "command": "npx",
      "args": ["mcp-remote", "https://your-worker.workers.dev/sse"]
    }
  }
}
```

## Configuration Reference

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SIYUAN_KERNEL_URL` | Yes | SiYuan kernel URL |
| `SIYUAN_KERNEL_TOKEN` | If auth enabled | SiYuan API token |
| `CF_ACCESS_TEAM_DOMAIN` | Workers mode | Cloudflare Access team domain |
| `CF_ACCESS_CLIENT_ID` | Workers mode | Cloudflare Access client ID |
| `CF_ACCESS_CLIENT_SECRET` | Workers mode | Cloudflare Access client secret |
| `COOKIE_ENCRYPTION_KEY` | Workers mode | Cookie encryption key |
| `RAG_BASE_URL` | Optional | RAG backend URL for vector search |
| `RAG_API_KEY` | Optional | RAG backend API key |
| `FILTER_NOTEBOOKS` | Optional | Newline-separated notebook IDs to include |
| `FILTER_DOCUMENTS` | Optional | Newline-separated document IDs to include |
| `READ_ONLY_MODE` | Optional | `allow_all`, `allow_non_destructive`, or `deny_all` |

### CLI Options

```
Options:
  -u, --kernel-url <url>     SiYuan kernel URL (required)
  -t, --token <token>        SiYuan API token
  --rag-url <url>            RAG backend URL
  --rag-key <key>            RAG API key
  --filter-notebooks <ids>   Notebook IDs to filter (newline-separated)
  --filter-documents <ids>   Document IDs to filter (newline-separated)
  --read-only <mode>         Read-only mode: allow_all, allow_non_destructive, deny_all
  -h, --help                 Show help message
```

## API Endpoints (Workers Mode)

### OAuth Endpoints
- `GET /authorize` - Initiate OAuth flow
- `GET /callback` - OAuth callback handler
- `POST /token` - Token endpoint
- `POST /register` - Dynamic client registration
- `POST /revoke` - Token revocation
- `GET /.well-known/oauth-authorization-server` - OAuth metadata

### MCP Endpoints
- `POST /mcp` - JSON-RPC over HTTP transport
- `GET /sse` - Server-Sent Events transport

## Development

```bash
# Install dependencies
npm install

# Local development (Workers mode)
npm run dev

# Run tests
npm test

# Type check
npm run types

# Deploy
npm run deploy

# View logs
npm run tail
```

## Testing

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest
# Connect to http://localhost:8788 (local) or deployed URL
```

### Manual Testing

```bash
# Test OAuth discovery
curl https://your-worker.workers.dev/.well-known/oauth-authorization-server

# Test server info
curl https://your-worker.workers.dev/
```

## Security

- **OAuth 2.1 + PKCE**: Prevents authorization code interception
- **Cloudflare Access**: Enterprise identity provider support
- **Token Binding**: MCP tokens bound to Cloudflare Access tokens
- **Read-Only Mode**: Optional restriction of write operations
- **KV Storage**: Secure, edge-distributed token storage

## Troubleshooting

### Common Issues

**"SIYUAN_KERNEL_URL not configured"**
- Set `SIYUAN_KERNEL_URL` in wrangler.jsonc or pass via CLI

**"Failed to get SiYuan config"**
- Verify SiYuan kernel is running and accessible
- Check `SIYUAN_KERNEL_TOKEN` if authentication is enabled

**"Invalid or expired state"**
- OAuth state expired (10 min timeout)
- Verify KV namespace is configured correctly

**"Token exchange failed"**
- Verify Cloudflare Access credentials
- Check callback URL matches Access application config

**Tool not appearing**
- Check `READ_ONLY_MODE` setting
- Verify tool annotations allow current mode

## License

MIT
