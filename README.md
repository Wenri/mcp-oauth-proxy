# SiYuan MCP Server

A Model Context Protocol (MCP) server for [SiYuan Note](https://b3log.org/siyuan/) with pluggable authentication. Enables AI assistants like Claude to interact with your SiYuan knowledge base through a secure, authenticated API.

## Features

- **Full SiYuan Integration**: Read, write, search, and manage documents, blocks, flashcards, and more
- **Pluggable Authentication**:
  - OAuth 2.1 + PKCE via Cloudflare Access (supports Okta, Azure AD, Google, etc.)
  - Simple API key authentication via `X-SiYuan-Key` header
- **Multi-Worker Architecture**: Separate auth and MCP backend for flexibility
- **Two Deployment Modes**:
  - **Cloudflare Workers**: Production deployment with multiple auth options
  - **CLI (stdio)**: Standalone MCP server for direct Claude Desktop integration
- **RAG Support**: Optional vector search integration for semantic document retrieval
- **Read-Only Mode**: Configurable restrictions for safe read-only access

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Workers Mode                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────┐     ┌─────────────────────────────┐   │
│  │ CF Access Auth (sy.wenri.org)│     │ API Key Auth (api-sy.wenri.org)│
│  │ - OAuth flow (/authorize)   │     │ - X-SiYuan-Key validation   │   │
│  │ - /download (grant-based)   │     │ - /download (stateless)     │   │
│  └──────────────┬──────────────┘     └──────────────┬──────────────┘   │
│                 │ Service Binding                   │ Service Binding  │
│                 └───────────────────┬───────────────┘                  │
│                                     ▼                                  │
│                     ┌───────────────────────────────┐                  │
│                     │      MCP Backend Worker       │                  │
│                     │   - SiyuanMCP Durable Object  │                  │
│                     │   - Tool execution            │                  │
│                     │   - SiYuan Kernel API calls   │                  │
│                     └───────────────────────────────┘                  │
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
| **Document Read** | List notebooks, get document tree, read document content, outline |
| **Document Write** | Create, rename, move, delete documents |
| **Block Operations** | Insert, update, delete, move blocks (with batch support) |
| **Search** | Full-text search (`siyuan_find_block`), SQL queries |
| **Vector Search** | RAG-based semantic search (requires RAG backend) |
| **Daily Notes** | Create and manage daily notes |
| **Flashcards** | Create and review flashcards |
| **Attributes** | Manage custom attributes on documents/blocks |
| **Assets** | Upload assets (batch, URL fetch, JSON auto-serialize) |
| **File System** | Read/write files, create archives |
| **Utilities** | Get time, push notifications, reindex, flush transactions |

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

Deploy multi-worker MCP server to Cloudflare Workers.

#### Project Structure

```
workers/
├── mcp-backend/           # MCP Backend (internal, no public routes)
│   ├── index.ts          # Entry point
│   ├── agent.ts          # SiyuanMCP Durable Object
│   └── wrangler.jsonc    # DO bindings
│
├── auth-cfaccess/         # CF Access OAuth (sy.wenri.org)
│   ├── index.ts          # OAuthProvider
│   └── wrangler.jsonc    # KV + service binding
│
└── auth-apikey/           # API Key Auth (api-sy.wenri.org)
    ├── index.ts          # X-SiYuan-Key validation
    └── wrangler.jsonc    # Service binding
```

#### Deploy MCP Backend (First)

```bash
cd workers/mcp-backend
wrangler secret put SIYUAN_KERNEL_TOKEN
# If SiYuan kernel is behind CF Access:
wrangler secret put CF_ACCESS_SERVICE_CLIENT_ID
wrangler secret put CF_ACCESS_SERVICE_CLIENT_SECRET
npx wrangler deploy
```

#### Deploy CF Access Auth Worker

```bash
cd workers/auth-cfaccess

# Create KV namespace (one-time)
npx wrangler kv namespace create "OAUTH_KV"
# Update KV ID in wrangler.jsonc

# Set secrets from CF Access SaaS app dashboard
wrangler secret put ACCESS_CLIENT_ID
wrangler secret put ACCESS_CLIENT_SECRET
wrangler secret put ACCESS_TOKEN_URL
wrangler secret put ACCESS_AUTHORIZATION_URL
wrangler secret put ACCESS_JWKS_URL
wrangler secret put COOKIE_ENCRYPTION_KEY  # openssl rand -hex 32

npx wrangler deploy
```

#### Deploy API Key Auth Worker

```bash
cd workers/auth-apikey
wrangler secret put SIYUAN_KERNEL_TOKEN
wrangler secret put COOKIE_ENCRYPTION_KEY
npx wrangler deploy
```

#### Connect with Claude Desktop

**Via OAuth (CF Access):**
```json
{
  "mcpServers": {
    "siyuan-oauth": {
      "command": "npx",
      "args": ["mcp-remote", "https://sy.wenri.org/sse"]
    }
  }
}
```

**Via API Key:**
```bash
claude mcp add siyuan https://api-sy.wenri.org/sse \
  -t sse -H "X-SiYuan-Key: YOUR_TOKEN"
```

## Configuration Reference

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SIYUAN_KERNEL_URL` | Yes | SiYuan kernel URL |
| `SIYUAN_KERNEL_TOKEN` | If auth enabled | SiYuan API token |
| `COOKIE_ENCRYPTION_KEY` | Workers mode | For download URL encryption |
| `RAG_BASE_URL` | Optional | RAG backend URL for vector search |
| `RAG_API_KEY` | Optional | RAG backend API key |
| `FILTER_NOTEBOOKS` | Optional | Newline-separated notebook IDs to include |
| `FILTER_DOCUMENTS` | Optional | Newline-separated document IDs to include |
| `READ_ONLY_MODE` | Optional | `allow_all`, `allow_non_destructive`, or `deny_all` |

### CF Access Auth Worker Secrets

| Secret | Description |
|--------|-------------|
| `ACCESS_CLIENT_ID` | From CF Access SaaS app dashboard |
| `ACCESS_CLIENT_SECRET` | From CF Access SaaS app dashboard |
| `ACCESS_TOKEN_URL` | Token endpoint URL |
| `ACCESS_AUTHORIZATION_URL` | Authorization endpoint URL |
| `ACCESS_JWKS_URL` | JWKS endpoint URL |

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

## API Endpoints

### OAuth Auth Worker (sy.wenri.org)
- `GET /authorize` - Initiate OAuth flow
- `GET /callback` - OAuth callback handler
- `POST /token` - Token endpoint
- `POST /register` - Dynamic client registration
- `GET /.well-known/oauth-authorization-server` - OAuth metadata
- `POST /mcp`, `GET /sse` - MCP endpoints (forwarded to backend)
- `GET /download/*` - File downloads (grant-based validation)

### API Key Auth Worker (api-sy.wenri.org)
- `POST /mcp`, `GET /sse` - MCP endpoints (X-SiYuan-Key required)
- `GET /download/*` - File downloads (stateless validation)

## Development

```bash
# Install dependencies
npm install

# Local development - start each worker separately
cd workers/mcp-backend && npx wrangler dev    # http://localhost:8787
cd workers/auth-cfaccess && npx wrangler dev  # http://localhost:8788
cd workers/auth-apikey && npx wrangler dev    # http://localhost:8789

# Run tests
npm test

# Deploy (order matters: backend first)
cd workers/mcp-backend && npx wrangler deploy
cd workers/auth-cfaccess && npx wrangler deploy
cd workers/auth-apikey && npx wrangler deploy
```

## Testing

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest
# Connect to deployed URL or localhost
```

### Manual Testing

```bash
# Test OAuth discovery
curl https://sy.wenri.org/.well-known/oauth-authorization-server

# Test API key auth
curl -X POST https://api-sy.wenri.org/mcp \
  -H "X-SiYuan-Key: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Security

- **OAuth 2.1 + PKCE**: Prevents authorization code interception
- **Cloudflare Access**: Enterprise identity provider support
- **Service Bindings**: Internal worker communication (no public routes for backend)
- **Durable Objects**: Session state with SQLite storage
- **Download URL Encryption**: Time-bound, path-bound download tokens
- **Read-Only Mode**: Optional restriction of write operations

## Troubleshooting

### Common Issues

**"SIYUAN_KERNEL_URL not configured"**
- Set `SIYUAN_KERNEL_URL` in wrangler.jsonc vars

**"Failed to get SiYuan config"**
- Verify SiYuan kernel is running and accessible
- Check `SIYUAN_KERNEL_TOKEN` if authentication is enabled

**"Unauthorized: Missing auth context"**
- MCP backend requires auth headers from auth workers
- Cannot be accessed directly; use auth worker endpoints

**"Invalid or expired state"**
- OAuth state expired (10 min timeout)
- Verify KV namespace is configured correctly

**Tool not appearing**
- Check `READ_ONLY_MODE` setting
- Verify tool annotations allow current mode

## License

MIT
