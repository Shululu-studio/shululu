import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { BACKGROUND_TEMPLATES } from '../data/presets';
import { ProjectData } from '../types/editor';
import {
  getResolutionForAspect,
  MediaAssetCache,
  renderVideoFrame,
} from './lyricRenderer';

function resolveSourceVideoUrl(
  project: ProjectData,
  mediaCache: MediaAssetCache
): { url: string | null; srcEl: HTMLVideoElement | null } {
  if (project.background.type === 'video') {
    const url =
      mediaCache.videoElement?.currentSrc ||
      mediaCache.videoElement?.src ||
      project.background.mediaUrl ||
      null;
    return {
      url,
      srcEl: mediaCache.videoElement ?? null,
    };
  }
  return { url: null, srcEl: null };
}

interface PreparedExportVideo {
  video: HTMLVideoElement | null;
  cache: MediaAssetCache;
  cleanup: () => void;
}

async function ensureStaticImageLoaded(
  imageUrl: string,
  cache: MediaAssetCache
): Promise<MediaAssetCache> {
  const existing = cache.images.get(imageUrl);
  if (existing && existing.complete && existing.naturalWidth > 0) {
    return cache;
  }

  const img = existing ?? new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve();
      return;
    }
    const done = () => {
      img.removeEventListener('load', done);
      img.removeEventListener('error', done);
      resolve();
    };
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
    if (!img.src) img.src = imageUrl;
    setTimeout(done, 4000);
  });

  const nextImages = new Map(cache.images);
  nextImages.set(imageUrl, img);
  return {
    ...cache,
    images: nextImages,
  };
}

async function prepareExportVideo(
  project: ProjectData,
  mediaCache: MediaAssetCache
): Promise<PreparedExportVideo> {
  let workingCache = mediaCache;
  if (project.background.type === 'template') {
    const tpl =
      BACKGROUND_TEMPLATES.find((t) => t.id === project.background.templateId) ??
      BACKGROUND_TEMPLATES[0];
    if (tpl?.imageUrl) {
      workingCache = await ensureStaticImageLoaded(tpl.imageUrl, workingCache);
    }
  } else if (project.background.type === 'image' && project.background.mediaUrl) {
    workingCache = await ensureStaticImageLoaded(project.background.mediaUrl, workingCache);
  }

  const { url } = resolveSourceVideoUrl(project, workingCache);
  if (!url) {
    return { video: null, cache: workingCache, cleanup: () => {} };
  }

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:0;top:0;width:16px;height:16px;opacity:0.002;pointer-events:none;overflow:hidden;z-index:-1;';
  const clone = document.createElement('video');
  clone.crossOrigin = 'anonymous';
  clone.muted = true;
  clone.loop = true;
  clone.playsInline = true;
  clone.preload = 'auto';
  clone.src = url;
  host.appendChild(clone);
  document.body.appendChild(host);

  await new Promise<void>((resolve) => {
    if (clone.readyState >= 2) {
      resolve();
      return;
    }
    const done = () => {
      clone.removeEventListener('canplay', done);
      clone.removeEventListener('loadeddata', done);
      clone.removeEventListener('error', done);
      resolve();
    };
    clone.addEventListener('canplay', done, { once: true });
    clone.addEventListener('loadeddata', done, { once: true });
    clone.addEventListener('error', done, { once: true });
    clone.load();
    setTimeout(done, 4000);
  });

  clone.pause();

  const cache: MediaAssetCache = {
    images: workingCache.images,
    videos: workingCache.videos,
    videoElement: project.background.type === 'video' ? clone : workingCache.videoElement,
  };

  return {
    video: clone,
    cache,
    cleanup: () => {
      try {
        clone.pause();
        clone.removeAttribute('src');
        clone.load();
      } catch {
        // ignore cleanup error
      }
      host.remove();
    },
  };
}

async function seekVideoPrecise(vid: HTMLVideoElement, targetSec: number): Promise<void> {
  if (!vid.duration || !Number.isFinite(vid.duration) || vid.duration <= 0) return;
  const maxSafeTime = Math.max(0, vid.duration - 0.04);
  const wrapped = Math.min(maxSafeTime, Math.max(0, targetSec % vid.duration));
  if (Math.abs(vid.currentTime - wrapped) <= 0.004 && vid.readyState >= 2) {
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      vid.removeEventListener('seeked', finish);
      resolve();
    };
    vid.addEventListener('seeked', finish, { once: true });
    vid.currentTime = wrapped;
    setTimeout(finish, 280);
  });
}

