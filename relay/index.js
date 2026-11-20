// Partsong share relay. PUT /s/<id> stores an encrypted score (AES-GCM, done
// on the phone; the key travels only in the link's #fragment, so this never
// sees it); GET /s/<id> returns it. Ids are random 128-bit values chosen by the
// app; an existing id is never overwritten.
//
// POST /log takes a problem record from the app (an error, a failed or
// interrupted read: see report() in app.js) and keeps it in the LOG database
// (D1, schema.sql) for 90 days. Never a score, its name or a page: what
// happened, where in the code, on what device, and the music reader's last
// messages. Read them with scripts/problem-log.sh.

const MAX_BYTES = 40e6; // a long score with many photos is ~10 MB
const MAGIC = "PSR1"; // what the app puts before its ciphertext
const ID = /^[A-Za-z0-9_-]{22}$/;
const LOG_MAX_BYTES = 16e3; // one record
const LOG_MAX_A_DAY = 5000; // far more than real use: a stuck or hostile sender stops here
const LOG_KEEP_DAYS = 90;
const LOG_KINDS = ["error", "read-failed", "read-restarted", "read-gave-up", "read-out-of-memory", "no-music"];
const text = (v, max) => (v == null ? null : String(v).slice(0, max));

async function keepLog(request, env) {
  const body = await request.text();
  if (body.length > LOG_MAX_BYTES) return 413;
  let r;
  try {
    r = JSON.parse(body);
  } catch {
    return 400;
  }
  if (!r || !LOG_KINDS.includes(r.kind)) return 400;
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const { n } = await env.LOG.prepare("SELECT COUNT(*) AS n FROM log WHERE day = ?").bind(day).first();
  if (n >= LOG_MAX_A_DAY) return 429;
  await env.LOG.prepare("INSERT INTO log (at, day, visit, kind, version, device, browser, stage, message, place, detail, reader) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(now, day, text(r.visit, 40), r.kind, text(r.version, 20), text(r.device, 20), text(r.browser, 300), text(r.stage, 120), text(r.message, 2000), text(r.place, 2000), text(JSON.stringify(r.detail ?? {}), 2000), text(r.reader, 8000))
    .run();
  // Old records go as new ones arrive (now and then: no schedule to keep).
  if (Math.random() < 0.02) await env.LOG.prepare("DELETE FROM log WHERE at < ?").bind(now - LOG_KEEP_DAYS * 864e5).run();
  return 201;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ORIGINS.split(",").map((o) => o.trim());
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
      "Access-Control-Allow-Methods": "GET, PUT, POST",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const reply = (body, status = 200, headers = {}) => new Response(body, { status, headers: { ...cors, ...headers } });
    if (request.method === "OPTIONS") return reply(null, 204);

    const [, kind, id] = new URL(request.url).pathname.split("/");
    if (kind === "log" && !id) {
      if (request.method !== "POST") return reply("Method not allowed", 405);
      if (!allowed.includes(origin)) return reply("Forbidden", 403);
      return reply(null, await keepLog(request, env));
    }
    if (kind !== "s" || !ID.test(id || "")) return reply("Not found", 404);

    if (request.method === "GET") {
      const obj = await env.SHARES.get(id);
      if (!obj) return reply("Not found", 404);
      return reply(obj.body, 200, { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=86400" });
    }
    if (request.method === "PUT") {
      if (!allowed.includes(origin)) return reply("Forbidden", 403);
      const size = Number(request.headers.get("Content-Length"));
      if (!size || size > MAX_BYTES) return reply("Too large", 413);
      const body = await request.arrayBuffer();
      if (body.byteLength > MAX_BYTES || new TextDecoder().decode(body.slice(0, 4)) !== MAGIC) return reply("Bad request", 400);
      if (await env.SHARES.head(id)) return reply("Exists", 409);
      await env.SHARES.put(id, body);
      return reply(null, 201);
    }
    return reply("Method not allowed", 405);
  },
};
