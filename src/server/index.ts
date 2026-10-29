import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { getDb, initDb } from './db/database.js';
import { libraryRouter } from './routes/library.js';
import { streamRouter } from './routes/stream.js';
import { progressRouter } from './routes/progress.js';
import { scanRouter, franchiseRouter, categoriesRouter } from './routes/scan.js';
import { controlRouter } from './routes/control.js';
import { scanner } from './scanner/scanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // ── Initialize DB ──────────────────────────────────────────────────────
  const db = getDb();
  await initDb();
  console.log(`[DB] SQLite initialized at ${config.dbPath}`);

  // Prune any orphaned media items whose files no longer exist on disk
  try {
    const pruned = await scanner.pruneMissingMedia();
    if (pruned.movies > 0 || pruned.episodes > 0) {
      console.log(`[Scanner] Pruned ${pruned.movies} missing movies and ${pruned.episodes} missing episodes.`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Scanner] Startup prune warning: ${msg}`);
  }

  // ── Express app ────────────────────────────────────────────────────────
  const app = express();

  app.use(cors({ origin: '*' }));
  app.use(express.json({ limit: '1mb' }));

  // ── API Routes ─────────────────────────────────────────────────────────
  app.use('/api/library',    libraryRouter);
  app.use('/api/stream',     streamRouter);
  app.use('/api/progress',   progressRouter);
  app.use('/api/scan',       scanRouter);
  app.use('/api/franchises', franchiseRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/control',    controlRouter);

  // ── Health check ────────────────────────────────────────────────────────
  app.get('/api/health', async (_req, res) => {
    try {
      const movieRow = await db.prepare('SELECT COUNT(*) as c FROM media_items').get();
      const seriesRow = await db.prepare('SELECT COUNT(*) as c FROM series').get();
      const movieCount = (movieRow?.c as number) ?? 0;
      const seriesCount = (seriesRow?.c as number) ?? 0;
      res.json({
        ok: true,
        version: '1.0.0',
        mediaStoragePath: config.mediaStoragePath,
        movies: movieCount,
        series: seriesCount,
        scanRunning: scanner.status.running,
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // ── Serve static client build in production ────────────────────────────
  const publicDirs = [
    path.resolve(__dirname, '../../dist/public'),
    path.resolve(__dirname, '../public'),
    path.resolve(__dirname, '../../public'),
    path.resolve(process.cwd(), 'dist/public'),
    path.resolve(process.cwd(), 'public'),
  ];
  const publicDir = publicDirs.find((d) => fs.existsSync(path.join(d, 'index.html'))) ?? path.resolve(process.cwd(), 'dist/public');
  app.use(express.static(publicDir));

  // SPA fallback — serve index.html for all non-API routes
  app.get('*', (_req, res) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ error: 'Client build not found. Run npm run build:client first.' });
    }
  });

  // ── Scanner events ─────────────────────────────────────────────────────
  scanner.on('log', (msg: string) => console.log(`[Scanner] ${msg}`));
  scanner.on('error', (err: Error) => console.error(`[Scanner] Error: ${err.message}`));
  scanner.on('complete', (status: unknown) => console.log('[Scanner] Scan complete:', JSON.stringify(status)));

  // ── Start server ────────────────────────────────────────────────────────
  app.listen(config.port, config.host, () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║           🎬  TeleBhaja OTT Platform  🎬             ║
╠══════════════════════════════════════════════════════╣
║  Server  : http://${config.host}:${config.port}               ║
║  LAN URL : http://<YOUR_IP>:${config.port}                    ║
║  Media   : ${config.mediaStoragePaths.join('; ').slice(0, 39).padEnd(39)}║
╚══════════════════════════════════════════════════════╝
    `.trim());

    // Auto-scan on startup
    if (config.scanner.onStartup) {
      console.log('[Scanner] Auto-scan starting across configured drives...');
      scanner.scan(config.mediaStoragePaths).catch((err: Error) => {
        console.error(`[Scanner] Startup scan failed: ${err.message}`);
      });
    }
  });
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});
