import React, { useState, useEffect, useCallback } from 'react';
import { useLibrary, useScanStatus, useDebounce } from '../hooks/useMedia.js';
import { MovieCard, SeriesCard, FranchiseBanner, SkeletonCard } from '../components/MediaCard.js';
import MoviePlayerModal from '../components/MoviePlayerModal.js';
import SeriesDrawer from '../components/SeriesDrawer.js';
import FranchiseDrawer from '../components/FranchiseDrawer.js';
import type { MediaItem, Series, ContentCategory } from '../../shared/types.js';
import { api, type RecentItem, type RecentEpisodeItem } from '../lib/api.js';

type DrawerState =
  | { type: 'none' }
  | { type: 'movie'; movie: MediaItem }
  | { type: 'series'; id: number }
  | { type: 'franchise'; id: number };

const CATEGORIES = [
  { key: 'all',       label: '🏠 All' },
  { key: 'movie',     label: '🎬 Movies' },
  { key: 'series',    label: '📺 Series' },
  { key: 'animated',  label: '✨ Animated' },
  { key: 'franchise', label: '🎭 Franchises' },
] as const;

type CategoryKey = typeof CATEGORIES[number]['key'];

const Home: React.FC = () => {
  const [category, setCategory] = useState<CategoryKey>('all');
  const [language, setLanguage] = useState('');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<DrawerState>({ type: 'none' });
  const [recent, setRecent] = useState<{ movies: RecentItem[]; episodes: RecentEpisodeItem[] } | null>(null);
  const [heroItem, setHeroItem] = useState<MediaItem | null>(null);

  const debouncedSearch = useDebounce(search, 350);

  const { data, loading, refetch } = useLibrary({
    category: category === 'all' ? undefined : category,
    language: language || undefined,
    search: debouncedSearch || undefined,
    limit: 10000,
  });

  const { status: scanStatus, startScan } = useScanStatus();

  // Load recent watches
  useEffect(() => {
    api.progress.recent().then(setRecent).catch(() => {});
  }, []);

  // Pick hero from first movie with backdrop
  useEffect(() => {
    if (data?.movies) {
      const featured = data.movies.find((m) => m.backdropPath);
      if (featured) setHeroItem(featured);
    }
  }, [data]);

  const openMovie = useCallback(async (id: number) => {
    try {
      const movie = await api.library.getMovie(id);
      setDrawer({ type: 'movie', movie });
    } catch (err) {
      console.error(err);
    }
  }, []);

  const showFranchises = category === 'all' || category === 'franchise';
  const showMovies = category === 'all' || category === 'movie' || category === 'animated';
  const showSeries = category === 'all' || category === 'series' || category === 'animated';

  return (
    <div className="min-h-screen bg-surface-950 pb-24">

      {/* ── Hero Section ──────────────────────────────────────────────────── */}
      {heroItem && category === 'all' && !debouncedSearch && (
        <div className="relative h-[55vw] min-h-[280px] max-h-[520px] overflow-hidden">
          <img
            src={heroItem.backdropPath!}
            alt={heroItem.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 hero-gradient" />

          <div className="absolute bottom-8 left-4 md:left-12 max-w-md md:max-w-lg">
            <h1
              className="font-display font-black text-3xl md:text-5xl text-white leading-tight drop-shadow-xl"
              style={{ textShadow: '0 2px 20px rgba(0,0,0,0.8)' }}
            >
              {heroItem.title}
            </h1>
            <div className="flex items-center gap-3 mt-2">
              {heroItem.year && <span className="text-surface-300 text-sm">{heroItem.year}</span>}
              {heroItem.tmdbRating && (
                <span className="text-yellow-400 text-sm font-medium">★ {heroItem.tmdbRating.toFixed(1)}</span>
              )}
              {heroItem.isAnimated && (
                <span className="badge bg-purple-600/80 text-purple-100">Animated</span>
              )}
            </div>
            {heroItem.overview && (
              <p className="text-surface-300 text-sm mt-2 line-clamp-2 max-w-sm md:max-w-md">{heroItem.overview}</p>
            )}
            <div className="flex gap-3 mt-4">
              <button
                id={`hero-play-${heroItem.id}`}
                className="flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-full font-semibold text-sm hover:bg-surface-200 transition-colors shadow-xl"
                onClick={() => void openMovie(heroItem.id)}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Play
              </button>
              <button
                className="flex items-center gap-2 px-5 py-2.5 bg-surface-700/80 text-white rounded-full font-semibold text-sm hover:bg-surface-600 transition-colors backdrop-blur-sm"
                onClick={() => void openMovie(heroItem.id)}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                More Info
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Top bar (when no hero) ─────────────────────────────────────────── */}
      {(category !== 'all' || debouncedSearch) && (
        <div className="pt-safe pt-4 px-4 md:px-8">
          <h1 className="font-display font-black text-2xl md:text-3xl text-brand-500 mb-1">
            🎬 TeleBhaja
          </h1>
        </div>
      )}

      <div className="px-4 md:px-8 mt-6 space-y-8">

        {/* ── Scan status banner ───────────────────────────────────────────── */}
        {scanStatus?.running && (
          <div className="glass-card p-4 flex items-center gap-3 border-brand-800/40">
            <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium">
                Scanning library… {scanStatus.progress}%
              </p>
              {scanStatus.currentFile && (
                <p className="text-surface-400 text-xs truncate mt-0.5">{scanStatus.currentFile}</p>
              )}
            </div>
            <div className="w-24 h-1.5 bg-surface-700 rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${scanStatus.progress}%` }} />
            </div>
          </div>
        )}

        {/* ── Search + Filters ─────────────────────────────────────────────── */}
        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              id="search-input"
              type="search"
              placeholder="Search movies, series…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-surface-800 border border-surface-700 text-white placeholder-surface-500 text-sm focus:outline-none focus:border-brand-600 transition-colors"
            />
          </div>

          {/* Category pills */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {CATEGORIES.map(({ key, label }) => (
              <button
                key={key}
                id={`cat-${key}`}
                className={`filter-pill ${category === key ? 'active' : ''}`}
                onClick={() => setCategory(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Language filter */}
          {data?.languages && data.languages.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              <button
                className={`filter-pill ${language === '' ? 'active' : ''}`}
                onClick={() => setLanguage('')}
              >
                All Languages
              </button>
              {data.languages.map((lang) => (
                <button
                  key={lang.code}
                  id={`lang-${lang.code}`}
                  className={`filter-pill ${language === lang.code ? 'active' : ''}`}
                  onClick={() => setLanguage(lang.code)}
                >
                  {lang.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Continue Watching ────────────────────────────────────────────── */}
        {category === 'all' && !debouncedSearch && recent && (recent.movies.length > 0 || recent.episodes.length > 0) && (
          <section>
            <h2 className="section-title mb-3">⏱ Continue Watching</h2>
            <div className="scroll-row">
              {recent.movies.map((item) => (
                <div key={item.mediaId} className="flex-shrink-0 w-32 md:w-40">
                  <MovieCard
                    movie={{
                      id: item.mediaId,
                      title: item.title,
                      posterPath: item.posterPath,
                      backdropPath: item.backdropPath,
                      duration: item.duration,
                      isSeries: false,
                      languages: [],
                      isAnimated: false,
                      filePath: '',
                      fileSize: 0,
                      mimeType: 'video/mp4',
                      audioTracks: [],
                      subtitleTracks: [],
                      needsTranscode: false,
                      createdAt: '',
                      updatedAt: '',
                    }}
                    onClick={() => void openMovie(item.mediaId)}
                    progress={item.percentComplete}
                  />
                </div>
              ))}
              {recent.episodes.map((item) => (
                <div key={item.mediaId} className="flex-shrink-0 w-32 md:w-40">
                  <SeriesCard
                    series={{
                      id: item.mediaId,
                      title: item.title,
                      posterPath: item.posterPath,
                      backdropPath: item.backdropPath,
                      languages: [],
                      isAnimated: false,
                      seasonCount: 0,
                      episodeCount: 0,
                      createdAt: '',
                      updatedAt: '',
                    }}
                    onClick={() => setDrawer({ type: 'series', id: item.mediaId })}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Franchises ───────────────────────────────────────────────────── */}
        {showFranchises && data && data.franchises.length > 0 && !debouncedSearch && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-title">🎭 Franchise Collections</h2>
              {data.franchises.length > 3 && (
                <button
                  className="text-brand-400 text-sm font-medium hover:text-brand-300"
                  onClick={() => setCategory('franchise')}
                >
                  See All
                </button>
              )}
            </div>
            <div className="scroll-row">
              {data.franchises.map((f) => (
                <FranchiseBanner
                  key={f.id}
                  id={f.id}
                  name={f.name}
                  posterPath={f.posterPath}
                  backdropPath={f.backdropPath}
                  itemCount={f.itemCount}
                  onClick={() => setDrawer({ type: 'franchise', id: f.id })}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Movies ──────────────────────────────────────────────────────── */}
        {showMovies && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-title">
                {category === 'animated' ? '✨ Animated Films' : '🎬 Movies'}
              </h2>
              {data && (
                <span className="text-surface-500 text-sm">{data.movies.length} titles</span>
              )}
            </div>
            {loading ? (
              <div className="scroll-row">
                {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : data && data.movies.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9 gap-3 md:gap-4">
                {data.movies.map((movie) => (
                  <MovieCard
                    key={movie.id}
                    movie={movie}
                    onClick={() => void openMovie(movie.id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState label="No movies found" />
            )}
          </section>
        )}

        {/* ── Series ──────────────────────────────────────────────────────── */}
        {showSeries && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-title">
                {category === 'animated' ? '✨ Animated Series' : '📺 TV Series'}
              </h2>
              {data && (
                <span className="text-surface-500 text-sm">{data.series.length} shows</span>
              )}
            </div>
            {loading ? (
              <div className="scroll-row">
                {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : data && data.series.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9 gap-3 md:gap-4">
                {data.series.map((series) => (
                  <SeriesCard
                    key={series.id}
                    series={series}
                    onClick={() => setDrawer({ type: 'series', id: series.id })}
                  />
                ))}
              </div>
            ) : (
              <EmptyState label="No series found" />
            )}
          </section>
        )}

        {/* ── Library stats / empty state ───────────────────────────────────── */}
        {!loading && data && data.movies.length === 0 && data.series.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-full bg-surface-800 flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-surface-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z" />
              </svg>
            </div>
            <h3 className="text-white font-semibold text-lg mb-2">Library is empty</h3>
            <p className="text-surface-400 text-sm max-w-xs mb-6">
              Your media storage path hasn't been scanned yet, or no supported files were found.
            </p>
            <button
              id="start-scan-btn"
              className="flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-full font-semibold transition-colors shadow-lg"
              onClick={() => void startScan()}
              disabled={scanStatus?.running}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {scanStatus?.running ? 'Scanning…' : 'Scan Library'}
            </button>
          </div>
        )}
      </div>

      {/* ── Drawers / Modals ─────────────────────────────────────────────────── */}
      {drawer.type === 'movie' && (
        <MoviePlayerModal
          movie={drawer.movie}
          onClose={() => setDrawer({ type: 'none' })}
        />
      )}
      {drawer.type === 'series' && (
        <SeriesDrawer
          seriesId={drawer.id}
          onClose={() => setDrawer({ type: 'none' })}
        />
      )}
      {drawer.type === 'franchise' && (
        <FranchiseDrawer
          franchiseId={drawer.id}
          onClose={() => setDrawer({ type: 'none' })}
        />
      )}
    </div>
  );
};

const EmptyState: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center justify-center py-12 text-surface-500 text-sm">{label}</div>
);

export default Home;
