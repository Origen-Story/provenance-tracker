#!/usr/bin/env node
// Entry point for `npm run cli -- <command>`.
//
// node:sqlite prints an "experimental" warning when it loads (Node 24). That
// one warning is dropped by name; every other warning prints as usual (D14).
// The filter must be in place before node:sqlite loads, so the rest of the
// program is imported after it, not alongside it.

const printers = process.listeners("warning");
process.removeAllListeners("warning");
process.on("warning", (warning) => {
	if (warning.name === "ExperimentalWarning" && /SQLite/i.test(warning.message))
		return;
	for (const print of printers) print(warning);
});

const { run } = await import("./run.ts");
const { thisMachine } = await import("../machine.ts");

// npm runs scripts from the repository root and passes the folder it was
// started in as INIT_CWD; outside npm the current folder is the one.
const cwd = process.env.INIT_CWD ?? process.cwd();
// Ctrl+C stops a scan between files and records the run as cancelled; a
// second Ctrl+C ends the process at once.
const stop = new AbortController();
process.once("SIGINT", () => {
	console.error("Stopping after the current file (Ctrl+C again to quit now)…");
	stop.abort();
	process.once("SIGINT", () => process.exit(130));
});
process.exitCode = await run(process.argv.slice(2), {
	machine: thisMachine(),
	cwd,
	signal: stop.signal,
	out: (line) => console.log(line),
	err: (line) => console.error(line),
});
