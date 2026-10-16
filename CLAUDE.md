# Madloop — start here

The one file to read before working on Madloop. It covers what Madloop is, how it is built, the
rules, Tim's decisions so far, how to test and release, and what is still open.

## What it is

A free, open-source web page that turns any video clip into a seamless loop and exports it:
**drop a clip → pick how it loops → trim → export.** It grew out of the looping tools in Madblur's
Media layer (Madblur: Tim's Mac app, a visual synthesizer for looping animation, madblur.com) and
exists to get a useful tool to the people who saw those tools on X, and to point them at Madblur.

- **Owner: Tim Grove, a designer, not an engineer.** Plain language, give a recommendation rather
  than a survey, and keep the project something he can run without a toolchain.
- **Madloop shares no code with Madblur** and never has to stay in step with it. It started as a
  port of Madblur build 458's parts; Tim may cherry-pick ideas back (see "Back to Madblur").
- The original brief: `Gradient Mesh Generator/docs/drafts/madloop-brief.md` (Madblur project).

## Rules

1. **No build step, no toolchain.** Plain HTML, CSS and JavaScript, loaded as classic scripts, so
   it runs from any static server. Libraries are vendored as single files in `vendor/`.
2. **Nothing leaves the computer.** The clip is read where it sits on disk; nothing is uploaded,
   no analytics, no network calls beyond the page's own files.
3. **Never touch the user's file.** Exports are always new files. (The HEVC fix below changes a
   copy assembled in memory from slices of the file, never the file.)
4. **Ship nothing Tim has no rights to.** The Pexels clips from Madblur's loop lab are test material
   only; they live outside the repo and `.gitignore` blocks video files. Every library and font
   keeps its licence file next to it.
5. **Madblur's UI is the source.** New UI is ported from the newest Madblur build
   (`Gradient Mesh Generator/builds/madblur_NNN.html`), skin copied rule for rule. Where the brief
   or the loop lab disagree with Madblur, Madblur wins. Tim's Figma: MadBlur file, node 459:615.
