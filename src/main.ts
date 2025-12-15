import "./style.css";

type GameState = "tutorial" | "running" | "ended";
type TractorState = "idle" | "approaching" | "unloading" | "leaving";
type SwapMode = "stationary" | "inline";

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
  sideMultiplier: number;
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
const batteryZonePanel = document.getElementById("battery-zone-panel") as HTMLElement;
const batteryZoneStatusEl = document.getElementById("battery-zone-status")!;
const batteryZoneTimerEl = document.getElementById("battery-zone-timer")!;
const batteryZoneMessageEl = document.getElementById("battery-zone-message")!;

// Combine sprite
const combineImage = new Image();
combineImage.src = "draufsicht-des-maehdreschers-133656179.jpg.png";
let combineImageReady = false;
combineImage.onload = () => {
  combineImageReady = true;
};
if (combineImage.complete) combineImageReady = true;

// Constants based on the design document
// --- Scale (single source of truth) ---
const FIELD_SIZE_CM = 140; // square field: 140 cm × 140 cm (4× area)
const PIXELS_PER_CM = 10; // 10 px = 1 cm on screen
const CM_PER_TILE = 1;    // 1 cm per tile for the wheat grid
const TILE_SIZE = PIXELS_PER_CM * CM_PER_TILE; // 10 px per tile

const FIELD_WIDTH_CM = FIELD_SIZE_CM;
const FIELD_HEIGHT_CM = FIELD_SIZE_CM;

const METERS_PER_TILE = CM_PER_TILE / 100;
const PIXELS_PER_METER = TILE_SIZE / METERS_PER_TILE;

const FIELD_WIDTH_TILES = Math.round(FIELD_WIDTH_CM / CM_PER_TILE);   // 140 tiles
const FIELD_HEIGHT_TILES = Math.round(FIELD_HEIGHT_CM / CM_PER_TILE); // 140 tiles
const FIELD_WIDTH = FIELD_WIDTH_TILES * TILE_SIZE;    // 1400 px
const FIELD_HEIGHT = FIELD_HEIGHT_TILES * TILE_SIZE;  // 1400 px
const TOTAL_TILES = FIELD_WIDTH_TILES * FIELD_HEIGHT_TILES;
// yield model
const YIELD_T_PER_HA = 9;              // 9 t/ha
const HARVEST_YIELD_SCALE = 22120;     // tuned so a fully harvested field yields ~3 full tank loads

// derived
const TONS_PER_M2 = YIELD_T_PER_HA / 10000;
const TON_PER_TILE = TONS_PER_M2 * (METERS_PER_TILE * METERS_PER_TILE) * HARVEST_YIELD_SCALE;
// 9 t/ha yield, scaled up

const SIM_SECONDS_PER_REAL_SECOND = 4;
const REAL_TIME_LIMIT_SECONDS = 10 * 60;

const HEADER_WIDTH_TILES = 10 / CM_PER_TILE; // cutting width reduced by 4 tiles
const HEADER_DEPTH_TILES = 3.5 / CM_PER_TILE;
const HEADER_OFFSET = TILE_SIZE * (4 / CM_PER_TILE);
const HEADER_VISUAL_SHIFT_TILES = 3 / CM_PER_TILE; // push visible cutter forward

const TARGET_COMBINE_SPEED_PPS = 34; // keep on-screen speed consistent on the larger field
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
const UNLOAD_RATE = 4; // t per sim minute
const TANK_MIN_CALL_THRESHOLD = 0.6 * TANK_CAPACITY;

const BATTERY_CAPACITY_KWH = 210; // lasts ~1:30 under harvest load
const BATTERY_DRAIN_HARVEST = 35; // kWh per sim minute (faster drain)
const BATTERY_DRAIN_DRIVE = 10;
const BATTERY_DRAIN_IDLE = 2;

const TRACTOR_COOLDOWN_SIM_MIN = 2;
const TRACTOR_ARRIVAL_SIM_MIN = 1.25; // faster arrival (previously 2.5)
const TRACTOR_LEAVE_SIM_MIN = 1.5;
const TRACTOR_OFFSET = 70;
const TRAILER_CAPACITY = 20; // t visual only

