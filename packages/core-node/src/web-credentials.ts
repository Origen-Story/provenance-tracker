// Fetching Content Credentials a file keeps on the web (D74). The C2PA
// library never fetches them itself: it names the address and stops, and the
// tracker makes the request here, only when this machine's setting allows
// that host, through the guarded fetch (public-url.ts). So an address inside
// a file can reach nothing on this machine or the local network, a redirect
// is held to the same list, and what comes back has a size and a time limit.
// The bytes go back to the library, which checks them against the file.
//
// What a request tells the other end: the address names the manifest, which
// identifies the file, and it arrives from this machine's address
// (docs/network.md).

import { lookup as dnsLookup } from "node:dns/promises";
import {
	decideFetch,
	type OnTheWeb,
} from "@provenancetracker/core/extraction/web-credentials.ts";
import type { Machine } from "./machine.ts";
import { fetchPublic, type FetchAt } from "./public-url.ts";
import { readSettings, webCredentialChoiceOf } from "./settings.ts";
import { TOOL } from "./tool.ts";

/** What a file's address gave: the credentials, or why this machine does not have them. */
export type WebFetched = { bytes: Buffer } | { onTheWeb: OnTheWeb };

/** Asked with the address a file gives; never throws. */
export type WebFetch = (address: string) => Promise<WebFetched>;

export interface WebCredentialLimits {
	/** The whole request, redirects and body included, must be done within this. */
	wholeMs: number;
	/** Credentials larger than this are refused. */
	maxBytes: number;
}

/**
 * Credentials are small: a claim, its assertions, perhaps thumbnails. A
 * minute and 64 MiB are far more than one needs, and stop a server that
 * never finishes or never stops sending.
 */
export const WEB_CREDENTIAL_LIMITS: Readonly<WebCredentialLimits> = {
	wholeMs: 60_000,
	maxBytes: 64 * 1024 ** 2,
};

type Lookup = (hostname: string) => Promise<Array<{ address: string }>>;

export interface WebFetchDeps {
	/** Tests give their own, so no test reaches the network. */
	lookup?: Lookup;
	fetchImpl?: FetchAt;
	limits?: WebCredentialLimits;
}

/** A fetch that holds everything back: for a reader that must never use the network. */
export const neverFetch: WebFetch = async (address) => {
	const d = decideFetch({ mode: "never", hosts: [], left: [] }, address);
	// With mode "never" the decision is always not to fetch.
	return { onTheWeb: (d as { onTheWeb: OnTheWeb }).onTheWeb };
};

async function bodyWithin(res: Response, maxBytes: number): Promise<Buffer> {
	const declared = Number(res.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > maxBytes)
		throw new Error(
			`the server offers ${declared} bytes, more than the ${maxBytes} this machine takes`,
		);
	if (!res.body) return Buffer.alloc(0);
	const chunks: Uint8Array[] = [];
	let size = 0;
	const reader = res.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maxBytes) {
			await reader.cancel().catch(() => {});
			throw new Error(
				`the server sent more than the ${maxBytes} bytes this machine takes`,
			);
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}

/**
 * This machine's fetch for credentials on the web. The setting is read each
 * time it is asked, so a choice made while a job runs holds for the next file.
 */
export function webCredentialsFor(
	machine: Machine,
	deps: WebFetchDeps = {},
): WebFetch {
	const lookup =
		deps.lookup ?? ((host: string) => dnsLookup(host, { all: true }));
	const limits = deps.limits ?? WEB_CREDENTIAL_LIMITS;
	return async (address) => {
		const choice = webCredentialChoiceOf(readSettings(machine.settingsPath));
		const decision = decideFetch(choice, address);
		if (!decision.fetch) return { onTheWeb: decision.onTheWeb };
		const failed = (detail: string): WebFetched => ({
			onTheWeb: { address, host: decision.host, outcome: "failed", detail },
		});
		try {
			const res = await fetchPublic(
				address,
				{
					headers: {
						"User-Agent": `${TOOL.name}/${TOOL.version}`,
						Accept:
							"application/c2pa, application/octet-stream;q=0.9, */*;q=0.1",
					},
					signal: AbortSignal.timeout(limits.wholeMs),
				},
				{
					lookup,
					fetchImpl: deps.fetchImpl,
					// A redirect is held to the same choice: a listed host may not
					// hand the request on to one that is not.
					eachHop: (url) => {
						const hop = decideFetch(choice, url.href);
						if (hop.fetch) return;
						const w = hop.onTheWeb;
						throw new Error(
							w.outcome === "refused"
								? `it leads to ${url.href}, and ${w.detail}`
								: `it leads to ${w.host}, which this machine's setting does not fetch from`,
						);
					},
				},
			);
			if (res.status !== 200) {
				await res.body?.cancel().catch(() => {});
				return failed(`the server answered with status ${res.status}`);
			}
			const bytes = await bodyWithin(res, limits.maxBytes);
			if (bytes.length === 0) return failed("the server sent nothing");
			return { bytes };
		} catch (err) {
			const e = err as Error;
			return failed(
				e.name === "TimeoutError" || e.name === "AbortError"
					? `it was not done within ${limits.wholeMs / 1000} seconds`
					: e.message.replace(/\.$/, ""),
			);
		}
	};
}
