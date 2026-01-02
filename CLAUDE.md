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
│   ├── access-handler.ts      # CF Access OAuth flow (authorize, callback)
│   ├── workers-oauth-utils.ts # OAuth utilities (PKCE, state, cookies)
│   └── cli.ts                 # CLI entry point for stdio transport
├── siyuan-mcp/
│   ├── index.ts               # Server initialization, context management
│   ├── tools/                 # MCP tool implementations
│   │   ├── index.ts           # Tool provider registry
│   │   ├── baseToolProvider.ts
│   │   ├── docRead.ts         # Document reading, outline, HTML export
│   │   ├── docWrite.ts        # Document writing, rename, move, delete
│   │   ├── blockWrite.ts      # Block insert, update, delete, move, fold
│   │   ├── sql.ts             # SQL queries, FTS5 full-text search
│   │   ├── search.ts          # Full-text search
│   │   ├── attributes.ts      # Block attributes (single & batch)
│   │   ├── dailynote.ts       # Daily note creation
│   │   ├── flashCard.ts       # Flashcard management
│   │   ├── vectorSearch.ts    # RAG vector search
│   │   ├── relation.ts        # Document relations
│   │   ├── assets.ts          # Asset upload (single & batch)
│   │   ├── filesystem.ts      # File system operations
│   │   └── utility.ts         # Time, notifications, reindex, flush
│   ├── syapi/                 # SiYuan kernel API wrappers
│   ├── utils/                 # Utility functions
│   ├── logger/                # Logging utilities
│   ├── types/                 # SiYuan-specific types
│   └── static/                # Schema docs and SQL cheatsheet
├── types/
│   └── index.ts               # Shared types (Env, SiyuanMCPConfig)
├── wrangler.jsonc             # Cloudflare Workers configuration
└── package.json
```

## Key Architecture

### handlers/index.ts - OAuthProvider Setup

Configures `@cloudflare/workers-oauth-provider` with the `SiyuanMCP` agent:

```typescript
export class SiyuanMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({ name: 'siyuan-mcp', version: '1.0.0' });

  async init() {
    await initializeSiyuanMCPServer(this.server, this.env);
    if (this.props?.email) {
      logPush(`Authenticated user: ${this.props.email}`);
    }
  }
}

export default new OAuthProvider({
  apiHandler: { fetch: handleMcpRequest },
  apiRoute: ['/sse', '/mcp'],
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  defaultHandler: { fetch: handleAccessRequest },
});
```

### handlers/access-handler.ts - CF Access OAuth Flow

Implements OAuth 2.1 with PKCE using Cloudflare Access as IdP. Based on [Cloudflare's official MCP demo](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-cf-access).

**Flow:**
1. `/authorize` - Shows approval dialog, then redirects to CF Access with PKCE challenge
2. `/callback` - Validates state, exchanges code for tokens, verifies JWT, completes authorization

**Security features:**
- PKCE (S256) for authorization code protection
- Client approval cookies (remember approved clients for 30 days)
- CSRF protection for approval form
- JWT verification using CF Access JWKS endpoint

### handlers/workers-oauth-utils.ts - OAuth Utilities

Provides OAuth helper functions:
- `generateCodeVerifier()` / `generateCodeChallenge()` - PKCE support
- `createOAuthState()` / `validateOAuthState()` - State management with KV
- `isClientApproved()` / `addApprovedClient()` - Client approval cookies
- `renderApprovalDialog()` - OAuth approval UI
- `fetchUpstreamAuthToken()` - Token exchange with CF Access

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
- **Document Operations**: read, write, create, move, rename, delete, outline, HTML export
- **Block Operations**: insert, update, delete, move, fold/unfold blocks
- **Search**: FTS5 full-text search (BM25 ranking, snippets), SQL queries, vector search (RAG)
- **SQL**: query with advanced features (REGEXP, window functions, JSON), database schema, SQL cheatsheet
- **Organization**: daily notes, flashcards, attributes (single & batch), relations
- **Assets**: upload assets (single & batch), file system operations
- **Utilities**: get time, push notifications, reindex documents, flush database transactions

## Environment Configuration

### Required Secrets (set via `wrangler secret put`)

From your CF Access SaaS app dashboard, copy the OIDC endpoints:

```bash
# OAuth configuration (from CF Access SaaS app dashboard)
wrangler secret put ACCESS_CLIENT_ID          # Client ID from dashboard
wrangler secret put ACCESS_CLIENT_SECRET      # Client secret from dashboard
wrangler secret put ACCESS_TOKEN_URL          # Token endpoint URL
wrangler secret put ACCESS_AUTHORIZATION_URL  # Authorization endpoint URL
wrangler secret put ACCESS_JWKS_URL           # Key endpoint (JWKS) URL
wrangler secret put COOKIE_ENCRYPTION_KEY     # openssl rand -hex 32

# SiYuan kernel authentication
wrangler secret put SIYUAN_KERNEL_TOKEN       # SiYuan API token (if auth enabled)

