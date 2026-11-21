// src/components/ConvoyMap.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import type { GeoPosition } from '@/lib/geo';
import {
  haversineDistance,
  formatDistance,
  bearing,
  compassDirection,
} from '@/lib/geo';

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

/** Directional Car SVG Icon with heading rotation */
function createCarIcon(color: string, heading: number, label: string): L.DivIcon {
  return L.divIcon({
    className: 'convoy-car-marker',
    html: `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none;">
        <div style="transform: rotate(${heading}deg); transition: transform 0.3s ease; filter: drop-shadow(0 0 6px ${color});">
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17 3 L28 29 L17 23 L6 29 Z" fill="${color}" stroke="#09090b" stroke-width="2" stroke-linejoin="round"/>
            <circle cx="17" cy="15" r="3" fill="#ffffff" />
          </svg>
        </div>
        <div style="background: rgba(9,9,11,0.85); color: ${color}; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15); margin-top: 2px; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.05em;">
          ${label}
        </div>
      </div>
    `,
    iconSize: [44, 52],
    iconAnchor: [22, 26],
  });
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
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    } else if (local) {
      map.setView([local.lat, local.lng], 15);
    }
  }, [map, local, peer]);

  return null;
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

  useEffect(() => {
    fixLeafletIcons();
  }, []);

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
        localPosition?.heading || 0,
        localCallsign || 'You'
      ),
    [localPosition?.heading, localCallsign]
  );

  const peerIcon = useMemo(
    () =>
      createCarIcon(
        '#f97316',
        peerPosition?.heading || 0,
        peerCallsign || 'Peer'
      ),
    [peerPosition?.heading, peerCallsign]
  );

  const defaultCenter: [number, number] = localPosition
    ? [localPosition.lat, localPosition.lng]
    : peerPosition
    ? [peerPosition.lat, peerPosition.lng]
    : [37.7749, -122.4194];

  // ─── Low-Data Radar View ──────────────────────────────────────
  if (radarMode) {
    // Relative distance mapping on radar radius (clamp between 20% and 85%)
    let radarDistancePercent = 50;
    if (distance !== null) {
      // Map 0 - 5km to 15% - 85%
      radarDistancePercent = Math.min(85, Math.max(15, (distance / 5000) * 85));
    }

    return (
      <div className="relative h-full w-full flex flex-col items-center justify-center bg-zinc-950 rounded-xl border border-zinc-800 p-4">
        {/* Toggle back to Map */}
        <button
          onClick={() => setRadarMode(false)}
          className="absolute top-2 right-2 z-10 text-xs font-semibold text-cyan-400 hover:text-cyan-300 bg-zinc-900/90 border border-zinc-700/60 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition active:scale-95"
        >
          <span>🗺️</span>
          <span>Map View</span>
        </button>

        <div className="absolute top-2 left-2 z-10 text-[11px] font-mono uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
          LOW-DATA RADAR
        </div>

        {/* Circular Radar Scope */}
        <div className="relative w-52 h-52 sm:w-60 sm:h-60 mt-2">
          {/* Outer Ring & Compass Cardinal Labels */}
          <div className="absolute inset-0 rounded-full border-2 border-emerald-500/30 bg-emerald-950/10" />
          <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] font-mono font-bold text-emerald-400">
            N
          </span>
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-mono font-bold text-emerald-400">
            S
          </span>
          <span className="absolute top-1/2 right-1 -translate-y-1/2 text-[10px] font-mono font-bold text-emerald-400">
            E
          </span>
          <span className="absolute top-1/2 left-1 -translate-y-1/2 text-[10px] font-mono font-bold text-emerald-400">
            W
          </span>

          {/* Intermediate concentric distance rings */}
          <div className="absolute inset-8 rounded-full border border-emerald-500/20" />
          <div className="absolute inset-16 rounded-full border border-emerald-500/20" />

          {/* Crosshairs */}
          <div className="absolute left-1/2 top-4 bottom-4 w-px bg-emerald-500/20" />
          <div className="absolute top-1/2 left-4 right-4 h-px bg-emerald-500/20" />

          {/* Radar Sweep Animation */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none opacity-40 animate-spin"
            style={{
              animationDuration: '4s',
              background:
                'conic-gradient(from 0deg, rgba(16, 185, 129, 0.3) 0deg, transparent 60deg)',
            }}
          />

          {/* Center Point: Local Vehicle (Cyan) */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
            <div className="w-3.5 h-3.5 rounded-full bg-cyan-400 border-2 border-zinc-950 shadow-[0_0_10px_rgba(34,211,238,0.8)]" />
            <span className="text-[9px] font-mono font-bold text-cyan-300 mt-0.5 uppercase">
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
              <div className="w-4 h-4 rounded-full bg-orange-500 border-2 border-zinc-950 shadow-[0_0_12px_rgba(249,115,22,0.9)] animate-ping" />
              <div className="w-3.5 h-3.5 rounded-full bg-orange-500 border-2 border-zinc-950 shadow-[0_0_8px_rgba(249,115,22,0.9)] -mt-4" />
              <span className="text-[9px] font-mono font-bold text-orange-400 mt-1 uppercase whitespace-nowrap">
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
            <p className="text-sm text-zinc-500">Awaiting peer location telemetry…</p>
          )}

          <div className="flex items-center justify-center gap-4 text-xs text-zinc-400 font-mono mt-1">
            <span>You: {localPosition?.speedKmh ?? 0} km/h</span>
            <span>·</span>
            <span>
              {peerCallsign || 'Peer'}: {peerPosition?.speedKmh ?? 0} km/h
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Dark Leaflet Map View ────────────────────────────────────
  return (
    <div className="relative h-full w-full rounded-xl overflow-hidden border border-zinc-800">
      {/* Switch to Radar View button */}
      <button
        onClick={() => setRadarMode(true)}
        className="absolute top-2 right-2 z-[1000] text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-900/90 border border-zinc-700/60 backdrop-blur px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition active:scale-95 shadow-md"
      >
        <span>📡</span>
        <span>Radar View</span>
      </button>

      <MapContainer
        center={defaultCenter}
        zoom={15}
        className="h-full w-full"
        zoomControl={false}
        attributionControl={false}
        style={{ background: '#09090b' }}
      >
        {/* CartoDB Dark Matter tiles (zero API key required) */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={19}
        />

        <FitBounds local={localPosition} peer={peerPosition} />

        {/* Local Vehicle Marker */}
        {localPosition && (
          <Marker
            position={[localPosition.lat, localPosition.lng]}
            icon={localIcon}
          >
            <Popup>
              <div className="p-1">
                <span className="text-sm font-bold text-cyan-400">
                  {localCallsign} (You)
                </span>
                <div className="text-xs text-zinc-400 mt-0.5">
                  Speed: {localPosition.speedKmh} km/h
                  <br />
                  Heading: {Math.round(localPosition.heading)}° (
                  {compassDirection(localPosition.heading)})
                </div>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Peer Vehicle Marker */}
        {peerPosition && (
          <Marker
            position={[peerPosition.lat, peerPosition.lng]}
            icon={peerIcon}
          >
            <Popup>
              <div className="p-1">
                <span className="text-sm font-bold text-orange-400">
                  {peerCallsign || 'Peer Vehicle'}
                </span>
                <div className="text-xs text-zinc-400 mt-0.5">
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
