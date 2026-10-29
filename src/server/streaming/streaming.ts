/**
 * HTTP 206 Partial Content streaming service.
 * Handles byte-range requests for direct file serving and FFmpeg pipe output.
 */

import fs from 'fs';
import path from 'path';
import type { Request, Response } from 'express';
import { getDb } from '../db/database.js';
import { transcodingService } from './transcoding.js';

export class StreamingService {
  /**
   * Stream a movie by ID with HTTP 206 partial content support.
   */
  async streamMovie(req: Request, res: Response, id: number): Promise<void> {
    const db = getDb();
    const item = await db.prepare(`
      SELECT id, file_path, file_size, mime_type, needs_transcode, audio_tracks, is_excluded
      FROM media_items WHERE id=?
    `).get(id) as {
      id: number; file_path: string; file_size: number;
      mime_type: string; needs_transcode: number; audio_tracks: string;
      is_excluded?: number;
    } | undefined;

    if (!item || item.is_excluded === 1) {
      res.status(404).json({ error: 'Media not found or excluded from playback' });
      return;
    }

    if (!fs.existsSync(item.file_path)) {
      res.status(404).json({ error: 'File not found on disk' });
      return;
    }

    await this.serveFile(req, res, item.file_path, item.file_size, item.mime_type, item.needs_transcode === 1);
  }

  /**
   * Stream an episode by ID.
   */
  async streamEpisode(req: Request, res: Response, id: number): Promise<void> {
    const db = getDb();
    const item = await db.prepare(`
      SELECT id, file_path, file_size, mime_type, needs_transcode, audio_tracks, is_excluded
      FROM episodes WHERE id=?
    `).get(id) as {
      id: number; file_path: string; file_size: number;
      mime_type: string; needs_transcode: number; audio_tracks: string;
      is_excluded?: number;
    } | undefined;

    if (!item || item.is_excluded === 1) {
      res.status(404).json({ error: 'Episode not found or excluded from playback' });
      return;
    }

    if (!fs.existsSync(item.file_path)) {
      res.status(404).json({ error: 'File not found on disk' });
      return;
    }

    await this.serveFile(req, res, item.file_path, item.file_size, item.mime_type, item.needs_transcode === 1);
  }

  /**
   * Core byte-range streaming logic.
   * Serves HTTP 206 for range requests, HTTP 200 for full file.
   * Routes incompatible files through FFmpeg transcode pipe.
   */
  private async serveFile(
    req: Request,
    res: Response,
    filePath: string,
    fileSize: number,
    mimeType: string,
    needsTranscode: boolean,
  ): Promise<void> {
    const forceTranscode = req.query.transcode === '1';

    if (needsTranscode || forceTranscode) {
      // Route through FFmpeg fragmented MP4 pipe
      await this.serveTranscoded(req, res, filePath);
      return;
    }

    // Direct byte-range streaming
    const rangeHeader = req.headers.range;

    if (!rangeHeader) {
      // Full file response
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      });
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on('error', () => res.end());
      return;
    }

    // Parse Range header: "bytes=start-end"
    const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (!rangeMatch) {
      res.status(400).json({ error: 'Invalid Range header' });
      return;
    }

    const startStr = rangeMatch[1];
    const endStr = rangeMatch[2];

    let start = startStr ? parseInt(startStr, 10) : 0;
    let end = endStr ? parseInt(endStr, 10) : fileSize - 1;

    // Validate range per RFC 7233
    if (isNaN(start) || start < 0 || start >= fileSize || (endStr && start > end)) {
      res.status(416).set({
        'Content-Range': `bytes */${fileSize}`,
      }).end();
      return;
    }

    // Clamp end to file size
    end = Math.max(start, Math.min(end, fileSize - 1));

    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Type': mimeType,
      'Content-Length': chunkSize,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
    stream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) res.status(500).end();
    });
    req.on('close', () => stream.destroy());
  }

  /**
   * Pipe an FFmpeg transcode directly to the response as fragmented MP4.
   * This enables real-time remuxing for incompatible containers/codecs.
   */
  private async serveTranscoded(req: Request, res: Response, filePath: string): Promise<void> {
    // Parse start time from seek query param (?seek=30.5)
    const seekTime = parseFloat(String(req.query.seek ?? '0')) || 0;

    // Request audio track by index (?audio=1)
    const audioTrackIndex = parseInt(String(req.query.audio ?? '0'), 10) || 0;

    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Transfer-Encoding': 'chunked',
      'Accept-Ranges': 'none',
      'Cache-Control': 'no-cache',
      'X-Transcoded': '1',
    });

    const proc = transcodingService.createTranscodeStream(filePath, {
      seekTime,
      audioTrackIndex,
      videoBitrate: `${2000}k`,
      audioBitrate: '128k',
    });

    proc.pipe(res);

    req.on('close', () => {
      proc.destroy();
    });
  }

  /**
   * Serve an external subtitle file (.srt → converts to VTT, .vtt → direct).
   */
  serveSubtitle(req: Request, res: Response, subtitlePath: string): void {
    if (!fs.existsSync(subtitlePath)) {
      res.status(404).json({ error: 'Subtitle file not found' });
      return;
    }

    const ext = path.extname(subtitlePath).toLowerCase();

    if (ext === '.vtt') {
      res.setHeader('Content-Type', 'text/vtt');
      fs.createReadStream(subtitlePath).pipe(res);
      return;
    }

    if (ext === '.srt') {
      // Convert SRT to WebVTT on-the-fly
      res.setHeader('Content-Type', 'text/vtt');
      res.write('WEBVTT\n\n');
      const content = fs.readFileSync(subtitlePath, 'utf-8');
      const vtt = srtToVtt(content);
      res.end(vtt);
      return;
    }

    // Fallback: serve raw
    res.setHeader('Content-Type', 'text/plain');
    fs.createReadStream(subtitlePath).pipe(res);
  }
}

/**
 * Convert SRT subtitle format to WebVTT.
 */
function srtToVtt(srt: string): string {
  return srt
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')  // commas → dots
    .replace(/^\d+\s*$/gm, '')                            // remove cue numbers
    .trim();
}

export const streamingService = new StreamingService();
