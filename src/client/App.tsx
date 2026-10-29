import React, { useState } from 'react';
import Home from './pages/Home.js';
import Portal from './pages/Portal.js';
import Settings from './pages/Settings.js';

type AppPage = 'home' | 'portal';

const App: React.FC = () => {
  const [page, setPage] = useState<AppPage>('home');
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="relative min-h-screen bg-surface-950 text-white font-sans">
      {/* Top nav bar */}
      <header className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-3 md:px-8 py-3 pt-safe bg-surface-950/90 backdrop-blur-md border-b border-surface-800/60">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPage('home')}
            className="flex items-center gap-2 group focus:outline-none"
          >
            <span className="font-display font-black text-xl text-brand-500 tracking-tight group-hover:text-brand-400 transition-colors">
              🎬 TeleBhaja
            </span>
          </button>
          <span className="hidden lg:block text-surface-600 text-xs font-medium border border-surface-700/60 px-2 py-0.5 rounded-full">
            Personal OTT
          </span>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1 bg-surface-900/90 p-1 rounded-xl border border-surface-800 backdrop-blur-sm">
          <button
            id="nav-home-btn"
            onClick={() => setPage('home')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              page === 'home'
                ? 'bg-brand-600 text-white shadow-md'
                : 'text-surface-400 hover:text-white hover:bg-surface-800'
            }`}
          >
            <span>🎬</span>
            <span>Stream</span>
          </button>
          <button
            id="nav-portal-btn"
            onClick={() => setPage('portal')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              page === 'portal'
                ? 'bg-brand-600 text-white shadow-md'
                : 'text-surface-400 hover:text-white hover:bg-surface-800'
            }`}
          >
            <span>🗂️</span>
            <span>Content Portal</span>
          </button>
        </nav>

        {/* Settings button */}
        <button
          id="settings-btn"
          className="w-9 h-9 rounded-full bg-surface-800/80 flex items-center justify-center text-surface-300 hover:text-white hover:bg-surface-700 transition-colors backdrop-blur-sm border border-surface-700/50"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          title="Server Settings"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </header>

      {/* Main content */}
      <main className="pt-16">
        {page === 'home' && <Home />}
        {page === 'portal' && <Portal />}
      </main>

      {/* Settings modal */}
      {settingsOpen && (
        <Settings onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
};

export default App;
