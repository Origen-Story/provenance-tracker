// npm run catalog:write
//
// Writes the two files the tests hold the catalog format to:
// - spec/catalog/catalog.v<N>.sql, the published copy of the format's SQL;
// - packages/core/test/fixtures/catalog/v<N>.sqlite, a sample catalog of that
//   format with a row in every table.
// While the format is a draft both are rewritten. Once it is released they
// are only written if missing, because a released format never changes.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
	CATALOG_FORMAT,
	CATALOG_FORMAT_STATUS,
} from "../packages/core/src/catalog/format.ts";
import { CURRENT_SCHEMA_SQL } from "../packages/core/src/catalog/create.ts";
import {
	fillSample,
	memoryCatalog,
} from "../packages/core/test/helpers/catalog.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const draft = CATALOG_FORMAT_STATUS === "draft";

function shouldWrite(file: string): boolean {
	if (!existsSync(file) || draft) return true;
	console.log(
		`kept   ${path.relative(ROOT, file)} (format ${CATALOG_FORMAT} is released)`,
	);
	return false;
}

const specFile = path.join(
	ROOT,
	"spec",
	"catalog",
	`catalog.v${CATALOG_FORMAT}.sql`,
);
if (shouldWrite(specFile)) {
	mkdirSync(path.dirname(specFile), { recursive: true });
	writeFileSync(specFile, CURRENT_SCHEMA_SQL);
	console.log(`wrote  ${path.relative(ROOT, specFile)}`);
}

const sampleFile = path.join(
	ROOT,
	"packages",
	"core",
	"test",
	"fixtures",
	"catalog",
	`v${CATALOG_FORMAT}.sqlite`,
);
if (shouldWrite(sampleFile)) {
	mkdirSync(path.dirname(sampleFile), { recursive: true });
	rmSync(sampleFile, { force: true });
	const db = memoryCatalog();
	fillSample(db);
	// One self-contained file: no WAL, compacted.
	db.exec(`VACUUM INTO '${sampleFile.replaceAll("'", "''")}'`);
	db.close();
	const check = new DatabaseSync(sampleFile, { readOnly: true });
	const mode = check.prepare("PRAGMA journal_mode").get() as {
		journal_mode: string;
	};
	check.close();
	console.log(
		`wrote  ${path.relative(ROOT, sampleFile)} (journal ${mode.journal_mode})`,
	);
}
