// src/lib/radioAudio.ts — Web Audio API synthesizer for radio sounds & mic metering

let audioCtx: AudioContext | null = null;

/**
 * Get or create the global AudioContext.
 * Must be called from a user gesture the first time on iOS/Android.
 */
export function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Play a synthesized TX chirp — a high-pitched 1200 Hz burst for 70ms
 * with a quick harmonic kick to simulate a Motorola/Kenwood radio key-up tone.
 */
export function playTxChirp(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Primary 1200 Hz tone
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(1250, now + 0.04);
    osc.frequency.setValueAtTime(1200, now + 0.05);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.08);

    // Second harmonic chirp (2400 Hz) for authentic radio crispness
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(2400, now);
    gain2.gain.setValueAtTime(0.08, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc2.start(now);
    osc2.stop(now + 0.07);
  } catch (err) {
    console.warn('TX chirp error:', err);
  }
}

/**
 * Play an RX roger beep & authentic squelch tail on unkey.
 * Combines a white-noise squelch burst (bandpass filtered)
 * with a classic descending 880→440 Hz cutoff tone.
 */
export function playRxRoger(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // 1. White noise burst (simulating radio channel squelch tail)
    const bufferSize = Math.floor(ctx.sampleRate * 0.09); // 90ms of noise
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    // Bandpass filter centered at 1800 Hz to simulate radio speaker characteristics
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, now);
    filter.Q.setValueAtTime(1.5, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.25, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

    whiteNoise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    whiteNoise.start(now);
    whiteNoise.stop(now + 0.09);

    // 2. Roger tone (descending 880 -> 440 Hz)
    const osc = ctx.createOscillator();
    const toneGain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now + 0.03);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.12);

    toneGain.gain.setValueAtTime(0.001, now);
    toneGain.gain.setValueAtTime(0.2, now + 0.03);
    toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(toneGain);
    toneGain.connect(ctx.destination);

    osc.start(now + 0.03);
    osc.stop(now + 0.13);
  } catch (err) {
    console.warn('RX roger error:', err);
  }
}

/**
 * Play a quick-ping chime — distinct high-clarity two-tone alerts for status pings.
 * Each ping type gets a distinct frequency pair designed to be audible over road noise.
 */
export function playPingChime(
  type: 'gas' | 'traffic' | 'pullover' | 'allclear'
): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const freqMap: Record<string, [number, number]> = {
      gas: [587, 880], // D5 -> A5 (upbeat alert)
      traffic: [466, 370], // Bb4 -> F#4 (descending urgent hazard)
      pullover: [440, 523], // A4 -> C5 (steady notice)
      allclear: [523, 1046], // C5 -> C6 (bright clear chime)
    };

    const [f1, f2] = freqMap[type] || [587, 880];

    // First tone (140ms)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(f1, now);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.15);

    // Second tone (180ms, starts at +130ms)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(f2, now + 0.13);
    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.setValueAtTime(0.35, now + 0.13);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.13);
    osc2.stop(now + 0.33);
  } catch (err) {
    console.warn('Ping chime error:', err);
  }
}

/**
 * Create an AnalyserNode connected to a MediaStream for live mic volume metering.
 * Returns the analyser and a cleanup function.
 */
export function createMicAnalyser(stream: MediaStream): {
  analyser: AnalyserNode;
  cleanup: () => void;
} {
  const ctx = getAudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.4;
  source.connect(analyser);

  return {
    analyser,
    cleanup: () => {
      try {
        source.disconnect();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Get current RMS volume level from an AnalyserNode (normalized 0 to 1 range).
 */
export function getRmsLevel(analyser: AnalyserNode): number {
  try {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    // Road/vehicle noise threshold: filter tiny noise < 0.02, scale speech up to 1
    if (rms < 0.02) return 0;
    return Math.min(1, Math.max(0, (rms - 0.02) * 4));
  } catch {
    return 0;
  }
}
