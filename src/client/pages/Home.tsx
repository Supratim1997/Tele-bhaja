import React, { useState, useEffect, useCallback } from 'react';
import { useLibrary, useScanStatus, useDebounce } from '../hooks/useMedia.js';
import { MovieCard, SeriesCard, FranchiseBanner, SkeletonCard } from '../components/MediaCard.js';
import MoviePlayerModal from '../components/MoviePlayerModal.js';
import SeriesDrawer from '../components/SeriesDrawer.js';
import FranchiseDrawer from '../components/FranchiseDrawer.js';
import DriveFolderBrowser from '../components/DriveFolderBrowser.js';
import type { MediaItem, Series, ContentCategory, StorageDrive } from '../../shared/types.js';
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
  const [drives, setDrives] = useState<StorageDrive[]>([]);
  const [selectedDriveId, setSelectedDriveId] = useState<string>('all');
  const [driveViewModes, setDriveViewModes] = useState<Record<string, 'ott' | 'folder'>>(() => {
    try {
      return JSON.parse(localStorage.getItem('telebhaja_drive_views') || '{}');
    } catch {
      return {};
    }
  });

  const [category, setCategory] = useState<CategoryKey>('all');
  const [language, setLanguage] = useState('');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<DrawerState>({ type: 'none' });
  const [recent, setRecent] = useState<{ movies: RecentItem[]; episodes: RecentEpisodeItem[] } | null>(null);
  const [heroItem, setHeroItem] = useState<MediaItem | null>(null);

  const debouncedSearch = useDebounce(search, 350);

  // Load drives
  useEffect(() => {
    api.drives.list().then((list) => {
      setDrives(list);
      if (list.length > 0 && selectedDriveId === 'all') {
        const primary = list.find((d) => d.isPrimary) || list[0];
        setSelectedDriveId(primary.id);
      }
    }).catch(() => {});
  }, []);

  const currentDrive = drives.find((d) => d.id === selectedDriveId) || drives[0];
  const isPrimary = currentDrive ? currentDrive.isPrimary : true;
  const currentViewMode: 'ott' | 'folder' = isPrimary
    ? 'ott'
    : (driveViewModes[selectedDriveId] ?? 'ott');

  const setViewModeForDrive = (driveId: string, mode: 'ott' | 'folder') => {
    const updated = { ...driveViewModes, [driveId]: mode };
    setDriveViewModes(updated);
    try {
      localStorage.setItem('telebhaja_drive_views', JSON.stringify(updated));
    } catch {}
  };

  const { data, loading, refetch } = useLibrary({
    category: category === 'all' ? undefined : category,
    language: language || undefined,
    search: debouncedSearch || undefined,
    drive: selectedDriveId !== 'all' ? selectedDriveId : undefined,
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

        {/* ── Drive Switcher Tabs ─────────────────────────────────────────── */}
        {drives.length > 1 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-900 border border-surface-800 p-2 sm:p-2.5 rounded-2xl shadow-md">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              <span className="text-[11px] font-bold text-surface-400 uppercase tracking-wider px-2 flex-shrink-0">Drives:</span>
              {drives.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDriveId(d.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all flex-shrink-0 ${
                    selectedDriveId === d.id
                      ? 'bg-brand-600 text-white font-bold shadow-md shadow-brand-600/30'
                      : 'bg-surface-800 hover:bg-surface-750 text-surface-300 hover:text-white'
                  }`}
                >
                  <span>{d.shortLabel}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/30 opacity-80">
                    {d.movieCount + d.seriesCount}
                  </span>
                </button>
              ))}
            </div>

            {/* View Mode Switcher for Non-Primary Drive */}
            {!isPrimary && currentDrive && (
              <div className="flex items-center gap-1 bg-surface-950 p-1 rounded-xl border border-surface-800 self-end sm:self-auto">
                <span className="text-[11px] text-surface-400 px-1.5 font-medium">View Mode:</span>
                <button
                  onClick={() => setViewModeForDrive(currentDrive.id, 'ott')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                    currentViewMode === 'ott'
                      ? 'bg-brand-600 text-white font-bold shadow'
                      : 'text-surface-400 hover:text-white'
                  }`}
                >
                  <span>🎬</span> OTT View
                </button>
                <button
                  onClick={() => setViewModeForDrive(currentDrive.id, 'folder')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                    currentViewMode === 'folder'
                      ? 'bg-brand-600 text-white font-bold shadow'
                      : 'text-surface-400 hover:text-white'
                  }`}
                >
                  <span>📁</span> Folder View
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Content View (Folder View for Secondary Drives vs Full OTT View) ── */}
        {!isPrimary && currentViewMode === 'folder' && currentDrive ? (
          <DriveFolderBrowser
            drive={currentDrive}
            onPlayMovie={(movie) => setDrawer({ type: 'movie', movie })}
          />
        ) : (
          <>
        {/* ── Search + Filters ─────────────────────────────────────────────── */}
        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              id="search-input"
              type="text"
              placeholder="Search movies, series, franchises, year…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-surface-800 border border-surface-700 text-white placeholder-surface-500 text-sm focus:outline-none focus:border-brand-600 transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-surface-700 hover:bg-surface-600 flex items-center justify-center text-surface-400 hover:text-white text-xs transition-colors"
                title="Clear search"
              >
                ✕
              </button>
            )}
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
                <div key={item.mediaId} className="flex-shrink-0 w-36 md:w-44">
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
                    className="w-full"
                  />
                </div>
              ))}
              {recent.episodes.map((item) => (
                <div key={item.mediaId} className="flex-shrink-0 w-36 md:w-44">
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
                    className="w-full"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Franchises ───────────────────────────────────────────────────── */}
        {showFranchises && data && data.franchises.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-title">
                {debouncedSearch ? '🎭 Matching Franchises' : '🎭 Franchise Collections'}
              </h2>
              {data.franchises.length > 3 && !debouncedSearch && (
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
        {showMovies && (!debouncedSearch || (data && data.movies.length > 0) || loading) && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-title">
                {debouncedSearch ? '🎬 Movies' : (category === 'animated' ? '✨ Animated Films' : '🎬 Movies')}
              </h2>
              {data && (
                <span className="text-surface-500 text-sm">{data.movies.length} titles</span>
              )}
            </div>
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4 sm:gap-5 md:gap-6">
                {[...Array(7)].map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : data && data.movies.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4 sm:gap-5 md:gap-6">
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
        {showSeries && (!debouncedSearch || (data && data.series.length > 0) || loading) && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-title">
                {debouncedSearch ? '📺 TV Series' : (category === 'animated' ? '✨ Animated Series' : '📺 TV Series')}
              </h2>
              {data && (
                <span className="text-surface-500 text-sm">{data.series.length} shows</span>
              )}
            </div>
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4 sm:gap-5 md:gap-6">
                {[...Array(7)].map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : data && data.series.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4 sm:gap-5 md:gap-6">
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
          <div className="flex flex-col items-center justify-center py-16 text-center">
            {debouncedSearch ? (
              <>
                <div className="w-16 h-16 rounded-full bg-surface-800 flex items-center justify-center mb-4 text-2xl">
                  🔍
                </div>
                <h3 className="text-white font-semibold text-lg mb-1">
                  No results found for &ldquo;{debouncedSearch}&rdquo;
                </h3>
                <p className="text-surface-400 text-sm max-w-sm mb-4">
                  Check your spelling or try searching for another title, year, franchise, or keyword.
                </p>
                <button
                  className="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-white rounded-full text-sm font-medium transition-colors"
                  onClick={() => setSearch('')}
                >
                  Clear search
                </button>
              </>
            ) : (
              <>
                <div className="w-20 h-20 rounded-full bg-surface-800 flex items-center justify-center mb-4">
                  <svg className="w-10 h-10 text-surface-600" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z" />
                  </svg>
                </div>
                <h3 className="text-white font-semibold text-lg mb-2">Library is empty</h3>
                <p className="text-surface-400 text-sm max-w-xs mb-6">
                  Your media storage path hasn&apos;t been scanned yet, or no supported files were found.
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
              </>
            )}
          </div>
        )}
          </>
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
