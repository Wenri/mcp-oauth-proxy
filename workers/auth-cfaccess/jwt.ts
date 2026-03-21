/**
 * JWT verification utilities for Cloudflare Access ID tokens (RS256).
 * Uses Hono's jwt helper for decode/verify; JWKS fetching remains manual.
 */

import { decode, verify as honoVerify } from "hono/jwt";

export interface JwtEnv {
	ACCESS_JWKS_URL: string;
}

export async function fetchAccessPublicKey(env: JwtEnv, kid: string): Promise<CryptoKey> {
	if (!env.ACCESS_JWKS_URL) {
		throw new Error("ACCESS_JWKS_URL not provided");
	}
	// TODO: cache this
	const resp = await fetch(env.ACCESS_JWKS_URL);
	if (!resp.ok) {
		throw new Error(`Failed to fetch JWKS from ${env.ACCESS_JWKS_URL}: ${resp.status}`);
	}
	const keys = (await resp.json()) as {
		keys: (JsonWebKey & { kid: string })[];
	};
	const availableKids = keys.keys?.map((k) => k.kid) || [];
	console.log(`JWKS: Looking for kid ${kid}, available: ${availableKids.join(", ")}`);
	const jwk = keys.keys.find((key) => key.kid === kid);
	if (!jwk) {
		throw new Error(`Key with kid ${kid} not found. Available keys: ${availableKids.join(", ")}`);
	}
	return crypto.subtle.importKey(
		"jwk",
		jwk,
		{ hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
		false,
		["verify"],
	);
}

export async function verifyToken(env: JwtEnv, token: string): Promise<Record<string, unknown>> {
	const { header } = decode(token) as { header: { kid: string; alg: string } };
	const key = await fetchAccessPublicKey(env, header.kid);
	return (await honoVerify(token, key, "RS256")) as Record<string, unknown>;
}
