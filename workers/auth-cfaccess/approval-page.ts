import { html } from "hono/html";
import type { ClientInfo } from "@cloudflare/workers-oauth-provider";

function sanitizeUrl(url: string): string {
	const normalized = url.trim();

	if (normalized.length === 0) {
		return "";
	}

	// Check C0 and C1 control characters
	for (let i = 0; i < normalized.length; i++) {
		const code = normalized.charCodeAt(i);
		if ((code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) {
			return "";
		}
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(normalized);
	} catch {
		return "";
	}

	const allowedSchemes = ["https", "http"];
	const scheme = parsedUrl.protocol.slice(0, -1).toLowerCase();
	if (!allowedSchemes.includes(scheme)) {
		return "";
	}

	return normalized;
}

export interface ApprovalPageProps {
	request: Request;
	client: ClientInfo | null;
	server: {
		name: string;
		logo?: string;
		description?: string;
	};
	state: Record<string, unknown>;
	csrfToken: string;
}

export const ApprovalPage = (props: ApprovalPageProps) => {
	const { request, client, server, state, csrfToken } = props;

	const encodedState = btoa(JSON.stringify(state));
	const pathname = new URL(request.url).pathname;

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

	return html`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${clientName} | Authorization Request</title>
    <link rel="stylesheet" href="static/approval.css">
  </head>
  <body>
    <div class="container">
      <div class="precard">
        <div class="header">
          ${logoUrl ? html`<img src="${logoUrl}" alt="${serverName} Logo" class="logo">` : ""}
          <h1 class="title"><strong>${serverName}</strong></h1>
        </div>
        ${server.description ? html`<p class="description">${server.description}</p>` : ""}
      </div>
      <div class="card">
        <h2 class="alert"><strong>${clientName}</strong> is requesting access</h2>
        <div class="client-info">
          <div class="client-detail">
            <div class="detail-label">Name:</div>
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
            <div class="detail-value"><a href="${policyUri}" target="_blank" rel="noopener noreferrer">${policyUri}</a></div>
          </div>` : ""}
          ${tosUri ? html`
          <div class="client-detail">
            <div class="detail-label">Terms of Service:</div>
            <div class="detail-value"><a href="${tosUri}" target="_blank" rel="noopener noreferrer">${tosUri}</a></div>
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
        <p>This MCP Client is requesting to be authorized on ${serverName}. If you approve, you will be redirected to complete authentication.</p>
        <form method="post" action="${pathname}">
          <input type="hidden" name="state" value="${encodedState}">
          <input type="hidden" name="csrf_token" value="${csrfToken}">
          <div class="actions">
            <button type="button" class="button button-secondary" onclick="window.history.back()">Cancel</button>
            <button type="submit" class="button button-primary">Approve</button>
          </div>
        </form>
      </div>
    </div>
  </body>
</html>`;
};
