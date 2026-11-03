/**
 * HTTP Live Streaming (HLS) Service
 * Powers on-the-fly HLS transcoding and segmenting for Safari (iOS / iPadOS / macOS),
 * providing native hardware-accelerated playback for containers and codecs that
 * Apple WebKit refuses to play over progressive chunked HTTP transfers (e.g. MKV, AC3).
 */

import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import type { Request, Response } from 'express';
import { getDb } from '../db/database.js';
import { config } from '../config.js';
import { probeFile } from '../scanner/ffprobe.js';

interface HLSSession {
  key: string;
  mediaType: 'movie' | 'episode';
  mediaId: number;
  filePath: string;
  seekTime: number;
  audioTrackIndex: number;
  sessionDir: string;
  proc?: ChildProcess;
  lastAccessed: number;
  isReady: boolean;
  readyPromise?: Promise<void>;
  error?: Error;
}

const HLS_BASE_DIR = path.join(process.cwd(), 'data', 'hls_cache');
const h264Cache = new Map<string, boolean>();

async function canCopyVideo(filePath: string): Promise<boolean> {
  if (h264Cache.has(filePath)) {
    return h264Cache.get(filePath)!;
  }
  try {
    const probe = await probeFile(filePath);
    const isH264 = probe.videoCodec === 'h264' || probe.videoCodec === 'avc1';
    h264Cache.set(filePath, isH264);
    return isH264;
  } catch {
    h264Cache.set(filePath, false);
    return false;
  }
}