6. **Git:** commit only when Tim asks. The repo is https://github.com/tim-grove/madloop (public,
   `main`); Tim pushes (HTTPS, a token in his Keychain). No secrets in the repo. The folder lives in Dropbox (Tim's call): never create git worktrees here.
7. **Release notes** (CHANGELOG.md): short, one line per change, technical, no internal language.

## Tim's decisions (2026-10-15/16)

- Timeline 30 s by default; **Loop seconds** is adjustable and the export is that long.
- Exports are **silent**. H.264 MP4, H.265 MP4 (only where the browser can encode it), PNG
  sequence (folder in Chrome/Edge, else .zip). No watermark. Full source resolution by default;
  **Resize** on the Export tab (Preset + Resolution W × H, Madblur's Canvas rows) scales down only,
  keeping the clip's shape (`doc.outW`, 0 = original; reset on each import).
- Tabs: **Loop** (clip controls above the looping controls), **Export**, **About** (Tim's Figma
  MadBlur 464:1165: a 570px black box with a 2px Madblur-orange border over a dark overlay; the
  Madblur wordmark with the LOOP stamp, the build, three short paragraphs, link columns GitHub /
  Tim Grove (X, Instagram) / Madblur (X, Instagram), credits). It has no close button by design:
  any click that isn't on a link closes it, as do Esc and the About tab.
- **Versioning: an ascending build number, as Madblur does** (`BUILD` in app.js, shown as
  "Madloop Build 0001"). Not x.y.z: Tim's call, it matches how we work.
- Header exactly as the Figma, including "MADBLUR VISUAL SYNTHESIZER": "This is style my friend".
- Methods: No loop, Bounce, Crossfade (default), Patterned dissolve. **Removed, do not bring back:**
  Hold frame, Speed fit, Match cut, Fade through, demo clips, the "Made by…" footer, the
  explanatory hints under the clip and the method, the timeline's Zoom and Quality menus (the
  preview always fits, at full quality), the Export tab's summary and status text (progress and
  time left show under Pong's bar; saved / cancelled / failed show as a toast), Pong's fps meter.
- Exports are named `<clip name>_Madloop.mp4` (PNG: folder or .zip of that name), Tim's call.
- Desktop first: phones get "works best on a computer" with "Try it anyway".
- Licence MIT for the code; the names Madloop/Madblur and their artwork stay Tim's.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page: sidebar (header, tabs, Loop and Export panels), stage, timeline, Pong, About box |
| `style.css` | Madblur's skin copied rule for rule (top), then Madloop's additions (`MADLOOP` section at the end) |
| `app.js` | Everything else, in sections: state, loop maths, the blend shader, preview, reading clips, controls, Looping panel, timeline, export, boot |
| `pong.js` | Madblur's render-screen Pong, without its fps meter; also defines `$` used by app.js (loads first) |
| `vendor/mediabunny-1.61.0.min.js` | Mediabunny (MPL-2.0), reads and writes MP4/MOV/WebM over WebCodecs. Unmodified; licence beside it |
| `fonts/` | IBM Plex Mono, Geist, DSEG7, Visitor, each with its licence. See `fonts/README.md` |
| `assets/loop-stamp.png` | The LOOP stamp from the Figma (512×288, shown stretched to 170×68 in the header and 230×92 in About, rotated −15.67°, as designed) |
| `assets/share-card.png` | The link preview card (1200×630, Tim's Figma MadBlur 464:1172), named in the `og:` / `twitter:` tags in index.html. X and others cache it per URL: if it changes, give the file a new name |
| `assets/madblur-wordmark.svg`, `icon-*.svg` | About screen artwork from the Figma (the icons are inlined into index.html with `currentColor`) |
| `tools/` | Test tools, never loaded by the page: `serve.py`, `test-helpers.js`, `unpack-lab-clips.py` |
| `_headers`, `wrangler.jsonc`, `.assetsignore` | Cloudflare: response headers, deploy settings, what stays off the site |
| `.claude/launch.json` | The two local servers (8411 Madloop, 8412 test clips); gitignored |

## How it works

**The loop maths** (`mediaSection`, `mediaClipTimes`, `mediaLoopInfo`) is Madblur's, verbatim, with
the same parameter names (`P.secIn`, `secOut`, `secAuto`, `loops`, `nlSpeed`, `nlFit`, `loopMode`,
`ease`, `xf`, `pat*`). `tL` is how far through the timeline (0..1); it returns the clip time `tA`,
and in a dissolve the partner time `tB`, its weight `w` and progress `r`. Section length × Loops ÷
Speed = Loop seconds. Only the user's drag changes the section; Speed steps between the speeds
that give whole loops. `loopMode` numbering is Madblur's: 0 No loop, 1 Speed fit (hidden),
2 Bounce, 3 Crossfade, 4 Hold frame (hidden), 5 Patterned dissolve.

**The blend** (`makeRenderer`, WebGL2): one shader for preview and export. Draws frame A, mixes
frame B over it in linear light (as Madblur composites); Patterned dissolve uses Madblur's
`mbPatLate` map so one region switches at a time.

**Preview** (Madblur builds 443–444): two hidden `<video>` elements. The playhead runs on the clock
but the picture snaps to the FPS grid and is drawn only when a new frame comes up (Madblur build 218,
its FPS cap), so the preview shows exactly the frames the export renders (`tick`, `tlFrame`).
Paused, every move of the playhead is a seek (`animNudge`); don't skip seeks by the clip's measured
frame rate (build 8 did, and a misread rate froze the picture between whole seconds). The clip's
rate (`clipFps`) is the median gap between its first ~120 frames, not Mediabunny's average. Below
10 fps, playback is drawn by exact jumps (`previewTimes`: `live` needs fps ≥ 10). While playing, each plays at
the rate the loop needs and is steered (playback-rate nudges); paused, it jumps. At a cut or join
the two copies swap places so there is no flash. **Bounce going backwards** can't be played by a
video element, so `RC` (the Bounce buffer) decodes ~1 s at a time just ahead of the playhead with
Mediabunny, at preview size (≤1280 px), into ImageBitmaps; the backward half plays from those
while the video waits parked at the section start. Measured 30 fps backwards on 4K iPhone HEVC
(was ~12). Frames are drawn upside down for the GPU and uploaded with `noFlip`, because WebGL
ignores FLIP_Y for ImageBitmaps.

**Export** (`runExport`, `serveFrames`): frame-exact. All clip times are known up front; each
stream (A, and B for dissolves) is cut into monotonic stretches. Forward stretches decode straight
through (`samplesAtTimestamps`); backward stretches are cut into windows of K frames (K sized to
~512 MB of frames, 2–24), each decoded forward and handed out reversed. Frames go to the GPU,
are blended, then to Mediabunny's `CanvasSource` (H.264/H.265 at `QUALITY_HIGH`, keyframe every
2 s) or `canvas.toBlob` (PNG). A resized export draws each frame into a 2D canvas at the output size
(`imageSmoothingQuality` high) before the GPU, since plain GPU sampling shimmers when scaling down. Chrome/Edge: `showSaveFilePicker` + `StreamTarget`, written as it
renders. Other browsers: `BufferTarget` in memory, then Pong's Download button. PNG .zip refuses
when it would pass ~1.6 GB. Timestamps get +0.1 ms so rounding never lands on the frame before.

**Colour and orientation.** The GPU upload of a frame ignores a clip's rotation tag (portrait
phone clips) and maps HDR colours lighter and greyer than the browser's own player. So rotated or
HDR frames are first drawn into a 2D canvas (Mediabunny's `draw` honours rotation; a 2D canvas
maps HDR exactly as the player does), then uploaded. Verified to match the player within 0.3/255.
HDR is exported in standard range.

