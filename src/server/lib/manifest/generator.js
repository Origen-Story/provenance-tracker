// The claim generator every manifest this program signs names: the program
// and its version, read once from package.json.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', '..', '..', '..', 'package.json'), 'utf8'));

export const GENERATOR = { name: 'provenance-tracker', version: pkg.version };

// RFC 3161 time-stamp authority used when signing for real. The same one the
// 4c spike used. Tests never pass it (no network in tests).
export const DEFAULT_TIMESTAMP_URL = 'http://timestamp.digicert.com';
