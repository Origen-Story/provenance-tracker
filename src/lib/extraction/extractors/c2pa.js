import { execSync } from 'child_process';

/**
 * Extract C2PA manifest from a file using c2patool CLI.
 * Returns the parsed manifest JSON, or null if no C2PA data or c2patool not installed.
 *
 * @param {string} filePath
 * @returns {object|null}
 */
export function extractC2pa(filePath) {
	try {
		const output = execSync(`c2patool "${filePath}" --detailed`, {
			encoding: 'utf-8',
			timeout: 15000,
			stdio: ['pipe', 'pipe', 'pipe']
		});

		return JSON.parse(output);
	} catch {
		// c2patool not installed, file has no C2PA data, or parse error — all expected, return null silently
		return null;
	}
}
