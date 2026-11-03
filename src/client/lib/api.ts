/**
 * Centralized API client for TeleBhaja backend
 */

const BASE = import.meta.env.DEV ? '/api' : '/api';

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => 'Unknown error');
    throw new Error(`API ${path} → ${res.status}: ${err}`);
  }
  return res.json() as Promise<T>;
}

import type {
  LibraryResponse, MediaItem, Series, SeriesDetailResponse,
  Franchise, CategorySummary, WatchProgress, ScanStatus,
  FileTreeNode, ControlStats, MediaOverrideInput, FolderCategorizeInput,
  StorageDrive, DriveBrowseResponse,
} from '../../shared/types.js';

// ── Library ──────────────────────────────────────────────────────────────────

export interface LibraryQuery {
  category?: string;
  language?: string;
  search?: string;
  page?: number;
  limit?: number;
  drive?: string;
}

export const api = {
  library: {
    get: (query?: LibraryQuery) => {
      const params = new URLSearchParams();
      if (query?.category) params.set('category', query.category);
      if (query?.language) params.set('language', query.language);
      if (query?.search) params.set('search', query.search);
      if (query?.page) params.set('page', String(query.page));
      if (query?.limit) params.set('limit', String(query.limit));
      if (query?.drive) params.set('drive', query.drive);
      const qs = params.toString();
      return apiFetch<LibraryResponse>(`/library${qs ? `?${qs}` : ''}`);
    },
    getMovie: (id: number) => apiFetch<MediaItem>(`/library/movies/${id}`),
    getSeries: (id: number) => apiFetch<SeriesDetailResponse>(`/library/series/${id}`),
    getDrives: () => apiFetch<StorageDrive[]>('/library/drives'),
    browse: (drive?: string, subpath?: string) => {
      const params = new URLSearchParams();
      if (drive) params.set('drive', drive);
      if (subpath) params.set('subpath', subpath);
      const qs = params.toString();
      return apiFetch<DriveBrowseResponse>(`/library/browse${qs ? `?${qs}` : ''}`);
    },
  },

  drives: {
    list: () => apiFetch<StorageDrive[]>('/library/drives'),
    browse: (drive?: string, subpath?: string) => {
      const params = new URLSearchParams();
      if (drive) params.set('drive', drive);
      if (subpath) params.set('subpath', subpath);
      const qs = params.toString();
      return apiFetch<DriveBrowseResponse>(`/library/browse${qs ? `?${qs}` : ''}`);
    },
  },

  franchises: {
    list: () => apiFetch<Franchise[]>('/franchises'),
    get: (id: number) => apiFetch<Franchise & { movies: Partial<MediaItem>[] }>(`/franchises/${id}`),
  },

  categories: {
    list: () => apiFetch<CategorySummary[]>('/categories'),
  },

  progress: {
    get: (type: 'movie' | 'episode', id: number) =>
      apiFetch<WatchProgress>(`/progress/${type}/${id}`),
    save: (type: 'movie' | 'episode', id: number, positionSeconds: number, durationSeconds: number) =>
      apiFetch<{ ok: boolean }>(`/progress/${type}/${id}`, {
        method: 'POST',
        body: JSON.stringify({ positionSeconds, durationSeconds }),
      }),
    delete: (type: 'movie' | 'episode', id: number) =>
      apiFetch<{ ok: boolean }>(`/progress/${type}/${id}`, { method: 'DELETE' }),
    recent: () => apiFetch<{
      movies: RecentItem[];
      episodes: RecentEpisodeItem[];
    }>('/progress/recent/all'),
  },

  scan: {
    start: (path?: string, force = false) => apiFetch<{ ok: boolean }>('/scan/start', {
      method: 'POST',
      body: JSON.stringify({ path, force }),
    }),
    status: () => apiFetch<ScanStatus>('/scan/status'),
  },

  stream: {
    canPlayHls: (): boolean => {
      if (typeof document === 'undefined') return false;
      const v = document.createElement('video');
      return Boolean(
        v.canPlayType('application/vnd.apple.mpegurl') ||
        v.canPlayType('application/x-mpegURL')
      );
    },
    movieUrl: (id: number, transcode = false, preview = false) => {
      let token = '';
      if (typeof document !== 'undefined') {
        const match = document.cookie.match(/telebhaja_gate=([^;]+)/);
        if (match && match[1]) token = match[1];
      }
      const params = new URLSearchParams();
      if (token) params.set('gate_token', token);
      if (preview) params.set('preview', '1');

      if (transcode) {
        if (api.stream.canPlayHls()) {
          const qs = params.toString();
          return `${BASE}/stream/hls/movie/${id}/playlist.m3u8${qs ? `?${qs}` : ''}`;
        }
        params.set('transcode', '1');
      }

      const qs = params.toString();
      return `${BASE}/stream/movie/${id}${qs ? `?${qs}` : ''}`;
    },
    episodeUrl: (id: number, transcode = false, preview = false) => {
      let token = '';
      if (typeof document !== 'undefined') {
        const match = document.cookie.match(/telebhaja_gate=([^;]+)/);
        if (match && match[1]) token = match[1];
      }
      const params = new URLSearchParams();
      if (token) params.set('gate_token', token);
      if (preview) params.set('preview', '1');

      if (transcode) {
        if (api.stream.canPlayHls()) {
          const qs = params.toString();
          return `${BASE}/stream/hls/episode/${id}/playlist.m3u8${qs ? `?${qs}` : ''}`;
        }
        params.set('transcode', '1');
      }

      const qs = params.toString();
      return `${BASE}/stream/episode/${id}${qs ? `?${qs}` : ''}`;
    },
    hlsMovieUrl: (id: number, options?: { seek?: number; audio?: number }) => {
      let token = '';
      if (typeof document !== 'undefined') {
        const match = document.cookie.match(/telebhaja_gate=([^;]+)/);
        if (match && match[1]) token = match[1];
      }
      const params = new URLSearchParams();
      if (options?.seek && options.seek > 0) params.set('seek', options.seek.toFixed(2));
      if (typeof options?.audio === 'number') params.set('audio', String(options.audio));
      if (token) params.set('gate_token', token);
      const qs = params.toString();
      return `${BASE}/stream/hls/movie/${id}/playlist.m3u8${qs ? `?${qs}` : ''}`;
    },
    hlsEpisodeUrl: (id: number, options?: { seek?: number; audio?: number }) => {
      let token = '';
      if (typeof document !== 'undefined') {
        const match = document.cookie.match(/telebhaja_gate=([^;]+)/);
        if (match && match[1]) token = match[1];
      }
      const params = new URLSearchParams();
      if (options?.seek && options.seek > 0) params.set('seek', options.seek.toFixed(2));
      if (typeof options?.audio === 'number') params.set('audio', String(options.audio));
      if (token) params.set('gate_token', token);
      const qs = params.toString();
      return `${BASE}/stream/hls/episode/${id}/playlist.m3u8${qs ? `?${qs}` : ''}`;
    },
    thumbnailMovieUrl: (id: number) => `${BASE}/stream/thumbnail/movie/${id}`,
    thumbnailEpisodeUrl: (id: number) => `${BASE}/stream/thumbnail/episode/${id}`,
    subtitleUrl: (path: string) => `${BASE}/stream/subtitle?path=${encodeURIComponent(path)}`,
    logError: (data: {
      mediaType: 'movie' | 'episode';
      mediaId: number;
      title?: string;
      errorCode?: number;
      errorMessage?: string;
      currentTime?: number;
      src?: string;
    }) => apiFetch<{ ok: boolean }>('/stream/log-error', {
      method: 'POST',
      body: JSON.stringify(data),
    }).catch(() => ({ ok: false })),
  },

  control: {
    getTree: (path?: string) => apiFetch<{ tree: FileTreeNode; stats: ControlStats }>(`/control/tree${path ? `?path=${encodeURIComponent(path)}` : ''}`),
    toggle: (opts: { path?: string; paths?: string[]; isExcluded: boolean; isDirectory?: boolean }) =>
      apiFetch<{ ok: boolean; count: number; isExcluded: boolean }>('/control/toggle', {
        method: 'POST',
        body: JSON.stringify(opts),
      }),
    updateMedia: (type: 'movie' | 'series' | 'episode', id: number, data: MediaOverrideInput) =>
      apiFetch<{ ok: boolean; message: string }>(`/control/media/${type}/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    categorizeFolder: (data: FolderCategorizeInput) =>
      apiFetch<{ ok: boolean; message: string }>('/control/folder', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    getFranchises: () => apiFetch<{ id: number; name: string }[]>('/control/franchises'),
    resolveMedia: (path: string) =>
      apiFetch<{
        ok: boolean;
        mediaType: 'movie' | 'episode';
        id: number;
        title: string;
        duration?: number;
        mimeType?: string;
        needsTranscode?: boolean;
        audioTracks?: import('../../shared/types.js').AudioTrack[];
        subtitleTracks?: import('../../shared/types.js').SubtitleTrack[];
      }>('/control/resolve-media', {
        method: 'POST',
        body: JSON.stringify({ path }),
      }),
    reset: () => apiFetch<{ ok: boolean; message: string }>('/control/reset', { method: 'POST' }),
  },

  health: () => apiFetch<{ ok: boolean; movies: number; series: number; mediaStoragePath: string }>('/health'),
};

export interface RecentItem {
  mediaId: number;
  mediaType: string;
  title: string;
  posterPath?: string;
  backdropPath?: string;
  duration?: number;
  positionSeconds: number;
  percentComplete: number;
  updatedAt: string;
}

export interface RecentEpisodeItem extends RecentItem {
  episodeTitle?: string;
  seasonNumber: number;
  episodeNumber: number;
}
