import React, { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import Player from './Player.js';
import type { SeriesDetailResponse, Episode } from '../../shared/types.js';

interface SeriesDrawerProps {
  seriesId: number;
  onClose: () => void;
}

const SeriesDrawer: React.FC<SeriesDrawerProps> = ({ seriesId, onClose }) => {
  const [data, setData] = useState<SeriesDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSeason, setActiveSeason] = useState(1);
  const [playingEpisode, setPlayingEpisode] = useState<Episode | null>(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    api.library.getSeries(seriesId)
      .then((d) => {
        setData(d);
        setActiveSeason(d.seasons[0]?.seasonNumber ?? 1);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [seriesId]);

  if (playingEpisode) {
    return (
      <div className="fixed inset-0 z-50 bg-black animate-fade-in">
        <Player
          src={playingEpisode.needsTranscode
            ? api.stream.episodeUrl(playingEpisode.id, true)
            : api.stream.episodeUrl(playingEpisode.id)}
          title={`${data?.title ?? ''} · S${playingEpisode.seasonNumber}E${playingEpisode.episodeNumber}${
            playingEpisode.title ? ` · ${playingEpisode.title}` : ''
          }`}
          mediaType="episode"
          mediaId={playingEpisode.id}
          audioTracks={playingEpisode.audioTracks}
          subtitleTracks={playingEpisode.subtitleTracks}
          needsTranscode={playingEpisode.needsTranscode}
          mimeType={playingEpisode.mimeType}
          onClose={() => setPlayingEpisode(null)}
        />
      </div>
    );
  }

  const currentSeason = data?.seasons.find((s) => s.seasonNumber === activeSeason);

  return (
    <div
      id="series-drawer"
      className="fixed inset-0 z-40 flex items-end md:items-center justify-center animate-fade-in"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 modal-backdrop" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full md:max-w-3xl md:rounded-2xl bg-surface-900 flex flex-col max-h-[92dvh] animate-slide-up">
        {/* Header with backdrop */}
        {data?.backdropPath && (
          <div className="relative h-40 md:h-52 md:rounded-t-2xl overflow-hidden flex-shrink-0">
            <img
              src={data.backdropPath}
              alt={data.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-surface-900 via-surface-900/60 to-transparent" />
            <div className="absolute bottom-3 left-4 right-12">
              <h2 className="font-display font-bold text-2xl text-white drop-shadow">{data?.title}</h2>
              <div className="flex items-center gap-2 mt-1">
                {data?.year && <span className="text-surface-300 text-sm">{data.year}</span>}
                {data?.isAnimated && (
                  <span className="badge bg-purple-600/30 text-purple-300 border border-purple-500/30">Animated</span>
                )}
                <span className="badge bg-surface-700 text-surface-300">
                  {data?.seasonCount} Season{(data?.seasonCount ?? 0) !== 1 ? 's' : ''}
                </span>
                <span className="badge bg-surface-700 text-surface-300">
                  {data?.episodeCount} Episodes
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Without backdrop */}
        {!data?.backdropPath && !loading && (
          <div className="flex items-center justify-between p-4 border-b border-surface-800 flex-shrink-0">
            <div>
              <h2 className="font-display font-bold text-xl text-white">{data?.title}</h2>
              <div className="flex gap-2 mt-1">
                {data?.year && <span className="text-surface-400 text-sm">{data.year}</span>}
              </div>
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Close button */}
        <button
          id="series-close-btn"
          className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
          onClick={onClose}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Overview */}
        {data?.overview && (
          <p className="text-surface-400 text-sm px-4 pt-3 pb-2 flex-shrink-0 line-clamp-2">{data.overview}</p>
        )}

        {/* Season tabs */}
        {data && data.seasons.length > 1 && (
          <div className="flex gap-2 px-4 py-3 flex-shrink-0 overflow-x-auto scrollbar-hide">
            {data.seasons.map((s) => (
              <button
                key={s.seasonNumber}
                id={`season-tab-${s.seasonNumber}`}
                className={`filter-pill flex-shrink-0 ${activeSeason === s.seasonNumber ? 'active' : ''}`}
                onClick={() => setActiveSeason(s.seasonNumber)}
              >
                Season {s.seasonNumber}
              </button>
            ))}
          </div>
        )}

        {/* Episode list */}
        <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-2">
          {currentSeason?.episodes.map((ep) => (
            <EpisodeRow
              key={ep.id}
              episode={ep}
              onPlay={() => setPlayingEpisode(ep)}
            />
          ))}
          {currentSeason?.episodes.length === 0 && (
            <p className="text-surface-500 text-sm py-8 text-center">No episodes found for this season.</p>
          )}
        </div>
      </div>
    </div>
  );
};

interface EpisodeRowProps {
  episode: Episode;
  onPlay: () => void;
}

const EpisodeRow: React.FC<EpisodeRowProps> = ({ episode, onPlay }) => {
  const [progress, setProgress] = useState<number>(0);

  useEffect(() => {
    api.progress.get('episode', episode.id).then((p) => setProgress(p.positionSeconds ?? 0)).catch(() => {});
  }, [episode.id]);

  const pct = episode.duration && episode.duration > 0 ? (progress / episode.duration) * 100 : 0;

  return (
    <button
      id={`episode-${episode.id}`}
      className="w-full flex items-center gap-3 p-3 rounded-xl bg-surface-800/50 hover:bg-surface-800 active:bg-surface-700 transition-colors text-left group"
      onClick={onPlay}
    >
      {/* Thumbnail */}
      <div className="relative w-24 h-14 flex-shrink-0 rounded-lg overflow-hidden bg-surface-700">
        <img
          src={api.stream.thumbnailEpisodeUrl(episode.id)}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/50 transition-opacity">
          <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        {pct > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5">
            <div className="h-full bg-brand-500" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-surface-400 text-xs font-mono">
            E{String(episode.episodeNumber).padStart(2, '0')}
          </span>
          {episode.title && (
            <span className="text-white text-sm font-medium truncate">{episode.title}</span>
          )}
        </div>
        {episode.duration && (
          <span className="text-surface-500 text-xs mt-0.5 block">
            {Math.floor(episode.duration / 60)}m
            {pct > 0 && ` · ${Math.round(pct)}% watched`}
          </span>
        )}
      </div>

      {/* Play icon */}
      <svg className="w-5 h-5 text-brand-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" fill="currentColor" viewBox="0 0 24 24">
        <path d="M8 5v14l11-7z" />
      </svg>
    </button>
  );
};

export default SeriesDrawer;
