// src/components/ConvoyMap.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  ZoomControl,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoPosition } from '@/lib/geo';
import {
  haversineDistance,
  formatDistance,
  bearing,
  compassDirection,
} from '@/lib/geo';

export type MapTileStyle = 'dark' | 'satellite' | 'street';

// Fix Leaflet default icon issues in bundled environments
function fixLeafletIcons() {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl:
      'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  });
}

/** Directional Car SVG Icon with heading rotation and prominent label */
function createCarIcon(color: string, heading: number, label: string): L.DivIcon {
  return L.divIcon({
    className: 'convoy-car-marker',
    html: `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none;">
        <div style="transform: rotate(${heading}deg); transition: transform 0.3s ease; filter: drop-shadow(0 0 10px ${color});">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 3 L33 33 L20 25 L7 33 Z" fill="${color}" stroke="#09090b" stroke-width="2.5" stroke-linejoin="round"/>
            <circle cx="20" cy="17" r="4" fill="#ffffff" />
          </svg>
        </div>
        <div style="background: rgba(9,9,11,0.95); color: ${color}; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 6px; border: 1.5px solid ${color}; margin-top: 3px; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.05em; box-shadow: 0 4px 12px rgba(0,0,0,0.9);">
          ${label}
        </div>
      </div>
    `,
    iconSize: [50, 58],
    iconAnchor: [25, 29],
  });
}

/** Guarantees Leaflet container recalculates dimensions immediately upon mounting */
function InvalidateSize() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 150);
    const t2 = setTimeout(() => map.invalidateSize(), 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [map]);
  return null;
}

/** Automatically fits map viewport to encompass both vehicles */
function FitBounds({
  local,
  peer,
}: {
  local: GeoPosition | null;
  peer: GeoPosition | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (local && peer) {
      const bounds = L.latLngBounds(
        [local.lat, local.lng],
        [peer.lat, peer.lng]
      );
      map.fitBounds(bounds, { padding: [55, 55], maxZoom: 16 });
    } else if (local) {
      map.setView([local.lat, local.lng], 15);
    } else if (peer) {
      map.setView([peer.lat, peer.lng], 15);
    }
  }, [map, local, peer]);

  return null;
}

/** Recenter on Local Vehicle Button Component */
function RecenterButton({ local }: { local: GeoPosition | null }) {
  const map = useMap();
  if (!local) return null;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        map.setView([local.lat, local.lng], 16);
      }}
      title="Center On My Car"
      className="absolute bottom-4 right-3 z-[1000] p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-700/80 text-cyan-400 hover:text-white hover:bg-zinc-800 transition active:scale-90 shadow-xl backdrop-blur flex items-center justify-center cursor-pointer"
    >
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.2}
      >
        <circle cx="12" cy="12" r="3" fill="currentColor" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 2v3m0 14v3M2 12h3m14 0h3"
        />
      </svg>
    </button>
  );
}

interface ConvoyMapProps {
  localPosition: GeoPosition | null;
  peerPosition: GeoPosition | null;
  localCallsign: string;
  peerCallsign: string | null;
}

