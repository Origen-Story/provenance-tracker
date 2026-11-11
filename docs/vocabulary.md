# Standard vocabularies: IPTC digital source type and C2PA

Reference for naming origin classes and writing manifests. The tracker should use these terms where one fits and add its own only where none does. Both lists were read from the primary sources on 2026-11-11; definitions are verbatim.

- IPTC NewsCodes, Digital Source Type: <https://cv.iptc.org/newscodes/digitalsourcetype/>
- C2PA Technical Specification 2.2, actions and ingredients: <https://spec.c2pa.org/specifications/specifications/2.2/specs/C2PA_Specification.html>

## IPTC digital source type

How a piece of media was made. C2PA uses these as the `digitalSourceType` of an action, written as `http://cv.iptc.org/newscodes/digitalsourcetype/<code>`. The same codes appear unsigned in XMP as `Iptc4xmpExt:DigitalSourceType`.

| Code | Label | Definition |
|---|---|---|
| `digitalCapture` | Digital capture sampled from real life | The media was captured from a real-life source using a digital camera or digital recording device |
| `computationalCapture` | Multi-frame computational capture sampled from real life | The media is the result of capturing multiple frames from a real-life source using a digital camera or digital recording device, then automatically merging them into a single frame using digital signal processing techniques and/or non-generative AI. Includes High Dynamic Range (HDR) processing common in smartphone camera apps. |
| `negativeFilm` | Digitised from a transparent negative | The media was digitised from a negative on film or other transparent medium |
| `positiveFilm` | Digitised from a transparent positive | The media was digitised from a positive on a transparency or other transparent medium |
| `print` | Digitised from a non-transparent medium | The media was digitised from a non-transparent medium such as a photographic print |
| `humanEdits` | Human-edited media | Augmentation, correction or enhancement by one or more humans using non-generative tools |
| `compositeWithTrainedAlgorithmicMedia` | Edited using Generative AI | Augmentation, correction or enhancement using a Generative AI model, such as with inpainting or outpainting operations |
| `algorithmicallyEnhanced` | Algorithmically-altered media | Modification or correction by algorithm without changing the main content of the media, initiated or configured by a human, such as sharpening or applying noise reduction |
| `digitalCreation` | Digital creation | Media created by a human using non-generative tools |
| `dataDrivenMedia` | Data-driven media | Digital media representation of data via human programming or creativity |
| `trainedAlgorithmicMedia` | Created using Generative AI | Digital media created algorithmically using an Artificial Intelligence model trained on captured content |
| `algorithmicMedia` | Pure algorithmic media | Media created purely by an algorithm not based on any sampled training data, e.g. an image created by software using a mathematical formula |
| `screenCapture` | Screen capture | A capture of the contents of the screen of a computer or mobile device |
| `virtualRecording` | Virtual event recording | Live recording of virtual event based on Generative AI and/or captured elements |
| `composite` | Composite of elements | Mix or composite of several elements, any of which may or may not be generative AI |
| `compositeCapture` | Composite of captured elements | Mix or composite of several elements that are all captures of real life |
| `compositeSynthetic` | Composite including generative AI elements | Mix or composite of several elements, at least one of which is Generative AI |

Retired, do not write: `minorHumanEdits` (2024-09-17, use `humanEdits`), `digitalArt` (2024-09-17, use `digitalCreation`), `softwareImage` (2022-06-14, use a more specific term). A reader should still recognise them in old files.

C2PA 2.2 adds two source types of its own under `http://c2pa.org/digitalsourcetype/`:

- `empty`: Media whose digital content is effectively empty, such as a blank canvas or zero-length video.
- `trainedAlgorithmicData`: Data that is the result of algorithmically using a model derived from sampled content and data. Differs from the IPTC `trainedAlgorithmicMedia` in that the result isn't a media type (e.g., image or video) but is a data format (e.g., CSV, pickle).

A `c2pa.created` action records the nature of the asset at its inception and carries the source type. A `c2pa.opened` action needs none.

## C2PA actions

What was done to the asset. Entries of the `c2pa.actions` assertion. A standard manifest must start with `c2pa.created` or `c2pa.opened`.

| Action | Meaning |
|---|---|
| `c2pa.created` | The asset was first created. |
| `c2pa.opened` | An existing asset was opened and is being set as the parentOf ingredient. |
| `c2pa.placed` | Added/Placed one or more componentOf ingredient(s) into the asset. |
| `c2pa.removed` | A componentOf ingredient was removed. |
| `c2pa.edited` | Generalized actions that would be considered editorial transformations of the content. |
| `c2pa.edited.metadata` | Modifications to asset metadata or a metadata assertion but not the asset's digital content. |
| `c2pa.enhanced` | Applied enhancements such as noise reduction, multi-band compression, or sharpening that represent non-editorial transformations of the content. |
| `c2pa.addedText` | (visible) Textual content was inserted into the asset, such as on a text layer or as a caption. |
| `c2pa.adjustedColor` | Changes to tone, saturation, etc. |
| `c2pa.changedSpeed` | Reduced or increased playback speed of a video or audio track |
| `c2pa.converted` | The format of the asset was changed. |
| `c2pa.cropped` | Areas of the asset's digital content were cropped out. |
| `c2pa.deleted` | Areas of the asset's digital content were deleted. |
| `c2pa.drawing` | Changes using drawing tools including brushes or eraser. |
| `c2pa.dubbed` | Changes were made to audio, usually one or more tracks of a composite asset. |
| `c2pa.filtered` | Changes to appearance with applied filters, styles, etc. |
| `c2pa.orientation` | Changes to the direction and position of content. |
| `c2pa.published` | Asset is released to a wider audience. |
| `c2pa.redacted` | One or more assertions were redacted |
| `c2pa.repackaged` | A conversion of one packaging or container format to another. Content is repackaged without transcoding. This action is considered as a non-editorial transformation of the parentOf ingredient. |
| `c2pa.resized` | Changes to either content dimensions, its file size or both |
| `c2pa.transcoded` | A conversion of one encoding to another, including resolution scaling, bitrate adjustment and encoding format change. This action is considered as a non-editorial transformation of the parentOf ingredient. |
| `c2pa.translated` | Changes to the language of the content. |
| `c2pa.trimmed` | Removal of a temporal range of the content. |
| `c2pa.unknown` | Something happened, but the claim_generator cannot specify what. |
| `c2pa.watermarked` | An invisible watermark was inserted into the digital content for the purpose of creating a soft binding. |

