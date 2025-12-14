import "./style.css";

type GameState = "tutorial" | "running" | "ended";
type TractorState = "idle" | "approaching" | "unloading" | "leaving";

type Vec2 = { x: number; y: number };

interface Tractor {
  state: TractorState;
  arrivalTimer: number; // sim minutes remaining
  leaveTimer: number; // sim minutes remaining
  cooldownTimer: number; // sim minutes remaining
  position: Vec2;
  target: Vec2;
  arrivalDuration: number;
  trailerFill: number;
  approachTarget: Vec2;
  heading: number;
}

interface SwapEvent {
  id: number;
  realSeconds: number;
  simSeconds: number;
  x: number;
  y: number;
  battery: number;
  tank: number;
  field: number;
  tractorNearby: boolean;
}

interface SwapMarker {
  id: number;
  x: number;
  y: number;
  created: number;
}

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

const fieldProgressEl = document.getElementById("field-progress")!;
const tankLevelEl = document.getElementById("tank-level")!;
const tankTimerEl = document.getElementById("tank-timer")!;
const batteryLevelEl = document.getElementById("battery-level")!;
const consumptionStateEl = document.getElementById("consumption-state")!;
const timeDisplayEl = document.getElementById("time-display")!;
const tractorStatusEl = document.getElementById("tractor-status")!;
const statusMessageEl = document.getElementById("status-message")!;
const messagesEl = document.getElementById("messages")!;
const swapListEl = document.getElementById("swap-list")!;
const toggleLogBtn = document.getElementById("toggle-log") as HTMLButtonElement;
const exportLogBtn = document.getElementById("export-log") as HTMLButtonElement;
const tutorialOverlay = document.getElementById("tutorial")!;
const startButton = document.getElementById("start-button") as HTMLButtonElement;
const endScreen = document.getElementById("end-screen")!;
const endSummary = document.getElementById("end-summary")!;
const endLog = document.getElementById("end-log")!;
const restartButton = document.getElementById("restart-button") as HTMLButtonElement;

// Combine sprite
const combineImage = new Image();
combineImage.src = "draufsicht-des-maehdreschers-133656179.jpg.png";
let combineImageReady = false;
combineImage.onload = () => {
  combineImageReady = true;
};
if (combineImage.complete) combineImageReady = true;

// Constants based on the design document
const TILE_SIZE = 8; // px
const METERS_PER_TILE = 0.01; // 1 cm of wheat field per tile
const PIXELS_PER_METER = TILE_SIZE / METERS_PER_TILE;
const FIELD_WIDTH_TILES = 70; // 70 cm length
const FIELD_HEIGHT_TILES = 70; // 70 cm width
const FIELD_WIDTH = FIELD_WIDTH_TILES * TILE_SIZE;
const FIELD_HEIGHT = FIELD_HEIGHT_TILES * TILE_SIZE;
const TOTAL_TILES = FIELD_WIDTH_TILES * FIELD_HEIGHT_TILES;
const TON_PER_TILE = (9 / 10000) * (METERS_PER_TILE * METERS_PER_TILE); // 9 t/ha yield

const SIM_SECONDS_PER_REAL_SECOND = 4;
const REAL_TIME_LIMIT_SECONDS = 10 * 60;

const HEADER_WIDTH_TILES = 14; // trimmed cutter width by two tiles from 16
const HEADER_DEPTH_TILES = 3.5;
const HEADER_OFFSET = TILE_SIZE * 4;
const HEADER_VISUAL_SHIFT_TILES = 3; // push visible cutter forward

const TARGET_COMBINE_SPEED_PPS = 34; // keep prior on-screen speed with the smaller 70 cm field
const COMBINE_SPEED_MPS = TARGET_COMBINE_SPEED_PPS / PIXELS_PER_METER;
const COMBINE_SPEED_PPS = TARGET_COMBINE_SPEED_PPS;
const COMBINE_SIZE = { w: 140, h: 220 }; // scaled for sprite
const WORLD_MARGIN = 400; // allow driving beyond field
const TURN_SPEED_DEG_PER_SEC = 120; // smoother turning
const TURN_SPEED_RAD_PER_SEC = (TURN_SPEED_DEG_PER_SEC * Math.PI) / 180;
const REVERSE_SPEED_FACTOR = 0.6;
const TURN_EASE_DURATION = 2; // seconds of reduced sensitivity after big turn
const TURN_EASE_MULTIPLIER = 0.4;

const TANK_CAPACITY = 13; // tons (~13,000 L)
const TANK_INFLOW_RATE = 0.9; // t per sim minute
const UNLOAD_RATE = 4; // t per sim minute base
const UNLOAD_RATE_ATTACHED_MULTIPLIER = 1.2; // +20% when tractor is unloading alongside
const TANK_MIN_CALL_THRESHOLD = 0.6 * TANK_CAPACITY;

const BATTERY_CAPACITY_KWH = 210; // tuned so 100% → 20% lasts ~3m40 real while harvesting
const BATTERY_DRAIN_HARVEST = 11.45; // kWh per sim minute (targets ~3:40 real to reach 20%)
const BATTERY_DRAIN_DRIVE = 3.3;
const BATTERY_DRAIN_IDLE = 0.7;

const TRACTOR_COOLDOWN_SIM_MIN = 2;
const TRACTOR_ARRIVAL_SIM_MIN = 1.25; // faster arrival (previously 2.5)
const TRACTOR_LEAVE_SIM_MIN = 1.5;
const TRACTOR_OFFSET = COMBINE_SIZE.w; // one combine width to the left
const TRAILER_CAPACITY = 20; // t visual only
const MIN_TRACTOR_GAP = Math.max(40, TRACTOR_OFFSET - TILE_SIZE); // prevent overlap
const TRACTOR_HEADING_OFFSET = 0; // align tractor heading with combine
const TRACTOR_SPEED_MULTIPLIER = 1.25;
const TRACTOR_ALONGSIDE_SPEED_MULTIPLIER = 0.6; // reduce combine speed while unloading so convoy can stay matched

