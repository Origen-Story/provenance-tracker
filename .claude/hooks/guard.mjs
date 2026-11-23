// PreToolUse guard: refuse Claude file edits to protected paths.
//
// Claude Code pipes the tool call as JSON on stdin. Exit 0 lets it through;
// exit 2 blocks it and the stderr line is shown to Claude as the reason.
// Programs that write these paths (the certificate generator, the tools
// fetcher) run through the shell, not these file tools, so they are
// unaffected. Shell edits are not blocked either, which means "do not write
// these paths from a shell" is a rule, not a fence.
import { readFileSync } from 'node:fs';
import { relative, resolve, isAbsolute } from 'node:path';

const ALLOWED = [/(^|\/)\.env\.example$/i, /^tools\/README\.md$/i];

const PROTECTED = [
	[/(^|\/)\.env(\..*)?$/i, '.env files hold secrets; edit them by hand.'],
	[/^certs\//i, 'certs/ holds signing keys; generate them with npm run cert:generate, never edit.'],
	[/^data\//i, 'data/ holds the old app\'s managed copies of media; leave the files as they are.'],
	[/^tools\//i, 'tools/ holds local binaries (see tools/README.md); install them, never edit them.'],
];

const payload = JSON.parse(readFileSync(0, 'utf8'));
const input = payload.tool_input ?? {};
const raw = input.file_path ?? input.notebook_path ?? '';

// Judge paths relative to the project, so a parent folder that happens to be
// called "data" elsewhere on disk never matters. Paths outside the project
// are not this guard's business.
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const abs = isAbsolute(raw) ? raw : resolve(root, raw);
const rel = relative(root, abs).replace(/\\/g, '/');
if (rel.startsWith('../') || isAbsolute(rel)) process.exit(0);

if (ALLOWED.some((re) => re.test(rel))) process.exit(0);
for (const [re, reason] of PROTECTED) {
	if (re.test(rel)) {
		console.error(`Blocked by .claude/hooks/guard.mjs: ${reason} (${raw})`);
		process.exit(2);
	}
}
process.exit(0);
