import { Router } from 'express';
import path from 'path';
import { getDb } from '../db/database.js';
import { config } from '../config.js';
import type {
  MediaItem, Series, Episode, Franchise, LibraryResponse,
  CategorySummary, Language, StorageDrive, DriveBrowseItem, DriveBrowseResponse,
} from '../../shared/types.js';

export const libraryRouter = Router();

export async function getStorageDrives(): Promise<StorageDrive[]> {
  const db = getDb();
  const configured = config.mediaStoragePaths;
  const drives: StorageDrive[] = [];
  const seenPaths = new Set<string>();

  for (let i = 0; i < configured.length; i++) {
    const rawPath = configured[i];
    const normPath = path.resolve(rawPath);
    const key = normPath.toLowerCase();
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);

    const isPrimary = i === 0;
    const driveLetterMatch = normPath.match(/^([a-zA-Z]:)/);
    const driveLetter = driveLetterMatch ? driveLetterMatch[1].toUpperCase() : '';
    const baseFolderName = path.basename(normPath) || driveLetter;

    const label = isPrimary
      ? `Primary Drive (${driveLetter || normPath})`
      : `Drive ${driveLetter ? driveLetter + ' ' : ''}(${baseFolderName})`;
    const shortLabel = isPrimary
      ? `💾 Primary (${driveLetter || 'D1'})`
      : `💾 Drive ${driveLetter || ('D' + (i + 1))}`;

    const pat1 = `${normPath}%`;
    const pat2 = `${normPath.replace(/\\/g, '/')}%`;

    const movieCountRow = await db.prepare(`
      SELECT COUNT(*) as c FROM media_items
      WHERE is_excluded = 0 AND (file_path LIKE ? OR file_path LIKE ?)
    `).get(pat1, pat2);

    const seriesCountRow = await db.prepare(`
      SELECT COUNT(DISTINCT s.id) as c FROM series s
      JOIN episodes e ON e.series_id = s.id
      WHERE s.is_excluded = 0 AND (e.file_path LIKE ? OR e.file_path LIKE ?)
    `).get(pat1, pat2);

    drives.push({
      id: `drive_${i}`,
      label,
      shortLabel,
      path: normPath,
      isPrimary,
      movieCount: Number(movieCountRow?.c ?? 0),
      seriesCount: Number(seriesCountRow?.c ?? 0),
    });
  }

  // Also check if database contains files on other drives not explicitly in config
  try {
    const otherRoots = await db.prepare(`
      SELECT DISTINCT SUBSTR(file_path, 1, 2) as d
      FROM media_items
      WHERE file_path LIKE '_:\\%'
    `).all();

    for (const r of otherRoots) {
      const dLetter = String(r.d ?? '').toUpperCase();
      if (!dLetter || drives.some((d) => d.path.toUpperCase().startsWith(dLetter))) continue;
      const pat = `${dLetter}\\%`;
      const patSlash = `${dLetter}/%`;
      const mCount = await db.prepare('SELECT COUNT(*) as c FROM media_items WHERE is_excluded = 0 AND (file_path LIKE ? OR file_path LIKE ?)').get(pat, patSlash);
      const sCount = await db.prepare('SELECT COUNT(DISTINCT s.id) as c FROM series s JOIN episodes e ON e.series_id = s.id WHERE s.is_excluded = 0 AND (e.file_path LIKE ? OR e.file_path LIKE ?)').get(pat, patSlash);
      drives.push({
        id: `drive_${drives.length}`,
        label: `Drive ${dLetter}`,
        shortLabel: `💾 Drive ${dLetter}`,
        path: `${dLetter}\\`,
        isPrimary: drives.length === 0,
        movieCount: Number(mCount?.c ?? 0),
        seriesCount: Number(sCount?.c ?? 0),
      });
    }
  } catch {}

  return drives;
}