const START_POSITION = {
  x: FIELD_WIDTH * 0.5,
  y: FIELD_HEIGHT + 120 // well outside the field so the header sits off-field
};
const START_ANGLE = -Math.PI / 2; // face upward into the field (90° relative to x-axis)
const BATTERY_SWAP_THRESHOLD = 0.2; // 20%
const BATTERY_SWAP_DURATION = 30; // seconds
const BATTERY_SWAP_ZONE = {
  position: { x: FIELD_WIDTH * 0.5 + 200, y: START_POSITION.y },
  radius: 90
};
const BATTERY_CARRIER_OFFSET = TRACTOR_OFFSET + 40;
type BatterySwapMode = "zone" | "field";


let tiles = new Uint8Array(TOTAL_TILES);
let harvestedTiles = 0;

const combine = {
  position: { ...START_POSITION },
  prevPosition: { ...START_POSITION },
  angle: START_ANGLE,
  headerActive: false
};

const batterySwap: { active: boolean; timer: number; mode: BatterySwapMode } = {
  active: false,
  timer: 0,
  mode: "zone"
};
const batteryCarrier = {
  active: false,
  side: 1 as -1 | 1,
  created: 0
};
let batterySwapPrompted = false;

const tank = {
  current: 0,
  capacity: TANK_CAPACITY
};

const battery = {
  current: BATTERY_CAPACITY_KWH,
  capacity: BATTERY_CAPACITY_KWH
};

let lastHarvestRateTPerMin = TANK_INFLOW_RATE;

const tractor: Tractor = {
  state: "idle",
  arrivalTimer: 0,
  leaveTimer: 0,
  cooldownTimer: 0,
  arrivalDuration: TRACTOR_ARRIVAL_SIM_MIN,
  position: { x: -120, y: FIELD_HEIGHT / 2 },
  target: { x: 0, y: FIELD_HEIGHT / 2 },
  approachTarget: { x: 0, y: FIELD_HEIGHT / 2 },
  trailerFill: 0,
  heading: 0
};

let tractorCalls = 0;
let unloadCount = 0;

let swapEvents: SwapEvent[] = [];
let markers: SwapMarker[] = [];
let swapCounter = 0;

const inputState: Record<string, boolean> = {};

let gameState: GameState = "tutorial";
let lastTimestamp = performance.now();
let elapsedRealSeconds = 0;
let elapsedSimSeconds = 0;
let statusMessage = "Bereit";
let turnEaseTimer = 0;
let lastAngleSnapshot = 0;

function resetGame() {
  tiles = new Uint8Array(TOTAL_TILES);
  harvestedTiles = 0;
  combine.position = { ...START_POSITION }; // start in front of the lower edge of the field
  combine.prevPosition = { ...combine.position };
  combine.angle = START_ANGLE;
  combine.headerActive = false;
  tank.current = 0;
  battery.current = BATTERY_CAPACITY_KWH;
  batterySwap.active = false;
  batterySwap.timer = 0;
  batterySwap.mode = "zone";
  batterySwapPrompted = false;
  batteryCarrier.active = false;
  batteryCarrier.side = 1;
  batteryCarrier.created = 0;
  lastHarvestRateTPerMin = TANK_INFLOW_RATE;
  tractor.state = "idle";
  tractor.arrivalTimer = 0;
  tractor.leaveTimer = 0;
  tractor.cooldownTimer = 0;
  tractor.position = { x: -120, y: FIELD_HEIGHT / 2 };
  tractor.target = { x: 0, y: FIELD_HEIGHT / 2 };
  tractor.approachTarget = { x: 0, y: FIELD_HEIGHT / 2 };
  tractor.trailerFill = 0;
  tractor.heading = 0;
  tractorCalls = 0;
  unloadCount = 0;
  swapCounter = 0;
  swapEvents = [];
  markers = [];
  elapsedRealSeconds = 0;
  elapsedSimSeconds = 0;
  turnEaseTimer = 0;
  lastAngleSnapshot = combine.angle;
  statusMessage = "Bereit";
  updateSwapList();
  hideOverlay(endScreen);
}

function startGame() {
  resetGame();
  gameState = "running";
  hideOverlay(tutorialOverlay);
}

function endGame(reason: string) {
  gameState = "ended";
  combine.headerActive = false;
  const realMinutes = (elapsedRealSeconds / 60).toFixed(1);
  const simMinutes = (elapsedSimSeconds / 60).toFixed(1);
  const fieldPercent = ((harvestedTiles / TOTAL_TILES) * 100).toFixed(1);
  const summary = [
    `Grund: ${reason}`,
    `Reale Zeit: ${realMinutes} min`,
    `Sim-Zeit: ${simMinutes} min`,
    `Feld geerntet: ${fieldPercent} %`,
    `Tank-Entladungen: ${unloadCount}`,
    `Swap-Markierungen: ${swapEvents.length}`
  ].join("<br>");
  endSummary.innerHTML = summary;
  endLog.innerHTML = renderEndLog();
  showOverlay(endScreen);
}

function renderEndLog() {
  if (swapEvents.length === 0) {
    return `<div class="entry">Keine Swap-Markierungen aufgezeichnet.</div>`;
  }
  return swapEvents
    .map((event) => {
      const real = formatTime(event.realSeconds);
      const sim = formatSimTime(event.simSeconds);
      return `<div class="entry">#${event.id} — ${sim} / ${real}<br>SoC ${event.battery.toFixed(0)} % · Tank ${event.tank.toFixed(0)} % · Feld ${event.field.toFixed(0)} %</div>`;
    })
    .join("");
}

function showOverlay(el: HTMLElement) {
  el.classList.remove("hidden");
}

