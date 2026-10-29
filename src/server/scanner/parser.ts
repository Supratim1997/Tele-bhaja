/**
 * Media path/filename parser — extracts structured metadata from file paths
 * using rule-based regex heuristics and directory tree analysis.
 */

export interface ParsedMedia {
  title: string;
  year?: number;
  isSeries: boolean;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  languages: string[];
  isAnimated: boolean;
  franchiseHint?: string;
  franchiseOrder?: number;
}

// ─── Language detection mappings ──────────────────────────────────────────────

const LANG_FOLDER_MAP: Record<string, string> = {
  english: 'en', hindi: 'hi', bengali: 'bn', bangla: 'bn', tamil: 'ta',
  telugu: 'te', malayalam: 'ml', kannada: 'kn', marathi: 'mr',
  punjabi: 'pa', gujarati: 'gu', urdu: 'ur', french: 'fr',
  german: 'de', japanese: 'ja', korean: 'ko', chinese: 'zh',
  spanish: 'es', italian: 'it', portuguese: 'pt', russian: 'ru',
  arabic: 'ar', turkish: 'tr', thai: 'th', indonesian: 'id',
  dutch: 'nl', swedish: 'sv', norwegian: 'no', danish: 'da',
  finnish: 'fi', polish: 'pl',
};

const LANG_TAG_MAP: Record<string, string> = {
  // 3-letter abbreviations
  eng: 'en', hin: 'hi', ben: 'bn', ban: 'bn', tam: 'ta', tel: 'te', mal: 'ml',
  kan: 'kn', mar: 'mr', pun: 'pa', guj: 'gu', jpn: 'ja', kor: 'ko',
  chi: 'zh', zho: 'zh', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de',
  spa: 'es', ita: 'it', por: 'pt', rus: 'ru', ara: 'ar', tur: 'tr',
  tha: 'th', ind: 'id', dut: 'nl', nld: 'nl',
  // 2-letter ISO
  en: 'en', hi: 'hi', bn: 'bn', ta: 'ta', te: 'te', ml: 'ml',
  kn: 'kn', mr: 'mr', pa: 'pa', gu: 'gu', fr: 'fr', de: 'de',
  ja: 'ja', ko: 'ko', zh: 'zh', es: 'es', it: 'it', pt: 'pt',
  ru: 'ru', ar: 'ar', tr: 'tr', th: 'th', id: 'id', nl: 'nl',
};

// ─── Animated keyword detection ───────────────────────────────────────────────

const ANIMATED_KEYWORDS = [
  'animation', 'animated', 'anime', 'cartoon', 'studio ghibli',
  'ghibli', 'pixar', 'disney', 'dreamworks', 'illumination', 'laika', 'aardman',
  'nickelodeon', 'cartoon network', 'adult swim', 'makoto shinkai', 'hayao miyazaki',
];

// ─── Title cleaning ───────────────────────────────────────────────────────────

const JUNK_TOKENS_RE = new RegExp(
  [
    '\\b(bluray|blu-ray|bdrip|brrip|dvdrip|dvdscr|webrip|web-dl|webdl|hdtv|' +
    'hdrip|amzn|nf|hbo|dsnp|atvp|peacock|max|crunchyroll|vostfr)\\b',
    '\\b(x264|x265|h264|h265|hevc|avc|xvid|divx|aac|ac3|eac3|dts|mp3|' +
    'flac|truehd|atmos|ddp5\\.1|dd5\\.1|7\\.1|5\\.1|2\\.0)\\b',
    '\\b(1080p|720p|480p|2160p|4k|uhd|hd|sd|fhd|remux)\\b',
    '\\b(repack|proper|extended|theatrical|directors\\.cut|unrated|' +
    'limited|retail|internal|remastered|subbed|dubbed)\\b',
    '\\b(english|hindi|bengali|bangla|tamil|telugu|multi|dual|dub)\\b',
    '\\b(yts|yify|rarbg|sparks|fgt|etrg|psa|evo|ntb|flux|cmrg|geckos)\\b',
    '\\[.*?\\]',
    '\\(.*?\\)',
    '\\{.*?\\}',
  ].join('|'),
  'gi'
);

// ─── Franchise detection ──────────────────────────────────────────────────────