// ── GET /api/library/drives ────────────────────────────────────────────────
libraryRouter.get('/drives', async (_req, res) => {
  try {
    const drives = await getStorageDrives();
    res.json(drives);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/library/browse ────────────────────────────────────────────────
libraryRouter.get('/browse', async (req, res) => {
  try {
    const db = getDb();
    const { drive: driveParam, subpath: subpathParam } = req.query as Record<string, string>;
    const drives = await getStorageDrives();

    const targetDrive = drives.find((d) => d.id === driveParam || d.path.toLowerCase() === (driveParam ?? '').toLowerCase())
      ?? (drives.length > 1 ? drives[1] : drives[0]);

    if (!targetDrive) {
      res.status(404).json({ error: 'No storage drive found' });
      return;
    }

    const driveRoot = path.resolve(targetDrive.path);
    let currentFolder = driveRoot;
    if (subpathParam && subpathParam.trim()) {
      const resolved = path.resolve(subpathParam.trim());
      if (resolved.toLowerCase().startsWith(driveRoot.toLowerCase())) {
        currentFolder = resolved;
      }
    }

    // Compute breadcrumbs
    const rel = path.relative(driveRoot, currentFolder);
    const breadcrumbs: Array<{ name: string; path: string }> = [
      { name: targetDrive.shortLabel || targetDrive.label, path: driveRoot },
    ];
    if (rel && rel !== '.') {
      const parts = rel.split(path.sep).filter(Boolean);
      let acc = driveRoot;
      for (const part of parts) {
        acc = path.join(acc, part);
        breadcrumbs.push({ name: part, path: acc });
      }
    }

    const normCurrent = currentFolder.replace(/\\/g, '/').toLowerCase();
    const pat1 = `${currentFolder}%`;
    const pat2 = `${currentFolder.replace(/\\/g, '/')}%`;

    const allMovies = await db.prepare(`
      SELECT id, title, file_path, file_size, duration, year, poster_path, mime_type, needs_transcode
      FROM media_items
      WHERE is_excluded = 0 AND (file_path LIKE ? OR file_path LIKE ?)
    `).all(pat1, pat2);

    const allEpisodes = await db.prepare(`
      SELECT e.id, e.title, e.file_path, e.file_size, e.duration, s.year, s.poster_path, e.mime_type, e.needs_transcode
      FROM episodes e
      JOIN series s ON s.id = e.series_id
      WHERE e.is_excluded = 0 AND (e.file_path LIKE ? OR e.file_path LIKE ?)
    `).all(pat1, pat2);

    const folderMap = new Map<string, { name: string; path: string; count: number }>();
    const directFiles: DriveBrowseItem[] = [];

    const checkFile = (row: Record<string, unknown>, isSeries: boolean) => {
      const fp = String(row.file_path);
      const fileDir = path.dirname(fp);
      const normFileDir = fileDir.replace(/\\/g, '/').toLowerCase();

      if (normFileDir === normCurrent) {
        directFiles.push({
          id: Number(row.id),
          title: String(row.title ?? path.basename(fp)),
          filePath: fp,
          fileSize: Number(row.file_size ?? 0),
          duration: row.duration ? Number(row.duration) : undefined,
          year: row.year ? Number(row.year) : undefined,
          posterPath: row.poster_path ? String(row.poster_path) : undefined,
          mimeType: String(row.mime_type ?? 'video/mp4'),
          needsTranscode: Boolean(row.needs_transcode),
          isSeries,
        });
      } else {
        const relPath = path.relative(currentFolder, fileDir);
        const topSub = relPath.split(path.sep)[0];
        if (topSub) {
          const subFullPath = path.join(currentFolder, topSub);
          const existing = folderMap.get(topSub.toLowerCase());
          if (existing) {
            existing.count++;
          } else {
            folderMap.set(topSub.toLowerCase(), {
              name: topSub,
              path: subFullPath,
              count: 1,
            });
          }
        }
      }
    };

    for (const m of allMovies) checkFile(m, false);
    for (const ep of allEpisodes) checkFile(ep, true);

    const folders = Array.from(folderMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    directFiles.sort((a, b) => a.title.localeCompare(b.title));

    res.json({
      driveId: targetDrive.id,
      currentPath: currentFolder,
      breadcrumbs,
      folders,
      files: directFiles,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/library ───────────────────────────────────────────────────────
libraryRouter.get('/', async (req, res) => {
  try {
    const db = getDb();

    const { category, language, search, page = '1', limit, drive } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page, 10));
    // If limit is 'all' or not specified, default to 10000 to show full library without truncation
    const isUnlimited = limit === 'all' || limit === '0';
    const limitNum = isUnlimited
      ? 100000
      : limit ? Math.max(1, parseInt(limit, 10) || 10000) : 10000;
    const offset = isUnlimited ? 0 : (pageNum - 1) * limitNum;

    // Build movie query conditions
    const movieConds: string[] = ['m.is_excluded = 0'];
    const movieParams: unknown[] = [];
    const seriesConds: string[] = ['s.is_excluded = 0'];
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

    if (drive && drive !== 'all') {
      const allDrives = await getStorageDrives();
      const matched = allDrives.find((d) => d.id === drive || d.path.toLowerCase().startsWith(drive.toLowerCase()) || drive.toLowerCase().startsWith(d.path.toLowerCase()));
      if (matched) {
        const dPat1 = `${matched.path}%`;
        const dPat2 = `${matched.path.replace(/\\/g, '/')}%`;
        movieConds.push(`(m.file_path LIKE ? OR m.file_path LIKE ?)`);
        movieParams.push(dPat1, dPat2);
        seriesConds.push(`s.id IN (SELECT DISTINCT series_id FROM episodes WHERE file_path LIKE ? OR file_path LIKE ?)`);
        seriesParams.push(dPat1, dPat2);
      }
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
      LEFT JOIN media_items m ON m.franchise_id = f.id AND m.is_excluded = 0
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
    const movieCountRow = await db.prepare('SELECT COUNT(*) as c FROM media_items WHERE is_excluded = 0').get();
    const seriesCountRow = await db.prepare('SELECT COUNT(*) as c FROM series WHERE is_excluded = 0').get();
    const animMovieRow = await db.prepare('SELECT COUNT(*) as c FROM media_items WHERE is_animated=1 AND is_excluded = 0').get();
    const animSeriesRow = await db.prepare('SELECT COUNT(*) as c FROM series WHERE is_animated=1 AND is_excluded = 0').get();
    const franchiseRow = await db.prepare(`
      SELECT COUNT(*) as c FROM franchises WHERE (SELECT COUNT(*) FROM media_items WHERE franchise_id=franchises.id AND is_excluded = 0) > 0
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
    const conds: string[] = ['is_excluded=0'];
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
    const conds: string[] = ['s.is_excluded=0'];
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
    const row = await db.prepare(`
      SELECT m.*, f.name as franchise_name
      FROM media_items m
      LEFT JOIN franchises f ON m.franchise_id = f.id
      WHERE m.id=?
    `).get(id);
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
    franchiseName: row.franchise_name ? String(row.franchise_name) : undefined,
    franchiseOrder: row.franchise_order ? Number(row.franchise_order) : undefined,
    isExcluded: Boolean(row.is_excluded),
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
    isExcluded: Boolean(row.is_excluded),
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
    isExcluded: Boolean(row.is_excluded),
    createdAt: String(row.created_at ?? ''),
  };
}

function safeParseJson<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try { return JSON.parse(val) as T; } catch { return fallback; }
}
