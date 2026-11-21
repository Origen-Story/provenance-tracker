-- Provenance Tracker catalog, format 1.
--
-- One SQLite file per project, at <project>/.provenancetracker/catalog.sqlite.
-- PRAGMA application_id is 1349932146 ('PvTr'); PRAGMA user_version is the
-- format number. Connections set foreign_keys = ON and trusted_schema = OFF.
--
-- Conventions: times are ISO 8601 UTC text ('2026-11-21T13:09:57.177Z');
-- booleans are 0 or 1; JSON columns hold valid JSON text; a file is a root
-- plus a relative path written with '/'. Which absolute folder a root is on a
-- given machine is not in the catalog: it lives in that machine's settings.
--
-- Two kinds of table. Records of what happened (runs, contents, observations,
-- history, statements, signatures) never change: triggers refuse updates and
-- deletes. Current values (meta, roots, assets, credits, generation,
-- locations, relationships, timelines) are ordinary rows; a human edit to one
-- of their fields is made together with a history row, in one transaction.
-- Assets are never deleted; removed_at marks one as removed. Tables whose
-- rows can be removed use AUTOINCREMENT, so an id is never reused and a
-- history entry's row key always means the same row. Which fields count as
-- human-editable is listed in packages/core/src/catalog/fields.ts.

-- Project settings: project_id (a UUID, the key for this machine's settings),
-- name, description, author, organization, and the like.
CREATE TABLE meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
) STRICT;

-- One scan, extraction, classification, signing, import, upgrade or
-- migration: which tool and version did it, and what it found. A run may
-- change only until it finishes, and then only its ending.
CREATE TABLE runs (
	id INTEGER PRIMARY KEY,
	kind TEXT NOT NULL,
	tool TEXT NOT NULL,
	tool_version TEXT NOT NULL,
	started_at TEXT NOT NULL,
	finished_at TEXT,
	outcome TEXT CHECK (outcome IN ('ok', 'failed', 'cancelled')),
	summary TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(summary))
) STRICT;

CREATE TRIGGER runs_sealed BEFORE UPDATE ON runs
WHEN old.finished_at IS NOT NULL
	OR new.id IS NOT old.id OR new.kind IS NOT old.kind
	OR new.tool IS NOT old.tool OR new.tool_version IS NOT old.tool_version
	OR new.started_at IS NOT old.started_at
BEGIN
	SELECT RAISE(ABORT, 'a finished run never changes; an open run changes only its finished_at, outcome and summary');
END;

CREATE TRIGGER runs_kept BEFORE DELETE ON runs
BEGIN
	SELECT RAISE(ABORT, 'runs are never deleted');
END;

-- A media folder. A project can have several, on different drives.
-- folder_in_project is the root's folder relative to the project folder
-- ('/' between folders; '.' for the project folder itself) when the root is
-- inside it, so a project folder copied, archived or restored anywhere finds
-- the root again. NULL for a root outside the project folder, whose place is
-- kept in each machine's settings.
CREATE TABLE roots (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL UNIQUE CHECK (name <> ''),
	note TEXT NOT NULL DEFAULT '',
	folder_in_project TEXT CHECK (
		folder_in_project IS NULL OR folder_in_project = '.' OR (
			folder_in_project <> '' AND folder_in_project <> '..'
			AND instr(folder_in_project, char(92)) = 0
			AND folder_in_project NOT GLOB '/*' AND folder_in_project NOT GLOB '?:*'
			AND folder_in_project NOT GLOB '../*' AND folder_in_project NOT GLOB '*/../*'
			AND folder_in_project NOT GLOB '*/..'
		)
	),
	created_at TEXT NOT NULL
) STRICT;

