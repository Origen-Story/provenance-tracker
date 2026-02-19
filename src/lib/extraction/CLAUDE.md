# Extraction Module

Metadata extraction and platform-specific parsing. Depends only on `core` (file-utils, constants).

## Public API

**`src/lib/extraction/index.js`** — single entry point:

```js
import { extractMetadata } from '../extraction/index.js';

const result = await extractMetadata(filePath);
// Returns: { platform, fileInfo, rawMetadata, parsed, gaps, completeness }
```

## Pipeline

1. **Raw Extractors** (run in parallel):
   - `extractors/exif.js` — exiftool-vendored: EXIF, XMP, PNG text chunks
   - `extractors/png-chunks.js` — png-chunks-extract: ComfyUI workflow/prompt JSON
   - `extractors/c2pa.js` — c2patool CLI: C2PA manifests (silent fail if not installed)

2. **Platform Detector** (`parsers/platform-detect.js`):
   - ComfyUI: PNG has 'workflow' + 'prompt' text chunks
   - MidJourney: PNG has 'Description' + 'Author' text chunks
   - Freepik: XMP Credit contains "Google AI" or filename starts with "freepik__"
   - Meta.ai: XMP DigitalSourceType = trainedAlgorithmicMedia (fallback)

3. **Platform Parsers**:
   - `parsers/midjourney.js` — regex parse prompt string for --ar, --v, --seed, --stylize, etc.
   - `parsers/meta-ai.js` — XMP digital source type + filename→prompt extraction
   - `parsers/comfyui.js` — node graph traversal: KSampler, UNETLoader, CLIPTextEncode, LoraLoader, ControlNet
   - `parsers/freepik.js` — C2PA manifest + XMP credit + filename parsing

## ComfyUI Node Types Handled
- KSampler, KSamplerAdvanced → seed, steps, cfg, sampler, scheduler
- CLIPTextEncode → positive/negative prompts (traced from KSampler refs)
- CheckpointLoaderSimple, UNETLoader → model name
- CLIPLoader, DualCLIPLoader → clip model
- VAELoader → vae model
- LoraLoader → lora name + weight
- ControlNet nodes, ModelPatchLoader → controlnet names

## Important Notes
- Uses relative imports (not `$lib`) so it can run standalone with `node` for testing
- exiftool-vendored spawns a Perl process — call `shutdownExifTool()` when done in standalone scripts
- c2patool extraction silently returns null if c2patool CLI is not installed