function hideOverlay(el: HTMLElement) {
  el.classList.add("hidden");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(angle: number) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function lerpAngle(a: number, b: number, t: number) {
  const diff = normalizeAngle(b - a);
  return a + diff * clamp(t, 0, 1);
}

function tileIndex(x: number, y: number) {
  return y * FIELD_WIDTH_TILES + x;
}

function setTileHarvested(x: number, y: number) {
  const idx = tileIndex(x, y);
  if (tiles[idx] === 0) {
    tiles[idx] = 1;
    harvestedTiles += 1;
  }
}

function handleInputToggle(key: string) {
  if (gameState !== "running") return;
  if (key === "t" || key === "T") {
    requestTractor();
    return;
  }
  if (batterySwap.active) return;
  if (key === " ") {
    if (!harvestBlocked()) {
      combine.headerActive = !combine.headerActive;
    }
  }
  if (key === "b" || key === "B") {
    triggerFieldBatterySwap();
  }
}

function harvestBlocked() {
  return tank.current >= tank.capacity - 0.001 && tractor.state !== "unloading";
}

function requestTractor() {
  if (tractor.state !== "idle") {
    statusMessage = "Traktor bereits unterwegs oder beim Abladen.";
    return;
  }
  if (tractor.cooldownTimer > 0) {
    statusMessage = "Traktor ist in Abkühlphase.";
    return;
  }
  tractor.state = "approaching";
  tractor.arrivalTimer = TRACTOR_ARRIVAL_SIM_MIN;
  tractor.arrivalDuration = TRACTOR_ARRIVAL_SIM_MIN;
  const side = { x: -Math.sin(combine.angle), y: Math.cos(combine.angle) };
  const target = {
    x: combine.position.x - side.x * TRACTOR_OFFSET,
    y: combine.position.y - side.y * TRACTOR_OFFSET
  };
  tractor.target = target;
  tractor.approachTarget = { ...target };
  tractor.heading = combine.angle + TRACTOR_HEADING_OFFSET;
  tractorCalls += 1;
  statusMessage = "Traktor gerufen.";
}

function dropSwapMarker() {
  if (gameState !== "running") return;
  swapCounter += 1;
  const now = performance.now();
  const marker: SwapMarker = {
    id: swapCounter,
    x: combine.position.x,
    y: combine.position.y,
    created: now
  };
  markers.push(marker);
  const event: SwapEvent = {
    id: swapCounter,
    realSeconds: elapsedRealSeconds,
    simSeconds: elapsedSimSeconds,
    x: combine.position.x,
    y: combine.position.y,
    battery: batteryPercent(),
    tank: tankPercent(),
    field: (harvestedTiles / TOTAL_TILES) * 100,
    tractorNearby: tractor.state === "unloading"
  };
  swapEvents.push(event);
  updateSwapList();
}

function batteryPercent() {
  return clamp((battery.current / battery.capacity) * 100, 0, 100);
}

function tankPercent() {
  return clamp((tank.current / tank.capacity) * 100, 0, 100);
}

function isBatteryLow() {
  return battery.current / battery.capacity <= BATTERY_SWAP_THRESHOLD;
}

function isInBatteryZone(pos: Vec2) {
  const dx = pos.x - BATTERY_SWAP_ZONE.position.x;
  const dy = pos.y - BATTERY_SWAP_ZONE.position.y;
  return Math.hypot(dx, dy) <= BATTERY_SWAP_ZONE.radius;
}

function startBatterySwap() {
  startBatterySwapWithMode("zone");
}

function startBatterySwapWithMode(mode: BatterySwapMode) {
  batterySwap.active = true;
  batterySwap.timer = BATTERY_SWAP_DURATION;
  batterySwap.mode = mode;
  if (mode === "field") {
    batteryCarrier.active = true;
    batteryCarrier.created = performance.now();
    batteryCarrier.side = determineBatteryCarrierSide();
  } else {
    batteryCarrier.active = false;
  }
  if (mode === "zone") {
    combine.headerActive = false; // zone swaps still pause cutting
  }
  statusMessage = "Vorherige Batterie wird ersetzt.";
}

function finishBatterySwap() {
  batterySwap.active = false;
  batterySwap.timer = 0;
  batterySwap.mode = "zone";
  batterySwapPrompted = false;
  batteryCarrier.active = false;
  battery.current = battery.capacity;
  statusMessage = "Batterie ersetzt. Ernte bereit.";
}

function determineBatteryCarrierSide() {
  // Tractor sits on the left; use the opposite side when tractor is involved.
  const tractorEngaged = tractor.state !== "idle";
  return (tractorEngaged ? 1 : 1) as -1 | 1;
}

function batterySwapPhase(progress: number) {
  if (progress < 1 / 3) return 0; // prep/previous battery
  if (progress < 2 / 3) return 1; // removing empty
  return 2; // inserting new
}

function batterySwapPhaseMessage(progress: number) {
  const phase = batterySwapPhase(progress);
  if (phase === 0) return "Vorherige Batterie wird ersetzt.";
  if (phase === 1) return "Leere Batterie wird entnommen.";
  return "Neue Batterie wird eingesetzt.";
}

function batterySwapTimerText() {
  return `${Math.ceil(batterySwap.timer)}s`;
}

function triggerFieldBatterySwap() {
  if (batterySwap.active) {
    statusMessage = "Batteriewechsel läuft bereits.";
    return;
  }
  if (battery.current >= battery.capacity - 0.01) {
    statusMessage = "Batterie bereits voll.";
    return;
  }
  startBatterySwapWithMode("field");
}

function batteryCarrierWorldPosition() {
  const side = { x: -Math.sin(combine.angle), y: Math.cos(combine.angle) };
  const offset = BATTERY_CARRIER_OFFSET * batteryCarrier.side;
  return {
    x: combine.position.x + side.x * offset,
    y: combine.position.y + side.y * offset
  };
}

function keepTractorSeparation() {
  const dx = tractor.position.x - combine.position.x;
  const dy = tractor.position.y - combine.position.y;
  const dist = Math.hypot(dx, dy);
  if (dist < MIN_TRACTOR_GAP) {
    const nx = dist < 0.001 ? 1 : dx / dist;
    const ny = dist < 0.001 ? 0 : dy / dist;
    tractor.position.x = combine.position.x + nx * MIN_TRACTOR_GAP;
    tractor.position.y = combine.position.y + ny * MIN_TRACTOR_GAP;
  }
}

function renderTile(x: number, y: number, harvested: boolean, camX: number, camY: number) {
  const screenX = x * TILE_SIZE - camX;
  const screenY = y * TILE_SIZE - camY;
  const hash = ((x * 73856093) ^ (y * 19349663)) & 0xff;
  if (harvested) {
    const base = 80 + (hash % 20);
    ctx.fillStyle = `rgb(${base}, ${60 + (hash % 10)}, ${40})`;
  } else {
    const base = 190 + (hash % 20);
    ctx.fillStyle = `rgb(${base}, ${140 + (hash % 10)}, ${35})`;
  }
  ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
}

function drawCombine(camX: number, camY: number) {
  const screenX = combine.position.x - camX;
  const screenY = combine.position.y - camY;
  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.rotate(combine.angle + Math.PI / 2); // rotate sprite 90° to match desired orientation
  if (combineImageReady) {
    ctx.drawImage(combineImage, -COMBINE_SIZE.w / 2, -COMBINE_SIZE.h / 2, COMBINE_SIZE.w, COMBINE_SIZE.h);
  } else {
    ctx.fillStyle = "#2fbf73";
    ctx.fillRect(-COMBINE_SIZE.w / 2, -COMBINE_SIZE.h / 2, COMBINE_SIZE.w, COMBINE_SIZE.h);
  }

  // Grain tank fill overlay
  const tankRatio = tankPercent() / 100;
  ctx.fillStyle = "rgba(12,18,22,0.8)";
  ctx.fillRect(-COMBINE_SIZE.w / 2 + 10, -COMBINE_SIZE.h / 2 - 16, COMBINE_SIZE.w - 20, 12);
  ctx.fillStyle = "#f9d54c";
  ctx.fillRect(-COMBINE_SIZE.w / 2 + 10, -COMBINE_SIZE.h / 2 - 16, (COMBINE_SIZE.w - 20) * tankRatio, 12);
  ctx.restore();

  // Header overlay aligned with harvest footprint (world aligned)
  const forward = { x: Math.cos(combine.angle), y: Math.sin(combine.angle) };
  const depth = HEADER_DEPTH_TILES * TILE_SIZE;
  const width = HEADER_WIDTH_TILES * TILE_SIZE;
  const depthHalf = depth / 2;
  const widthHalf = width / 2;
  const centerOffset = HEADER_OFFSET + depthHalf + HEADER_VISUAL_SHIFT_TILES * TILE_SIZE;
  const hx = combine.position.x + forward.x * centerOffset - camX;
  const hy = combine.position.y + forward.y * centerOffset - camY;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(combine.angle);
  ctx.fillStyle = combine.headerActive ? "rgba(165,255,215,0.35)" : "rgba(109,168,139,0.2)";
  ctx.fillRect(-depthHalf, -widthHalf, depth, width);
  ctx.strokeStyle = combine.headerActive ? "rgba(0,255,160,0.6)" : "rgba(120,160,140,0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-depthHalf, -widthHalf, depth, width);
  ctx.restore();
}

function drawTractor(camX: number, camY: number) {
  if (tractor.state === "idle") return;
  const screenX = tractor.position.x - camX;
  const screenY = tractor.position.y - camY;
  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.rotate(tractor.heading);

  // Trailer body
  ctx.fillStyle = "#c2a46b";
  ctx.fillRect(-92, -22, 72, 44);
  ctx.fillStyle = "#9a7a3e";
  ctx.fillRect(-92, -6, 72, 12);
  // Trailer wheels
  ctx.fillStyle = "#151a1f";
  ctx.fillRect(-90, -28, 16, 12);
  ctx.fillRect(-38, -28, 16, 12);
  ctx.fillRect(-90, 16, 16, 12);
  ctx.fillRect(-38, 16, 16, 12);
  // Trailer fill indicator
  const trailerRatio = clamp(tractor.trailerFill / TRAILER_CAPACITY, 0, 1);
  ctx.fillStyle = "#f5d66d";
  ctx.fillRect(-88, -18, 64 * trailerRatio, 12);
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.strokeRect(-88, -18, 64, 12);

  // Tractor chassis
  const tractorGradient = ctx.createLinearGradient(0, -20, 40, 20);
  tractorGradient.addColorStop(0, "#4ac1ff");
  tractorGradient.addColorStop(1, "#1d7fc1");
  ctx.fillStyle = tractorGradient;
  ctx.fillRect(0, -18, 40, 36);
  // Tractor cab glass
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(4, -12, 24, 24);
  ctx.fillStyle = "#9bd6ff";
  ctx.fillRect(8, -8, 16, 16);
  // Tractor roof
  ctx.fillStyle = "#0f3d63";
  ctx.fillRect(0, -22, 40, 6);
  // Tractor wheels
  ctx.fillStyle = "#151a1f";
  ctx.fillRect(-2, -24, 12, 14);
  ctx.fillRect(-2, 12, 12, 14);
  ctx.fillRect(28, -22, 14, 12);
  ctx.fillRect(28, 10, 14, 12);
  ctx.fillStyle = "#2e3844";
  ctx.fillRect(1, -21, 6, 8);
  ctx.fillRect(1, 15, 6, 8);
  ctx.fillRect(31, -19, 8, 8);
  ctx.fillRect(31, 13, 8, 8);

  // Grain stream when unloading
  if (tractor.state === "unloading") {
    ctx.strokeStyle = "rgba(244,210,70,0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    const side = { x: -Math.sin(combine.angle), y: Math.cos(combine.angle) };
    const fromX = combine.position.x - camX + side.x * (COMBINE_SIZE.w / 2);
    const fromY = combine.position.y - camY + side.y * (COMBINE_SIZE.w / 2);
    const toX = 20;
    const toY = -8;
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX + screenX, toY + screenY);
    ctx.stroke();
  }

  ctx.restore();
}