# CF Access Service Token (if SiYuan kernel is behind CF Access)
wrangler secret put CF_ACCESS_SERVICE_CLIENT_ID      # Service token Client ID
wrangler secret put CF_ACCESS_SERVICE_CLIENT_SECRET  # Service token Client Secret
```

### CF Access Service Token

If your SiYuan kernel is protected by Cloudflare Access, create a [Service Token](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/) to allow the MCP worker to authenticate:

1. Go to CF Zero Trust Dashboard → Access → Service Auth → Service Tokens
2. Create a new service token
3. Copy the Client ID and Client Secret
4. Set as secrets (see above)
5. Add a Service Auth policy to your SiYuan Access application

### Environment Variables (wrangler.jsonc)

| Variable | Description |
|----------|-------------|
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

### OAuth Endpoints
- `GET /authorize` - Shows approval dialog, redirects to CF Access
- `POST /authorize` - Handles approval form submission
- `GET /callback` - CF Access callback, token exchange, JWT verification
- `POST /token` - Token endpoint (handled by OAuthProvider)
- `POST /register` - Dynamic client registration (handled by OAuthProvider)
- `GET /.well-known/oauth-authorization-server` - OAuth metadata

### MCP Endpoints (handled by SiyuanMCP agent)
- `POST /mcp` - JSON-RPC over HTTP
- `GET /sse` - Server-Sent Events transport

## Token Storage (KV) and Cookies

**KV Storage:**
- `oauth:state:{uuid}` - OAuth state + PKCE verifier (10 min TTL)
- Token grants and client registrations managed by OAuthProvider

**Cookies:**
- `__Host-csrf` - CSRF protection for approval form
- `__Host-approved-clients` - Encrypted list of approved client IDs (30 days)
- Uses `__Host-` prefix for enhanced security (requires HTTPS, no domain/path override)

## Security Considerations

- **PKCE S256**: Required for all OAuth flows to CF Access
- **JWT Verification**: ID tokens verified using CF Access JWKS endpoint
- **CSRF Protection**: Approval form protected against cross-site request forgery
- **Client Approval**: Users approve MCP clients before authentication
- **Cloudflare Access**: Enterprise IdP integration (Okta, Azure AD, Google, etc.)
- **Service Token Auth**: Worker-to-kernel requests authenticated via CF Access Service Tokens
- **Linked App Token**: User's CF Access token forwarded to kernel via `cf-access-token` header
- **Read-Only Mode**: Configurable tool restrictions for safety

## Common Issues

**"SIYUAN_KERNEL_URL not configured"**: Set in wrangler.jsonc vars or as secret.

**"Failed to get SiYuan config"**: Verify kernel URL is accessible and token is correct. If kernel is behind CF Access, configure Service Token secrets.

**"Unexpected token '<', "<!DOCTYPE"..."**: The kernel is returning HTML (likely CF Access login page). Set `CF_ACCESS_SERVICE_CLIENT_ID` and `CF_ACCESS_SERVICE_CLIENT_SECRET` secrets.

**"Invalid or expired state"**: OAuth state expired (10 min timeout) or KV not configured.

**"Token exchange failed"**: Verify ACCESS_CLIENT_ID and ACCESS_CLIENT_SECRET match CF dashboard.

**"Key with kid not found"**: ACCESS_JWKS_URL is pointing to wrong endpoint. Use the app-specific Key endpoint from CF Access dashboard (includes app ID in URL).

**Tool not found**: Check READ_ONLY_MODE setting - some tools may be filtered.

## Deployment Checklist

1. Create KV namespace: `npx wrangler kv namespace create "OAUTH_KV"`
2. Update KV namespace ID in wrangler.jsonc
3. Create Cloudflare Access SaaS OIDC application:
   - Set redirect URL to `https://your-domain/callback`
   - Enable PKCE
   - Note all OIDC endpoints from dashboard
4. Set secrets from CF Access dashboard:
   - `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET`
   - `ACCESS_TOKEN_URL`, `ACCESS_AUTHORIZATION_URL`, `ACCESS_JWKS_URL`
   - `COOKIE_ENCRYPTION_KEY` (generate with `openssl rand -hex 32`)
5. Set `SIYUAN_KERNEL_URL` and optionally `SIYUAN_KERNEL_TOKEN`
6. If SiYuan kernel is behind CF Access:
   - Create a Service Token in CF Zero Trust dashboard
   - Set `CF_ACCESS_SERVICE_CLIENT_ID` and `CF_ACCESS_SERVICE_CLIENT_SECRET`
   - Add Service Auth policy to your SiYuan Access application
7. Deploy: `npm run deploy`
8. Test OAuth flow with MCP Inspector

## Adding New Tools

1. Create new file in `siyuan-mcp/tools/` extending `McpToolsProvider`
2. Implement `getTools()` returning tool definitions
3. Add provider to `getAllToolProviders()` in `siyuan-mcp/tools/index.ts`
4. Tools are automatically registered on server initialization
