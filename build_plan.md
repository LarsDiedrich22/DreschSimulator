# Mähdresch Simulator – Browser Build Plan

## Goal
Ship a browser-playable 2D demo (static hosting friendly) that matches the study brief: 10-minute real-time session, visible harvested area, grain tank + tractor unload flow, battery SoC indicator (non-blocking), and hypothetical battery swap markers with logging.

## Stack & Project Setup
- Vite + TypeScript + HTML5 Canvas (no backend); single-page static build for GitHub Pages/Netlify/S3.
- Assets: two tile textures (unharvested/harvested), simple combine/tractor sprites, HUD font; keep bundle <2 MB, preload via Vite.
- Input: keyboard (WASD/Arrows, Space header, T tractor call, S swap marker) plus optional on-screen buttons for mobile parity.
- Loop: requestAnimationFrame render; fixed-step update with sim-time scaler (4× real-time).

## Implementation Phases
1) Field & Movement
- Grid of tiles (unharvested/harvested); header width in tiles.
- Movement with clamping to field bounds; camera centered on combine.
- When header active over crop: flip tiles to harvested, update harvested area %, animate tile swap.

2) Resources
- Grain tank: capacity 12 t; inflow 0.9 t/sim-min while harvesting; “tank full in …” calculation; auto-disable header + HUD message when full and tractor absent.
- Battery: drain rates per state (harvest/drive/idle); SoC bar can hit 0% without stopping; warning text at 0%.
- Time model: sim minutes = real seconds × 4; show both timers.

3) Tractor Call & Unloading
- Key T triggers call with cooldown and min tank threshold.
- Tractor spawns from field edge on simple path; aligns side-by-side.
- Unload rate 4 t/sim-min until tank empty (optional trailer fill).
- If tank full and tractor not present: harvesting blocked until unload.

4) Swap Marker & Logging
- Key S drops pulsing green circle around combine for 2–3 seconds; numbering optional.
- Log entry: real time, sim time, position (x,y), SoC, tank %, field %, tractor-nearby flag; toggleable in HUD and shown on end screen.
- Export log as JSON/CSV for study analysis.

5) HUD & UX
- Bars + text: field progress, tank (with “tank full in …”), battery (with state: high/med/low).
- Timers: real-time playtime and sim-time.
- Status messages for header block, tractor ETA, battery warning.
- Tutorial overlay at start (controls, indicators, note that swap is hypothetical).
- End screen on 100% harvested or 10 real minutes: stats + swap log list.

## Performance & Resilience
- Cull offscreen tiles; lightweight sprites; degrade to lower-res tiles or fewer effects on low FPS/mobile.
- Input debouncing; prevent header-on when out of crop; pause/resume clears transient states correctly.
- Deterministic update step for consistent sim-time; recordable seeds if replays are desired.

## Testing & Dev Tools
- Dev overlay: show rates (tank inflow, battery drain), timers, tractor cooldowns, current tile state under header.
- Smoke passes: harvest-only run, tank-full handling, tractor timing, swap logging, end-of-time condition.
- Verify mobile controls map to keyboard actions.

## Deployment
- `npm run build` → static `dist/`; ensure asset paths are relative for static hosting.
- Add simple health-check `index.html` and optional Netlify/GitHub Pages config; include CORS-safe asset loading.