const FRANCHISE_MAP: Array<{ pattern: RegExp; franchise: string }> = [
  { pattern: /harry\s*potter/i, franchise: 'Harry Potter' },
  { pattern: /fantastic\s*beasts/i, franchise: 'Fantastic Beasts' },
  { pattern: /marvel|avengers|iron\s*man|captain\s*america|thor\b|black\s*panther|spider.?man|doctor\s*strange|guardians\s*of|ant.?man|black\s*widow|shang.?chi|eternals|wakanda/i, franchise: 'Marvel Cinematic Universe' },
  { pattern: /x.?men|deadpool|wolverine|magneto/i, franchise: 'X-Men' },
  { pattern: /lord\s*of\s*the\s*rings|hobbit|tolkien|middle.?earth/i, franchise: 'Middle-Earth' },
  { pattern: /star\s*wars|jedi|sith|mandalorian|clone\s*wars|andor|obi.?wan|boba\s*fett/i, franchise: 'Star Wars' },
  { pattern: /fast\s*(&|and)\s*furious|fast\s+\d+|furious\s+\d+|hobbs\s*(&|and)\s*shaw/i, franchise: 'Fast & Furious' },
  { pattern: /james\s*bond\b|007\b|casino\s*royale|skyfall|spectre|goldfinger|no\s*time\s*to\s*die/i, franchise: 'James Bond' },
  { pattern: /mission\s*impossible/i, franchise: 'Mission: Impossible' },
  { pattern: /john\s*wick/i, franchise: 'John Wick' },
  { pattern: /matrix/i, franchise: 'The Matrix' },
  { pattern: /jurassic\s*(park|world)/i, franchise: 'Jurassic Park' },
  { pattern: /indiana\s*jones/i, franchise: 'Indiana Jones' },
  { pattern: /transformers/i, franchise: 'Transformers' },
  { pattern: /dc\b|batman|superman|wonder\s*woman|justice\s*league|aquaman|shazam|the\s*flash\b|suicide\s*squad/i, franchise: 'DC Universe' },
  { pattern: /terminator/i, franchise: 'Terminator' },
  { pattern: /alien\b|aliens\b|prometheus|covenant|alien.?romulus/i, franchise: 'Alien' },
  { pattern: /predator/i, franchise: 'Predator' },
  { pattern: /pirates\s*of\s*the\s*caribbean/i, franchise: 'Pirates of the Caribbean' },
  { pattern: /planet\s*of\s*the\s*apes/i, franchise: 'Planet of the Apes' },
  { pattern: /how\s*to\s*train\s*your\s*dragon/i, franchise: 'How to Train Your Dragon' },
  { pattern: /toy\s*story/i, franchise: 'Toy Story' },
  { pattern: /finding\s*(nemo|dory)/i, franchise: 'Finding Nemo' },
  { pattern: /ice\s*age/i, franchise: 'Ice Age' },
  { pattern: /kung\s*fu\s*panda/i, franchise: 'Kung Fu Panda' },
  { pattern: /shrek/i, franchise: 'Shrek' },
  { pattern: /despicable\s*me|minions/i, franchise: 'Despicable Me' },
  { pattern: /dark\s*knight|batman\s*begins/i, franchise: 'The Dark Knight' },
  { pattern: /godfather/i, franchise: 'The Godfather' },
  { pattern: /back\s*to\s*the\s*future/i, franchise: 'Back to the Future' },
  { pattern: /hunger\s*games/i, franchise: 'The Hunger Games' },
  { pattern: /twilight\s*saga|twilight/i, franchise: 'The Twilight Saga' },
  { pattern: /bourne/i, franchise: 'Jason Bourne' },
];

// ─── Public API ───────────────────────────────────────────────────────────────

