import { Router } from 'express';
import { getDb } from '../db/database.js';
import type { MediaItem, Series, Episode, Franchise, LibraryResponse, CategorySummary, Language } from '../../shared/types.js';

export const libraryRouter = Router();

// ── GET /api/library ───────────────────────────────────────────────────────
libraryRouter.get('/', async (req, res) => {
  try {
    const db = getDb();

    const { category, language, search, page = '1', limit } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page, 10));
    // If limit is 'all' or not specified, default to 10000 to show full library without truncation
    const isUnlimited = limit === 'all' || limit === '0';
    const limitNum = isUnlimited
      ? 100000
      : limit ? Math.max(1, parseInt(limit, 10) || 10000) : 10000;
    const offset = isUnlimited ? 0 : (pageNum - 1) * limitNum;

    // Build movie query conditions
    const movieConds: string[] = [];
    const movieParams: unknown[] = [];
    const seriesConds: string[] = [];
    const seriesParams: unknown[] = [];
    const franchiseConds: string[] = [];
    const franchiseParams: unknown[] = [];

    if (search && search.trim()) {
      const terms = search.trim().split(/\s+/).filter(Boolean);
      for (const term of terms) {
        const pattern = `%${term}%`;
        // Movies: search title, franchise name, year, overview, and file path
        movieConds.push(`(
          m.title LIKE ? OR
          (f.name IS NOT NULL AND f.name LIKE ?) OR
          (m.year IS NOT NULL AND CAST(m.year AS TEXT) LIKE ?) OR
          (m.overview IS NOT NULL AND m.overview LIKE ?) OR
          m.file_path LIKE ?
        )`);
        movieParams.push(pattern, pattern, pattern, pattern, pattern);

        // Series: search series title, year, overview, episode title, and episode file path
        seriesConds.push(`(
          s.title LIKE ? OR
          (s.year IS NOT NULL AND CAST(s.year AS TEXT) LIKE ?) OR
          (s.overview IS NOT NULL AND s.overview LIKE ?) OR
          s.id IN (SELECT series_id FROM episodes WHERE title LIKE ? OR file_path LIKE ?)
        )`);
        seriesParams.push(pattern, pattern, pattern, pattern, pattern);

        // Franchises: search name and overview
        franchiseConds.push(`(
          f.name LIKE ? OR
          (f.overview IS NOT NULL AND f.overview LIKE ?)
        )`);
        franchiseParams.push(pattern, pattern);
      }
    }

    if (language) {
      movieConds.push(`m.languages LIKE ?`);
      movieParams.push(`%"${language}"%`);
      seriesConds.push(`s.languages LIKE ?`);
      seriesParams.push(`%"${language}"%`);
    }

    if (category === 'animated') {
      movieConds.push(`m.is_animated=1`);
      seriesConds.push(`s.is_animated=1`);
    } else if (category === 'franchise') {
      movieConds.push(`m.franchise_id IS NOT NULL`);
    }

    const movieWhere = movieConds.length > 0 ? `WHERE ${movieConds.join(' AND ')}` : '';
    const seriesWhere = seriesConds.length > 0 ? `WHERE ${seriesConds.join(' AND ')}` : '';
    const franchiseWhere = franchiseConds.length > 0 ? `AND ${franchiseConds.join(' AND ')}` : '';

    // Fetch movies (skip if category is series-only)
    let movies: MediaItem[] = [];
    if (category !== 'series') {
      const rawMovies = await db.prepare(`
        SELECT m.*,
          f.name as franchise_name
        FROM media_items m
        LEFT JOIN franchises f ON m.franchise_id = f.id
        ${movieWhere}
        ORDER BY m.title ASC
        LIMIT ? OFFSET ?
      `).all(...movieParams, limitNum, offset);
      movies = rawMovies.map(deserializeMovie);
    }

    // Fetch series (skip if category is movie-only or franchise-only)
    let seriesList: Series[] = [];
    if (category !== 'movie' && category !== 'franchise') {
      const rawSeries = await db.prepare(`
        SELECT s.*,
          COUNT(DISTINCT ss.id) as season_count,
          COUNT(DISTINCT e.id) as episode_count
        FROM series s
        LEFT JOIN seasons ss ON ss.series_id = s.id
        LEFT JOIN episodes e ON e.series_id = s.id
        ${seriesWhere}
        GROUP BY s.id
        ORDER BY s.title ASC
        LIMIT ? OFFSET ?
      `).all(...seriesParams, limitNum, offset);
      seriesList = rawSeries.map(deserializeSeries);
    }

    // Fetch franchises
    const rawFranchises = await db.prepare(`
      SELECT f.*, COUNT(m.id) as item_count
      FROM franchises f
      LEFT JOIN media_items m ON m.franchise_id = f.id
      WHERE 1=1 ${franchiseWhere}
      GROUP BY f.id
      HAVING item_count > 0
      ORDER BY f.name ASC
    `).all(...franchiseParams);
    const franchises: Franchise[] = rawFranchises.map((f) => ({
      id: f.id as number,
      name: f.name as string,
      tmdbCollectionId: f.tmdb_collection_id as number | undefined,
      posterPath: f.poster_path as string | undefined,
      backdropPath: f.backdrop_path as string | undefined,
      overview: f.overview as string | undefined,
      itemCount: f.item_count as number,
    }));

    // Category summaries
    const movieCountRow = await db.prepare('SELECT COUNT(*) as c FROM media_items').get();
    const seriesCountRow = await db.prepare('SELECT COUNT(*) as c FROM series').get();
    const animMovieRow = await db.prepare('SELECT COUNT(*) as c FROM media_items WHERE is_animated=1').get();
    const animSeriesRow = await db.prepare('SELECT COUNT(*) as c FROM series WHERE is_animated=1').get();
    const franchiseRow = await db.prepare(`
      SELECT COUNT(*) as c FROM franchises WHERE (SELECT COUNT(*) FROM media_items WHERE franchise_id=franchises.id) > 0
    `).get();

    const movieCount = (movieCountRow?.c as number) ?? 0;
    const seriesCount = (seriesCountRow?.c as number) ?? 0;
    const animMovieCount = (animMovieRow?.c as number) ?? 0;
    const animSeriesCount = (animSeriesRow?.c as number) ?? 0;
    const franchiseCount = (franchiseRow?.c as number) ?? 0;

    const categories: CategorySummary[] = [
      { key: 'movie',     label: 'Movies',     count: movieCount },
      { key: 'series',    label: 'Series',     count: seriesCount },
      { key: 'animated',  label: 'Animated',   count: animMovieCount + animSeriesCount },
      { key: 'franchise', label: 'Franchises', count: franchiseCount },
    ];

    // Language list from actual content
    let rawLangs: { code: string }[] = [];
    try {
      rawLangs = await db.prepare(`
        SELECT DISTINCT json_each.value as code
        FROM media_items, json_each(media_items.languages)
        UNION
        SELECT DISTINCT json_each.value as code
        FROM series, json_each(series.languages)
        ORDER BY code
      `).all() as unknown as { code: string }[];
    } catch {
      rawLangs = [{ code: 'en' }];
    }

    const langNames: Record<string, string> = {
      en: 'English', hi: 'Hindi', bn: 'Bengali', ta: 'Tamil', te: 'Telugu',
      ml: 'Malayalam', kn: 'Kannada', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati',
      ur: 'Urdu', fr: 'French', de: 'German', ja: 'Japanese', ko: 'Korean',
      zh: 'Chinese', es: 'Spanish', it: 'Italian', pt: 'Portuguese', ru: 'Russian',
      ar: 'Arabic', tr: 'Turkish', th: 'Thai', id: 'Indonesian', nl: 'Dutch',
    };
    const languages: Language[] = rawLangs.map(({ code }) => ({
      code,
      name: langNames[code] ?? code.toUpperCase(),
    }));

    const totalCount = movieCount + seriesCount;

    const response: LibraryResponse = {
      movies,
      series: seriesList,
      franchises,
      categories,
      languages,
      totalCount,
    };

    res.json(response);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/library/movies ────────────────────────────────────────────────
libraryRouter.get('/movies', async (req, res) => {
  try {
    const db = getDb();
    const { language, animated } = req.query as Record<string, string>;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (language) { conds.push(`languages LIKE ?`); params.push(`%"${language}"%`); }
    if (animated === '1') { conds.push(`is_animated=1`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await db.prepare(`SELECT * FROM media_items ${where} ORDER BY title ASC`).all(...params);
    res.json(rows.map(deserializeMovie));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/library/series ────────────────────────────────────────────────
libraryRouter.get('/series', async (req, res) => {
  try {
    const db = getDb();
    const { language, animated } = req.query as Record<string, string>;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (language) { conds.push(`s.languages LIKE ?`); params.push(`%"${language}"%`); }
    if (animated === '1') { conds.push(`s.is_animated=1`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await db.prepare(`
      SELECT s.*, COUNT(DISTINCT ss.id) as season_count, COUNT(DISTINCT e.id) as episode_count
      FROM series s
      LEFT JOIN seasons ss ON ss.series_id=s.id
      LEFT JOIN episodes e ON e.series_id=s.id
      ${where}
      GROUP BY s.id ORDER BY s.title ASC
    `).all(...params);
    res.json(rows.map(deserializeSeries));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/library/series/:id ────────────────────────────────────────────
libraryRouter.get('/series/:id', async (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);

    const seriesRow = await db.prepare(`
      SELECT s.*, COUNT(DISTINCT ss.id) as season_count, COUNT(DISTINCT e.id) as episode_count
      FROM series s
      LEFT JOIN seasons ss ON ss.series_id=s.id
      LEFT JOIN episodes e ON e.series_id=s.id
      WHERE s.id=? GROUP BY s.id
    `).get(id);

    if (!seriesRow) {
      res.status(404).json({ error: 'Series not found' });
      return;
    }

    const seasons = await db.prepare('SELECT * FROM seasons WHERE series_id=? ORDER BY season_number').all(id);
    const seasonDetails = await Promise.all(
      seasons.map(async (season) => {
        const episodes = await db.prepare(`
          SELECT * FROM episodes WHERE season_id=? ORDER BY episode_number
        `).all(season.id as number);
        return {
          id: season.id as number,
          seriesId: season.series_id as number,
          seasonNumber: season.season_number as number,
          title: season.title as string | undefined,
          episodeCount: episodes.length,
          episodes: episodes.map(deserializeEpisode),
        };
      })
    );

    res.json({
      ...deserializeSeries(seriesRow),
      seasons: seasonDetails,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/library/movies/:id ────────────────────────────────────────────
libraryRouter.get('/movies/:id', async (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const row = await db.prepare('SELECT * FROM media_items WHERE id=?').get(id);
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(deserializeMovie(row));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── Deserialization helpers ──────────────────────────────────────────────────

function deserializeMovie(row: Record<string, unknown>): MediaItem {
  return {
    id: Number(row.id),
    title: String(row.title ?? ''),
    year: row.year ? Number(row.year) : undefined,
    overview: row.overview ? String(row.overview) : undefined,
    posterPath: row.poster_path ? String(row.poster_path) : undefined,
    backdropPath: row.backdrop_path ? String(row.backdrop_path) : undefined,
    tmdbId: row.tmdb_id ? Number(row.tmdb_id) : undefined,
    tmdbRating: row.tmdb_rating ? Number(row.tmdb_rating) : undefined,
    languages: safeParseJson(row.languages as string, []),
    isAnimated: Boolean(row.is_animated),
    isSeries: false,
    duration: row.duration ? Number(row.duration) : undefined,
    filePath: String(row.file_path ?? ''),
    fileSize: Number(row.file_size ?? 0),
    mimeType: String(row.mime_type ?? 'video/mp4'),
    audioTracks: safeParseJson(row.audio_tracks as string, []),
    subtitleTracks: safeParseJson(row.subtitle_tracks as string, []),
    needsTranscode: Boolean(row.needs_transcode),
    franchiseId: row.franchise_id ? Number(row.franchise_id) : undefined,
    franchiseOrder: row.franchise_order ? Number(row.franchise_order) : undefined,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

function deserializeSeries(row: Record<string, unknown>): Series {
  return {
    id: Number(row.id),
    title: String(row.title ?? ''),
    year: row.year ? Number(row.year) : undefined,
    overview: row.overview ? String(row.overview) : undefined,
    posterPath: row.poster_path ? String(row.poster_path) : undefined,
    backdropPath: row.backdrop_path ? String(row.backdrop_path) : undefined,
    tmdbId: row.tmdb_id ? Number(row.tmdb_id) : undefined,
    languages: safeParseJson(row.languages as string, []),
    isAnimated: Boolean(row.is_animated),
    seasonCount: Number(row.season_count ?? 0),
    episodeCount: Number(row.episode_count ?? 0),
    franchiseId: row.franchise_id ? Number(row.franchise_id) : undefined,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

function deserializeEpisode(row: Record<string, unknown>): Episode {
  return {
    id: Number(row.id),
    seriesId: Number(row.series_id),
    seasonId: Number(row.season_id),
    seasonNumber: Number(row.season_number ?? 1),
    episodeNumber: Number(row.episode_number ?? 1),
    title: row.title ? String(row.title) : undefined,
    overview: row.overview ? String(row.overview) : undefined,
    duration: row.duration ? Number(row.duration) : undefined,
    filePath: String(row.file_path ?? ''),
    fileSize: Number(row.file_size ?? 0),
    mimeType: String(row.mime_type ?? 'video/mp4'),
    audioTracks: safeParseJson(row.audio_tracks as string, []),
    subtitleTracks: safeParseJson(row.subtitle_tracks as string, []),
    needsTranscode: Boolean(row.needs_transcode),
    createdAt: String(row.created_at ?? ''),
  };
}

function safeParseJson<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try { return JSON.parse(val) as T; } catch { return fallback; }
}
