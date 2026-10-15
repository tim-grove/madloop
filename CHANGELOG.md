# Changelog

One entry per build, newest first. Builds are numbered upwards, as Madblur's are.

## Build 2 — 2026-10-16

- About: links to Tim Grove on X and Instagram, and Madblur on Instagram.
- About: a click anywhere but a link closes it.

## Build 1 — 2026-10-16

First build, not yet public.

- Import any clip the browser can decode (H.264, HEVC, VP9, AV1; MP4, MOV, WebM), read in place, nothing uploaded.
- Looping methods from Madblur: No loop, Bounce (with Easing), Crossfade, Patterned dissolve (Sweep, Centre out, Clouds).
- Section strip with filmstrip, trim handles and slide; Speed and Loops tied to Loop seconds (30 s default).
- Preview plays two copies of the clip and swaps them at each join; Bounce plays backwards from a decoded buffer at full frame rate.
- Frame-exact export: H.264 MP4, H.265 MP4 where supported, PNG sequence to a folder (Chrome, Edge) or .zip. Silent, full resolution.
- Chrome and Edge write exports to disk as they render; other browsers build them in memory.
- Portrait (rotated) clips and HDR clips match the browser's own player in preview and export.
- iPhone HEVC leading-picture fix from Madblur build 442, applied to a copy built from slices of the file.
- Tabs: Loop, Export, About. About screen from Tim's Figma, showing the build number. Pong while exporting. Phones get a "works best on a computer" notice.
- Fonts shipped as unmodified originals where their licence reserves the name (IBM Plex Mono, DSEG7).