-- The logical thing ("the final film"), with its current values. kind says
-- how it entered the project: generated, archival or produced; unsorted
-- when a scan found it and nobody has said yet; sidecar for an .xmp or .c2pa
-- file beside another (extract sets it, only on an unsorted asset). Titles empty
-- mean the file name. The *_folded columns hold the same text with accents
-- removed and lower-cased (written by the edit functions), for filters.
-- The origin class is an IPTC Digital Source Type code or 'unknown'
-- (docs/vocabulary.md); origin_class_source names the rule or person that set it.
CREATE TABLE assets (
	id INTEGER PRIMARY KEY,
	code TEXT UNIQUE,
	kind TEXT NOT NULL,
	is_output INTEGER NOT NULL DEFAULT 0 CHECK (is_output IN (0, 1)),
	output_source TEXT NOT NULL DEFAULT '',
	title TEXT NOT NULL DEFAULT '',
	title_folded TEXT NOT NULL DEFAULT '',
	public_title TEXT NOT NULL DEFAULT '',
	public_title_folded TEXT NOT NULL DEFAULT '',
	description TEXT NOT NULL DEFAULT '',
	caption TEXT NOT NULL DEFAULT '',
	notes TEXT NOT NULL DEFAULT '',
	usage_notes TEXT NOT NULL DEFAULT '',
	original_date TEXT NOT NULL DEFAULT '',
	medium TEXT NOT NULL DEFAULT '',
	recorded_date TEXT NOT NULL DEFAULT '',
	recorded_location TEXT NOT NULL DEFAULT '',
	equipment TEXT NOT NULL DEFAULT '',
	source_url TEXT NOT NULL DEFAULT '',
	access_date TEXT NOT NULL DEFAULT '',
	license TEXT NOT NULL DEFAULT '',
	license_url TEXT NOT NULL DEFAULT '',
	origin_class TEXT NOT NULL DEFAULT 'unknown',
	origin_class_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (origin_class_confirmed IN (0, 1)),
	origin_class_source TEXT NOT NULL DEFAULT '',
	origin_class_note TEXT NOT NULL DEFAULT '',
	origin_ingredient_classes TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(origin_ingredient_classes)),
	ai_assisted INTEGER NOT NULL DEFAULT 0 CHECK (ai_assisted IN (0, 1)),
	signed_by TEXT NOT NULL DEFAULT '',
	signer_name TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	removed_at TEXT
) STRICT;

CREATE TRIGGER assets_kept BEFORE DELETE ON assets
BEGIN
	SELECT RAISE(ABORT, 'assets are never deleted; set removed_at');
END;

-- Who made an asset, in what role. on_behalf_of is who they acted for, if
-- anyone; stated_by is who says so (the creator, the file, a legacy import).
-- CAWG has proposed a standard record for acting on someone's behalf
-- (delegation); these columns hold it until one is adopted.
CREATE TABLE credits (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	asset_id INTEGER NOT NULL REFERENCES assets (id),
	role TEXT NOT NULL,
	name TEXT NOT NULL,
	name_folded TEXT NOT NULL DEFAULT '',
	on_behalf_of TEXT NOT NULL DEFAULT '',
	stated_by TEXT NOT NULL DEFAULT '',
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX credits_asset ON credits (asset_id, sort_order);

-- How an AI asset was made: platform, model, prompt and settings. The values
-- a parser read stay in observations; these are the current ones.
CREATE TABLE generation (
	asset_id INTEGER PRIMARY KEY REFERENCES assets (id),
	platform TEXT NOT NULL DEFAULT '',
	model_name TEXT NOT NULL DEFAULT '',
	model_version TEXT NOT NULL DEFAULT '',
	prompt TEXT NOT NULL DEFAULT '',
	negative_prompt TEXT NOT NULL DEFAULT '',
	seed TEXT NOT NULL DEFAULT '',
	steps INTEGER,
	cfg_scale TEXT NOT NULL DEFAULT '',
	sampler TEXT NOT NULL DEFAULT '',
	scheduler TEXT NOT NULL DEFAULT '',
	width INTEGER,
	height INTEGER,
	aspect_ratio TEXT NOT NULL DEFAULT '',
	stylize TEXT NOT NULL DEFAULT '',
	style_raw TEXT NOT NULL DEFAULT '',
	loras TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(loras)),
	controlnets TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(controlnets)),
	other TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(other)),
	generated_at TEXT NOT NULL DEFAULT '',
	updated_at TEXT NOT NULL
) STRICT;