function drawBatteryZone(camX: number, camY: number, now: number) {
  const screenX = BATTERY_SWAP_ZONE.position.x - camX;
  const screenY = BATTERY_SWAP_ZONE.position.y - camY;
  const pulse = (Math.sin(now / 400) + 1) / 2;
  ctx.save();
  ctx.translate(screenX, screenY);

  // Landing pad
  const padRadius = BATTERY_SWAP_ZONE.radius;
  const padGradient = ctx.createRadialGradient(0, 0, padRadius * 0.2, 0, 0, padRadius);
  padGradient.addColorStop(0, "rgba(70,90,110,0.85)");
  padGradient.addColorStop(1, "rgba(30,40,50,0.75)");
  ctx.fillStyle = padGradient;
  ctx.beginPath();
  ctx.arc(0, 0, padRadius, 0, Math.PI * 2);
  ctx.fill();

  // Pad markings
  ctx.strokeStyle = `rgba(0,255,102,${0.35 + pulse * 0.3})`;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, padRadius * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-padRadius * 0.8, 0);
  ctx.lineTo(padRadius * 0.8, 0);
  ctx.moveTo(0, -padRadius * 0.8);
  ctx.lineTo(0, padRadius * 0.8);
  ctx.stroke();

  // Static batteries on pad
  for (let i = -1; i <= 1; i++) {
    const bx = i * 50;
    const by = 34;
    ctx.save();
    ctx.translate(bx, by);
    const grad = ctx.createLinearGradient(-28, -18, 28, 18);
    grad.addColorStop(0, "#6f7c87");
    grad.addColorStop(1, "#4f5963");
    ctx.fillStyle = grad;
    ctx.fillRect(-28, -18, 56, 36);
    ctx.strokeStyle = "#9fb6c5";
    ctx.strokeRect(-28, -18, 56, 36);
    ctx.fillStyle = "#1e262c";
    ctx.fillRect(-24, -4, 48, 8);
    ctx.fillStyle = "#3ae37e";
    ctx.font = "bold 10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Battery", 0, 4);
    // Lightning bolt
    ctx.fillStyle = "#f9e24c";
    ctx.beginPath();
    ctx.moveTo(-4, -10);
    ctx.lineTo(4, -10);
    ctx.lineTo(0, 4);
    ctx.lineTo(6, 4);
    ctx.lineTo(-2, 18);
    ctx.lineTo(2, 6);
    ctx.lineTo(-4, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Low battery beacon
  if (isBatteryLow() && !batterySwap.active) {
    ctx.strokeStyle = `rgba(58,227,126,${0.4 + pulse * 0.4})`;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, padRadius * (0.9 + pulse * 0.08), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#3ae37e";
    ctx.font = "bold 14px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Tauschzone", 0, -padRadius - 10);
  }

  // Swap animation when swapping in the zone
  if (batterySwap.active && batterySwap.mode === "zone") {
    const progress = clamp(1 - batterySwap.timer / BATTERY_SWAP_DURATION, 0, 1);
    ctx.save();
    ctx.translate(0, -10);
    const drawBattery = (x: number, y: number, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#6f7c87";
      ctx.fillRect(x - 28, y - 18, 56, 36);
      ctx.strokeStyle = "#9fb6c5";
      ctx.strokeRect(x - 28, y - 18, 56, 36);
      ctx.fillStyle = "#1e262c";
      ctx.fillRect(x - 24, y - 4, 48, 8);
      ctx.fillStyle = "#3ae37e";
      ctx.font = "bold 10px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Battery", x, y + 4);
      ctx.fillStyle = "#f9e24c";
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 10);
      ctx.lineTo(x + 4, y - 10);
      ctx.lineTo(x, y + 4);
      ctx.lineTo(x + 6, y + 4);
      ctx.lineTo(x - 2, y + 18);
      ctx.lineTo(x + 2, y + 6);
      ctx.lineTo(x - 4, y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const slideOut = clamp(progress * 3, 0, 1);
    const slideIn = clamp((progress - 1 / 3) * 3, 0, 1);
    const settle = clamp((progress - 2 / 3) * 3, 0, 1);

    // Old battery sliding out
    const outY = -30 - slideOut * 60;
    drawBattery(-20, outY, 1 - settle * 0.5);

    // New battery sliding in
    const inY = 60 - slideIn * 60;
    drawBattery(20, inY, 0.4 + settle * 0.6);

    // Countdown text
    ctx.fillStyle = "#e8f1f9";
    ctx.font = "bold 16px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(batterySwapTimerText(), 0, padRadius + 24);
    ctx.restore();
  }

  ctx.restore();
}