export function parseMediaPath(filePath: string): ParsedMedia {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const segments = normalizedPath.split('/').filter(Boolean);
  const filename = segments[segments.length - 1] ?? '';
  const baseName = filename.replace(/\.[^.]+$/, ''); // strip extension

  const parentFolder = segments.length > 1 ? segments[segments.length - 2] : '';
  const grandparentFolder = segments.length > 2 ? segments[segments.length - 3] : '';

  // 1. Detect languages from path segments and filename
  const languages = detectLanguages(normalizedPath, filename);

  // 2. Detect animation
  const isAnimated = detectAnimated(normalizedPath);

  // 3. Detect season/episode tokens from filename and directory tree
  const seResult = detectSeriesTokens(baseName, parentFolder, grandparentFolder, normalizedPath);

  // 4. Extract year: prefer bracketed year (e.g. "(2019)"), then last 4-digit year in filename, then parent folder
  let year: number | undefined;
  const bracketYear = baseName.match(/[\(\[]\s*(19\d{2}|20\d{2})\s*[\)\]]/);
  if (bracketYear) {
    year = parseInt(bracketYear[1], 10);
  } else {
    const allYears = Array.from(baseName.matchAll(/\b(19\d{2}|20\d{2})\b/g));
    if (allYears.length > 0) {
      year = parseInt(allYears[allYears.length - 1][1], 10);
    } else if (parentFolder) {
      const parentYear = parentFolder.match(/\b(19\d{2}|20\d{2})\b/);
      if (parentYear) year = parseInt(parentYear[1], 10);
    }
  }

  // 5. Clean title
  let title = '';
  if (seResult.isSeries) {
    // If the episode is inside a Season folder (e.g. "Dark/Season 1/01 - Pilot.mkv"),
    // the series title is the grandparent directory.
    if (seResult.seasonFromFolder && grandparentFolder && !isGenericFolderName(grandparentFolder)) {
      title = cleanTitle(grandparentFolder, year);
    } else {
      const fromBase = cleanTitle(baseName, year);
      if (fromBase && fromBase.length > 2 && !/^(season|episode|ep|\d+)/i.test(fromBase) && !isGenericFilename(baseName)) {
        title = fromBase;
      } else if (parentFolder && !isGenericFolderName(parentFolder) && !/^(season|series|specials|\d+)/i.test(parentFolder)) {
        title = cleanTitle(parentFolder, year);
      } else {
        title = fromBase || 'Unknown Series';
      }
    }
  } else {
    // For standalone movies:
    const fromBase = cleanTitle(baseName, year);
    if (!isGenericFilename(baseName) && fromBase && fromBase.length > 1) {
      title = fromBase;
    } else if (parentFolder && !isGenericFolderName(parentFolder)) {
      title = cleanTitle(parentFolder, year);
    } else {
      title = fromBase || 'Unknown';
    }
  }

  // 6. Franchise detection
  const franchiseHint = detectFranchise(normalizedPath, title);

  // 7. Franchise order
  const franchiseOrder = detectFranchiseOrder(baseName, title);

  return {
    title:         title || 'Unknown',
    year,
    isSeries:      seResult.isSeries,
    seasonNumber:  seResult.season,
    episodeNumber: seResult.episode,
    episodeTitle:  seResult.episodeTitle,
    languages,
    isAnimated,
    franchiseHint,
    franchiseOrder,
  };
}

// ─── Language detection helpers ───────────────────────────────────────────────

function detectLanguages(fullPath: string, filename: string): string[] {
  const found = new Set<string>();
  const normalizedPath = fullPath.replace(/\\/g, '/');
  const lowerPath = normalizedPath.toLowerCase();

  // Check path segments against known language folder names
  for (const [langWord, code] of Object.entries(LANG_FOLDER_MAP)) {
    const folderRe = new RegExp(`(?:^|/|\\s|\\[)${langWord}(?:/|\\s|\\]|$)`, 'i');
    if (folderRe.test(lowerPath)) found.add(code);
  }

  // Check bracketed/dot-separated tags across entire path and filename
  const tagRe = /[\[(.\s_]([a-zA-Z]{2,3})[\]).\s_]/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(normalizedPath)) !== null) {
    const tag = m[1].toLowerCase();
    if (LANG_TAG_MAP[tag]) found.add(LANG_TAG_MAP[tag]);
  }

  // Detect "Dual Audio" / "Multi" as English + Hindi
  if (/dual\s*audio/i.test(normalizedPath)) {
    found.add('en'); found.add('hi');
  }
  if (/\bmulti\b/i.test(normalizedPath)) {
    found.add('en'); found.add('hi');
  }

  return found.size > 0 ? Array.from(found) : ['en'];
}

// ─── Animation detection helpers ─────────────────────────────────────────────

function detectAnimated(fullPath: string): boolean {
  const lower = fullPath.toLowerCase();
  return ANIMATED_KEYWORDS.some((kw) => lower.includes(kw));
}

// ─── Series token detection ───────────────────────────────────────────────────

interface SeResult {
  isSeries: boolean;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  seasonFromFolder?: boolean;
}