-- One exact set of bytes, by SHA-256 (lower-case hex), belonging to one asset:
-- cut 1, cut 2, the signed copy of cut 2. Its hash and size never change and
-- it is never deleted; which asset it belongs to changes only by an edit.
CREATE TABLE contents (
	sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
	size INTEGER NOT NULL CHECK (size >= 0),
	asset_id INTEGER NOT NULL REFERENCES assets (id),
	first_run_id INTEGER NOT NULL REFERENCES runs (id),
	created_at TEXT NOT NULL
) STRICT;

CREATE INDEX contents_asset ON contents (asset_id);

CREATE TRIGGER contents_fixed BEFORE UPDATE OF sha256, size, first_run_id, created_at ON contents
BEGIN
	SELECT RAISE(ABORT, 'a content''s hash, size and first sighting never change');
END;

CREATE TRIGGER contents_kept BEFORE DELETE ON contents
BEGIN
	SELECT RAISE(ABORT, 'contents are never deleted');
END;

-- Where a content was seen: a root and a path relative to it. modified_ms is
-- the file's modified time at the last scan, so a rescan can skip a file whose
-- size and time are unchanged. A location that is gone (missing, or now holding
-- other bytes) keeps its row with gone_run_id set; only one live row per path.
CREATE TABLE locations (
	id INTEGER PRIMARY KEY,
	content_sha256 TEXT NOT NULL REFERENCES contents (sha256),
	root_id INTEGER NOT NULL REFERENCES roots (id),
	path TEXT NOT NULL CHECK (
		path <> '' AND path <> '..' AND instr(path, char(92)) = 0
		AND path NOT GLOB '/*' AND path NOT GLOB '?:*'
		AND path NOT GLOB '../*' AND path NOT GLOB '*/../*' AND path NOT GLOB '*/..'
	),
	modified_ms INTEGER NOT NULL,
	first_seen_run_id INTEGER NOT NULL REFERENCES runs (id),
	last_seen_run_id INTEGER NOT NULL REFERENCES runs (id),
	gone_run_id INTEGER REFERENCES runs (id)
) STRICT;

CREATE UNIQUE INDEX locations_live_path ON locations (root_id, path) WHERE gone_run_id IS NULL;
CREATE INDEX locations_content ON locations (content_sha256);

-- Something read from a content, as the extractor returned it (D21): kind,
-- extractor and version, status, the full data, validation. Never changes,
-- so a human decision can never erase what a file said. source_sha256 is the
-- content that was read when it is not the observed content itself: an .xmp
-- or .c2pa sidecar beside the file (D30).
CREATE TABLE observations (
	id INTEGER PRIMARY KEY,
	content_sha256 TEXT NOT NULL REFERENCES contents (sha256),
	source_sha256 TEXT REFERENCES contents (sha256),
	run_id INTEGER NOT NULL REFERENCES runs (id),
	kind TEXT NOT NULL,
	extractor TEXT NOT NULL,
	extractor_version TEXT NOT NULL,
	status TEXT NOT NULL,
	data TEXT CHECK (data IS NULL OR json_valid(data)),
	error TEXT,
	warnings TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(warnings)),
	validation TEXT CHECK (validation IS NULL OR json_valid(validation)),
	observed_at TEXT NOT NULL
) STRICT;

CREATE INDEX observations_content ON observations (content_sha256, kind);

CREATE TRIGGER observations_fixed BEFORE UPDATE ON observations
BEGIN
	SELECT RAISE(ABORT, 'observations never change');
END;

CREATE TRIGGER observations_kept BEFORE DELETE ON observations
BEGIN
	SELECT RAISE(ABORT, 'observations are never deleted');
END;

