// Read the table data out of a Postgres dump turned into plain SQL
// (`pg_restore --data-only -f out.sql`). Pure: the caller reads the file.
//
// Each table is a block:
//
//   COPY public.assets (id, asset_id, file_path) FROM stdin;
//   1	VPT-001	P:\\media\\clip.mp4
//   \.
//
// One row per line, fields separated by tabs, \N for null, and backslash
// escapes inside a field (Postgres's COPY text format: \b \f \n \r \t \v \\,
// \ooo octal and \xhh hex bytes, any other character after a backslash is
// itself). Times are timestamptz text such as "2026-11-13 21:53:25.345308+01",
// booleans are t and f.

/** One row: column name → the field's text, or null. */
export type CopyRow = Record<string, string | null>;

export interface CopyTable {
	/** As the dump names it: "public.assets", "drizzle.__drizzle_migrations". */
	name: string;
	columns: string[];
	rows: CopyRow[];
}

const ENCODING_LINE = /^SET client_encoding = '([^']*)';$/;

const COPY_START = "COPY ";
const COPY_END = ") FROM stdin;";

/**
 * The table name and column list of a "COPY <name> (<columns>) FROM stdin;"
 * line, or null for any other line. Read by walking the characters once,
 * with quotes tracked, rather than by a regular expression: a name such as
 * "a""b" can be split more than one way, and a pattern that tries them all
 * takes exponential time on a hostile line.
 */
function copyHeader(line: string): { name: string; columns: string } | null {
	if (!line.startsWith(COPY_START) || !line.endsWith(COPY_END)) return null;
	let quoted = false;
	for (let i = COPY_START.length; i < line.length; i++) {
		const c = line[i];
		if (c === '"') quoted = !quoted;
		else if (!quoted && c === " ") {
			const name = line.slice(COPY_START.length, i);
			if (!name || line[i + 1] !== "(") return null;
			return { name, columns: line.slice(i + 2, -COPY_END.length) };
		}
	}
	return null;
}

/** An identifier as Postgres writes it: bare, or in double quotes with "" for ". */
function unquoteIdent(text: string): string {
	if (text.startsWith('"') && text.endsWith('"') && text.length >= 2)
		return text.slice(1, -1).replaceAll('""', '"');
	return text;
}

/** Split "a, \"b, c\", d" on the commas outside quotes. */
function splitIdents(list: string): string[] {
	const out: string[] = [];
	let current = "";
	let quoted = false;
	for (let i = 0; i < list.length; i++) {
		const c = list[i];
		if (c === '"') quoted = !quoted;
		if (c === "," && !quoted) {
			out.push(current.trim());
			current = "";
			continue;
		}
		current += c;
	}
	out.push(current.trim());
	return out.map(unquoteIdent);
}

/** A qualified name with each part unquoted: public."My table" → public.My table. */
function unquoteName(text: string): string {
	const parts: string[] = [];
	let current = "";
	let quoted = false;
	for (const c of text) {
		if (c === '"') quoted = !quoted;
		if (c === "." && !quoted) {
			parts.push(current);
			current = "";
			continue;
		}
		current += c;
	}
	parts.push(current);
	return parts.map(unquoteIdent).join(".");
}

const SIMPLE_ESCAPES: Record<string, string> = {
	b: "\b",
	f: "\f",
	n: "\n",
	r: "\r",
	t: "\t",
	v: "\v",
};

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** One field's text with its backslash escapes undone. */
export function unescapeField(field: string): string | null {
	if (field === "\\N") return null;
	if (!field.includes("\\")) return field;
	let out = "";
	// Octal and hex escapes are bytes, which may be parts of one UTF-8
	// character; they are collected and decoded together.
	let bytes: number[] = [];
	const flush = () => {
		if (bytes.length) out += utf8.decode(new Uint8Array(bytes));
		bytes = [];
	};
	for (let i = 0; i < field.length; i++) {
		const c = field[i];
		if (c !== "\\") {
			flush();
			out += c;
			continue;
		}
		const next = field[i + 1];
		if (next === undefined)
			throw new Error("A field ends with a lone backslash");
		const octal = /^[0-7]{1,3}/.exec(field.slice(i + 1, i + 4));
		if (octal) {
			bytes.push(parseInt(octal[0], 8) & 0xff);
			i += octal[0].length;
			continue;
		}
		const hex =
			next === "x" && /^[0-9a-fA-F]{1,2}/.exec(field.slice(i + 2, i + 4));
		if (hex) {
			bytes.push(parseInt(hex[0], 16));
			i += 1 + hex[0].length;
			continue;
		}
		flush();
		out += SIMPLE_ESCAPES[next] ?? next;
		i++;
	}
	flush();
	return out;
}

