import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/database.js';
import { config } from '../config.js';
import type { FileTreeNode, ControlStats, MediaOverrideInput } from '../../shared/types.js';

export const controlRouter = Router();

const SUPPORTED_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi',
  '.wmv', '.flv', '.f4v', '.ts', '.m2ts', '.mts',
  '.vob', '.mpg', '.mpeg', '.m2v', '.3gp', '.ogv',
  '.divx', '.xvid', '.asf', '.rm', '.rmvb', '.mxf', '.wtv',
]);

const IGNORE_DIRS = new Set([
  '$recycle.bin', 'system volume information', '.trashes',
  '.trash-1000', '.spotlight-v100', '.fseventsd', '.git',
  'node_modules', '$winre_backup_partition.marker',
  'recycler', 'config.msi', '.temporaryitems', 'lost.dir',
]);

// ── GET /api/control/tree ────────────────────────────────────────────────────
controlRouter.get('/tree', async (req, res) => {
  try {
    const db = getDb();
    const rootPath = (req.query.path as string) || process.env.MEDIA_STORAGE_PATH || config.mediaStoragePath;

    if (!fs.existsSync(rootPath)) {
      res.status(404).json({ error: `Media storage path does not exist: ${rootPath}` });
      return;
    }

    // 1. Fetch all path controls from DB
    const controlsRows = await db.prepare('SELECT path, is_excluded, is_directory FROM path_controls').all();
    const excludedPaths = new Set<string>();
    const includedPaths = new Set<string>();
    const excludedDirPrefixes: string[] = [];

    for (const row of controlsRows) {
      const p = String(row.path).replace(/\\/g, '/');
      const isEx = Number(row.is_excluded) === 1;
      const isDir = Number(row.is_directory) === 1;
      if (isEx) {
        excludedPaths.add(p);
        if (isDir) excludedDirPrefixes.push(p);
      } else {
        includedPaths.add(p);
      }
    }

    // Sort excludedDirPrefixes by length descending so most specific matches first
    excludedDirPrefixes.sort((a, b) => b.length - a.length);

    // 2. Fetch all indexed movies & episodes for quick metadata lookup
    const moviesRows = await db.prepare(`
      SELECT m.id, m.title, m.year, m.is_animated, m.languages, m.file_path, m.file_size,
             m.is_excluded, f.name as franchise_name
      FROM media_items m
      LEFT JOIN franchises f ON m.franchise_id = f.id
    `).all();

    const moviesByPath = new Map<string, any>();
    for (const m of moviesRows) {
      const p = String(m.file_path).replace(/\\/g, '/');
      moviesByPath.set(p, m);
    }

    const episodesRows = await db.prepare(`
      SELECT e.id, e.title, e.file_path, e.file_size, e.is_excluded,
             s.id as series_id, s.title as series_title, s.year, s.is_animated, s.languages
      FROM episodes e
      JOIN series s ON e.series_id = s.id
    `).all();

    const episodesByPath = new Map<string, any>();
    for (const e of episodesRows) {
      const p = String(e.file_path).replace(/\\/g, '/');
      episodesByPath.set(p, e);
    }

    // 3. Stats tracking
    let totalFiles = 0;
    let totalMediaFiles = 0;
    let includedMediaFiles = 0;
    let excludedMediaFiles = 0;
    let totalDirectories = 0;

    // Helper to determine if a path is excluded
    const checkIsExcluded = (filePath: string): boolean => {
      const norm = filePath.replace(/\\/g, '/');
      // Explicit inclusion overrides directory exclusion
      if (includedPaths.has(norm)) return false;
      // Direct exclusion
      if (excludedPaths.has(norm)) return true;
      // Database is_excluded flag
      const movie = moviesByPath.get(norm);
      if (movie && Number(movie.is_excluded) === 1) return true;
      const ep = episodesByPath.get(norm);
      if (ep && Number(ep.is_excluded) === 1) return true;
      // Directory prefix match
      for (const prefix of excludedDirPrefixes) {
        if (norm === prefix || norm.startsWith(`${prefix}/`)) {
          return true;
        }
      }
      return false;
    };

    // 4. Recursive tree builder
    const buildTree = (currentPath: string): FileTreeNode => {
      const normCurrent = currentPath.replace(/\\/g, '/');
      const baseName = path.basename(currentPath) || currentPath;
      let entries: fs.Dirent[] = [];

      try {
        entries = fs.readdirSync(currentPath, { withFileTypes: true });
      } catch {
        // Return empty directory node if unreadable
        return {
          id: normCurrent,
          name: baseName,
          path: currentPath,
          isDirectory: true,
          isMedia: false,
          isExcluded: checkIsExcluded(currentPath),
          totalMediaCount: 0,
          excludedMediaCount: 0,
          children: [],
        };
      }

      totalDirectories++;
      const children: FileTreeNode[] = [];
      let dirTotalMedia = 0;
      let dirExcludedMedia = 0;

      // Sort: folders first, then alphabetical
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });

      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name.startsWith('._')) continue;
        if (IGNORE_DIRS.has(entry.name.toLowerCase())) continue;

        const fullPath = path.join(currentPath, entry.name);
        const normFullPath = fullPath.replace(/\\/g, '/');

        let isDir = entry.isDirectory();
        if (entry.isSymbolicLink()) {
          try {
            isDir = fs.statSync(fullPath).isDirectory();
          } catch {
            continue;
          }
        }

        if (isDir) {
          const subDirNode = buildTree(fullPath);
          dirTotalMedia += subDirNode.totalMediaCount;
          dirExcludedMedia += subDirNode.excludedMediaCount;
          children.push(subDirNode);
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          totalFiles++;
          const ext = path.extname(entry.name).toLowerCase();
          const isMedia = SUPPORTED_EXTENSIONS.has(ext);

          let statSize = 0;
          try {
            statSize = fs.statSync(fullPath).size;
          } catch {}

          if (isMedia) {
            totalMediaFiles++;
            const isEx = checkIsExcluded(fullPath);
            if (isEx) {
              excludedMediaFiles++;
              dirExcludedMedia++;
            } else {
              includedMediaFiles++;
            }
            dirTotalMedia++;

            const movie = moviesByPath.get(normFullPath);
            const ep = episodesByPath.get(normFullPath);

            let languages: string[] | undefined;
            try {
              if (movie?.languages) languages = JSON.parse(movie.languages);
              else if (ep?.languages) languages = JSON.parse(ep.languages);
            } catch {}

            children.push({
              id: normFullPath,
              name: entry.name,
              path: fullPath,
              isDirectory: false,
              size: statSize,
              extension: ext,
              isMedia: true,
              isExcluded: isEx,
              mediaType: movie ? 'movie' : ep ? 'episode' : undefined,
              mediaId: movie ? Number(movie.id) : ep ? Number(ep.id) : undefined,
              title: movie?.title ?? ep?.title,
              year: movie?.year ?? ep?.year,
              isAnimated: movie ? Boolean(movie.is_animated) : ep ? Boolean(ep.is_animated) : undefined,
              languages,
              franchiseName: movie?.franchise_name,
              totalMediaCount: 1,
              excludedMediaCount: isEx ? 1 : 0,
            });
          } else {
            // Non-media file
            children.push({
              id: normFullPath,
              name: entry.name,
              path: fullPath,
              isDirectory: false,
              size: statSize,
              extension: ext,
              isMedia: false,
              isExcluded: false,
              totalMediaCount: 0,
              excludedMediaCount: 0,
            });
          }
        }
      }

      const isDirFullyExcluded = dirTotalMedia > 0 && dirExcludedMedia === dirTotalMedia;

      return {
        id: normCurrent,
        name: baseName,
        path: currentPath,
        isDirectory: true,
        isMedia: false,
        isExcluded: isDirFullyExcluded,
        totalMediaCount: dirTotalMedia,
        excludedMediaCount: dirExcludedMedia,
        children,
      };
    };

    const tree = buildTree(rootPath);

    const stats: ControlStats = {
      rootPath,
      totalFiles,
      totalMediaFiles,
      includedMediaFiles,
      excludedMediaFiles,
      totalDirectories,
    };

    res.json({ tree, stats });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Control] Error building tree:', msg);
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/control/toggle ─────────────────────────────────────────────────
// Toggles exclusion for files or whole directories
controlRouter.post('/toggle', async (req, res) => {
  try {
    const db = getDb();
    const { path: reqPath, paths: reqPaths, isExcluded, isDirectory } = req.body as {
      path?: string;
      paths?: string[];
      isExcluded: boolean;
      isDirectory?: boolean;
    };

    const targets: string[] = [];
    if (reqPath) targets.push(reqPath);
    if (Array.isArray(reqPaths)) targets.push(...reqPaths);

    if (targets.length === 0) {
      res.status(400).json({ error: 'No path specified' });
      return;
    }

    const exVal = isExcluded ? 1 : 0;
    const now = new Date().toISOString();

    for (const target of targets) {
      const isDir = Boolean(isDirectory || (fs.existsSync(target) && fs.statSync(target).isDirectory()));
      const normTarget = target.replace(/\\/g, '/');

      // 1. Persist rule in path_controls table (normalized path for consistent cross-platform matching)
      await db.execute({
        sql: `INSERT INTO path_controls (path, is_excluded, is_directory, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(path) DO UPDATE SET is_excluded=excluded.is_excluded, is_directory=excluded.is_directory, updated_at=excluded.updated_at`,
        args: [normTarget, exVal, isDir ? 1 : 0, now, now],
      });

      // 2. Update media_items and episodes in database
      if (isDir) {
        // Directory toggle: updates all files inside this directory tree
        const prefixSlash = `${normTarget}/%`;
        const prefixBackslash = `${normTarget.replace(/\//g, '\\')}\\%`;

        await db.execute({
          sql: `UPDATE media_items SET is_excluded = ?, updated_at = ?
                WHERE file_path LIKE ? OR file_path LIKE ? OR file_path = ? OR file_path = ?`,
          args: [exVal, now, prefixSlash, prefixBackslash, target, normTarget],
        });

        await db.execute({
          sql: `UPDATE episodes SET is_excluded = ?, updated_at = ?
                WHERE file_path LIKE ? OR file_path LIKE ? OR file_path = ? OR file_path = ?`,
          args: [exVal, now, prefixSlash, prefixBackslash, target, normTarget],
        });
      } else {
        // Single file toggle
        await db.execute({
          sql: `UPDATE media_items SET is_excluded = ?, updated_at = ? WHERE file_path = ? OR file_path = ?`,
          args: [exVal, now, target, normTarget],
        });

        await db.execute({
          sql: `UPDATE episodes SET is_excluded = ?, updated_at = ? WHERE file_path = ? OR file_path = ?`,
          args: [exVal, now, target, normTarget],
        });
      }

      // 3. Keep series in sync with child episodes
      await db.execute({
        sql: `UPDATE series SET is_excluded = CASE
                WHEN (SELECT COUNT(*) FROM episodes WHERE series_id = series.id AND is_excluded = 0) = 0 THEN 1
                ELSE 0
              END, updated_at = ?`,
        args: [now],
      });
    }

    res.json({ ok: true, count: targets.length, isExcluded });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Control] Toggle error:', msg);
    res.status(500).json({ error: msg });
  }
});

