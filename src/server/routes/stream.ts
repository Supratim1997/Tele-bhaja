import { Router } from 'express';
import { streamingService } from '../streaming/streaming.js';
import { transcodingService } from '../streaming/transcoding.js';
import { getDb } from '../db/database.js';

export const streamRouter = Router();

// ── GET /api/stream/movie/:id ──────────────────────────────────────────────
streamRouter.get('/movie/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID' }); return; }
  await streamingService.streamMovie(req, res, id);
});

// ── GET /api/stream/episode/:id ────────────────────────────────────────────
streamRouter.get('/episode/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID' }); return; }
  await streamingService.streamEpisode(req, res, id);
});

// ── GET /api/stream/thumbnail/movie/:id ───────────────────────────────────
streamRouter.get('/thumbnail/movie/:id', async (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const item = await db.prepare('SELECT file_path FROM media_items WHERE id=?').get(id) as { file_path: string } | undefined;
    if (!item) { res.status(404).end(); return; }
    const at = parseFloat(String(req.query.at ?? '10')) || 10;
    const thumb = await transcodingService.generateThumbnail(item.file_path, at);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(thumb);
  } catch {
    res.status(500).end();
  }
});

// ── GET /api/stream/thumbnail/episode/:id ─────────────────────────────────
streamRouter.get('/thumbnail/episode/:id', async (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const item = await db.prepare('SELECT file_path FROM episodes WHERE id=?').get(id) as { file_path: string } | undefined;
    if (!item) { res.status(404).end(); return; }
    const at = parseFloat(String(req.query.at ?? '10')) || 10;
    const thumb = await transcodingService.generateThumbnail(item.file_path, at);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(thumb);
  } catch {
    res.status(500).end();
  }
});

// ── GET /api/stream/subtitle ───────────────────────────────────────────────
// Serves external subtitle files by encoded path
streamRouter.get('/subtitle', (req, res) => {
  const encodedPath = String(req.query.path ?? '');
  if (!encodedPath) { res.status(400).json({ error: 'Missing path' }); return; }

  let subtitlePath: string;
  try {
    subtitlePath = decodeURIComponent(encodedPath);
  } catch {
    res.status(400).json({ error: 'Invalid path encoding' }); return;
  }

  streamingService.serveSubtitle(req, res, subtitlePath);
});

// ── GET /api/stream/info/movie/:id ────────────────────────────────────────
streamRouter.get('/info/movie/:id', async (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const item = await db.prepare(`
      SELECT id, file_path, file_size, mime_type, needs_transcode, audio_tracks, subtitle_tracks
      FROM media_items WHERE id=?
    `).get(id);
    if (!item) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({
      id: Number(item.id),
      mediaType: 'movie',
      filePath: item.file_path,
      mimeType: item.mime_type,
      fileSize: Number(item.file_size ?? 0),
      needsTranscode: Boolean(item.needs_transcode),
      audioTracks: safeJson(item.audio_tracks as string, []),
      subtitleTracks: safeJson(item.subtitle_tracks as string, []),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/stream/info/episode/:id ──────────────────────────────────────
streamRouter.get('/info/episode/:id', async (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const item = await db.prepare(`
      SELECT id, file_path, file_size, mime_type, needs_transcode, audio_tracks, subtitle_tracks
      FROM episodes WHERE id=?
    `).get(id);
    if (!item) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({
      id: Number(item.id),
      mediaType: 'episode',
      filePath: item.file_path,
      mimeType: item.mime_type,
      fileSize: Number(item.file_size ?? 0),
      needsTranscode: Boolean(item.needs_transcode),
      audioTracks: safeJson(item.audio_tracks as string, []),
      subtitleTracks: safeJson(item.subtitle_tracks as string, []),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

function safeJson<T>(val: string, fallback: T): T {
  try { return JSON.parse(val); } catch { return fallback; }
}
