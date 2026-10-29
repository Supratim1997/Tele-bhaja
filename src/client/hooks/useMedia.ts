import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api.js';
import type { LibraryQuery } from '../lib/api.js';
import type { LibraryResponse, ScanStatus } from '../../shared/types.js';

// ── useLibrary ────────────────────────────────────────────────────────────────

export function useLibrary(query?: LibraryQuery) {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const queryStr = JSON.stringify(query);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.library.get(query);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load library');
    } finally {
      setLoading(false);
    }
  }, [queryStr]); // eslint-disable-line

  useEffect(() => { void fetch(); }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

// ── useScanStatus ─────────────────────────────────────────────────────────────

export function useScanStatus() {
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const s = await api.scan.status();
      setStatus(s);
      // Stop polling when done
      if (!s.running && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll]);

  const startScan = useCallback(async (force = false) => {
    await api.scan.start(undefined, force);
    // Resume polling
    if (!intervalRef.current) {
      intervalRef.current = setInterval(poll, 2000);
    }
    void poll();
  }, [poll]);

  return { status, startScan };
}

// ── useWatchProgress ──────────────────────────────────────────────────────────

export function useWatchProgress(type: 'movie' | 'episode', id: number) {
  const [initialPosition, setInitialPosition] = useState(0);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const posRef = useRef(0);
  const durRef = useRef(0);

  useEffect(() => {
    if (!id) return;
    setLoaded(false);
    api.progress.get(type, id)
      .then((p) => {
        const pos = p.positionSeconds ?? 0;
        const dur = p.durationSeconds ?? 0;
        setInitialPosition(pos);
        setPositionSeconds(pos);
        setDurationSeconds(dur);
        posRef.current = pos;
        durRef.current = dur;
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [type, id]);

  const updatePosition = useCallback((pos: number, dur: number) => {
    posRef.current = pos;
    durRef.current = dur;
    setPositionSeconds(pos);
    setDurationSeconds(dur);
  }, []);

  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) return;
    heartbeatRef.current = setInterval(() => {
      if (posRef.current > 0) {
        api.progress.save(type, id, posRef.current, durRef.current).catch(() => {});
      }
    }, 5000); // every 5 seconds
  }, [type, id]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
      // Final save
      if (posRef.current > 0) {
        api.progress.save(type, id, posRef.current, durRef.current).catch(() => {});
      }
    }
  }, [type, id]);

  useEffect(() => () => stopHeartbeat(), [stopHeartbeat]);

  return {
    initialPosition,
    positionSeconds,
    durationSeconds,
    loaded,
    updatePosition,
    startHeartbeat,
    stopHeartbeat,
  };
}

// ── useLocalStorage ───────────────────────────────────────────────────────────

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setStoredValue = useCallback((val: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const next = typeof val === 'function' ? (val as (p: T) => T)(prev) : val;
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [key]);

  return [value, setStoredValue] as const;
}

// ── useDebounce ───────────────────────────────────────────────────────────────

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debouncedValue;
}