async function pickSupportedVideoConfig(
  width: number,
  height: number,
  fps: number,
  bitrate: number
): Promise<VideoEncoderConfig> {
  const candidates =
    height >= 1080 || width >= 1080
      ? ['avc1.64002A', 'avc1.4D402A', 'avc1.4D4028', 'avc1.640028', 'avc1.42E028']
      : ['avc1.4D401F', 'avc1.64001F', 'avc1.42E01F', 'avc1.42E01E'];

  for (const codec of candidates) {
    const cfg: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
    };
    try {
      const check = await VideoEncoder.isConfigSupported(cfg);
      if (check.supported) return cfg;
    } catch {
      // try next profile/level
    }
  }

  return {
    codec: 'avc1.4D4028',
    width,
    height,
    bitrate,
    framerate: fps,
  };
}

interface SupportedAudioCodecConfig {
  muxerCodec: 'aac' | 'opus';
  encoderCodec: string;
  sampleRate: number;
  bitrate: number;
  chunkSamples: number;
  label: string;
}

async function pickSupportedAudioConfig(): Promise<SupportedAudioCodecConfig | null> {
  if (typeof AudioEncoder === 'undefined') return null;

  const candidates: SupportedAudioCodecConfig[] = [
    {
      muxerCodec: 'aac',
      encoderCodec: 'mp4a.40.2',
      sampleRate: 44100,
      bitrate: 160_000,
      chunkSamples: 1024,
      label: 'AAC',
    },
    {
      muxerCodec: 'opus',
      encoderCodec: 'opus',
      sampleRate: 48000,
      bitrate: 160_000,
      chunkSamples: 960,
      label: 'Opus',
    },
  ];

  for (const cand of candidates) {
    try {
      const res = await AudioEncoder.isConfigSupported({
        codec: cand.encoderCodec,
        sampleRate: cand.sampleRate,
        numberOfChannels: 2,
        bitrate: cand.bitrate,
      });
      if (res.supported) return cand;
    } catch {
      // try next audio codec
    }
  }
  return null;
}

export interface ExportCapabilities {
  webCodecsMp4Supported: boolean;
  webCodecsReason: string;
  webCodecsAudioCodec: 'aac' | 'opus' | null;
  mediaRecorderMimeType: string | null;
  mediaRecorderExtension: 'mp4' | 'webm' | null;
  recommendedMode: 'webcodecs-mp4' | 'mediarecorder' | 'unsupported';
}

export async function checkExportCapabilities(): Promise<ExportCapabilities> {
  let webCodecsMp4Supported = false;
  let webCodecsAudioCodec: 'aac' | 'opus' | null = null;
  let webCodecsReason = 'WebCodecs H.264/Audio hardware encoder unavailable in this browser.';

  if (typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined') {
    try {
      const videoCheck = await VideoEncoder.isConfigSupported({
        codec: 'avc1.4D401F',
        width: 1280,
        height: 720,
        bitrate: 5_000_000,
        framerate: 30,
      });
      const audioCfg = await pickSupportedAudioConfig();
      if (videoCheck.supported && audioCfg) {
        webCodecsMp4Supported = true;
        webCodecsAudioCodec = audioCfg.muxerCodec;
        webCodecsReason = `Hardware/Software MP4 (H.264 + ${audioCfg.label}) via WebCodecs supported.`;
      } else {
        webCodecsReason = !videoCheck.supported
          ? 'Browser WebCodecs H.264 video encoder is not supported; falling back to MediaRecorder.'
          : 'Browser WebCodecs audio encoder is not supported; falling back to MediaRecorder.';
      }
    } catch {
      webCodecsReason = 'Unable to initialize WebCodecs probe; using MediaRecorder fallback.';
    }
  }

  let mediaRecorderMimeType: string | null = null;
  let mediaRecorderExtension: 'mp4' | 'webm' | null = null;
  if (typeof MediaRecorder !== 'undefined') {
    const candidates: Array<{ mime: string; ext: 'mp4' | 'webm' }> = [
      { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' },
      { mime: 'video/mp4', ext: 'mp4' },
      { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
      { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
      { mime: 'video/webm', ext: 'webm' },
    ];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c.mime)) {
        mediaRecorderMimeType = c.mime;
        mediaRecorderExtension = c.ext;
        break;
      }
    }
  }

  const recommendedMode = webCodecsMp4Supported
    ? 'webcodecs-mp4'
    : mediaRecorderMimeType
      ? 'mediarecorder'
      : 'unsupported';

  return {
    webCodecsMp4Supported,
    webCodecsReason,
    webCodecsAudioCodec,
    mediaRecorderMimeType,
    mediaRecorderExtension,
    recommendedMode,
  };
}

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'muxing' | 'complete';
  percent: number;
  statusText: string;
  etaSeconds: number | null;
}

