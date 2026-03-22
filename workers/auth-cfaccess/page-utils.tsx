import type { ClientInfo } from "@cloudflare/workers-oauth-provider";
import type { Child } from "hono/jsx";

function sanitizeUrl(url: string): string {
	const normalized = url.trim();
	if (normalized.length === 0) return "";
	for (let i = 0; i < normalized.length; i++) {
		const code = normalized.charCodeAt(i);
		if ((code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) return "";
	}
	try {
		const parsed = new URL(normalized);
		if (!["http:", "https:"].includes(parsed.protocol)) return "";
	} catch { return ""; }
	return normalized;
}

export interface ClientVars {
	serverName: string;
	clientName: string;
	logoUrl: string;
	clientUri: string;
	policyUri: string;
	tosUri: string;
	contacts: string;
	redirectUris: string[];
}

export function resolveClient(
	client: ClientInfo | null,
	server: { name: string; logo?: string },
): ClientVars {
	return {
		serverName: server.name,
		clientName: client?.clientName ?? "Unknown MCP Client",
		logoUrl: server.logo ? sanitizeUrl(server.logo) : "",
		clientUri: client?.clientUri ? sanitizeUrl(client.clientUri) : "",
		policyUri: client?.policyUri ? sanitizeUrl(client.policyUri) : "",
		tosUri: client?.tosUri ? sanitizeUrl(client.tosUri) : "",
		contacts: client?.contacts?.length ? client.contacts.join(", ") : "",
		redirectUris: client?.redirectUris?.map(sanitizeUrl).filter(Boolean) ?? [],
	};
}

function Detail({ label, children, small }: { label: string; children: Child; small?: boolean }) {
	return (
		<div class="client-detail">
			<div class="detail-label">{label}</div>
			<div class={small ? "detail-value small" : "detail-value"}>{children}</div>
		</div>
	);
}

function Link({ href }: { href: string }) {
	return <a href={href} target="_blank" rel="noopener noreferrer">{href}</a>;
}

export function ClientDetails({ vars, nameLabel = "Name:", tosLabel = "Terms of Service:" }: {
	vars: ClientVars;
	nameLabel?: string;
	tosLabel?: string;
}) {
	const { clientName, clientUri, policyUri, tosUri, redirectUris, contacts } = vars;
	return (
		<div class="client-info">
			<Detail label={nameLabel}>{clientName}</Detail>
			{clientUri && <Detail label="Website:" small><Link href={clientUri} /></Detail>}
			{policyUri && <Detail label="Privacy Policy:" small><Link href={policyUri} /></Detail>}
			{tosUri && <Detail label={tosLabel} small><Link href={tosUri} /></Detail>}
			{redirectUris.length > 0 && <Detail label="Redirect URIs:" small>{redirectUris.map((uri) => <div>{uri}</div>)}</Detail>}
			{contacts && <Detail label="Contact:">{contacts}</Detail>}
		</div>
	);
}

export function PageLayout({ vars, title, subtitle, children }: {
	vars: ClientVars;
	title: string;
	children: Child;
	subtitle?: Child;
}) {
	return (
		<html lang="en">
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>{title}</title>
				<link rel="stylesheet" href="static/approval.css" />
			</head>
			<body>
				<div class="container">
					<div class="precard">
						<div class="header">
							{vars.logoUrl && <img src={vars.logoUrl} alt={`${vars.serverName} Logo`} class="logo" />}
							<h1 class="title"><strong>{vars.serverName}</strong></h1>
						</div>
						{subtitle}
					</div>
					<div class="card">
						{children}
					</div>
				</div>
			</body>
		</html>
	);
}