export default function ConvoyMap({
  localPosition,
  peerPosition,
  localCallsign,
  peerCallsign,
}: ConvoyMapProps) {
  const [radarMode, setRadarMode] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapTileStyle>('dark');

  useEffect(() => {
    fixLeafletIcons();
  }, []);

  // Fallback coordinate for demo / initial view
  const displayLocal: GeoPosition = useMemo(() => {
    if (localPosition) return localPosition;
    return {
      lat: 34.0522,
      lng: -118.2437,
      speedKmh: 0,
      heading: 0,
      updatedAt: 0,
    };
  }, [localPosition]);

  const distance = useMemo(() => {
    if (localPosition && peerPosition) {
      return haversineDistance(
        localPosition.lat,
        localPosition.lng,
        peerPosition.lat,
        peerPosition.lng
      );
    }
    return null;
  }, [localPosition, peerPosition]);

  const bearingToPeer = useMemo(() => {
    if (localPosition && peerPosition) {
      return bearing(
        localPosition.lat,
        localPosition.lng,
        peerPosition.lat,
        peerPosition.lng
      );
    }
    return null;
  }, [localPosition, peerPosition]);

  const localIcon = useMemo(
    () =>
      createCarIcon(
        '#22d3ee',
        displayLocal.heading,
        localCallsign || 'My Car'
      ),
    [displayLocal.heading, localCallsign]
  );

  const peerIcon = useMemo(
    () =>
      createCarIcon(
        '#f97316',
        peerPosition?.heading || 0,
        peerCallsign || 'Peer Car'
      ),
    [peerPosition?.heading, peerCallsign]
  );

  const centerCoord: [number, number] = localPosition
    ? [localPosition.lat, localPosition.lng]
    : peerPosition
    ? [peerPosition.lat, peerPosition.lng]
    : [displayLocal.lat, displayLocal.lng];

  // ─── Low-Data Radar View ──────────────────────────────────────
  if (radarMode) {
    let radarDistancePercent = 50;
    if (distance !== null) {
      radarDistancePercent = Math.min(85, Math.max(15, (distance / 5000) * 85));
    }

    return (
      <div className="relative h-full w-full flex flex-col items-center justify-center bg-zinc-950 rounded-2xl border border-zinc-800 p-4">
        {/* Switch back to Map */}
        <button
          onClick={() => setRadarMode(false)}
          className="absolute top-2.5 right-2.5 z-10 text-xs font-bold text-cyan-400 hover:text-cyan-300 bg-zinc-900/90 border border-zinc-700/80 px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition active:scale-95 shadow-lg backdrop-blur cursor-pointer"
        >
          <span>🗺️</span>
          <span>Show Map</span>
        </button>

        <div className="absolute top-2.5 left-2.5 z-10 text-[11px] font-mono uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 rounded-lg">
          RADAR MODE (ZERO TILE DATA)
        </div>

        {/* Circular Radar Scope */}
        <div className="relative w-52 h-52 sm:w-60 sm:h-60 mt-2">
          {/* Outer Ring & Compass Cardinal Labels */}
          <div className="absolute inset-0 rounded-full border-2 border-emerald-500/40 bg-emerald-950/20 shadow-[0_0_20px_rgba(16,185,129,0.15)]" />
          <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] font-mono font-bold text-emerald-400">
            N
          </span>
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-mono font-bold text-emerald-400">
            S
          </span>
          <span className="absolute top-1/2 right-1.5 -translate-y-1/2 text-[10px] font-mono font-bold text-emerald-400">
            E
          </span>
          <span className="absolute top-1/2 left-1.5 -translate-y-1/2 text-[10px] font-mono font-bold text-emerald-400">
            W
          </span>

          {/* Intermediate concentric distance rings */}
          <div className="absolute inset-8 rounded-full border border-emerald-500/25" />
          <div className="absolute inset-16 rounded-full border border-emerald-500/25" />

          {/* Crosshairs */}
          <div className="absolute left-1/2 top-4 bottom-4 w-px bg-emerald-500/25" />
          <div className="absolute top-1/2 left-4 right-4 h-px bg-emerald-500/25" />

          {/* Radar Sweep Animation */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none opacity-40 animate-spin"
            style={{
              animationDuration: '3.5s',
              background:
                'conic-gradient(from 0deg, rgba(16, 185, 129, 0.4) 0deg, transparent 65deg)',
            }}
          />

          {/* Center Point: Local Vehicle (Cyan) */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
            <div className="w-4 h-4 rounded-full bg-cyan-400 border-2 border-zinc-950 shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
            <span className="text-[9px] font-mono font-black text-cyan-300 mt-0.5 uppercase tracking-wider">
              YOU
            </span>
          </div>

          {/* Peer Vehicle Blip (Orange) */}
          {bearingToPeer !== null && (
            <div
              className="absolute flex flex-col items-center transition-all duration-700"
              style={{
                left: `calc(50% + ${
                  Math.sin((bearingToPeer * Math.PI) / 180) *
                  radarDistancePercent *
                  0.5
                }%)`,
                top: `calc(50% - ${
                  Math.cos((bearingToPeer * Math.PI) / 180) *
                  radarDistancePercent *
                  0.5
                }%)`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div className="w-4 h-4 rounded-full bg-orange-500 border-2 border-zinc-950 shadow-[0_0_14px_rgba(249,115,22,1)] animate-ping" />
              <div className="w-3.5 h-3.5 rounded-full bg-orange-500 border-2 border-zinc-950 shadow-[0_0_10px_rgba(249,115,22,1)] -mt-4" />
              <span className="text-[9px] font-mono font-bold text-orange-400 mt-1 uppercase whitespace-nowrap bg-zinc-950/80 px-1 py-0.2 rounded border border-orange-500/30">
                {peerCallsign || 'PEER'}
              </span>
            </div>
          )}
        </div>

        {/* Telemetry Summary */}
        <div className="mt-3 text-center">
          {distance !== null ? (
            <div className="flex items-baseline justify-center gap-2">
              <span className="text-3xl font-black text-white font-mono tracking-tight">
                {formatDistance(distance)}
              </span>
              <span className="text-sm font-semibold text-emerald-400 uppercase">
                {bearingToPeer !== null && (
                  <>
                    {compassDirection(bearingToPeer)} ({Math.round(bearingToPeer)}°)
                  </>
                )}
              </span>
            </div>
          ) : (
            <p className="text-xs font-mono text-zinc-500">
              Awaiting peer vehicle GPS broadcast…
            </p>
          )}

          <div className="flex items-center justify-center gap-4 text-xs text-zinc-400 font-mono mt-1">
            <span>You: {displayLocal.speedKmh} km/h</span>
            <span>·</span>
            <span>
              {peerCallsign || 'Peer'}: {peerPosition?.speedKmh ?? 0} km/h
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Live Leaflet Map View ────────────────────────────────────
  return (
    <div className="relative h-full w-full rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl bg-zinc-950">
      {/* Top Controls Bar */}
      <div className="absolute top-2.5 right-2.5 z-[1000] flex items-center gap-1.5">
        {/* Style Selector */}
        <div className="bg-zinc-900/90 border border-zinc-700/80 backdrop-blur rounded-xl p-0.5 flex items-center shadow-xl">
          <button
            onClick={() => setMapStyle('dark')}
            title="Esri Dark Gray Navigation"
            className={`px-2 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
              mapStyle === 'dark'
                ? 'bg-cyan-500 text-zinc-950 font-bold'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            🌙 Dark
          </button>
          <button
            onClick={() => setMapStyle('satellite')}
            title="Esri World Imagery Aerial"
            className={`px-2 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
              mapStyle === 'satellite'
                ? 'bg-cyan-500 text-zinc-950 font-bold'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            🛰️ Sat
          </button>
          <button
            onClick={() => setMapStyle('street')}
            title="OpenStreetMap Standard"
            className={`px-2 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
              mapStyle === 'street'
                ? 'bg-cyan-500 text-zinc-950 font-bold'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            🗺️ Street
          </button>
        </div>

        {/* Switch to Radar View button */}
        <button
          onClick={() => setRadarMode(true)}
          title="Switch to Low-Data Radar Mode"
          className="text-xs font-bold text-zinc-200 hover:text-white bg-zinc-900/90 border border-zinc-700/80 backdrop-blur px-2.5 py-1.5 rounded-xl flex items-center gap-1 transition active:scale-95 shadow-xl cursor-pointer"
        >
          <span>📡</span>
          <span>Radar</span>
        </button>
      </div>

      {/* GPS Status Pill */}
      <div className="absolute top-2.5 left-2.5 z-[1000] text-[10px] font-mono font-bold px-2.5 py-1 rounded-lg backdrop-blur flex items-center gap-1.5 border shadow-lg bg-zinc-900/90 text-cyan-400 border-zinc-700/80">
        <span
          className={`w-2 h-2 rounded-full ${
            localPosition ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
          }`}
        />
        <span>{localPosition ? 'GPS LOCKED' : 'SEARCHING SATELLITES'}</span>
      </div>

      <MapContainer
        center={centerCoord}
        zoom={15}
        className="h-full w-full min-h-[220px]"
        zoomControl={false}
        attributionControl={false}
        style={{ background: '#09090b', height: '100%', width: '100%' }}
      >
        <ZoomControl position="bottomleft" />
        <InvalidateSize />

        {/* ── 100% Free Tile Layers (NO API Key, NO Watermark) ── */}
        {mapStyle === 'dark' && (
          <>
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
              attribution='&copy; Esri, HERE, Garmin'
              maxZoom={16}
            />
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
              attribution=''
              maxZoom={16}
            />
          </>
        )}

        {mapStyle === 'satellite' && (
          <>
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution='&copy; Esri, Maxar, Earthstar Geographics'
              maxZoom={19}
            />
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
              attribution=''
              maxZoom={19}
            />
          </>
        )}

        {mapStyle === 'street' && (
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            maxZoom={19}
          />
        )}

        <FitBounds
          local={localPosition || displayLocal}
          peer={peerPosition}
        />

        <RecenterButton local={localPosition || displayLocal} />

        {/* Local Vehicle Marker (Cyan Chevron) */}
        <Marker
          position={[displayLocal.lat, displayLocal.lng]}
          icon={localIcon}
        >
          <Popup>
            <div className="p-1">
              <span className="text-sm font-bold text-cyan-400">
                {localCallsign} (You)
              </span>
              <div className="text-xs text-zinc-400 mt-0.5 font-mono">
                Speed: {displayLocal.speedKmh} km/h
                <br />
                Heading: {Math.round(displayLocal.heading)}° (
                {compassDirection(displayLocal.heading)})
                {!localPosition && (
                  <div className="text-amber-400 mt-1 text-[10px]">
                    (Acquiring GPS fix...)
                  </div>
                )}
              </div>
            </div>
          </Popup>
        </Marker>

        {/* Peer Vehicle Marker (Orange Chevron) */}
        {peerPosition && (
          <Marker
            position={[peerPosition.lat, peerPosition.lng]}
            icon={peerIcon}
          >
            <Popup>
              <div className="p-1">
                <span className="text-sm font-bold text-orange-400">
                  {peerCallsign || 'Peer Car'}
                </span>
                <div className="text-xs text-zinc-400 mt-0.5 font-mono">
                  Speed: {peerPosition.speedKmh} km/h
                  <br />
                  Heading: {Math.round(peerPosition.heading)}° (
                  {compassDirection(peerPosition.heading)})
                  {distance !== null && (
                    <>
                      <br />
                      Range: {formatDistance(distance)}
                    </>
                  )}
                </div>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
