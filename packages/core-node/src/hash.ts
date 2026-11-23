// A file's SHA-256 (lower-case hex), read in 1 MiB pieces, so a large video
// is never held in memory. Identity in the catalog is this hash.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export async function sha256OfFile(file: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(file, { highWaterMark: 1 << 20 }))
		hash.update(chunk as Buffer);
	return hash.digest("hex");
}
