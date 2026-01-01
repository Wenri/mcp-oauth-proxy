# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **SiYuan Note MCP Server** with OAuth authentication via Cloudflare Access. It provides Model Context Protocol (MCP) tools for interacting with SiYuan Note, a privacy-first personal knowledge management system.

**Two deployment modes:**
1. **Cloudflare Workers** - OAuth-protected MCP server accessible via HTTP/SSE
2. **CLI (stdio)** - Standalone MCP server for local use with Claude Desktop

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Workers Mode                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  MCP Client → OAuth Flow → Cloudflare Access → SiYuan MCP Server       │
│     │              │                                  │                 │
│     │         /authorize                              │                 │
│     │         /callback                        ┌──────┴──────┐         │
│     │         /token                           │  SiYuan API  │         │
│     │                                          └──────────────┘         │
│     └─────────────────────────────────────────────────────────────────→ │
│              /sse or /mcp (authenticated MCP requests)                  │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                            CLI Mode (stdio)                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Claude Desktop ←──stdio──→ handlers/cli.ts ←──HTTP──→ SiYuan Kernel   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Development Commands

```bash
# Local development (Cloudflare Workers mode, http://localhost:8788)
npm run dev

# Deploy to Cloudflare Workers
npm run deploy

# Stream live logs from deployed worker
npm run tail

# Generate TypeScript types for Worker bindings
npm run types

# Run tests
npm test

# Watch mode for tests
npm test:watch

# Run CLI mode for testing
npx tsx handlers/cli.ts --kernel-url http://localhost:6806
```

## Project Structure

```
├── index.ts                    # Entry point - re-exports from handlers
├── handlers/
│   ├── index.ts               # OAuthProvider setup with SiyuanMCP agent
│   ├── oauth.ts               # OAuth 2.1 + PKCE with Cloudflare Access
│   └── cli.ts                 # CLI entry point for stdio transport
├── siyuan-mcp/
│   ├── index.ts               # Server initialization, context management
│   ├── tools/                 # MCP tool implementations
│   │   ├── index.ts           # Tool provider registry
│   │   ├── baseToolProvider.ts
│   │   ├── docRead.ts         # Document reading
│   │   ├── docWrite.ts        # Document writing
│   │   ├── blockWrite.ts      # Block-level editing
│   │   ├── sql.ts             # SQL queries
│   │   ├── search.ts          # Full-text search
│   │   ├── attributes.ts      # Custom attributes
│   │   ├── dailynote.ts       # Daily note creation
│   │   ├── flashCard.ts       # Flashcard management
│   │   ├── vectorSearch.ts    # RAG vector search
│   │   ├── relation.ts        # Document relations
│   │   └── time.ts            # Time-based queries
│   ├── syapi/                 # SiYuan kernel API wrappers
│   ├── utils/                 # Utility functions
│   ├── logger/                # Logging utilities
│   ├── types/                 # SiYuan-specific types
│   └── static/                # Prompts and documentation
├── types/
│   └── index.ts               # Shared types (Env, SiyuanMCPConfig)
├── wrangler.jsonc             # Cloudflare Workers configuration
└── package.json
```

## Key Architecture

### handlers/index.ts - OAuthProvider Setup with Hono

Configures `@cloudflare/workers-oauth-provider` with the `SiyuanMCP` agent and Hono as default handler:

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';

export class SiyuanMCP extends McpAgent<Env> {
  server = new McpServer({ name: 'siyuan-mcp', version: '1.0.0' });

  async init() {
    await initializeSiyuanMCPServer(this.server, this.env);
  }
}

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors({ origin: '*', ... }));
app.route('/', oauth);  // Mount OAuth routes

export default new OAuthProvider({
  apiHandlers: {
    '/sse': SiyuanMCP.serveSSE('/sse'),
    '/mcp': SiyuanMCP.mount('/mcp'),
  },
  defaultHandler: app,  // Hono handles non-MCP routes
});
```

### handlers/oauth.ts - OAuth Flow with Hono

Implements OAuth 2.1 with PKCE using Cloudflare Access as IdP. Uses Hono for routing and cookie management.

**Defense-in-depth OAuth state validation:**
- KV storage proves the server issued the state token
- `__Host-oauth_state` cookie proves the same browser initiated the flow

```typescript
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

const oauth = new Hono<{ Bindings: EnvWithOAuth }>();

oauth.get('/authorize', async (c) => {
  // Store state in KV + set session cookie
  await env.OAUTH_KV.put(`cf_state:${state}`, ...);
  setCookie(c, '__Host-oauth_state', state, { secure: true, httpOnly: true });
  return c.redirect(cfAuthUrl);
});

