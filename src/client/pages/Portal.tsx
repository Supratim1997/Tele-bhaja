import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../lib/api.js';
import type { FileTreeNode, ControlStats, MediaOverrideInput } from '../../shared/types.js';

interface EditItemState {
  node: FileTreeNode;
  title: string;
  year: string;
  isAnimated: boolean;
  languages: string;
  franchiseName: string;
}

export const Portal: React.FC = () => {
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [stats, setStats] = useState<ControlStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [filterQuery, setFilterQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'included' | 'excluded'>('all');
  const [togglingPath, setTogglingPath] = useState<string | null>(null);

  // Edit drawer state
  const [editingItem, setEditingItem] = useState<EditItemState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load tree
  const loadTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.control.getTree();
      setTree(res.tree);
      setStats(res.stats);

      // Auto-expand root and first level folders
      const initialExpanded = new Set<string>();
      if (res.tree.path) initialExpanded.add(res.tree.path);
      if (res.tree.children) {
        for (const child of res.tree.children) {
          if (child.isDirectory) {
            initialExpanded.add(child.path);
          }
        }
      }
      setExpandedPaths(initialExpanded);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load media file structure');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  // Toggle folder expansion
  const toggleExpand = useCallback((nodePath: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(nodePath)) next.delete(nodePath);
      else next.add(nodePath);
      return next;
    });
  }, []);

  // Expand all folders
  const expandAll = useCallback(() => {
    if (!tree) return;
    const allDirs = new Set<string>();
    const collect = (node: FileTreeNode) => {
      if (node.isDirectory) {
        allDirs.add(node.path);
        node.children?.forEach(collect);
      }
    };
    collect(tree);
    setExpandedPaths(allDirs);
  }, [tree]);

  // Collapse all folders
  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set(tree?.path ? [tree.path] : []));
  }, [tree]);

  // Toggle file or folder inclusion/exclusion
  const handleToggle = useCallback(async (node: FileTreeNode) => {
    setTogglingPath(node.path);
    const targetIsExcluded = node.isDirectory
      ? !(node.totalMediaCount > 0 && node.excludedMediaCount === node.totalMediaCount)
      : !node.isExcluded;

    try {
      await api.control.toggle({
        path: node.path,
        isExcluded: targetIsExcluded,
        isDirectory: node.isDirectory,
      });

      // Reload tree to reflect accurate recursive counts and statuses
      const res = await api.control.getTree();
      setTree(res.tree);
      setStats(res.stats);
    } catch (err: unknown) {
      alert(`Failed to update exclusion: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTogglingPath(null);
    }
  }, []);

  // Reset all exclusions
  const handleResetAll = useCallback(async () => {
    if (!confirm('Are you sure you want to include ALL media files back into the OTT? This will clear all exclusion rules.')) {
      return;
    }
    setLoading(true);
    try {
      await api.control.reset();
      await loadTree();
    } catch (err: unknown) {
      alert(`Failed to reset: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
    }
  }, [loadTree]);

  // Open edit drawer
  const openEdit = useCallback((node: FileTreeNode) => {
    setEditingItem({
      node,
      title: node.title ?? node.name.replace(/\.[^.]+$/, ''),
      year: node.year ? String(node.year) : '',
      isAnimated: Boolean(node.isAnimated),
      languages: node.languages ? node.languages.join(', ') : 'en',
      franchiseName: node.franchiseName ?? '',
    });
    setSaveSuccess(false);
  }, []);

  // Save metadata changes
  const saveEdit = useCallback(async () => {
    if (!editingItem) return;
    setSavingEdit(true);
    setSaveSuccess(false);

    try {
      const type = editingItem.node.mediaType ?? 'movie';
      const id = editingItem.node.mediaId;

      if (!id) {
        throw new Error('This file has not been scanned into the database yet. Run a library scan first.');
      }

      const langs = editingItem.languages
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      const payload: MediaOverrideInput = {
        title: editingItem.title.trim(),
        year: editingItem.year.trim() ? parseInt(editingItem.year, 10) : undefined,
        isAnimated: editingItem.isAnimated,
        languages: langs.length > 0 ? langs : ['en'],
        franchiseName: editingItem.franchiseName.trim(),
      };

      await api.control.updateMedia(type, id, payload);
      setSaveSuccess(true);

      // Refresh tree
      const res = await api.control.getTree();
      setTree(res.tree);
      setStats(res.stats);

      setTimeout(() => {
        setEditingItem(null);
        setSaveSuccess(false);
      }, 1000);
    } catch (err: unknown) {
      alert(`Failed to save changes: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingEdit(false);
    }
  }, [editingItem]);

  // Format file size
  const formatSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  // Filter helper: returns true if node or any descendant matches filter
  const nodeMatchesFilter = useCallback((node: FileTreeNode, q: string, mode: 'all' | 'included' | 'excluded'): boolean => {
    const qLower = q.toLowerCase();
    const nameMatch = !q || node.name.toLowerCase().includes(qLower) || Boolean(node.title?.toLowerCase().includes(qLower));

    let modeMatch = true;
    if (mode === 'included') {
      modeMatch = node.isDirectory ? node.excludedMediaCount < node.totalMediaCount : !node.isExcluded;
    } else if (mode === 'excluded') {
      modeMatch = node.isDirectory ? node.excludedMediaCount > 0 : node.isExcluded;
    }

    if (!node.isDirectory) {
      return nameMatch && modeMatch;
    }

    // For directory: match if self matches OR any child matches
    if (node.children) {
      const anyChildMatches = node.children.some((c) => nodeMatchesFilter(c, q, mode));
      return anyChildMatches || (nameMatch && modeMatch);
    }

    return nameMatch && modeMatch;
  }, []);

  return (
    <div className="min-h-screen bg-surface-950 text-white pb-24">
      {/* ── Top Header / Stats ─────────────────────────────────────────────── */}
      <div className="px-4 md:px-8 pt-4 pb-6 border-b border-surface-800/80 bg-surface-900/40 backdrop-blur-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🗂️</span>
              <h1 className="font-display font-black text-2xl md:text-3xl text-white">
                Content Control Portal
              </h1>
            </div>
            <p className="text-surface-400 text-xs md:text-sm mt-1">
              Select which files and folders to include in your OTT library, or customize categorization.
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void loadTree()}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 text-xs font-medium transition-colors border border-surface-700/60"
            >
              <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
            <button
              onClick={expandAll}
              className="px-3 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 text-xs font-medium transition-colors border border-surface-700/60"
            >
              ⊞ Expand All
            </button>
            <button
              onClick={collapseAll}
              className="px-3 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 text-xs font-medium transition-colors border border-surface-700/60"
            >
              ⊟ Collapse All
            </button>
            {stats && stats.excludedMediaFiles > 0 && (
              <button
                onClick={() => void handleResetAll()}
                className="px-3 py-1.5 rounded-lg bg-red-900/30 hover:bg-red-800/50 text-red-300 text-xs font-medium transition-colors border border-red-800/40"
              >
                Reset All Exclusions
              </button>
            )}
          </div>
        </div>

        {/* Stats Strip */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3 text-xs">
            <div className="glass-card px-3 py-2 flex items-center justify-between">
              <span className="text-surface-400">Total Media</span>
              <span className="text-white font-bold text-sm">{stats.totalMediaFiles}</span>
            </div>
            <div className="glass-card px-3 py-2 flex items-center justify-between border-green-900/30 bg-green-950/10">
              <span className="text-green-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                Included
              </span>
              <span className="text-green-200 font-bold text-sm">{stats.includedMediaFiles}</span>
            </div>
            <div className="glass-card px-3 py-2 flex items-center justify-between border-red-900/30 bg-red-950/10">
              <span className="text-red-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                Excluded
              </span>
              <span className="text-red-200 font-bold text-sm">{stats.excludedMediaFiles}</span>
            </div>
            <div className="glass-card px-3 py-2 flex items-center justify-between">
              <span className="text-surface-400">Folders</span>
              <span className="text-surface-300 font-medium">{stats.totalDirectories}</span>
            </div>
          </div>
        )}

        {/* Root storage path display */}
        {stats && (
          <div className="mt-3 flex items-center gap-2 text-xs text-surface-400 font-mono bg-surface-950/60 px-3 py-1.5 rounded-lg border border-surface-800/60 overflow-hidden">
            <span className="text-surface-500 flex-shrink-0">📁 Storage Path:</span>
            <span className="text-surface-300 truncate">{stats.rootPath}</span>
          </div>
        )}
      </div>

      {/* ── Search & Filter Controls ───────────────────────────────────────── */}
      <div className="px-4 md:px-8 my-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Filter files or folders…"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 rounded-xl bg-surface-800 border border-surface-700 text-white placeholder-surface-500 text-xs md:text-sm focus:outline-none focus:border-brand-600 transition-colors"
          />
          {filterQuery && (
            <button
              onClick={() => setFilterQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-400 hover:text-white text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex gap-1.5">
          <button
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filterMode === 'all'
                ? 'bg-brand-600 text-white'
                : 'bg-surface-800 text-surface-400 hover:text-white'
            }`}
          >
            All Files
          </button>
          <button
            onClick={() => setFilterMode('included')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filterMode === 'included'
                ? 'bg-green-700 text-white'
                : 'bg-surface-800 text-surface-400 hover:text-green-300'
            }`}
          >
            ✅ Included Only
          </button>
          <button
            onClick={() => setFilterMode('excluded')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filterMode === 'excluded'
                ? 'bg-red-700 text-white'
                : 'bg-surface-800 text-surface-400 hover:text-red-300'
            }`}
          >
            🚫 Excluded Only
          </button>
        </div>
      </div>

      {/* ── File Structure Explorer ────────────────────────────────────────── */}
      <div className="px-4 md:px-8">
        <div className="glass-card overflow-hidden border-surface-800">
          {/* Header row */}
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[11px] font-semibold text-surface-400 uppercase tracking-wider bg-surface-900/80 border-b border-surface-800">
            <div className="col-span-7 md:col-span-6 flex items-center gap-2">
              <span>File / Folder Structure</span>
            </div>
            <div className="col-span-3 md:col-span-3 text-right md:text-left">
              <span>Status & Categorization</span>
            </div>
            <div className="hidden md:block md:col-span-2 text-right">
              <span>Size</span>
            </div>
            <div className="col-span-2 md:col-span-1 text-right">
              <span>Actions</span>
            </div>
          </div>

          {/* Tree View Content */}
          <div className="divide-y divide-surface-800/40">
            {loading ? (
              <div className="py-16 flex flex-col items-center justify-center text-center">
                <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-surface-400 text-sm">Loading media directory tree…</p>
              </div>
            ) : error ? (
              <div className="p-8 text-center text-red-400 text-sm">
                <p className="font-semibold mb-1">Failed to read media storage</p>
                <p className="text-surface-400 text-xs mb-4">{error}</p>
                <button
                  onClick={() => void loadTree()}
                  className="px-4 py-2 bg-surface-800 hover:bg-surface-700 text-white rounded-lg text-xs"
                >
                  Retry
                </button>
              </div>
            ) : tree ? (
              <TreeNodeView
                node={tree}
                depth={0}
                expandedPaths={expandedPaths}
                toggleExpand={toggleExpand}
                handleToggle={handleToggle}
                openEdit={openEdit}
                formatSize={formatSize}
                togglingPath={togglingPath}
                filterQuery={filterQuery}
                filterMode={filterMode}
                nodeMatchesFilter={nodeMatchesFilter}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Metadata & Categorization Edit Drawer ───────────────────────────── */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 modal-backdrop" onClick={() => setEditingItem(null)} />
          <div className="relative w-full max-w-lg bg-surface-900 border border-surface-700/80 rounded-2xl shadow-2xl p-6 flex flex-col max-h-[90vh] overflow-y-auto animate-scale-in">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-surface-800">
              <div className="flex items-center gap-2">
                <span className="text-xl">✏️</span>
                <div>
                  <h3 className="font-display font-bold text-lg text-white">Manual Categorization</h3>
                  <p className="text-surface-400 text-xs truncate max-w-xs">{editingItem.node.name}</p>
                </div>
              </div>
              <button
                onClick={() => setEditingItem(null)}
                className="w-8 h-8 rounded-full bg-surface-800 hover:bg-surface-700 flex items-center justify-center text-surface-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Form */}
            <div className="py-4 space-y-4 text-sm">
              <div>
                <label className="block text-surface-400 text-xs font-medium mb-1">Display Title</label>
                <input
                  type="text"
                  value={editingItem.title}
                  onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-surface-700 text-white text-sm focus:outline-none focus:border-brand-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-surface-400 text-xs font-medium mb-1">Release Year</label>
                  <input
                    type="number"
                    placeholder="e.g. 2010"
                    value={editingItem.year}
                    onChange={(e) => setEditingItem({ ...editingItem, year: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-surface-700 text-white text-sm focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-surface-400 text-xs font-medium mb-1">Languages (comma-separated)</label>
                  <input
                    type="text"
                    placeholder="en, bn, hi"
                    value={editingItem.languages}
                    onChange={(e) => setEditingItem({ ...editingItem, languages: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-surface-700 text-white text-sm focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-surface-400 text-xs font-medium mb-1">Franchise / Universe Collection</label>
                <input
                  type="text"
                  placeholder="e.g. Harry Potter, Marvel Cinematic Universe"
                  value={editingItem.franchiseName}
                  onChange={(e) => setEditingItem({ ...editingItem, franchiseName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-surface-700 text-white text-sm focus:outline-none focus:border-brand-500"
                />
                <p className="text-surface-500 text-[11px] mt-1">Leave empty if standalone movie.</p>
              </div>

              {/* Animated Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-surface-800/60 border border-surface-700/60">
                <div>
                  <p className="text-white text-xs font-semibold">✨ Animated Content</p>
                  <p className="text-surface-400 text-[11px]">Include under Animated section</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingItem({ ...editingItem, isAnimated: !editingItem.isAnimated })}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
                    editingItem.isAnimated ? 'bg-purple-600' : 'bg-surface-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      editingItem.isAnimated ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Inclusion Status info */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-surface-800/60 border border-surface-700/60">
                <div>
                  <p className="text-white text-xs font-semibold">OTT Inclusion Status</p>
                  <p className="text-surface-400 text-[11px]">
                    {editingItem.node.isExcluded ? 'Currently excluded from streaming' : 'Currently visible on OTT'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleToggle(editingItem.node)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    editingItem.node.isExcluded
                      ? 'bg-red-900/60 text-red-200 hover:bg-red-800'
                      : 'bg-green-900/60 text-green-200 hover:bg-green-800'
                  }`}
                >
                  {editingItem.node.isExcluded ? '🚫 Excluded' : '✅ Included'}
                </button>
              </div>

              {saveSuccess && (
                <div className="p-3 bg-green-900/30 border border-green-800/60 rounded-lg text-green-300 text-xs flex items-center gap-2">
                  <span>✓</span> Changes saved and persisted successfully!
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="pt-4 border-t border-surface-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="px-4 py-2 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={savingEdit}
                className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-brand-900/20"
              >
                {savingEdit ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Recursive Tree Node Component ─────────────────────────────────────────────

interface TreeNodeViewProps {
  node: FileTreeNode;
  depth: number;
  expandedPaths: Set<string>;
  toggleExpand: (path: string) => void;
  handleToggle: (node: FileTreeNode) => void;
  openEdit: (node: FileTreeNode) => void;
  formatSize: (bytes?: number) => string;
  togglingPath: string | null;
  filterQuery: string;
  filterMode: 'all' | 'included' | 'excluded';
  nodeMatchesFilter: (node: FileTreeNode, q: string, mode: 'all' | 'included' | 'excluded') => boolean;
}

const TreeNodeView: React.FC<TreeNodeViewProps> = ({
  node, depth, expandedPaths, toggleExpand, handleToggle,
  openEdit, formatSize, togglingPath, filterQuery, filterMode, nodeMatchesFilter,
}) => {
  // If filter active, check if this node or any children match
  const matches = nodeMatchesFilter(node, filterQuery, filterMode);
  if (!matches) return null;

  const isExpanded = expandedPaths.has(node.path);
  const isToggling = togglingPath === node.path;

  // Folder inclusion state
  const isFullyExcluded = node.isDirectory && node.totalMediaCount > 0 && node.excludedMediaCount === node.totalMediaCount;
  const isPartiallyExcluded = node.isDirectory && node.excludedMediaCount > 0 && node.excludedMediaCount < node.totalMediaCount;
  const isFullyIncluded = node.isDirectory && node.totalMediaCount > 0 && node.excludedMediaCount === 0;

  // File inclusion state
  const isFileIncluded = !node.isDirectory && !node.isExcluded;

  return (
    <>
      <div
        className={`grid grid-cols-12 gap-2 px-4 py-2 items-center hover:bg-surface-850/60 transition-colors text-xs ${
          node.isExcluded ? 'opacity-60 bg-red-950/5' : ''
        }`}
        style={{ paddingLeft: `${Math.max(16, depth * 20 + 16)}px` }}
      >
        {/* Name + Checkbox column */}
        <div className="col-span-7 md:col-span-6 flex items-center gap-2 min-w-0">
          {/* Checkbox (media files and directories with media) */}
          {node.isMedia || (node.isDirectory && node.totalMediaCount > 0) ? (
            <button
              type="button"
              onClick={() => handleToggle(node)}
              disabled={isToggling}
              className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors border ${
                node.isDirectory
                  ? isFullyIncluded
                    ? 'bg-green-600 border-green-500 text-white'
                    : isPartiallyExcluded
                    ? 'bg-amber-600 border-amber-500 text-white'
                    : 'bg-surface-800 border-surface-600 text-transparent'
                  : isFileIncluded
                  ? 'bg-green-600 border-green-500 text-white'
                  : 'bg-surface-800 border-surface-600 text-transparent'
              }`}
              title={
                node.isDirectory
                  ? isFullyIncluded
                    ? 'Folder fully included in OTT (click to exclude)'
                    : isPartiallyExcluded
                    ? 'Folder partially excluded (click to include all)'
                    : 'Folder fully excluded (click to include)'
                  : isFileIncluded
                  ? 'File included in OTT (click to exclude)'
                  : 'File excluded from OTT (click to include)'
              }
            >
              {isToggling ? (
                <div className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : node.isDirectory && isPartiallyExcluded ? (
                <span className="text-[10px] font-bold leading-none">−</span>
              ) : (
                <span className="text-[10px] leading-none">✓</span>
              )}
            </button>
          ) : (
            <div className="w-4 flex-shrink-0" />
          )}

          {/* Folder expansion chevron */}
          {node.isDirectory ? (
            <button
              type="button"
              onClick={() => toggleExpand(node.path)}
              className="w-4 h-4 flex items-center justify-center text-surface-400 hover:text-white flex-shrink-0"
            >
              <svg
                className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <div className="w-4 flex-shrink-0" />
          )}

          {/* Icon */}
          <span className="flex-shrink-0 text-sm">
            {node.isDirectory ? (isExpanded ? '📂' : '📁') : node.isMedia ? '🎬' : '📄'}
          </span>

          {/* Label / Name */}
          <span
            className={`truncate font-medium ${
              node.isDirectory ? 'text-white' : node.isMedia ? 'text-surface-100' : 'text-surface-500'
            }`}
            title={node.path}
          >
            {node.name}
          </span>

          {/* Folder media counter */}
          {node.isDirectory && node.totalMediaCount > 0 && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-mono ${
                isFullyIncluded
                  ? 'bg-green-950/60 text-green-300 border border-green-800/40'
                  : isPartiallyExcluded
                  ? 'bg-amber-950/60 text-amber-300 border border-amber-800/40'
                  : 'bg-red-950/60 text-red-300 border border-red-800/40'
              }`}
            >
              {node.totalMediaCount - node.excludedMediaCount}/{node.totalMediaCount}
            </span>
          )}
        </div>

        {/* Status / Categorization Column */}
        <div className="col-span-3 md:col-span-3 flex flex-wrap items-center gap-1">
          {node.isMedia && (
            <>
              {node.isExcluded ? (
                <span className="badge bg-red-950/80 text-red-300 border border-red-800/50 text-[10px]">
                  🚫 Excluded
                </span>
              ) : (
                <span className="badge bg-green-950/80 text-green-300 border border-green-800/50 text-[10px]">
                  ✅ Included
                </span>
              )}

              {node.mediaType === 'movie' && (
                <span className="badge bg-blue-950/80 text-blue-300 border border-blue-800/50 text-[10px]">
                  Movie
                </span>
              )}
              {node.mediaType === 'episode' && (
                <span className="badge bg-indigo-950/80 text-indigo-300 border border-indigo-800/50 text-[10px]">
                  Series
                </span>
              )}
              {node.isAnimated && (
                <span className="badge bg-purple-950/80 text-purple-300 border border-purple-800/50 text-[10px]">
                  ✨ Anim
                </span>
              )}
              {node.franchiseName && (
                <span className="badge bg-amber-950/80 text-amber-300 border border-amber-800/50 text-[10px] truncate max-w-[100px]" title={node.franchiseName}>
                  🎭 {node.franchiseName}
                </span>
              )}
            </>
          )}
        </div>

        {/* Size Column */}
        <div className="hidden md:block md:col-span-2 text-right text-surface-400 font-mono text-[11px]">
          {formatSize(node.size)}
        </div>

        {/* Actions Column */}
        <div className="col-span-2 md:col-span-1 text-right">
          {node.isMedia && node.mediaId ? (
            <button
              onClick={() => openEdit(node)}
              className="px-2 py-1 rounded bg-surface-800 hover:bg-surface-700 text-surface-300 hover:text-white text-[11px] font-medium transition-colors"
              title="Edit categorization and metadata"
            >
              Edit
            </button>
          ) : null}
        </div>
      </div>

      {/* Render children if folder is expanded */}
      {node.isDirectory && isExpanded && node.children && (
        <div className="relative">
          {node.children.map((child) => (
            <TreeNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              toggleExpand={toggleExpand}
              handleToggle={handleToggle}
              openEdit={openEdit}
              formatSize={formatSize}
              togglingPath={togglingPath}
              filterQuery={filterQuery}
              filterMode={filterMode}
              nodeMatchesFilter={nodeMatchesFilter}
            />
          ))}
        </div>
      )}
    </>
  );
};

export default Portal;
