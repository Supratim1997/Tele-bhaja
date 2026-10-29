import { parseMediaPath } from '../src/server/scanner/parser.js';

interface TestCase {
  path: string;
  expectedTitle: string;
  expectedYear?: number;
  expectedIsSeries: boolean;
  expectedSeason?: number;
  expectedEpisode?: number;
  expectedIsAnimated?: boolean;
  expectedFranchise?: string;
  expectedLanguage?: string;
}

const testCases: TestCase[] = [
  // 1. Language detection
  {
    path: 'E:/Media/English/Inception (2010)/Inception.2010.1080p.mkv',
    expectedTitle: 'Inception',
    expectedYear: 2010,
    expectedIsSeries: false,
    expectedLanguage: 'en',
  },
  {
    path: 'E:/Media/Bengali/Sonar Kella (1974) [Bengali].mp4',
    expectedTitle: 'Sonar Kella',
    expectedYear: 1974,
    expectedIsSeries: false,
    expectedLanguage: 'bn',
  },
  {
    path: 'E:/Media/Hindi Movies/Sample Drama (2009) [Hin].mp4',
    expectedTitle: 'Sample Drama',
    expectedYear: 2009,
    expectedIsSeries: false,
    expectedLanguage: 'hi',
  },
  {
    path: 'E:/Media/Movies/Interstellar (2014) [Dual Audio].mkv',
    expectedTitle: 'Interstellar',
    expectedYear: 2014,
    expectedIsSeries: false,
    expectedLanguage: 'hi', // en & hi
  },

  // 2. Series vs Movies
  {
    path: 'E:/Media/TV Shows/Sample Crime Series/Season 01/Sample Crime Series - S01E02 - Cats in the Bag.mkv',
    expectedTitle: 'Sample Crime Series',
    expectedIsSeries: true,
    expectedSeason: 1,
    expectedEpisode: 2,
  },
  {
    path: 'E:/Media/TV Shows/Dark/Season 2/04 - The Travelers.mkv',
    expectedTitle: 'Dark',
    expectedIsSeries: true,
    expectedSeason: 2,
    expectedEpisode: 4,
  },
  {
    path: 'E:/Media/TV/Game of Thrones/1x03 - Lord Snow.mp4',
    expectedTitle: 'Game of Thrones',
    expectedIsSeries: true,
    expectedSeason: 1,
    expectedEpisode: 3,
  },
  {
    path: 'E:/Media/TV/Stranger Things Season 1 Episode 4.mkv',
    expectedTitle: 'Stranger Things',
    expectedIsSeries: true,
    expectedSeason: 1,
    expectedEpisode: 4,
  },
  {
    path: 'E:/Media/Movies/The Dark Knight (2008).mp4',
    expectedTitle: 'The Dark Knight',
    expectedYear: 2008,
    expectedIsSeries: false,
  },

  // 3. Animated content
  {
    path: 'E:/Media/Movies/Spirited Away (2001) [Studio Ghibli] [Animation].mkv',
    expectedTitle: 'Spirited Away',
    expectedYear: 2001,
    expectedIsSeries: false,
    expectedIsAnimated: true,
  },
  {
    path: 'E:/Media/Anime/Death Note/Season 1/01.mkv',
    expectedTitle: 'Death Note',
    expectedIsSeries: true,
    expectedSeason: 1,
    expectedEpisode: 1,
    expectedIsAnimated: true,
  },
  {
    path: 'E:/Media/Movies/Toy Story 3 (2010) [Pixar].mp4',
    expectedTitle: 'Toy Story 3',
    expectedYear: 2010,
    expectedIsSeries: false,
    expectedIsAnimated: true,
    expectedFranchise: 'Toy Story',
  },

  // 4. Franchise / Universe Grouping
  {
    path: "E:/Media/Harry Potter [Collection]/01 - Harry Potter and the Sorcerer's Stone (2001).mp4",
    expectedTitle: "Harry Potter and the Sorcerer's Stone",
    expectedYear: 2001,
    expectedIsSeries: false,
    expectedFranchise: 'Harry Potter',
  },
  {
    path: 'E:/Media/Movies/Iron Man (2008).mp4',
    expectedTitle: 'Iron Man',
    expectedYear: 2008,
    expectedIsSeries: false,
    expectedFranchise: 'Marvel Cinematic Universe',
  },
  {
    path: 'E:/Media/Movies/The Lord of the Rings - The Fellowship of the Ring (2001).mkv',
    expectedTitle: 'The Lord of the Rings the Fellowship of the Ring',
    expectedYear: 2001,
    expectedIsSeries: false,
    expectedFranchise: 'Middle-Earth',
  },
  {
    path: 'E:/Media/Movies/Casino Royale (2006).mkv',
    expectedTitle: 'Casino Royale',
    expectedYear: 2006,
    expectedIsSeries: false,
    expectedFranchise: 'James Bond',
  },
  // 5. Special Edge Cases (Years in titles, generic filenames, custom movie directories)
  {
    path: 'E:/Media/Movies/1917 (2019).mkv',
    expectedTitle: '1917',
    expectedYear: 2019,
    expectedIsSeries: false,
  },
  {
    path: 'E:/Media/Bengali Movies/Apur Sansar (1959).mkv',
    expectedTitle: 'Apur Sansar',
    expectedYear: 1959,
    expectedIsSeries: false,
    expectedLanguage: 'bn',
  },
  {
    path: 'E:/Media/Movies/Inception (2010)/movie.mkv',
    expectedTitle: 'Inception',
    expectedYear: 2010,
    expectedIsSeries: false,
  },
  {
    path: 'E:/Media/Movies/Star Wars Episode I - The Phantom Menace (1999).mkv',
    expectedTitle: 'Star Wars Episode I the Phantom Menace',
    expectedYear: 1999,
    expectedIsSeries: false,
    expectedFranchise: 'Star Wars',
  },
];

