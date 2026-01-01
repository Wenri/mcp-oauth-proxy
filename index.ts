/**
 * MCP OAuth Proxy for Cloudflare Workers
 *
 * Entry point - exports OAuthProvider from handlers.
 */

export { default, type Env, SiyuanMCP } from './handlers';
