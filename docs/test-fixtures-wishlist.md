# Test fixtures — shopping list

Samples to gather for the test suite. Drop them into `test-fixtures/<platform>/` as you collect them — we'll wire the loaders once you have a few per platform.

**Core principle:** the parser should gracefully handle both rich metadata *and* stripped metadata. So per platform we want:

1. **Fresh sample** — downloaded straight from the tool, no edits. Metadata present.
2. *(Optional)* **Post-processed sample** — only if your pipeline actually re-exports through something that changes metadata. If you drop files into Premiere/Resolve/etc. without re-encoding, skip this.
3. *(Optional)* **Screenshot fallback** — a phone photo or screenshot of the asset on screen. Zero platform metadata. One of these total (not per platform) is enough to cover the fallback path.

If a platform has multiple distinct modes (e.g. Freepik's different models, ElevenLabs' TTS vs SFX), grab one per mode.

---

## Images

### ComfyUI
- [ X] 1 sample — any recent generation, PNG output
- *Looking for:* full workflow JSON in PNG `prompt` + `workflow` tEXt chunks

### MidJourney (direct, if you have any)
- [ ] 1 sample if available — can skip if everything comes via Meta-AI now
- *Looking for:* EXIF `Description` with `--ar --s --seed` style params

### Meta-AI (MidJourney-via-Meta)
- [ X] 2 samples — different prompts/subjects
- *Looking for:* XMP `DigitalSourceType`, any prompt info, re-encoding differences vs direct MJ

### Freepik
- [ ] 1 from **Mystic** model
- [ ] 1 from **Flux** model
- [ ] 1 from **Classic Fast** (or whatever other default model you use)
- [ ] 1 from the **Upscaler** (real photo → upscaled; C2PA should flag the upscale action)
- [ ] 1 from **Remove Background** if you use it
- *Looking for:* C2PA manifest variations per model, XMP `DigitalSourceType`

### Adobe Firefly
- [ ] 1 from **Firefly web** (firefly.adobe.com, image generation)
- [ ] 1 from **Photoshop Generative Fill** (small fill on an existing photo — save the PSD export as PNG/JPG)
- [ ] 1 from **Photoshop Generative Expand** (extend canvas)
- *Looking for:* Different C2PA action manifests per tool. Generative Fill should show the "edited" action; Firefly web should show pure "AI generated"

---

## Modifiers

Modifiers transform existing content rather than generating it. The parser should detect the modification *and* ideally preserve any source manifest chained underneath.

### Topaz Labs
- [ ] 1 **Photo AI** output of an **AI-generated image** (e.g. upscale a Freepik or Firefly image through Photo AI) — tests the chain case: does Topaz preserve the source C2PA manifest as an ingredient?
- [ ] 1 **Photo AI** output of a **non-AI photo** (e.g. a phone photo or scanned archival image) — tests the modifier-only case: EXIF preserved, Topaz action stamped
- [ ] 1 **Gigapixel** output if you use it separately from Photo AI
- [ ] 1 **Video AI** clip (short — 2-5 seconds is plenty) — tests MP4 modification detection
- *Looking for:* EXIF `Software` tag (`Topaz Photo AI 3.x` etc.), C2PA "edited" action, whether source manifest survived as an ingredient

---

## Audio

### ElevenLabs
- [ ] 1 **TTS** sample — default voice, short clip (~5–10s is plenty)
- [ ] 1 **Voice clone** sample — your cloned voice output
- [ ] 1 **Sound effect** sample
- [ ] 1 **Music** sample
- [ ] 1 in **MP3** and 1 in **WAV** (can overlap with the above — e.g. make the TTS sample MP3 and the SFX sample WAV). Different tag containers: ID3v2 for MP3, RIFF/BWAV chunks for WAV.
- *Looking for:* C2PA Content Credentials embedded in the file, ElevenLabs metadata tags

### Adobe Audition (Enhance Speech), *if you use it*
- [ ] 1 sample — any speech clip processed through Enhance Speech
- *Looking for:* C2PA with Adobe "enhanced" action

---

## Fallback / edge cases

### "Stripped" metadata
- [ ] 1 screenshot / phone photo of an AI image on your screen
- [ ] 1 image that's been through a screenshot + crop tool (macOS Preview, Windows Snipping Tool)
- *Looking for:* parser falls through to EXIF-only / "unknown platform" path without crashing

### Hand-edited metadata
- [ ] *(skip unless convenient)* 1 image where EXIF has been stripped by a tool like ImageOptim or Squoosh — simulates sharing through Discord/Slack/etc.

---

## What to do with them

- Make a folder structure under `test-fixtures/` as you go — e.g. `test-fixtures/firefly/photoshop-generative-fill.png`, `test-fixtures/elevenlabs/tts-default-voice.mp3`.
- File names don't matter much; just keep them distinct so it's clear what each is.
- Once you have a handful per platform, tell me and I'll wire them into the test suite. We don't need the full list complete to start — even one platform's worth lets me build out the fixture-loading pattern.

## Licensing / commit note

If fixtures are all your own generations (Firefly, Freepik, ElevenLabs outputs from your accounts) they're safe to commit. For anything you're unsure about (e.g. a MidJourney image where the terms are murkier, a Meta-AI image that's effectively "yours" but on a platform with vague IP terms), drop them in and we can decide commit vs. gitignore per-file when we build the harness.
