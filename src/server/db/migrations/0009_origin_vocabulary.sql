-- Decision D11: origin classes become IPTC digital source type codes.
-- Hand-written data migration (drizzle-kit generate --custom). Every UPDATE only
-- touches rows still holding a pre-D11 name, so running it again changes nothing.
--
-- "Signed" stops being a class: a signed capture keeps that fact in signed_by.
-- A confirmed "archival" meant "from an archive", not "a scan", so those rows
-- become an unconfirmed proposal of print (Scanned) for the user to review.
UPDATE "assets" SET "signed_by" = 'device' WHERE "origin_class" = 'captured_signed' AND coalesce("signed_by", '') = '';--> statement-breakpoint
UPDATE "assets" SET "origin_class_confirmed" = false, "origin_class_source" = 'table_archival' WHERE "origin_class" = 'archival';--> statement-breakpoint
UPDATE "assets" SET "origin_class" = CASE "origin_class" WHEN 'captured_signed' THEN 'digitalCapture' WHEN 'captured' THEN 'digitalCapture' WHEN 'archival' THEN 'print' WHEN 'archival_enhanced' THEN 'algorithmicallyEnhanced' WHEN 'generated' THEN 'trainedAlgorithmicMedia' WHEN 'composited' THEN 'composite' ELSE "origin_class" END WHERE "origin_class" IN ('captured_signed','captured','archival','archival_enhanced','generated','composited');--> statement-breakpoint
UPDATE "archival_assets" SET "signed_by" = 'device' WHERE "origin_class" = 'captured_signed' AND coalesce("signed_by", '') = '';--> statement-breakpoint
UPDATE "archival_assets" SET "origin_class_confirmed" = false, "origin_class_source" = 'table_archival' WHERE "origin_class" = 'archival';--> statement-breakpoint
UPDATE "archival_assets" SET "origin_class" = CASE "origin_class" WHEN 'captured_signed' THEN 'digitalCapture' WHEN 'captured' THEN 'digitalCapture' WHEN 'archival' THEN 'print' WHEN 'archival_enhanced' THEN 'algorithmicallyEnhanced' WHEN 'generated' THEN 'trainedAlgorithmicMedia' WHEN 'composited' THEN 'composite' ELSE "origin_class" END WHERE "origin_class" IN ('captured_signed','captured','archival','archival_enhanced','generated','composited');--> statement-breakpoint
UPDATE "produced_assets" SET "signed_by" = 'device' WHERE "origin_class" = 'captured_signed' AND coalesce("signed_by", '') = '';--> statement-breakpoint
UPDATE "produced_assets" SET "origin_class_confirmed" = false, "origin_class_source" = 'table_archival' WHERE "origin_class" = 'archival';--> statement-breakpoint
UPDATE "produced_assets" SET "origin_class" = CASE "origin_class" WHEN 'captured_signed' THEN 'digitalCapture' WHEN 'captured' THEN 'digitalCapture' WHEN 'archival' THEN 'print' WHEN 'archival_enhanced' THEN 'algorithmicallyEnhanced' WHEN 'generated' THEN 'trainedAlgorithmicMedia' WHEN 'composited' THEN 'composite' ELSE "origin_class" END WHERE "origin_class" IN ('captured_signed','captured','archival','archival_enhanced','generated','composited');--> statement-breakpoint
UPDATE "timeline_segments" SET "origin_class" = CASE "origin_class" WHEN 'captured_signed' THEN 'digitalCapture' WHEN 'captured' THEN 'digitalCapture' WHEN 'archival' THEN 'print' WHEN 'archival_enhanced' THEN 'algorithmicallyEnhanced' WHEN 'generated' THEN 'trainedAlgorithmicMedia' WHEN 'composited' THEN 'composite' ELSE "origin_class" END WHERE "origin_class" IN ('captured_signed','captured','archival','archival_enhanced','generated','composited');
