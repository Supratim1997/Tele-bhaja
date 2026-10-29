import React, { useState } from 'react';
import type { MediaItem, Series } from '../../shared/types.js';
import { api } from '../lib/api.js';

// ─── Movie Card ───────────────────────────────────────────────────────────────

interface MovieCardProps {
  movie: MediaItem;
  onClick: () => void;
  progress?: number; // 0-100
  className?: string;
}

export const MovieCard: React.FC<MovieCardProps> = ({ movie, onClick, progress, className }) => {
  const [thumbError, setThumbError] = useState(false);

  const posterUrl = movie.posterPath ?? api.stream.thumbnailMovieUrl(movie.id);

  return (
    <div
      id={`movie-card-${movie.id}`}
      className={`media-card ${className ?? 'w-full'}`}
      onClick={onClick}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-surface-800">
        {!thumbError ? (
          <img
            src={posterUrl}
            alt={movie.title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setThumbError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-surface-800">
            <svg className="w-10 h-10 text-surface-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z" />
            </svg>
          </div>
        )}

        {/* Overlay */}
        <div className="card-overlay" />

        {/* Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {movie.isAnimated && (
            <span className="badge bg-purple-600/80 text-purple-100 text-[10px]">✨ Animated</span>
          )}
        </div>

        {/* Rating */}
        {movie.tmdbRating && movie.tmdbRating > 0 && (
          <div className="absolute top-2 right-2">
            <span className="badge bg-yellow-500/80 text-yellow-100 text-[10px]">
              ★ {movie.tmdbRating.toFixed(1)}
            </span>
          </div>
        )}

        {/* Card info (shown on hover) */}
        <div className="card-info">
          <p className="text-white text-xs font-semibold line-clamp-2 leading-tight">{movie.title}</p>
          {movie.year && <p className="text-surface-300 text-[10px] mt-0.5">{movie.year}</p>}
          <div className="mt-1.5 flex items-center justify-center">
            <div className="flex items-center gap-1 px-3 py-1 bg-brand-600 rounded-full">
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span className="text-white text-[10px] font-semibold">Play</span>
            </div>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {progress !== undefined && progress > 0 && (
        <div className="mt-1.5 progress-bar">
          <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
      )}

      {/* Title below card (on mobile where hover isn't available) */}
      <p className="text-white text-xs font-medium mt-1.5 line-clamp-1 md:hidden">{movie.title}</p>
    </div>
  );
};

// ─── Series Card ──────────────────────────────────────────────────────────────

interface SeriesCardProps {
  series: Series;
  onClick: () => void;
  className?: string;
}

export const SeriesCard: React.FC<SeriesCardProps> = ({ series, onClick, className }) => {
  const [thumbError, setThumbError] = useState(false);

  return (
    <div
      id={`series-card-${series.id}`}
      className={`media-card ${className ?? 'w-full'}`}
      onClick={onClick}
    >
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-surface-800">
        {series.posterPath && !thumbError ? (
          <img
            src={series.posterPath}
            alt={series.title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setThumbError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-surface-800 to-surface-900 p-3">
            <svg className="w-8 h-8 text-surface-600 mb-2" fill="currentColor" viewBox="0 0 24 24">
              <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z" />
            </svg>
            <p className="text-surface-400 text-xs text-center line-clamp-3">{series.title}</p>
          </div>
        )}

        <div className="card-overlay" />

        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {series.isAnimated && (
            <span className="badge bg-purple-600/80 text-purple-100 text-[10px]">✨ Anime</span>
          )}
        </div>

        <div className="card-info">
          <p className="text-white text-xs font-semibold line-clamp-2">{series.title}</p>
          <p className="text-surface-400 text-[10px] mt-0.5">
            {series.seasonCount}S · {series.episodeCount}EP
          </p>
          <div className="mt-1.5 flex items-center justify-center">
            <div className="flex items-center gap-1 px-3 py-1 bg-brand-600 rounded-full">
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z" />
              </svg>
              <span className="text-white text-[10px] font-semibold">Episodes</span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-white text-xs font-medium mt-1.5 line-clamp-1 md:hidden">{series.title}</p>
    </div>
  );
};

// ─── Franchise Banner Card ────────────────────────────────────────────────────

interface FranchiseBannerProps {
  id: number;
  name: string;
  posterPath?: string;
  backdropPath?: string;
  itemCount: number;
  onClick: () => void;
}

export const FranchiseBanner: React.FC<FranchiseBannerProps> = ({
  id, name, posterPath, backdropPath, itemCount, onClick,
}) => {
  return (
    <div
      id={`franchise-card-${id}`}
      className="media-card flex-shrink-0 w-56 md:w-72"
      onClick={onClick}
    >
      <div className="relative h-32 md:h-40 rounded-xl overflow-hidden bg-surface-800">
        {backdropPath ? (
          <img src={backdropPath} alt={name} className="w-full h-full object-cover" loading="lazy" />
        ) : posterPath ? (
          <img src={posterPath} alt={name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-brand-900/50 to-surface-800 flex items-center justify-center">
            <span className="text-brand-400 text-4xl font-display font-black">{name[0]}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
        <div className="absolute bottom-3 left-3 right-3">
          <p className="text-white font-display font-bold text-base leading-tight line-clamp-2">{name}</p>
          <p className="text-surface-400 text-xs mt-0.5">{itemCount} Films</p>
        </div>
      </div>
    </div>
  );
};

// ─── Skeleton Card ────────────────────────────────────────────────────────────

export const SkeletonCard: React.FC<{ className?: string }> = ({ className }) => (
  <div className={className ?? 'w-full'}>
    <div className="skeleton aspect-[2/3] rounded-xl" />
    <div className="skeleton h-3 rounded mt-2 w-3/4" />
  </div>
);
