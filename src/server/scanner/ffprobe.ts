/**
 * FFprobe wrapper using child_process — no fluent-ffmpeg dependency.
 * Invokes ffprobe directly and parses JSON output.
 */

import { spawn } from 'child_process';
import { config } from '../config.js';
import type { AudioTrack, SubtitleTrack } from '../../shared/types.js';

export interface ProbeResult {
  duration: number;
  mimeType: string;
  videoCodec?: string;
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  needsTranscode: boolean;
  container: string;
}

function getFFprobePath(): string {
  return config.ffmpeg.ffprobePath || 'ffprobe';
}

export async function probeFile(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const ffprobePath = getFFprobePath();
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];

    const proc = spawn(ffprobePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    // Guard against hanging ffprobe processes on corrupted files / bad disk sectors
    const timeoutTimer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      reject(new Error(`ffprobe timed out after 15s on ${filePath}`));
    }, 15000);

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('error', (err) => {
      clearTimeout(timeoutTimer);
      reject(new Error(`ffprobe not found or failed: ${err.message}. Install FFmpeg or set FFPROBE_PATH.`));
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutTimer);
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${code}: ${stderr.slice(0, 200)}`));
        return;
      }

      try {
        const data = JSON.parse(stdout) as {
          format: { duration?: string; format_name?: string };
          streams: Array<{
            index: number;
            codec_type: string;
            codec_name?: string;
            channels?: number;
            tags?: { language?: string; title?: string };
          }>;
        };

        const format = data.format ?? {};
        const streams = data.streams ?? [];
        const duration = parseFloat(String(format.duration ?? '0'));
        const container = format.format_name ?? '';

        const videoStream = streams.find((s) => s.codec_type === 'video');
        const videoCodec = videoStream?.codec_name?.toLowerCase() ?? '';

        const audioTracks: AudioTrack[] = streams
          .filter((s) => s.codec_type === 'audio')
          .map((s, idx) => ({
            index: s.index ?? idx,
            language: s.tags?.language ?? undefined,
            codec: s.codec_name?.toLowerCase() ?? 'unknown',
            channels: s.channels ?? 2,
            label: s.tags?.title ?? undefined,
          }));

        const subtitleTracks: SubtitleTrack[] = streams
          .filter((s) => s.codec_type === 'subtitle')
          .map((s, idx) => ({
            index: s.index ?? idx,
            language: s.tags?.language ?? undefined,
            codec: s.codec_name?.toLowerCase() ?? 'unknown',
            label: s.tags?.title ?? s.tags?.language ?? undefined,
            isExternal: false,
          }));

        const incompatibleVideo = (config.incompatibleVideoCodecs as readonly string[]).includes(videoCodec);
        const hasIncompatibleAudio = audioTracks.some((a) =>
          (config.incompatibleAudioCodecs as readonly string[]).includes(a.codec)
        );
        const ext = '.' + (filePath.split('.').pop() ?? '').toLowerCase();
        const incompatibleContainer = (config.incompatibleContainers as readonly string[]).includes(ext);
        const needsTranscode = incompatibleVideo || hasIncompatibleAudio || incompatibleContainer;

        const mimeMap: Record<string, string> = {
          mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4',
          mkv: 'video/x-matroska', webm: 'video/webm',
          avi: 'video/x-msvideo', ts: 'video/mp2t',
        };
        const mimeType = mimeMap[ext.slice(1)] ?? 'video/mp4';

        resolve({ duration, mimeType, videoCodec, audioTracks, subtitleTracks, needsTranscode, container });
      } catch (parseErr) {
        reject(new Error(`Failed to parse ffprobe output: ${parseErr}`));
      }
    });
  });
}

export async function quickProbe(filePath: string): Promise<{ duration: number; mimeType: string }> {
  try {
    const full = await probeFile(filePath);
    return { duration: full.duration, mimeType: full.mimeType };
  } catch {
    const ext = (filePath.split('.').pop() ?? '').toLowerCase();
    const mimeMap: Record<string, string> = {
      mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4',
      mkv: 'video/x-matroska', webm: 'video/webm',
      avi: 'video/x-msvideo',
    };
    return { duration: 0, mimeType: mimeMap[ext] ?? 'video/mp4' };
  }
}