**iPhone HEVC fix** (`hevcLeadFix`, Madblur build 442): some HEVC files mislabel the picture
after each open keyframe (RADL instead of RASL); decoders die after a jump. The fix relabels
those bytes in a Blob built from slices of the file (so any size works). None of Tim's four test
iPhone clips needed it; it's untested on a file that does.

**Caching.** `index.html` loads `style.css`, `app.js` and `pong.js` with `?v=<BUILD>`, so a
browser never pairs a new page with an old cached file. The About box is `hidden` by attribute
too, so it can never show unstyled.

## Releasing

Every build (any change Tim will see), not just public releases:

1. Raise `BUILD` by one and set `BUILD_DATE` at the top of `app.js`.
2. Change the three `?v=` tags in `index.html` to the same number.
3. Add a `## Build N — date` entry to `CHANGELOG.md`.
4. Test (below), then commit when Tim says so.

Hosting: a Cloudflare Worker (static assets only, no Worker code) connected to the GitHub repo,
at madloop.madblur.com (madblur.com is already on Cloudflare); also
madloop.wild-dream-6de6.workers.dev. A push to `main` redeploys (`npx wrangler deploy`).
`wrangler.jsonc` is its settings; `.assetsignore` keeps `.git`, `tools/`, `CLAUDE.md` and the
config files off the site (the first deploy, without it, published `.git`); `_headers` sets the
response headers, as madblur.com's does.

## Testing

Start the servers (`.claude/launch.json`, or by hand):

```
python3 tools/serve.py 8411 .                    # Madloop at http://localhost:8411/
python3 tools/unpack-lab-clips.py "<Madblur>/tools/loop-lab-clips.js" <folder outside the repo>
python3 tools/serve.py 8412 <that folder>        # test clips
```

In the browser console: `eval(await fetch('http://localhost:8412/…/test-helpers.js'))`, or paste
`tools/test-helpers.js`. Then `await __load('Waves.mp4')`, set `P` / `doc`, `await runExport('h264')`,
`await __analyse(__test.blob)`. A loop is seamless when `seam` ≈ `median`. `__toOPFS()` tests the
write-to-disk path; `__clearOPFS()` cleans up. `__makeRot()` makes a portrait (rotation 90) clip.

Code reviews: two independent read-only passes (every control traced to preview and export; edge
cases and failure paths) found the build-8 fixes. Repeat that before a public post.

Gotchas: when the Browser pane is hidden, requestAnimationFrame stops, so playback measurements
need a setTimeout loop that calls `previewTimes` / `view.R.draw` directly. Source clips have
their own keyframe "pumping" (bigger frame-to-frame jumps at their keyframes); don't mistake it for
a seam. Tim's iPhone clips are in ~/Downloads (IMG_*.MOV); the test server can't read Downloads
directly (macOS privacy), so copy one to the clip folder for the test, and delete the copy after.

Checklist before posting a link: iPhone HEVC (SDR and HDR, portrait), a screen recording, a web
H.264 MP4, a long 4K clip, a variable-frame-rate phone clip; Chrome and Safari on a Mac, Chrome on
Windows if possible. **So far only Chrome on a Mac has been tested.**

## Open items

- About's links are all set (`LINKS` in `app.js`); the share card is in. Still to do: the README's
  hard-cut vs seamless GIF.
- Visitor: `fonts/Visitor-README.txt` quotes Brian Kent's terms; swap in his original readme file
  if Tim has the font zip.
- Test Safari, Firefox and Windows; test an HEVC file that needs the lead fix.
- Cloudflare: add the custom domain madloop.madblur.com to the Worker (Tim, in the dashboard).
- No tab icon (favicon) yet.
- Known limits, left as they are (2026-10-16 review): in-memory exports (MP4 outside Chrome/Edge,
  any PNG .zip) have no size guard beyond the .zip estimate from frames 0–4, so a very long 4K export
  can exhaust a tab; a clip whose first timestamp isn't 0 (some WebM/TS) may be offset between the
  preview (`<video>` time) and the export (`t0`-based); a pinned Loops count survives trims and
  method changes (Madblur's behaviour).
- Later: ProRes needs a Mac app with a Swift helper (AVFoundation); not possible on the web.

## Back to Madblur (ideas Tim may cherry-pick)

- Madblur's preview has the same HDR colour problem (GPU upload of a video is lighter and greyer
  than the player); the 2D-canvas route fixes it.
- Madblur's Bounce preview has the same slow backward half; the `RC` buffer fixes it.
- Madblur embeds subset copies of IBM Plex Mono and DSEG, whose licences reserve their names for
  unmodified files.
