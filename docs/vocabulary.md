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

## Where the tracker's classes sit today

Not a decision; the starting point for one. The IPTC list answers one question, how the media was made. It has no term for who signed a file or for material being archival, so those two ideas are the tracker's own.

| Tracker class (D3) | Nearest standard term | Fit |
|---|---|---|
| `captured_signed` | `digitalCapture` or `computationalCapture` | The source type is the same as `captured`. "Signed" is about who vouches, which the vocabulary does not cover. |
| `captured` | `digitalCapture` | Exact. |
| `archival` | `negativeFilm`, `positiveFilm`, `print`, or `digitalCapture` | No single term. Archival describes custody and age, not how the media was made. |
| `archival_enhanced` | `algorithmicallyEnhanced`, action `c2pa.enhanced` | Exact when the enhancer does not change the main content. A generative upscaler that invents detail is `compositeWithTrainedAlgorithmicMedia`. |
| `generated` | `trainedAlgorithmicMedia` | Exact. |
| `composited` | `composite`, `compositeCapture`, `compositeSynthetic` | The standard splits one class into three by what the ingredients are; the composition view can compute which applies. |
| `unknown` | none | Absence of a claim. |
| not yet a class: graphics rendered from code | `algorithmicMedia` | Exact. Charts driven by data are `dataDrivenMedia`. |
| not yet a class: titles and graphics made by hand in an editor | `digitalCreation` | Exact. Timeline generator clips are this. |
| not yet a class: screen recordings | `screenCapture` | Exact. |
