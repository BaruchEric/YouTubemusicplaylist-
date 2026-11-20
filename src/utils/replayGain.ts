export type ReplayGainMode = 'off' | 'track' | 'album';

export type ReplayGainTargetLufs = -14 | -16 | -18;

export interface TrackLoudnessData {
  integratedLufs: number;
  peak: number;
  analyzedAt: number;
  album?: string;
}

export interface AppliedReplayGainInfo {
  measuredLufs: number;
  peak: number;
  rawGainDb: number;
  appliedGainDb: number;
  linearGain: number;
  clippingPrevented: boolean;
  scope: 'track' | 'album';
  albumTrackCount: number;
}

export interface LoudnessScanProgress {
  processed: number;
  total: number;
  currentTitle?: string;
}

export interface ReplayGainSettings {
  mode: ReplayGainMode;
  targetLufs: ReplayGainTargetLufs;
  preampDb: number;
  preventClipping: boolean;
}

const CACHE_STORAGE_KEY = 'cratesync_replaygain_cache_v1';
const SETTINGS_STORAGE_KEY = 'cratesync_replaygain_settings_v1';
const MAX_CACHE_ENTRIES = 600;

export const DEFAULT_REPLAYGAIN_SETTINGS: ReplayGainSettings = {
  mode: 'track',
  targetLufs: -14,
  preampDb: 0,
  preventClipping: true,
};

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function dbToLinear(db: number): number {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

export function linearToDb(linear: number): number {
  if (!Number.isFinite(linear) || linear <= 1e-6) return -120;
  return 20 * Math.log10(linear);
}

export function formatGainDb(db: number): string {
  if (!Number.isFinite(db) || Math.abs(db) < 0.05) return '0.0 dB';
  const sign = db > 0 ? '+' : '';
  return `${sign}${db.toFixed(1)} dB`;
}

export function formatLufs(lufs: number): string {
  if (!Number.isFinite(lufs)) return '— LUFS';
  return `${lufs.toFixed(1)} LUFS`;
}

export function loadReplayGainSettings(): ReplayGainSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_REPLAYGAIN_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ReplayGainSettings>;
    const mode: ReplayGainMode =
      parsed.mode === 'off' || parsed.mode === 'track' || parsed.mode === 'album'
        ? parsed.mode
        : DEFAULT_REPLAYGAIN_SETTINGS.mode;
    const targetLufs: ReplayGainTargetLufs =
      parsed.targetLufs === -14 || parsed.targetLufs === -16 || parsed.targetLufs === -18
        ? parsed.targetLufs
        : DEFAULT_REPLAYGAIN_SETTINGS.targetLufs;
    const preampDb =
      typeof parsed.preampDb === 'number' && Number.isFinite(parsed.preampDb)
        ? clampNumber(Math.round(parsed.preampDb * 2) / 2, -6, 6)
        : DEFAULT_REPLAYGAIN_SETTINGS.preampDb;
    const preventClipping =
      typeof parsed.preventClipping === 'boolean'
        ? parsed.preventClipping
        : DEFAULT_REPLAYGAIN_SETTINGS.preventClipping;

    return { mode, targetLufs, preampDb, preventClipping };
  } catch {
    return { ...DEFAULT_REPLAYGAIN_SETTINGS };
  }
}

