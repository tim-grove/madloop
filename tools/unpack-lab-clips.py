"""Unpack the five Pexels test clips from Madblur's loop lab into a folder OUTSIDE this repo.
They were downloaded for testing only and must never be committed (.gitignore also blocks .mp4).

    python3 tools/unpack-lab-clips.py "<Madblur>/tools/loop-lab-clips.js" ~/madloop-test-clips
"""
import sys, json, base64, os

src, out = sys.argv[1], os.path.expanduser(sys.argv[2])
os.makedirs(out, exist_ok=True)
text = open(src).read()
for c in json.loads(text[text.index('['):text.rindex(']') + 1]):
    open(os.path.join(out, c['name'] + '.mp4'), 'wb').write(base64.b64decode(c['b64']))
    print(c['name'], c['dur'], 's')