oauth.get('/callback', async (c) => {
  // Validate both cookie AND KV state
  if (getCookie(c, '__Host-oauth_state') !== state) return error;
  // Exchange tokens and complete authorization
});
```

Endpoints:
- `/authorize` - Initiates OAuth flow, redirects to CF Access
- `/callback` - Handles CF Access callback, validates state, exchanges tokens
- `/token` - Token endpoint (handled by OAuthProvider)
- `/register` - Dynamic client registration (handled by OAuthProvider)
- `/.well-known/oauth-authorization-server` - OAuth metadata

### siyuan-mcp/index.ts - MCP Server Core

Provides two factory functions:
- `createSiyuanMCPServer()` - Creates new McpServer instance
- `initializeSiyuanMCPServer(server, config)` - Initializes with tools and prompts

Context management:
- `initializeContext()` - Fetches SiYuan config from kernel
- `kernelFetch()` - Authenticated fetch to SiYuan kernel
- `getConfig()` - Returns current SiYuan configuration

### Tool Providers

Each tool provider implements `McpToolsProvider` interface:
- `getTools()` - Returns array of tool definitions
- Tools include `name`, `description`, `schema`, `handler`, `annotations`

Available tool categories:
- **Document Operations**: read, write, create, move, rename, delete
- **Block Operations**: insert, update, delete blocks
- **Search**: full-text search, SQL queries, vector search (RAG)
- **Organization**: daily notes, flashcards, attributes, relations
- **Utilities**: time queries, notebook listing

## Environment Configuration

### Required Secrets (set via `wrangler secret put`)

```bash
wrangler secret put CF_ACCESS_CLIENT_ID      # Cloudflare Access OIDC client ID
wrangler secret put CF_ACCESS_CLIENT_SECRET  # Cloudflare Access OIDC client secret
wrangler secret put COOKIE_ENCRYPTION_KEY    # openssl rand -hex 32
wrangler secret put SIYUAN_KERNEL_TOKEN      # SiYuan API token (if auth enabled)
```

### Environment Variables (wrangler.jsonc)

| Variable | Description |
|----------|-------------|
| `CF_ACCESS_TEAM_DOMAIN` | Your CF Access team domain (e.g., "myteam.cloudflareaccess.com") |
| `SIYUAN_KERNEL_URL` | SiYuan kernel URL (e.g., "https://siyuan.example.com") |
| `RAG_BASE_URL` | Optional RAG backend URL for vector search |
| `RAG_API_KEY` | Optional RAG backend API key |
| `FILTER_NOTEBOOKS` | Newline-separated notebook IDs to filter |
| `FILTER_DOCUMENTS` | Newline-separated document IDs to filter |
| `READ_ONLY_MODE` | `allow_all`, `allow_non_destructive`, or `deny_all` |

### KV Namespace

```bash
npx wrangler kv namespace create "OAUTH_KV"
```

Used for OAuth state, tokens, and client registrations.

## CLI Mode Usage

For local development or direct Claude Desktop integration:

```bash
# Run with required options
npx tsx handlers/cli.ts --kernel-url http://localhost:6806 --token YOUR_TOKEN

# Or use environment variables
export SIYUAN_KERNEL_URL=http://localhost:6806
export SIYUAN_KERNEL_TOKEN=YOUR_TOKEN
npx tsx handlers/cli.ts
```

### Claude Desktop Configuration

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

## Testing

### Using MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest
# Navigate to http://localhost:5173
# Connect to http://localhost:8788 or deployed URL
```

### Using Claude Desktop (via mcp-remote)

```json
{
  "mcpServers": {
    "siyuan-cloud": {
      "command": "npx",
      "args": ["mcp-remote", "https://sy.wenri.me/sse"]
    }
  }
}
```

## Transport Endpoints

### OAuth Endpoints (handled by oauth.ts)
- `GET /authorize` - OAuth authorization initiation
- `GET /callback` - OAuth callback handler
- `POST /token` - Token endpoint
- `POST /register` - Dynamic client registration
- `POST /revoke` - Token revocation
- `GET /.well-known/oauth-authorization-server` - OAuth metadata
- `GET /.well-known/oauth-protected-resource/*` - Protected resource metadata

### MCP Endpoints (handled by SiyuanMCP agent)
- `POST /mcp` - JSON-RPC over HTTP
- `GET /sse` - Server-Sent Events transport

## Token Storage (KV) and Session Cookies

**KV Storage:**
- `cf_state:{random}` - OAuth state + PKCE verifier (10 min TTL)
- Token grants and client registrations managed by OAuthProvider

**Session Cookie (defense-in-depth):**
- `__Host-oauth_state` - Binds OAuth flow to browser session (10 min TTL)
- Uses `__Host-` prefix for enhanced security (requires HTTPS, no domain/path override)

## Security Considerations

- **PKCE S256**: Required for all OAuth flows
- **Defense-in-Depth**: OAuth state validated via both KV storage AND session cookie
- **Cloudflare Access**: Enterprise IdP integration (Okta, Azure AD, Google, etc.)
- **Token Binding**: MCP tokens mapped to CF Access tokens
- **Read-Only Mode**: Configurable tool restrictions for safety
- **No JWT Verification**: Trusts CF Access as token issuer

## Common Issues

**"SIYUAN_KERNEL_URL not configured"**: Set in wrangler.jsonc vars or as secret.

**"Failed to get SiYuan config"**: Verify kernel URL is accessible and token is correct.

**"Invalid or expired state"**: OAuth state expired (10 min timeout) or KV not configured.

**"Token exchange failed"**: Verify CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET.

**Tool not found**: Check READ_ONLY_MODE setting - some tools may be filtered.

## Deployment Checklist

1. Create KV namespace: `npx wrangler kv namespace create "OAUTH_KV"`
2. Update KV namespace ID in wrangler.jsonc
3. Create Cloudflare Access SaaS application with redirect URL `/callback`
4. Set secrets: `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`
5. Set `SIYUAN_KERNEL_URL` and optionally `SIYUAN_KERNEL_TOKEN`
6. Deploy: `npm run deploy`
7. Test OAuth flow with MCP Inspector

## Adding New Tools

1. Create new file in `siyuan-mcp/tools/` extending `McpToolsProvider`
2. Implement `getTools()` returning tool definitions
3. Add provider to `getAllToolProviders()` in `siyuan-mcp/tools/index.ts`
4. Tools are automatically registered on server initialization
