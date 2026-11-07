# Third-party notices

## Three.js

- Source: https://github.com/mrdoob/three
- Vendored release: 0.186.1
- Files: `dist/vendor/three.core.js`, `dist/vendor/three.module.js`, and `dist/vendor/addons/`.
- License: MIT. The complete license is retained in `dist/vendor/LICENSE`.

## Google Draco

- Source: https://github.com/google/draco
- Decoder distribution: the Draco decoder bundled with the Three.js release above.
- Files: `dist/vendor/draco/draco_decoder.js`, `draco_decoder.wasm`, and `draco_wasm_wrapper.js`.
- License: Apache License 2.0. The complete license is retained in `dist/vendor/draco/LICENSE`, obtained from the upstream project's `LICENSE` file.

These notices describe third-party components only. They do not grant an additional license to the island scene, models, or application authored for this project.

## Shambling Ghoul surfer

- Model: [Shambling Ghoul](https://polyfork.dev/asset/shambling-ghoul-256f2f) by Polyfork.
- Files: `dist/public/assets/shambling-ghoul-256f2f.glb` and its parameter/provenance JSON.
- License: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/); see [Polyfork licensing](https://polyfork.dev/licensing).
- Changes: regenerated with the official youngest preset `age: "kid"` and default `build: 1.0`, retaining the original palette and costume; rounded conforming head, `bean` eyes, `warm` expression, increased body segments and smooth skin/hair normals, with the named skeleton and skinning preserved. Normalized to island scale. Original local skeletal poses provide walking, wading, swimming, jumping onto the board, surfing and return motions; two-bone leg IK plants the surfing feet. The source GLB has no embedded clips; no external animation library is bundled. The licensed generator source is not distributed with this website. Exact parameters and asset checksum are recorded in the provenance JSON.
- The surfboard geometry, board graphics and surfing controller are authored locally for this project.

## Ambient field recordings

`dist/public/audio/surf-cheer.mp3` is adapted from [Voice_Crowd_Small_Expression_Cheer_Stereo](https://freesound.org/people/Nox_Sound/sounds/752708/) by Nox_Sound, available under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The publicly accessible HQ MP3 preview was filtered, faded and re-encoded for a quiet, locally bundled surf event; it is not the original uncompressed download.

`dist/public/audio/island-ambience.mp3` mixes three CC0 1.0 recordings from Freesound:

- SamsterBirdies, [Calm ocean waves](https://freesound.org/people/SamsterBirdies/sounds/578524/).
- DaveGould, [Seagulls-M.wav](https://freesound.org/people/DaveGould/sounds/32930/).
- blaastaal, [murmuring](https://freesound.org/people/blaastaal/sounds/766658/).

See [audio source and editing notes](dist/public/audio/SOURCES.md) and the [CC0 1.0 dedication](https://creativecommons.org/publicdomain/zero/1.0/).

## Tapati Dancer character

- Model: [Tapati Dancer](https://polyfork.dev/asset/tapati-dancer-5557aa) by Polyfork.
- Files: `dist/public/assets/tapati-dancer-young-medium.glb` and its parameter/provenance JSON.
- License: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/); see also [Polyfork licensing](https://polyfork.dev/licensing).
- Changes: baked with the official options `age: "teen"`, `build: 1.0` (the medium/default frame girth), and the original feminine figure, palette and costume. The head is rebuilt with rounded contours, `bean` eyes, a `warm` expression and refitted headwear; limb/torso/neck segments are increased to 16/20/12 and skin/hair normals are smoothed. Runtime code scales and grounds the model, drives island navigation, and supplies adapted free-arm walking and original breathing/look-around idle transitions. The licensed generator source is not distributed with this website.
- Animation source: the included `Walk` from [Dragon Slayer](https://polyfork.dev/asset/dragon-slayer-91ab39), also by Polyfork under CC BY 4.0. Hip translations are retargeted to the new proportions; runtime arm poses are adapted for an unarmed character. The former character mesh is no longer part of the website. No complete external animation pack is bundled.
