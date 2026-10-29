import fs from 'fs';
import path from 'path';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { getDb, initDb } from '../src/server/db/database.js';
import { libraryRouter } from '../src/server/routes/library.js';
import { streamRouter } from '../src/server/routes/stream.js';
import { progressRouter } from '../src/server/routes/progress.js';
import { scanRouter, franchiseRouter, categoriesRouter } from '../src/server/routes/scan.js';
import { controlRouter } from '../src/server/routes/control.js';
import { scanner } from '../src/server/scanner/scanner.js';

const TEST_DIR = path.resolve('./data/test_media');
const TEST_DB = path.resolve('./data/test_telebhaja.db');

// Set environment for test
process.env.DB_PATH = TEST_DB;
process.env.MEDIA_STORAGE_PATH = TEST_DIR;

async function createSampleMedia() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  if (fs.existsSync(TEST_DB)) {
    fs.rmSync(TEST_DB, { force: true });
  }

  // Create folder structure
  const dirs = [
    'English/Inception (2010)',
    'Bengali/Sonar Kella (1974) [Bengali]',
    'Hindi/3 Idiots (2009) [Hin]',
    'Animated/Spirited Away (2001) [Studio Ghibli]',
    'TV Shows/Breaking Bad/Season 01',
    'TV Shows/Breaking Bad/Season 02',
    'TV Shows/Dark/Season 1',
    'Harry Potter [Collection]',
  ];

  for (const d of dirs) {
    fs.mkdirSync(path.join(TEST_DIR, d), { recursive: true });
  }

  // Helper to create dummy video file (10 KB)
  const dummyVideo = Buffer.alloc(10240, 0x42);

  // Standalone movies
  fs.writeFileSync(path.join(TEST_DIR, 'English/Inception (2010)/Inception.2010.1080p.mp4'), dummyVideo);
  fs.writeFileSync(path.join(TEST_DIR, 'Bengali/Sonar Kella (1974) [Bengali]/Sonar.Kella.1974.mp4'), dummyVideo);
  fs.writeFileSync(path.join(TEST_DIR, 'Hindi/3 Idiots (2009) [Hin]/3.Idiots.2009.mp4'), dummyVideo);

  // External subtitle test
  const srtContent = "1\n00:00:01,000 --> 00:00:04,000\nHello World\n\n2\n00:00:05,000 --> 00:00:08,000\nSecond subtitle line\n";
  fs.writeFileSync(path.join(TEST_DIR, 'English/Inception (2010)/Inception.2010.1080p.en.srt'), srtContent);

  // Animated movie
  fs.writeFileSync(path.join(TEST_DIR, 'Animated/Spirited Away (2001) [Studio Ghibli]/Spirited.Away.2001.mkv'), dummyVideo);

  // Franchise movies
  fs.writeFileSync(path.join(TEST_DIR, "Harry Potter [Collection]/01 - Harry Potter and the Sorcerer's Stone (2001).mp4"), dummyVideo);
  fs.writeFileSync(path.join(TEST_DIR, "Harry Potter [Collection]/02 - Harry Potter and the Chamber of Secrets (2002).mp4"), dummyVideo);

  // Multi-file Series: Breaking Bad
  fs.writeFileSync(path.join(TEST_DIR, 'TV Shows/Breaking Bad/Season 01/Breaking.Bad.S01E01.Pilot.mp4'), dummyVideo);
  fs.writeFileSync(path.join(TEST_DIR, 'TV Shows/Breaking Bad/Season 01/Breaking.Bad.S01E02.Cats.in.the.Bag.mp4'), dummyVideo);
  fs.writeFileSync(path.join(TEST_DIR, 'TV Shows/Breaking Bad/Season 02/Breaking.Bad.S02E01.Seven.Thirty.Seven.mp4'), dummyVideo);

  // Multi-file Series: Dark
  fs.writeFileSync(path.join(TEST_DIR, 'TV Shows/Dark/Season 1/01 - Secrets.mkv'), dummyVideo);
  fs.writeFileSync(path.join(TEST_DIR, 'TV Shows/Dark/Season 1/02 - Lies.mkv'), dummyVideo);
}

