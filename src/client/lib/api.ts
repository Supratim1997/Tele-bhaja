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
} from '../../shared/types.js';

// ── Library ──────────────────────────────────────────────────────────────────

export interface LibraryQuery {
  category?: string;
  language?: string;
  search?: string;
  page?: number;
  limit?: number;
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
      const qs = params.toString();
      return apiFetch<LibraryResponse>(`/library${qs ? `?${qs}` : ''}`);
    },
    getMovie: (id: number) => apiFetch<MediaItem>(`/library/movies/${id}`),
    getSeries: (id: number) => apiFetch<SeriesDetailResponse>(`/library/series/${id}`),
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
    movieUrl: (id: number, transcode = false) =>
      `${BASE}/stream/movie/${id}${transcode ? '?transcode=1' : ''}`,
    episodeUrl: (id: number, transcode = false) =>
      `${BASE}/stream/episode/${id}${transcode ? '?transcode=1' : ''}`,
    thumbnailMovieUrl: (id: number) => `${BASE}/stream/thumbnail/movie/${id}`,
    thumbnailEpisodeUrl: (id: number) => `${BASE}/stream/thumbnail/episode/${id}`,
    subtitleUrl: (path: string) => `${BASE}/stream/subtitle?path=${encodeURIComponent(path)}`,
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
