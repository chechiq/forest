# Mobile / Apple rendering update — 2026-11-17

## Changes

- Phones: opaque two-frame shader with subtle depth drift and the original zoom sequence. No cutout masks, flow render targets, mipmap blur or foreground stacks.
- Mobile images: 1536px colour / 512px depth, pre-sized on disk. Portrait download 2.33 MB; estimated RGBA texture allocation 46.66 MiB excluding canvas/browser overhead. 14 images plus the shared empty texture (15 GPU textures observed).
- 30 FPS mobile rendering cap; 650k pixel budget, DPR at most 1.25. Native touch scrolling, no forced section snap. Whole-line typography instead of 151 animated letters and SVG filters.
- Canvas dimensions come from the same stable large viewport used by CSS, avoiding Safari toolbar stretching and repeated drawing-buffer reallocations.
- Macs use the compatible opaque shader and regular image decoding with original-resolution images. Desktop typography, Lenis and a 60 FPS target remain; budget 2 MP. MacIntel includes Apple Silicon Macs. Windows desktop keeps the original renderer.
- Two potentially negative-base GLSL `pow(x, 2.0)` expressions now use `x * x`. Negative-base pow has undefined results: https://github.khronos.org/Vulkan-Site/glsl/latest/chapters/builtinfunctions.html
- Versioned CSS, main entry and original shaders prevent an older cached shader from being mixed with the update.

## Validation

- Node syntax checks on all JS modules; `node tools/render-profile.test.mjs`.
- `python tools/mobile-assets.py`: all 16 committed textures decode, dimensions/aspect ratios and mobile download/memory budgets pass. `--build` regenerates them with Pillow.
- Chromium local preview at 390x664 and 320x568: capsule renders without black holes, no horizontal overflow, navigation and all seven scenes checked. Final exit returns to 0%.
- Live rotation to 844x390 checked. Desktop at 1280x800 retains Lenis and 151 split letters.
- Local mobile render diagnostic observed 29.7 FPS, 15 GPU textures. This is desktop Chromium with a phone-sized viewport, **not an iPhone hardware benchmark**.
- `?compat&debug` previews the Apple-compatible renderer on other computers; `?debug` exposes render FPS and texture count in the canvas data attributes.

## Limits

Actual iPhone 12 Safari / Telegram webview and M1 hardware are not available in this workspace. The exact original Apple artifact has not been reproduced locally; the undefined shader operations were corrected and the complex rendering path bypassed on Apple. A real-device visual/performance check remains necessary.