function makeRequest(
  server: http.Server,
  path: string,
  options: http.RequestOptions = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      reject(new Error('Server not listening'));
      return;
    }

    const req = http.request(
      {
        host: '127.0.0.1',
        port: addr.port,
        path,
        ...options,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      }
    );

    req.on('error', reject);
    if (options.headers?.['Content-Length'] && (options as any).body) {
      req.write((options as any).body);
    } else if ((options as any).body) {
      req.write((options as any).body);
    }
    req.end();
  });
}

async function run() {
  console.log('🎬 Starting Full End-to-End OTT Platform Integration Tests...\n');

  console.log('1. Setting up mock media library...');
  await createSampleMedia();
  console.log('   Sample files and directories created.\n');

  console.log('2. Initializing SQLite Database...');
  await initDb();
  const db = getDb();
  await db.execute('DELETE FROM media_items');
  await db.execute('DELETE FROM episodes');
  await db.execute('DELETE FROM seasons');
  await db.execute('DELETE FROM series');
  await db.execute('DELETE FROM franchises');
  await db.execute('DELETE FROM watch_history');
  await db.execute('DELETE FROM scan_log');
  console.log('   Database schema and tables initialized.\n');

  console.log('3. Running Media Scanner on external path...');
  await scanner.scan(TEST_DIR);
  console.log(`   Scan complete: ${scanner.status.scannedCount} files indexed, ${scanner.status.errors.length} errors.\n`);

  // Start Express test server
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/library',    libraryRouter);
  app.use('/api/stream',     streamRouter);
  app.use('/api/progress',   progressRouter);
  app.use('/api/scan',       scanRouter);
  app.use('/api/franchises', franchiseRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/control',    controlRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      passed++;
      console.log(`  ✅ [PASS] ${name}`);
    } else {
      failed++;
      console.error(`  ❌ [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
    }
  }

  try {
    // Test 1: Categories endpoint
    console.log('4. Testing REST API Endpoints:');
    const catRes = await makeRequest(server, '/api/categories');
    assert(catRes.status === 200, 'GET /api/categories returns 200');
    const categories = JSON.parse(catRes.body);
    assert(categories.some((c: any) => c.key === 'movie' && c.count > 0), 'Categories includes movies count');
    assert(categories.some((c: any) => c.key === 'series' && c.count > 0), 'Categories includes series count');
    assert(categories.some((c: any) => c.key === 'animated' && c.count > 0), 'Categories includes animated count');
    assert(categories.some((c: any) => c.key === 'franchise' && c.count > 0), 'Categories includes franchise count');

    // Test 2: Library endpoint
    const libRes = await makeRequest(server, '/api/library');
    assert(libRes.status === 200, 'GET /api/library returns 200');
    const library = JSON.parse(libRes.body);
    assert(library.movies.length >= 5, `Library has ${library.movies.length} movies (expected >= 5)`);
    assert(library.series.length === 2, `Library has ${library.series.length} series (expected 2)`);
    assert(library.franchises.length >= 1, `Library has ${library.franchises.length} franchise`);

    // Test 3: Language filtering
    const bnRes = await makeRequest(server, '/api/library?language=bn');
    const bnLib = JSON.parse(bnRes.body);
    assert(bnLib.movies.some((m: any) => m.title.includes('Sonar Kella')), 'Language filter for "bn" returns Sonar Kella');

    const hiRes = await makeRequest(server, '/api/library?language=hi');
    const hiLib = JSON.parse(hiRes.body);
    assert(hiLib.movies.some((m: any) => m.title.includes('3 Idiots')), 'Language filter for "hi" returns 3 Idiots');

    // Test 3b: Search functionality (title, multi-word, year, franchise, episode title)
    const searchRes1 = await makeRequest(server, '/api/library?search=Inception');
    assert(searchRes1.status === 200, 'GET /api/library?search=Inception returns 200');
    const searchLib1 = JSON.parse(searchRes1.body);
    assert(searchLib1.movies.some((m: any) => m.title.includes('Inception')), 'Search for "Inception" returns Inception movie');

    const searchResYear = await makeRequest(server, '/api/library?search=Inception%202010');
    assert(searchResYear.status === 200, 'GET /api/library?search=Inception%202010 returns 200');
    const searchLibYear = JSON.parse(searchResYear.body);
    assert(searchLibYear.movies.some((m: any) => m.title.includes('Inception')), 'Search for "Inception 2010" (title + year) returns Inception');

    const searchResHp = await makeRequest(server, '/api/library?search=Harry%20Potter');
    assert(searchResHp.status === 200, 'GET /api/library?search=Harry%20Potter returns 200');
    const searchLibHp = JSON.parse(searchResHp.body);
    assert(searchLibHp.movies.length >= 2, `Search for franchise "Harry Potter" returns ${searchLibHp.movies.length} movies (expected >= 2)`);
    assert(searchLibHp.franchises.length >= 1, 'Search for franchise "Harry Potter" returns matching franchise card');

    const searchResSeries = await makeRequest(server, '/api/library?search=Breaking%20Bad');
    assert(searchResSeries.status === 200, 'GET /api/library?search=Breaking%20Bad returns 200');
    const searchLibSeries = JSON.parse(searchResSeries.body);
    assert(searchLibSeries.series.some((s: any) => s.title.includes('Breaking Bad')), 'Search for "Breaking Bad" returns series');

    const searchResEp = await makeRequest(server, '/api/library?search=Pilot');
    assert(searchResEp.status === 200, 'GET /api/library?search=Pilot returns 200');
    const searchLibEp = JSON.parse(searchResEp.body);
    assert(searchLibEp.series.some((s: any) => s.title.includes('Breaking Bad')), 'Search for episode title "Pilot" returns Breaking Bad series');

    // Test 4: Franchise grouping
    const franRes = await makeRequest(server, '/api/franchises');
    assert(franRes.status === 200, 'GET /api/franchises returns 200');
    const franchises = JSON.parse(franRes.body);
    const hp = franchises.find((f: any) => f.name.includes('Harry Potter'));
    assert(Boolean(hp), 'Franchise list contains "Harry Potter"');
    assert(hp && hp.itemCount === 2, `Harry Potter franchise has 2 movies (got ${hp?.itemCount})`);

    // Test 5: Series detail with nested Seasons & Episodes
    const bbSeries = library.series.find((s: any) => s.title.includes('Breaking Bad'));
    assert(Boolean(bbSeries), 'Breaking Bad series exists');
    const seriesDetailRes = await makeRequest(server, `/api/library/series/${bbSeries.id}`);
    assert(seriesDetailRes.status === 200, 'GET /api/library/series/:id returns 200');
    const bbDetail = JSON.parse(seriesDetailRes.body);
    assert(bbDetail.seasons.length === 2, `Breaking Bad has 2 seasons (got ${bbDetail.seasons.length})`);
    const s1 = bbDetail.seasons.find((s: any) => s.seasonNumber === 1);
    assert(s1 && s1.episodes.length === 2, `Breaking Bad Season 1 has 2 episodes (got ${s1?.episodes.length})`);
    const s2 = bbDetail.seasons.find((s: any) => s.seasonNumber === 2);
    assert(s2 && s2.episodes.length === 1, `Breaking Bad Season 2 has 1 episode (got ${s2?.episodes.length})`);

    // Test 6: HTTP 206 Partial Content Range Streaming
    console.log('\n5. Testing HTTP 206 Byte-Range Streaming Pipeline:');
    const testMovie = library.movies[0];

    // Range request bytes 0-1024
    const rangeRes = await makeRequest(server, `/api/stream/movie/${testMovie.id}`, {
      headers: { Range: 'bytes=0-1024' },
    });
    assert(rangeRes.status === 206, `Range bytes=0-1024 returns HTTP 206 (got ${rangeRes.status})`);
    assert(rangeRes.headers['content-range'] === `bytes 0-1024/${testMovie.fileSize}`, `Content-Range header matches (got ${rangeRes.headers['content-range']})`);
    assert(rangeRes.headers['content-length'] === '1025', `Content-Length header is 1025 (got ${rangeRes.headers['content-length']})`);
    assert(rangeRes.headers['accept-ranges'] === 'bytes', 'Accept-Ranges header is bytes');

    // Range request out-of-bounds bytes 99999- -> HTTP 416
    const invalidRangeRes = await makeRequest(server, `/api/stream/movie/${testMovie.id}`, {
      headers: { Range: 'bytes=99999-' },
    });
    assert(invalidRangeRes.status === 416, `Out of bounds range returns HTTP 416 (got ${invalidRangeRes.status})`);

    // Test 7: Subtitle conversion to WebVTT
    console.log('\n6. Testing Subtitle On-the-Fly WebVTT Streaming:');
    const srtPath = path.join(TEST_DIR, 'English/Inception (2010)/Inception.2010.1080p.en.srt');
    const subRes = await makeRequest(server, `/api/stream/subtitle?path=${encodeURIComponent(srtPath)}`);
    assert(subRes.status === 200, 'GET /api/stream/subtitle returns 200');
    assert(subRes.headers['content-type'] === 'text/vtt', `Subtitle Content-Type is text/vtt (got ${subRes.headers['content-type']})`);
    assert(subRes.body.startsWith('WEBVTT'), 'Subtitle body starts with WEBVTT header');
    assert(subRes.body.includes('00:00:01.000 --> 00:00:04.000'), 'Subtitle commas converted to WebVTT dots');

    // Test 8: Watch Progress Persistence & Heartbeat
    console.log('\n7. Testing Watch Progress & Resume Heartbeat:');
    const postProgRes = await makeRequest(server, `/api/progress/movie/${testMovie.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(JSON.stringify({ positionSeconds: 125, durationSeconds: 600 }))),
      },
      ...({ body: JSON.stringify({ positionSeconds: 125, durationSeconds: 600 }) } as any),
    });
    assert(postProgRes.status === 200, 'POST /api/progress/movie/:id returns 200');

    const getProgRes = await makeRequest(server, `/api/progress/movie/${testMovie.id}`);
    assert(getProgRes.status === 200, 'GET /api/progress/movie/:id returns 200');
    const progress = JSON.parse(getProgRes.body);
    assert(progress.positionSeconds === 125, `Saved position is 125 (got ${progress.positionSeconds})`);
    assert(progress.percentComplete === 21, `Percent complete is 21% (got ${progress.percentComplete})`);

    const recentRes = await makeRequest(server, '/api/progress/recent/all');
    assert(recentRes.status === 200, 'GET /api/progress/recent/all returns 200');
    const recent = JSON.parse(recentRes.body);
    assert(recent.movies.some((m: any) => m.mediaId === testMovie.id), 'Recent watches includes updated movie');

    // Test 9: Content Control & Categorization Portal
    console.log('\n8. Testing Content Control & Categorization Portal:');

    // 8.1 GET /api/control/tree
    const treeRes = await makeRequest(server, '/api/control/tree');
    assert(treeRes.status === 200, 'GET /api/control/tree returns 200');
    const treeData = JSON.parse(treeRes.body);
    assert(Boolean(treeData.tree && treeData.stats), 'Response has tree and stats objects');
    assert(treeData.stats.totalMediaFiles === 11, `Tree reports 11 media files (got ${treeData.stats.totalMediaFiles})`);
    assert(treeData.stats.excludedMediaFiles === 0, `Initial excluded media is 0 (got ${treeData.stats.excludedMediaFiles})`);

    // 8.2 POST /api/control/toggle - Exclude single movie (Inception)
    const inceptionFile = path.join(TEST_DIR, 'English/Inception (2010)/Inception.2010.1080p.mp4');
    const inceptionMovie = library.movies.find((m: any) => m.title === 'Inception');
    assert(Boolean(inceptionMovie), 'Inception movie found in initial library');

    const toggleRes = await makeRequest(server, '/api/control/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: inceptionFile, isExcluded: true }),
    });
    assert(toggleRes.status === 200, 'POST /api/control/toggle returns 200');

    // 8.3 Verify Inception excluded from library
    const libAfterExclude = await makeRequest(server, '/api/library');
    const libAfterData = JSON.parse(libAfterExclude.body);
    assert(!libAfterData.movies.some((m: any) => m.title === 'Inception'), 'Inception is excluded from OTT library');

    // 8.4 Verify Inception streaming returns 404
    const streamExcluded = await makeRequest(server, `/api/stream/movie/${inceptionMovie.id}`);
    assert(streamExcluded.status === 404, 'Streaming excluded movie returns 404 Not Found');

    // 8.5 Verify exclusion persists across rescan
    await scanner.scan(TEST_DIR);
    const libAfterRescan = await makeRequest(server, '/api/library');
    const libAfterRescanData = JSON.parse(libAfterRescan.body);
    assert(!libAfterRescanData.movies.some((m: any) => m.title === 'Inception'), 'Inception remains excluded after rescan');

    // 8.6 Toggle Inception back to included
    const untoggleRes = await makeRequest(server, '/api/control/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: inceptionFile, isExcluded: false }),
    });
    assert(untoggleRes.status === 200, 'POST /api/control/toggle re-including returns 200');
    const libAfterUntoggle = await makeRequest(server, '/api/library');
    const libAfterUntoggleData = JSON.parse(libAfterUntoggle.body);
    assert(libAfterUntoggleData.movies.some((m: any) => m.title === 'Inception'), 'Inception is re-included in OTT library');

    // 8.7 Directory exclusion: Exclude 'English' directory
    const englishDir = path.join(TEST_DIR, 'English');
    const toggleDirRes = await makeRequest(server, '/api/control/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: englishDir, isExcluded: true, isDirectory: true }),
    });
    assert(toggleDirRes.status === 200, 'POST /api/control/toggle on directory returns 200');
    const libAfterDirEx = await makeRequest(server, '/api/library');
    const libAfterDirExData = JSON.parse(libAfterDirEx.body);
    assert(!libAfterDirExData.movies.some((m: any) => m.title === 'Inception'), 'Directory exclusion excludes nested Inception');

    // 8.8 Manual categorization override: PUT /api/control/media/movie/:id
    const sonarMovie = libAfterDirExData.movies.find((m: any) => m.title.includes('Sonar Kella'));
    assert(Boolean(sonarMovie), 'Sonar Kella movie found for manual categorization test');
    if (sonarMovie) {
      const overrideRes = await makeRequest(server, `/api/control/media/movie/${sonarMovie.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'The Golden Fortress',
          year: 1974,
          franchiseName: 'Feluda Mysteries',
          isAnimated: false,
          languages: ['bn', 'en'],
        }),
      });
      assert(overrideRes.status === 200, 'PUT /api/control/media/movie/:id returns 200');

      const updatedLib = await makeRequest(server, '/api/library');
      const updatedLibData = JSON.parse(updatedLib.body);
      const updatedMovie = updatedLibData.movies.find((m: any) => m.id === sonarMovie.id);
      assert(updatedMovie?.title === 'The Golden Fortress', `Movie title updated to "The Golden Fortress" (got ${updatedMovie?.title})`);
      assert(updatedMovie?.franchiseName === 'Feluda Mysteries', `Movie franchise updated to "Feluda Mysteries" (got ${updatedMovie?.franchiseName})`);
    }

    // 8.9 Reset exclusions: POST /api/control/reset
    const resetRes = await makeRequest(server, '/api/control/reset', { method: 'POST' });
    assert(resetRes.status === 200, 'POST /api/control/reset returns 200');
    const treeAfterReset = await makeRequest(server, '/api/control/tree');
    const treeResetData = JSON.parse(treeAfterReset.body);
    assert(treeResetData.stats.excludedMediaFiles === 0, 'All exclusions successfully reset');
    const libAfterReset = await makeRequest(server, '/api/library');
    const libResetData = JSON.parse(libAfterReset.body);
    assert(libResetData.movies.some((m: any) => m.title === 'Inception'), 'Inception restored in library after reset');

  } finally {
    server.close();
    // Cleanup test artifacts
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
      fs.rmSync(TEST_DB, { force: true });
    } catch {}
  }

  console.log(`\n========================================`);
  console.log(`Integration Test Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal Integration Test Error:', err);
  process.exit(1);
});