let passed = 0;
let failed = 0;

console.log('🧪 Running Parser Heuristic Engine Tests...\n');

for (const tc of testCases) {
  const result = parseMediaPath(tc.path);
  let ok = true;
  const errors: string[] = [];

  if (tc.expectedTitle && result.title !== tc.expectedTitle) {
    ok = false;
    errors.push(`Title mismatch: expected "${tc.expectedTitle}", got "${result.title}"`);
  }
  if (tc.expectedYear && result.year !== tc.expectedYear) {
    ok = false;
    errors.push(`Year mismatch: expected ${tc.expectedYear}, got ${result.year}`);
  }
  if (result.isSeries !== tc.expectedIsSeries) {
    ok = false;
    errors.push(`isSeries mismatch: expected ${tc.expectedIsSeries}, got ${result.isSeries}`);
  }
  if (tc.expectedSeason !== undefined && result.seasonNumber !== tc.expectedSeason) {
    ok = false;
    errors.push(`Season mismatch: expected ${tc.expectedSeason}, got ${result.seasonNumber}`);
  }
  if (tc.expectedEpisode !== undefined && result.episodeNumber !== tc.expectedEpisode) {
    ok = false;
    errors.push(`Episode mismatch: expected ${tc.expectedEpisode}, got ${result.episodeNumber}`);
  }
  if (tc.expectedIsAnimated !== undefined && result.isAnimated !== tc.expectedIsAnimated) {
    ok = false;
    errors.push(`isAnimated mismatch: expected ${tc.expectedIsAnimated}, got ${result.isAnimated}`);
  }
  if (tc.expectedFranchise && result.franchiseHint !== tc.expectedFranchise) {
    ok = false;
    errors.push(`Franchise mismatch: expected "${tc.expectedFranchise}", got "${result.franchiseHint}"`);
  }
  if (tc.expectedLanguage && !result.languages.includes(tc.expectedLanguage)) {
    ok = false;
    errors.push(`Language mismatch: expected "${tc.expectedLanguage}" in ${JSON.stringify(result.languages)}`);
  }

  if (ok) {
    passed++;
    console.log(`  ✅ [PASS] "${result.title}" (${result.isSeries ? `S${result.seasonNumber}E${result.episodeNumber}` : 'Movie'}${result.isAnimated ? ' · Animated' : ''}${result.franchiseHint ? ` · ${result.franchiseHint}` : ''})`);
  } else {
    failed++;
    console.error(`  ❌ [FAIL] ${tc.path}`);
    errors.forEach((e) => console.error(`       • ${e}`));
    console.error(`       Parsed result:`, JSON.stringify(result));
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${testCases.length} tests.`);
if (failed > 0) process.exit(1);
