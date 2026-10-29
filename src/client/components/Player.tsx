import React, {
  useRef, useState, useEffect, useCallback, forwardRef,
} from 'react';
import { useWatchProgress } from '../hooks/useMedia.js';
import type { AudioTrack, SubtitleTrack } from '../../shared/types.js';
import { api } from '../lib/api.js';

interface PlayerProps {
  src: string;
  title: string;
  mediaType: 'movie' | 'episode';
  mediaId: number;
  audioTracks?: AudioTrack[];
  subtitleTracks?: SubtitleTrack[];
  onClose?: () => void;
  needsTranscode?: boolean;
  mimeType?: string;
}

type ControlsState = 'visible' | 'hidden';

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const Player: React.FC<PlayerProps> = ({
  src, title, mediaType, mediaId, audioTracks = [], subtitleTracks = [],
  onClose, needsTranscode = false, mimeType = 'video/mp4',
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doubleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapSideRef = useRef<'left' | 'right' | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [controlsState, setControlsState] = useState<ControlsState>('visible');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState<'audio' | 'subtitle' | 'speed' | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedAudio, setSelectedAudio] = useState(0);
  const [selectedSubtitle, setSelectedSubtitle] = useState<number | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [seekIndicator, setSeekIndicator] = useState<{ side: 'left' | 'right'; count: number } | null>(null);
  const [skipAnimation, setSkipAnimation] = useState<'left' | 'right' | null>(null);

  const {
    initialPosition,
    positionSeconds,
    durationSeconds: savedDuration,
    loaded: progressLoaded,
    updatePosition,
    startHeartbeat,
    stopHeartbeat,
  } = useWatchProgress(mediaType, mediaId);

  const promptHandledRef = useRef(false);

  // Reset handled flag when media changes
  useEffect(() => {
    promptHandledRef.current = false;
    setShowResumePrompt(false);
  }, [mediaId, mediaType]);

  // Show resume prompt ONCE when media loads if saved position is significant (> 30s)
  useEffect(() => {
    if (progressLoaded && !promptHandledRef.current) {
      promptHandledRef.current = true;
      if (initialPosition > 30) {
        setShowResumePrompt(true);
      }
    }
  }, [progressLoaded, initialPosition]);

  // Auto-dismiss resume prompt after 10 seconds if user does not interact
  useEffect(() => {
    if (showResumePrompt) {
      const timer = setTimeout(() => {
        setShowResumePrompt(false);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [showResumePrompt]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, src]);

  // ── Controls visibility ─────────────────────────────────────────────────
  const showControls = useCallback(() => {
    setControlsState('visible');
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setControlsState('hidden');
        setShowSubMenu(null);
      }
    }, 3500);
  }, []);

  const handleVideoAreaTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const target = e.currentTarget as HTMLDivElement;
    const rect = target.getBoundingClientRect();
    let clientX: number;

    if ('touches' in e) {
      clientX = e.changedTouches[0].clientX;
    } else {
      clientX = (e as React.MouseEvent).clientX;
    }

    const relX = clientX - rect.left;
    const side = relX < rect.width / 2 ? 'left' : 'right';

    if (tapSideRef.current === side && doubleTapTimerRef.current) {
      // Double-tap detected — seek ±10s
      clearTimeout(doubleTapTimerRef.current);
      doubleTapTimerRef.current = null;
      tapSideRef.current = null;
      skipSeconds(side === 'left' ? -10 : 10, side);
    } else {
      // First tap — start double-tap window
      tapSideRef.current = side;
      doubleTapTimerRef.current = setTimeout(() => {
        // Single tap — toggle controls
        tapSideRef.current = null;
        doubleTapTimerRef.current = null;
        setControlsState((s) => {
          if (s === 'hidden') {
            showControls();
            return 'visible';
          }
          // Toggle play on single tap
          const vid = videoRef.current;
          if (vid) {
            if (vid.paused) { void vid.play(); }
            else { vid.pause(); }
          }
          return s;
        });
      }, 250);
    }
  }, [showControls]); // eslint-disable-line

  const skipSeconds = useCallback((delta: number, side: 'left' | 'right') => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = Math.max(0, Math.min(vid.duration, vid.currentTime + delta));
    setSkipAnimation(side);
    setTimeout(() => setSkipAnimation(null), 600);
    showControls();
  }, [showControls]);

  // ── Playback controls ───────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) { void vid.play(); showControls(); }
    else { vid.pause(); setControlsState('visible'); }
  }, [showControls]);

  const seek = useCallback((seconds: number) => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = Math.max(0, Math.min(vid.duration, seconds));
    showControls();
  }, [showControls]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seek(ratio * duration);
  }, [duration, seek]);

  // ── Fullscreen ──────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      await el.requestFullscreen?.();
      // Force landscape on mobile
      if ('orientation' in screen && 'lock' in screen.orientation) {
        await (screen.orientation as ScreenOrientation & { lock: (o: string) => Promise<void> })
          .lock('landscape').catch(() => {});
      }
    } else {
      await document.exitFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // ── Video event handlers ────────────────────────────────────────────────
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const onTimeUpdate = () => {
      setCurrentTime(vid.currentTime);
      updatePosition(vid.currentTime, vid.duration);
      // Buffered
      if (vid.buffered.length > 0) {
        setBuffered(vid.buffered.end(vid.buffered.length - 1));
      }
    };
    const onDurationChange = () => setDuration(vid.duration);
    const onPlay = () => { setPlaying(true); startHeartbeat(); showControls(); };
    const onPause = () => { setPlaying(false); stopHeartbeat(); setControlsState('visible'); };
    const onEnded = () => { setPlaying(false); stopHeartbeat(); setControlsState('visible'); };

    vid.addEventListener('timeupdate', onTimeUpdate);
    vid.addEventListener('durationchange', onDurationChange);
    vid.addEventListener('play', onPlay);
    vid.addEventListener('pause', onPause);
    vid.addEventListener('ended', onEnded);
    return () => {
      vid.removeEventListener('timeupdate', onTimeUpdate);
      vid.removeEventListener('durationchange', onDurationChange);
      vid.removeEventListener('play', onPlay);
      vid.removeEventListener('pause', onPause);
      vid.removeEventListener('ended', onEnded);
    };
  }, [updatePosition, startHeartbeat, stopHeartbeat, showControls]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target !== document.body && e.target !== containerRef.current) return;
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft':   e.preventDefault(); skipSeconds(-10, 'left'); break;
        case 'ArrowRight':  e.preventDefault(); skipSeconds(10, 'right'); break;
        case 'f':           e.preventDefault(); void toggleFullscreen(); break;
        case 'm':           e.preventDefault(); setMuted((m) => !m); break;
        case 'Escape':      onClose?.(); break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [togglePlay, skipSeconds, toggleFullscreen, onClose]);

  // ── Audio track switching ───────────────────────────────────────────────
  const switchAudio = useCallback((trackIndex: number) => {
    setSelectedAudio(trackIndex);
    // Re-request stream with audio index query param
    const vid = videoRef.current;
    if (!vid) return;
    const currentPos = vid.currentTime;
    const newSrc = `${src}${src.includes('?') ? '&' : '?'}audio=${trackIndex}&seek=${currentPos}`;
    vid.src = newSrc;
    void vid.play();
    setShowSubMenu(null);
  }, [src]);

  // ── Subtitle track switching ────────────────────────────────────────────
  const switchSubtitle = useCallback((track: SubtitleTrack | null) => {
    const vid = videoRef.current;
    if (!vid) return;
    // Clear all tracks
    for (let i = 0; i < vid.textTracks.length; i++) {
      vid.textTracks[i].mode = 'disabled';
    }
    if (track && track.isExternal && track.filePath) {
      // Load external subtitle
      const existing = vid.querySelector(`track[data-path="${track.filePath}"]`);
      if (!existing) {
        const trackEl = document.createElement('track');
        trackEl.kind = 'subtitles';
        trackEl.label = track.label ?? track.language ?? 'Unknown';
        if (track.language) trackEl.srclang = track.language;
        trackEl.src = api.stream.subtitleUrl(track.filePath);
        trackEl.dataset.path = track.filePath;
        vid.appendChild(trackEl);
        trackEl.track.mode = 'showing';
      } else {
        (existing as HTMLTrackElement).track.mode = 'showing';
      }
    } else if (track && !track.isExternal) {
      const t = vid.textTracks[track.index];
      if (t) t.mode = 'showing';
    }
    setSelectedSubtitle(track?.index ?? null);
    setShowSubMenu(null);
  }, []);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      id="video-player-container"
      className="relative w-full h-full bg-black select-none overflow-hidden"
      style={{ touchAction: 'none' }}
      onMouseMove={showControls}
    >
      {/* ── Video element ─────────────────────────────────────────────────── */}
      <video
        ref={videoRef}
        id="main-video"
        className="w-full h-full object-contain"
        playsInline
        preload="metadata"
        muted={muted}
      >
        <source src={src} type={needsTranscode ? 'video/mp4' : mimeType} />
      </video>

      {/* ── Resume prompt ─────────────────────────────────────────────────── */}
      {showResumePrompt && (
        <div className="absolute inset-0 flex items-end justify-center pb-32 z-30 pointer-events-none">
          <div className="glass-card px-6 py-4 flex flex-col items-center gap-3 animate-slide-up shadow-2xl pointer-events-auto">
            <p className="text-white text-sm font-medium">
              Resume from <span className="text-brand-400 font-bold">{formatTime(initialPosition)}</span>?
            </p>
            <div className="flex gap-3">
              <button
                id="resume-btn"
                onClick={() => {
                  setShowResumePrompt(false);
                  seek(initialPosition);
                  void videoRef.current?.play();
                }}
                className="px-5 py-2 bg-brand-600 hover:bg-brand-500 rounded-full text-sm font-semibold transition-colors"
              >
                Resume
              </button>
              <button
                id="restart-btn"
                onClick={() => {
                  setShowResumePrompt(false);
                  seek(0);
                  api.progress.save(mediaType, mediaId, 0, duration).catch(() => {});
                  void videoRef.current?.play();
                }}
                className="px-5 py-2 bg-surface-700 hover:bg-surface-600 rounded-full text-sm font-medium transition-colors"
              >
                Start Over
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Double-tap skip indicators ────────────────────────────────────── */}
      {skipAnimation === 'left' && (
        <div className="absolute left-0 top-0 bottom-0 w-1/3 flex items-center justify-center pointer-events-none z-20">
          <div className="flex flex-col items-center gap-1 animate-scale-in">
            <div className="flex">
              {[...Array(3)].map((_, i) => (
                <svg key={i} className="w-6 h-6 text-white/80" style={{ animationDelay: `${i * 60}ms` }} fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 6l-4 6 4 6V6zm10 0l-4 6 4 6V6z" />
                </svg>
              ))}
            </div>
            <span className="text-white text-xs font-semibold">10s</span>
          </div>
        </div>
      )}
      {skipAnimation === 'right' && (
        <div className="absolute right-0 top-0 bottom-0 w-1/3 flex items-center justify-center pointer-events-none z-20">
          <div className="flex flex-col items-center gap-1 animate-scale-in">
            <div className="flex">
              {[...Array(3)].map((_, i) => (
                <svg key={i} className="w-6 h-6 text-white/80" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18 6l4 6-4 6V6zM8 6l4 6-4 6V6z" />
                </svg>
              ))}
            </div>
            <span className="text-white text-xs font-semibold">10s</span>
          </div>
        </div>
      )}

      {/* ── Tap/click area (covers most of screen for double-tap seek) ─────── */}
      <div
        className="absolute inset-0 z-10"
        onClick={handleVideoAreaTap}
        onTouchEnd={handleVideoAreaTap}
        style={{ touchAction: 'manipulation' }}
      />

      {/* ── Controls overlay ──────────────────────────────────────────────── */}
      <div
        className={`absolute inset-0 z-20 flex flex-col justify-between transition-opacity duration-300 pointer-events-none ${
          controlsState === 'visible' ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 pt-safe pt-4 pb-8"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)' }}>
          <button
            id="player-back-btn"
            className="player-btn w-10 h-10 bg-black/40 hover:bg-black/60 pointer-events-auto"
            onClick={onClose}
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-white font-semibold text-sm truncate max-w-[60%] text-center">{title}</span>
          <div className="flex items-center gap-2 pointer-events-auto">
            {/* Audio tracks */}
            {audioTracks.length > 1 && (
              <div className="relative">
                <button
                  id="audio-track-btn"
                  className="player-btn w-9 h-9 bg-black/40 hover:bg-black/60 text-xs font-bold text-white"
                  onClick={() => setShowSubMenu((s) => s === 'audio' ? null : 'audio')}
                >
                  AU
                </button>
                {showSubMenu === 'audio' && (
                  <div className="absolute right-0 top-11 glass-card p-2 min-w-40 z-50">
                    {audioTracks.map((t) => (
                      <button
                        key={t.index}
                        className={`block w-full text-left px-3 py-2 text-xs rounded-lg transition-colors ${
                          selectedAudio === t.index ? 'bg-brand-600 text-white' : 'text-surface-200 hover:bg-surface-700'
                        }`}
                        onClick={() => switchAudio(t.index)}
                      >
                        {t.label ?? t.language?.toUpperCase() ?? `Track ${t.index + 1}`}
                        {t.codec && <span className="ml-1 opacity-60">({t.codec})</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Subtitle tracks */}
            {subtitleTracks.length > 0 && (
              <div className="relative">
                <button
                  id="subtitle-track-btn"
                  className="player-btn w-9 h-9 bg-black/40 hover:bg-black/60 text-xs font-bold text-white"
                  onClick={() => setShowSubMenu((s) => s === 'subtitle' ? null : 'subtitle')}
                >
                  CC
                </button>
                {showSubMenu === 'subtitle' && (
                  <div className="absolute right-0 top-11 glass-card p-2 min-w-40 z-50">
                    <button
                      className={`block w-full text-left px-3 py-2 text-xs rounded-lg transition-colors ${
                        selectedSubtitle === null ? 'bg-brand-600 text-white' : 'text-surface-200 hover:bg-surface-700'
                      }`}
                      onClick={() => switchSubtitle(null)}
                    >
                      Off
                    </button>
                    {subtitleTracks.map((t) => (
                      <button
                        key={t.index}
                        className={`block w-full text-left px-3 py-2 text-xs rounded-lg transition-colors ${
                          selectedSubtitle === t.index ? 'bg-brand-600 text-white' : 'text-surface-200 hover:bg-surface-700'
                        }`}
                        onClick={() => switchSubtitle(t)}
                      >
                        {t.label ?? t.language?.toUpperCase() ?? `Sub ${t.index + 1}`}
                        {t.isExternal && <span className="ml-1 opacity-60">(ext)</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center play/pause */}
        <div className="flex items-center justify-center pointer-events-auto">
          <button
            id="play-pause-btn"
            className="player-btn w-16 h-16 bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/20"
            onClick={togglePlay}
          >
            {playing ? (
              <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="w-7 h-7 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        </div>

        {/* Bottom controls */}
        <div
          className="px-4 pb-safe pb-6 pt-12 pointer-events-auto"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%)' }}
        >
          {/* Progress bar */}
          <div
            id="progress-bar"
            className="progress-bar cursor-pointer mb-3 relative h-1 group hover:h-1.5 transition-all"
            onClick={handleProgressClick}
          >
            {/* Buffered */}
            <div className="absolute inset-y-0 left-0 bg-white/20 rounded-full" style={{ width: `${bufferedPct}%` }} />
            {/* Played */}
            <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            {/* Thumb */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-brand-500 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `${progressPct}%`, transform: 'translate(-50%, -50%)' }}
            />
          </div>

          {/* Time + controls row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Skip back 10s */}
              <button
                id="skip-back-btn"
                className="player-btn w-9 h-9 text-white"
                onClick={() => skipSeconds(-10, 'left')}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                  <text x="9" y="16" fontSize="6" fill="currentColor">10</text>
                </svg>
              </button>

              {/* Play/Pause (small) */}
              <button
                className="player-btn w-9 h-9 text-white"
                onClick={togglePlay}
              >
                {playing ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              {/* Skip forward 10s */}
              <button
                id="skip-forward-btn"
                className="player-btn w-9 h-9 text-white"
                onClick={() => skipSeconds(10, 'right')}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/>
                </svg>
              </button>

              {/* Time */}
              <span className="text-white/80 text-xs font-mono">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Playback speed */}
              <div className="relative">
                <button
                  id="speed-btn"
                  className="player-btn px-2.5 h-8 text-xs font-bold text-white bg-white/10 hover:bg-white/25 rounded-lg border border-white/15 transition-all flex items-center gap-1"
                  onClick={() => setShowSubMenu((s) => s === 'speed' ? null : 'speed')}
                  title="Playback Speed"
                >
                  <span>{playbackSpeed}x</span>
                </button>
                {showSubMenu === 'speed' && (
                  <div className="absolute right-0 bottom-10 glass-card p-1.5 min-w-28 z-50 bg-black/95 backdrop-blur-md rounded-xl border border-white/20 shadow-2xl animate-fade-in">
                    <div className="text-[10px] uppercase font-bold text-surface-400 px-2 py-1 tracking-wider">Speed</div>
                    {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((spd) => (
                      <button
                        key={spd}
                        className={`w-full text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors flex items-center justify-between ${
                          playbackSpeed === spd
                            ? 'bg-brand-600 text-white font-bold'
                            : 'text-surface-200 hover:bg-white/15'
                        }`}
                        onClick={() => {
                          setPlaybackSpeed(spd);
                          if (videoRef.current) {
                            videoRef.current.playbackRate = spd;
                          }
                          setShowSubMenu(null);
                        }}
                      >
                        <span>{spd}x</span>
                        {spd === 1 && <span className="text-[10px] opacity-60">Normal</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Mute */}
              <button
                id="mute-btn"
                className="player-btn w-9 h-9 text-white"
                onClick={() => setMuted((m) => !m)}
              >
                {muted ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M16.5 12A4.5 4.5 0 0014 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                  </svg>
                )}
              </button>

              {/* Fullscreen */}
              <button
                id="fullscreen-btn"
                className="player-btn w-9 h-9 text-white"
                onClick={() => void toggleFullscreen()}
              >
                {isFullscreen ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Player;
