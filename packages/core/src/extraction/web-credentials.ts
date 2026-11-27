// Content Credentials a file keeps on the web (D74). Such a file carries only
// an address for them (Adobe Firefly video does this), so reading it in full
// means a request that names the file to whoever runs that address, from this
// machine's address. Whether to make it is the person's choice, made once per
// machine: never, only for hosts on a list, or for any host. Until it is
// made, nothing is fetched.
//
// Pure: what the choice means for one address, and how a file that was not
// fetched is recorded. The fetch itself is core-node's (web-credentials.ts).

export const WEB_CREDENTIAL_MODES = ["never", "listed", "any"] as const;
export type WebCredentialMode = (typeof WEB_CREDENTIAL_MODES)[number];

/**
 * The hosts on every machine's list: services known to keep the Content
 * Credentials of what they make on the web. Short on purpose; a person adds
 * their own.
 */
export const BUILT_IN_HOSTS: readonly string[] = ["cai-manifests.adobe.com"];

/** What this machine was told (settings.ts keeps it). */
export interface WebCredentialChoice {
	/** Null until the person has chosen: nothing is fetched. */
	mode: WebCredentialMode | null;
	/** Hosts the person added to the list. */
	hosts: readonly string[];
	/** Hosts the person said to leave: not fetched, and not asked about again. */
	left: readonly string[];
}

/**
 * Why credentials on the web were not obtained.
 * not-chosen  this machine has not been told whether to fetch
 * never       this machine never fetches
 * not-listed  the list is in force and the host is not on it (the person is asked, once)
 * left        the person said to leave this host
 * refused     no setting would fetch this address (not https, not an address)
 * failed      it was allowed, and the fetch or the reading of what came back failed
 */
export type NotFetched =
	"not-chosen" | "never" | "not-listed" | "left" | "refused" | "failed";

const NOT_FETCHED: readonly NotFetched[] = [
	"not-chosen",
	"never",
	"not-listed",
	"left",
	"refused",
	"failed",
];

/** A file's credentials on the web that this machine does not have. */
export interface OnTheWeb {
	/** The address the file gives, as it gives it. */
	address: string;
	/** The host a decision is made about (with its port when not 443); null when the address has none. */
	host: string | null;
	outcome: NotFetched;
	/** For "refused" and "failed": what went wrong, in words. */
	detail?: string;
}

const HOST =
	/^(?=.{1,253}(?::|$))[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?(?::[0-9]{1,5})?$/;

/**
 * A host as the list keeps it, from what a person typed: lower case, a name
 * with a dot in it (never a bare word or an IP address), and its port only
 * when it is not 443. A whole https address is taken for its host. Null when
 * it is not one.
 */
export function listedHost(text: string): string | null {
	let t = String(text).trim().toLowerCase();
	if (/^https:\/\//.test(t)) {
		try {
			t = new URL(t).host;
		} catch {
			return null;
		}
	}
	t = t.replace(/:443$/, "");
	return HOST.test(t) ? t : null;
}

/**
 * The host of an address a file gives, or why no setting would fetch it.
 * Only https: what comes back is checked against the file, but the request
 * names the file, and plain http would show that to everyone on the way.
 */
export function hostOfAddress(
	address: string,
): { host: string } | { refused: string } {
	let url: URL;
	try {
		url = new URL(String(address).trim());
	} catch {
		return { refused: "what the file gives is not a web address" };
	}
	if (url.protocol !== "https:")
		return {
			refused: `only https addresses are fetched, and this one is ${url.protocol.replace(/:$/, "")}`,
		};
	if (url.username || url.password)
		return {
			refused: "an address with a user name or password is not fetched",
		};
	const host = listedHost(url.host);
	return host
		? { host }
		: { refused: `${url.host} is not a host name the list can hold` };
}

/** Every host the list holds on this machine: the built-in ones and the person's. */
export const hostsOnList = (choice: WebCredentialChoice): string[] => [
	...new Set([...BUILT_IN_HOSTS, ...choice.hosts]),
];

/** Whether this machine fetches the credentials at an address, and if not, why. */
export function decideFetch(
	choice: WebCredentialChoice,
	address: string,
): { fetch: true; host: string } | { fetch: false; onTheWeb: OnTheWeb } {
	const at = hostOfAddress(address);
	if ("refused" in at)
		return {
			fetch: false,
			onTheWeb: { address, host: null, outcome: "refused", detail: at.refused },
		};
	const { host } = at;
	const no = (outcome: NotFetched) =>
		({ fetch: false, onTheWeb: { address, host, outcome } }) as const;
	if (choice.mode === null) return no("not-chosen");
	if (choice.mode === "never") return no("never");
	if (choice.mode === "any") return { fetch: true, host };
	// A host the person left stays left, even one on the built-in list.
	if (choice.left.includes(host)) return no("left");
	return hostsOnList(choice).includes(host)
		? { fetch: true, host }
		: no("not-listed");
}

/**
 * The address in what the C2PA library throws for a file whose credentials
 * are on the web, when its own fetching is off (it always is, D74): the
 * library names the address and makes no request. Null for any other error.
 */
export function remoteAddressOf(
	error: { message?: unknown; name?: unknown } | null | undefined,
): string | null {
	const message = /must fetch remote manifests from url (\S+)/i.exec(
		String(error?.message ?? ""),
	);
	if (message) return message[1];
	const name = /RemoteManifestUrl\("([^"\s]+)"\)/.exec(
		String(error?.name ?? ""),
	);
	return name ? name[1] : null;
}