function detectSeriesTokens(baseName: string, parentFolder: string, grandparentFolder: string, normalizedPath = ''): SeResult {
  const segments = normalizedPath.split('/').filter(Boolean);
  const isMovieDir = segments.some((seg) => /\b(movies?|films?|cinema)\b/i.test(seg));
  const isSeriesDir = segments.some((seg) => /\b(tv|tv\s*shows?|tv\s*series|series|shows?|anime)\b/i.test(seg));

  // Check if parent folder specifies Season (e.g., "Season 1", "Season 02", "S01", "Staffel 2")
  let folderSeason: number | undefined;
  const parentSeasonMatch = parentFolder.match(/(?:season|series|staffel|s)\s*(\d{1,2})/i);
  if (parentSeasonMatch) {
    folderSeason = parseInt(parentSeasonMatch[1], 10);
  }

  // 1. S01E02 pattern in filename
  let m = baseName.match(/[Ss](\d{1,2})[Ee](\d{1,3})(?:[\s._-]+(.*))?/);
  if (m) {
    const epTitle = m[3] ? cleanTitle(m[3]) : undefined;
    return {
      isSeries: true,
      season: parseInt(m[1], 10),
      episode: parseInt(m[2], 10),
      episodeTitle: epTitle || undefined,
    };
  }

  // 2. Season N Episode M pattern in filename
  m = baseName.match(/[Ss]eason\s*(\d{1,2}).*?[Ee]p(?:isode)?\s*(\d{1,3})(?:[\s._-]+(.*))?/i);
  if (m) {
    const epTitle = m[3] ? cleanTitle(m[3]) : undefined;
    return {
      isSeries: true,
      season: parseInt(m[1], 10),
      episode: parseInt(m[2], 10),
      episodeTitle: epTitle || undefined,
    };
  }

  // 3. 1x03 pattern in filename
  m = baseName.match(/\b(\d{1,2})[xX](\d{1,3})\b(?:[\s._-]+(.*))?/);
  if (m) {
    const epTitle = m[3] ? cleanTitle(m[3]) : undefined;
    return {
      isSeries: true,
      season: parseInt(m[1], 10),
      episode: parseInt(m[2], 10),
      episodeTitle: epTitle || undefined,
    };
  }

  // 4. File is inside a Season folder (e.g. "Season 1/01 - Pilot.mkv" or "Season 2/Episode 04.mkv")
  if (folderSeason !== undefined) {
    // Try to find episode number in filename
    const epMatch = baseName.match(/(?:[Ee]p(?:isode)?\s*|^|[\s._-])(\d{1,3})(?:[\s._-]+(.*))?$/i)
      || baseName.match(/\b[Ee](\d{1,3})\b/i);

    let epNum = 1;
    let epTitle: string | undefined;

    if (epMatch) {
      epNum = parseInt(epMatch[1], 10);
      if (epMatch[2]) {
        epTitle = cleanTitle(epMatch[2]);
      }
    }

    return {
      isSeries: true,
      season: folderSeason,
      episode: epNum,
      episodeTitle: epTitle || undefined,
      seasonFromFolder: true,
    };
  }

  // If inside an explicit Movies folder, DO NOT classify as series based on generic words
  if (isMovieDir) {
    return { isSeries: false };
  }

  // 5. Episode code E01 alone in filename
  m = baseName.match(/\b[Ee](\d{1,3})\b(?:[\s._-]+(.*))?/);
  if (m) {
    const epTitle = m[2] ? cleanTitle(m[2]) : undefined;
    return {
      isSeries: true,
      season: 1,
      episode: parseInt(m[1], 10),
      episodeTitle: epTitle || undefined,
    };
  }

  // 6. Wordy "Episode N"
  m = baseName.match(/\bEpisode\s*(\d{1,3})\b(?:[\s._-]+(.*))?/i);
  if (m) {
    const hasYear = /\b(19\d{2}|20\d{2})\b/.test(baseName) || /\b(19\d{2}|20\d{2})\b/.test(parentFolder);
    // If it has a movie release year and is not explicitly in a Series folder, it's a movie (e.g. "Star Wars Episode 1 (1999)")
    if (hasYear && !isSeriesDir) {
      return { isSeries: false };
    }
    const epTitle = m[2] ? cleanTitle(m[2]) : undefined;
    return {
      isSeries: true,
      season: 1,
      episode: parseInt(m[1], 10),
      episodeTitle: epTitle || undefined,
    };
  }

  return { isSeries: false };
}

// ─── Title cleaning ───────────────────────────────────────────────────────────

