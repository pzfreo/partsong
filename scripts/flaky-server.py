"""Test server: serves the repo with HTTP range support, and (with --flaky)
breaks every third /models/ response halfway through, to test resumable
model downloads; with --flaky-wasm, breaks the first response for each of
the reader's own .wasm files (omr/) halfway through.
with --slow, sends each model's first piece steadily but slowly (about 35 s).
Usage: python3 scripts/flaky-server.py PORT [--flaky] [--flaky-wasm] [--slow]"""
import http.server, os, re, sys, time

FLAKY = "--flaky" in sys.argv
FLAKY_WASM = "--flaky-wasm" in sys.argv
SLOW = "--slow" in sys.argv
count = 0
broken = set()


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        global count
        path = self.translate_path(self.path.split("?")[0])
        rng = self.headers.get("Range")
        name = self.path.split("?")[0]
        if FLAKY_WASM and "/omr/" in name and name.endswith(".wasm") and name not in broken and os.path.isfile(path):
            broken.add(name)
            sys.stderr.write(f"wasm cut {name}\n")
            data = open(path, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "application/wasm")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data[: len(data) // 2])
            self.wfile.flush()
            self.connection.shutdown(2)  # drop the connection mid-response
            return
        if "/models/" not in self.path or not os.path.isfile(path):
            return super().do_GET()
        size = os.path.getsize(path)
        start, end = 0, size - 1
        m = rng and re.match(r"bytes=(\d+)-(\d*)", rng)
        if m:
            start = int(m[1])
            end = min(int(m[2]) if m[2] else size - 1, size - 1)
        count += 1
        self.log_message = lambda *a: None
        sys.stderr.write(f"models {'range' if m else 'full'} {start}-{end} #{count}\n")
        self.send_response(206 if m else 200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(end - start + 1))
        if m:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            cut = remaining // 2 if FLAKY and count % 3 == 0 else None
            sent = 0
            while remaining:
                chunk = f.read(min(65536, remaining))
                if cut is not None and sent + len(chunk) > cut:
                    self.wfile.write(chunk[: cut - sent])
                    self.wfile.flush()
                    self.connection.shutdown(2)  # drop the connection mid-response
                    return
                self.wfile.write(chunk)
                if SLOW and m and start == 0:
                    self.wfile.flush()
                    time.sleep(0.55)  # 64 chunks of a 4 MiB piece: 35 s, never 30 s without bytes
                sent += len(chunk)
                remaining -= len(chunk)


http.server.ThreadingHTTPServer(("", int(sys.argv[1])), Handler).serve_forever()
