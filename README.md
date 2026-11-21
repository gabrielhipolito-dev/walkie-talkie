# 🛰️ Convoy PTT — Private Car-to-Car Walkie-Talkie & Live Convoy Radar

> A private, zero-latency Push-to-Talk (PTT) walkie-talkie and live convoy telemetry Progressive Web App (PWA) engineered to run on mobile browsers (iOS Safari & Android Chrome) over cellular 4G/5G data.

---

## 📋 Table of Contents
1. [Key Features](#-key-features)
2. [Prerequisites](#-prerequisites)
3. [Step 1: Set Up Supabase Realtime (Free Tier)](#-step-1-set-up-supabase-realtime-free-tier)
4. [Step 2: Local Installation & Testing](#-step-2-local-installation--testing)
5. [Step 3: Deploying to Production (HTTPS Required)](#-step-3-deploying-to-production-https-required)
6. [Step 4: Cellular CGNAT & TURN Server (Optional for Highway Resilience)](#-step-4-cellular-cgnat--turn-server-optional)
7. [Step 5: How Drivers Connect (In-Car Guide)](#-step-5-how-drivers-connect-in-car-guide)
8. [Step 6: How to Support More Than 2 Cars (Multi-Car Fleet / Convoy)](#-step-6-how-to-support-more-than-2-cars-multi-car-fleet--convoy)
9. [Troubleshooting & Mobile FAQ](#-troubleshooting--mobile-faq)

---

## ✨ Key Features

- **Zero-Latency Peer-to-Peer Voice (`RTCPeerConnection`):** Persistent WebRTC audio channel with microphone track muted by default (`audioTrack.enabled = false`).
- **Push-to-Talk (PTT) Audio Engine:** Native Web Audio API synthesis—plays a 1200 Hz radio key-up chirp on press, streams live microphone audio, broadcasts an **INCOMING TRANSMISSION** alert banner to the other vehicle, and sounds a realistic bandpass-filtered squelch tail on release (zero audio files needed).
- **Live Car-to-Car GPS & Haversine Distance:** Streams `{ lat, lng, speedKmh, heading }` every 2 seconds. Calculates accurate vehicle-to-vehicle distance in real-time (`350 m` or `2.4 km`) along with live speeds.
- **Dark Mode Leaflet Map + Low-Data Radar View:** CartoDB Dark Matter tiles (zero API keys required) with directional car marker chevrons rotated to vehicle heading. Includes a **Low-Data Radar View** toggle for cellular dead zones.
- **4 Dashboard Quick-Pings:** Large dashboard-safe buttons (`Gas Stop` ⛽, `Traffic / Checkpoint` 🚧, `Pull Over` 🅿️, `All Clear` ✅) sending full-width visual banners and distinct two-tone chimes audible over road noise.
- **Screen Wake Lock API:** Prevents mobile screens from sleeping on dashboard mounts, with auto-reacquisition on app tab switching (`visibilitychange`).
- **Strict 2-Car SHA-256 Gate:** Channel name is derived from `SHA-256(roomCode:pin)` so unauthorized eavesdroppers cannot guess room IDs, with strict 2-car peer presence enforcement.

---

## 🛠️ Prerequisites

- **Node.js:** v18.18.0 or newer (Node.js 20+ recommended)
- **Package Manager:** `npm`, `pnpm`, or `yarn`
- **A Free Supabase Account:** [https://supabase.com](https://supabase.com) (takes 2 minutes, no credit card required)
- **Devices:** Any two phones (iOS Safari or Android Chrome) or desktop computers with a microphone and internet connection.

---

## 🚀 Step 1: Set Up Supabase Realtime (Free Tier)

> **IMPORTANT:** This project uses **Supabase Realtime Broadcast & Presence**. **NO DATABASE TABLES OR SQL SCHEMAS ARE REQUIRED!** All signaling and location messages happen entirely in-memory.

1. Go to [https://supabase.com](https://supabase.com) and click **"Start your project"** (sign in with GitHub or email).
2. Click **"New Project"**.
   - **Name:** `convoy-ptt` (or any name you like)
   - **Database Password:** Enter any secure password (you won't need it for this app, but keep it safe).
   - **Region:** Choose the region closest to where you will drive (e.g. `US East`, `EU Central`, etc.).
   - **Pricing Plan:** Free ($0/month).
3. Click **"Create new project"** and wait ~60 seconds for it to provision.
4. In your Supabase project dashboard:
   - Click the **Gear icon (Project Settings)** in the left sidebar.
   - Go to **"Data API"** (under Configuration).
   - Copy two values:
     1. **Project URL** (e.g. `https://xyzprojectid.supabase.co`)
     2. **anon / public** API Key (e.g. `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`)

---

## 💻 Step 2: Local Installation & Testing

### 1. Clone or Open the Repository
```bash
cd c:\Users\itsup\OneDrive\Desktop\walkie-talkie
```

### 2. Configure Environment Variables
Create a file named `.env.local` in the project root:
```bash
# Windows PowerShell:
Copy-Item .env.example .env.local
```

Open `.env.local` in your editor and paste your Supabase keys from Step 1:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Optional TURN servers (leave blank for local testing):
NEXT_PUBLIC_TURN_URL=
NEXT_PUBLIC_TURN_USERNAME=
NEXT_PUBLIC_TURN_CREDENTIAL=
```

### 3. Install Dependencies & Start the Development Server
```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Test Between Two Tabs Locally
1. **Tab 1:** Callsign: `Car 1` | Room Code: `trip2026` | PIN: `1234` → Click **"Connect to Convoy"**.
2. **Tab 2 (Incognito window):** Callsign: `Car 2` | Room Code: `trip2026` | PIN: `1234` → Click **"Connect to Convoy"**.
3. You will see:
   - Status badge transitions from `Searching for Convoy` to `Connected P2P`.
   - Both vehicles show up on the map.
   - Press and hold **HOLD TO TALK** (or press the **Spacebar**) on Tab 1: you will hear the TX chirp, Tab 2 will show **"INCOMING TRANSMISSION · CAR 1"**, and releasing will trigger the squelch tail!

---

## 🌐 Step 3: Deploying to Production (HTTPS Required)

> ⚠️ **CRITICAL REQUIREMENT:** Mobile browsers (especially iOS Safari and Android Chrome) **STRICTLY REQUIRE HTTPS** to grant access to:
> - Microphone (`getUserMedia`)
> - Geolocation (`navigator.geolocation`)
> - Screen Wake Lock (`navigator.wakeLock`)
> - PWA Installation (`manifest.json`)
>
> If you deploy to plain `http://`, the browser will refuse to open the microphone or GPS!

### Option A: Deploy to Vercel (Recommended — Free & 1 Click)

1. Push your project to a GitHub repository:
   ```bash
   git add .
   git commit -m "feat: private car-to-car convoy PTT walkie-talkie"
   git remote add origin https://github.com/your-username/convoy-ptt.git
   git push -u origin main
   ```
2. Go to [https://vercel.com](https://vercel.com) and log in.
3. Click **"Add New..."** → **"Project"** and import your repository.
4. In the **Environment Variables** section, add:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://your-project-id.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
5. Click **"Deploy"**.
6. Vercel will output a secure HTTPS link (e.g. `https://convoy-ptt.vercel.app`).

### Option B: Deploy to Netlify / Cloudflare Pages / Railway
Simply connect your GitHub repo, set build command to `npm run build`, and configure the two `NEXT_PUBLIC_SUPABASE_*` environment variables in the provider's dashboard.

---

## 📡 Step 4: Cellular CGNAT & TURN Server (Optional)

When driving through rural highways, mobile network operators (Verizon, AT&T, T-Mobile, Vodafone, etc.) place cellular phones behind **Symmetric NAT (Carrier-Grade NAT / CGNAT)**.

- **STUN (Free Google STUN included by default):** Works for ~85% of mobile connections where direct UDP hole punching succeeds.
- **TURN (Relay):** Guarantees 100% connection success even if both phones are on strict cellular firewalls.

If you ever experience a situation where both cars show `Searching for Convoy` over cellular, add free TURN credentials:

1. Sign up for a free TURN provider such as **[Metered.ca](https://www.metered.ca/tools/openrelay/)** (50GB free TURN bandwidth/month).
2. Add your credentials to your `.env.local` or Vercel environment variables:
   ```env
   NEXT_PUBLIC_TURN_URL=turn:standard.relay.metered.ca:443
   NEXT_PUBLIC_TURN_USERNAME=your-username
   NEXT_PUBLIC_TURN_CREDENTIAL=your-password
   ```
3. When relaying through TURN, the top status badge will automatically display `Relayed via TURN` instead of `Connected P2P`.

---

## 🚘 Step 5: How Drivers Connect (In-Car Guide)

### For Driver 1 (Car 1):
1. Open the HTTPS URL in mobile Safari (iPhone) or mobile Chrome (Android).
2. Enter:
   - **Callsign:** `Car 1` (or your name/handle)
   - **Room Code:** e.g. `highway-run`
   - **4-Digit PIN:** e.g. `9876`
3. Tap **"🛰️ Connect to Convoy"**.
4. When prompted by the browser:
   - Allow **Microphone** access.
   - Allow **Location** access ("While Using App" / "Precise").
5. Mount your phone on the car dashboard.

### For Driver 2 (Car 2):
1. Open the same URL.
2. Enter:
   - **Callsign:** `Car 2`
   - **Room Code:** `highway-run` (MUST match Car 1)
   - **4-Digit PIN:** `9876` (MUST match Car 1)
3. Tap **"🛰️ Connect to Convoy"** and grant permissions.

### Operating in the Car:
- **Talking:** Tap and hold the circular **HOLD TO TALK** button. The button will illuminate cyan, play a radio chirp, and broadcast voice. Release to finish (squelch tail plays).
- **Listening:** When the other driver talks, the screen displays a flashing red **"INCOMING TRANSMISSION"** banner and their voice plays out loud through the car's speakers or phone loudspeaker.
- **Quick Alerts:** Tap any of the 4 ping buttons (`Gas Stop` ⛽, `Traffic` 🚧, `Pull Over` 🅿️, `All Clear` ✅) to send an instant alert banner and audible chime.
- **Low-Data Radar View:** Tap **"Radar View"** in the map corner if cell signal is weak for a high-contrast compass radar view with zero map tile downloads.
- **Install to Home Screen (PWA):**
  - **iPhone (iOS Safari):** Tap the Share button (square with arrow up) → tap **"Add to Home Screen"**.
  - **Android (Chrome):** Tap the 3-dots menu → tap **"Install app"** or **"Add to Home screen"**.

---

## 👥 Step 6: How to Support More Than 2 Cars (Multi-Car Fleet / Convoy)

The application currently has a strict 2-car room security gate as specified in the original design. If you want to use this for a **convoy of 3, 4, 5, or more cars**, follow the guide below:

### Where the 2-Peer Limit is Enforced:
Open [src/hooks/useConvoyRadio.ts](file:///c:/Users/itsup/OneDrive/Desktop/walkie-talkie/src/hooks/useConvoyRadio.ts#L440-L460):

```typescript
// Currently limits room membership to 2 cars:
const memberCount = members.length;
const myRank = members.findIndex((m) => m.callsign === callsign);

if (memberCount > 2 && myRank >= 2) {
  setState((s) => ({
    ...s,
    roomFull: true,
    errorMessage: 'Room is full (Maximum 2 cars allowed)...',
  }));
  return;
}
```

### Option A: Increase the Room Limit for Mesh P2P (Up to 4–5 Cars)
For small convoys (3 to 5 cars), browser WebRTC peer-to-peer mesh works well:

1. **Increase the limit check** in `src/hooks/useConvoyRadio.ts`:
   ```typescript
   const MAX_CONVOY_CARS = 5; // Change to 3, 4, 5, etc.

   if (memberCount > MAX_CONVOY_CARS && myRank >= MAX_CONVOY_CARS) {
     setState((s) => ({
       ...s,
       roomFull: true,
       errorMessage: `Room is full (Maximum ${MAX_CONVOY_CARS} cars allowed).`,
     }));
     return;
   }
   ```
2. **Switch from a single `pcRef` to a Map of PeerConnections:**
   Instead of `pcRef = useRef<RTCPeerConnection | null>(null)`, store an active connection per remote car:
   ```typescript
   const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
   ```
   When a peer joins via presence sync, create an `RTCPeerConnection` for each peer whose callsign is in the room.
3. **Map Markers & Radar:**
   In [src/components/ConvoyMap.tsx](file:///c:/Users/itsup/OneDrive/Desktop/walkie-talkie/src/components/ConvoyMap.tsx), replace `peerPosition: GeoPosition | null` with `peers: Map<string, GeoPosition>`, and loop over all peers to render markers for every car in the convoy:
   ```tsx
   {Array.from(peers.entries()).map(([callsign, pos]) => (
     <Marker key={callsign} position={[pos.lat, pos.lng]} icon={createCarIcon('#f97316', pos.heading, callsign)}>
       <Popup>{callsign}: {pos.speedKmh} km/h</Popup>
     </Marker>
   ))}
   ```

### Option B: Large Fleets (10+ Cars) via SFU (Selective Forwarding Unit)
For large convoys (10 to 100 vehicles):
- Direct mesh connections consume high cellular upload bandwidth because a talking car would have to upload audio to 10 separate cars simultaneously ($N \times \text{bitrate}$).
- For 10+ vehicles, replace the single WebRTC peer connection with a free open-source WebRTC SFU like **[LiveKit Cloud](https://livekit.io)** or **mediasoup**:
  - The driver who presses PTT sends **one** audio stream to the SFU server.
  - The SFU server forwards that single stream to all 10+ listening cars in the room.
  - Telemetry (GPS coordinates) continues using Supabase Realtime Broadcast, which easily supports hundreds of cars per channel.

---

## ❓ Troubleshooting & Mobile FAQ

### 1. "No Audio on iPhone / iOS Safari"
- **Cause:** iOS Safari requires audio to be triggered by a direct user tap.
- **Fix:** The single **"Connect to Convoy"** button is specifically programmed to unlock the global `AudioContext` on tap. Make sure your iPhone is not set to hardware "Silent Mode" (vibrate switch on the side of older iPhones, or Focus mode), or turn up the media volume slider.

### 2. "Screen turns off while driving"
- **Cause:** Mobile browser paused the Screen Wake Lock when switching tabs.
- **Fix:** Convoy PTT includes an automatic re-acquisition listener on `document.visibilitychange`. If you switch to another app (like Spotify or Apple Maps) and switch back, the Wake Lock automatically reactivates.

### 3. "Location not updating or shows default coordinates"
- **Cause:** Browser permission for Geolocation was set to "Denied" or "Ask next time".
- **Fix:**
  - In Safari (iOS): Settings → Safari → Location → set to "Allow".
  - In Chrome (Android): Tap the lock icon in the address bar → Permissions → Location → set to "Allowed".
  - Ensure high-accuracy GPS is enabled on your phone settings.

### 4. "Two cars cannot find each other (`Searching for Convoy`)"
- Verify both cars typed the **exact same Room Code** and **exact same 4-digit PIN** (the channel name is derived from `SHA-256(roomCode:pin)`).
- Verify both phones have cellular internet connectivity and that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are configured properly.
- If both cars are on strict corporate or carrier symmetric firewalls, configure a TURN server as described in [Step 4](#-step-4-cellular-cgnat--turn-server-optional).

---

## 📄 License
MIT License. Built for car enthusiasts, road-trippers, and off-grid convoy explorers.
