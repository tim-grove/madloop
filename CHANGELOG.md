# Changelog

One entry per build, newest first. Builds are numbered upwards, as Madblur's are.

## Build 10 — 2026-10-16

- Madblur's X account is @MadBlurSynth: the About link and the share card's `twitter:site` now point there (were @madblur1).

## Build 9 — 2026-10-16

- Below 10 fps, playback draws each frame by a jump to its exact time (both copies), so it matches the export; at 1 fps the incoming copy of a dissolve used to trail by about 0.2 s.
- The paused preview seeks on every move. Build 8 skipped seeks within one source frame, counted with the clip's measured frame rate, so a misread rate could freeze the picture between frames.
- The clip's frame rate is read from the typical gap between its first frames (the median), not the average, which a held frame (title card, still screen recording) dragged down: a clip opening on a 6 s hold read 12 fps, now 30.

## Build 8 — 2026-10-16

- FPS now shows in the preview: playback steps at the chosen rate and shows exactly the frames the export renders (Madblur build 218). Before, FPS only changed the export.
- Share card for links (Open Graph / X `summary_large_image`), from Tim's Figma (MadBlur 464:1172).
- After a full code review:
  - Typing junk into a value box (Loop seconds, any method setting) restores the previous value instead of setting 1 s or breaking the loop; out-of-range values show what was applied.
  - Paused frame stepping at high FPS always shows the right frame (it skipped some at 60 fps).
  - Space and ← → drive the timeline even after a slider was touched; Speed and Loops thumbs settle on the applied value.
  - Scrubbing to the right end stays on the last frame; the timecode counts frames correctly at 29.97; Play does nothing without a clip; a click on the section no longer turns off the automatic section.
  - The Loop tab is locked while exporting, and the export uses the settings it started with.
  - The render-complete screen can be closed without downloading (Esc or the Export tab's Cancel).
  - Cancelling an MP4 export in Chrome leaves a file you chose to replace untouched; failed or cancelled exports release their decoders.
  - The export checks the encoder can take the chosen size before starting.
  - Replacing a clip with one of another shape no longer squashes the preview, and no longer flashes the old clip.
  - Bounce on variable-frame-rate clips (screen recordings) no longer decodes the same second over and over; dragging the section while Bounce plays keeps the file open.
  - Odd-sized clips (e.g. 1081 px) lose their last row at Original instead of being softened by a 1 px stretch.
  - .zip: UTF-8 file names; more than 65,535 frames refused up front. Folder PNG writes clean up after a failed write.
  - HEVC check: hardened against unusual files. The preview rebuilds itself if the graphics card drops its context.

## Build 7 — 2026-10-16

- Exports are named after the clip with `_Madloop` added: `IMG_1164.MOV` → `IMG_1164_Madloop.mp4` (PNG: a `IMG_1164_Madloop` folder or .zip). Only characters a file name can't hold are replaced.
- Pong: the frame-rate meter in the corner is gone.

## Build 6 — 2026-10-16

- Export tab: the summary and status text are gone. Progress and time left show under the render screen's bar; saved, cancelled and failed show as a notice.

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