-- Technical values of each content, from its newest successful ExifTool
-- reading (D31). Not copied into columns: the observation stays the record,
-- and a newer ExifTool's reading replaces these values by being newer.
-- ExifTool names the same value differently by container (VideoFrameRate in
-- MP4, SampleRate in WAV), and a duration is seconds as a number or, for some
-- files, {Value, Scale} meaning Value × Scale seconds. Null where the file
-- has no such value.
CREATE VIEW technical AS
WITH latest AS (
	SELECT o.content_sha256, o.id AS observation_id, o.extractor_version, o.data,
		json_extract(o.data, '$.MIMEType') AS mime
	FROM observations o
	WHERE o.kind = 'exif' AND o.status = 'ok'
		AND o.id = (SELECT max(x.id) FROM observations x
			WHERE x.content_sha256 = o.content_sha256 AND x.kind = 'exif' AND x.status = 'ok')
),
durations AS (
	SELECT content_sha256,
		coalesce(
			CASE json_type(data, '$.Duration')
				WHEN 'object' THEN json_extract(data, '$.Duration.Value') * json_extract(data, '$.Duration.Scale')
				WHEN 'integer' THEN json_extract(data, '$.Duration')
				WHEN 'real' THEN json_extract(data, '$.Duration')
			END,
			CASE WHEN json_type(data, '$.MediaDuration') IN ('integer', 'real') THEN json_extract(data, '$.MediaDuration') END
		) AS seconds
	FROM latest
)
SELECT l.content_sha256, l.observation_id, l.extractor_version AS exiftool_version,
	l.mime AS mime_type,
	d.seconds AS duration_seconds,
	coalesce(json_extract(l.data, '$.ImageWidth'), json_extract(l.data, '$.SourceImageWidth')) AS width,
	coalesce(json_extract(l.data, '$.ImageHeight'), json_extract(l.data, '$.SourceImageHeight')) AS height,
	coalesce(json_extract(l.data, '$.VideoFrameRate'), json_extract(l.data, '$.FrameRate')) AS frame_rate,
	coalesce(json_extract(l.data, '$.CompressorID'), json_extract(l.data, '$.CompressorName')) AS video_codec,
	coalesce(json_extract(l.data, '$.AudioFormat'),
		CASE WHEN l.mime LIKE 'audio/%' THEN json_extract(l.data, '$.Encoding') END) AS audio_codec,
	coalesce(json_extract(l.data, '$.AudioSampleRate'), json_extract(l.data, '$.SampleRate')) AS sample_rate,
	coalesce(json_extract(l.data, '$.AudioChannels'), json_extract(l.data, '$.NumChannels')) AS channels,
	coalesce(json_extract(l.data, '$.AudioBitsPerSample'),
		CASE WHEN l.mime LIKE 'audio/%' THEN json_extract(l.data, '$.BitsPerSample') END) AS bits_per_sample
FROM latest l JOIN durations d ON d.content_sha256 = l.content_sha256;

-- One change to a human-editable field: who made it (a person, a tool, or a
-- legacy import that cannot say which), the table, the row's key, the field,
-- the old and new values as JSON (null old: the row was created; null new: it
-- was removed), a note and evidence. Written in the same transaction as the
-- change. The audit trail of how a value got there; never replayed.
CREATE TABLE history (
	id INTEGER PRIMARY KEY,
	at TEXT NOT NULL,
	actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person', 'tool', 'legacy')),
	actor TEXT NOT NULL,
	run_id INTEGER REFERENCES runs (id),
	table_name TEXT NOT NULL,
	row_key TEXT NOT NULL,
	field TEXT NOT NULL,
	old_value TEXT CHECK (old_value IS NULL OR json_valid(old_value)),
	new_value TEXT CHECK (new_value IS NULL OR json_valid(new_value)),
	note TEXT NOT NULL DEFAULT '',
	evidence TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(evidence))
) STRICT;

CREATE INDEX history_field ON history (table_name, row_key, field, id);

CREATE TRIGGER history_fixed BEFORE UPDATE ON history
BEGIN
	SELECT RAISE(ABORT, 'history never changes');
END;

CREATE TRIGGER history_kept BEFORE DELETE ON history
BEGIN
	SELECT RAISE(ABORT, 'history is never deleted');
END;

-- A link between two assets: ingredient (the child is made from the parent),
-- derived_from (an enhanced or upscaled copy), output_of (an edit that used it),
-- sidecar_of (an .xmp or .c2pa file that describes the parent).
-- match_method says how it was made: manual, filename_pattern, c2pa_ingredient, timeline.
CREATE TABLE relationships (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	parent_id INTEGER NOT NULL REFERENCES assets (id),
	child_id INTEGER NOT NULL REFERENCES assets (id),
	type TEXT NOT NULL,
	match_method TEXT NOT NULL DEFAULT 'manual',
	confidence REAL NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
	note TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL,
	CHECK (parent_id <> child_id),
	UNIQUE (parent_id, child_id, type)
) STRICT;

