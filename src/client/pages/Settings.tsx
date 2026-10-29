import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { useScanStatus } from '../hooks/useMedia.js';

interface SettingsPageProps {
  onClose: () => void;
}

const Settings: React.FC<SettingsPageProps> = ({ onClose }) => {
  const { status, startScan } = useScanStatus();
  const [healthData, setHealthData] = useState<{ movies: number; series: number; mediaStoragePath: string } | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  const checkHealth = async () => {
    setLoadingHealth(true);
    try {
      const h = await api.health();
      setHealthData(h as { movies: number; series: number; mediaStoragePath: string });
    } catch {
      /* ignore */
    } finally {
      setLoadingHealth(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center animate-fade-in">
      <div className="absolute inset-0 modal-backdrop" onClick={onClose} />
      <div className="relative w-full md:max-w-lg md:rounded-2xl bg-surface-900 flex flex-col max-h-[90dvh] animate-slide-up">
        <div className="flex items-center justify-between p-4 border-b border-surface-800">
          <h2 className="font-display font-bold text-lg text-white">Settings</h2>
          <button
            id="settings-close-btn"
            className="w-8 h-8 rounded-full bg-surface-800 flex items-center justify-center text-surface-400"
            onClick={onClose}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Library Scan */}
          <div className="glass-card p-4">
            <h3 className="text-white font-semibold mb-1">Media Library</h3>
            <p className="text-surface-400 text-xs mb-3">Scan your external drive to index new media files.</p>
            {status?.running ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-surface-300 text-sm">Scanning… {status.progress}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${status.progress}%` }} />
                </div>
                <p className="text-surface-500 text-xs">
                  {status.scannedCount} / {status.totalFound} files processed
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {status?.completedAt && (
                  <p className="text-surface-400 text-xs">
                    Last scan: {new Date(status.completedAt).toLocaleString()}
                    {' · '}{status.scannedCount} files indexed
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    id="settings-scan-btn"
                    className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-full text-sm font-semibold transition-colors"
                    onClick={() => void startScan(false)}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Scan Library
                  </button>
                  <button
                    id="settings-force-scan-btn"
                    className="flex items-center gap-2 px-4 py-2 bg-surface-700 hover:bg-surface-600 text-white rounded-full text-sm font-semibold transition-colors"
                    onClick={() => void startScan(true)}
                    title="Rescans all files, clearing cache and re-parsing metadata"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Full Re-scan
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* System info */}
          <div className="glass-card p-4">
            <h3 className="text-white font-semibold mb-3">System Info</h3>
            <button
              id="check-health-btn"
              onClick={() => void checkHealth()}
              disabled={loadingHealth}
              className="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-white rounded-full text-sm transition-colors mb-3"
            >
              {loadingHealth ? 'Checking…' : 'Check Server Health'}
            </button>
            {healthData && (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-surface-400">Movies indexed</span>
                  <span className="text-white font-medium">{healthData.movies}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-400">Series indexed</span>
                  <span className="text-white font-medium">{healthData.series}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-400">Media path</span>
                  <span className="text-white font-medium text-xs truncate max-w-40">{healthData.mediaStoragePath}</span>
                </div>
              </div>
            )}
          </div>

          {/* Keyboard shortcuts */}
          <div className="glass-card p-4">
            <h3 className="text-white font-semibold mb-3">Player Shortcuts</h3>
            <div className="space-y-2 text-sm">
              {[
                ['Space / K', 'Play / Pause'],
                ['← / →', 'Skip ±10 seconds'],
                ['F', 'Toggle fullscreen'],
                ['M', 'Toggle mute'],
                ['Esc', 'Exit player'],
              ].map(([key, action]) => (
                <div key={key} className="flex justify-between">
                  <kbd className="px-2 py-0.5 bg-surface-700 rounded text-surface-300 font-mono text-xs">{key}</kbd>
                  <span className="text-surface-400">{action}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-surface-800">
                <p className="text-surface-400 text-xs">Mobile: Double-tap left/right edge to skip ±10 seconds</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
