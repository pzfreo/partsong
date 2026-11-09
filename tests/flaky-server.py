# Serves the Partsong folder on http://127.0.0.1:8766, failing the first N
# requests for pdf.js with 503 (as a dropped connection would), for
# tests/drive-pdf-retry.js:  python3 tests/flaky-server.py . 3
import functools, http.server, sys

failures = {"n": 0}


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if "pdf.min.mjs" in self.path and failures["n"] < int(sys.argv[2]):
            failures["n"] += 1
            self.send_error(503)
            return
        return super().do_GET()

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", 8766), functools.partial(Handler, directory=sys.argv[1])).serve_forever()
