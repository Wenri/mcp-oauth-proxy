import type { ClientInfo } from "@cloudflare/workers-oauth-provider";
import { resolveClient, ClientDetails, PageLayout } from "./page-utils";

export function ConsentPage({ client, user, server, defaults, state, csrfToken }: {
	client: ClientInfo | null;
	user: { email: string; name: string };
	server: { name: string; logo?: string };
	defaults: { label: string; hasServerKernelUrl: boolean; hasServerKernelToken: boolean };
	state: string;
	csrfToken: string;
}) {
	const vars = resolveClient(client, server);
	const kernelUrlRequired = !defaults.hasServerKernelUrl;

	return (
		<PageLayout
			vars={vars}
			title={`Configure Connection | ${vars.serverName}`}
			subtitle={<p class="user-info">Signed in as <strong>{user.email}</strong></p>}
		>
			<h2 class="alert">Configure connection for <strong>{vars.clientName}</strong></h2>
			<ClientDetails vars={vars} nameLabel="Client:" tosLabel="Terms:" />

			<form method="post" action="/callback">
				<input type="hidden" name="state" value={state} />
				<input type="hidden" name="csrf_token" value={csrfToken} />

				<div class="section-title">Connection Settings</div>

				<div class="form-group">
					<label class="form-label" for="label">Connection Label</label>
					<input class="form-input" type="text" id="label" name="label" value={defaults.label} placeholder="Name for this connection" />
				</div>

				<div class="form-group">
					<label class="form-label" for="kernel_url">SiYuan Kernel URL</label>
					<input class="form-input" type="url" id="kernel_url" name="kernel_url"
						placeholder={defaults.hasServerKernelUrl ? "Leave empty to use server default" : "https://your-siyuan-instance.example.com"}
						required={kernelUrlRequired} />
					<div class="form-hint">{defaults.hasServerKernelUrl
						? "A server default is configured. Leave empty to use it."
						: "No server default configured. Please provide your SiYuan kernel URL."
					}</div>
				</div>

				<div class="form-group">
					<label class="form-label" for="kernel_token">SiYuan Access Key</label>
					<input class="form-input" type="password" id="kernel_token" name="kernel_token"
						placeholder={defaults.hasServerKernelToken ? "Leave empty to use server default" : "Enter your SiYuan API token"} />
					<div class="form-hint">{defaults.hasServerKernelToken
						? "A server default is configured. Leave empty to use it."
						: "Optional. Provide if your SiYuan kernel requires authentication."
					}</div>
				</div>

				<div class="actions">
					<button type="button" class="button button-secondary" onclick="window.history.back()">Cancel</button>
					<button type="submit" class="button button-primary">Connect</button>
				</div>
			</form>
		</PageLayout>
	);
}
