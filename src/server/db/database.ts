/**
 * Database module using @libsql/client (pure JS/WASM, no native compilation).
 * Uses a local file-based SQLite database via libsql's file: URL scheme.
 */

import { createClient, type Client, type InStatement, type ResultSet, type InArgs } from '@libsql/client';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';

export interface DbHelper {
  client: Client;
  execute(stmt: InStatement): Promise<ResultSet>;
  batch(stmts: InStatement[]): Promise<ResultSet[]>;
  prepare(sql: string): {
    all(...args: unknown[]): Promise<Record<string, unknown>[]>;
    get(...args: unknown[]): Promise<Record<string, unknown> | undefined>;
    run(...args: unknown[]): Promise<{ lastInsertRowid: number; rowsAffected: number }>;
  };
  all(sql: string, ...args: unknown[]): Promise<Record<string, unknown>[]>;
  get(sql: string, ...args: unknown[]): Promise<Record<string, unknown> | undefined>;
  run(sql: string, ...args: unknown[]): Promise<{ lastInsertRowid: number; rowsAffected: number }>;
}

let _db: DbHelper | null = null;

function normalizeArgs(args: unknown[]): InArgs {
  if (args.length === 1 && Array.isArray(args[0])) {
    return args[0] as InArgs;
  }
  return args as InArgs;
}

export function getDb(): DbHelper {
  if (_db) return _db;

  const dbPath = path.resolve(config.dbPath);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // @libsql/client uses file: URL for local SQLite files
  const client = createClient({
    url: `file:${dbPath.replace(/\\/g, '/')}`,
  });

  _db = {
    client,
    execute: (stmt: InStatement) => client.execute(stmt),
    batch: (stmts: InStatement[]) => client.batch(stmts),
    prepare: (sql: string) => ({
      all: async (...args: unknown[]) => {
        const res = await client.execute({ sql, args: normalizeArgs(args) });
        return res.rows as unknown as Record<string, unknown>[];
      },
      get: async (...args: unknown[]) => {
        const res = await client.execute({ sql, args: normalizeArgs(args) });
        return (res.rows[0] as unknown as Record<string, unknown>) ?? undefined;
      },
      run: async (...args: unknown[]) => {
        const res = await client.execute({ sql, args: normalizeArgs(args) });
        return {
          lastInsertRowid: Number(res.lastInsertRowid ?? 0),
          rowsAffected: Number(res.rowsAffected ?? 0),
        };
      },
    }),
    all: async (sql: string, ...args: unknown[]) => {
      const res = await client.execute({ sql, args: normalizeArgs(args) });
      return res.rows as unknown as Record<string, unknown>[];
    },
    get: async (sql: string, ...args: unknown[]) => {
      const res = await client.execute({ sql, args: normalizeArgs(args) });
      return (res.rows[0] as unknown as Record<string, unknown>) ?? undefined;
    },
    run: async (sql: string, ...args: unknown[]) => {
      const res = await client.execute({ sql, args: normalizeArgs(args) });
      return {
        lastInsertRowid: Number(res.lastInsertRowid ?? 0),
        rowsAffected: Number(res.rowsAffected ?? 0),
      };
    },
  };

  return _db;
}

export async function initDb(): Promise<void> {
  const db = getDb();
  await applySchema(db.client);
}

