// Partsong's analytics page: the counts "check goat" looks at (GoatCounter)
// and the problem log (D1), on one page behind a password (HTTP Basic auth,
// any user name). See wrangler.toml for the secrets.
const GOAT = "https://partsong.goatcounter.com/api/v0/";
const CACHE_SECS = 300;

export default {
  async fetch(request, env, ctx) {
    if (!(await allowed(request, env))) {
      return new Response("Password needed", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Partsong stats", charset="UTF-8"', ...PRIVATE } });
    }
    const url = new URL(request.url);
    if (url.pathname !== "/") return new Response("Not found", { status: 404, headers: PRIVATE });
    const days = [7, 14, 28].includes(+url.searchParams.get("days")) ? +url.searchParams.get("days") : 7;
    try {
      const [hits, problems] = await Promise.all([goatHits(env, ctx, days), problemLog(env)]);
      return new Response(page(days, hits, problems), { headers: { "Content-Type": "text/html; charset=utf-8", ...PRIVATE } });
    } catch (e) {
      return new Response("Couldn't fetch the stats: " + e.message, { status: 502, headers: PRIVATE });
    }
  },
};

const PRIVATE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };

async function allowed(request, env) {
  const m = /^Basic (.+)$/.exec(request.headers.get("Authorization") || "");
  if (!m || !env.PASSWORD) return false;
  let given;
  try { given = atob(m[1]).split(":").slice(1).join(":"); } catch { return false; }
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, env.PASSWORD].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

// Every path and event, day by day, for the last `days` days (UTC). Fetched a
// week at a time: paging uses exclude_paths, and GoatCounter refuses the URL
// after ~900 ids (a fortnight's worth). Weeks are kept a while (the current
// one a few minutes) so reloading doesn't run into GoatCounter's rate limit.
async function goat(env, u) {
  let why;
  for (let t = 0; t < 4; t++) {
    const r = await fetch(GOAT + u, { headers: { Authorization: "Bearer " + env.GOATCOUNTER_KEY } });
    if (r.status === 401 || r.status === 403) throw new Error("GoatCounter refused the key");
    why = String(r.status);
    if (r.ok) {
      const d = await r.json().catch((e) => { why += ": " + e.message; });
      if (d) return d;
    }
    await new Promise((res) => setTimeout(res, 1500 * (t + 1)));
  }
  throw new Error(`GoatCounter didn't answer (${why})`);
}

async function week(env, ctx, start, end, secs) {
  const key = new Request(`https://stats.cache/week/${start}/${end}`);
  const hit = await caches.default.match(key);
  if (hit) return hit.json();
  const hits = [];
  const seen = [];
  for (let page = 0; page < 15; page++) {
    const d = await goat(env, `stats/hits?start=${start}&end=${end}&limit=100&daily=true${seen.length ? "&exclude_paths=" + seen.join(",") : ""}`);
    for (const h of d.hits) {
      seen.push(h.path_id);
      hits.push({ path: h.path, days: Object.fromEntries(h.stats.map((x) => [x.day, x.daily])) });
    }
    if (!d.more || !d.hits.length) break;
  }
  ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(hits), { headers: { "Cache-Control": `max-age=${secs}` } })));
  return hits;
}

async function goatHits(env, ctx, days) {
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const byPath = new Map();
  for (let w = 0; w < days / 7; w++) {
    for (const h of await week(env, ctx, day(-7 * w - 6), day(-7 * w + 1), w ? 3600 : CACHE_SECS)) {
      const row = byPath.get(h.path) || { path: h.path, days: {} };
      Object.assign(row.days, h.days);
      byPath.set(h.path, row);
    }
  }
  return { start: day(1 - days), end: day(1), hits: [...byPath.values()] };
}