export interface ExportOptions {
  project: ProjectData;
  audioBuffer: AudioBuffer | null;
  resolution: 720 | 1080;
  fps: 24 | 30 | 60;
  mediaCache: MediaAssetCache;
  signal: AbortSignal;
  onProgress: (p: ExportProgress) => void;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  mimeType: string;
  encoderUsed: string;
}

function buildExportWaveformPeaks(audioBuffer: AudioBuffer | null, bars = 900): number[] | undefined {
  if (!audioBuffer || audioBuffer.length === 0) return undefined;
  const ch0 = audioBuffer.getChannelData(0);
  const safeBars = Math.max(1, Math.min(bars, ch0.length));
  const peaks = new Array<number>(safeBars).fill(0);
  const samplesPerBar = Math.max(1, Math.floor(ch0.length / safeBars));
  let maxPeak = 1e-6;

  for (let b = 0; b < safeBars; b++) {
    const start = b * samplesPerBar;
    const end = Math.min(ch0.length, start + samplesPerBar);
    const step = Math.max(1, Math.floor((end - start) / 48));
    let peak = 0;
    for (let i = start; i < end; i += step) {
      const abs = Math.abs(ch0[i] ?? 0);
      if (abs > peak) peak = abs;
    }
    peaks[b] = peak;
    if (peak > maxPeak) maxPeak = peak;
  }

  for (let b = 0; b < safeBars; b++) {
    peaks[b] = Number((peaks[b] / maxPeak).toFixed(3));
  }
  return peaks;
}

export async function exportLyricsVideo(
  options: ExportOptions
): Promise<ExportResult> {
  const { project, audioBuffer, resolution, fps, mediaCache, signal, onProgress } = options;

  onProgress({
    phase: 'preparing',
    percent: 2,
    statusText: 'Checking browser video encoder capabilities...',
    etaSeconds: null,
  });

  await document.fonts.ready;
  const caps = await checkExportCapabilities();

  if (caps.recommendedMode === 'unsupported') {
    throw new Error(
      'This browser does not support WebCodecs H.264/AAC or MediaRecorder video capture.'
    );
  }

  const { width, height } = getResolutionForAspect(project.aspectRatio, resolution);
  const duration = Math.max(2, project.duration);

  if (caps.recommendedMode === 'webcodecs-mp4') {
    return exportViaWebCodecsMp4({
      project,
      audioBuffer,
      width,
      height,
      fps,
      duration,
      mediaCache,
      signal,
      onProgress,
    });
  }

  return exportViaMediaRecorder({
    project,
    audioBuffer,
    width,
    height,
    fps,
    duration,
    mimeType: caps.mediaRecorderMimeType!,
    extension: caps.mediaRecorderExtension!,
    mediaCache,
    signal,
    onProgress,
  });
}