function drawBatteryCarrier(camX: number, camY: number, now: number) {
  if (!batteryCarrier.active || batterySwap.mode !== "field") return;
  const pos = batteryCarrierWorldPosition();
  const screenX = pos.x - camX;
  const screenY = pos.y - camY;
  const pulse = (Math.sin((now - batteryCarrier.created) / 300) + 1) / 2;

  ctx.save();
  ctx.translate(screenX, screenY);

  // Trailer body
  ctx.fillStyle = "#2f343c";
  ctx.fillRect(-60, -26, 120, 52);
  ctx.strokeStyle = "#8ca0b3";
  ctx.strokeRect(-60, -26, 120, 52);
  // Wheels
  ctx.fillStyle = "#11161c";
  ctx.fillRect(-52, 20, 24, 12);
  ctx.fillRect(28, 20, 24, 12);

  // Battery on trailer
  const drawBatteryBlock = (x: number, y: number, alpha = 1) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    const grad = ctx.createLinearGradient(x - 28, y - 18, x + 28, y + 18);
    grad.addColorStop(0, "#6f7c87");
    grad.addColorStop(1, "#4f5963");
    ctx.fillStyle = grad;
    ctx.fillRect(x - 28, y - 18, 56, 36);
    ctx.strokeStyle = "#9fb6c5";
    ctx.strokeRect(x - 28, y - 18, 56, 36);
    ctx.fillStyle = "#1e262c";
    ctx.fillRect(x - 24, y - 4, 48, 8);
    ctx.fillStyle = "#3ae37e";
    ctx.font = "bold 10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Battery", x, y + 4);
    ctx.fillStyle = "#f9e24c";
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 10);
    ctx.lineTo(x + 4, y - 10);
    ctx.lineTo(x, y + 4);
    ctx.lineTo(x + 6, y + 4);
    ctx.lineTo(x - 2, y + 18);
    ctx.lineTo(x + 2, y + 6);
    ctx.lineTo(x - 4, y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const batteryY = -4 - pulse * 6;
  drawBatteryBlock(0, batteryY, 0.75 + 0.25 * pulse);

  // Countdown text
  ctx.fillStyle = "#e8f1f9";
  ctx.font = "bold 14px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(batterySwapTimerText(), 0, -40);

  ctx.restore();
}

function drawTractorPath(camX: number, camY: number) {
  if (tractor.state !== "approaching") return;
  const side = { x: -Math.sin(combine.angle), y: Math.cos(combine.angle) };
  const anchorX = combine.position.x - side.x * TRACTOR_OFFSET;
  const anchorY = combine.position.y - side.y * TRACTOR_OFFSET;
  ctx.save();
  ctx.strokeStyle = "rgba(58,227,126,0.6)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.moveTo(tractor.position.x - camX, tractor.position.y - camY);
  ctx.lineTo(anchorX - camX, anchorY - camY);
  ctx.stroke();
  ctx.restore();
}