CREATE INDEX relationships_child ON relationships (child_id);

-- An imported editing timeline, belonging to the cut it made (a content). The
-- timeline file itself is kept as .provenancetracker/timelines/<file_sha256>.
-- breakdown is a cache recomputed from the clips, never evidence.
CREATE TABLE timelines (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	content_sha256 TEXT NOT NULL REFERENCES contents (sha256),
	format TEXT NOT NULL,
	format_version TEXT NOT NULL DEFAULT '',
	file_name TEXT NOT NULL,
	file_sha256 TEXT NOT NULL CHECK (length(file_sha256) = 64 AND file_sha256 NOT GLOB '*[^0-9a-f]*'),
	sequence_name TEXT NOT NULL DEFAULT '',
	timebase INTEGER,
	ntsc INTEGER NOT NULL DEFAULT 0 CHECK (ntsc IN (0, 1)),
	fps REAL,
	duration_frames INTEGER,
	width INTEGER,
	height INTEGER,
	primary_track_index INTEGER NOT NULL DEFAULT 1,
	include_overlays INTEGER NOT NULL DEFAULT 0 CHECK (include_overlays IN (0, 1)),
	breakdown TEXT CHECK (breakdown IS NULL OR json_valid(breakdown)),
	notes TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(notes)),
	imported_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX timelines_content ON timelines (content_sha256);

-- Each source in a timeline (a file, a generated item, a nested sequence), as
-- the editor named it, and the asset it was matched to. Matching is per
-- source, so every clip of one file follows one match.
CREATE TABLE timeline_sources (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	timeline_id INTEGER NOT NULL REFERENCES timelines (id) ON DELETE CASCADE,
	source_key TEXT NOT NULL,
	kind TEXT NOT NULL DEFAULT 'file',
	name TEXT NOT NULL DEFAULT '',
	path TEXT NOT NULL DEFAULT '',
	asset_id INTEGER REFERENCES assets (id),
	match_method TEXT NOT NULL DEFAULT 'unmatched',
	match_confidence REAL NOT NULL DEFAULT 0 CHECK (match_confidence BETWEEN 0 AND 1),
	UNIQUE (timeline_id, source_key)
) STRICT;