async function exportViaWebCodecsMp4(params: {
  project: ProjectData;
  audioBuffer: AudioBuffer | null;
  width: number;
  height: number;
  fps: number;
  duration: number;
  mediaCache: MediaAssetCache;
  signal: AbortSignal;
  onProgress: (p: ExportProgress) => void;
}): Promise<ExportResult> {
  const {
    project,
    audioBuffer,
    width,
    height,
    fps,
    duration,
    mediaCache,
    signal,
    onProgress,
  } = params;

  onProgress({
    phase: 'preparing',
    percent: 4,
    statusText: 'Preparing Full HD background media & encoder...',
    etaSeconds: null,
  });

  const preparedVid = await prepareExportVideo(project, mediaCache);
  const exportWaveformPeaks = buildExportWaveformPeaks(audioBuffer);
  const exportHasAudio = Boolean(audioBuffer || project.audioFileName);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    preparedVid.cleanup();
    throw new Error('Unable to initialize 2D export canvas.');
  }

  const audioCfg = audioBuffer ? await pickSupportedAudioConfig() : null;
  if (audioBuffer && !audioCfg) {
    preparedVid.cleanup();
    throw new Error('No supported WebCodecs audio encoder found.');
  }

  const channels = 2;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width,
      height,
    },
    audio: audioCfg
      ? {
          codec: audioCfg.muxerCodec,
          numberOfChannels: channels,
          sampleRate: audioCfg.sampleRate,
        }
      : undefined,
    fastStart: 'in-memory',
  });

  let encoderError: unknown = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encoderError = err;
    },
  });

  const videoBitrate = height >= 1080 || width >= 1080 ? 10_000_000 : 5_500_000;
  const videoConfig = await pickSupportedVideoConfig(width, height, fps, videoBitrate);
  videoEncoder.configure(videoConfig);

  let audioEncoder: AudioEncoder | null = null;
  if (audioBuffer && audioCfg) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (err) => {
        encoderError = err;
      },
    });
    audioEncoder.configure({
      codec: audioCfg.encoderCodec,
      sampleRate: audioCfg.sampleRate,
      numberOfChannels: channels,
      bitrate: audioCfg.bitrate,
    });
  }

  const totalFrames = Math.max(1, Math.ceil(duration * fps));
  const startedAt = performance.now();

  try {
    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      if (encoderError) throw encoderError;
      if (signal.aborted) {
        throw new DOMException('Export cancelled by user', 'AbortError');
      }

      const t = frameIdx / fps;
      if (preparedVid.video) {
        await seekVideoPrecise(preparedVid.video, t);
      }

      renderVideoFrame(ctx, width, height, t, project, preparedVid.cache, {
        hasAudio: exportHasAudio,
        waveformPeaks: exportWaveformPeaks,
      });

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((frameIdx / fps) * 1_000_000),
        duration: Math.round((1 / fps) * 1_000_000),
      });

      videoEncoder.encode(frame, { keyFrame: frameIdx % fps === 0 });
      frame.close();

      // Smooth non-draining pipeline backpressure so keyframes never stall or stack
      while (videoEncoder.encodeQueueSize >= 8 && !signal.aborted && !encoderError) {
        await new Promise((r) => setTimeout(r, 4));
      }

      if (frameIdx % 4 === 0 || frameIdx === totalFrames - 1) {
        const elapsedSec = (performance.now() - startedAt) / 1000;
        const fraction = (frameIdx + 1) / totalFrames;
        const eta = fraction > 0.04 ? Math.max(0, elapsedSec / fraction - elapsedSec) : null;
        onProgress({
          phase: 'rendering',
          percent: Math.round(5 + fraction * 78),
          statusText: `Encoding video frame ${frameIdx + 1} of ${totalFrames} (${width}x${height} @ ${fps}fps)`,
          etaSeconds: eta !== null ? Math.ceil(eta) : null,
        });
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    if (audioBuffer && audioEncoder && audioCfg) {
      onProgress({
        phase: 'muxing',
        percent: 86,
        statusText: `Encoding stereo ${audioCfg.label} audio track...`,
        etaSeconds: 2,
      });

      const exportGain = Math.max(0, Math.min(2, project.audioVolume ?? 1));
      const sampleRate = audioCfg.sampleRate;
      const resampled = await resampleToStereo(
        audioBuffer,
        duration,
        sampleRate,
        exportGain
      );
      const left = resampled.getChannelData(0);
      const right = resampled.getChannelData(1);
      const chunkSamples = audioCfg.chunkSamples;
      const totalSamples = resampled.length;

      for (let offset = 0; offset < totalSamples; offset += chunkSamples) {
        if (encoderError) throw encoderError;
        if (signal.aborted) {
          throw new DOMException('Export cancelled by user', 'AbortError');
        }
        const len = Math.min(chunkSamples, totalSamples - offset);
        const planar = new Float32Array(len * 2);
        for (let i = 0; i < len; i++) {
          const l = left[offset + i] ?? 0;
          const r = right[offset + i] ?? 0;
          planar[i] = l > 1 ? 1 : l < -1 ? -1 : l;
          planar[len + i] = r > 1 ? 1 : r < -1 ? -1 : r;
        }

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: len,
          numberOfChannels: 2,
          timestamp: Math.round((offset / sampleRate) * 1_000_000),
          data: planar,
        });
        audioEncoder.encode(audioData);
        audioData.close();
      }
      await audioEncoder.flush();
      audioEncoder.close();
      audioEncoder = null;
    }

    onProgress({
      phase: 'muxing',
      percent: 96,
      statusText: 'Finalizing MP4 container...',
      etaSeconds: 1,
    });

    await videoEncoder.flush();
    videoEncoder.close();
    muxer.finalize();
  } catch (err) {
    try {
      if (videoEncoder.state !== 'closed') videoEncoder.close();
    } catch {}
    try {
      if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
    } catch {}
    throw err;
  } finally {
    preparedVid.cleanup();
  }

  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  const safeName = project.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'lyrics_video';

  onProgress({
    phase: 'complete',
    percent: 100,
    statusText: 'MP4 export complete.',
    etaSeconds: 0,
  });

  return {
    blob,
    filename: `${safeName}_${height}p.mp4`,
    mimeType: 'video/mp4',
    encoderUsed: `WebCodecs H.264${audioCfg ? ` + ${audioCfg.label}` : ''} (MP4)`,
  };
}