// Start below the field, centered horizontally, outside the crop
const COMBINE_START: Vec2 = { x: FIELD_WIDTH * 0.5, y: FIELD_HEIGHT + 120 };
const BATTERY_ZONE_POSITION: Vec2 = { x: FIELD_WIDTH * 0.5 + 280, y: FIELD_HEIGHT + 220 }; // shifted further right of start
const BATTERY_ZONE_RADIUS = 140;
const BATTERY_SWAP_TRIGGER_PERCENT = 20;
const BATTERY_SWAP_DURATION_SECONDS = 30;
const BATTERY_SWAP_MESSAGES = [
  "Replacing the previous battery.",
  "Empty battery is being removed",
  "New battery is being inserted."
];


let tiles = new Uint8Array(TOTAL_TILES);
let harvestedTiles = 0;

const combine = {
  position: { ...COMBINE_START },
  prevPosition: { ...COMBINE_START },
  angle: -Math.PI / 2, // face upward toward the field from the bottom start
  headerActive: false
};

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
  trailerFill: 0,
  sideMultiplier: 1
};

let tractorCalls = 0;
let unloadCount = 0;

let swapEvents: SwapEvent[] = [];
let markers: SwapMarker[] = [];
let swapCounter = 0;

const batterySwap = {
  active: false,
  elapsed: 0,
  remaining: 0,
  stageIndex: 0,
  mode: "stationary" as SwapMode
};

let batteryLowPrompted = false;
const batteryCarrier = {
  active: false,
  position: { x: -200, y: -200 },
  sideMultiplier: 1,
  offset: TRACTOR_OFFSET
};

function requestBatteryCarrier() {
  if (batterySwap.active) {
    statusMessage = "Battery swap already in progress.";
    return;
  }
  const tractorBusy = tractor.state !== "idle";
  const side = { x: Math.sin(combine.angle), y: -Math.cos(combine.angle) };
  const sideMultiplier = tractorBusy ? -1 : 1;
  batteryCarrier.sideMultiplier = sideMultiplier;
  batteryCarrier.active = true;
  const offset = batteryCarrier.offset;
  batteryCarrier.position = {
    x: combine.position.x + side.x * offset * sideMultiplier,
    y: combine.position.y + side.y * offset * sideMultiplier
  };
  startBatterySwap("inline");
  statusMessage = tractorBusy
    ? "Battery carrier arrived opposite the tractor."
    : "On-the-move battery swap started.";
}

const inputState: Record<string, boolean> = {};

let gameState: GameState = "tutorial";
let lastTimestamp = performance.now();
let elapsedRealSeconds = 0;
let elapsedSimSeconds = 0;
let statusMessage = "Ready";
let turnEaseTimer = 0;
let lastAngleSnapshot = 0;

function resetGame() {
  tiles = new Uint8Array(TOTAL_TILES);
  harvestedTiles = 0;
  combine.position = { ...COMBINE_START }; // start below the field
  combine.prevPosition = { ...combine.position };
  combine.angle = -Math.PI / 2; // face upward toward the field from the bottom
  combine.headerActive = false;
  tank.current = 0;
  battery.current = BATTERY_CAPACITY_KWH;
  lastHarvestRateTPerMin = TANK_INFLOW_RATE;
  tractor.state = "idle";
  tractor.arrivalTimer = 0;
  tractor.leaveTimer = 0;
  tractor.cooldownTimer = 0;
  tractor.position = { x: -120, y: FIELD_HEIGHT / 2 };
  tractor.target = { x: 0, y: FIELD_HEIGHT / 2 };
  tractor.trailerFill = 0;
  tractor.sideMultiplier = 1;
  tractorCalls = 0;
  unloadCount = 0;
  swapCounter = 0;
  swapEvents = [];
  markers = [];
  batterySwap.active = false;
  batterySwap.elapsed = 0;
  batterySwap.remaining = 0;
  batterySwap.stageIndex = 0;
  batterySwap.mode = "stationary";
  batteryLowPrompted = false;
  batteryCarrier.active = false;
  batteryCarrier.position = { x: -200, y: -200 };
  batteryCarrier.sideMultiplier = 1;
  elapsedRealSeconds = 0;
  elapsedSimSeconds = 0;
  turnEaseTimer = 0;
  lastAngleSnapshot = combine.angle;
  statusMessage = "Ready";
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
    `Reason: ${reason}`,
    `Real time: ${realMinutes} min`,
    `Sim time: ${simMinutes} min`,
    `Field harvested: ${fieldPercent} %`,
    `Tank unloads: ${unloadCount}`,
    `Swap markers: ${swapEvents.length}`
  ].join("<br>");
  endSummary.innerHTML = summary;
  endLog.innerHTML = renderEndLog();
  showOverlay(endScreen);
}

