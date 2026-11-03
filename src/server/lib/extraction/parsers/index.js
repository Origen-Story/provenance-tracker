/**
 * Parser registry.
 *
 * Order = priority: the dispatcher walks this list and the first parser whose
 * detect() returns true wins. If none match, a generic EXIF-only fallback is used.
 *
 * To add a platform:
 *   1. Create parsers/<platform>.js exporting `id`, `detect(exifTags, chunks)`,
 *      and `parse(exifTags, chunks)`.
 *   2. Import it here and splice it into `parsers` at the right priority.
 *      Specific signals (custom PNG chunks, proprietary tag names) go earlier;
 *      fuzzier signals (regex on description, Software-tag substring) go later.
 */

import * as topazVideoAi from './topaz-video-ai.js';
import * as topazGigapixel from './topaz-gigapixel.js';
import * as comfyui from './comfyui.js';
import * as firefly from './firefly.js';
import * as elevenlabs from './elevenlabs.js';
import * as midjourney from './midjourney.js';
import * as freepik from './freepik.js';

// Order rationale:
//   1. topaz-video-ai — `Videoai` tag is the most specific, and a Topaz output of
//      a C2PA-signed source would otherwise be misclassified as the upstream
//      generator. Topaz is a modifier, so "most recent transform wins" is the
//      honest outcome until provenance chaining is built.
//   2. topaz-gigapixel — Software/CreatorTool names the app; also a modifier,
//      and its XMP DigitalSourceType is inherited from the input, so it must
//      win before any parser that reads that tag.
//   3. comfyui — PNG `prompt`/`workflow` chunks are uniquely ComfyUI.
//   4. firefly / elevenlabs — specific C2PA claim-generator strings.
//   5. midjourney / freepik — fuzzier (Software tag substring, --params regex).
export const parsers = [topazVideoAi, topazGigapixel, comfyui, firefly, elevenlabs, midjourney, freepik];