function drawMarkers(camX: number, camY: number, now: number) {
  markers.forEach((marker) => {
    const pulse = (Math.sin((now - marker.created) / 300) + 1) / 2;
    const alpha = 0.4 + pulse * 0.4;
    const radius = 42 + pulse * 12;
    ctx.save();
    ctx.translate(marker.x - camX, marker.y - camY);
    ctx.strokeStyle = `rgba(0, 255, 102, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
}

function drawHud(now: number) {
  const fieldPercent = (harvestedTiles / TOTAL_TILES) * 100;
  fieldProgressEl.textContent = `${fieldPercent.toFixed(1)} %`;
  tankLevelEl.textContent = `${tankPercent().toFixed(1)} % (${tank.current.toFixed(1)} / ${tank.capacity} t)`;
  tankTimerEl.textContent = tankTimerText();
  const batteryPct = batteryPercent();
  batteryLevelEl.textContent = `${batteryPct.toFixed(1)} %`;
  const consumptionState = consumptionLabel();
  consumptionStateEl.textContent = consumptionState;
  timeDisplayEl.textContent = `${formatTime(elapsedRealSeconds)} / ${formatSimTime(elapsedSimSeconds)}`;
  tractorStatusEl.textContent = tractorStatusText();
  statusMessageEl.textContent = statusMessage;
  if (batterySwap.active) {
    messagesEl.textContent = `Batteriewechsel: ${batterySwapTimerText()}`;
  } else if (batteryPct <= 0) {
    messagesEl.textContent = "Batterie wäre im Realbetrieb leer (kein Wechsel durchgeführt).";
  } else if (isBatteryLow()) {
    messagesEl.textContent = "Batterie bei 20 % – zur Tauschzone fahren oder B für Wechsel auf dem Feld drücken.";
  } else {
    messagesEl.textContent = "";
  }
}

function consumptionLabel() {
  if (combine.headerActive && !harvestBlocked()) return "Hoch";
  const forwardBack = Math.abs(inputState["ArrowUp"] || inputState["KeyW"] ? 1 : 0) +
    Math.abs(inputState["ArrowDown"] || inputState["KeyS"] ? 1 : 0);
  if (forwardBack > 0) return "Mittel";
  return "Niedrig";
}

function tractorStatusText() {
  if (tractor.state === "idle") return "Leerlauf";
  if (tractor.state === "approaching") return `Unterwegs (${tractor.arrivalTimer.toFixed(1)} Sim-Min.)`;
  if (tractor.state === "unloading") return "Beim Abladen";
  if (tractor.state === "leaving") return "Fährt weg";
  return "Leerlauf";
}

function tankTimerText() {
  if (!(combine.headerActive && !harvestBlocked())) return "--";
  const inflow = Math.max(0.0001, lastHarvestRateTPerMin);
  const remaining = Math.max(0, tank.capacity - tank.current);
  const simMinutes = remaining / inflow;
  return `${simMinutes.toFixed(1)} Sim-Min.`;
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatSimTime(simSeconds: number) {
  const simMins = Math.floor(simSeconds / 60);
  const simSecs = Math.floor(simSeconds % 60);
  return `${String(simMins).padStart(2, "0")}:${String(simSecs).padStart(2, "0")} Sim`;
}

function updateSwapList() {
  swapListEl.innerHTML = "";
  swapEvents.slice(-10).forEach((event) => {
    const div = document.createElement("div");
    div.className = "swap-entry";
    const real = formatTime(event.realSeconds);
    const sim = formatSimTime(event.simSeconds);
    div.innerHTML = `#${event.id} – ${sim} / ${real}<br>SoC ${event.battery.toFixed(0)} % · Tank ${event.tank.toFixed(0)} % · Feld ${event.field.toFixed(0)} %`;
    swapListEl.appendChild(div);
  });
  if (swapEvents.length > 10) {
    const note = document.createElement("div");
    note.className = "swap-entry";
    note.textContent = `+ ${swapEvents.length - 10} ältere Einträge`;
    swapListEl.appendChild(note);
  }
}