function renderEndLog() {
  if (swapEvents.length === 0) {
    return `<div class="entry">No swap markers recorded.</div>`;
  }
  return swapEvents
    .map((event) => {
      const real = formatTime(event.realSeconds);
      const sim = formatSimTime(event.simSeconds);
      return `<div class="entry">#${event.id} — ${sim} / ${real}<br>SoC ${event.battery.toFixed(0)} % · Tank ${event.tank.toFixed(0)} % · Field ${event.field.toFixed(0)} %</div>`;
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
  if (key === " ") {
    if (!harvestBlocked()) {
      combine.headerActive = !combine.headerActive;
    }
  }
  if (key === "t" || key === "T") {
    requestTractor();
  }
  if (key === "b" || key === "B") {
    requestBatteryCarrier();
  }
}

function harvestBlocked() {
  if (batterySwap.active && batterySwap.mode === "stationary") return true;
  return tank.current >= tank.capacity - 0.001 && tractor.state !== "unloading";
}

function requestTractor() {
  if (tractor.state !== "idle") {
    statusMessage = "Tractor already en route or unloading.";
    return;
  }
  if (tractor.cooldownTimer > 0) {
    statusMessage = "Tractor on cooldown.";
    return;
  }
  const side = { x: Math.sin(combine.angle), y: -Math.cos(combine.angle) };
  const tractorSideMultiplier = batteryCarrier.active ? -batteryCarrier.sideMultiplier : 1;
  tractor.sideMultiplier = tractorSideMultiplier;
  tractor.state = "approaching";
  tractor.arrivalTimer = TRACTOR_ARRIVAL_SIM_MIN;
  tractor.arrivalDuration = TRACTOR_ARRIVAL_SIM_MIN;
  tractor.target = {
    x: combine.position.x + side.x * TRACTOR_OFFSET * tractorSideMultiplier,
    y: combine.position.y + side.y * TRACTOR_OFFSET * tractorSideMultiplier
  };
  tractor.position = { x: -120, y: tractor.target.y };
  tractorCalls += 1;
  statusMessage = "Tractor called.";
}

function dropSwapMarker() {
  if (gameState !== "running") return;
}

function batteryPercent() {
  return clamp((battery.current / battery.capacity) * 100, 0, 100);
}

function tankPercent() {
  return clamp((tank.current / tank.capacity) * 100, 0, 100);
}

function isInBatteryZone(position: Vec2) {
  const dx = position.x - BATTERY_ZONE_POSITION.x;
  const dy = position.y - BATTERY_ZONE_POSITION.y;
  return Math.hypot(dx, dy) <= BATTERY_ZONE_RADIUS;
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

  // Grain tank fill overlay with thirds markers (to track repeated unloads)
  const tankRatio = tankPercent() / 100;
  const barWidth = COMBINE_SIZE.w - 20;
  const barHeight = 12;
  const barX = -COMBINE_SIZE.w / 2 + 10;
  const barY = -COMBINE_SIZE.h / 2 - 16;
  ctx.fillStyle = "rgba(12,18,22,0.85)";
  ctx.fillRect(barX, barY, barWidth, barHeight);
  ctx.fillStyle = "#f9d54c";
  ctx.fillRect(barX, barY, barWidth * tankRatio, barHeight);
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barWidth, barHeight);
  // Third markers to hint at multiple unloads over the full field
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.moveTo(barX + barWidth / 3, barY);
  ctx.lineTo(barX + barWidth / 3, barY + barHeight);
  ctx.moveTo(barX + (barWidth * 2) / 3, barY);
  ctx.lineTo(barX + (barWidth * 2) / 3, barY + barHeight);
  ctx.stroke();
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
  ctx.rotate(combine.angle);

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

function drawBatteryCarrier(camX: number, camY: number) {
  if (!batteryCarrier.active) return;
  const screenX = batteryCarrier.position.x - camX;
  const screenY = batteryCarrier.position.y - camY;
  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.rotate(combine.angle);

  // Carrier base
  ctx.fillStyle = "#4c5f6c";
  ctx.fillRect(-70, -18, 110, 36);
  ctx.fillStyle = "#2c3944";
  ctx.fillRect(-70, -10, 110, 20);

  // Hitch bar
  ctx.fillStyle = "#253038";
  ctx.fillRect(-6, -4, 32, 8);

  // Wheels
  ctx.fillStyle = "#13191f";
  ctx.fillRect(-64, -24, 16, 14);
  ctx.fillRect(-64, 10, 16, 14);
  ctx.fillRect(24, -24, 16, 14);
  ctx.fillRect(24, 10, 16, 14);
  ctx.fillStyle = "#27303a";
  ctx.fillRect(-61, -20, 10, 8);
  ctx.fillRect(-61, 14, 10, 8);
  ctx.fillRect(27, -20, 10, 8);
  ctx.fillRect(27, 14, 10, 8);

  // Battery cargo
  drawBatteryBlock(-10, 0, 1.05);

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

function drawRoundedRect(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBatteryBlock(x: number, y: number, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  const width = 78 * scale;
  const height = 34 * scale;
  const radius = 8 * scale;
  ctx.fillStyle = "#9ca4ad";
  drawRoundedRect(-width / 2, -height / 2, width, height, radius);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#c8d0da";
  ctx.fillRect(-width / 2 + 8 * scale, -height / 2 - 4 * scale, 12 * scale, 6 * scale);
  ctx.fillRect(width / 2 - 20 * scale, -height / 2 - 4 * scale, 12 * scale, 6 * scale);
  // Label: centered on the battery
  ctx.font = `bold ${11 * scale}px "Inter", "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e9eef4";
  ctx.fillText("Batterie", 0, 0);
  ctx.restore();
}

function drawBatteryZone(camX: number, camY: number, now: number) {
  const screenX = BATTERY_ZONE_POSITION.x - camX;
  const screenY = BATTERY_ZONE_POSITION.y - camY;
  const pulse = (Math.sin(now / 400) + 1) / 2;
  const highlight = batterySwap.active || batteryLowPrompted;

  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.fillStyle = "rgba(16, 28, 36, 0.85)";
  drawRoundedRect(-BATTERY_ZONE_RADIUS, -BATTERY_ZONE_RADIUS, BATTERY_ZONE_RADIUS * 2, BATTERY_ZONE_RADIUS * 2, 24);
  ctx.fill();
  ctx.strokeStyle = `rgba(80, 238, 134, ${highlight ? 0.55 + 0.25 * pulse : 0.35})`;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.setLineDash([12, 10]);
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.28 + 0.18 * pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, BATTERY_ZONE_RADIUS - 18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "rgba(73, 230, 122, 0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-60, 0);
  ctx.lineTo(60, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -60);
  ctx.lineTo(0, 60);
  ctx.stroke();

  ctx.font = "bold 15px \"Inter\", \"Segoe UI\", system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = `rgba(80, 238, 134, ${0.5 + pulse * 0.35})`;
  ctx.fillText("Batterie Wechselzone", 0, -BATTERY_ZONE_RADIUS + 24);

  // Spare batteries
  drawBatteryBlock(92, -30, 0.9);
  drawBatteryBlock(114, 18, 0.9);
  drawBatteryBlock(76, 52, 0.9);

  // Slot outline
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  drawRoundedRect(-58, -20, 116, 40, 10);
  ctx.stroke();

  const stageLength = BATTERY_SWAP_DURATION_SECONDS / BATTERY_SWAP_MESSAGES.length;
  const localProgress = batterySwap.active
    ? clamp((batterySwap.elapsed - batterySwap.stageIndex * stageLength) / stageLength, 0, 1)
    : 0;

  let slotBatteryPos = { x: 0, y: -4 };
  if (batterySwap.active) {
    if (batterySwap.stageIndex === 0) {
      slotBatteryPos.y = -6 - localProgress * 14;
    } else if (batterySwap.stageIndex === 1) {
      slotBatteryPos.x = -20 - localProgress * 60;
      slotBatteryPos.y = -10 + localProgress * 22;
    } else {
      const incomingX = 80 * (1 - localProgress);
      const incomingY = -12 + localProgress * 10;
      drawBatteryBlock(incomingX, incomingY, 0.95);
      slotBatteryPos.x = 40 * (1 - localProgress) - 6;
      slotBatteryPos.y = -14 + localProgress * 14;
    }
  } else if (batteryLowPrompted) {
    slotBatteryPos.y = -6 + Math.sin(now / 240) * 4;
  }

  drawBatteryBlock(slotBatteryPos.x, slotBatteryPos.y, 1.05);
  ctx.restore();
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
  const messages: string[] = [];
  if (batterySwap.active) {
    messages.push(`${currentSwapMessage()} (${formatCountdown(batterySwap.remaining)})`);
  } else if (batteryPct <= BATTERY_SWAP_TRIGGER_PERCENT) {
    messages.push("Battery at 20% — drive to the replacement zone to the right of the start point.");
  }
  if (batteryPct <= 0) {
    messages.push("Battery would be empty in a real scenario (no swap performed).");
  }
  messagesEl.innerHTML = messages.join("<br>");
  updateBatteryZonePanel(batteryPct);
}

function updateBatteryZonePanel(batteryPct: number) {
  const inZone = isInBatteryZone(combine.position);
  const awaitingSwap = batteryLowPrompted && !batterySwap.active;
  batteryZoneStatusEl.textContent = inZone ? "Am Ersatzbereich" : "Rechts vom Startpunkt außerhalb des Felds";
  if (batterySwap.active) {
    batteryZoneTimerEl.textContent = `${formatCountdown(batterySwap.remaining)} (${Math.ceil(batterySwap.remaining)} s)`;
    batteryZoneMessageEl.textContent = currentSwapMessage();
    batteryZonePanel.classList.add("attention");
  } else {
    batteryZoneTimerEl.textContent = "--";
    if (awaitingSwap && inZone) {
      batteryZoneMessageEl.textContent = "Stillstehen: Der Batteriewechsel startet jetzt automatisch.";
    } else if (batteryPct <= BATTERY_SWAP_TRIGGER_PERCENT) {
      batteryZoneMessageEl.textContent = "Batterie bei 20 % – fahre zur markierten Zone rechts vom Startpunkt.";
    } else {
      batteryZoneMessageEl.textContent = "Zone bereit für den nächsten Wechsel.";
    }
    batteryZonePanel.classList.toggle("attention", awaitingSwap || batteryPct <= BATTERY_SWAP_TRIGGER_PERCENT);
  }
}

function consumptionLabel() {
  if (combine.headerActive && !harvestBlocked()) return "High";
  const forwardBack = Math.abs(inputState["ArrowUp"] || inputState["KeyW"] ? 1 : 0) +
    Math.abs(inputState["ArrowDown"] || inputState["KeyS"] ? 1 : 0);
  if (forwardBack > 0) return "Medium";
  return "Low";
}

function tractorStatusText() {
  if (tractor.state === "idle") return "Idle";
  if (tractor.state === "approaching") return `En route (${tractor.arrivalTimer.toFixed(1)} sim min)`;
  if (tractor.state === "unloading") return "Unloading";
  if (tractor.state === "leaving") return "Leaving";
  return "Idle";
}

function tankTimerText() {
  if (!(combine.headerActive && !harvestBlocked())) return "--";
  const inflow = Math.max(0.0001, lastHarvestRateTPerMin);
  const remaining = Math.max(0, tank.capacity - tank.current);
  const simMinutes = remaining / inflow;
  return `${simMinutes.toFixed(1)} sim min`;
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatSimTime(simSeconds: number) {
  const simMins = Math.floor(simSeconds / 60);
  const simSecs = Math.floor(simSeconds % 60);
  return `${String(simMins).padStart(2, "0")}:${String(simSecs).padStart(2, "0")} sim`;
}

function formatCountdown(seconds: number) {
  const secs = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function updateSwapList() {
  swapListEl.innerHTML = "";
  swapEvents.slice(-10).forEach((event) => {
    const div = document.createElement("div");
    div.className = "swap-entry";
    const real = formatTime(event.realSeconds);
    const sim = formatSimTime(event.simSeconds);
    div.innerHTML = `#${event.id} – ${sim} / ${real}<br>SoC ${event.battery.toFixed(0)} % · Tank ${event.tank.toFixed(0)} % · Field ${event.field.toFixed(0)} %`;
    swapListEl.appendChild(div);
  });
  if (swapEvents.length > 10) {
    const note = document.createElement("div");
    note.className = "swap-entry";
    note.textContent = `+ ${swapEvents.length - 10} older entries`;
    swapListEl.appendChild(note);
  }
}

function exportLogToCsv() {
  if (swapEvents.length === 0) {
    statusMessage = "No swap markers to export.";
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
  statusMessage = "Swap log exported.";
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
  const side = { x: Math.sin(combine.angle), y: -Math.cos(combine.angle) };
  const targetOffset = {
    x: combine.position.x + side.x * TRACTOR_OFFSET * tractor.sideMultiplier,
    y: combine.position.y + side.y * TRACTOR_OFFSET * tractor.sideMultiplier
  };

  if (tractor.state === "approaching") {
    tractor.target = { ...targetOffset };
    tractor.arrivalTimer -= simDeltaMinutes;
    const t = clamp(1 - tractor.arrivalTimer / tractor.arrivalDuration, 0, 1);
    tractor.position.x = -120 + t * (tractor.target.x + 120);
    tractor.position.y = tractor.target.y;
    if (tractor.arrivalTimer <= 0) {
      tractor.state = "unloading";
      tractor.position = { ...tractor.target };
      statusMessage = "Tractor arrived.";
    }
  } else if (tractor.state === "unloading") {
    tractor.target = { ...targetOffset };
    // Smooth follow
    tractor.position.x += (tractor.target.x - tractor.position.x) * 0.4;
    tractor.position.y += (tractor.target.y - tractor.position.y) * 0.4;
    const unloadDelta = UNLOAD_RATE * simDeltaMinutes;
    if (tank.current > 0) {
      tank.current = Math.max(0, tank.current - unloadDelta);
      tractor.trailerFill = Math.min(TRAILER_CAPACITY, tractor.trailerFill + unloadDelta);
    }
    if (tank.current <= 0.001) {
      tractor.state = "leaving";
      tractor.leaveTimer = TRACTOR_LEAVE_SIM_MIN;
      unloadCount += 1;
      statusMessage = "Unloading complete.";
    }
  } else if (tractor.state === "leaving") {
    tractor.leaveTimer -= simDeltaMinutes;
    tractor.position.x += (FIELD_WIDTH + 120 - tractor.position.x) * 0.1;
    if (tractor.leaveTimer <= 0) {
      tractor.state = "idle";
      tractor.cooldownTimer = TRACTOR_COOLDOWN_SIM_MIN;
      tractor.trailerFill = 0;
      statusMessage = "Tractor heading back.";
    }
  }
}

function updateBatteryCarrier(_deltaSeconds: number) {
  if (!batteryCarrier.active) return;
  const side = { x: Math.sin(combine.angle), y: -Math.cos(combine.angle) };
  const target = {
    x: combine.position.x + side.x * batteryCarrier.offset * batteryCarrier.sideMultiplier,
    y: combine.position.y + side.y * batteryCarrier.offset * batteryCarrier.sideMultiplier
  };
  batteryCarrier.position.x += (target.x - batteryCarrier.position.x) * 0.35;
  batteryCarrier.position.y += (target.y - batteryCarrier.position.y) * 0.35;
  if (!batterySwap.active) {
    batteryCarrier.active = false;
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

function startBatterySwap(mode: SwapMode) {
  if (batterySwap.active) return;
  batterySwap.active = true;
  batterySwap.mode = mode;
  batterySwap.elapsed = 0;
  batterySwap.remaining = BATTERY_SWAP_DURATION_SECONDS;
  batterySwap.stageIndex = 0;
  if (mode === "stationary") {
    combine.headerActive = false;
  }
  statusMessage = BATTERY_SWAP_MESSAGES[0];
}

function updateBatterySwap(deltaSeconds: number) {
  if (!batterySwap.active) return;
  batterySwap.elapsed += deltaSeconds;
  batterySwap.remaining = Math.max(0, BATTERY_SWAP_DURATION_SECONDS - batterySwap.elapsed);
  const segmentLength = BATTERY_SWAP_DURATION_SECONDS / BATTERY_SWAP_MESSAGES.length;
  const newStage = Math.min(BATTERY_SWAP_MESSAGES.length - 1, Math.floor(batterySwap.elapsed / segmentLength));
  if (newStage !== batterySwap.stageIndex) {
    batterySwap.stageIndex = newStage;
    statusMessage = BATTERY_SWAP_MESSAGES[newStage];
  }
  if (batterySwap.remaining <= 0) {
    finishBatterySwap();
  }
}

function finishBatterySwap() {
  batterySwap.active = false;
  batterySwap.elapsed = 0;
  batterySwap.remaining = 0;
  batterySwap.stageIndex = 0;
  batterySwap.mode = "stationary";
  battery.current = battery.capacity;
  batteryLowPrompted = false;
  batteryCarrier.active = false;
  statusMessage = "Battery replaced and ready.";
}

function currentSwapMessage() {
  return BATTERY_SWAP_MESSAGES[batterySwap.stageIndex] || BATTERY_SWAP_MESSAGES[0];
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
  updateBatterySwap(deltaSeconds);
  const swapActive = batterySwap.active;
  const swapMode = batterySwap.mode;
  const movementLocked = swapActive && swapMode === "stationary";
  const speedModifier = swapActive && swapMode === "inline" ? 0.5 : 1;

  // Movement
  const up = inputState["ArrowUp"] || inputState["KeyW"];
  const down = inputState["ArrowDown"] || inputState["KeyS"];
  const left = inputState["ArrowLeft"] || inputState["KeyA"];
  const right = inputState["ArrowRight"] || inputState["KeyD"];

  const prevPos = { ...combine.position };
  combine.prevPosition = prevPos;
  let moving = false;
  let harvestingActive = false;

  if (!movementLocked) {
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
      const speed = COMBINE_SPEED_PPS * speedModifier * (moveAmount > 0 ? 1 : REVERSE_SPEED_FACTOR);
      const forward = { x: Math.cos(combine.angle), y: Math.sin(combine.angle) };
      combine.position.x += forward.x * speed * deltaSeconds * Math.sign(moveAmount);
      combine.position.y += forward.y * speed * deltaSeconds * Math.sign(moveAmount);
      combine.position.x = clamp(combine.position.x, -WORLD_MARGIN, FIELD_WIDTH + WORLD_MARGIN);
      combine.position.y = clamp(combine.position.y, -WORLD_MARGIN, FIELD_HEIGHT + WORLD_MARGIN);
    }

    // Harvesting and resources
    const harvestResult = sweepHarvest(simDeltaMinutes, prevPos, combine.position);
    harvestingActive = harvestResult.harvestedSamples > 0 && combine.headerActive && !harvestBlocked();

    // Tractor and tank enforcement
    if (harvestBlocked()) {
      combine.headerActive = false;
      statusMessage = "Tank full – harvesting paused. Call tractor.";
    }
  } else {
    combine.headerActive = false;
  }

  updateBattery(simDeltaMinutes, harvestingActive, moving && !harvestingActive);
  updateTractor(simDeltaMinutes);
  updateBatteryCarrier(deltaSeconds);

  const batteryPct = batteryPercent();
  if (!batterySwap.active && batteryPct <= BATTERY_SWAP_TRIGGER_PERCENT) {
    batteryLowPrompted = true;
  }
  if (!batterySwap.active && batteryLowPrompted && isInBatteryZone(combine.position)) {
    startBatterySwap("stationary");
  }

  // End condition
  if (harvestedTiles >= TOTAL_TILES) {
    endGame("Field harvested");
  } else if (elapsedRealSeconds >= REAL_TIME_LIMIT_SECONDS) {
    endGame("Time limit reached");
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
  drawMarkers(camX, camY, performance.now());
  drawBatteryCarrier(camX, camY);
  drawTractor(camX, camY);
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
  toggleLogBtn.textContent = hidden ? "Hide" : "Show";
});
exportLogBtn.addEventListener("click", () => exportLogToCsv());

resetGame();
loop(performance.now());
