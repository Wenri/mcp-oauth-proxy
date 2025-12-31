# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Workers-based **OAuth authentication proxy** for MCP (Model Context Protocol) servers. It uses Cloudflare Access as the identity provider and forwards all authenticated MCP requests to a downstream MCP server.

**Architecture**: Pure OAuth proxy pattern where this worker handles authentication via Cloudflare Access, then transparently proxies all MCP traffic to a downstream server with user identity context.

```
MCP Client → OAuth Proxy (this worker) → Cloudflare Access → Downstream MCP Server
                ↓ Adds authentication headers
                - Authorization: Bearer {access_token}
                - X-User-Email, X-User-Name, X-User-Sub, X-User-Groups
```

## Development Commands

```bash
# Local development (runs on http://localhost:8788)
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
```

## Project Structure

Minimal flat structure with two core files:

- **index.ts**: OAuth proxy implementation - forwards authenticated requests to downstream MCP server
- **cf-access-handler.ts**: OAuth 2.1 flow implementation with PKCE (authorization, callback, token exchange)
- **wrangler.jsonc**: Cloudflare Workers configuration (KV bindings, environment variables)

## Key Architecture: OAuth Proxy Pattern

### Request Flow

1. **OAuth Flow** (handled by this worker):
   - MCP client → `/authorize` with PKCE parameters
   - Worker redirects to Cloudflare Access
   - User authenticates via IdP (Okta, Azure AD, etc.)
   - Callback receives auth code, exchanges for CF Access tokens
   - Worker issues MCP-specific tokens mapped to CF Access tokens

2. **MCP Request Proxying** (all subsequent requests):
   - Client sends MCP request with OAuth token to `/mcp` or `/sse`
   - Worker validates token, extracts auth context
   - Worker proxies request to downstream MCP server with added headers:
     - `Authorization: Bearer {cloudflare_access_token}`
     - `X-User-Email: {user_email}`
     - `X-User-Name: {user_name}`
     - `X-User-Sub: {user_id}`
     - `X-User-Groups: {group1,group2,...}`
   - Downstream response streamed back to client transparently

### Token Storage in KV

- `state:{random}` → OAuth state + PKCE verifier (10 min TTL)
- `auth_code:{random}` → CF tokens + user claims (5 min TTL)
- `token:{random}` → MCP access token mapping (1 hour TTL)
- `refresh:{random}` → MCP refresh token data (30 days TTL)
- `client:{clientId}` → Dynamic client registration (1 year TTL)

### AuthContext Interface

The worker extracts user identity from Cloudflare Access JWT and passes it to the downstream server:

```typescript
{
  claims: {
    sub: string              // Unique user ID
    email?: string
    name?: string
    groups?: string[]        // Access policy groups
    [key: string]: unknown   // Additional JWT claims
  },
  accessToken: string        // CF Access token
  refreshToken?: string
}
```

## Environment Configuration

### Required Secrets (set via `wrangler secret put`)

- `CF_ACCESS_CLIENT_ID`: Cloudflare Access SaaS app client ID
- `CF_ACCESS_CLIENT_SECRET`: Cloudflare Access SaaS app client secret
- `COOKIE_ENCRYPTION_KEY`: Random 64-char hex string (generate: `openssl rand -hex 32`)

### Environment Variables (wrangler.jsonc)

- `CF_ACCESS_TEAM_DOMAIN`: Your team domain (e.g., "myteam.cloudflareaccess.com")
- `DOWNSTREAM_MCP_URL`: URL of the downstream MCP server to proxy to (e.g., "https://sy.wenri.me/mcp")

### KV Namespace

Must create and configure in wrangler.jsonc:
```bash
npx wrangler kv namespace create "OAUTH_KV"
```

## Downstream MCP Server Requirements

The downstream MCP server at `DOWNSTREAM_MCP_URL` should:

1. **Verify the Cloudflare Access token** (optional but recommended):
   - Fetch JWKS from `https://{team}.cloudflareaccess.com/cdn-cgi/access/certs`
   - Verify JWT signature (RS256)
   - Validate `aud`, `iss`, and `exp` claims

2. **Read user context from headers**:
   - `Authorization: Bearer {token}` - CF Access token for verification
   - `X-User-Email` - User's email address
   - `X-User-Name` - User's display name
   - `X-User-Sub` - Unique user identifier
   - `X-User-Groups` - Comma-separated list of user groups

