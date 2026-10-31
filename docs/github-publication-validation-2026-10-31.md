# GitHub publication validation — 2026-10-31

The final synthetic demonstration media passed the privacy checks described here, with no findings in the checked categories. This records the publication preparation and the exact media files inspected. It does not certify complete UI parity or provide a mathematical guarantee that no private information exists.

## Publication build and tests

After the test fixtures were anonymized, the current source passed these checks in a Node.js 24.11 environment:

| Command | Result |
| --- | --- |
| `npm test` (`vitest run`) | 210 test files; 1,663 tests passed; 16.86 seconds |
| `npm run typecheck` | Both `typecheck:node` and `typecheck:web` passed |
| `npm run build` | Passed |

These are publication checks of the source after fixture anonymization. The historical native application validation for the 503-source freeze remains attributed to its original source hashes and package. That native freeze was not rerun for this publication, and its results must not be presented as validation of the anonymized source. The earlier frozen native evidence remains documented in [ui-element-parity-2026-10-31.md](ui-element-parity-2026-10-31.md) and [source-validation-current.md](source-validation-current.md).

## Publication text review

The pre-stage review enumerated tracked and unignored publication candidates with `git ls-files --cached --others --exclude-standard`: 626 files, comprising 606 UTF-8 text files and 20 binary files. There were no missing files or symbolic links. Private raw recordings, ignored files, and Git history were outside this text review. The newly added report was outside that 626-file snapshot; the final media were inspected separately as described below.

Pattern checks found no internal organization/domain markers, RFC1918 addresses, recognizable credentials, or remaining actual process IDs or UUIDs in the public documentation and evidence. Test fixtures, redacted placeholders, scoped package/plugin identifiers, SSH test data, and the authorized public identity were reviewed as context rather than treated as personal disclosures. Two apparent home-path matches in documentation were confirmed to be relative source-file references containing an application directory name, rather than personal account directory paths; no edits were needed for those references.

Publication anonymization replaced 34 collected process-ID locations and one remaining English process-ID reference, seven fixture UUID occurrences, and nine private IPv4 occurrences with placeholders or documentation/test data. A further real public upstream maintainer contact was removed from one dependency deprecation message in `package-lock.json`; dependency versions and integrity values were retained. The reviewed text candidates had no remaining confirmed private-information findings after that removal. The text patterns and semantic review have the limits stated below.

## Final media coverage

AVFoundation decoded every frame of the final MP4. Apple Vision performed OCR on all 1,050 frames at their presentation timestamps, covering the 35-second, 1920×1200, 30 fps file. The reader completed successfully; decoding and OCR errors were zero. Eight additional still frames spanning the conversation, workspace, source editing, and closing card were visually inspected.

ImageIO decoded all 263 frames of the final 960×600 GIF, and Apple Vision performed OCR on every frame. The GIF's recorded frame delays total 35.06 seconds. Decoding and OCR errors were zero; the first, middle, and last frames were also visually inspected.

All four final PNG images were visually inspected and OCR-scanned at their full image dimensions. Their decoding and OCR errors were zero.

The checked text categories were personal account directory paths, internal organization or domain markers, email addresses, recognizable credential formats, RFC1918 IPv4 addresses, and unapproved temporary paths. The deliberately fictional Orbit Notes workspace and the authorized public `keriae` identity were treated as demonstration content. There were no findings requiring removal or a video time range to be cut.

## Metadata checks

The final MP4 has no audio track, author/creator fields, or identity/location metadata fields. AVFoundation's exposed metadata and three auxiliary ISO BMFF payloads were checked for the sensitive text categories. The atom walk parsed 31 atoms with zero parser errors and no findings.

The GIF's container and per-frame ImageIO metadata were checked field by field: 526 nonempty string fields produced no sensitive findings or nonpublic author fields. A separate binary extension parse found 263 image blocks, 263 graphic-control extensions, one application extension with 14 bytes of payload, and no comment or plaintext extensions. Extension parsing errors and sensitive findings were zero.

Each PNG's ImageIO metadata had no author/creator/artist or identity/location fields and no sensitive findings. A separate PNG chunk walk found no `tEXt`, `zTXt`, or `iTXt` payloads in the four images, with zero parser errors.

The source clips used for the composition have no audio tracks or author, identity, or location metadata. Each retained one generic encoder field with no sensitive values. The original private MOV recordings were not used as publication artifacts; their nonpublic author metadata was excluded by the source transcode.

## Inspected final files

Hashes were checked against the final files, and the MP4, GIF, and PNG files remained unchanged during their respective checks.

| File under `docs/media/` | Bytes | Dimensions | SHA-256 |
| --- | ---: | --- | --- |
| `codex-replica-promo.mp4` | 752527 | 1920×1200 | `ce0d77f9604ed192437ab681ee4b48fd91a7ca972b8b8f586d92df68189bc3da` |
| `codex-replica-promo.gif` | 1196220 | 960×600 | `709a261f03ca26f8a07e65921b1528a65b87bf5c483c19ff0b0a867b9a60aede` |
| `codex-replica-poster.png` | 106752 | 1920×1200 | `35b598133c3326c3532f96e46d6f0a86b91532fe6cf00ae8d3404a3c9199fa04` |
| `codex-replica-parity.png` | 408902 | 1920×1200 | `69836e5f80ff175693dcab90c3e2456091221623efb043dac6b1d2275d4642df` |
| `github-social-preview.png` | 140667 | 1280×640 | `a1794e8eaf367855a60e155cc69e43bef17682a10584c623ed71177e8a88973c` |
| `codex-app-preview.png` | 309371 | 1600×1014 | `880431f77a1df87e8241852a8535d3c56cdbc6f01a2c42ff4329df8cde332dc7` |

## Source clip coverage

The three public source clips were matched to the private recordings at half-second intervals plus their final frames: 177 frame pairs in total. Their mappings were 8–28 seconds for live conversation, 20–55 seconds for the workbench, and 20–52 seconds for editing. Comparison used 96×64 grayscale samples and mean absolute error normalized by the maximum pixel value. There were no decoding failures; every pair's normalized error was below 0.162%. The recordings had already undergone OCR throughout their durations at half-second intervals. The six source-clip start/end frames were additionally inspected visually and with OCR, with no sensitive findings.

The source clips were sampled at half-second intervals, rather than independently OCR-scanned frame by frame. The final composed MP4 and GIF received the complete frame coverage stated above.

| File under `promo/public/` | Bytes | Duration | SHA-256 |
| --- | ---: | --- | --- |
| `codex-replica-live.mp4` | 175069 | 20 seconds | `4f86b791101339af6c27ffa97ffcc9f976ea9ab8bcd00ebb1136f23b0f613f90` |
| `codex-replica-workbench.mp4` | 526107 | 35 seconds | `4dacc4dab5be0fbaac1d6c8c27e3a758328f40a1ca1862876e6427d185a63316` |
| `codex-replica-edit.mp4` | 282258 | 32 seconds | `6a08963ed130d15f2088b3f1584e9046db042127247dc081f1aff06b77d7d2ab` |

## Limits

OCR can miss small, low-contrast, distorted, or partly obscured text. Pattern checks recognize defined formats; they cannot identify every possible name, secret, or contextual disclosure. Manual inspection covered selected video frames and every final still image, not every video frame. Metadata checks covered the described standard fields and auxiliary payloads; they are not a steganography analysis.

“No findings” means these checks found no private information in their stated scope. It is not proof of the universal absence of private information. This report also does not replace a native application/package validation or establish complete fidelity to the original application.
