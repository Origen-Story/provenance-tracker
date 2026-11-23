// `npm run audit`: npm audit at high severity, with an explicit allowlist.
//
// npm audit has no per-advisory ignore. This wrapper runs `npm audit --json`
// and fails on any high or critical advisory that is not listed below with a
// dated reason. Add an entry only when the fix is genuinely out of reach and
// the risk is understood; remove it in the commit that removes the cause.
import { spawnSync } from "node:child_process";

// None at the moment. The sharp advisories allowed here came in only through
// c2pa-node 0.5.26, removed with the old app (D49).
const ALLOW = {};
const FAIL_LEVELS = new Set(["high", "critical"]);

// One command string through the shell: npm is npm.cmd on Windows, and Node
// warns (DEP0190) when an args array is combined with shell: true.
const r = spawnSync("npm audit --json", { encoding: "utf8", shell: true });
let report;
try {
	report = JSON.parse(r.stdout);
} catch {
	console.error("audit: could not parse npm audit output");
	console.error(r.stdout?.slice(0, 2000) || r.stderr);
	process.exit(2);
}

const vulns = report.vulnerabilities ?? {};
const failing = [];
const allowed = [];
for (const [name, v] of Object.entries(vulns)) {
	if (!FAIL_LEVELS.has(v.severity)) continue;
	// `via` mixes advisory objects (direct) and package names (transitive).
	const advisories = (v.via || []).filter((x) => typeof x === "object");
	const ids = advisories.map((a) => a.url?.split("/").pop()).filter(Boolean);
	const unlisted = ids.filter((id) => !ALLOW[id]);
	if (ids.length === 0) continue; // transitive-only entry; its root advisory is judged on the direct package
	if (unlisted.length === 0)
		allowed.push(
			`${name} (${v.severity}): ${ids.map((id) => `${id} — ${ALLOW[id]}`).join("; ")}`,
		);
	else failing.push(`${name} (${v.severity}): ${unlisted.join(", ")}`);
}

const total = report.metadata?.vulnerabilities ?? {};
console.log(
	`audit: ${total.total ?? 0} advisories (critical ${total.critical ?? 0}, high ${total.high ?? 0}, moderate ${total.moderate ?? 0}, low ${total.low ?? 0})`,
);
if (allowed.length)
	console.log(`audit: allowlisted\n  ${allowed.join("\n  ")}`);
if (failing.length) {
	console.error(
		`audit: FAIL, unlisted high/critical advisories\n  ${failing.join("\n  ")}`,
	);
	process.exit(1);
}
console.log("audit: OK (no unlisted high or critical advisories)");