3. **Implement MCP protocol**:
   - Must be a valid MCP server responding to MCP JSON-RPC requests
   - Can define any tools/resources based on user identity
   - Should handle both SSE and HTTP POST transports

## Security Considerations

- **PKCE S256**: Mandatory for all OAuth flows to prevent code interception
- **Token Expiry**: Access tokens 1 hour, refresh tokens 30 days, auth codes 5 minutes
- **No Signature Verification**: JWT claims decoded without verification (trust CF Access as issuer)
- **Transparent Proxying**: All MCP traffic forwarded with minimal inspection
- **Streaming Support**: Request/response bodies streamed for SSE and large payloads

## Local Development Setup

1. Copy `.dev.vars.example` to `.dev.vars`
2. Fill in CF Access credentials and team domain
3. Set `DOWNSTREAM_MCP_URL` to your local or remote MCP server
4. Run `npm run dev`
5. Access at http://localhost:8788

For OAuth callback testing with local development, you may need:
- Tunneling service (ngrok, cloudflared) to get public HTTPS URL
- Or deploy to a dev Cloudflare Worker environment

## Testing the OAuth Proxy

### Using MCP Inspector
```bash
npx @modelcontextprotocol/inspector@latest
# Navigate to http://localhost:5173
# Connect to your worker URL (local or deployed)
# Authenticate via OAuth flow
# All tool calls proxied to downstream server
```

### Using Claude Desktop
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "my-proxied-server": {
      "command": "npx",
      "args": ["mcp-remote", "https://your-worker.workers.dev/sse"]
    }
  }
}
```

## Transport Endpoints

### OAuth Endpoints (handled by worker)
- `/authorize` - OAuth authorization initiation
- `/callback` - OAuth callback handler
- `/token` - OAuth token endpoint (authorization_code and refresh_token grants)
- `/register` - Dynamic client registration
- `/.well-known/oauth-authorization-server` - OAuth metadata

### MCP Proxy Endpoints (forwarded to downstream)
- `/mcp` - JSON-RPC over HTTP POST transport
- `/sse` - Server-Sent Events transport (for streaming clients like Claude Desktop)

## Code Structure

### [index.ts](index.ts)

**`proxyToDownstream()`** - Core proxy logic:
- Validates `DOWNSTREAM_MCP_URL` is configured
- Clones incoming request
- Adds authentication headers (Authorization + X-User-* headers)
- Forwards to downstream server
- Streams response back preserving all headers and status codes

**`McpApiHandler`** - Request handler called after OAuth validation:
- Extracts auth context from `X-Auth-Context` header (set by OAuthProvider)
- Calls `proxyToDownstream()` for all MCP requests

### [cf-access-handler.ts](cf-access-handler.ts)

Implements complete OAuth 2.1 flow with PKCE - see file for detailed implementation.

## Common Issues

**"DOWNSTREAM_MCP_URL not configured"**: Set the `DOWNSTREAM_MCP_URL` environment variable in wrangler.jsonc or .dev.vars.

**"Unauthorized" on MCP requests**: OAuth flow not completed. Client must first authenticate via `/authorize` endpoint.

**"Invalid or expired state"**: KV namespace not configured or state expired (10 min timeout). Verify KV binding in wrangler.jsonc.

**"Token exchange failed"**: Client credentials mismatch. Verify CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET.

**"Failed to connect to downstream MCP server"**: Downstream server unreachable or returned error. Check `DOWNSTREAM_MCP_URL` is correct and server is running.

**Downstream server doesn't receive auth headers**: Check that downstream server is reading `Authorization` and `X-User-*` headers from the request.

## Deployment Checklist

1. Create KV namespace: `npx wrangler kv namespace create "OAUTH_KV"`
2. Update KV namespace ID in [wrangler.jsonc](wrangler.jsonc)
3. Configure Cloudflare Access SaaS application with redirect URL
4. Set secrets: `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`
5. Set environment variables: `CF_ACCESS_TEAM_DOMAIN`, `DOWNSTREAM_MCP_URL`
6. Deploy: `npm run deploy`
7. Test OAuth flow with MCP Inspector or Claude Desktop