function exportLogToCsv() {
  if (swapEvents.length === 0) {
    statusMessage = "Keine Swap-Markierungen zum Export.";
    return;
  }
  const header = "id,real_time,sim_time,x,y,battery_percent,tank_percent,field_percent,tractor_nearby";
  const rows = swapEvents.map((event) => {
    const real = formatTime(event.realSeconds);
    const sim = formatSimTime(event.simSeconds);
    const tractorFlag = event.tractorNearby ? "yes" : "no";
    return `${event.id},${real},${sim},${event.x.toFixed(1)},${event.y.toFixed(1)},${event.battery.toFixed(1)},${event.tank.toFixed(1)},${event.field.toFixed(1)},${tractorFlag}`;
  });
  const csv = [header, ...rows].join("\n");
  downloadFile("swap_log.csv", csv, "text/csv");
  statusMessage = "Swap-Protokoll exportiert.";
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function updateTractor(simDeltaMinutes: number) {
  if (tractor.cooldownTimer > 0) {
    tractor.cooldownTimer = Math.max(0, tractor.cooldownTimer - simDeltaMinutes);
  }
  const side = { x: -Math.sin(combine.angle), y: Math.cos(combine.angle) };
  const targetOffset = {
    x: combine.position.x - side.x * TRACTOR_OFFSET,
    y: combine.position.y - side.y * TRACTOR_OFFSET
  };

  if (tractor.state === "approaching") {
    tractor.target = { ...targetOffset }; // dynamically follow combine position
    tractor.arrivalTimer -= simDeltaMinutes;
    const progress = clamp((simDeltaMinutes / tractor.arrivalDuration) * TRACTOR_SPEED_MULTIPLIER, 0, 1);
    // Bias movement to align x strongly so approach stays alongside (vertical to combine)
    tractor.position.x += (tractor.target.x - tractor.position.x) * progress * 2;
    tractor.position.y += (tractor.target.y - tractor.position.y) * progress;
    const distToTarget = Math.hypot(tractor.target.x - tractor.position.x, tractor.target.y - tractor.position.y);
    const travelHeading = Math.atan2(tractor.target.y - tractor.position.y, tractor.target.x - tractor.position.x);
    const arrivalHeading = combine.angle + TRACTOR_HEADING_OFFSET;
    const arrivalProgress = clamp(1 - tractor.arrivalTimer / tractor.arrivalDuration, 0, 1);
    const inFinalThird = arrivalProgress >= 2 / 3 || distToTarget < 60;
    const headingLerp = inFinalThird ? 0.5 : 0.25;
    const desiredHeading = inFinalThird ? arrivalHeading : travelHeading;
    tractor.heading = lerpAngle(tractor.heading, desiredHeading, headingLerp);
    if (tractor.arrivalTimer <= 0) {
      tractor.state = "unloading";
      tractor.target = { ...targetOffset };
      tractor.heading = arrivalHeading;
      statusMessage = "Traktor eingetroffen.";
    }
  } else if (tractor.state === "unloading") {
    tractor.target = { ...targetOffset };
    // Smooth follow
    tractor.position.x += (tractor.target.x - tractor.position.x) * 0.4;
    tractor.position.y += (tractor.target.y - tractor.position.y) * 0.4;
    tractor.heading = lerpAngle(tractor.heading, combine.angle + TRACTOR_HEADING_OFFSET, 0.25);
    const unloadRate = UNLOAD_RATE * UNLOAD_RATE_ATTACHED_MULTIPLIER;
    const unloadDelta = unloadRate * simDeltaMinutes;
    if (tank.current > 0) {
      tank.current = Math.max(0, tank.current - unloadDelta);
      tractor.trailerFill = Math.min(TRAILER_CAPACITY, tractor.trailerFill + unloadDelta);
    }
    if (tank.current <= 0.001) {
      tractor.state = "leaving";
      tractor.leaveTimer = TRACTOR_LEAVE_SIM_MIN;
      unloadCount += 1;
      statusMessage = "Abladen abgeschlossen.";
    }
  } else if (tractor.state === "leaving") {
    tractor.leaveTimer -= simDeltaMinutes;
    tractor.position.x += (FIELD_WIDTH + 120 - tractor.position.x) * 0.1;
    tractor.heading = lerpAngle(tractor.heading, 0, 0.1);
    if (tractor.leaveTimer <= 0) {
      tractor.state = "idle";
      tractor.cooldownTimer = TRACTOR_COOLDOWN_SIM_MIN;
      tractor.trailerFill = 0;
      statusMessage = "Traktor fährt zurück.";
    }
  }

  if (tractor.state === "approaching" || tractor.state === "unloading") {
    keepTractorSeparation();
  }
}

function updateBattery(simDeltaMinutes: number, isHarvesting: boolean, isMoving: boolean) {
  let drain = BATTERY_DRAIN_IDLE;
  if (isHarvesting) {
    drain = BATTERY_DRAIN_HARVEST;
  } else if (isMoving) {
    drain = BATTERY_DRAIN_DRIVE;
  }
  battery.current = Math.max(0, battery.current - drain * simDeltaMinutes);
}

function sweepHarvest(simDeltaMinutes: number, from: Vec2, to: Vec2) {
  if (!(combine.headerActive && !harvestBlocked())) {
    return { harvestedTiles: 0, inCrop: false, harvestedSamples: 0, samples: 0 };
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const sampleSpacing = TILE_SIZE / 2;
  const samples = Math.max(1, Math.ceil(dist / sampleSpacing));
  let harvestedTilesCount = 0;
  let harvestedSamples = 0;
  let inCrop = false;
  let harvestedTons = 0;

  for (let i = 0; i < samples; i++) {
    const t = samples === 1 ? 1 : i / (samples - 1);
    const pos = { x: from.x + dx * t, y: from.y + dy * t };
    const stamp = stampHarvestArea(pos, combine.angle);
    harvestedTilesCount += stamp.newlyHarvested;
    if (stamp.newlyHarvested > 0) {
      harvestedSamples += 1;
      harvestedTons += stamp.newlyHarvested * TON_PER_TILE;
    }
    inCrop = inCrop || stamp.inCrop;
  }

  if (harvestedSamples > 0 && harvestedTons > 0) {
    tank.current = clamp(tank.current + harvestedTons, 0, tank.capacity);
    lastHarvestRateTPerMin = harvestedTons / simDeltaMinutes;
  }

  return { harvestedTiles: harvestedTilesCount, inCrop, harvestedSamples, samples };
}

function stampHarvestArea(position: Vec2, angle: number) {
  const forward: Vec2 = { x: Math.cos(angle), y: Math.sin(angle) };
  const right: Vec2 = { x: -Math.sin(angle), y: Math.cos(angle) };
  const widthHalf = (HEADER_WIDTH_TILES * TILE_SIZE) / 2;
  const depthHalf = (HEADER_DEPTH_TILES * TILE_SIZE) / 2;
  const centerX = position.x + forward.x * (HEADER_OFFSET + depthHalf);
  const centerY = position.y + forward.y * (HEADER_OFFSET + depthHalf);

  const minTileX = Math.max(0, Math.floor((centerX - widthHalf - depthHalf - TILE_SIZE) / TILE_SIZE));
  const maxTileX = Math.min(FIELD_WIDTH_TILES - 1, Math.ceil((centerX + widthHalf + depthHalf + TILE_SIZE) / TILE_SIZE));
  const minTileY = Math.max(0, Math.floor((centerY - widthHalf - depthHalf - TILE_SIZE) / TILE_SIZE));
  const maxTileY = Math.min(FIELD_HEIGHT_TILES - 1, Math.ceil((centerY + widthHalf + depthHalf + TILE_SIZE) / TILE_SIZE));

  let newlyHarvested = 0;
  let inCrop = false;
  for (let y = minTileY; y <= maxTileY; y++) {
    for (let x = minTileX; x <= maxTileX; x++) {
      const worldX = x * TILE_SIZE + TILE_SIZE / 2;
      const worldY = y * TILE_SIZE + TILE_SIZE / 2;
      const relX = worldX - centerX;
      const relY = worldY - centerY;
      const forwardDist = relX * forward.x + relY * forward.y;
      const rightDist = relX * right.x + relY * right.y;
      if (Math.abs(forwardDist) <= depthHalf + TILE_SIZE * 0.4 && Math.abs(rightDist) <= widthHalf + TILE_SIZE * 0.4) {
        if (tiles[tileIndex(x, y)] === 0) {
          newlyHarvested += 1;
        }
        setTileHarvested(x, y);
        inCrop = true;
      }
    }
  }
  return { newlyHarvested, inCrop };
}

function update(deltaSeconds: number) {
  if (gameState !== "running") return;

  elapsedRealSeconds += deltaSeconds;
  const simDeltaSeconds = deltaSeconds * SIM_SECONDS_PER_REAL_SECOND;
  const simDeltaMinutes = simDeltaSeconds / 60;
  elapsedSimSeconds += simDeltaSeconds;

  const lowBattery = isBatteryLow();
  if (!batterySwap.active && lowBattery && !batterySwapPrompted) {
    statusMessage = "Batterie niedrig: Zur Tauschzone fahren oder B für Wechsel während der Fahrt drücken.";
    batterySwapPrompted = true;
  }
  if (!batterySwap.active && lowBattery && isInBatteryZone(combine.position)) {
    startBatterySwapWithMode("zone");
  }
  if (batterySwap.active) {
    batterySwap.timer = Math.max(0, batterySwap.timer - deltaSeconds);
    const progress = clamp(1 - batterySwap.timer / BATTERY_SWAP_DURATION, 0, 1);
    statusMessage = `${batterySwapPhaseMessage(progress)} (${batterySwapTimerText()})`;
    if (batterySwap.timer <= 0) {
      finishBatterySwap();
    }
  }

  // Movement
  const up = inputState["ArrowUp"] || inputState["KeyW"];
  const down = inputState["ArrowDown"] || inputState["KeyS"];
  const left = inputState["ArrowLeft"] || inputState["KeyA"];
  const right = inputState["ArrowRight"] || inputState["KeyD"];

  const prevPos = { ...combine.position };
  combine.prevPosition = prevPos;
  let moving = false;
  let harvestResult = { harvestedTiles: 0, inCrop: false, harvestedSamples: 0, samples: 0 };

  // Turning
  const steer = (left ? -1 : 0) + (right ? 1 : 0);
  if (steer !== 0) {
    const turnRate = TURN_SPEED_RAD_PER_SEC * (turnEaseTimer > 0 ? TURN_EASE_MULTIPLIER : 1);
    combine.angle += steer * turnRate * deltaSeconds;
  }

  // Forward/back movement along heading
  let moveAmount = 0;
  if (up) moveAmount += 1;
  if (down) moveAmount -= 1;

  if (moveAmount !== 0) {
    moving = true;
    const speedMultiplier = (batterySwap.active ? 0.5 : 1) * (tractor.state === "unloading" ? TRACTOR_ALONGSIDE_SPEED_MULTIPLIER : 1);
    const speed = COMBINE_SPEED_PPS * (moveAmount > 0 ? 1 : REVERSE_SPEED_FACTOR) * speedMultiplier;
    const forward = { x: Math.cos(combine.angle), y: Math.sin(combine.angle) };
    combine.position.x += forward.x * speed * deltaSeconds * Math.sign(moveAmount);
    combine.position.y += forward.y * speed * deltaSeconds * Math.sign(moveAmount);
    combine.position.x = clamp(combine.position.x, -WORLD_MARGIN, FIELD_WIDTH + WORLD_MARGIN);
    combine.position.y = clamp(combine.position.y, -WORLD_MARGIN, FIELD_HEIGHT + WORLD_MARGIN);
  }

  // Harvesting and resources
  harvestResult = sweepHarvest(simDeltaMinutes, prevPos, combine.position);
  const harvestingActive = harvestResult.harvestedSamples > 0 && combine.headerActive && !harvestBlocked();
  updateBattery(simDeltaMinutes, harvestingActive, moving && !harvestingActive);

  // Tractor and tank enforcement
  if (harvestBlocked()) {
    combine.headerActive = false;
    statusMessage = "Tank voll – Ernte pausiert. Traktor rufen.";
  }
  updateTractor(simDeltaMinutes);

  // End condition
  if (harvestedTiles >= TOTAL_TILES) {
    endGame("Feld geerntet");
  } else if (elapsedRealSeconds >= REAL_TIME_LIMIT_SECONDS) {
    endGame("Zeitlimit erreicht");
  }

  // Handle ease timer and angle snapshot
  const angleDelta = normalizeAngle(combine.angle - lastAngleSnapshot);
  if (Math.abs(angleDelta) > Math.PI * 0.9) {
    turnEaseTimer = TURN_EASE_DURATION;
  } else if (turnEaseTimer > 0) {
    turnEaseTimer = Math.max(0, turnEaseTimer - deltaSeconds);
  }
  lastAngleSnapshot = combine.angle;
}

function render() {
  resizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Light green surroundings outside the field
  ctx.fillStyle = "#a7e3b0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const camX = combine.position.x - canvas.width / 2;
  const camY = combine.position.y - canvas.height / 2;

  const startTileX = clamp(Math.floor(camX / TILE_SIZE) - 2, 0, FIELD_WIDTH_TILES - 1);
  const endTileX = clamp(Math.ceil((camX + canvas.width) / TILE_SIZE) + 2, 0, FIELD_WIDTH_TILES - 1);
  const startTileY = clamp(Math.floor(camY / TILE_SIZE) - 2, 0, FIELD_HEIGHT_TILES - 1);
  const endTileY = clamp(Math.ceil((camY + canvas.height) / TILE_SIZE) + 2, 0, FIELD_HEIGHT_TILES - 1);

  for (let y = startTileY; y <= endTileY; y++) {
    for (let x = startTileX; x <= endTileX; x++) {
      const harvested = tiles[tileIndex(x, y)] === 1;
      renderTile(x, y, harvested, camX, camY);
    }
  }

  drawBatteryZone(camX, camY, performance.now());
  drawTractorPath(camX, camY);
  drawMarkers(camX, camY, performance.now());
  drawTractor(camX, camY);
  drawBatteryCarrier(camX, camY, performance.now());
  drawCombine(camX, camY);
  drawHud(performance.now());
}

function resizeCanvas() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function loop(timestamp: number) {
  const delta = Math.min((timestamp - lastTimestamp) / 1000, 0.1);
  lastTimestamp = timestamp;
  update(delta);
  render();
  requestAnimationFrame(loop);
}

// Event listeners
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (gameState !== "running" && e.key === "Enter") {
    startGame();
    return;
  }
  inputState[e.code] = true;
  handleInputToggle(e.key);
});

window.addEventListener("keyup", (e) => {
  inputState[e.code] = false;
});

startButton.addEventListener("click", () => startGame());
restartButton.addEventListener("click", () => startGame());

toggleLogBtn.addEventListener("click", () => {
  const hidden = swapListEl.style.display === "none";
  swapListEl.style.display = hidden ? "flex" : "none";
  toggleLogBtn.textContent = hidden ? "Ausblenden" : "Einblenden";
});
exportLogBtn.addEventListener("click", () => exportLogToCsv());

resetGame();
loop(performance.now());