Deprecated: `c2pa.color_adjustments` (use `c2pa.adjustedColor`).

## C2PA ingredient relationships

| Relationship | Meaning |
|---|---|
| `parentOf` | The current asset is a derived asset or asset rendition of this ingredient. This relationship value is also used with update manifests. |
| `componentOf` | The current asset is composed of multiple parts, this ingredient being one of them. |
| `inputTo` | This ingredient was used as input to a computational process, such as an AI/ML model, that led to the creation or modification of this asset. |

## How the tracker uses them (decision D11)

The tracker's origin class is the IPTC code itself. Labels are the tracker's own, chosen to be plain. The left column is the spectrum position, which sets the colour.

| Spectrum position | Class label | IPTC code | In the picker's short list |
|---|---|---|---|
| Camera-captured | Captured | `digitalCapture` | yes |
| | Captured (multi-frame) | `computationalCapture` | no, kept when a device declares it |
| | Scanned | `print` | yes |
| | Scanned from a negative | `negativeFilm` | no |
| | Scanned from a transparency | `positiveFilm` | no |
| | Composite, camera only | `compositeCapture` | yes |
| | Human-edited | `humanEdits` | no |
| Digital, no AI | Rendered from code | `algorithmicMedia` | yes |
| | Human-made | `digitalCreation` | yes |
| | Screen capture | `screenCapture` | yes |
| | Virtual event recording | `virtualRecording` | yes |
| | Data-driven | `dataDrivenMedia` | no |
| AI-assisted | AI-enhanced | `algorithmicallyEnhanced` | yes |
| | any "Digital, no AI" class with the AI-assisted flag | unchanged | flag |
| Hybrid | Edited with generative AI | `compositeWithTrainedAlgorithmicMedia` | yes |
| | Composite with AI | `compositeSynthetic` | yes |
| | Composite | `composite` | no |
| Fully synthetic | AI-generated | `trainedAlgorithmicMedia` | yes |
| Unknown | Unknown | none | yes |

Three things the IPTC list does not cover are attributes of an asset, not classes:

- **Signed by.** Nobody, the capture device, the tool that made the file, or the creator at ingest. A class says how the media was made; a signature says who vouches for that.
- **From an archive.** Custody and age, not a way of making media. The colour follows how the material was made: a scanned print is camera-captured, an upscale of it is AI-assisted.
- **AI-assisted.** An AI model wrote the instructions (code, a design file) and an ordinary program made the pixels. `algorithmicMedia` assumes no trained model was involved and `digitalCreation` assumes a human with non-generative tools, so code written by an AI and rendered deterministically fits neither exactly. The tracker keeps the class that describes the pixels and adds the flag, which moves the asset from "Digital, no AI" to "AI-assisted". The flag is narrow: it is for a model authoring the instructions, not for general help along the way.

### What real tools write

Read from files in a test project on 2026-11-11. Tools apply the terms loosely, so the tracker stores what the file says and decides the spectrum position itself.

| Tool | What it declares | How the tracker reads it |
|---|---|---|
| Google Pixel 10 Pro, video | `c2pa.created` with `computationalCapture` | Captured, signed by the device |
| Adobe Firefly, video | `c2pa.created` with C2PA `empty`, then `c2pa.edited` with `compositeWithTrainedAlgorithmicMedia` | AI-generated: nothing but the model filled the canvas |
| ElevenLabs, audio | `c2pa.created` with `trainedAlgorithmicMedia` | AI-generated |
| Adobe Premiere Pro, export | `c2pa.created` with `compositeWithTrainedAlgorithmicMedia`, then `c2pa.placed` per ingredient | Composite with AI: it has placed ingredients, so it is a composite, not one edited asset |

### Palette

One colour per spectrum position, as CSS custom properties in `src/client/app.css`. The defaults below are the dark theme; a light theme and any downstream brand override the same six names.

| Position | Custom property | Dark default |
|---|---|---|
| Camera-captured | `--pt-origin-captured` | `#5cb88a` |
| Digital, no AI | `--pt-origin-digital` | `#a8d0ba` |
| AI-assisted | `--pt-origin-assisted` | `#d4a054` |
| Hybrid | `--pt-origin-hybrid` | `#5a9fd4` |
| Fully synthetic | `--pt-origin-synthetic` | `#a264ef` |
| Unknown | `--pt-origin-unknown` | `#888888`, drawn as a hatch |

Green tones mean no generative AI, and lightness separates camera from digital. Two positions playing at once are drawn as diagonal stripes in both colours. Purple was chosen over red for fully synthetic so that no colour reads as a verdict.
