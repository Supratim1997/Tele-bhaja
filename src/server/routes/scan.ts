import { Router } from 'express';
import { scanner } from '../scanner/scanner.js';
import { config } from '../config.js';
import { getDb } from '../db/database.js';

export const scanRouter = Router();

// ── POST /api/scan/start ──────────────────────────────────────────────────
scanRouter.post('/start', async (req, res) => {
  if (scanner.status.running) {
    res.status(409).json({ error: 'Scan already in progress', status: scanner.status });
    return;
  }

  const { path: reqPath, force } = (req.body as { path?: string; force?: boolean }) || {};
  const mediaPath = reqPath ?? config.mediaStoragePath;

  // Start scan in background — don't await
  scanner.scan(mediaPath, { force: Boolean(force) }).catch((err: Error) => {
    console.error('[Scan] Fatal error:', err.message);
  });

  res.json({ ok: true, message: 'Scan started', mediaPath, force: Boolean(force) });
});

// ── GET /api/scan/status ──────────────────────────────────────────────────
scanRouter.get('/status', (_req, res) => {
  res.json(scanner.status);
});

// ── GET /api/scan/history ─────────────────────────────────────────────────
scanRouter.get('/history', async (_req, res) => {
  try {
    const db = getDb();
    const rows = await db.prepare('SELECT * FROM scan_log ORDER BY started_at DESC LIMIT 20').all();
    res.json(rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/franchises ────────────────────────────────────────────────────
export const franchiseRouter = Router();

franchiseRouter.get('/', async (_req, res) => {
  try {
    const db = getDb();
    const rows = await db.prepare(`
      SELECT f.*,
        COUNT(m.id) as item_count
      FROM franchises f
      LEFT JOIN media_items m ON m.franchise_id = f.id
      GROUP BY f.id
      HAVING item_count > 0
      ORDER BY f.name ASC
    `).all();

    res.json(rows.map((f) => ({
      id: f.id as number,
      name: f.name as string,
      tmdbCollectionId: f.tmdb_collection_id as number | undefined,
      posterPath: f.poster_path as string | undefined,
      backdropPath: f.backdrop_path as string | undefined,
      overview: f.overview as string | undefined,
      itemCount: f.item_count as number,
    })));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

franchiseRouter.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);

    const franchise = await db.prepare('SELECT * FROM franchises WHERE id=?').get(id);
    if (!franchise) { res.status(404).json({ error: 'Franchise not found' }); return; }

    const movies = await db.prepare(`
      SELECT * FROM media_items WHERE franchise_id=? ORDER BY franchise_order ASC, year ASC, title ASC
    `).all(id);

    res.json({
      id: franchise.id,
      name: franchise.name,
      tmdbCollectionId: franchise.tmdb_collection_id,
      posterPath: franchise.poster_path,
      backdropPath: franchise.backdrop_path,
      overview: franchise.overview,
      itemCount: movies.length,
      movies: movies.map((m) => ({
        id: m.id,
        title: m.title,
        year: m.year,
        posterPath: m.poster_path,
        backdropPath: m.backdrop_path,
        duration: m.duration,
        franchiseOrder: m.franchise_order,
        tmdbRating: m.tmdb_rating,
        overview: m.overview,
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/categories ────────────────────────────────────────────────────
export const categoriesRouter = Router();

categoriesRouter.get('/', async (_req, res) => {
  try {
    const db = getDb();
    const movieRow = await db.prepare('SELECT COUNT(*) as c FROM media_items').get();
    const seriesRow = await db.prepare('SELECT COUNT(*) as c FROM series').get();
    const animMovieRow = await db.prepare('SELECT COUNT(*) as c FROM media_items WHERE is_animated=1').get();
    const animSeriesRow = await db.prepare('SELECT COUNT(*) as c FROM series WHERE is_animated=1').get();
    const franchiseRow = await db.prepare(`
      SELECT COUNT(*) as c FROM franchises 
      WHERE (SELECT COUNT(*) FROM media_items WHERE franchise_id=franchises.id) > 0
    `).get();

    const movieCount = (movieRow?.c as number) ?? 0;
    const seriesCount = (seriesRow?.c as number) ?? 0;
    const animMovieCount = (animMovieRow?.c as number) ?? 0;
    const animSeriesCount = (animSeriesRow?.c as number) ?? 0;
    const franchiseCount = (franchiseRow?.c as number) ?? 0;

    res.json([
      { key: 'movie',     label: 'Movies',     count: movieCount },
      { key: 'series',    label: 'TV Series',  count: seriesCount },
      { key: 'animated',  label: 'Animated',   count: animMovieCount + animSeriesCount },
      { key: 'franchise', label: 'Franchises', count: franchiseCount },
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
