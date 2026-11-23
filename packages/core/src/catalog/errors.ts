// The two ways a change asked of the catalog can be refused, so a caller
// (the API) can answer each in its own way.

/** A mistake in what was asked: the caller's to fix (HTTP 400). */
export class EditError extends Error {}

/** A row that is not there (HTTP 404). */
export class NotFoundError extends Error {}
