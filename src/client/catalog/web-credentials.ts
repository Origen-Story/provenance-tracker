// What the pages say about Content Credentials a file keeps on the web
// (D74): the three modes in words, and what a project is waiting on, sorted
// into what the person is asked and what they are only told. Pure, so it is
// tested without a page.

import type { WaitingHost, WebCredentialMode, WebCredentials } from "./api.ts";

export const MODES: Array<{
	mode: WebCredentialMode;
	label: string;
	hint: string;
	recommended?: boolean;
}> = [
	{
		mode: "listed",
		label: "Only from hosts on the list",
		hint: "Fetch from the hosts on this machine's list, and ask once about any other host a file names.",
		recommended: true,
	},
	{
		mode: "any",
		label: "From any host",
		hint: "Fetch from whatever address a file names. Whoever made the file chose that address.",
	},
	{
		mode: "never",
		label: "Never",
		hint: "Fetch nothing. Such a file is recorded as having credentials this machine has not read.",
	},
];

/** What a fetch tells the other end: said wherever the person is asked. */
export const WHAT_A_FETCH_REVEALS =
	"Fetching them sends one request to the address the file gives. That address names the credentials, which identifies the file, and the request comes from this machine's internet address. Nothing else is sent: not the file, and nothing about you or the project.";

/** Where a host's files are named by, on a page. */
export const hostName = (w: WaitingHost): string =>
	w.host ?? w.address ?? "an address the file gives";

export const filesWord = (n: number): string =>
	n === 1 ? "1 file" : `${n} files`;

export interface Notice {
	/** No mode chosen yet, and files are waiting on it: offer the three modes. */
	choose: WaitingHost[];
	/** Hosts neither on the list nor left: allow or leave each, once. */
	ask: WaitingHost[];
	/** Would be fetched as this machine is set now: read the files. */
	read: WaitingHost[];
	/** Not fetched, by the person's own choice or because no setting would: told, not asked. */
	told: Array<{ host: WaitingHost; why: string }>;
}

/** Sort what a project is waiting on into what to ask and what to tell. */
export function noticeOf(waiting: WaitingHost[]): Notice {
	const notice: Notice = { choose: [], ask: [], read: [], told: [] };
	for (const w of waiting) {
		if (w.state === "choose") notice.choose.push(w);
		else if (w.state === "ask") notice.ask.push(w);
		else if (w.state === "read") notice.read.push(w);
		else
			notice.told.push({
				host: w,
				why:
					w.state === "left"
						? "you told this machine to leave that host"
						: w.state === "never"
							? "this machine never fetches them"
							: (w.detail ?? "the address cannot be fetched"),
			});
	}
	return notice;
}

/** Whether anything is waiting that a page should show at all. */
export const hasNotice = (n: Notice): boolean =>
	n.choose.length + n.ask.length + n.read.length + n.told.length > 0;

/** The hosts fetched from while the list is in force: built-in and added, less those left. */
export const hostsInForce = (c: WebCredentials): string[] =>
	[...new Set([...c.builtIn, ...c.hosts])].filter((h) => !c.left.includes(h));

/** The mode in a sentence, after "This machine". */
export function modeSentence(mode: WebCredentialMode | null): string {
	switch (mode) {
		case null:
			return "has not been told what to do, so it fetches nothing";
		case "never":
			return "never fetches them";
		case "listed":
			return "fetches them only from the hosts on its list";
		case "any":
			return "fetches them from any host";
	}
}
