// The name and version this tracker records in every run it writes.

import type { Tool } from "@provenancetracker/core/catalog/create.ts";
import pkg from "../package.json" with { type: "json" };

export const TOOL: Tool = { name: "provenancetracker", version: pkg.version };

/** How the tracker names itself as the actor of a change it made on its own. */
export const TOOL_ACTOR_NAME = `${TOOL.name} ${TOOL.version}`;
