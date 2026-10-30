import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function requireEnv(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

export const config = {
  port:              parseInt(process.env.PORT ?? '3000', 10),
  host:              process.env.HOST ?? '0.0.0.0',
  nodeEnv:           process.env.NODE_ENV ?? 'development',
  get mediaStoragePaths(): string[] {
    const raw = process.env.MEDIA_STORAGE_PATH ?? 'E:\\Media';
    const list = raw
      .split(/[;,|\r\n]+/)
      .map((s) => s.replace(/^[ "']+|[ "']+$/g, '').trim())
      .filter(Boolean);
    return list.length > 0 ? list : ['E:\\Media'];
  },
  get mediaStoragePath(): string {
    return this.mediaStoragePaths[0] ?? 'E:\\Media';
  },
  get dbPath(): string {
    return process.env.DB_PATH ?? './data/telebhaja.db';
  },

  tmdb: {
    apiKey:    process.env.TMDB_API_KEY ?? '',
    baseUrl:   process.env.TMDB_BASE_URL ?? 'https://api.themoviedb.org/3',
    imageBase: process.env.TMDB_IMAGE_BASE ?? 'https://image.tmdb.org/t/p',
  },

  ffmpeg: {
    ffmpegPath:  process.env.FFMPEG_PATH ?? '',
    ffprobePath: process.env.FFPROBE_PATH ?? '',
    videoBitrate: parseInt(process.env.TRANSCODE_VIDEO_BITRATE ?? '2000', 10),
    audioBitrate: parseInt(process.env.TRANSCODE_AUDIO_BITRATE ?? '128', 10),
    maxConcurrent: parseInt(process.env.TRANSCODE_MAX_CONCURRENT ?? '2', 10),
  },

  scanner: {
    onStartup: process.env.SCAN_ON_STARTUP !== 'false',
    cron:      process.env.SCAN_CRON ?? '',
  },

  uiPin: process.env.UI_PIN ?? '',

  // Codec lists that require transcoding for browser compatibility
  incompatibleVideoCodecs: ['hevc', 'h265', 'vc1', 'vp9', 'av1', 'mpeg2video', 'mpeg4'],
  incompatibleAudioCodecs: ['ac3', 'eac3', 'dts', 'truehd', 'mlp', 'pcm_s24le', 'pcm_s32le'],
  incompatibleContainers: ['.mkv', '.avi', '.mov', '.flv', '.wmv'],
} as const;
