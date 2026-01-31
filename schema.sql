-- ERC-8004 Catalog D1 Schema

CREATE TABLE IF NOT EXISTS agents (
  token_id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,           -- 'ethereum' or 'base'
  owner TEXT NOT NULL,
  name TEXT,
  description TEXT,
  metadata_uri TEXT,
  metadata_json TEXT,            -- cached JSON blob
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agents_chain ON agents(chain);
CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner);
CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);

-- Full-text search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS agents_fts USING fts5(
  token_id,
  name,
  description,
  content='agents',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS agents_ai AFTER INSERT ON agents BEGIN
  INSERT INTO agents_fts(rowid, token_id, name, description) 
  VALUES (new.rowid, new.token_id, new.name, new.description);
END;

CREATE TRIGGER IF NOT EXISTS agents_ad AFTER DELETE ON agents BEGIN
  INSERT INTO agents_fts(agents_fts, rowid, token_id, name, description) 
  VALUES('delete', old.rowid, old.token_id, old.name, old.description);
END;

CREATE TRIGGER IF NOT EXISTS agents_au AFTER UPDATE ON agents BEGIN
  INSERT INTO agents_fts(agents_fts, rowid, token_id, name, description) 
  VALUES('delete', old.rowid, old.token_id, old.name, old.description);
  INSERT INTO agents_fts(rowid, token_id, name, description) 
  VALUES (new.rowid, new.token_id, new.name, new.description);
END;

-- Sync metadata table
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
