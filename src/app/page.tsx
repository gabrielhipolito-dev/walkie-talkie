// src/app/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useConvoyRadio, type PingType } from '@/hooks/useConvoyRadio';
import { haversineDistance, formatDistance, type GeoPosition } from '@/lib/geo';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getAudioContext } from '@/lib/radioAudio';

const ConvoyMap = dynamic(() => import('@/components/ConvoyMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full min-h-[240px] flex flex-col items-center justify-center bg-zinc-950 rounded-2xl border border-zinc-800 p-6 text-center">
      <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mb-3">
        <svg
          className="animate-spin h-5 w-5 text-cyan-400"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
            className="opacity-25"
          />
          <path
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            className="opacity-75"
          />
        </svg>
      </div>
      <span className="text-white font-mono font-bold text-sm">
        INITIALIZING DARK MATTER CONVOY MAP
      </span>
      <span className="text-zinc-500 text-xs font-mono mt-1">
        Loading CartoDB vector tiles &amp; GPS layers…
      </span>
    </div>
  ),
});

// SHA-256 hash helper for secure room name derivation
async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Connection Status Badge Styles ─────────────────────────────
function statusBadgeStyle(status: string): {
  bg: string;
  text: string;
  dot: string;
} {
  switch (status) {
    case 'Connected P2P':
      return {
        bg: 'bg-emerald-500/15 border-emerald-500/30',
        text: 'text-emerald-400',
        dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
      };
    case 'Relayed via TURN':
      return {
        bg: 'bg-amber-500/15 border-amber-500/30',
        text: 'text-amber-400',
        dot: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]',
      };
    case 'Reconnecting':
      return {
        bg: 'bg-rose-500/15 border-rose-500/30',
        text: 'text-rose-400',
        dot: 'bg-rose-400 animate-pulse shadow-[0_0_8px_rgba(251,113,133,0.8)]',
      };
    default:
      return {
        bg: 'bg-zinc-800/80 border-zinc-700/60',
        text: 'text-zinc-400',
        dot: 'bg-zinc-400 animate-ping',
      };
  }
}

// ─── Quick-Ping Definitions ─────────────────────────────────────
const PING_ITEMS: Record<
  PingType,
  { label: string; emoji: string; buttonBg: string; bannerBg: string }
> = {
  gas: {
    label: 'Gas Stop',
    emoji: '⛽',
    buttonBg: 'bg-amber-600 hover:bg-amber-500 active:bg-amber-400 border-amber-500/40',
    bannerBg: 'bg-amber-600 border-amber-400',
  },
  traffic: {
    label: 'Traffic / Checkpoint',
    emoji: '🚧',
    buttonBg: 'bg-red-700 hover:bg-red-600 active:bg-red-500 border-red-500/40',
    bannerBg: 'bg-red-700 border-red-400',
  },
  pullover: {
    label: 'Pull Over',
    emoji: '🅿️',
    buttonBg: 'bg-blue-700 hover:bg-blue-600 active:bg-blue-500 border-blue-500/40',
    bannerBg: 'bg-blue-700 border-blue-400',
  },
  allclear: {
    label: 'All Clear',
    emoji: '✅',
    buttonBg: 'bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-500 border-emerald-500/40',
    bannerBg: 'bg-emerald-700 border-emerald-400',
  },
};

