import { html } from "hono/html";
import type { ClientInfo } from "@cloudflare/workers-oauth-provider";

function sanitizeUrl(url: string): string {
	const normalized = url.trim();
	if (normalized.length === 0) return "";
	for (let i = 0; i < normalized.length; i++) {
		const code = normalized.charCodeAt(i);
		if ((code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) return "";
	}
	let parsedUrl: URL;
	try { parsedUrl = new URL(normalized); } catch { return ""; }
	const scheme = parsedUrl.protocol.slice(0, -1).toLowerCase();
	if (!["https", "http"].includes(scheme)) return "";
	return normalized;
}

export interface ConsentPageProps {
	client: ClientInfo | null;
	user: { email: string; name: string };
	server: { name: string; logo?: string; description?: string };
	defaults: {
		label: string;
		hasServerKernelUrl: boolean;
		hasServerKernelToken: boolean;
	};
	state: string;
	csrfToken: string;
}

export const ConsentPage = (props: ConsentPageProps) => {
	const { client, user, server, defaults, state, csrfToken } = props;

	const serverName = server.name;
	const clientName = client?.clientName ?? "Unknown MCP Client";
	const logoUrl = server.logo ? sanitizeUrl(server.logo) : "";
	const clientUri = client?.clientUri ? sanitizeUrl(client.clientUri) : "";
	const policyUri = client?.policyUri ? sanitizeUrl(client.policyUri) : "";
	const tosUri = client?.tosUri ? sanitizeUrl(client.tosUri) : "";
	const contacts = client?.contacts?.length ? client.contacts.join(", ") : "";
	const redirectUris = client?.redirectUris
		? client.redirectUris.map((uri) => sanitizeUrl(uri)).filter(Boolean)
		: [];

	const kernelUrlPlaceholder = defaults.hasServerKernelUrl
		? "Leave empty to use server default"
		: "https://your-siyuan-instance.example.com";
	const kernelTokenPlaceholder = defaults.hasServerKernelToken
		? "Leave empty to use server default"
		: "Enter your SiYuan API token";
	const kernelUrlRequired = !defaults.hasServerKernelUrl;

	return html`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Configure Connection | ${serverName}</title>
    <link rel="stylesheet" href="static/approval.css">
  </head>
  <body>
    <div class="container">
      <div class="precard">
        <div class="header">
          ${logoUrl ? html`<img src="${logoUrl}" alt="${serverName} Logo" class="logo">` : ""}
          <h1 class="title"><strong>${serverName}</strong></h1>
        </div>
        <p class="user-info">Signed in as <strong>${user.email}</strong></p>
      </div>
      <div class="card">
        <h2 class="alert">Configure connection for <strong>${clientName}</strong></h2>

        <div class="client-info">
          <div class="client-detail">
            <div class="detail-label">Client:</div>
            <div class="detail-value">${clientName}</div>
          </div>
          ${clientUri ? html`
          <div class="client-detail">
            <div class="detail-label">Website:</div>
            <div class="detail-value small"><a href="${clientUri}" target="_blank" rel="noopener noreferrer">${clientUri}</a></div>
          </div>` : ""}
          ${policyUri ? html`
          <div class="client-detail">
            <div class="detail-label">Privacy Policy:</div>
            <div class="detail-value small"><a href="${policyUri}" target="_blank" rel="noopener noreferrer">${policyUri}</a></div>
          </div>` : ""}
          ${tosUri ? html`
          <div class="client-detail">
            <div class="detail-label">Terms:</div>
            <div class="detail-value small"><a href="${tosUri}" target="_blank" rel="noopener noreferrer">${tosUri}</a></div>
          </div>` : ""}
          ${redirectUris.length > 0 ? html`
          <div class="client-detail">
            <div class="detail-label">Redirect URIs:</div>
            <div class="detail-value small">${redirectUris.map((uri) => html`<div>${uri}</div>`)}</div>
          </div>` : ""}
          ${contacts ? html`
          <div class="client-detail">
            <div class="detail-label">Contact:</div>
            <div class="detail-value">${contacts}</div>
          </div>` : ""}
        </div>

        <form method="post" action="/callback">
          <input type="hidden" name="state" value="${state}">
          <input type="hidden" name="csrf_token" value="${csrfToken}">

          <div class="section-title">Connection Settings</div>

          <div class="form-group">
            <label class="form-label" for="label">Connection Label</label>
            <input class="form-input" type="text" id="label" name="label" value="${defaults.label}" placeholder="Name for this connection">
          </div>

          <div class="form-group">
            <label class="form-label" for="kernel_url">SiYuan Kernel URL</label>
            <input class="form-input" type="url" id="kernel_url" name="kernel_url" placeholder="${kernelUrlPlaceholder}" ${kernelUrlRequired ? "required" : ""}>
            ${defaults.hasServerKernelUrl ? html`<div class="form-hint">A server default is configured. Leave empty to use it.</div>` : html`<div class="form-hint">No server default configured. Please provide your SiYuan kernel URL.</div>`}
          </div>

          <div class="form-group">
            <label class="form-label" for="kernel_token">SiYuan Access Key</label>
            <input class="form-input" type="password" id="kernel_token" name="kernel_token" placeholder="${kernelTokenPlaceholder}">
            ${defaults.hasServerKernelToken ? html`<div class="form-hint">A server default is configured. Leave empty to use it.</div>` : html`<div class="form-hint">Optional. Provide if your SiYuan kernel requires authentication.</div>`}
          </div>

          <div class="actions">
            <button type="button" class="button button-secondary" onclick="window.history.back()">Cancel</button>
            <button type="submit" class="button button-primary">Connect</button>
          </div>
        </form>
      </div>
    </div>
  </body>
</html>`;
};