/** What a reading says, in words, about credentials on the web it does not have. */
export function notFetchedWords(w: OnTheWeb): string {
	const where = `Its Content Credentials are stored on the web, at ${w.address}.`;
	switch (w.outcome) {
		case "not-chosen":
			return `${where} They were not fetched: this machine has not yet been told whether to fetch such credentials.`;
		case "never":
			return `${where} They were not fetched: this machine never fetches them.`;
		case "not-listed":
			return `${where} They were not fetched: ${w.host} is not on this machine's list of hosts.`;
		case "left":
			return `${where} They were not fetched: this machine was told to leave ${w.host}.`;
		case "refused":
			return `${where} They were not fetched: ${w.detail ?? "the address cannot be fetched"}.`;
		case "failed":
			return `${where} They could not be fetched: ${w.detail ?? "the request failed"}.`;
	}
}

function isOnTheWeb(v: unknown): v is OnTheWeb {
	if (typeof v !== "object" || v === null) return false;
	const w = v as Record<string, unknown>;
	return (
		typeof w.address === "string" &&
		(w.host === null || typeof w.host === "string") &&
		NOT_FETCHED.includes(w.outcome as NotFetched) &&
		(w.detail === undefined || typeof w.detail === "string")
	);
}

/**
 * What a stored reading says about credentials on the web it does not have;
 * null when it says nothing of the kind. A reading from before D74, made
 * with fetching switched off, kept only the library's own words: the address
 * is read out of those.
 */
export function onTheWebOfReading(reading: {
	status: string;
	data?: unknown;
	error?: string | null;
}): OnTheWeb | null {
	if (reading.status !== "unreadable") return null;
	const kept = (reading.data as { onTheWeb?: unknown } | null | undefined)
		?.onTheWeb;
	if (isOnTheWeb(kept)) return kept;
	const address = remoteAddressOf({ message: reading.error });
	if (!address) return null;
	const at = hostOfAddress(address);
	return "host" in at
		? { address, host: at.host, outcome: "never" }
		: { address, host: null, outcome: "refused", detail: at.refused };
}

/**
 * What the person can do about one host whose files were not fetched, as
 * this machine is set now (a stored reading may be older than the setting).
 * choose  no mode chosen yet: choose one
 * ask     the list is in force and the host is neither on it nor left: allow it or leave it
 * read    it would be fetched now: read the files again
 * left    the person left this host
 * never   this machine never fetches
 * cannot  no setting would fetch it
 */
export type HostState = "choose" | "ask" | "read" | "left" | "never" | "cannot";

export function hostStateNow(
	choice: WebCredentialChoice,
	address: string,
): HostState {
	const d = decideFetch(choice, address);
	if (d.fetch) return "read";
	switch (d.onTheWeb.outcome) {
		case "not-chosen":
			return "choose";
		case "not-listed":
			return "ask";
		case "left":
			return "left";
		case "never":
			return "never";
		default:
			return "cannot";
	}
}
