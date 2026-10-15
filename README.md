# Madloop

**Turn any video clip into a seamless loop.** Made by Tim Grove, maker of
[Madblur](https://madblur.com). Madloop grew out of the looping tools in Madblur's Media layer.

<!-- TODO: a short GIF here, a hard cut next to a seamless loop -->

Drop a clip, pick how it loops, trim, export. Everything happens in your browser: the clip is
read where it sits on your computer and nothing is uploaded.

## How it loops

- **Crossfade**: the end dissolves into the start.
- **Patterned dissolve**: a crossfade that switches one region of the frame at a time, as a
  sweep, a grid of shapes growing out of their centres, or drifting clouds.
- **Bounce**: plays forwards, then backwards. No cut, ever.
- **No loop**: plays straight through and cuts back to the start.

The **Section** strip picks the part of the clip in use: drag an end to trim, drag the middle to
slide. Speed and Loops sit under it: the section is played a whole number of times across the
timeline (30 seconds unless you change it), and Speed shows how much it had to be sped up or
slowed down to fit. Only your own drag ever changes the section.

## Export

- **MP4, H.264**: plays everywhere.
- **MP4, H.265**: smaller files. Shown only where your browser can encode it.
- **PNG sequence**: into a folder you pick (Chrome and Edge), or as a .zip.

Exports are at the clip's full resolution and have no sound. In Chrome and Edge the file is
written to disk as it renders, so length and size are limited only by your disk. Other browsers
build the file in memory first, which caps it at what the browser will hold (a gigabyte or two).

## Which browser

A recent **Chrome or Edge** on a computer works best, and is what Madloop has been tested in so
far. Safari and Firefox should work, with the limits above. Madloop needs WebCodecs and WebGL2. Phones are not the target.

What a browser can read varies: H.264 MP4 and MOV work everywhere; iPhone HEVC works in Safari and
in Chrome on a Mac; ProRes works in Safari on a Mac at best; WebM (VP9, AV1) works in Chrome, Edge
and Firefox. HDR clips are exported in standard range.

## Running it

It's a static page with no build step. Serve the folder with any static file server, for example
the one in `tools/` (it also stops the browser caching files while you edit):

```
python3 tools/serve.py 8411 .
```

then open http://localhost:8411. (Opening `index.html` straight from disk mostly works too, but
some browsers block parts of a page opened that way.)

## Files

- `index.html`, `style.css`: the page. The look is Madblur's.
- `app.js`: everything else: reading clips, the loop maths, the preview, the export.
- `pong.js`: the game you can play while an export renders (from Madblur).
- `vendor/`: [Mediabunny](https://mediabunny.dev) 1.61.0, which reads and writes the video files.
- `fonts/`, `assets/`: typefaces and the logo.
- `tools/`: a local server and test helpers. Not part of the page.
- `CLAUDE.md`: how it all works, for whoever maintains it next. `CHANGELOG.md`: what changed.

## Licence

Madloop's code is MIT licensed: see [LICENSE](LICENSE). The names Madloop and Madblur and their
artwork are not covered by it. Mediabunny is under the Mozilla Public License 2.0
([vendor/MEDIABUNNY-LICENSE.txt](vendor/MEDIABUNNY-LICENSE.txt); source at
https://github.com/Vanilagy/mediabunny). The fonts keep their own licences
([fonts/README.md](fonts/README.md)).

Made by one designer and updated when there's time. It comes as is, with no warranty and no promise of
support.