async function applySchema(db: Client): Promise<void> {
  // Execute schema statements one by one
  const statements = [
    // Pragma settings
    `PRAGMA journal_mode = WAL`,
    `PRAGMA foreign_keys = ON`,

    // Languages
    `CREATE TABLE IF NOT EXISTS languages (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL
    )`,

    ...([
      ['en','English'],['hi','Hindi'],['bn','Bengali'],['ta','Tamil'],
      ['te','Telugu'],['ml','Malayalam'],['kn','Kannada'],['mr','Marathi'],
      ['pa','Punjabi'],['gu','Gujarati'],['ur','Urdu'],['fr','French'],
      ['de','German'],['ja','Japanese'],['ko','Korean'],['zh','Chinese'],
      ['es','Spanish'],['it','Italian'],['pt','Portuguese'],['ru','Russian'],
      ['ar','Arabic'],['tr','Turkish'],['th','Thai'],['vi','Vietnamese'],
      ['id','Indonesian'],['nl','Dutch'],['sv','Swedish'],['no','Norwegian'],
      ['da','Danish'],['fi','Finnish'],['pl','Polish'],
    ].map(([code, name]) => `INSERT OR IGNORE INTO languages VALUES ('${code}','${name}')`)),

    // Franchises
    `CREATE TABLE IF NOT EXISTS franchises (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      tmdb_collection_id INTEGER,
      poster_path     TEXT,
      backdrop_path   TEXT,
      overview        TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_franchises_name ON franchises(name)`,

    // Series
    `CREATE TABLE IF NOT EXISTS series (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      title           TEXT NOT NULL,
      year            INTEGER,
      overview        TEXT,
      poster_path     TEXT,
      backdrop_path   TEXT,
      tmdb_id         INTEGER,
      tmdb_rating     REAL,
      languages       TEXT DEFAULT '[]',
      is_animated     INTEGER DEFAULT 0,
      franchise_id    INTEGER REFERENCES franchises(id) ON DELETE SET NULL,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_series_title ON series(title)`,
    `CREATE INDEX IF NOT EXISTS idx_series_franchise ON series(franchise_id)`,

    // Seasons
    `CREATE TABLE IF NOT EXISTS seasons (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      series_id       INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      season_number   INTEGER NOT NULL,
      title           TEXT,
      UNIQUE(series_id, season_number)
    )`,

    // Episodes
    `CREATE TABLE IF NOT EXISTS episodes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      series_id       INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      season_id       INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      season_number   INTEGER NOT NULL,
      episode_number  INTEGER NOT NULL,
      title           TEXT,
      overview        TEXT,
      duration        INTEGER,
      file_path       TEXT NOT NULL UNIQUE,
      file_size       INTEGER NOT NULL DEFAULT 0,
      mime_type       TEXT NOT NULL DEFAULT 'video/mp4',
      audio_tracks    TEXT DEFAULT '[]',
      subtitle_tracks TEXT DEFAULT '[]',
      needs_transcode INTEGER DEFAULT 0,
      file_hash       TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id)`,
    `CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(season_id)`,

    // Media Items (movies)
    `CREATE TABLE IF NOT EXISTS media_items (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      title           TEXT NOT NULL,
      year            INTEGER,
      overview        TEXT,
      poster_path     TEXT,
      backdrop_path   TEXT,
      tmdb_id         INTEGER,
      tmdb_rating     REAL,
      languages       TEXT DEFAULT '[]',
      is_animated     INTEGER DEFAULT 0,
      duration        INTEGER,
      file_path       TEXT NOT NULL UNIQUE,
      file_size       INTEGER NOT NULL DEFAULT 0,
      mime_type       TEXT NOT NULL DEFAULT 'video/mp4',
      audio_tracks    TEXT DEFAULT '[]',
      subtitle_tracks TEXT DEFAULT '[]',
      needs_transcode INTEGER DEFAULT 0,
      franchise_id    INTEGER REFERENCES franchises(id) ON DELETE SET NULL,
      franchise_order INTEGER,
      file_hash       TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_media_title     ON media_items(title)`,
    `CREATE INDEX IF NOT EXISTS idx_media_franchise ON media_items(franchise_id)`,
    `CREATE INDEX IF NOT EXISTS idx_media_animated  ON media_items(is_animated)`,

    // Watch History
    `CREATE TABLE IF NOT EXISTS watch_history (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      media_id          INTEGER NOT NULL,
      media_type        TEXT NOT NULL CHECK(media_type IN ('movie','series','episode')),
      position_seconds  REAL NOT NULL DEFAULT 0,
      duration_seconds  REAL NOT NULL DEFAULT 0,
      percent_complete  REAL NOT NULL DEFAULT 0,
      updated_at        TEXT DEFAULT (datetime('now')),
      UNIQUE(media_id, media_type)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_watch_history_media ON watch_history(media_id, media_type)`,

    // Scan log
    `CREATE TABLE IF NOT EXISTS scan_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at    TEXT NOT NULL,
      completed_at  TEXT,
      scanned_count INTEGER DEFAULT 0,
      error_count   INTEGER DEFAULT 0,
      errors        TEXT DEFAULT '[]',
      status        TEXT DEFAULT 'running' CHECK(status IN ('running','completed','failed'))
    )`,

    // Path Controls (exclusion rules for files and directories)
    `CREATE TABLE IF NOT EXISTS path_controls (
      path          TEXT PRIMARY KEY,
      is_excluded   INTEGER NOT NULL DEFAULT 1,
      is_directory  INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_path_controls_excluded ON path_controls(is_excluded)`,
  ];

  for (const sql of statements) {
    try {
      await db.execute(sql);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('already exists') && !msg.includes('UNIQUE')) {
        console.warn('[DB] Schema warning:', msg.slice(0, 120));
      }
    }
  }

  // Schema migrations for is_excluded
  const migrations = [
    `ALTER TABLE media_items ADD COLUMN is_excluded INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE episodes ADD COLUMN is_excluded INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE series ADD COLUMN is_excluded INTEGER NOT NULL DEFAULT 0`,
    `CREATE INDEX IF NOT EXISTS idx_media_excluded ON media_items(is_excluded)`,
    `CREATE INDEX IF NOT EXISTS idx_episodes_excluded ON episodes(is_excluded)`,
    `CREATE INDEX IF NOT EXISTS idx_series_excluded ON series(is_excluded)`,
  ];

  for (const mig of migrations) {
    try {
      await db.execute(mig);
    } catch {
      // Column or index may already exist
    }
  }
}

export default getDb;