function cleanTitle(raw: string, year?: number): string {
  let title = raw;

  // Remove S01E02-style tokens from title
  title = title.replace(/[Ss]\d{1,2}[Ee]\d{1,3}.*/g, '');
  title = title.replace(/[Ss]eason\s*\d{1,2}.*/gi, '');
  title = title.replace(/\d{1,2}[xX]\d{1,3}.*/g, '');
  title = title.replace(/\b[Ee]p(?:isode)?\s*\d{1,3}.*/gi, '');

  // Remove bracketed content
  title = title.replace(/\[.*?\]/g, '');
  title = title.replace(/\(.*?\)/g, '');
  title = title.replace(/\{.*?\}/g, '');

  // Remove year safely (preserving titles like "1917", "2001 A Space Odyssey", "2012")
  if (year) {
    const afterRemovingYear = title.replace(new RegExp(`\\b${year}\\b`), '').replace(/[._\-]+/g, ' ').trim();
    if (afterRemovingYear.length >= 2) {
      title = title.replace(new RegExp(`\\b${year}\\b`), '');
    }
  } else {
    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      const test = title.replace(new RegExp(`\\b${yearMatch[0]}\\b`), '').replace(/[._\-]+/g, ' ').trim();
      if (test.length >= 2) {
        title = title.replace(new RegExp(`\\b${yearMatch[0]}\\b`), '');
      }
    }
  }

  // Remove junk quality/codec tokens
  title = title.replace(JUNK_TOKENS_RE, '');

  // Remove leading numbers with delimiter (e.g. "01 - " or "1. ")
  // Note: requires hyphen or dot followed by space so "3.Idiots" or "300" aren't stripped
  title = title.replace(/^\d{1,2}\s*(?:[-–—]|\.\s+)\s*/, '');

  // Replace dots/underscores/hyphens with space
  title = title.replace(/[._\-]+/g, ' ');

  // Collapse whitespace
  title = title.replace(/\s{2,}/g, ' ').trim();

  // Title-case
  return toTitleCase(title);
}

function isGenericFilename(name: string): boolean {
  const lower = name.toLowerCase().replace(/[._\-]/g, ' ').trim();
  return /^(movie|film|video|main|stream|play|feature|track\s*\d*|title\s*\d*|cd\s*\d+|disc\s*\d+|dvd\s*\d+|part\s*\d+)$/i.test(lower);
}

function toTitleCase(str: string): string {
  const lowerWords = new Set(['a','an','the','and','but','or','for','nor','on','at','to','by','of','in','up','as']);
  return str.split(' ').map((word, i) => {
    if (!word) return '';
    if (i === 0 || !lowerWords.has(word.toLowerCase())) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }
    return word.toLowerCase();
  }).filter(Boolean).join(' ');
}

// ─── Franchise detection ──────────────────────────────────────────────────────

function detectFranchise(fullPath: string, title: string): string | undefined {
  const combined = `${fullPath} ${title}`.toLowerCase();

  // 1. Direct franchise pattern match
  for (const { pattern, franchise } of FRANCHISE_MAP) {
    if (pattern.test(combined)) return franchise;
  }

  // 2. Folder name matching explicit franchise collection naming:
  // e.g. "Heroic Journey [Collection]" or "Alien Collection",
  // but NOT overarching category folders like "Collections - Classic Cinema" or "Collections - Anthology"
  const segments = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
  for (const seg of segments) {
    // Ignore folders starting with "Collection" or "Collections" (generic categorization folders)
    if (/^\s*collections?\b/i.test(seg)) continue;

    // Check for [Collection], [Franchise], [Universe], [Saga]
    const bracketMatch = seg.match(/^(.+?)\s*\[(?:Collection|Franchise|Universe|Saga)\]/i);
    if (bracketMatch) {
      return cleanTitle(bracketMatch[1]);
    }

    // Check for folder ending with "Collection", "Franchise", "Universe", or "Saga"
    // e.g. "The Dark Knight Collection"
    const suffixMatch = seg.match(/^(.+?)\s+(?:Collection|Franchise|Universe|Saga)$/i);
    if (suffixMatch) {
      return cleanTitle(suffixMatch[1]);
    }
  }

  return undefined;
}

function detectFranchiseOrder(baseName: string, title: string): number | undefined {
  // Check prefix e.g. "01 - Title" or "1. Title"
  const prefixMatch = baseName.match(/^(\d{1,2})\s*[-.]/);
  if (prefixMatch) return parseInt(prefixMatch[1], 10);

  // Check suffix e.g. "Part 1", "Part 2", "Vol 1"
  const partMatch = title.match(/\b(?:part|vol|volume|chapter)\s*(\d{1,2})\b/i);
  if (partMatch) return parseInt(partMatch[1], 10);

  // Check ending number e.g. "Matrix 2", "Iron Man 3"
  const numMatch = title.match(/\b(\d{1,2})$/);
  if (numMatch) return parseInt(numMatch[1], 10);

  return undefined;
}

function isGenericFolderName(folder: string): boolean {
  const lower = folder.toLowerCase().trim();
  return /^(movies|films|media|videos|downloads|torrents|new|complete|video|dvd|bluray)$/i.test(lower) || /^[a-z]:$/i.test(lower);
}
