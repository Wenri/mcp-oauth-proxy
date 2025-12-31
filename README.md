# OAuth Proxy for MCP Servers

A Cloudflare Workers-based OAuth authentication proxy for Model Context Protocol (MCP) servers. This proxy handles authentication via Cloudflare Access and forwards all MCP requests to a downstream MCP server with user identity context.

## Overview

This proxy enables you to add enterprise-grade authentication to any MCP server using Cloudflare Access as the identity provider. When users connect via an MCP client, they:

1. Authenticate through Cloudflare Access (supporting Okta, Azure AD, Google, etc.)
2. Receive OAuth tokens managed by the proxy
3. Make MCP requests that are transparently forwarded to your downstream server
4. Have their identity passed via authentication headers to the downstream server

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  MCP Client │────▶│  OAuth Proxy     │────▶│ Cloudflare Access│────▶│ Identity Provider│
│  (Claude,   │◀────│  (This Worker)   │◀────│                  │◀────│ (Okta, Azure AD,│
│   etc.)     │     │                  │     │                  │     │  Google, etc.)  │
└─────────────┘     └────────┬─────────┘     └──────────────────┘     └─────────────────┘
                             │
                             │ Proxies with Auth Headers:
                             │ - Authorization: Bearer {token}
                             │ - X-User-Email, X-User-Name, etc.
                             ▼
                      ┌─────────────────┐
                      │ Downstream MCP  │
                      │ Server          │
                      │ (Your App)      │
                      └─────────────────┘
```

## Features

- **OAuth 2.1 Proxy**: Handles complete OAuth flow with PKCE
- **Cloudflare Access Integration**: Leverages your existing identity provider
- **Transparent Forwarding**: Passes all MCP requests to downstream server
- **Identity Headers**: Automatically adds user context (email, name, groups, token)
- **Zero MCP Logic**: Pure proxy - no MCP tools defined in worker
- **Streaming Support**: Handles both SSE and HTTP POST transports

## Prerequisites

1. A Cloudflare account with Zero Trust enabled
2. Cloudflare Access configured with an identity provider
3. A downstream MCP server to proxy to (e.g., https://sy.wenri.me/mcp)
4. Node.js 18+ installed
5. Wrangler CLI installed (`npm install -g wrangler`)

## Setup Instructions

### Step 1: Create a KV Namespace

Create a KV namespace to store OAuth state:

```bash
npx wrangler kv namespace create "OAUTH_KV"
```

Copy the `id` from the output and update `wrangler.jsonc`:

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "OAUTH_KV",
      "id": "<YOUR_KV_NAMESPACE_ID>"
    }
  ]
}
```

### Step 2: Create a Cloudflare Access Application

1. Go to [Cloudflare One Dashboard](https://one.dash.cloudflare.com)
2. Navigate to **Access** → **Applications** → **Add an application**
3. Select **SaaS** application type
4. Configure the application:
   - **Application name**: `MCP OAuth Proxy`
   - **Authentication protocol**: `OIDC`
   - **Redirect URLs**: `https://your-worker.your-subdomain.workers.dev/callback`
5. Copy the **Client ID** and **Client Secret**
6. Configure Access policies to control who can access the MCP server
7. Save the application

### Step 3: Set Environment Variables

Set the required secrets using Wrangler:

```bash
# Your Cloudflare Access OIDC application credentials
wrangler secret put CF_ACCESS_CLIENT_ID
wrangler secret put CF_ACCESS_CLIENT_SECRET

# Cookie encryption key (generate a random string)
wrangler secret put COOKIE_ENCRYPTION_KEY
# Generate with: openssl rand -hex 32
```

Update `wrangler.jsonc` with your team domain and downstream MCP server URL:

```jsonc
{
  "vars": {
    "CF_ACCESS_TEAM_DOMAIN": "your-team.cloudflareaccess.com",
    "DOWNSTREAM_MCP_URL": "https://sy.wenri.me/mcp"
  }
}
```

### Step 4: Install Dependencies and Deploy

```bash
# Install dependencies
npm install

# Deploy to Cloudflare
npm run deploy
```

### Step 5: Test the OAuth Proxy

#### Using MCP Inspector

```bash
# Install and run MCP inspector
npx @modelcontextprotocol/inspector@latest

# Open http://localhost:5173 in your browser
# Enter your proxy URL and connect
```

#### Using Claude Desktop

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "my-mcp-server": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-worker.your-subdomain.workers.dev/sse"
      ]
    }
  }
}
```

## Downstream MCP Server Integration

Your downstream MCP server will receive authenticated requests with the following headers:

- **Authorization**: `Bearer {cloudflare_access_token}` - CF Access JWT token
- **X-User-Email**: User's email address
- **X-User-Name**: User's display name
- **X-User-Sub**: Unique user identifier (subject)
- **X-User-Groups**: Comma-separated list of user groups

### Example: Reading User Context

Here's how your downstream MCP server can read the user context:

```typescript
// In your downstream MCP server
const email = request.headers.get("X-User-Email");
const name = request.headers.get("X-User-Name");
const userId = request.headers.get("X-User-Sub");
const groups = request.headers.get("X-User-Groups")?.split(",") || [];
const accessToken = request.headers.get("Authorization")?.replace("Bearer ", "");

