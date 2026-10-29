import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import type { StorageDrive, DriveBrowseResponse, DriveBrowseItem, MediaItem } from '../../shared/types.js';

interface DriveFolderBrowserProps {
  drive: StorageDrive;
  onPlayMovie: (movie: MediaItem) => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export const DriveFolderBrowser: React.FC<DriveFolderBrowserProps> = ({ drive, onPlayMovie }) => {
  const [currentPath, setCurrentPath] = useState<string>(drive.path);
  const [data, setData] = useState<DriveBrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');

  // Reset when drive changes
  useEffect(() => {
    setCurrentPath(drive.path);
    setFilterQuery('');
  }, [drive.id, drive.path]);

  const loadFolder = useCallback(async (targetSubpath?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.drives.browse(drive.id, targetSubpath);
      setData(res);
      setCurrentPath(res.currentPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to browse folder';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [drive.id]);

  useEffect(() => {
    void loadFolder(currentPath);
  }, [loadFolder, currentPath]);

  const handlePlayFile = async (file: DriveBrowseItem) => {
    if (file.id) {
      try {
        const fullMovie = await api.library.getMovie(file.id);
        onPlayMovie(fullMovie);
        return;
      } catch {
        // Fallback below
      }
    }

    // Fallback minimal media item
    const fallbackMovie: MediaItem = {
      id: file.id ?? Date.now(),
      title: file.title,
      year: file.year,
      posterPath: file.posterPath,
      duration: file.duration,
      filePath: file.filePath,
      fileSize: file.fileSize,
      mimeType: file.mimeType ?? 'video/mp4',
      audioTracks: [],
      subtitleTracks: [],
      needsTranscode: Boolean(file.needsTranscode),
      languages: [],
      isAnimated: false,
      isSeries: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    onPlayMovie(fallbackMovie);
  };

  const filteredFolders = (data?.folders ?? []).filter((f) =>
    f.name.toLowerCase().includes(filterQuery.toLowerCase())
  );

  const filteredFiles = (data?.files ?? []).filter((f) =>
    f.title.toLowerCase().includes(filterQuery.toLowerCase()) ||
    f.filePath.toLowerCase().includes(filterQuery.toLowerCase())
  );

  return (
    <div className="bg-surface-900 border border-surface-800 rounded-2xl p-4 md:p-6 shadow-xl animate-fade-in">
      {/* ── Top Bar: Breadcrumbs & Search ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5 pb-4 border-b border-surface-800">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1.5 flex-wrap text-sm text-surface-300">
          <span className="text-surface-500 mr-1">📁</span>
          {data?.breadcrumbs.map((b, idx) => {
            const isLast = idx === data.breadcrumbs.length - 1;
            return (
              <React.Fragment key={b.path}>
                {idx > 0 && <span className="text-surface-600">/</span>}
                <button
                  onClick={() => setCurrentPath(b.path)}
                  disabled={isLast}
                  className={`px-2 py-1 rounded-lg transition-colors font-medium ${
                    isLast
                      ? 'text-white font-bold bg-surface-800/80 cursor-default'
                      : 'hover:text-brand-400 hover:bg-surface-800 text-surface-300'
                  }`}
                >
                  {b.name}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Filter input */}
        <div className="relative w-full md:w-64">
          <input
            type="text"
            placeholder="Filter files or folders..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="w-full px-3 py-1.5 pl-8 rounded-xl bg-surface-950 border border-surface-750 text-white text-xs focus:outline-none focus:border-brand-500 placeholder-surface-500"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500 text-xs">🔍</span>
          {filterQuery && (
            <button
              onClick={() => setFilterQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-400 hover:text-white text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div className="mb-4 p-3 bg-red-950/50 border border-red-800/80 rounded-xl text-red-200 text-xs">
          ⚠️ {error}
        </div>
      )}

      {/* ── Loading Skeleton ── */}
      {loading ? (
        <div className="space-y-2 py-4">
          <div className="h-10 bg-surface-800/50 rounded-xl animate-pulse" />
          <div className="h-10 bg-surface-800/50 rounded-xl animate-pulse" />
          <div className="h-10 bg-surface-800/50 rounded-xl animate-pulse" />
          <div className="h-10 bg-surface-800/50 rounded-xl animate-pulse" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Back button if not at drive root */}
          {data && data.breadcrumbs.length > 1 && (
            <button
              onClick={() => {
                const parent = data.breadcrumbs[data.breadcrumbs.length - 2];
                if (parent) setCurrentPath(parent.path);
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-800/60 hover:bg-surface-800 text-surface-300 hover:text-white text-xs transition-colors mb-2"
            >
              <span>⬅</span>
              <span>Back to parent directory</span>
            </button>
          )}

          {/* Subfolders Grid / List */}
          {filteredFolders.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-surface-500 mb-2 px-1">
                Folders ({filteredFolders.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {filteredFolders.map((folder) => (
                  <button
                    key={folder.path}
                    onClick={() => setCurrentPath(folder.path)}
                    className="flex items-center gap-3 p-3 rounded-xl bg-surface-850 hover:bg-surface-800 border border-surface-750/70 hover:border-brand-500/50 text-left transition-all group shadow-sm hover:shadow-md"
                  >
                    <span className="text-2xl group-hover:scale-110 transition-transform">📁</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-white truncate group-hover:text-brand-300">
                        {folder.name}
                      </div>
                      <div className="text-[11px] text-surface-400">
                        {folder.itemCount} {folder.itemCount === 1 ? 'media file' : 'media files'}
                      </div>
                    </div>
                    <span className="text-surface-500 group-hover:text-brand-400 text-xs">➔</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Media Files Table / List */}
          {filteredFiles.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-surface-500 mb-2 px-1">
                Media Files ({filteredFiles.length})
              </div>
              <div className="divide-y divide-surface-800/80 rounded-xl overflow-hidden border border-surface-800 bg-surface-950/60">
                {filteredFiles.map((file) => {
                  const ext = file.filePath.split('.').pop()?.toUpperCase() || 'VIDEO';
                  return (
                    <div
                      key={file.filePath}
                      className="flex items-center justify-between p-3 md:px-4 hover:bg-surface-800/50 transition-colors gap-3 group"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* Thumbnail or Icon */}
                        {file.posterPath ? (
                          <img
                            src={file.posterPath}
                            alt=""
                            className="w-10 h-14 object-cover rounded-lg flex-shrink-0 border border-surface-700"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-brand-950 border border-brand-800/60 text-brand-400 flex items-center justify-center flex-shrink-0 text-lg">
                            🎬
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white truncate">
                              {file.title}
                            </span>
                            {file.year && (
                              <span className="text-xs text-surface-400 flex-shrink-0 font-mono">
                                ({file.year})
                              </span>
                            )}
                            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-surface-800 text-surface-300 flex-shrink-0">
                              {ext}
                            </span>
                            {file.isSeries && (
                              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-300 flex-shrink-0">
                                Series
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-surface-500 flex items-center gap-3 mt-0.5">
                            <span>{formatBytes(file.fileSize)}</span>
                            {file.duration && <span>• {formatDuration(file.duration)}</span>}
                            <span className="truncate hidden sm:inline text-surface-600">
                              {file.filePath}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Play Button */}
                      <button
                        onClick={() => void handlePlayFile(file)}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md shadow-brand-600/20 hover:scale-105 active:scale-95 transition-all flex-shrink-0"
                      >
                        <span>▶</span>
                        <span>Play</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty State */}
          {filteredFolders.length === 0 && filteredFiles.length === 0 && (
            <div className="text-center py-12 text-surface-500 text-sm">
              <div className="text-3xl mb-2">📂</div>
              <p>No media files or subfolders found in this directory.</p>
              {filterQuery && (
                <button
                  onClick={() => setFilterQuery('')}
                  className="mt-2 text-xs text-brand-400 hover:underline"
                >
                  Clear search filter
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DriveFolderBrowser;
