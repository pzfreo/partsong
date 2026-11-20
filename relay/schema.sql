-- The problem log (POST /log in index.js). Create it once:
--   npx wrangler d1 create partsong-log        (put its id in wrangler.toml)
--   npx wrangler d1 execute partsong-log --remote --file schema.sql
CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,      -- when it arrived (ms)
  day TEXT NOT NULL,        -- its UTC day, 2026-11-20
  visit TEXT,               -- random, made new each time the app opens: ties one visit's records together
  kind TEXT NOT NULL,       -- error, read-failed, read-restarted, read-gave-up, read-out-of-memory, no-music
  version TEXT,
  device TEXT,
  browser TEXT,             -- the user agent
  stage TEXT,               -- what was happening: "finding systems, page 2 of 6"
  message TEXT,
  place TEXT,               -- the error's stack (our files and lines)
  detail TEXT,              -- JSON: memory mode, threads, the page's size and shape, what the reader saw
  reader TEXT               -- the music reader's last messages
);
CREATE INDEX IF NOT EXISTS log_day ON log (day);
CREATE INDEX IF NOT EXISTS log_visit ON log (visit);
