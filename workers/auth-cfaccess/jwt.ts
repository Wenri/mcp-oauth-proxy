/**
 * JWT verification utilities for Cloudflare Access ID tokens (RS256).
 * Uses Hono's jwt helper for decode/verify; JWKS fetching remains manual.
 */

import { decode, verify as honoVerify } from "hono/jwt";

export interface JwtEnv {
	ACCESS_JWKS_URL: string;
}

export interface ParsedJWT {
	data: string;
	header: { kid: string; alg: string };
	payload: Record<string, unknown>;
	signature: string;
}

export function parseJWT(token: string): ParsedJWT {
	const tokenParts = token.split(".");
	if (tokenParts.length !== 3) {
		throw new Error("token must have 3 parts");
	}
	const { header, payload } = decode(token);
	return {
		data: `${tokenParts[0]}.${tokenParts[1]}`,
		header: header as { kid: string; alg: string },
		payload: payload as Record<string, unknown>,
		signature: tokenParts[2],
	};
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
	const jwt = parseJWT(token);
	const key = await fetchAccessPublicKey(env, jwt.header.kid);

	// Use Hono's verify for RS256 signature check.
	// exp: false — we apply our own exp < now boundary (Hono uses exp <= now).
	let claims: Record<string, unknown>;
	try {
		claims = (await honoVerify(token, key, { alg: "RS256", exp: false })) as Record<string, unknown>;
	} catch {
		throw new Error("failed to verify token");
	}

	const now = Math.floor(Date.now() / 1000);
	if (typeof claims.exp === "number" && claims.exp < now) {
		throw new Error("expired token");
	}

	return claims;
}