-- Each clip on a track. origin_class overrides the class for this clip; null
-- means the class of the source's asset.
CREATE TABLE timeline_clips (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	timeline_id INTEGER NOT NULL REFERENCES timelines (id) ON DELETE CASCADE,
	source_id INTEGER REFERENCES timeline_sources (id) ON DELETE CASCADE,
	track_kind TEXT NOT NULL CHECK (track_kind IN ('video', 'audio')),
	track_index INTEGER NOT NULL,
	clip_key TEXT NOT NULL DEFAULT '',
	name TEXT NOT NULL DEFAULT '',
	enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
	start_frame INTEGER NOT NULL,
	end_frame INTEGER NOT NULL,
	in_frame INTEGER,
	out_frame INTEGER,
	start_seconds REAL,
	end_seconds REAL,
	origin_class TEXT,
	sort_order INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX timeline_clips_timeline ON timeline_clips (timeline_id, sort_order);

-- A saved version of a creator statement for an output: the words and who
-- says them. Each save is a new row; the newest is the current one.
CREATE TABLE statements (
	id INTEGER PRIMARY KEY,
	asset_id INTEGER NOT NULL REFERENCES assets (id),
	text TEXT NOT NULL,
	author TEXT NOT NULL DEFAULT '',
	organization TEXT NOT NULL DEFAULT '',
	edited_with TEXT NOT NULL DEFAULT '',
	saved_at TEXT NOT NULL
) STRICT;

CREATE INDEX statements_asset ON statements (asset_id, id);

CREATE TRIGGER statements_fixed BEFORE UPDATE ON statements
BEGIN
	SELECT RAISE(ABORT, 'a saved statement never changes; save a new one');
END;

CREATE TRIGGER statements_kept BEFORE DELETE ON statements
BEGIN
	SELECT RAISE(ABORT, 'statements are never deleted');
END;

-- One signing: the content signed, the content it produced, the engine and
-- its version, the certificate's SHA-256 fingerprint (never a key path), the
-- manifest definition and the statement as signed, and the read-back report.
CREATE TABLE signatures (
	id INTEGER PRIMARY KEY,
	asset_id INTEGER NOT NULL REFERENCES assets (id),
	kind TEXT NOT NULL CHECK (kind IN ('asset', 'output')),
	version INTEGER NOT NULL CHECK (version >= 1),
	source_sha256 TEXT NOT NULL REFERENCES contents (sha256),
	signed_sha256 TEXT NOT NULL REFERENCES contents (sha256),
	run_id INTEGER NOT NULL REFERENCES runs (id),
	engine TEXT NOT NULL,
	engine_version TEXT NOT NULL DEFAULT '',
	certificate_sha256 TEXT NOT NULL DEFAULT '',
	signer_name TEXT NOT NULL DEFAULT '',
	signer_issuer TEXT NOT NULL DEFAULT '',
	timestamped INTEGER NOT NULL DEFAULT 0 CHECK (timestamped IN (0, 1)),
	definition TEXT NOT NULL CHECK (json_valid(definition)),
	statement_id INTEGER REFERENCES statements (id),
	statement TEXT CHECK (statement IS NULL OR json_valid(statement)),
	report TEXT CHECK (report IS NULL OR json_valid(report)),
	status TEXT NOT NULL DEFAULT '',
	signed_at TEXT NOT NULL,
	UNIQUE (asset_id, kind, version)
) STRICT;

CREATE TRIGGER signatures_fixed BEFORE UPDATE ON signatures
BEGIN
	SELECT RAISE(ABORT, 'signatures never change');
END;

CREATE TRIGGER signatures_kept BEFORE DELETE ON signatures
BEGIN
	SELECT RAISE(ABORT, 'signatures are never deleted');
END;

-- Free-text search (D14). FTS5 folds accents and case itself, so "pena"
-- finds "Peña" and "PEÑA". Kept in step with their tables by triggers.
CREATE VIRTUAL TABLE assets_text USING fts5(
	title, public_title, description, caption, notes,
	content = 'assets', content_rowid = 'id',
	tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER assets_text_insert AFTER INSERT ON assets
BEGIN
	INSERT INTO assets_text (rowid, title, public_title, description, caption, notes)
	VALUES (new.id, new.title, new.public_title, new.description, new.caption, new.notes);
END;

CREATE TRIGGER assets_text_update AFTER UPDATE OF title, public_title, description, caption, notes ON assets
BEGIN
	INSERT INTO assets_text (assets_text, rowid, title, public_title, description, caption, notes)
	VALUES ('delete', old.id, old.title, old.public_title, old.description, old.caption, old.notes);
	INSERT INTO assets_text (rowid, title, public_title, description, caption, notes)
	VALUES (new.id, new.title, new.public_title, new.description, new.caption, new.notes);
END;

CREATE VIRTUAL TABLE credits_text USING fts5(
	name, role,
	content = 'credits', content_rowid = 'id',
	tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER credits_text_insert AFTER INSERT ON credits
BEGIN
	INSERT INTO credits_text (rowid, name, role) VALUES (new.id, new.name, new.role);
END;

CREATE TRIGGER credits_text_update AFTER UPDATE OF name, role ON credits
BEGIN
	INSERT INTO credits_text (credits_text, rowid, name, role) VALUES ('delete', old.id, old.name, old.role);
	INSERT INTO credits_text (rowid, name, role) VALUES (new.id, new.name, new.role);
END;

CREATE TRIGGER credits_text_delete AFTER DELETE ON credits
BEGIN
	INSERT INTO credits_text (credits_text, rowid, name, role) VALUES ('delete', old.id, old.name, old.role);
END;

CREATE VIRTUAL TABLE statements_text USING fts5(
	text,
	content = 'statements', content_rowid = 'id',
	tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER statements_text_insert AFTER INSERT ON statements
BEGIN
	INSERT INTO statements_text (rowid, text) VALUES (new.id, new.text);
END;

PRAGMA application_id = 1349932146;
PRAGMA user_version = 1;