/**
 * Every COPY block in the text, by table name. Refuses text in an encoding
 * other than UTF-8, a table that appears twice, and a row whose field count
 * does not match its columns.
 */
export function parseCopyText(text: string): Map<string, CopyTable> {
	const tables = new Map<string, CopyTable>();
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].endsWith("\r") ? lines[i].slice(0, -1) : lines[i];
		const encoding = ENCODING_LINE.exec(line);
		if (encoding && encoding[1].toUpperCase() !== "UTF8")
			throw new Error(
				`The dump text is in ${encoding[1]}; only UTF8 can be read`,
			);
		const header = copyHeader(line);
		if (!header) continue;
		const name = unquoteName(header.name);
		if (tables.has(name))
			throw new Error(`The dump has the table ${name} twice`);
		const columns = splitIdents(header.columns);
		const rows: CopyRow[] = [];
		for (i++; ; i++) {
			if (i >= lines.length)
				throw new Error(`The data of ${name} has no end (\\.)`);
			// A carriage return in a value is written \r, so one at the end of
			// a line is the line ending, not data.
			const raw = lines[i].endsWith("\r") ? lines[i].slice(0, -1) : lines[i];
			if (raw === "\\.") break;
			const fields = raw.split("\t");
			if (fields.length !== columns.length)
				throw new Error(
					`A row of ${name} (line ${i + 1}) has ${fields.length} fields for ${columns.length} columns`,
				);
			const row: CopyRow = {};
			columns.forEach((col, k) => {
				row[col] = unescapeField(fields[k]);
			});
			rows.push(row);
		}
		tables.set(name, { name, columns, rows });
	}
	return tables;
}

// Values as Postgres writes them in COPY text.

const TIMESTAMPTZ =
	/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?$/;

/**
 * A timestamptz as ISO 8601 UTC, to the millisecond
 * ("2026-11-13 21:53:25.345308+01" → "2026-11-13T20:53:25.345Z"). Digits
 * past the millisecond are dropped, as the app's own reads did.
 */
export function pgTimestamp(text: string): string {
	const m = TIMESTAMPTZ.exec(text);
	if (!m)
		throw new Error(`Not a Postgres timestamptz: ${JSON.stringify(text)}`);
	const [, y, mo, d, h, mi, s, frac = "", sign, oh, om = "00", os = "00"] = m;
	const ms = Number(frac.padEnd(3, "0").slice(0, 3));
	const offset =
		(sign === "-" ? -1 : 1) *
		(Number(oh) * 3600 + Number(om) * 60 + Number(os)) *
		1000;
	const utc =
		Date.UTC(
			Number(y),
			Number(mo) - 1,
			Number(d),
			Number(h),
			Number(mi),
			Number(s),
			ms,
		) - offset;
	const date = new Date(utc);
	if (Number.isNaN(date.getTime()))
		throw new Error(`Not a real time: ${JSON.stringify(text)}`);
	return date.toISOString();
}

export function pgBoolean(text: string | null): boolean | null {
	if (text === null) return null;
	if (text === "t") return true;
	if (text === "f") return false;
	throw new Error(`Not a Postgres boolean: ${JSON.stringify(text)}`);
}

export function pgInteger(text: string | null): number | null {
	if (text === null) return null;
	if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
		throw new Error(`Not a whole number: ${JSON.stringify(text)}`);
	return Number(text);
}

export function pgReal(text: string | null): number | null {
	if (text === null) return null;
	const n = Number(text);
	if (text.trim() === "" || !Number.isFinite(n))
		throw new Error(`Not a finite number: ${JSON.stringify(text)}`);
	return n;
}
