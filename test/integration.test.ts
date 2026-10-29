import fs from 'fs';
import path from 'path';
import http from 'http';
import express from 'express';
import cors from 'cors';

const TEST_DIR = path.resolve('./data/test_media');
const TEST_DB = path.resolve('./data/test_telebhaja.db');

// Set environment for test BEFORE any database or config access
process.env.DB_PATH = TEST_DB;
process.env.MEDIA_STORAGE_PATH = TEST_DIR;

import { getDb, initDb, resetDbConnection } from '../src/server/db/database.js';
import { libraryRouter } from '../src/server/routes/library.js';
import { streamRouter } from '../src/server/routes/stream.js';
import { progressRouter } from '../src/server/routes/progress.js';
import { scanRouter, franchiseRouter, categoriesRouter } from '../src/server/routes/scan.js';
import { controlRouter } from '../src/server/routes/control.js';
import { scanner } from '../src/server/scanner/scanner.js';

// Reset DB connection so it strictly targets TEST_DB
resetDbConnection();

async function createSampleMedia() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  if (fs.existsSync(TEST_DB)) {
    fs.rmSync(TEST_DB, { force: true });
  }

  // Create folder structure with generic test media
  const dirs = [
    'English/Test Film Feature (2010)',
    'Bengali/Test Classic Drama (1974) [Bengali]',
    'Hindi/Test Comedy Drama (2009) [Hin]',
    'Animated/Test Animated Quest (2001) [Animation]',
    'TV Shows/Crime Drama Series/Season 01',
    'TV Shows/Crime Drama Series/Season 02',
    'TV Shows/Mystery SciFi Show/Season 1',
    'Heroic Journey [Collection]',
  ];

  for (const d of dirs) {
    fs.mkdirSync(path.join(TEST_DIR, d), { recursive: true });
  }

  // Helper to create dummy video file (10 KB)
  const dummyVideo = Buffer.alloc(10240, 0x42);

  // Standalone movies
  fs.writeFileSync(path.join(TEST_DIR, 'English/Test Film Feature (2010)/Test.Film.Feature.2010.1080p.mp4'), dummyVideo);
  fs.writeFileSync(path.join(TEST_DIR, 'Bengali/Test Classic Drama (1974) [Bengali]/Test.Classic.Drama.1974.mp4'), dummyVideo);
  fs.writeFileSync(path.join(TEST_DIR, 'Hindi/Test Comedy Drama (2009) [Hin]/Test.Comedy.Drama.2009.mp4'), dummyVideo);

  // External subtitle test
  const srtContent = "1\n00:00:01,000 --> 00:00:04,000\nHello World\n\n2\n00:00:05,000 --> 00:00:08,000\nSecond subtitle line\n";
  fs.writeFileSync(path.join(TEST_DIR, 'English/Test Film Feature (2010)/Test.Film.Feature.2010.1080p.en.srt'), srtContent);

  // Animated movie
  fs.writeFileSync(path.join(TEST_DIR, 'Animated/Test Animated Quest (2001) [Animation]/Test.Animated.Quest.2001.mkv'), dummyVideo);

  // Franchise movies
  fs.writeFileSync(path.join(TEST_DIR, 'Heroic Journey [Collection]/01 - Heroic Journey Part 1 (2001).mp4'), dummyVideo);
  fs.writeFileSync(path.join(TEST_DIR, 'Heroic Journey [Collection]/02 - Heroic Journey Part 2 (2002).mp4'), dummyVideo);

  // Multi-file Series: Crime Drama Series
  fs.writeFileSync(path.join(TEST_DIR, 'TV Shows/Crime Drama Series/Season 01/Crime.Drama.Series.S01E01.Pilot.mp4'), dummyVideo);
  fs.writeFileSync(path.join(TEST_DIR, 'TV Shows/Crime Drama Series/Season 01/Crime.Drama.Series.S01E02.Episode.Two.mp4'), dummyVideo);
  fs.writeFileSync(path.join(TEST_DIR, 'TV Shows/Crime Drama Series/Season 02/Crime.Drama.Series.S02E01.Premiere.mp4'), dummyVideo);

  // Multi-file Series: Mystery SciFi Show
  fs.writeFileSync(path.join(TEST_DIR, 'TV Shows/Mystery SciFi Show/Season 1/01 - Mystery Secrets.mkv'), dummyVideo);
  fs.writeFileSync(path.join(TEST_DIR, 'TV Shows/Mystery SciFi Show/Season 1/02 - Mystery Lies.mkv'), dummyVideo);
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

  console.log('2. Initializing Isolated Test SQLite Database...');
  await initDb();
  const db = getDb();
  await db.execute('DELETE FROM media_items');
  await db.execute('DELETE FROM episodes');
  await db.execute('DELETE FROM seasons');
  await db.execute('DELETE FROM series');
  await db.execute('DELETE FROM franchises');
  await db.execute('DELETE FROM watch_history');
  await db.execute('DELETE FROM scan_log');
  await db.execute('DELETE FROM path_controls');
  console.log('   Isolated test database schema initialized.\n');

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
    assert(bnLib.movies.some((m: any) => m.title.includes('Test Classic Drama')), 'Language filter for "bn" returns Test Classic Drama');

    const hiRes = await makeRequest(server, '/api/library?language=hi');
    const hiLib = JSON.parse(hiRes.body);
    assert(hiLib.movies.some((m: any) => m.title.includes('Test Comedy Drama')), 'Language filter for "hi" returns Test Comedy Drama');

    // Test 3b: Search functionality (title, multi-word, year, franchise, episode title)
    const searchRes1 = await makeRequest(server, '/api/library?search=Test%20Film%20Feature');
    assert(searchRes1.status === 200, 'GET /api/library?search=Test%20Film%20Feature returns 200');
    const searchLib1 = JSON.parse(searchRes1.body);
    assert(searchLib1.movies.some((m: any) => m.title.includes('Test Film Feature')), 'Search for "Test Film Feature" returns movie');

    const searchResYear = await makeRequest(server, '/api/library?search=Test%20Film%20Feature%202010');
    assert(searchResYear.status === 200, 'GET /api/library?search=Test%20Film%20Feature%202010 returns 200');
    const searchLibYear = JSON.parse(searchResYear.body);
    assert(searchLibYear.movies.some((m: any) => m.title.includes('Test Film Feature')), 'Search for "Test Film Feature 2010" (title + year) returns movie');

    const searchResHp = await makeRequest(server, '/api/library?search=Heroic%20Journey');
    assert(searchResHp.status === 200, 'GET /api/library?search=Heroic%20Journey returns 200');
    const searchLibHp = JSON.parse(searchResHp.body);
    assert(searchLibHp.movies.length >= 2, `Search for franchise "Heroic Journey" returns ${searchLibHp.movies.length} movies (expected >= 2)`);
    assert(searchLibHp.franchises.length >= 1, 'Search for franchise "Heroic Journey" returns matching franchise card');

    const searchResSeries = await makeRequest(server, '/api/library?search=Crime%20Drama%20Series');
    assert(searchResSeries.status === 200, 'GET /api/library?search=Crime%20Drama%20Series returns 200');
    const searchLibSeries = JSON.parse(searchResSeries.body);
    assert(searchLibSeries.series.some((s: any) => s.title.includes('Crime Drama Series')), 'Search for "Crime Drama Series" returns series');

    const searchResEp = await makeRequest(server, '/api/library?search=Pilot');
    assert(searchResEp.status === 200, 'GET /api/library?search=Pilot returns 200');
    const searchLibEp = JSON.parse(searchResEp.body);
    assert(searchLibEp.series.some((s: any) => s.title.includes('Crime Drama Series')), 'Search for episode title "Pilot" returns Crime Drama Series');

    // Test 4: Franchise grouping
    const franRes = await makeRequest(server, '/api/franchises');
    assert(franRes.status === 200, 'GET /api/franchises returns 200');
    const franchises = JSON.parse(franRes.body);
    const hp = franchises.find((f: any) => f.name.includes('Heroic Journey'));
    assert(Boolean(hp), 'Franchise list contains "Heroic Journey"');
    assert(hp && hp.itemCount === 2, `Heroic Journey franchise has 2 movies (got ${hp?.itemCount})`);

    // Test 5: Series detail with nested Seasons & Episodes
    const bbSeries = library.series.find((s: any) => s.title.includes('Crime Drama Series'));
    assert(Boolean(bbSeries), 'Crime Drama Series exists');
    const seriesDetailRes = await makeRequest(server, `/api/library/series/${bbSeries.id}`);
    assert(seriesDetailRes.status === 200, 'GET /api/library/series/:id returns 200');
    const bbDetail = JSON.parse(seriesDetailRes.body);
    assert(bbDetail.seasons.length === 2, `Crime Drama Series has 2 seasons (got ${bbDetail.seasons.length})`);
    const s1 = bbDetail.seasons.find((s: any) => s.seasonNumber === 1);
    assert(s1 && s1.episodes.length === 2, `Crime Drama Series Season 1 has 2 episodes (got ${s1?.episodes.length})`);
    const s2 = bbDetail.seasons.find((s: any) => s.seasonNumber === 2);
    assert(s2 && s2.episodes.length === 1, `Crime Drama Series Season 2 has 1 episode (got ${s2?.episodes.length})`);

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

    // Range request out of bounds
    const oobRes = await makeRequest(server, `/api/stream/movie/${testMovie.id}`, {
      headers: { Range: 'bytes=999999-1000000' },
    });
    assert(oobRes.status === 416, `Out of bounds range returns HTTP 416 (got ${oobRes.status})`);

    // Test 7: Subtitle conversion on-the-fly (.srt to WebVTT)
    console.log('\n6. Testing Subtitle On-the-Fly WebVTT Streaming:');
    const subRes = await makeRequest(server, `/api/stream/subtitle?path=${encodeURIComponent(path.join(TEST_DIR, 'English/Test Film Feature (2010)/Test.Film.Feature.2010.1080p.en.srt'))}`);
    assert(subRes.status === 200, 'GET /api/stream/subtitle returns 200');
    assert(subRes.headers['content-type']?.includes('text/vtt') ?? false, `Subtitle Content-Type is text/vtt (got ${subRes.headers['content-type']})`);
    assert(subRes.body.startsWith('WEBVTT'), 'Subtitle body starts with WEBVTT header');
    assert(subRes.body.includes('00:00:01.000 --> 00:00:04.000'), 'Subtitle commas converted to WebVTT dots');

    // Test 8: Progress tracker & resume heartbeat
    console.log('\n7. Testing Watch Progress & Resume Heartbeat:');
    const progressPostRes = await makeRequest(server, `/api/progress/movie/${testMovie.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: 125, duration: 600 }),
    });
    assert(progressPostRes.status === 200, 'POST /api/progress/movie/:id returns 200');

    const progressGetRes = await makeRequest(server, `/api/progress/movie/${testMovie.id}`);
    assert(progressGetRes.status === 200, 'GET /api/progress/movie/:id returns 200');
    const progressData = JSON.parse(progressGetRes.body);
    assert(progressData.positionSeconds === 125, `Saved position is 125 (got ${progressData.positionSeconds})`);
    assert(progressData.percentComplete === 21, `Percent complete is 21% (got ${progressData.percentComplete})`);

    // Progress in recent list
    const recentRes = await makeRequest(server, '/api/progress/recent/all');
    assert(recentRes.status === 200, 'GET /api/progress/recent/all returns 200');
    const recentData = JSON.parse(recentRes.body);
    assert(recentData.movies.some((m: any) => m.mediaId === testMovie.id), 'Recent watches includes updated movie');

    // Test 8: Content Control & Categorization Portal
    console.log('\n8. Testing Content Control & Categorization Portal:');

    // 8.1 Tree endpoint
    const treeRes = await makeRequest(server, '/api/control/tree');
    assert(treeRes.status === 200, 'GET /api/control/tree returns 200');
    const treeData = JSON.parse(treeRes.body);
    assert(treeData.tree && treeData.stats, 'Response has tree and stats objects');
    assert(treeData.stats.totalMediaFiles === 11, `Tree reports 11 media files (got ${treeData.stats.totalMediaFiles})`);
    assert(treeData.stats.excludedMediaFiles === 0, `Initial excluded media is 0 (got ${treeData.stats.excludedMediaFiles})`);

    // 8.2 Verify movie exists initially
    const scifiMoviePath = path.join(TEST_DIR, 'English/Test Film Feature (2010)/Test.Film.Feature.2010.1080p.mp4');
    const initLib = await makeRequest(server, '/api/library');
    const initLibData = JSON.parse(initLib.body);
    const movieBeforeEx = initLibData.movies.find((m: any) => m.title === 'Test Film Feature');
    assert(Boolean(movieBeforeEx), 'Test Film Feature movie found in initial library');

    // 8.3 Toggle exclude on a file
    const toggleExRes = await makeRequest(server, '/api/control/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: scifiMoviePath, isExcluded: true, isDirectory: false }),
    });
    assert(toggleExRes.status === 200, 'POST /api/control/toggle returns 200');

    // 8.4 Verify excluded from library
    const libAfterEx = await makeRequest(server, '/api/library');
    const libAfterExData = JSON.parse(libAfterEx.body);
    assert(!libAfterExData.movies.some((m: any) => m.title === 'Test Film Feature'), 'Test Film Feature is excluded from OTT library');

    // 8.5 Excluded movie streaming returns 404
    if (movieBeforeEx) {
      const streamExRes = await makeRequest(server, `/api/stream/movie/${movieBeforeEx.id}`);
      assert(streamExRes.status === 404, 'Streaming excluded movie returns 404 Not Found');
    }

    // 8.6 Rescan preserves exclusion
    await scanner.scan(TEST_DIR);
    const libAfterRescan = await makeRequest(server, '/api/library');
    const libAfterRescanData = JSON.parse(libAfterRescan.body);
    assert(!libAfterRescanData.movies.some((m: any) => m.title === 'Test Film Feature'), 'Test Film Feature remains excluded after rescan');

    // 8.7 Toggle back to include
    const toggleIncRes = await makeRequest(server, '/api/control/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: scifiMoviePath, isExcluded: false, isDirectory: false }),
    });
    assert(toggleIncRes.status === 200, 'POST /api/control/toggle re-including returns 200');
    const libAfterInc = await makeRequest(server, '/api/library');
    const libAfterIncData = JSON.parse(libAfterInc.body);
    assert(libAfterIncData.movies.some((m: any) => m.title === 'Test Film Feature'), 'Test Film Feature is re-included in OTT library');

    // 8.7b Directory level exclusion
    const englishDir = path.join(TEST_DIR, 'English');
    const toggleDirRes = await makeRequest(server, '/api/control/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: englishDir, isExcluded: true, isDirectory: true }),
    });
    assert(toggleDirRes.status === 200, 'POST /api/control/toggle on directory returns 200');
    const libAfterDirEx = await makeRequest(server, '/api/library');
    const libAfterDirExData = JSON.parse(libAfterDirEx.body);
    assert(!libAfterDirExData.movies.some((m: any) => m.title === 'Test Film Feature'), 'Directory exclusion excludes nested Test Film Feature');

    // 8.8 Manual categorization override: PUT /api/control/media/movie/:id
    const classicMovie = libAfterDirExData.movies.find((m: any) => m.title.includes('Test Classic Drama'));
    assert(Boolean(classicMovie), 'Test Classic Drama movie found for manual categorization test');
    if (classicMovie) {
      const overrideRes = await makeRequest(server, `/api/control/media/movie/${classicMovie.id}`, {
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
      const updatedMovie = updatedLibData.movies.find((m: any) => m.id === classicMovie.id);
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
    assert(libResetData.movies.some((m: any) => m.title === 'Test Film Feature'), 'Test Film Feature restored in library after reset');

    // 8.10 Folder level categorization: PUT /api/control/folder (Franchise)
    const bengaliDir = path.join(TEST_DIR, 'Bengali');
    const folderFranchiseRes = await makeRequest(server, '/api/control/folder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: bengaliDir,
        categoryType: 'franchise',
        categoryName: 'Classic Cinema Anthology',
        applyToChildren: true,
      }),
    });
    assert(folderFranchiseRes.status === 200, 'PUT /api/control/folder (Franchise) returns 200');

    // Verify folder node in tree reflects franchise categorization
    const treeWithFolderCat = await makeRequest(server, '/api/control/tree');
    const treeFolderCatData = JSON.parse(treeWithFolderCat.body);
    const bengaliNode = treeFolderCatData.tree.children.find((c: any) => c.name === 'Bengali');
    assert(bengaliNode?.categoryType === 'franchise', `Bengali folder categoryType is franchise (got ${bengaliNode?.categoryType})`);
    assert(bengaliNode?.categoryName === 'Classic Cinema Anthology', `Bengali folder categoryName matches (got ${bengaliNode?.categoryName})`);

    // Verify child movie inherits the franchise
    const libWithFolderCat = await makeRequest(server, '/api/library');
    const libFolderCatData = JSON.parse(libWithFolderCat.body);
    const movieInBengali = libFolderCatData.movies.find((m: any) => m.filePath.includes('Test.Classic.Drama') || m.title.includes('Classic Drama') || m.title.includes('Golden Fortress'));
    assert(movieInBengali?.franchiseName === 'Classic Cinema Anthology', `Movie in folder inherited franchise "Classic Cinema Anthology" (got ${movieInBengali?.franchiseName})`);

    // 8.11 Folder level categorization: PUT /api/control/folder (Series)
    const animDir = path.join(TEST_DIR, 'Animated');
    const folderSeriesRes = await makeRequest(server, '/api/control/folder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: animDir,
        categoryType: 'series',
        categoryName: 'Animated Stories Anthology',
        isAnimated: true,
        applyToChildren: true,
      }),
    });
    assert(folderSeriesRes.status === 200, 'PUT /api/control/folder (Series) returns 200');

    const libWithSeriesFolder = await makeRequest(server, '/api/library');
    const libSeriesFolderData = JSON.parse(libWithSeriesFolder.body);
    const newSeries = libSeriesFolderData.series.find((s: any) => s.title === 'Animated Stories Anthology');
    assert(Boolean(newSeries), 'Series created from folder categorization exists in OTT library');
    assert(newSeries?.isAnimated === true, 'Series created from folder categorization has isAnimated=true');

    // 8.12 GET /api/control/franchises returns list
    const franchisesRes = await makeRequest(server, '/api/control/franchises');
    assert(franchisesRes.status === 200, 'GET /api/control/franchises returns 200');
    const franchiseList = JSON.parse(franchisesRes.body);
    assert(Array.isArray(franchiseList) && franchiseList.some((f: any) => f.name === 'Classic Cinema Anthology'), 'Franchises list includes Classic Cinema Anthology');

    // 8.13 Testing Pruning of Deleted Media Files:
    console.log('\n9. Testing Pruning of Deleted Media Files:');
    const tempPrunePath = path.join(TEST_DIR, 'English/temp_to_delete.mp4');
    fs.writeFileSync(tempPrunePath, Buffer.alloc(2048, 0x55));
    await scanner.scan(TEST_DIR);
    const libBeforeDelete = await makeRequest(server, '/api/library');
    const libBeforeDeleteData = JSON.parse(libBeforeDelete.body);
    assert(libBeforeDeleteData.movies.some((m: any) => m.filePath === tempPrunePath), 'Temporary movie exists in library before deletion');

    // Delete file from disk
    fs.rmSync(tempPrunePath);
    // Call prune
    const pruneRes = await makeRequest(server, '/api/scan/prune', { method: 'POST' });
    assert(pruneRes.status === 200, 'POST /api/scan/prune returns 200');
    const pruneData = JSON.parse(pruneRes.body);
    assert(pruneData.movies >= 1, `Pruned at least 1 missing movie (got ${pruneData.movies})`);

    const libAfterDelete = await makeRequest(server, '/api/library');
    const libAfterDeleteData = JSON.parse(libAfterDelete.body);
    assert(!libAfterDeleteData.movies.some((m: any) => m.filePath === tempPrunePath), 'Deleted movie was cleanly pruned from library');

    // 10. Testing Multi-Drive & Folder Structure View APIs:
    console.log('\n10. Testing Multi-Drive & Folder Structure View APIs:');
    const drivesRes = await makeRequest(server, '/api/library/drives');
    assert(drivesRes.status === 200, 'GET /api/library/drives returns 200');
    const drivesList = JSON.parse(drivesRes.body);
    assert(Array.isArray(drivesList) && drivesList.length >= 1, `Drives endpoint returns configured drive list (got ${drivesList.length})`);
    assert(drivesList[0]?.isPrimary === true, 'First configured drive is designated as primary');
    assert(drivesList[0]?.movieCount >= 5, `Primary drive reports movieCount >= 5 (got ${drivesList[0]?.movieCount})`);

    // Drive filter on library
    const driveLibRes = await makeRequest(server, `/api/library?drive=${encodeURIComponent(drivesList[0].id)}`);
    assert(driveLibRes.status === 200, 'GET /api/library?drive=:id returns 200');
    const driveLibData = JSON.parse(driveLibRes.body);
    assert(driveLibData.movies.length === drivesList[0].movieCount, `Drive-filtered library matches drive movie count (${driveLibData.movies.length})`);

    // Folder view browse endpoint
    const browseRes = await makeRequest(server, `/api/library/browse?drive=${encodeURIComponent(drivesList[0].id)}`);
    assert(browseRes.status === 200, 'GET /api/library/browse returns 200');
    const browseData = JSON.parse(browseRes.body);
    assert(Array.isArray(browseData.folders) && browseData.folders.length > 0, `Browse root has subfolders (got ${browseData.folders.length})`);
    assert(Array.isArray(browseData.breadcrumbs) && browseData.breadcrumbs.length === 1, 'Browse root breadcrumb has 1 item');

    // Browse into a subfolder
    const firstSubfolder = browseData.folders[0];
    const subfolderBrowseRes = await makeRequest(server, `/api/library/browse?drive=${encodeURIComponent(drivesList[0].id)}&subpath=${encodeURIComponent(firstSubfolder.path)}`);
    assert(subfolderBrowseRes.status === 200, 'GET /api/library/browse with subpath returns 200');
    const subfolderData = JSON.parse(subfolderBrowseRes.body);
    assert(subfolderData.breadcrumbs.length === 2, `Subfolder breadcrumbs reflect depth (got ${subfolderData.breadcrumbs.length})`);

  } finally {
    server.close();
    // Cleanup test artifacts
    try {
      if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
      if (fs.existsSync(TEST_DB)) fs.rmSync(TEST_DB, { force: true });
      if (fs.existsSync(`${TEST_DB}-wal`)) fs.rmSync(`${TEST_DB}-wal`, { force: true });
      if (fs.existsSync(`${TEST_DB}-shm`)) fs.rmSync(`${TEST_DB}-shm`, { force: true });
      resetDbConnection();
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
