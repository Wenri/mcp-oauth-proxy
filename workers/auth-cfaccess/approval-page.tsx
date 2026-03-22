import type { ClientInfo } from "@cloudflare/workers-oauth-provider";
import { resolveClient, ClientDetails, PageLayout } from "./page-utils";

export function ApprovalPage({ request, client, server, state, csrfToken }: {
	request: Request;
	client: ClientInfo | null;
	server: { name: string; logo?: string; description?: string };
	state: string;
	csrfToken: string;
}) {
	const vars = resolveClient(client, server);

	return (
		<PageLayout
			vars={vars}
			title={`${vars.clientName} | Authorization Request`}
			subtitle={server.description && <p class="description">{server.description}</p>}
		>
			<h2 class="alert"><strong>{vars.clientName}</strong> is requesting access</h2>
			<ClientDetails vars={vars} />
			<p>This MCP Client is requesting to be authorized on {vars.serverName}. If you approve, you will be redirected to complete authentication.</p>
			<form method="post" action={new URL(request.url).pathname}>
				<input type="hidden" name="state" value={state} />
				<input type="hidden" name="csrf_token" value={csrfToken} />
				<div class="actions">
					<button type="button" class="button button-secondary" onclick="window.history.back()">Cancel</button>
					<button type="submit" class="button button-primary">Approve</button>
				</div>
			</form>
		</PageLayout>
	);
}
