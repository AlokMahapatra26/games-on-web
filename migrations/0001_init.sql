CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  creator TEXT NOT NULL DEFAULT 'Anonymous',
  entry_file TEXT NOT NULL DEFAULT 'index.html',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_games_created_at ON games(created_at DESC);

