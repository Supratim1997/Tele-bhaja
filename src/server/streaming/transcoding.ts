/**
 * FFmpeg transcoding service using child_process.spawn directly.
 * No fluent-ffmpeg dependency — pure Node.js stdio piping.
 */

import { spawn, type ChildProcess } from 'child_process';
import { PassThrough } from 'stream';
import { config } from '../config.js';

function getFFmpegPath(): string {
  return config.ffmpeg.ffmpegPath || 'ffmpeg';
}

export interface TranscodeOptions {
  seekTime?: number;
  audioTrackIndex?: number;
  videoBitrate?: string;
  audioBitrate?: string;
  maxDuration?: number;
}

export class TranscodingService {
  private activeJobs = new Map<string, ChildProcess>();

  /**
   * Creates a PassThrough stream piped from an FFmpeg transcode.
   * Output is fragmented MP4 for universal browser compatibility.
   */
  createTranscodeStream(inputPath: string, opts: TranscodeOptions = {}): PassThrough {
    const output = new PassThrough();
    const ffmpegPath = getFFmpegPath();

    const args: string[] = [];

    // Fast seek before input
    if (opts.seekTime && opts.seekTime > 0) {
      args.push('-ss', String(opts.seekTime));
    }

    args.push('-i', inputPath);

    // Max duration
    if (opts.maxDuration && opts.maxDuration > 0) {
      args.push('-t', String(opts.maxDuration));
    }

    // Video codec — H.264 for universal browser support
    // Using 0:a:X? makes the audio stream mapping optional if file has no audio
    args.push(
      '-map', '0:v:0',
      '-map', `0:a:${opts.audioTrackIndex ?? 0}?`,
      '-vcodec', 'libx264',
      '-preset', 'ultrafast',
      '-profile:v', 'high',
      '-level', '4.1',
      '-pix_fmt', 'yuv420p',
      '-b:v', opts.videoBitrate ?? `${config.ffmpeg.videoBitrate}k`,
      // Audio to AAC stereo
      '-acodec', 'aac',
      '-b:a', opts.audioBitrate ?? `${config.ffmpeg.audioBitrate}k`,
      '-ac', '2',
      '-ar', '48000',
      // Fragmented MP4 output to stdout
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+faststart',
      '-avoid_negative_ts', 'make_zero',
      'pipe:1',
    );

    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const jobKey = `${inputPath}:${opts.seekTime ?? 0}:${opts.audioTrackIndex ?? 0}`;

    this.activeJobs.set(jobKey, proc);

    proc.stdout.pipe(output);

    proc.stderr.on('data', (data: Buffer) => {
      // Suppress noisy ffmpeg stderr unless debugging
      if (process.env.FFMPEG_DEBUG) {
        process.stderr.write(data);
      }
    });

    proc.on('error', (err) => {
      if (!err.message.includes('EPIPE')) {
        console.error(`[Transcode] FFmpeg error: ${err.message}`);
      }
      this.activeJobs.delete(jobKey);
      output.destroy(err);
    });

    proc.on('close', (code) => {
      this.activeJobs.delete(jobKey);
      if (code !== 0 && code !== null) {
        output.destroy(new Error(`FFmpeg exited with code ${code}`));
      } else {
        output.end();
      }
    });

    // Allow caller to destroy and kill ffmpeg
    const origDestroy = output.destroy.bind(output);
    output.destroy = (err?: Error) => {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      this.activeJobs.delete(jobKey);
      return origDestroy(err);
    };

    return output;
  }

  /**
   * Generate a JPEG thumbnail at given time offset.
   */
  async generateThumbnail(inputPath: string, timeSeconds: number = 10): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const ffmpegPath = getFFmpegPath();
      const args = [
        '-ss', String(timeSeconds),
        '-i', inputPath,
        '-vframes', '1',
        '-vf', 'scale=480:-1',
        '-f', 'image2',
        '-vcodec', 'mjpeg',
        'pipe:1',
      ];

      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];

      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`FFmpeg thumbnail failed with code ${code}`));
        }
      });
    });
  }

  get jobCount(): number {
    return this.activeJobs.size;
  }

  killAll(): void {
    for (const proc of this.activeJobs.values()) {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
    this.activeJobs.clear();
  }
}

export const transcodingService = new TranscodingService();
