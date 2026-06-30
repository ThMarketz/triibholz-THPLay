#!/usr/bin/env python3
"""Tiny static file server for Triibholz (THPLAY) — water polo playbook prototype.
Honors the PORT env var (used by the preview harness); defaults to 4173.
Serves this script's own directory so it works regardless of cwd.
"""
import os
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "4173"))

Handler = functools.partial(SimpleHTTPRequestHandler, directory=ROOT)
httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
print(f"Triibholz (THPLAY) serving {ROOT} on :{PORT}")
httpd.serve_forever()