// Use this to implement user-specific tools
server.tool("get_my_data", "Get user-specific data", {}, async () => {
  const userData = await fetchUserData(userId);
  return { content: [{ type: "text", text: JSON.stringify(userData) }] };
});
```

### Optional: Verify Cloudflare Access Token

For enhanced security, your downstream server can verify the CF Access token:

```typescript
// Fetch JWKS from Cloudflare
const jwksUrl = `https://${teamDomain}/cdn-cgi/access/certs`;
const jwks = await fetch(jwksUrl).then(r => r.json());

// Verify JWT signature using your preferred library
// Validate:
// - Signature (RS256)
// - aud claim matches your application
// - iss claim is https://{team}.cloudflareaccess.com
// - exp timestamp not expired
```

## Local Development

Create a `.dev.vars` file for local development:

```env
CF_ACCESS_CLIENT_ID=your-client-id
CF_ACCESS_CLIENT_SECRET=your-client-secret
CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
COOKIE_ENCRYPTION_KEY=your-random-string
DOWNSTREAM_MCP_URL=http://localhost:3000/mcp
```

Run the development server:

```bash
npm run dev
```

The proxy will be available at `http://localhost:8788`.

**Note**: For OAuth callback testing during local development, you may need a public HTTPS URL. Consider:
- Using a tunneling service (ngrok, cloudflared)
- Deploying to a dev Cloudflare Worker environment

## Architecture

### OAuth Flow

1. **MCP Client** initiates connection to the OAuth proxy
2. **OAuth Proxy** redirects to `/authorize` endpoint
3. **Authorize Endpoint** redirects to Cloudflare Access with PKCE challenge
4. **Cloudflare Access** authenticates user via configured IdP
5. **Callback** receives authorization code from Cloudflare Access
6. **Token Exchange** exchanges code for CF Access tokens (including id_token with user claims)
7. **MCP Token Issuance** generates MCP-specific tokens for the client
8. **Client Authenticated** - All subsequent requests include MCP token

### MCP Request Proxying

1. **Client** sends MCP request with OAuth token to `/mcp` or `/sse`
2. **OAuth Proxy** validates token and extracts user identity from stored auth context
3. **Proxy** forwards request to downstream MCP server with added headers
4. **Downstream MCP** processes request using user context
5. **Proxy** streams response back to client transparently

### Security Features

- **PKCE (S256)**: Prevents authorization code interception attacks
- **State Parameter**: Prevents CSRF attacks
- **Token Binding**: MCP tokens are bound to CF Access tokens
- **Short-lived Codes**: Authorization codes expire in 5 minutes
- **Token Expiry**: Access tokens 1 hour, refresh tokens 30 days
- **KV Storage**: Secure, edge-distributed token storage

## API Endpoints

### OAuth Endpoints (handled by proxy)
- `GET /authorize` - Initiates OAuth flow
- `GET /callback` - Handles OAuth callback
- `POST /token` - Token endpoint (authorization_code and refresh_token grants)
- `POST /register` - Dynamic client registration
- `GET /.well-known/oauth-authorization-server` - OAuth metadata

### MCP Endpoints (proxied to downstream)
- `POST /mcp` - MCP JSON-RPC over HTTP
- `GET /sse` - MCP Server-Sent Events transport

## Configuration Reference

### Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| `CF_ACCESS_CLIENT_ID` | Secret | Cloudflare Access SaaS app client ID |
| `CF_ACCESS_CLIENT_SECRET` | Secret | Cloudflare Access SaaS app client secret |
| `COOKIE_ENCRYPTION_KEY` | Secret | Random string for cookie encryption |
| `CF_ACCESS_TEAM_DOMAIN` | Public | Your CF Access team domain (e.g., "myteam.cloudflareaccess.com") |
| `DOWNSTREAM_MCP_URL` | Public | URL of downstream MCP server (e.g., "https://sy.wenri.me/mcp") |

### KV Namespace Bindings

| Binding | Purpose |
|---------|---------|
| `OAUTH_KV` | Stores OAuth state, tokens, and client registrations |

## Troubleshooting

### "DOWNSTREAM_MCP_URL not configured"
Set the `DOWNSTREAM_MCP_URL` environment variable in wrangler.jsonc or .dev.vars.

### "Unauthorized" on MCP requests
OAuth flow not completed. Ensure the client authenticates via the `/authorize` endpoint first.

### "Invalid or expired state"
- Ensure KV namespace is properly configured
- Check that state hasn't expired (10 minute timeout)
- Verify KV namespace binding in wrangler.jsonc

### "Token exchange failed"
- Verify CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are correct
- Ensure the callback URL matches what's configured in Access application

### "Failed to connect to downstream MCP server"
- Verify DOWNSTREAM_MCP_URL is correct
- Ensure downstream server is running and accessible
- Check downstream server logs for errors

### Downstream server doesn't receive user context
- Verify headers are being read correctly: `X-User-Email`, `X-User-Name`, etc.
- Check proxy logs: `npm run tail`
- Ensure downstream server handles the authentication headers

## Examples

See the `examples/` directory (if available) for sample downstream MCP server implementations that integrate with this proxy.

## License

MIT
