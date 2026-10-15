# Changelog

One entry per build, newest first. Builds are numbered upwards, as Madblur's are.

## Build 5 — 2026-10-16

- Export: Resize, with a Preset menu (Original and the common sizes below it) and Resolution W × H. Starts at the clip's own size; keeps the clip's shape; never scales up.
- Resized frames are scaled in a 2D canvas at high quality before the blend, so fine detail doesn't shimmer.
- The timeline's Zoom and Quality menus are gone: the preview always fits the stage, at full quality.

## Build 4 — 2026-10-16

- About: the GitHub link points at github.com/tim-grove/madloop.
- Importing a second clip while the first is still being read keeps the second.
- A failed export no longer leaves an empty file where it was to be saved.
- Hosting on Cloudflare: `wrangler.jsonc`, `.assetsignore` (keeps `.git`, `tools/` and notes off the site) and `_headers` (nosniff, no referrer, no framing), as madblur.com.
- Tidying: one resize watcher for the Section strip, a dead style removed.

## Build 3 — 2026-10-16

- The playhead starts paused.
- The About tab shows pressed while the About screen is open.

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
