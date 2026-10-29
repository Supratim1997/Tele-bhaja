import React, { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import type { Franchise, MediaItem } from '../../shared/types.js';
import MoviePlayerModal from './MoviePlayerModal.js';

interface FranchiseDrawerProps {
  franchiseId: number;
  onClose: () => void;
}

interface FranchiseDetail extends Franchise {
  movies: Partial<MediaItem>[];
}

const FranchiseDrawer: React.FC<FranchiseDrawerProps> = ({ franchiseId, onClose }) => {
  const [data, setData] = useState<FranchiseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [playingMovie, setPlayingMovie] = useState<MediaItem | null>(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    api.franchises.get(franchiseId)
      .then((d) => setData(d as FranchiseDetail))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [franchiseId]);

  if (playingMovie) {
    return <MoviePlayerModal movie={playingMovie} onClose={() => setPlayingMovie(null)} />;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center animate-fade-in">
      <div className="absolute inset-0 modal-backdrop" onClick={onClose} />
      <div
        id={`franchise-drawer-${franchiseId}`}
        className="relative w-full md:max-w-2xl md:rounded-2xl bg-surface-900 flex flex-col max-h-[90dvh] animate-slide-up"
      >
        {/* Header */}
        {data?.backdropPath && (
          <div className="relative h-40 md:rounded-t-2xl overflow-hidden flex-shrink-0">
            <img src={data.backdropPath} alt={data.name} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-surface-900 via-surface-900/50 to-transparent" />
            <div className="absolute bottom-3 left-4">
              <h2 className="font-display font-bold text-2xl text-white">{data?.name}</h2>
              <p className="text-surface-400 text-sm">{data?.itemCount} Films · Chronological Order</p>
            </div>
          </div>
        )}
        {!data?.backdropPath && !loading && (
          <div className="p-4 border-b border-surface-800">
            <h2 className="font-display font-bold text-xl text-white">{data?.name}</h2>
            <p className="text-surface-400 text-sm">{data?.itemCount} Films</p>
          </div>
        )}

        {/* Close button */}
        <button
          id="franchise-close-btn"
          className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center text-white"
          onClick={onClose}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Movie list */}
        <div className="flex-1 overflow-y-auto px-4 pb-6 pt-2 space-y-2">
          {data?.movies.map((movie, idx) => (
            <button
              key={movie.id}
              id={`franchise-movie-${movie.id}`}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-surface-800/50 hover:bg-surface-800 active:bg-surface-700 transition-colors text-left group"
              onClick={() => movie.id && api.library.getMovie(movie.id).then(setPlayingMovie).catch(console.error)}
            >
              {/* Order number */}
              <div className="w-8 h-8 rounded-full bg-brand-600/20 border border-brand-600/30 flex items-center justify-center flex-shrink-0">
                <span className="text-brand-400 text-xs font-bold">{idx + 1}</span>
              </div>

              {/* Poster */}
              <div className="w-10 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-surface-700">
                {movie.posterPath && (
                  <img src={movie.posterPath} alt={movie.title} className="w-full h-full object-cover" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold line-clamp-1">{movie.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {movie.year && <span className="text-surface-400 text-xs">{movie.year}</span>}
                  {movie.tmdbRating && (
                    <span className="text-yellow-400 text-xs">★ {(movie.tmdbRating as number).toFixed(1)}</span>
                  )}
                  {movie.duration && (
                    <span className="text-surface-500 text-xs">
                      {Math.floor((movie.duration as number) / 60)}m
                    </span>
                  )}
                </div>
              </div>

              <svg className="w-5 h-5 text-brand-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FranchiseDrawer;
