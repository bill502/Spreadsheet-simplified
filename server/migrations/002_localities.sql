-- Localities mapping table
CREATE TABLE IF NOT EXISTS localities (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE,
  alias TEXT,
  pp TEXT,
  uc TEXT
);
CREATE INDEX IF NOT EXISTS idx_localities_name ON localities(name);