export class HLSService {
  private sessions = new Map<string, HLSSession>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    this.ensureBaseDir();
    this.startCleanupLoop();
  }

  private ensureBaseDir(): void {
    try {
      if (!fs.existsSync(HLS_BASE_DIR)) {
        fs.mkdirSync(HLS_BASE_DIR, { recursive: true });
      }
    } catch (err) {
      console.error('[HLS] Failed to create HLS cache directory:', err);
    }
  }

  private startCleanupLoop(): void {
    // Check every 60s for expired sessions (> 5 min inactivity)
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const EXPIRE_MS = 5 * 60 * 1000;
      for (const [key, session] of this.sessions.entries()) {
        if (now - session.lastAccessed > EXPIRE_MS) {
          this.terminateSession(key);
        }
      }
    }, 60000);
    this.cleanupTimer.unref();
  }

  public terminateSession(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);

    try {
      if (session.proc && !session.proc.killed) {
        session.proc.kill('SIGKILL');
      }
    } catch { /* ignore */ }

    try {
      if (fs.existsSync(session.sessionDir)) {
        fs.rmSync(session.sessionDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn(`[HLS] Error removing directory for session ${key}:`, err);
    }
    console.log(`[HLS] Session cleaned up: ${key}`);
  }

  /**
   * Handle requests for HLS playlist (playlist.m3u8)
   */
  async servePlaylist(
    req: Request,
    res: Response,
    mediaType: 'movie' | 'episode',
    mediaId: number
  ): Promise<void> {
    const db = getDb();
    const table = mediaType === 'movie' ? 'media_items' : 'episodes';
    const item = await db.prepare(`SELECT id, file_path, is_excluded FROM ${table} WHERE id=?`).get(mediaId) as {
      id: number;
      file_path: string;
      is_excluded?: number;
    } | undefined;

    const isPreview = req.query.preview === '1';
    if (!item || (!isPreview && item.is_excluded === 1) || !fs.existsSync(item.file_path)) {
      res.status(404).json({ error: 'Media not found or excluded' });
      return;
    }

    const seekTime = parseFloat(String(req.query.seek ?? '0')) || 0;
    const audioTrackIndex = parseInt(String(req.query.audio ?? '0'), 10) || 0;
    const sessionKey = `${mediaType}_${mediaId}_s${Math.round(seekTime)}_a${audioTrackIndex}`;

    let session = this.sessions.get(sessionKey);

    if (!session) {
      session = await this.startSession(sessionKey, mediaType, mediaId, item.file_path, seekTime, audioTrackIndex);
    }

    session.lastAccessed = Date.now();

    // Wait until playlist and at least one segment are ready
    if (!session.isReady && session.readyPromise) {
      try {
        await session.readyPromise;
      } catch (err) {
        res.status(500).json({ error: 'Failed to initialize HLS stream', details: String(err) });
        return;
      }
    }

    const playlistPath = path.join(session.sessionDir, 'playlist.m3u8');
    if (!fs.existsSync(playlistPath)) {
      res.status(503).json({ error: 'Playlist not ready yet, retry shortly' });
      return;
    }

    let content = fs.readFileSync(playlistPath, 'utf8');

    // If gate_token or session query params are present, propagate them to segment URLs
    const gateToken = req.query.gate_token as string;
    const queryParts: string[] = [];
    if (gateToken) queryParts.push(`gate_token=${encodeURIComponent(gateToken)}`);
    if (isPreview) queryParts.push('preview=1');
    const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

    if (queryString) {
      content = content.replace(/(segment_\d+\.ts)/g, `$1${queryString}`);
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(content);
  }

  /**
   * Handle requests for HLS video segments (.ts)
   */
  async serveSegment(
    req: Request,
    res: Response,
    mediaType: 'movie' | 'episode',
    mediaId: number,
    segmentName: string
  ): Promise<void> {
    // Sanitize segment filename to prevent directory traversal
    const safeSegment = path.basename(segmentName);
    if (!safeSegment.endsWith('.ts')) {
      res.status(400).end();
      return;
    }

    // Locate matching session
    let targetFile: string | null = null;
    let matchingSession: HLSSession | null = null;

    for (const session of this.sessions.values()) {
      if (session.mediaType === mediaType && session.mediaId === mediaId) {
        const candidate = path.join(session.sessionDir, safeSegment);
        if (fs.existsSync(candidate)) {
          targetFile = candidate;
          matchingSession = session;
          break;
        }
      }
    }

    if (!targetFile || !matchingSession) {
      // If segment is still being written by FFmpeg, wait up to 3 seconds before failing
      const activeSessions = Array.from(this.sessions.values())
        .filter((s) => s.mediaType === mediaType && s.mediaId === mediaId);

      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        for (const session of activeSessions) {
          const candidate = path.join(session.sessionDir, safeSegment);
          if (fs.existsSync(candidate)) {
            targetFile = candidate;
            matchingSession = session;
            break;
          }
        }
        if (targetFile) break;
      }
    }

    if (!targetFile || !matchingSession) {
      res.status(404).end();
      return;
    }

    matchingSession.lastAccessed = Date.now();

    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const stream = fs.createReadStream(targetFile);
    stream.pipe(res);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });
  }

  private async startSession(
    sessionKey: string,
    mediaType: 'movie' | 'episode',
    mediaId: number,
    filePath: string,
    seekTime: number,
    audioTrackIndex: number
  ): Promise<HLSSession> {
    const sessionDir = path.join(HLS_BASE_DIR, sessionKey);

    // Clean any leftover directory
    if (fs.existsSync(sessionDir)) {
      try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
    }
    fs.mkdirSync(sessionDir, { recursive: true });

    const copyVideo = await canCopyVideo(filePath);
    const ffmpegPath = config.ffmpeg.ffmpegPath || 'ffmpeg';

    const args: string[] = ['-threads', '0', '-max_muxing_queue_size', '2048'];

    // Fast seek before input
    if (seekTime > 0) {
      args.push('-ss', String(seekTime));
    }

    args.push('-i', filePath);
    args.push('-map', '0:v:0', '-map', `0:a:${audioTrackIndex}?`);

    if (copyVideo) {
      args.push(
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', `${config.ffmpeg.audioBitrate}k`,
        '-ac', '2',
        '-ar', '48000'
      );
    } else {
      args.push(
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'fastdecode',
        '-profile:v', 'high',
        '-level', '4.1',
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-b:v', `${config.ffmpeg.videoBitrate}k`,
        '-c:a', 'aac',
        '-b:a', `${config.ffmpeg.audioBitrate}k`,
        '-ac', '2',
        '-ar', '48000'
      );
    }

    args.push(
      '-f', 'hls',
      '-hls_time', '3',
      '-hls_list_size', '0',
      '-hls_playlist_type', 'event',
      '-hls_flags', 'temp_file',
      '-hls_segment_filename', path.join(sessionDir, 'segment_%04d.ts'),
      path.join(sessionDir, 'playlist.m3u8')
    );

    console.log(`[HLS] Spawning FFmpeg HLS session "${sessionKey}" (copyVideo: ${copyVideo}, seek: ${seekTime}s, audio: ${audioTrackIndex})`);

    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stderrLines: string[] = [];

    proc.stderr.on('data', (d: Buffer) => {
      const text = d.toString();
      stderrLines.push(text);
      if (stderrLines.length > 25) stderrLines.shift();
    });

    const session: HLSSession = {
      key: sessionKey,
      mediaType,
      mediaId,
      filePath,
      seekTime,
      audioTrackIndex,
      sessionDir,
      proc,
      lastAccessed: Date.now(),
      isReady: false,
    };

    // Ready promise: resolves once playlist.m3u8 and first segment exist
    session.readyPromise = new Promise<void>((resolve, reject) => {
      const playlistPath = path.join(sessionDir, 'playlist.m3u8');
      const firstSegment = path.join(sessionDir, 'segment_0000.ts');

      let elapsed = 0;
      const interval = setInterval(() => {
        elapsed += 50;
        if (fs.existsSync(playlistPath) && fs.existsSync(firstSegment)) {
          clearInterval(interval);
          session.isReady = true;
          resolve();
        } else if (elapsed > 12000) {
          clearInterval(interval);
          reject(new Error(`Timeout waiting for HLS playlist and segment: ${stderrLines.join('\n')}`));
        }
      }, 50);

      proc.on('error', (err) => {
        clearInterval(interval);
        session.error = err;
        reject(err);
      });

      proc.on('close', (code) => {
        if (code !== 0 && !session.isReady) {
          clearInterval(interval);
          reject(new Error(`FFmpeg exited early with code ${code}: ${stderrLines.join('\n')}`));
        }
      });
    });

    this.sessions.set(sessionKey, session);
    return session;
  }
}

export const hlsService = new HLSService();

