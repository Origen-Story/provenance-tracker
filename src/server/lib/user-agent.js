/**
 * The User-Agent for requests the app makes when a person adds a file by its
 * address (src/server/api/download.ts): the tracker's name and version, and a
 * contact. Many servers throttle or refuse a client that does not say what it
 * is.
 *
 * Set APP_CONTACT in .env to say who runs this copy (an email address, or a
 * web address). Without it the contact is the project's own address.
 */

import { TOOL } from "@provenancetracker/core-node/tool.ts";

const APP_NAME = "ProvenanceTracker";
const DEFAULT_CONTACT = "https://provenancetracker.org";
const contact = process.env.APP_CONTACT || DEFAULT_CONTACT;

export const USER_AGENT = `${APP_NAME}/${TOOL.version} (${contact})`;
