// src/hooks/useConvoyRadio.ts
'use client';

import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  getAudioContext,
  playTxChirp,
  playRxRoger,
  playPingChime,
  createMicAnalyser,
  getRmsLevel,
} from '@/lib/radioAudio';
import type { GeoPosition } from '@/lib/geo';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type ConnectionStatus =
  | 'Connected P2P'
  | 'Relayed via TURN'
  | 'Searching for Convoy'
  | 'Reconnecting';

export type PingType = 'gas' | 'traffic' | 'pullover' | 'allclear';

export interface ConvoyState {
  status: ConnectionStatus;
  peerCallsign: string | null;
  peerCallsigns: string[];
  isTransmitting: boolean;
  peerTransmitting: boolean;
  localPosition: GeoPosition | null;
  peerPosition: GeoPosition | null;
  analyser: AnalyserNode | null;
  micLevel: number;
  lastPingReceived: { type: PingType; from: string; at: number } | null;
  roomFull: boolean;
  roomMemberCount: number;
  errorMessage: string | null;
}

interface UseConvoyRadioProps {
  callsign: string;
  channelName: string;
}

export function useConvoyRadio({ callsign, channelName }: UseConvoyRadioProps) {
  const [state, setState] = useState<ConvoyState>({
    status: 'Searching for Convoy',
    peerCallsign: null,
    peerCallsigns: [],
    isTransmitting: false,
    peerTransmitting: false,
    localPosition: null,
    peerPosition: null,
    analyser: null,
    micLevel: 0,
    roomFull: false,
    roomMemberCount: 0,
    lastPingReceived: null,
    errorMessage: null,
  });

  const channelRef = useRef<RealtimeChannel | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const analyserRef = useRef<{
    analyser: AnalyserNode;
    cleanup: () => void;
  } | null>(null);
  const animFrameRef = useRef<number>(0);
  const geoWatchRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const makingOfferRefs = useRef<Map<string, boolean>>(new Map());
  const ignoreOfferRefs = useRef<Map<string, boolean>>(new Map());
  const pendingCandidatesRefs = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const myJoinTimeRef = useRef<number>(0);

  // ─── Screen Wake Lock API ─────────────────────────────────────
  const acquireWakeLock = useCallback(async () => {
    if (typeof window !== 'undefined' && 'wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
        });
      } catch {
        // Silently ignore if denied or unsupported
      }
    }
  }, []);

  // ─── Live Mic Level Animation Loop ────────────────────────────
  const startMicMeter = useCallback(() => {
    const tick = () => {
      if (analyserRef.current) {
        const level = getRmsLevel(analyserRef.current.analyser);
        setState((s) => (s.micLevel !== level ? { ...s, micLevel: level } : s));
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  // ─── ICE Server Configuration ─────────────────────────────────
  const getIceServers = useCallback((): RTCIceServer[] => {
    const servers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ];

    let turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
    let turnUser = process.env.NEXT_PUBLIC_TURN_USERNAME;
    let turnCred = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

    if (typeof window !== 'undefined') {
      try {
        const storedUrl = localStorage.getItem('convoy_turn_url');
        const storedUser = localStorage.getItem('convoy_turn_user');
        const storedCred = localStorage.getItem('convoy_turn_cred');
        if (storedUrl) turnUrl = storedUrl;
        if (storedUser) turnUser = storedUser;
        if (storedCred) turnCred = storedCred;
      } catch {
        // localStorage not available
      }
    }

    if (turnUrl && turnUser && turnCred) {
      const urls = turnUrl.includes(',')
        ? turnUrl.split(',').map((u) => u.trim())
        : [turnUrl.trim()];
      servers.push({
        urls,
        username: turnUser.trim(),
        credential: turnCred.trim(),
      });
    }

    return servers;
  }, []);

  // ─── Connection Health & TURN Check ───────────────────────────
  const checkConnectionQuality = useCallback((pc: RTCPeerConnection) => {
    const iceState = pc.iceConnectionState;

    if (iceState === 'connected' || iceState === 'completed') {
      pc.getStats()
        .then((stats) => {
          let relayed = false;
          stats.forEach((report) => {
            if (
              report.type === 'candidate-pair' &&
              report.state === 'succeeded'
            ) {
              const localCandidate = stats.get(report.localCandidateId);
              if (localCandidate && localCandidate.candidateType === 'relay') {
                relayed = true;
              }
            }
          });
          setState((s) => ({
            ...s,
            status: relayed ? 'Relayed via TURN' : 'Connected P2P',
          }));
        })
        .catch(() => {
          setState((s) => ({ ...s, status: 'Connected P2P' }));
        });
    } else if (iceState === 'disconnected' || iceState === 'failed') {
      setState((s) => ({ ...s, status: 'Reconnecting' }));
      // Cellular CGNAT 4G/5G handoff recovery
      try {
        pc.restartIce();
      } catch (e) {
        console.warn('ICE restart failed:', e);
      }
    } else if (iceState === 'checking' || iceState === 'new') {
      setState((s) => ({ ...s, status: 'Searching for Convoy' }));
    }
  }, []);

  // ─── Create RTCPeerConnection ────────────────────────────────
  const createPeerConnection = useCallback((peerCallsign: string) => {
    const existingPc = peerConnectionsRef.current.get(peerCallsign);
    if (existingPc) return existingPc;

    const pc = new RTCPeerConnection({
      iceServers: getIceServers(),
    });
    peerConnectionsRef.current.set(peerCallsign, pc);
    pcRef.current = pc;

    // Send local ICE candidates
    pc.onicecandidate = (e) => {
      if (e.candidate && channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'webrtc',
          payload: {
            type: 'ice-candidate',
            candidate: e.candidate.toJSON(),
            from: callsign,
            to: peerCallsign,
          },
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      checkConnectionQuality(pc);
    };

    // W3C Perfect Negotiation offer creation
    pc.onnegotiationneeded = async () => {
      try {
        makingOfferRefs.current.set(peerCallsign, true);
        await pc.setLocalDescription();
        channelRef.current?.send({
          type: 'broadcast',
          event: 'webrtc',
          payload: {
            type: 'sdp',
            sdp: pc.localDescription,
            from: callsign,
            to: peerCallsign,
          },
        });
      } catch (err) {
        console.error('WebRTC negotiation error:', err);
      } finally {
        makingOfferRefs.current.set(peerCallsign, false);
      }
    };

    // Receive remote audio track
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      e.track.enabled = true;

      let audio = remoteAudioElementsRef.current.get(peerCallsign);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        // iOS Safari inline playback attribute
        audio.setAttribute('playsinline', 'true');
        audio.setAttribute('controls', 'false');
        audio.volume = 1;
        remoteAudioRef.current = audio;
        remoteAudioElementsRef.current.set(peerCallsign, audio);
      }

      audio.srcObject = stream;
      audio.muted = false;
      audio.volume = 1;
      void audio.play().catch((err) => {
        console.warn('Remote audio playback blocked:', err);
      });
    };

    // Add local mic audio track (muted by default for PTT)
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getAudioTracks()) {
        track.enabled = false;
        pc.addTrack(track, localStreamRef.current);
      }
    }

    return pc;
  }, [callsign, getIceServers, checkConnectionQuality]);

  // ─── Handle WebRTC Signaling Messages ────────────────────────
  const handleWebRTCSignal = useCallback(
    async (payload: {
      type: string;
      sdp?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
      from: string;
      to?: string;
    }) => {
      if (payload.from === callsign) return;
      if (payload.to && payload.to !== callsign) return;

      let pc = peerConnectionsRef.current.get(payload.from);
      if (!pc) {
        pc = createPeerConnection(payload.from);
      }

      if (payload.type === 'sdp' && payload.sdp) {
        const offerCollision =
          payload.sdp.type === 'offer' &&
          (makingOfferRefs.current.get(payload.from) ||
            pc.signalingState !== 'stable');

        const isPolite = callsign < payload.from;
        ignoreOfferRefs.current.set(
          payload.from,
          !isPolite && offerCollision
        );
        if (ignoreOfferRefs.current.get(payload.from)) {
          return;
        }

        try {
          if (offerCollision) {
            await Promise.all([
              pc.setLocalDescription({ type: 'rollback' }),
              pc.setRemoteDescription(payload.sdp),
            ]);
          } else {
            await pc.setRemoteDescription(payload.sdp);
          }

          // Flush queued candidates
          const pendingCandidates =
            pendingCandidatesRefs.current.get(payload.from) || [];
          while (pendingCandidates.length > 0) {
            const candidate = pendingCandidates.shift();
            if (candidate) {
              await pc.addIceCandidate(candidate);
            }
          }

          if (payload.sdp.type === 'offer') {
            await pc.setLocalDescription();
            channelRef.current?.send({
              type: 'broadcast',
              event: 'webrtc',
              payload: {
                type: 'sdp',
                sdp: pc.localDescription,
                from: callsign,
                to: payload.from,
              },
            });
          }
        } catch (err) {
          console.error('SDP signaling error:', err);
        }
      } else if (payload.type === 'ice-candidate' && payload.candidate) {
        try {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(payload.candidate);
          } else {
            const pendingCandidates =
              pendingCandidatesRefs.current.get(payload.from) || [];
            pendingCandidates.push(payload.candidate);
            pendingCandidatesRefs.current.set(payload.from, pendingCandidates);
          }
        } catch (err) {
          if (!ignoreOfferRefs.current.get(payload.from)) {
            console.error('ICE candidate error:', err);
          }
        }
      }
    },
    [callsign, createPeerConnection]
  );

  // ─── Push-to-Talk (PTT) Controls ─────────────────────────────
  const startTransmitting = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = true;
      });
    }
    playTxChirp();
    setState((s) => ({ ...s, isTransmitting: true }));
    channelRef.current?.send({
      type: 'broadcast',
      event: 'ptt',
      payload: { ptt_state: 'transmitting', from: callsign },
    });
  }, [callsign]);

  const stopTransmitting = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = false;
      });
    }
    setState((s) => ({ ...s, isTransmitting: false }));
    channelRef.current?.send({
      type: 'broadcast',
      event: 'ptt',
      payload: { ptt_state: 'idle', from: callsign },
    });
  }, [callsign]);

  // ─── Quick Status Ping ───────────────────────────────────────
  const sendPing = useCallback(
    (type: PingType) => {
      playPingChime(type);
      channelRef.current?.send({
        type: 'broadcast',
        event: 'ping',
        payload: { pingType: type, from: callsign },
      });
    },
    [callsign]
  );

  // ─── Geolocation Tracking ────────────────────────────────────
  const startGeoTracking = useCallback(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) return;

    let lastBroadcast = 0;
    geoWatchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const geoPos: GeoPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speedKmh: pos.coords.speed
            ? Math.round(pos.coords.speed * 3.6)
            : 0,
          heading: pos.coords.heading || 0,
          updatedAt: Date.now(),
        };

        setState((s) => ({ ...s, localPosition: geoPos }));

        // Broadcast every 2 seconds
        const now = Date.now();
        if (now - lastBroadcast >= 2000) {
          lastBroadcast = now;
          channelRef.current?.send({
            type: 'broadcast',
            event: 'geo',
            payload: { ...geoPos, from: callsign },
          });
        }
      },
      (err) => {
        console.warn('Geolocation watch error:', err.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    );
  }, [callsign]);

  // ─── Full Initialization (Permissions & Channels) ────────────
  const initialize = useCallback(async () => {
    myJoinTimeRef.current = Date.now();

    // 1. AudioContext unlock
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    // 2. Microphone access
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStreamRef.current = stream;

      // Start with mic disabled for PTT
      stream.getAudioTracks().forEach((t) => {
        t.enabled = false;
      });

      // Mic level metering
      const analyserData = createMicAnalyser(stream);
      analyserRef.current = analyserData;
      setState((s) => ({ ...s, analyser: analyserData.analyser }));
      startMicMeter();
    } catch (err) {
      console.warn('Microphone permission not granted:', err);
    }

    // 3. Screen Wake Lock
    await acquireWakeLock();

    // 4. Geolocation
    startGeoTracking();

    // 5. Re-acquire Wake Lock on visibilitychange
    const handleVisChange = () => {
      if (document.visibilityState === 'visible') {
        acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisChange);

    // 6. Supabase Realtime Channel
    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    // Presence Sync — Enforce strict 2-car maximum
    channel.on('presence', { event: 'sync' }, () => {
      const presenceState = channel.presenceState();
      interface PresenceMember {
        callsign: string;
        joinedAt: number;
      }
      const rawMembers = Object.values(presenceState).flat() as unknown as PresenceMember[];

      const normalizedCallsign = callsign.trim().toLocaleLowerCase();
      const duplicateCallsign = rawMembers.some((member) => {
        if (!member.callsign) return false;
        return (
          member.callsign.trim().toLocaleLowerCase() === normalizedCallsign &&
          rawMembers.filter(
            (other) =>
              other.callsign?.trim().toLocaleLowerCase() ===
              normalizedCallsign
          ).length > 1
        );
      });

      if (duplicateCallsign) {
        setState((s) => ({
          ...s,
          roomFull: true,
          errorMessage: `The vehicle station "${callsign.trim()}" is already in this convoy room. Choose a different station name.`,
        }));
        return;
      }

      // Unique by callsign, sort by joinedAt
      const uniqueMap = new Map<string, PresenceMember>();
      rawMembers.forEach((m) => {
        if (!uniqueMap.has(m.callsign)) {
          uniqueMap.set(m.callsign, m);
        }
      });
      const members = Array.from(uniqueMap.values()).sort(
        (a, b) => a.joinedAt - b.joinedAt
      );

      const memberCount = members.length;
      const peers = members
        .filter((member) => member.callsign !== callsign)
        .map((member) => member.callsign);
      const peer = peers.length > 0 ? peers[0] : null;

      setState((s) => ({
        ...s,
        roomMemberCount: memberCount,
        roomFull: false,
        errorMessage: null,
        peerCallsign: peer,
        peerCallsigns: peers,
        status: peer ? s.status : 'Searching for Convoy',
      }));

      peers.forEach((peerCallsign) => {
        if (!peerConnectionsRef.current.has(peerCallsign)) {
          createPeerConnection(peerCallsign);
        }
      });
    });

    channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      const left = leftPresences as unknown as { callsign: string }[];
      left.forEach((peer) => {
        if (peer.callsign === callsign) return;
        const pc = peerConnectionsRef.current.get(peer.callsign);
        pc?.close();
        peerConnectionsRef.current.delete(peer.callsign);
        makingOfferRefs.current.delete(peer.callsign);
        ignoreOfferRefs.current.delete(peer.callsign);
        pendingCandidatesRefs.current.delete(peer.callsign);
        remoteAudioElementsRef.current.get(peer.callsign)?.pause();
        remoteAudioElementsRef.current.delete(peer.callsign);
      });

      setState((s) => {
        const peerCallsigns = s.peerCallsigns.filter(
          (peerCallsign) => !left.some((peer) => peer.callsign === peerCallsign)
        );
        return {
          ...s,
          status: peerCallsigns.length > 0 ? s.status : 'Searching for Convoy',
          peerCallsign: peerCallsigns[0] || null,
          peerCallsigns,
          peerTransmitting: false,
          peerPosition: peerCallsigns.length > 0 ? s.peerPosition : null,
        };
      });
    });

    // WebRTC Signaling
    channel.on('broadcast', { event: 'webrtc' }, ({ payload }) => {
      handleWebRTCSignal(payload);
    });

    // PTT State
    channel.on('broadcast', { event: 'ptt' }, ({ payload }) => {
      if (payload.from === callsign) return;
      if (payload.ptt_state === 'transmitting') {
        setState((s) => ({ ...s, peerTransmitting: true }));
      } else {
        setState((s) => ({ ...s, peerTransmitting: false }));
        playRxRoger();
      }
    });

    // Geolocation from Peer
    channel.on('broadcast', { event: 'geo' }, ({ payload }) => {
      if (payload.from === callsign) return;
      setState((s) => ({
        ...s,
        peerPosition: {
          lat: payload.lat,
          lng: payload.lng,
          speedKmh: payload.speedKmh,
          heading: payload.heading,
          updatedAt: payload.updatedAt,
        },
      }));
    });

    // Quick Status Pings
    channel.on('broadcast', { event: 'ping' }, ({ payload }) => {
      if (payload.from === callsign) return;
      playPingChime(payload.pingType);
      setState((s) => ({
        ...s,
        lastPingReceived: {
          type: payload.pingType,
          from: payload.from,
          at: Date.now(),
        },
      }));
      setTimeout(() => {
        setState((s) => ({ ...s, lastPingReceived: null }));
      }, 4500);
    });

    await channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          callsign,
          joinedAt: myJoinTimeRef.current,
        });
      }
    });

    // Teardown function
    return () => {
      document.removeEventListener('visibilitychange', handleVisChange);
      if (geoWatchRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchRef.current);
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (analyserRef.current) {
        analyserRef.current.cleanup();
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();
      makingOfferRefs.current.clear();
      ignoreOfferRefs.current.clear();
      pendingCandidatesRefs.current.clear();
      remoteAudioElementsRef.current.forEach((audio) => {
        audio.pause();
        audio.srcObject = null;
      });
      remoteAudioElementsRef.current.clear();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [
    callsign,
    channelName,
    acquireWakeLock,
    createPeerConnection,
    handleWebRTCSignal,
    startGeoTracking,
    startMicMeter,
  ]);

  return {
    ...state,
    initialize,
    startTransmitting,
    stopTransmitting,
    sendPing,
  };
}
