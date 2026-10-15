"""Serve a folder for testing Madloop, telling the browser never to cache (so an edited file is
always picked up) and allowing other local pages to fetch from it (the test clips).

    python3 tools/serve.py 8411 .            # Madloop itself:  http://localhost:8411/
    python3 tools/serve.py 8412 ~/clips      # a folder of test clips for tools/test-helpers.js
"""
import sys, http.server, functools

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8411
root = sys.argv[2] if len(sys.argv) > 2 else '.'
print(f'Serving {root} at http://localhost:{port}/')
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Handler, directory=root)).serve_forever()