export function saveReplayGainSettings(settings: ReplayGainSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadLoudnessCache(): Record<string, TrackLoudnessData> {
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TrackLoudnessData>;
    if (!parsed || typeof parsed !== 'object') return {};

    const clean: Record<string, TrackLoudnessData> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (
        val &&
        typeof val.integratedLufs === 'number' &&
        Number.isFinite(val.integratedLufs) &&
        typeof val.peak === 'number' &&
        Number.isFinite(val.peak)
      ) {
        clean[key] = {
          integratedLufs: clampNumber(val.integratedLufs, -50, -1),
          peak: clampNumber(val.peak, 0.001, 4),
          analyzedAt: typeof val.analyzedAt === 'number' ? val.analyzedAt : Date.now(),
          album: typeof val.album === 'string' ? val.album : undefined,
        };
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export function saveLoudnessCache(cache: Record<string, TrackLoudnessData>): void {
  try {
    const entries = Object.entries(cache);
    let toPersist = cache;
    if (entries.length > MAX_CACHE_ENTRIES) {
      entries.sort((a, b) => (b[1].analyzedAt || 0) - (a[1].analyzedAt || 0));
      toPersist = Object.fromEntries(entries.slice(0, MAX_CACHE_ENTRIES));
    }
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(toPersist));
  } catch {
    // Ignore storage quota errors
  }
}

function normalizeAlbumKey(album?: string): string {
  if (!album) return '';
  const trimmed = album.trim().toLowerCase();
  if (!trimmed || trimmed === 'unknown album' || trimmed === 'unknown' || trimmed === 'singles') {
    return '';
  }
  return trimmed;
}

/**
 * Extracts a bounded AudioBuffer for loudness analysis.
 * For standard tracks (<= 4 min), analyzes the entire track.
 * For very long tracks (> 4 min), samples 3 evenly spaced 60s windows
 * to keep Web Audio decoding & K-weighting fast and memory-safe.
 */
function buildAnalysisBuffer(source: AudioBuffer): AudioBuffer {
  const maxFullDurationSec = 240;
  if (source.duration <= maxFullDurationSec) {
    return source;
  }

  const sampleRate = source.sampleRate;
  const numChannels = Math.min(source.numberOfChannels, 2);
  const windowSamples = Math.floor(60 * sampleRate);
  const windowStarts = [
    Math.floor(source.length * 0.1),
    Math.floor(source.length * 0.45),
    Math.max(0, Math.floor(source.length * 0.78) - windowSamples),
  ];

  const totalSamples = windowSamples * windowStarts.length;
  const sliced = new AudioBuffer({
    numberOfChannels: numChannels,
    length: totalSamples,
    sampleRate,
  });

  for (let ch = 0; ch < numChannels; ch++) {
    const srcData = source.getChannelData(ch);
    const dstData = sliced.getChannelData(ch);
    let offset = 0;
    for (const start of windowStarts) {
      const safeStart = Math.max(0, Math.min(start, Math.max(0, srcData.length - windowSamples)));
      const end = Math.min(srcData.length, safeStart + windowSamples);
      const sub = srcData.subarray(safeStart, end);
      dstData.set(sub, offset);
      offset += sub.length;
    }
  }

  return sliced;
}

/**
 * Measures integrated loudness (LUFS) using ITU-R BS.1770 K-weighting
 * and gated 400ms blocks (75% overlap), plus sample peak amplitude.
 */
export async function analyzeAudioBlobLoudness(
  blob: Blob,
  album?: string,
  sharedContext?: BaseAudioContext | null
): Promise<TrackLoudnessData> {
  const arrayBuffer = await blob.arrayBuffer();

  // Decode using provided AudioContext or a lightweight OfflineAudioContext
  // (avoids allocating extra hardware AudioContexts that hit browser caps)
  const OfflineCtx =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;

  if (!OfflineCtx) {
    throw new Error('Web Audio OfflineAudioContext is not supported in this browser.');
  }

  const decoderCtx: BaseAudioContext = sharedContext || new OfflineCtx(1, 1, 44100);
  // Slice buffer copy so decodeAudioData detaching the ArrayBuffer is always safe
  const decoded = await decoderCtx.decodeAudioData(arrayBuffer.slice(0));

  // 1. Measure raw sample peak across full decoded audio (pre-K-weighting)
  let peak = 0;
  const channelCount = decoded.numberOfChannels;
  for (let ch = 0; ch < channelCount; ch++) {
    const data = decoded.getChannelData(ch);
    // Stride by 1 for exact peak
    for (let i = 0; i < data.length; i++) {
      const absVal = Math.abs(data[i]);
      if (absVal > peak) peak = absVal;
    }
  }

  // 2. Apply ITU-R BS.1770 K-weighting via OfflineAudioContext
  const analysisBuffer = buildAnalysisBuffer(decoded);
  const kChannels = Math.min(analysisBuffer.numberOfChannels, 6);
  const offline = new OfflineCtx(kChannels, analysisBuffer.length, analysisBuffer.sampleRate);

  const bufferSource = offline.createBufferSource();
  bufferSource.buffer = analysisBuffer;

  // Stage 1: Acoustic head-effect shelving filter (+4 dB high-shelf @ 1500 Hz)
  const preFilter = offline.createBiquadFilter();
  preFilter.type = 'highshelf';
  preFilter.frequency.value = 1500;
  preFilter.gain.value = 4.0;
  preFilter.Q.value = 0.7071;

  // Stage 2: RLB weighting high-pass filter (38 Hz)
  const rlbFilter = offline.createBiquadFilter();
  rlbFilter.type = 'highpass';
  rlbFilter.frequency.value = 38;
  rlbFilter.Q.value = 0.5;

  bufferSource.connect(preFilter);
  preFilter.connect(rlbFilter);
  rlbFilter.connect(offline.destination);
  bufferSource.start(0);

  const filtered = await offline.startRendering();

  // 3. Compute BS.1770 gated integrated loudness over 400ms blocks with 100ms hop
  const sr = filtered.sampleRate;
  const blockSize = Math.max(1, Math.round(sr * 0.4));
  const hopSize = Math.max(1, Math.round(sr * 0.1));
  const totalSamples = filtered.length;

  const channelData: Float32Array[] = [];
  const channelWeights: number[] = [];
  for (let ch = 0; ch < filtered.numberOfChannels; ch++) {
    channelData.push(filtered.getChannelData(ch));
    // Standard BS.1770 weights: L/R/C = 1.0, LFE (idx 3 in 5.1) = 0, Surrounds = 1.41
    if (filtered.numberOfChannels >= 6 && ch === 3) {
      channelWeights.push(0);
    } else if (ch >= 3) {
      channelWeights.push(1.41);
    } else {
      channelWeights.push(1.0);
    }
  }

  const blockEnergies: number[] = [];
  const blockLoudnesses: number[] = [];

  if (totalSamples < blockSize) {
    // Very short clip (< 400ms): compute single block
    let energySum = 0;
    for (let ch = 0; ch < channelData.length; ch++) {
      const weight = channelWeights[ch];
      if (weight === 0) continue;
      const samples = channelData[ch];
      let sq = 0;
      for (let i = 0; i < samples.length; i++) {
        sq += samples[i] * samples[i];
      }
      energySum += weight * (sq / Math.max(1, samples.length));
    }
    if (energySum > 1e-10) {
      blockEnergies.push(energySum);
      blockLoudnesses.push(-0.691 + 10 * Math.log10(energySum));
    }
  } else {
    for (let start = 0; start + blockSize <= totalSamples; start += hopSize) {
      let energySum = 0;
      const end = start + blockSize;
      for (let ch = 0; ch < channelData.length; ch++) {
        const weight = channelWeights[ch];
        if (weight === 0) continue;
        const samples = channelData[ch];
        let sq = 0;
        for (let i = start; i < end; i++) {
          const s = samples[i];
          sq += s * s;
        }
        energySum += weight * (sq / blockSize);
      }

      if (energySum > 1e-10) {
        const blockLufs = -0.691 + 10 * Math.log10(energySum);
        // Step 1: Absolute gate at -70 LUFS
        if (blockLufs > -70) {
          blockEnergies.push(energySum);
          blockLoudnesses.push(blockLufs);
        }
      }
    }
  }

  let integratedLufs = -23.0; // Fallback for near-silent files
  if (blockEnergies.length > 0) {
    let absSum = 0;
    for (let i = 0; i < blockEnergies.length; i++) {
      absSum += blockEnergies[i];
    }
    const absMeanEnergy = absSum / blockEnergies.length;
    const relativeThreshold = -0.691 + 10 * Math.log10(absMeanEnergy) - 10;

    // Step 2: Relative gate (-10 LU below ungated average)
    let relSum = 0;
    let relCount = 0;
    for (let i = 0; i < blockEnergies.length; i++) {
      if (blockLoudnesses[i] > relativeThreshold) {
        relSum += blockEnergies[i];
        relCount++;
      }
    }

    const finalEnergy = relCount > 0 ? relSum / relCount : absMeanEnergy;
    integratedLufs = -0.691 + 10 * Math.log10(Math.max(1e-10, finalEnergy));
  }

  return {
    integratedLufs: clampNumber(Math.round(integratedLufs * 10) / 10, -50, -1),
    peak: clampNumber(Math.round(peak * 1000) / 1000, 0.001, 4),
    analyzedAt: Date.now(),
    album: album?.trim() || undefined,
  };
}

export function computeReplayGainAdjustment(params: {
  trackKey: string;
  trackAlbum?: string;
  cache: Record<string, TrackLoudnessData>;
  mode: ReplayGainMode;
  targetLufs: ReplayGainTargetLufs;
  preampDb: number;
  preventClipping: boolean;
  libraryAlbumLookup?: Map<string, string>;
}): AppliedReplayGainInfo | null {
  const {
    trackKey,
    trackAlbum,
    cache,
    mode,
    targetLufs,
    preampDb,
    preventClipping,
    libraryAlbumLookup,
  } = params;

  if (mode === 'off') return null;

  const entry = cache[trackKey];
  if (!entry) return null;

  let measuredLufs = entry.integratedLufs;
  let peak = entry.peak;
  let scope: 'track' | 'album' = 'track';
  let albumTrackCount = 1;

  if (mode === 'album') {
    const albumKey = normalizeAlbumKey(trackAlbum || entry.album);
    if (albumKey) {
      const albumEntries: TrackLoudnessData[] = [];
      for (const [key, item] of Object.entries(cache)) {
        const itemAlbum = normalizeAlbumKey(libraryAlbumLookup?.get(key) || item.album);
        if (itemAlbum === albumKey) {
          albumEntries.push(item);
        }
      }

      if (albumEntries.length >= 2) {
        // Average loudness in linear power domain per EBU R128 album loudness
        let powerSum = 0;
        let maxPeak = 0;
        for (const item of albumEntries) {
          powerSum += Math.pow(10, (item.integratedLufs + 0.691) / 10);
          if (item.peak > maxPeak) maxPeak = item.peak;
        }
        const avgPower = powerSum / albumEntries.length;
        measuredLufs = clampNumber(
          Math.round((-0.691 + 10 * Math.log10(Math.max(1e-10, avgPower))) * 10) / 10,
          -50,
          -1
        );
        peak = maxPeak;
        scope = 'album';
        albumTrackCount = albumEntries.length;
      }
    }
  }

  const rawGainDb = clampNumber(targetLufs - measuredLufs + preampDb, -18, 12);
  let linearGain = dbToLinear(rawGainDb);
  let clippingPrevented = false;

  if (preventClipping && peak > 0.001) {
    const maxSafeLinear = 0.98 / peak;
    if (linearGain > maxSafeLinear) {
      linearGain = maxSafeLinear;
      clippingPrevented = true;
    }
  }

  // Final hard safety cap (~ +12 dB max, -24 dB min)
  linearGain = clampNumber(linearGain, 0.06, 4.0);
  const appliedGainDb = Math.round(linearToDb(linearGain) * 10) / 10;

  return {
    measuredLufs,
    peak,
    rawGainDb: Math.round(rawGainDb * 10) / 10,
    appliedGainDb,
    linearGain,
    clippingPrevented,
    scope,
    albumTrackCount,
  };
}