// ─── Lobby Component ────────────────────────────────────────────
function Lobby({
  onConnect,
  onLaunchDemo,
}: {
  onConnect: (callsign: string, channelName: string) => void;
  onLaunchDemo: () => void;
}) {
  const [callsign, setCallsign] = useState('Car 1');
  const [roomCode, setRoomCode] = useState('convoy-alpha');
  const [pin, setPin] = useState('7788');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In-App TURN Server Configuration
  const [showTurnSettings, setShowTurnSettings] = useState(false);
  const [turnUrlInput, setTurnUrlInput] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        return (
          localStorage.getItem('convoy_turn_url') ||
          process.env.NEXT_PUBLIC_TURN_URL ||
          ''
        );
      } catch {
        // ignore
      }
    }
    return process.env.NEXT_PUBLIC_TURN_URL || '';
  });
  const [turnUserInput, setTurnUserInput] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        return (
          localStorage.getItem('convoy_turn_user') ||
          process.env.NEXT_PUBLIC_TURN_USERNAME ||
          ''
        );
      } catch {
        // ignore
      }
    }
    return process.env.NEXT_PUBLIC_TURN_USERNAME || '';
  });
  const [turnCredInput, setTurnCredInput] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        return (
          localStorage.getItem('convoy_turn_cred') ||
          process.env.NEXT_PUBLIC_TURN_CREDENTIAL ||
          ''
        );
      } catch {
        // ignore
      }
    }
    return process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '';
  });
  const [turnSavedNotice, setTurnSavedNotice] = useState(false);

  const handleSaveTurn = () => {
    try {
      if (turnUrlInput.trim()) {
        localStorage.setItem('convoy_turn_url', turnUrlInput.trim());
      } else {
        localStorage.removeItem('convoy_turn_url');
      }
      if (turnUserInput.trim()) {
        localStorage.setItem('convoy_turn_user', turnUserInput.trim());
      } else {
        localStorage.removeItem('convoy_turn_user');
      }
      if (turnCredInput.trim()) {
        localStorage.setItem('convoy_turn_cred', turnCredInput.trim());
      } else {
        localStorage.removeItem('convoy_turn_cred');
      }
      setTurnSavedNotice(true);
      setTimeout(() => {
        setTurnSavedNotice(false);
        setShowTurnSettings(false);
      }, 1000);
    } catch {
      // ignore
    }
  };

  const handleConnectClick = async () => {
    if (!callsign.trim()) {
      setError('Please enter your vehicle Callsign.');
      return;
    }
    if (!roomCode.trim()) {
      setError('Please enter a Room Code.');
      return;
    }
    if (pin.length !== 4) {
      setError('Please enter a 4-digit security PIN.');
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      // 1. Mobile gesture requirement 1: Unlock/resume global AudioContext
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }

      // 2. Mobile gesture requirement 2: Request microphone permission
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        await navigator.mediaDevices
          .getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          })
          .catch((err) => {
            console.warn('Microphone permission check:', err.message);
          });
      }

      // 3. Mobile gesture requirement 3: Request geolocation permission
      if ('geolocation' in navigator) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            () => resolve(),
            () => resolve(),
            { timeout: 3000 }
          );
        });
      }

      // 4. Mobile gesture requirement 4: Screen Wake Lock
      if ('wakeLock' in navigator) {
        await navigator.wakeLock.request('screen').catch(() => {});
      }

      // Derive secure channel name from SHA-256(roomCode:pin)
      const secret = `${roomCode.trim().toLowerCase()}:${pin.trim()}`;
      const hash = await sha256(secret);
      const derivedChannel = `convoy-${hash.slice(0, 16)}`;

      onConnect(callsign.trim(), derivedChannel);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      setError(msg);
      setConnecting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-zinc-950 flex flex-col items-center justify-center p-4 select-none">
      <div className="w-full max-w-sm space-y-4">
        {/* Header / Branding */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 mb-1 shadow-[0_0_20px_rgba(34,211,238,0.25)]">
            <svg
              className="w-8 h-8 text-cyan-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight uppercase">
            Convoy PTT
          </h1>
          <p className="text-xs text-zinc-400">
            Push-to-Talk Walkie-Talkie &amp; Live Convoy Radar
          </p>
        </div>

        {/* Feature Capabilities Pill Card */}
        <div className="bg-zinc-900/80 p-3.5 rounded-2xl border border-zinc-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="text-base">🗺️</span>
              <span className="font-bold text-white">Live Dark Matter Convoy Map</span>
            </div>
            <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded-md">
              INCLUDED
            </span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Realtime GPS car tracking, Haversine vehicle distance, CartoDB dark tiles, and Low-Data Radar view.
          </p>
        </div>

        {/* Configuration Notice */}
        {!isSupabaseConfigured && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300 space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <span>⚠️</span>
              <span>Supabase Keys Pending</span>
            </div>
            <p className="text-[11px] text-amber-300/80 leading-relaxed">
              Add your keys to <code className="bg-amber-950 px-1 py-0.5 rounded text-white font-mono">.env.local</code> for multi-device sync, or use the Instant Map Demo below!
            </p>
          </div>
        )}

        {/* Form Fields */}
        <div className="space-y-3 bg-zinc-900/60 p-4.5 rounded-2xl border border-zinc-800 shadow-xl">
          <div>
            <label className="block text-[11px] font-mono font-bold text-zinc-400 mb-1 uppercase tracking-wider">
              Vehicle Callsign
            </label>
            <input
              type="text"
              placeholder="e.g. Lead Car, Car 1"
              value={callsign}
              onChange={(e) => setCallsign(e.target.value)}
              maxLength={24}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition font-medium text-sm"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono font-bold text-zinc-400 mb-1 uppercase tracking-wider">
              Convoy Room Code
            </label>
            <input
              type="text"
              placeholder="e.g. desert-run-2026"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              maxLength={32}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition font-medium text-sm"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono font-bold text-zinc-400 mb-1 uppercase tracking-wider">
              4-Digit Security PIN
            </label>
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]{4}"
              placeholder="••••"
              value={pin}
              onChange={(e) => {
                const clean = e.target.value.replace(/\D/g, '').slice(0, 4);
                setPin(clean);
              }}
              maxLength={4}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white text-center text-xl tracking-[0.4em] placeholder-zinc-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition font-mono font-bold"
            />
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs text-center font-medium">
            {error}
          </div>
        )}

        {/* Buttons: Primary Connect + Instant Demo + TURN Settings */}
        <div className="space-y-2.5">
          <button
            onClick={handleConnectClick}
            disabled={connecting}
            className="w-full bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-400 disabled:bg-zinc-800 text-white font-bold py-3.5 rounded-xl transition-all text-sm tracking-wider uppercase shadow-[0_0_20px_rgba(6,182,212,0.35)] flex items-center justify-center gap-2 cursor-pointer"
          >
            {connecting ? (
              <>
                <svg
                  className="animate-spin h-4 w-4 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    className="opacity-25"
                  />
                  <path
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    className="opacity-75"
                  />
                </svg>
                <span>Connecting Radio &amp; GPS…</span>
              </>
            ) : (
              <>
                <span>🛰️</span>
                <span>Connect to Convoy</span>
              </>
            )}
          </button>

          <button
            onClick={onLaunchDemo}
            className="w-full bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-700 border border-zinc-700 text-zinc-200 font-bold py-2.5 rounded-xl transition-all text-xs tracking-wider uppercase flex items-center justify-center gap-2 cursor-pointer shadow-md"
          >
            <span>🗺️</span>
            <span>Instant Map &amp; Audio Demo</span>
          </button>

          <div className="text-center pt-1">
            <button
              onClick={() => setShowTurnSettings(true)}
              className="text-xs font-mono text-zinc-400 hover:text-cyan-400 underline underline-offset-4 transition cursor-pointer"
            >
              ⚙️ Cellular TURN Relay Settings
            </button>
          </div>
        </div>

        {/* Footnote */}
        <p className="text-[10px] text-zinc-500 text-center leading-relaxed">
          Initializes Web Audio, Mic, GPS Telemetry &amp; Screen Wake Lock.
          <br />
          Private SHA-256 room channel · Strict 2-car convoy limit.
        </p>

        {/* ── TURN Settings Modal ── */}
        {showTurnSettings && (
          <div className="fixed inset-0 z-50 bg-zinc-950/90 backdrop-blur-md flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">📡</span>
                  <h3 className="text-sm font-bold text-white uppercase font-mono">
                    Cellular TURN Relay
                  </h3>
                </div>
                <button
                  onClick={() => setShowTurnSettings(false)}
                  className="text-zinc-500 hover:text-white text-xs font-mono px-2 py-1 rounded cursor-pointer"
                >
                  ✕ CLOSE
                </button>
              </div>

              <p className="text-xs text-zinc-400 leading-relaxed">
                TURN relays voice packets over rural 4G/5G when mobile carriers (Verizon, T-Mobile, AT&amp;T) block direct peer-to-peer UDP connections (Symmetric CGNAT).
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-mono text-zinc-400 mb-1 uppercase">
                    TURN Server URL
                  </label>
                  <input
                    type="text"
                    placeholder="turn:standard.relay.metered.ca:443"
                    value={turnUrlInput}
                    onChange={(e) => setTurnUrlInput(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-700 font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-zinc-400 mb-1 uppercase">
                    TURN Username
                  </label>
                  <input
                    type="text"
                    placeholder="your-metered-username"
                    value={turnUserInput}
                    onChange={(e) => setTurnUserInput(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-700 font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-zinc-400 mb-1 uppercase">
                    TURN Password / Credential
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••••••"
                    value={turnCredInput}
                    onChange={(e) => setTurnCredInput(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-700 font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="pt-1 flex items-center justify-between text-[11px]">
                <a
                  href="https://www.metered.ca/tools/openrelay/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 hover:underline flex items-center gap-1"
                >
                  <span>Free 50GB at Metered.ca ↗</span>
                </a>

                {turnSavedNotice && (
                  <span className="text-emerald-400 font-bold font-mono">
                    ✓ SAVED!
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleSaveTurn}
                  className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2.5 rounded-xl text-xs uppercase tracking-wider transition cursor-pointer"
                >
                  Save Credentials
                </button>
                <button
                  onClick={() => {
                    setTurnUrlInput('');
                    setTurnUserInput('');
                    setTurnCredInput('');
                    try {
                      localStorage.removeItem('convoy_turn_url');
                      localStorage.removeItem('convoy_turn_user');
                      localStorage.removeItem('convoy_turn_cred');
                    } catch {}
                    setTurnSavedNotice(true);
                    setTimeout(() => setTurnSavedNotice(false), 1200);
                  }}
                  className="px-3 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white rounded-xl text-xs font-mono transition cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard Component ────────────────────────────────────────
function Dashboard({
  callsign,
  channelName,
  isDemoMode = false,
  onDisconnect,
}: {
  callsign: string;
  channelName: string;
  isDemoMode?: boolean;
  onDisconnect: () => void;
}) {
  const radio = useConvoyRadio({ callsign, channelName });
  const pttRef = useRef<HTMLButtonElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Simulated peer car telemetry for Demo mode
  const [demoPeerPos, setDemoPeerPos] = useState<GeoPosition | null>(() => {
    if (!isDemoMode) return null;
    return {
      lat: 34.0522 + 0.0035,
      lng: -118.2437 + 0.0028,
      speedKmh: 82,
      heading: 42,
      updatedAt: 0,
    };
  });

  // Initialize real radio link if not in demo mode
  useEffect(() => {
    if (isDemoMode) {
      // Initialize Web Audio for local sound testing in Demo mode
      getAudioContext();

      // Gradually update simulated car position to demonstrate live tracking
      const interval = setInterval(() => {
        setDemoPeerPos((prev) => {
          if (!prev) return null;
          const deltaLat = (Math.random() - 0.45) * 0.0004;
          const deltaLng = (Math.random() - 0.45) * 0.0004;
          const speed = Math.round(75 + Math.random() * 18);
          return {
            lat: prev.lat + deltaLat,
            lng: prev.lng + deltaLng,
            speedKmh: speed,
            heading: (prev.heading + Math.round((Math.random() - 0.5) * 8) + 360) % 360,
            updatedAt: Date.now(),
          };
        });
      }, 2500);

      return () => clearInterval(interval);
    }

    let unmounted = false;
    radio.initialize().then((cleanup) => {
      if (unmounted) {
        cleanup();
      } else {
        cleanupRef.current = cleanup;
      }
    });

    return () => {
      unmounted = true;
      cleanupRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemoMode]);

  // Desktop Spacebar PTT test support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !radio.isTransmitting) {
        e.preventDefault();
        radio.startTransmitting();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        radio.stopTransmitting();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [radio]);

  // Touch & Pointer Capture handlers for mobile
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      try {
        pttRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // Safe fallback
      }
      radio.startTransmitting();
    },
    [radio]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      try {
        pttRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // Safe fallback
      }
      radio.stopTransmitting();
    },
    [radio]
  );

  // Resolve active telemetry (real or demo)
  const activeLocalPos = useMemo(() => {
    if (radio.localPosition) return radio.localPosition;
    if (isDemoMode) {
      return {
        lat: 34.0522,
        lng: -118.2437,
        speedKmh: 78,
        heading: 40,
        updatedAt: 0,
      };
    }
    return null;
  }, [radio.localPosition, isDemoMode]);

  const activePeerPos = useMemo(() => {
    if (isDemoMode) return demoPeerPos;
    return radio.peerPosition;
  }, [isDemoMode, demoPeerPos, radio.peerPosition]);

  const effectivePeerCallsign = isDemoMode
    ? 'Car 2 (Convoy Lead)'
    : radio.peerCallsign;

  // Real-time distance calculation
  const distance = useMemo(() => {
    if (activeLocalPos && activePeerPos) {
      return haversineDistance(
        activeLocalPos.lat,
        activeLocalPos.lng,
        activePeerPos.lat,
        activePeerPos.lng
      );
    }
    return null;
  }, [activeLocalPos, activePeerPos]);

  const effectiveStatus = isDemoMode
    ? 'Connected P2P'
    : radio.status;

  const badge = statusBadgeStyle(effectiveStatus);

  // Volume ring scale expansion driven by AnalyserNode RMS energy
  const ringScale = radio.isTransmitting ? 1 + radio.micLevel * 0.45 : 1;

  return (
    <div className="h-dvh w-full bg-zinc-950 flex flex-col overflow-hidden select-none relative">
      {/* ── Room Full Modal ── */}
      {radio.roomFull && radio.errorMessage && (
        <div className="absolute inset-0 z-[100] bg-zinc-950/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-3xl mb-4">
            🚫
          </div>
          <h2 className="text-xl font-bold text-white uppercase tracking-tight mb-2">
            Convoy Room Full
          </h2>
          <p className="text-sm text-zinc-400 max-w-xs mb-6">
            {radio.errorMessage}
          </p>
          <button
            onClick={onDisconnect}
            className="px-6 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-sm transition"
          >
            Return to Lobby
          </button>
        </div>
      )}

      {/* ── INCOMING TRANSMISSION Pulsing Banner ── */}
      {radio.peerTransmitting && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-red-600 px-4 py-2.5 text-center shadow-lg shadow-red-600/30 animate-pulse flex items-center justify-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
          <span className="text-white font-black text-sm uppercase tracking-widest font-mono">
            INCOMING AUDIO · {effectivePeerCallsign || 'PEER CAR'}
          </span>
        </div>
      )}

      {/* ── Visual Quick-Ping Alert Banner ── */}
      {radio.lastPingReceived && (
        <div
          className={`absolute top-0 left-0 right-0 z-50 ${
            PING_ITEMS[radio.lastPingReceived.type].bannerBg
          } border-b px-4 py-3 text-center shadow-2xl flex items-center justify-center gap-2`}
        >
          <span className="text-2xl">{PING_ITEMS[radio.lastPingReceived.type].emoji}</span>
          <span className="text-white font-extrabold text-base tracking-wide uppercase font-mono">
            {radio.lastPingReceived.from}: {PING_ITEMS[radio.lastPingReceived.type].label}
          </span>
        </div>
      )}

      {/* ── Top Bar: Connection Badge, Callsign Tag & Disconnect ── */}
      <header className="px-3 pt-2 pb-1.5 flex items-center justify-between shrink-0 border-b border-zinc-900 bg-zinc-950/80 backdrop-blur z-20">
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-semibold ${badge.bg} ${badge.text}`}
          >
            <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
            <span>{effectiveStatus}</span>
          </div>

          {isDemoMode && (
            <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded">
              LIVE DEMO
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <div className="text-xs font-mono text-zinc-400 flex items-center gap-1.5 bg-zinc-900/80 px-2.5 py-1 rounded-lg border border-zinc-800">
            <span className="text-cyan-400 font-bold">{callsign}</span>
            <span className="text-zinc-600">↔</span>
            <span className="text-orange-400 font-bold">
              {effectivePeerCallsign || 'Waiting…'}
            </span>
          </div>

          <button
            onClick={onDisconnect}
            title="Leave Convoy"
            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* ── Distance & Telemetry Readout Bar ── */}
      <section className="px-3 py-1.5 text-center shrink-0 flex items-baseline justify-center gap-3 bg-zinc-950">
        {distance !== null ? (
          <>
            <span className="text-3xl font-black text-white font-mono tracking-tight drop-shadow-md">
              {formatDistance(distance)}
            </span>
            <span className="text-xs font-mono font-bold text-zinc-400 uppercase tracking-widest">
              APART
            </span>
            {activePeerPos && (
              <span className="text-xs font-mono text-orange-400 font-semibold bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded">
                Peer: {activePeerPos.speedKmh} km/h
              </span>
            )}
          </>
        ) : (
          <span className="text-xs font-mono text-zinc-500 uppercase tracking-wider">
            {effectivePeerCallsign
              ? 'Synchronizing GPS coordinates…'
              : 'Waiting for Car 2 to enter room…'}
          </span>
        )}
      </section>

      {/* ── Section 1: Live Leaflet Map & Radar View (~45% viewport height) ── */}
      <section className="flex-[45] min-h-[250px] px-2.5 pb-1 relative">
        <ConvoyMap
          localPosition={activeLocalPos}
          peerPosition={activePeerPos}
          localCallsign={callsign}
          peerCallsign={effectivePeerCallsign}
        />
      </section>

      {/* ── Section 2: 4-Button Dashboard Quick-Ping Bar (~15% height) ── */}
      <section className="flex-[15] min-h-[68px] max-h-[82px] px-2.5 py-1.5 flex items-stretch gap-2 shrink-0">
        {(Object.entries(PING_ITEMS) as [PingType, typeof PING_ITEMS[PingType]][]).map(
          ([type, item]) => (
            <button
              key={type}
              onClick={() => radio.sendPing(type)}
              className={`flex-1 rounded-xl ${item.buttonBg} border text-white font-bold text-xs flex flex-col items-center justify-center gap-1 transition-all active:scale-95 shadow-md cursor-pointer`}
            >
              <span className="text-xl leading-none">{item.emoji}</span>
              <span className="leading-tight text-center text-[11px] font-mono tracking-tight">
                {item.label}
              </span>
            </button>
          )
        )}
      </section>

      {/* ── Section 3: Oversized PTT HOLD-TO-TALK Button (~40% height) ── */}
      <section className="flex-[40] min-h-[170px] flex flex-col items-center justify-center pb-safe relative">
        <div className="relative flex items-center justify-center">
          {/* Audio Analyser Energy Halo */}
          <div
            className="absolute rounded-full transition-transform duration-75 pointer-events-none"
            style={{
              width: 210,
              height: 210,
              transform: `scale(${ringScale})`,
              background: radio.isTransmitting
                ? `radial-gradient(circle, transparent 58%, rgba(34,211,238,${
                    0.25 + radio.micLevel * 0.5
                  }) 100%)`
                : 'radial-gradient(circle, transparent 65%, rgba(63,63,70,0.2) 100%)',
              boxShadow: radio.isTransmitting
                ? `0 0 ${25 + radio.micLevel * 50}px rgba(34,211,238,${
                    0.35 + radio.micLevel * 0.45
                  })`
                : 'none',
            }}
          />

          {/* Secondary ripple ring during transmission */}
          {radio.isTransmitting && (
            <div
              className="absolute w-56 h-56 rounded-full border border-cyan-400/40 animate-ping pointer-events-none"
              style={{ animationDuration: '1.2s' }}
            />
          )}

          {/* Main PTT Button */}
          <button
            ref={pttRef}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onContextMenu={(e) => e.preventDefault()}
            className={`relative z-10 w-44 h-44 rounded-full font-black text-xl transition-all touch-none select-none flex flex-col items-center justify-center gap-1 shadow-2xl cursor-pointer ${
              radio.isTransmitting
                ? 'bg-cyan-400 text-zinc-950 scale-95 shadow-[0_0_35px_rgba(34,211,238,0.7)]'
                : 'bg-zinc-900 text-zinc-200 hover:bg-zinc-800 active:bg-cyan-400 active:text-zinc-950 border-4 border-zinc-700/80 shadow-[0_10px_30px_rgba(0,0,0,0.8)]'
            }`}
            style={{
              WebkitTouchCallout: 'none',
              WebkitUserSelect: 'none',
            }}
          >
            <svg
              className={`w-9 h-9 transition-transform ${
                radio.isTransmitting ? 'scale-110' : ''
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
            <span className="text-xs uppercase tracking-[0.2em] font-mono font-bold">
              {radio.isTransmitting ? 'TRANSMITTING' : 'HOLD TO TALK'}
            </span>
            <span className="text-[10px] text-zinc-400 font-mono tracking-widest uppercase">
              {radio.isTransmitting ? 'TX ON' : 'SPACEBAR / TAP'}
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}

// ─── Root Home Component ────────────────────────────────────────
export default function Home() {
  const [session, setSession] = useState<{
    callsign: string;
    channelName: string;
    isDemo: boolean;
  } | null>(null);

  const handleConnect = useCallback(
    (callsign: string, channelName: string) => {
      setSession({ callsign, channelName, isDemo: false });
    },
    []
  );

  const handleLaunchDemo = useCallback(() => {
    setSession({
      callsign: 'Car 1 (You)',
      channelName: 'demo-convoy',
      isDemo: true,
    });
  }, []);

  const handleDisconnect = useCallback(() => {
    setSession(null);
  }, []);

  if (!session) {
    return (
      <Lobby
        onConnect={handleConnect}
        onLaunchDemo={handleLaunchDemo}
      />
    );
  }

  return (
    <Dashboard
      callsign={session.callsign}
      channelName={session.channelName}
      isDemoMode={session.isDemo}
      onDisconnect={handleDisconnect}
    />
  );
}