async function resampleToStereo(
  source: AudioBuffer,
  duration: number,
  targetRate: number,
  gain = 1
): Promise<AudioBuffer> {
  const frameCount = Math.ceil(duration * targetRate);
  const offline = new OfflineAudioContext(2, frameCount, targetRate);
  const srcNode = offline.createBufferSource();
  srcNode.buffer = source;
  const gainNode = offline.createGain();
  gainNode.gain.value = Math.max(0, Math.min(2, gain));
  srcNode.connect(gainNode);
  gainNode.connect(offline.destination);
  srcNode.start(0);
  return offline.startRendering();
}

async function exportViaMediaRecorder(params: {
  project: ProjectData;
  audioBuffer: AudioBuffer | null;
  width: number;
  height: number;
  fps: number;
  duration: number;
  mimeType: string;
  extension: 'mp4' | 'webm';
  mediaCache: MediaAssetCache;
  signal: AbortSignal;
  onProgress: (p: ExportProgress) => void;
}): Promise<ExportResult> {
  const {
    project,
    audioBuffer,
    width,
    height,
    fps,
    duration,
    mimeType,
    extension,
    mediaCache,
    signal,
    onProgress,
  } = params;

  const preparedVid = await prepareExportVideo(project, mediaCache);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    preparedVid.cleanup();
    throw new Error('Unable to initialize export canvas.');
  }

  const stream = canvas.captureStream(fps);
  let audioCtx: AudioContext | null = null;
  let sourceNode: AudioBufferSourceNode | null = null;

  if (audioBuffer) {
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = Math.max(0, Math.min(2, project.audioVolume ?? 1));

    sourceNode.connect(gainNode);
    gainNode.connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  }

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: height >= 1080 || width >= 1080 ? 8_500_000 : 4_500_000,
  });

  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };

  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
    recorder.onerror = () => reject(new Error('MediaRecorder encoding failed.'));
  });

  if (audioCtx && audioCtx.state === 'suspended') {
    await audioCtx.resume().catch(() => {});
  }
  recorder.start(250);
  const audioStartCtxTime = audioCtx ? audioCtx.currentTime : 0;
  sourceNode?.start(0);
  if (preparedVid.video) {
    preparedVid.video.currentTime = 0;
    void preparedVid.video.play().catch(() => {});
  }

  const exportWaveformPeaks = buildExportWaveformPeaks(audioBuffer);
  const exportHasAudio = Boolean(audioBuffer || project.audioFileName);
  const startMs = performance.now();
  let lastProgressMs = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      const step = () => {
        if (signal.aborted) {
          recorder.stop();
          sourceNode?.stop();
          void audioCtx?.close();
          reject(new DOMException('Export cancelled by user', 'AbortError'));
          return;
        }

        const elapsed = audioCtx
          ? Math.max(0, audioCtx.currentTime - audioStartCtxTime)
          : (performance.now() - startMs) / 1000;
        const t = Math.min(duration, elapsed);
        renderVideoFrame(ctx, width, height, t, project, preparedVid.cache, {
          hasAudio: exportHasAudio,
          waveformPeaks: exportWaveformPeaks,
        });

        const nowMs = performance.now();
        if (nowMs - lastProgressMs >= 200 || elapsed >= duration) {
          lastProgressMs = nowMs;
          const pct = Math.min(98, Math.round(4 + (t / duration) * 94));
          onProgress({
            phase: 'rendering',
            percent: pct,
            statusText: `Recording stream (${t.toFixed(1)}s / ${duration.toFixed(1)}s)`,
            etaSeconds: Math.max(0, Math.ceil(duration - t)),
          });
        }

        if (elapsed >= duration) {
          sourceNode?.stop();
          recorder.stop();
          void audioCtx?.close();
          resolve();
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  } finally {
    preparedVid.cleanup();
  }

  const blob = await stopped;
  const safeName = project.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'lyrics_video';

  onProgress({
    phase: 'complete',
    percent: 100,
    statusText: `${extension.toUpperCase()} export complete.`,
    etaSeconds: 0,
  });

  return {
    blob,
    filename: `${safeName}_${height}p.${extension}`,
    mimeType,
    encoderUsed: `Browser MediaRecorder (${mimeType})`,
  };
}
