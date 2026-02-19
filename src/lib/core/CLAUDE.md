# Core Module

Foundation module with no dependencies on other modules.

## Public API

### Database
- `src/lib/core/db/index.js` — exports `db` (Drizzle instance) and `sqlite` (raw better-sqlite3)
- `src/lib/core/db/schema.js` — all 6 table definitions (projectConfig, assets, assetMetadata, generationParams, assetRelationships, manifests)

### Constants
- `src/lib/core/constants.js` — ASSET_TYPES, PLATFORMS, DIGITAL_SOURCE_TYPES, RELATIONSHIP_TYPES, COMPLETENESS_FIELDS

### Utilities
- `src/lib/core/utils/file-utils.js` — computeFileHash, getMimeType, isSupportedFile, isPng, isImage, getFileSize, normalizePath
- `src/lib/core/utils/asset-id.js` — generateAssetId(prefix, assetType) → "GAIA-CHAR-001"

## Schema Overview

| Table | Key Columns |
|-------|------------|
| project_config | projectName, author, organization, certificatePath, assetIdPrefix |
| assets | assetId (unique), filePath, fileHash, assetType, platform, digitalSourceType, completeness |
| asset_metadata | assetId FK, metadataType, rawJson |
| generation_params | assetId FK, prompt, modelName, seed, steps, cfgScale, sampler, loras, controlnets |
| asset_relationships | parentAssetId FK, childAssetId FK, relationshipType |
| manifests | assetId FK, manifestJson, manifestType, signedAt |