async function problemLog(env) {
  const { results } = await env.LOG.prepare(
    "SELECT at, visit, kind, version, device, stage, message FROM log WHERE at > ? ORDER BY at DESC LIMIT 200",
  ).bind(Date.now() - 2 * 864e5).all();
  return results;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(days, { start, hits }, problems) {
  const dayList = [];
  for (let d = Date.parse(start); dayList.length < days; d += 864e5) dayList.push(new Date(d).toISOString().slice(0, 10));
  const total = (h) => dayList.reduce((n, d) => n + (h.days[d] || 0), 0);
  const sum = (test, d) => hits.filter((h) => test(h.path)).reduce((n, h) => n + (d ? h.days[d] || 0 : total(h)), 0);
  const is = (p) => (path) => path === p;
  const starts = (p) => (path) => path.startsWith(p);
  const DAY3 = /^use: day (3|4–5|6–10|11–20|21–50|51\+)$/;

  // Day by day. A column is a count, with a bar scaled to its busiest day, or a
  // share of another count ("of"), with a bar out of 100 and the counts on hover.
  const visits = (d) => sum(is("/"), d);
  const ok = (d) => sum(is("read-ok"), d);
  const failed = (d) => sum(is("read-failed"), d);
  const finished = (d) => ok(d) + failed(d);
  const cols = [
    { name: "Visits", f: visits },
    { name: "New devices", sub: "% of visits", f: (d) => sum(is("use: day 1"), d), of: visits, unit: "new devices", ofUnit: "visits" },
    { name: "Back, 3+ days", f: (d) => sum((p) => DAY3.test(p), d) },
    { name: "Reads", sub: "worked", f: ok },
    { name: "Failed", f: failed },
    { name: "Restarts", sub: "per 100 tries", f: (d) => sum(starts("read-restarted"), d) + sum(starts("read-gave-up"), d), of: finished, unit: "restarts", ofUnit: "tries", plain: true },
    { name: "Plays", f: (d) => sum(is("play"), d) },
    { name: "Shares", f: (d) => sum(is("share"), d) },
    { name: "Links opened", f: (d) => sum(is("receive: link"), d) },
  ];
  // [shown value (count, or share 0..1), count, of] per column for a day (undefined: the whole period)
  const cells = (d) => cols.map((c) => {
    const n = c.f(d);
    if (!c.of) return [n, n];
    const of = c.of(d);
    return [of ? n / of : null, n, of];
  });
  const perDay = dayList.slice().reverse().map((d) => [d, cells(d)]);
  const most = cols.map((c, i) => (c.of ? 1 : Math.max(1, ...perDay.map(([, x]) => x[i][0]))));
  const cell = ([v, n, of], i, bar = true) => {
    const c = cols[i];
    const shown = !c.of ? v || "" : v == null ? "" : `${Math.round(v * 100)}${c.plain ? "" : "%"}`;
    const w = Math.min(100, Math.round(((v ?? 0) / most[i]) * 100));
    return `<td class="n${bar ? " bar" : ""}"${bar ? ` style="--w:${w}%"` : ""}${c.of ? ` title="${esc(`${n} ${c.unit} of ${of || 0} ${c.ofUnit}`)}"` : ""}><b>${shown}</b></td>`;
  };
  const daily = `<table class="daily"><thead><tr><th>Day</th>${cols.map((c) => `<th class="n">${c.name}${c.sub ? `<br><span class="u">${c.sub}</span>` : ""}</th>`).join("")}</tr></thead><tbody>${perDay
    .map(([d, c]) => `<tr><td class="nw">${new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</td>${c.map((x, i) => cell(x, i)).join("")}</tr>`)
    .join("")}</tbody><tfoot><tr><th>All ${dayList.length} days</th>${cells().map((x, i) => cell(x, i, false)).join("")}</tr></tfoot></table>
  <p class="note">Bars on counts are scaled to the column's busiest day; bars on shares are out of 100. Tries: reads that worked or failed. A read can restart more than once, and a read that gave up isn't a try, so restarts can pass 100. Failed includes pages with no music found. Hover a share for the counts behind it.</p>`;

  // Reads by device, and by version: "read-ok (iPhone v326): low memory" etc.
  const byDevice = new Map();
  const byVersion = new Map();
  const add = (map, k, f, n) => { const r = map.get(k) || { ok: 0, low: 0, failed: 0, restarted: 0 }; r[f] += n; map.set(k, r); };
  for (const h of hits) {
    const m = /^(read-ok|read-failed|read-restarted|read-gave-up) \((\S+) (\S+)\)(.*)$/.exec(h.path);
    if (!m || (m[1] === "read-failed" && m[4])) continue; // a failure is also counted with its reason
    const f = m[1] === "read-ok" ? (m[4] ? "low" : "ok") : m[1] === "read-failed" ? "failed" : "restarted";
    add(byDevice, m[2], f, total(h));
    add(byVersion, m[3], f, total(h));
  }
  const readTable = (first, map, order) => `<table><thead><tr><th>${first}</th><th class="n">Read</th><th class="n">In low memory</th><th class="n">Failed</th><th class="n">Restarted</th></tr></thead><tbody>${[...map]
    .sort(order)
    .map(([k, r]) => `<tr><td>${esc(k)}</td><td class="n">${r.ok || ""}</td><td class="n">${r.low || ""}</td><td class="n ${r.failed ? "bad" : ""}">${r.failed || ""}</td><td class="n ${r.restarted ? "bad" : ""}">${r.restarted || ""}</td></tr>`)
    .join("")}</tbody></table>`;
  const reads = (r) => r.ok + r.low + r.failed + r.restarted;
  const vnum = (v) => (/^v?(\d+)/.exec(v) || [0, 0])[1];
  const devices = readTable("Device", byDevice, (a, b) => reads(b[1]) - reads(a[1]));
  const versions = readTable("Version", byVersion, (a, b) => vnum(b[0]) - vnum(a[0]) || a[0].localeCompare(b[0]));

  // Regular users: a device passes "use: day 2" and "use: day 3" once each.
  const regular = `<div class="tiles">${[
    ["New devices", sum(is("use: day 1"))],
    ["Came back a 2nd day", sum(is("use: day 2"))],
    ["Reached a 3rd day", sum(is("use: day 3"))],
    ["Days used by devices on day 3+", sum((p) => DAY3.test(p))],
    ["Regular devices", sum(is("use: regular this week"))],
  ].map(([n, v]) => `<div class="tile"><div class="v">${v}</div><div class="l">${n}</div></div>`).join("")}</div>
  <p class="note">Each device counts once a day; nothing links one device's days together. "Reached a 3rd day" counts each device once. Regular users active in the period lie between the busiest single day and the last figure. "Regular devices": a device used on 3+ days counts itself once in each calendar week (Monday to Sunday) it is opened in, so a period that doesn't run Monday to Sunday counts too few or too many at its ends, and browsers that block counting are missed. It starts from 26 Nov.</p>`;

  // Everything, most first.
  const all = hits.map((h) => [h.path, total(h)]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const everything = `<details><summary>Every count (${all.length})</summary><table><tbody>${all
    .map(([p, n]) => `<tr><td class="n">${n}</td><td>${esc(p)}</td></tr>`)
    .join("")}</tbody></table></details>`;

  const log = problems.length
    ? `<table><thead><tr><th>When (UTC)</th><th>What</th><th>Device</th><th>Where</th><th>Message</th><th>Visit</th></tr></thead><tbody>${problems
        .map((p) => `<tr><td class="nw">${new Date(p.at).toISOString().slice(5, 16).replace("T", " ")}</td><td>${esc(p.kind)}</td><td class="nw">${esc(p.device)} ${esc(p.version)}</td><td>${esc(p.stage)}</td><td class="msg">${esc(p.message)}</td><td class="mono">${esc(String(p.visit).slice(0, 13))}</td></tr>`)
        .join("")}</tbody></table>`
    : "<p>Nothing in the last 2 days.</p>";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Partsong stats</title><style>
:root{--bg:#f6f6f3;--surface:#fff;--text:#16181f;--muted:#6b6d75;--border:#e2e2dc;--accent:#2b2870;--bar:#c9c7ef;--bad:#c0392b;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#12141c;--surface:#1c1f2b;--text:#ece8df;--muted:#9d99a6;--border:#30344a;--accent:#b3b0ff;--bar:#3a3870;--bad:#ff7b6b}}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:4px 0 2px;color:var(--accent)}h2{font-size:16px;margin:28px 0 8px}
.sub,.note{color:var(--muted);font-size:13px}nav a{margin-right:12px;color:var(--accent)}nav a.on{font-weight:700;text-decoration:none}
section{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;overflow-x:auto}
table{border-collapse:collapse;width:100%}th,td{padding:5px 8px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600}.n{text-align:right;font-variant-numeric:tabular-nums}.nw{white-space:nowrap}
th .u{font-weight:400}tfoot th{color:var(--text)}tfoot th,tfoot td{border-top:2px solid var(--border)}tfoot td b{font-weight:700}
.daily th:first-child,.daily td:first-child{position:sticky;left:0;background:var(--surface);z-index:1}
.bar{min-width:70px;background:linear-gradient(to left,var(--bar) var(--w),transparent var(--w)) no-repeat right 4px center/calc(100% - 8px) 60%}.bar b{font-weight:600}
.bad{color:var(--bad);font-weight:600}.msg{min-width:200px;max-width:340px;overflow-wrap:anywhere}.mono{font-family:ui-monospace,monospace;font-size:12px;color:var(--muted)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.tile{border:1px solid var(--border);border-radius:8px;padding:10px}
.tile .v{font-size:24px;font-weight:700}.tile .l{color:var(--muted);font-size:13px}summary{cursor:pointer;color:var(--accent);margin-top:8px}
</style></head><body><main>
<h1>Partsong stats</h1><div class="sub">${esc(dayList[0])} to ${esc(dayList.at(-1))} (UTC) · GoatCounter, refreshed every ${CACHE_SECS / 60} minutes · problem log live</div>
<nav>${[7, 14, 28].map((n) => `<a href="?days=${n}" class="${n === days ? "on" : ""}">${n} days</a>`).join("")}</nav>
<h2>Day by day</h2><section>${daily}</section>
<h2>Reads by device</h2><section>${devices}</section>
<h2>Reads by version</h2><section>${versions}</section>
<h2>Coming back</h2><section>${regular}</section>
<h2>Problem log, last 2 days</h2><section>${log}<p class="note">In full: scripts/problem-log.sh visit &lt;visit&gt;</p></section>
<section style="margin-top:28px">${everything}</section>
</main></body></html>`;
}