// ── PUT /api/control/media/:type/:id ─────────────────────────────────────────
// Manual metadata & categorization overrides
controlRouter.put('/media/:type/:id', async (req, res) => {
  try {
    const db = getDb();
    const { type, id: rawId } = req.params;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID' }); return; }

    const body = req.body as MediaOverrideInput;
    const now = new Date().toISOString();

    if (type === 'movie') {
      const existing = await db.prepare('SELECT * FROM media_items WHERE id=?').get(id);
      if (!existing) { res.status(404).json({ error: 'Movie not found' }); return; }

      let franchiseId = existing.franchise_id as number | null;

      if (body.franchiseName !== undefined) {
        if (!body.franchiseName.trim()) {
          franchiseId = null;
        } else {
          // Find or create franchise
          let fRow = await db.prepare('SELECT id FROM franchises WHERE name=?').get(body.franchiseName.trim());
          if (!fRow) {
            const ins = await db.run('INSERT INTO franchises (name, created_at, updated_at) VALUES (?,?,?)', body.franchiseName.trim(), now, now);
            franchiseId = ins.lastInsertRowid;
          } else {
            franchiseId = Number(fRow.id);
          }
        }
      }

      await db.execute({
        sql: `UPDATE media_items SET
                title = COALESCE(?, title),
                year = COALESCE(?, year),
                is_animated = COALESCE(?, is_animated),
                languages = COALESCE(?, languages),
                franchise_id = ?,
                updated_at = ?
              WHERE id = ?`,
        args: [
          body.title ?? null,
          body.year ?? null,
          body.isAnimated !== undefined ? (body.isAnimated ? 1 : 0) : null,
          body.languages ? JSON.stringify(body.languages) : null,
          franchiseId,
          now,
          id,
        ],
      });

      res.json({ ok: true, message: 'Movie updated successfully' });
    } else if (type === 'series') {
      const existing = await db.prepare('SELECT * FROM series WHERE id=?').get(id);
      if (!existing) { res.status(404).json({ error: 'Series not found' }); return; }

      await db.execute({
        sql: `UPDATE series SET
                title = COALESCE(?, title),
                year = COALESCE(?, year),
                is_animated = COALESCE(?, is_animated),
                languages = COALESCE(?, languages),
                updated_at = ?
              WHERE id = ?`,
        args: [
          body.title ?? null,
          body.year ?? null,
          body.isAnimated !== undefined ? (body.isAnimated ? 1 : 0) : null,
          body.languages ? JSON.stringify(body.languages) : null,
          now,
          id,
        ],
      });

      res.json({ ok: true, message: 'Series updated successfully' });
    } else if (type === 'episode') {
      const existing = await db.prepare('SELECT * FROM episodes WHERE id=?').get(id);
      if (!existing) { res.status(404).json({ error: 'Episode not found' }); return; }

      await db.execute({
        sql: `UPDATE episodes SET
                title = COALESCE(?, title),
                updated_at = ?
              WHERE id = ?`,
        args: [body.title ?? null, now, id],
      });

      res.json({ ok: true, message: 'Episode updated successfully' });
    } else {
      res.status(400).json({ error: 'Invalid media type' });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/control/reset ──────────────────────────────────────────────────
// Resets all exclusions back to included
controlRouter.post('/reset', async (_req, res) => {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    await db.execute('DELETE FROM path_controls');
    await db.execute({ sql: `UPDATE media_items SET is_excluded = 0, updated_at = ?`, args: [now] });
    await db.execute({ sql: `UPDATE episodes SET is_excluded = 0, updated_at = ?`, args: [now] });
    await db.execute({ sql: `UPDATE series SET is_excluded = 0, updated_at = ?`, args: [now] });
    res.json({ ok: true, message: 'All exclusions reset to included' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
