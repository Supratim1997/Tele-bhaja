/**
 * TMDb API client — enriches parsed media with official metadata,
 * posters, ratings, and collection (franchise) information.
 * All calls are optional/best-effort; missing API key returns null safely.
 */

import { config } from '../config.js';

interface TmdbSearchResult {
  id: number;
  title?: string;
  name?: string;           // for TV
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  release_date?: string;
  first_air_date?: string; // for TV
  vote_average?: number;
  genre_ids?: number[];
  belongs_to_collection?: {
    id: number;
    name: string;
    poster_path?: string;
    backdrop_path?: string;
  };
}

interface TmdbDetails extends TmdbSearchResult {
  genres?: { id: number; name: string }[];
  belongs_to_collection?: {
    id: number;
    name: string;
    poster_path?: string;
    backdrop_path?: string;
  };
  number_of_seasons?: number;
  number_of_episodes?: number;
}

const ANIMATION_GENRE_ID = 16;

const cache = new Map<string, unknown>();

async function tmdbFetch<T>(endpoint: string, params?: Record<string, string>): Promise<T | null> {
  if (!config.tmdb.apiKey) return null;

  const url = new URL(`${config.tmdb.baseUrl}${endpoint}`);
  url.searchParams.set('api_key', config.tmdb.apiKey);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const cacheKey = url.toString();
  if (cache.has(cacheKey)) return cache.get(cacheKey) as T;

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    cache.set(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}

export interface EnrichedMetadata {
  tmdbId?: number;
  title?: string;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  year?: number;
  rating?: number;
  isAnimated?: boolean;
  tmdbCollectionId?: number;
  tmdbCollectionName?: string;
  tmdbCollectionPoster?: string;
  tmdbCollectionBackdrop?: string;
}

export async function enrichMovie(title: string, year?: number): Promise<EnrichedMetadata> {
  const searchData = await tmdbFetch<{ results: TmdbSearchResult[] }>('/search/movie', {
    query: title,
    ...(year ? { year: String(year) } : {}),
    language: 'en-US',
    page: '1',
  });

  const result = searchData?.results?.[0];
  if (!result) return {};

  // Fetch full details for collection info
  const details = await tmdbFetch<TmdbDetails>(`/movie/${result.id}`);
  const isAnimated = (details?.genre_ids ?? result.genre_ids ?? []).includes(ANIMATION_GENRE_ID)
    || (details?.genres ?? []).some((g) => g.id === ANIMATION_GENRE_ID);

  const releaseYear = result.release_date?.split('-')[0];

  return {
    tmdbId: result.id,
    title: result.title,
    overview: result.overview,
    posterPath:   result.poster_path   ? `${config.tmdb.imageBase}/w500${result.poster_path}` : undefined,
    backdropPath: result.backdrop_path ? `${config.tmdb.imageBase}/w1280${result.backdrop_path}` : undefined,
    year:   releaseYear ? parseInt(releaseYear, 10) : undefined,
    rating: result.vote_average,
    isAnimated,
    tmdbCollectionId:      details?.belongs_to_collection?.id,
    tmdbCollectionName:    details?.belongs_to_collection?.name,
    tmdbCollectionPoster:  details?.belongs_to_collection?.poster_path
      ? `${config.tmdb.imageBase}/w500${details.belongs_to_collection.poster_path}`
      : undefined,
    tmdbCollectionBackdrop: details?.belongs_to_collection?.backdrop_path
      ? `${config.tmdb.imageBase}/w1280${details.belongs_to_collection.backdrop_path}`
      : undefined,
  };
}

export async function enrichSeries(title: string, year?: number): Promise<EnrichedMetadata> {
  const searchData = await tmdbFetch<{ results: TmdbSearchResult[] }>('/search/tv', {
    query: title,
    ...(year ? { first_air_date_year: String(year) } : {}),
    language: 'en-US',
    page: '1',
  });

  const result = searchData?.results?.[0];
  if (!result) return {};

  const details = await tmdbFetch<TmdbDetails>(`/tv/${result.id}`);
  const isAnimated = (details?.genre_ids ?? result.genre_ids ?? []).includes(ANIMATION_GENRE_ID)
    || (details?.genres ?? []).some((g) => g.id === ANIMATION_GENRE_ID);

  const firstAirYear = (result.first_air_date ?? '').split('-')[0];

  return {
    tmdbId:      result.id,
    title:       result.name,
    overview:    result.overview,
    posterPath:   result.poster_path   ? `${config.tmdb.imageBase}/w500${result.poster_path}` : undefined,
    backdropPath: result.backdrop_path ? `${config.tmdb.imageBase}/w1280${result.backdrop_path}` : undefined,
    year:   firstAirYear ? parseInt(firstAirYear, 10) : undefined,
    rating: result.vote_average,
    isAnimated,
  };
}
