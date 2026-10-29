/**
 * Core Scanner Engine — async version using @libsql/client
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { getDb } from '../db/database.js';
import { parseMediaPath } from './parser.js';
import { probeFile } from './ffprobe.js';
import { enrichMovie, enrichSeries } from './tmdb.js';
import type { ScanStatus, SubtitleTrack } from '../../shared/types.js';

const SUPPORTED_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi',
  '.wmv', '.flv', '.f4v', '.ts', '.m2ts', '.mts',
  '.vob', '.mpg', '.mpeg', '.m2v', '.3gp', '.ogv',
  '.divx', '.xvid', '.asf', '.rm', '.rmvb', '.mxf', '.wtv',
]);

export class MediaScanner extends EventEmitter {
  private _status: ScanStatus = {
    running: false,
    progress: 0,
    scannedCount: 0,
    totalFound: 0,
    errors: [],
  };

  get status(): ScanStatus {
    return { ...this._status };
  }

  async scan(rootPath: string, options: { force?: boolean } = {}): Promise<void> {
    if (this._status.running) {
      throw new Error('Scan already in progress');
    }

    const force = Boolean(options.force);
    const db = getDb();
    const startedAt = new Date().toISOString();

    const logResult = await db.execute({
      sql: `INSERT INTO scan_log (started_at, status) VALUES (?, 'running')`,
      args: [startedAt],
    });
    const logId = Number(logResult.lastInsertRowid);

    this._status = {
      running: true, progress: 0, scannedCount: 0, totalFound: 0,
      startedAt, errors: [],
    };
    this.emit('status', this._status);

    try {
      if (!fs.existsSync(rootPath)) {
        throw new Error(`Media storage path does not exist: ${rootPath}`);
      }

      this.emit('log', `Collecting files from ${rootPath}...`);
      const allFiles = this.collectFiles(rootPath);
      this._status.totalFound = allFiles.length;
      this.emit('log', `Found ${allFiles.length} media files`);
      this.emit('status', this._status);

      for (let i = 0; i < allFiles.length; i++) {
        const filePath = allFiles[i];
        this._status.currentFile = filePath;
        this._status.progress = Math.round(((i + 1) / allFiles.length) * 100);
        this.emit('status', this._status);

        try {
          await this.processFile(filePath, force);
          this._status.scannedCount++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this._status.errors.push(`[${path.basename(filePath)}] ${msg}`);
          this.emit('log', `Error processing ${filePath}: ${msg}`);
        }
      }

      this.emit('log', 'Resolving franchise collections...');
      await this.resolveFranchises();

      const completedAt = new Date().toISOString();
      this._status.running = false;
      this._status.progress = 100;
      this._status.completedAt = completedAt;

      await db.execute({
        sql: `UPDATE scan_log SET status='completed', completed_at=?, scanned_count=?, error_count=?, errors=? WHERE id=?`,
        args: [completedAt, this._status.scannedCount, this._status.errors.length, JSON.stringify(this._status.errors), logId],
      });

      this.emit('log', `Scan complete. Processed ${this._status.scannedCount}/${allFiles.length} files.`);
      this.emit('status', this._status);
      this.emit('complete', this._status);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._status.running = false;
      this._status.errors.push(msg);
      await db.execute({
        sql: `UPDATE scan_log SET status='failed', completed_at=?, errors=? WHERE id=?`,
        args: [new Date().toISOString(), JSON.stringify(this._status.errors), logId],
      });
      this.emit('error', new Error(msg));
      this.emit('status', this._status);
    }
  }

  private collectFiles(dir: string): string[] {
    const results: string[] = [];
    const IGNORE_DIRS = new Set([
      '$recycle.bin', 'system volume information', '.trashes',
      '.trash-1000', '.spotlight-v100', '.fseventsd', '.git',
      'node_modules', '$winre_backup_partition.marker',
      'recycler', 'config.msi', '.temporaryitems', 'lost.dir',
    ]);

    const walk = (current: string) => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(current, { withFileTypes: true }); }
      catch { return; }

      for (const entry of entries) {
        // Skip hidden dotfiles, macOS AppleDouble resource forks, and system recovery dirs
        if (entry.name.startsWith('.') || entry.name.startsWith('._')) continue;
        if (IGNORE_DIRS.has(entry.name.toLowerCase())) continue;

        const fullPath = path.join(current, entry.name);

        let isDir = entry.isDirectory();
        if (entry.isSymbolicLink()) {
          try {
            isDir = fs.statSync(fullPath).isDirectory();
          } catch {
            continue;
          }
        }

        if (isDir) {
          walk(fullPath);
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.has(ext)) {
            // Filter out empty / 0-byte corrupted files (< 1KB)
            try {
              const stat = fs.statSync(fullPath);
              if (stat.size >= 1024) {
                results.push(fullPath);
              }
            } catch {
              results.push(fullPath);
            }
          }
        }
      }
    };
    walk(dir);
    return results;
  }

  private async processFile(filePath: string, force = false): Promise<void> {
    const db = getDb();
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    // Check if already indexed unchanged (unless force rescan requested)
    if (!force) {
      const existingMovie = await db.execute({ sql: 'SELECT id, file_size FROM media_items WHERE file_path=?', args: [filePath] });
      const existingEpisode = await db.execute({ sql: 'SELECT id, file_size FROM episodes WHERE file_path=?', args: [filePath] });

      if (existingMovie.rows.length > 0 && Number(existingMovie.rows[0].file_size) === fileSize) return;
      if (existingEpisode.rows.length > 0 && Number(existingEpisode.rows[0].file_size) === fileSize) return;
    }

    const parsed = parseMediaPath(filePath);

    let probe;
    try { probe = await probeFile(filePath); }
    catch {
      probe = { duration: 0, mimeType: 'video/mp4', audioTracks: [], subtitleTracks: [], needsTranscode: false, container: '', videoCodec: '' };
    }

    const externalSubs = this.findExternalSubtitles(filePath);
    probe.subtitleTracks.push(...externalSubs);

    // Merge audio track languages into parsed languages
    const langSet = new Set<string>(parsed.languages);
    for (const track of probe.audioTracks) {
      if (track.language && track.language.length >= 2) {
        langSet.add(track.language.toLowerCase().slice(0, 2));
      }
    }
    parsed.languages = Array.from(langSet);

    if (parsed.isSeries) {
      await db.execute({ sql: 'DELETE FROM media_items WHERE file_path=?', args: [filePath] });
      await this.upsertEpisode(filePath, fileSize, parsed, probe);
    } else {
      await db.execute({ sql: 'DELETE FROM episodes WHERE file_path=?', args: [filePath] });
      await this.upsertMovie(filePath, fileSize, parsed, probe);
    }
  }

  private async upsertMovie(
    filePath: string, fileSize: number,
    parsed: ReturnType<typeof parseMediaPath>,
    probe: Awaited<ReturnType<typeof probeFile>>,
  ): Promise<void> {
    const db = getDb();
    const meta = await enrichMovie(parsed.title, parsed.year);
    const isAnimated = parsed.isAnimated || (meta.isAnimated ?? false);

    let franchiseId: number | null = null;
    const franchiseName = meta.tmdbCollectionName ?? parsed.franchiseHint;
    if (franchiseName) {
      franchiseId = await this.ensureFranchise(franchiseName, {
        tmdbCollectionId: meta.tmdbCollectionId,
        posterPath: meta.tmdbCollectionPoster,
        backdropPath: meta.tmdbCollectionBackdrop,
      });
    }

    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO media_items (
        title, year, overview, poster_path, backdrop_path,
        tmdb_id, tmdb_rating, languages, is_animated,
        duration, file_path, file_size, mime_type,
        audio_tracks, subtitle_tracks, needs_transcode,
        franchise_id, franchise_order, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(file_path) DO UPDATE SET
        title=excluded.title, year=excluded.year, overview=excluded.overview,
        poster_path=excluded.poster_path, backdrop_path=excluded.backdrop_path,
        tmdb_id=excluded.tmdb_id, tmdb_rating=excluded.tmdb_rating,
        languages=excluded.languages, is_animated=excluded.is_animated,
        duration=excluded.duration, file_size=excluded.file_size,
        mime_type=excluded.mime_type, audio_tracks=excluded.audio_tracks,
        subtitle_tracks=excluded.subtitle_tracks, needs_transcode=excluded.needs_transcode,
        franchise_id=excluded.franchise_id,
        franchise_order=COALESCE(excluded.franchise_order, media_items.franchise_order),
        updated_at=excluded.updated_at`,
      args: [
        meta.title ?? parsed.title,
        meta.year ?? parsed.year ?? null,
        meta.overview ?? null,
        meta.posterPath ?? null,
        meta.backdropPath ?? null,
        meta.tmdbId ?? null,
        meta.rating ?? null,
        JSON.stringify(parsed.languages),
        isAnimated ? 1 : 0,
        probe.duration || null,
        filePath, fileSize, probe.mimeType,
        JSON.stringify(probe.audioTracks),
        JSON.stringify(probe.subtitleTracks),
        probe.needsTranscode ? 1 : 0,
        franchiseId,
        parsed.franchiseOrder ?? null,
        now, now,
      ],
    });
  }

  private async upsertEpisode(
    filePath: string, fileSize: number,
    parsed: ReturnType<typeof parseMediaPath>,
    probe: Awaited<ReturnType<typeof probeFile>>,
  ): Promise<void> {
    const db = getDb();

    // Find or create series
    let seriesResult = await db.execute({ sql: 'SELECT id, is_animated FROM series WHERE title=?', args: [parsed.title] });
    let seriesId: number;

    if (seriesResult.rows.length === 0) {
      const meta = await enrichSeries(parsed.title, parsed.year);
      const isAnimated = parsed.isAnimated || (meta.isAnimated ?? false);
      const now = new Date().toISOString();
      const res = await db.execute({
        sql: `INSERT OR IGNORE INTO series (title, year, overview, poster_path, backdrop_path,
          tmdb_id, tmdb_rating, languages, is_animated, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          meta.title ?? parsed.title,
          meta.year ?? parsed.year ?? null,
          meta.overview ?? null,
          meta.posterPath ?? null,
          meta.backdropPath ?? null,
          meta.tmdbId ?? null,
          meta.rating ?? null,
          JSON.stringify(parsed.languages),
          isAnimated ? 1 : 0,
          now, now,
        ],
      });
      // Re-fetch if IGNORE triggered
      if (!res.lastInsertRowid || Number(res.lastInsertRowid) === 0) {
        seriesResult = await db.execute({ sql: 'SELECT id FROM series WHERE title=?', args: [parsed.title] });
        seriesId = Number(seriesResult.rows[0].id);
      } else {
        seriesId = Number(res.lastInsertRowid);
      }
    } else {
      seriesId = Number(seriesResult.rows[0].id);
      // Update languages
      const existing = await db.execute({ sql: 'SELECT languages FROM series WHERE id=?', args: [seriesId] });
      const langs = new Set<string>([
        ...JSON.parse(String(existing.rows[0]?.languages ?? '[]')),
        ...parsed.languages,
      ]);
      await db.execute({
        sql: 'UPDATE series SET languages=?, updated_at=? WHERE id=?',
        args: [JSON.stringify([...langs]), new Date().toISOString(), seriesId],
      });
    }

    // Find or create season
    const seasonNum = parsed.seasonNumber ?? 1;
    let seasonResult = await db.execute({
      sql: 'SELECT id FROM seasons WHERE series_id=? AND season_number=?',
      args: [seriesId, seasonNum],
    });
    let seasonId: number;

    if (seasonResult.rows.length === 0) {
      const res = await db.execute({
        sql: 'INSERT INTO seasons (series_id, season_number) VALUES (?,?)',
        args: [seriesId, seasonNum],
      });
      seasonId = Number(res.lastInsertRowid);
    } else {
      seasonId = Number(seasonResult.rows[0].id);
    }

    const episodeNum = parsed.episodeNumber ?? 1;
    const epTitle = parsed.episodeTitle || `Episode ${episodeNum}`;
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO episodes (
        series_id, season_id, season_number, episode_number, title,
        duration, file_path, file_size, mime_type,
        audio_tracks, subtitle_tracks, needs_transcode, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(file_path) DO UPDATE SET
        season_number=excluded.season_number, episode_number=excluded.episode_number,
        title=excluded.title, duration=excluded.duration, file_size=excluded.file_size,
        mime_type=excluded.mime_type, audio_tracks=excluded.audio_tracks,
        subtitle_tracks=excluded.subtitle_tracks, needs_transcode=excluded.needs_transcode,
        updated_at=excluded.updated_at`,
      args: [
        seriesId, seasonId, seasonNum, episodeNum,
        epTitle,
        probe.duration || null,
        filePath, fileSize, probe.mimeType,
        JSON.stringify(probe.audioTracks),
        JSON.stringify(probe.subtitleTracks),
        probe.needsTranscode ? 1 : 0,
        now, now,
      ],
    });
  }

  private async ensureFranchise(name: string, extra: {
    tmdbCollectionId?: number;
    posterPath?: string;
    backdropPath?: string;
  }): Promise<number> {
    const db = getDb();
    const existing = await db.execute({ sql: 'SELECT id FROM franchises WHERE name=?', args: [name] });
    if (existing.rows.length > 0) {
      const id = Number(existing.rows[0].id);
      if (extra.tmdbCollectionId) {
        await db.execute({
          sql: `UPDATE franchises SET tmdb_collection_id=?,
            poster_path=COALESCE(poster_path,?),
            backdrop_path=COALESCE(backdrop_path,?),
            updated_at=? WHERE id=?`,
          args: [extra.tmdbCollectionId, extra.posterPath ?? null, extra.backdropPath ?? null, new Date().toISOString(), id],
        });
      }
      return id;
    }
    const res = await db.execute({
      sql: `INSERT INTO franchises (name, tmdb_collection_id, poster_path, backdrop_path) VALUES (?,?,?,?)`,
      args: [name, extra.tmdbCollectionId ?? null, extra.posterPath ?? null, extra.backdropPath ?? null],
    });
    return Number(res.lastInsertRowid);
  }

  private async resolveFranchises(): Promise<void> {
    const db = getDb();
    const franchises = await db.execute('SELECT id FROM franchises');
    for (const row of franchises.rows) {
      const id = row.id;
      const movies = await db.execute({
        sql: `SELECT id, year, franchise_order FROM media_items WHERE franchise_id=? ORDER BY franchise_order ASC, year ASC, title ASC`,
        args: [id],
      });
      for (let i = 0; i < movies.rows.length; i++) {
        const movie = movies.rows[i];
        if (!movie.franchise_order) {
          await db.execute({
            sql: 'UPDATE media_items SET franchise_order=? WHERE id=?',
            args: [i + 1, movie.id],
          });
        }
      }
    }
  }

  private findExternalSubtitles(videoPath: string): SubtitleTrack[] {
    const dir = path.dirname(videoPath);
    const base = path.basename(videoPath, path.extname(videoPath));
    const subtitleExts = ['.srt', '.vtt', '.ass', '.ssa', '.sub'];
    const tracks: SubtitleTrack[] = [];

    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return tracks; }

    let idx = 100;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!subtitleExts.includes(ext)) continue;
      if (!entry.name.startsWith(base)) continue;
      const langMatch = entry.name.match(/\.([a-zA-Z]{2,3})\.(srt|vtt|ass|sub)$/i);
      const codec = ext === '.vtt' ? 'webvtt' : ext.slice(1);
      tracks.push({
        index: idx++,
        language: langMatch ? langMatch[1].toLowerCase() : undefined,
        codec,
        isExternal: true,
        filePath: path.join(dir, entry.name),
      });
    }
    return tracks;
  }
}

export const scanner = new MediaScanner();
