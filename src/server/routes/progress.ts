import { Router } from 'express';
import { getDb } from '../db/database.js';

export const progressRouter = Router();

// ── GET /api/progress/recent/all ──────────────────────────────────────────
// Must be defined BEFORE parameterized route /:type/:id
progressRouter.get('/recent/all', async (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(50, parseInt(String(req.query.limit ?? '20'), 10));

    const recentMovies = await db.prepare(`
      SELECT wh.*, m.title, m.poster_path, m.backdrop_path, m.duration, m.year
      FROM watch_history wh
      JOIN media_items m ON m.id = wh.media_id
      WHERE wh.media_type='movie' AND wh.percent_complete < 95
      ORDER BY wh.updated_at DESC LIMIT ?
    `).all(limit);

    const recentEpisodes = await db.prepare(`
      SELECT wh.*, e.title as ep_title, e.season_number, e.episode_number,
             s.title as series_title, s.poster_path, s.backdrop_path, e.duration
      FROM watch_history wh
      JOIN episodes e ON e.id = wh.media_id
      JOIN series s ON s.id = e.series_id
      WHERE wh.media_type='episode' AND wh.percent_complete < 95
      ORDER BY wh.updated_at DESC LIMIT ?
    `).all(limit);

    res.json({
      movies: recentMovies.map((r) => ({
        mediaId: r.media_id,
        mediaType: 'movie',
        title: r.title,
        posterPath: r.poster_path,
        backdropPath: r.backdrop_path,
        duration: r.duration,
        year: r.year,
        positionSeconds: r.position_seconds,
        percentComplete: r.percent_complete,
        updatedAt: r.updated_at,
      })),
      episodes: recentEpisodes.map((r) => ({
        mediaId: r.media_id,
        mediaType: 'episode',
        title: r.series_title,
        episodeTitle: r.ep_title,
        seasonNumber: r.season_number,
        episodeNumber: r.episode_number,
        posterPath: r.poster_path,
        backdropPath: r.backdrop_path,
        duration: r.duration,
        positionSeconds: r.position_seconds,
        percentComplete: r.percent_complete,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/progress/:type/:id ───────────────────────────────────────────
// Returns saved watch progress for a movie or episode
progressRouter.get('/:type/:id', async (req, res) => {
  try {
    const db = getDb();
    const { type, id } = req.params;

    if (!['movie', 'episode'].includes(type)) {
      res.status(400).json({ error: 'type must be movie or episode' });
      return;
    }

    const mediaType = type === 'movie' ? 'movie' : 'episode';
    const row = await db.prepare(`
      SELECT * FROM watch_history WHERE media_id=? AND media_type=?
    `).get(parseInt(id, 10), mediaType);

    if (!row) {
      res.json({ positionSeconds: 0, durationSeconds: 0, percentComplete: 0 });
      return;
    }

    res.json({
      id: row.id,
      mediaId: row.media_id,
      mediaType: row.media_type,
      positionSeconds: Number(row.position_seconds ?? 0),
      durationSeconds: Number(row.duration_seconds ?? 0),
      percentComplete: Number(row.percent_complete ?? 0),
      updatedAt: row.updated_at,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/progress/:type/:id ──────────────────────────────────────────
// Heartbeat endpoint — upserts watch position
progressRouter.post('/:type/:id', async (req, res) => {
  try {
    const db = getDb();
    const { type, id } = req.params;

    if (!['movie', 'episode'].includes(type)) {
      res.status(400).json({ error: 'type must be movie or episode' });
      return;
    }

    const { positionSeconds, durationSeconds } = req.body as {
      positionSeconds?: number;
      durationSeconds?: number;
    };

    if (typeof positionSeconds !== 'number' || isNaN(positionSeconds)) {
      res.status(400).json({ error: 'positionSeconds must be a number' });
      return;
    }

    const mediaType = type === 'movie' ? 'movie' : 'episode';
    const mediaId = parseInt(id, 10);
    const dur = typeof durationSeconds === 'number' && !isNaN(durationSeconds) ? durationSeconds : 0;
    const pct = dur > 0 ? Math.min(100, Math.round((positionSeconds / dur) * 100)) : 0;
    const now = new Date().toISOString();

    await db.prepare(`
      INSERT INTO watch_history (media_id, media_type, position_seconds, duration_seconds, percent_complete, updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(media_id, media_type) DO UPDATE SET
        position_seconds=excluded.position_seconds,
        duration_seconds=CASE WHEN excluded.duration_seconds > 0 THEN excluded.duration_seconds ELSE duration_seconds END,
        percent_complete=excluded.percent_complete,
        updated_at=excluded.updated_at
    `).run(mediaId, mediaType, positionSeconds, dur, pct, now);

    res.json({ ok: true, updatedAt: now });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── DELETE /api/progress/:type/:id ────────────────────────────────────────
progressRouter.delete('/:type/:id', async (req, res) => {
  try {
    const db = getDb();
    const { type, id } = req.params;
    const mediaType = type === 'movie' ? 'movie' : 'episode';
    await db.prepare('DELETE FROM watch_history WHERE media_id=? AND media_type=?')
      .run(parseInt(id, 10), mediaType);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
