// ─── Shared domain types used by both server and client ─────────────────────

export type MediaType = 'movie' | 'series' | 'episode';
export type ContentCategory = 'movie' | 'series' | 'animated' | 'franchise';

export interface Language {
  code: string;   // ISO 639-1, e.g. "en"
  name: string;   // e.g. "English"
}

export interface Franchise {
  id: number;
  name: string;
  tmdbCollectionId?: number;
  posterPath?: string;
  backdropPath?: string;
  overview?: string;
  itemCount: number;
}

export interface Series {
  id: number;
  title: string;
  year?: number;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  tmdbId?: number;
  languages: string[];   // ISO codes
  isAnimated: boolean;
  seasonCount: number;
  episodeCount: number;
  franchiseId?: number;
  isExcluded?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Season {
  id: number;
  seriesId: number;
  seasonNumber: number;
  title?: string;
  episodeCount: number;
}

export interface Episode {
  id: number;
  seriesId: number;
  seasonId: number;
  seasonNumber: number;
  episodeNumber: number;
  title?: string;
  overview?: string;
  duration?: number;       // seconds
  filePath: string;
  fileSize: number;        // bytes
  mimeType: string;
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  needsTranscode: boolean;
  isExcluded?: boolean;
  createdAt: string;
}

export interface MediaItem {
  id: number;
  title: string;
  year?: number;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  tmdbId?: number;
  tmdbRating?: number;
  languages: string[];     // ISO codes
  isAnimated: boolean;
  isSeries: false;
  duration?: number;       // seconds
  filePath: string;
  fileSize: number;        // bytes
  mimeType: string;
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  needsTranscode: boolean;
  franchiseId?: number;
  franchiseName?: string;
  franchiseOrder?: number;
  isExcluded?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AudioTrack {
  index: number;
  language?: string;       // ISO code
  codec: string;
  channels: number;
  label?: string;
}

export interface SubtitleTrack {
  index: number;
  language?: string;
  codec: string;
  label?: string;
  isExternal: boolean;
  filePath?: string;       // for external .srt/.vtt
}

export interface WatchProgress {
  id: number;
  mediaId: number;
  mediaType: MediaType;
  positionSeconds: number;
  durationSeconds: number;
  percentComplete: number;
  updatedAt: string;
}

// ─── API response shapes ─────────────────────────────────────────────────────

export interface LibraryResponse {
  movies: MediaItem[];
  series: Series[];
  franchises: Franchise[];
  categories: CategorySummary[];
  languages: Language[];
  totalCount: number;
}

export interface CategorySummary {
  key: ContentCategory;
  label: string;
  count: number;
}

export interface SeriesDetailResponse extends Series {
  seasons: (Season & { episodes: Episode[] })[];
}

export interface ScanStatus {
  running: boolean;
  progress: number;       // 0-100
  currentFile?: string;
  scannedCount: number;
  totalFound: number;
  startedAt?: string;
  completedAt?: string;
  errors: string[];
}

export interface StreamInfo {
  id: number;
  mediaType: MediaType;
  filePath: string;
  mimeType: string;
  fileSize: number;
  needsTranscode: boolean;
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
}

// ─── Portal & Content Control Types ──────────────────────────────────────────

export interface FileTreeNode {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  extension?: string;
  isMedia: boolean;
  isExcluded: boolean;
  mediaType?: 'movie' | 'series' | 'episode';
  mediaId?: number;
  title?: string;
  year?: number;
  isAnimated?: boolean;
  languages?: string[];
  franchiseName?: string;
  totalMediaCount: number;
  excludedMediaCount: number;
  children?: FileTreeNode[];
}

export interface ControlStats {
  rootPath: string;
  totalFiles: number;
  totalMediaFiles: number;
  includedMediaFiles: number;
  excludedMediaFiles: number;
  totalDirectories: number;
}

export interface MediaOverrideInput {
  title?: string;
  year?: number;
  isAnimated?: boolean;
  languages?: string[];
  franchiseName?: string;
  isSeries?: boolean;
}
