# Mähdresch Simulator – Game Design Document (Study Version)

## 1. Short Description

The **Mähdresch Simulator** is a browser-based 2D game that simulates the combine harvesting process on a wheat field.  
Playtime is about **10 minutes (real time)** and represents a much longer realistic harvesting period (e.g. about 40 minutes).

The player:

- controls a combine harvester in top-down view across a field,
- clearly recognizes **visually** which areas have already been harvested,
- monitors a **grain tank fill indicator** and calls a **tractor with trailer** for unloading when needed,
- monitors a **battery indicator (State of Charge, SoC)**,
- can freely choose via a key press **when a battery swap could theoretically take place** – independent of a concrete technical solution or fixed swap station.

When the battery swap key is pressed, the area around the combine harvester is marked with a **green circle** (hypothetical swap point). These events are logged with time, position and SoC for the study, but in this version they do **not** yet affect the functionality of the vehicle.

---

## 2. Basic Parameters & Scaling

### 2.1 Time and Area Scaling

- **Real-time playtime:** 10 minutes  
- **Simulated harvesting time:** approx. 40 minutes  
  → Playtime is about **4× accelerated** compared to the “real” simulation.

### 2.2 Field and Yield

- Field size (simulated): **4 ha**  
- Yield: **9 t/ha** (e.g. winter wheat)  
- Total yield:  
  → 4 ha × 9 t/ha = **36 t of grain**

### 2.3 Combine Performance Data

- Field capacity: **6 ha/h**  
- Time required for 4 ha (simulation time):  
  → 4 ha / 6 ha/h ≈ **0.67 h ≈ 40 minutes**  
- Due to time scaling this equals about **10 minutes real time**.

### 2.4 Grain Tank & Unloading

- **Combine grain tank capacity:** 12 t  
- Mass flow into the tank during harvesting:
  - Field capacity: 6 ha/h = 0.1 ha/min  
  - Yield: 9 t/ha  
  → 0.1 ha/min × 9 t/ha = **0.9 t/min (simulation time)**
- Time until tank is full (simulation time):  
  → 12 t / 0.9 t/min ≈ **13.3 minutes**  
  → In real time (× 4 faster): approx. **3.3 minutes**

### 2.5 Battery (Theoretical Model)

- **Battery capacity:** 350 kWh  
- Orientation (realistic energy demand, not strictly enforced in gameplay):
  - e.g. about **200 kWh/ha** at full load → For 4 ha this would be approx. 800 kWh.
- In this version:
  - The battery indicator simulates realistic consumption.
  - The battery **does not yet strictly limit gameplay** (the machine does not stop at 0 %).
  - The battery swap key is only used to **mark hypothetical swap moments**.

---

## 3. Visual Representation of the Field

### 3.1 Top-Down View and Tiles

The field is displayed in top-down view as a **grid of tiles**. Each tile represents a small piece of area (e.g. 2×2 m, depending on the technical implementation).

Each tile has two states:

1. **“Unharvested wheat”**  
2. **“Already harvested wheat”**

### 3.2 Visual Variant 1 – Unharvested Wheat

Characteristics (art suggestion):

- Colour: rich **golden yellow**, rather warm.
- Structure:
  - dense, slightly waving ears of grain,
  - vertical and slightly curved lines (stems),
  - high texture density (looks “full” and alive).
- Edges: soft, hardly any soil visible.
- Optional: simple frame animation for slight “wind movement”.

Interpretation:  
→ This area still needs to be harvested.

### 3.3 Visual Variant 2 – Harvested Wheat

Characteristics (art suggestion):

- Colour: clearly **paler / more brownish**, less saturated.
- Structure:
  - short **stubble** instead of full heads,
  - more visible soil (earthy brown or grey tones),
  - horizontal lines or wheel tracks indicating machine traffic.
- Edges: clearer, more structured, looks “cleared”.

Interpretation:  
→ This area has already been harvested.

### 3.4 Dynamic Update When Driving Over the Field

- The combine has a certain **header width** (in tiles), e.g. 6 m → several tiles next to each other.
- As soon as the combine with activated header moves over “unharvested” tiles:
  - Tile state switches from **“unharvested” → “harvested”**.
  - Immediate graphical update:
    - Tile texture changes to the “stubble variant”.
- As a result it is always **clearly visible** which parts of the field have already been processed:
  - visually in the game area,
  - additionally as a **percentage display** in the HUD (“Field: 37 % harvested”).

---

## 4. Core Gameplay

### 4.1 Controls & Movement

- View: **Top-down**, combine seen from above.  
- Movement:
  - Arrow keys or WASD for steering (left/right/forward/backward).
  - Typical loop: drive rows across the field, turn at the field edge, start the next pass.
- Header (harvesting function):
  - Activated / deactivated e.g. with **SPACE**.
  - Only when the header is active and the combine is on “unharvested” tiles:
    - the **harvested area** increases,
    - the **grain tank** fills,
    - **energy consumption** is higher,
    - the tiles are switched to “harvested”.

### 4.2 Grain Tank Mechanics

#### HUD Indicators

- **Grain tank fill bar** (0–100 %).  
- **Text display** such as:
  - “Tank: 65 % (7.8 t)”
  - “Tank full in: 04:10 [sim-min]”

#### Calculating the “Tank full in …” Timer

- Current grain tank content: `B` (in t)  
- Capacity: `B_max = 12 t`  
- Yield rate: `R = 0.9 t/sim-min`  
- Remaining to full: `B_rest = B_max - B`  
- Remaining time (simulation time):  
  `t_rest_sim = B_rest / R`  
- HUD display:
  - “Tank full in **t_rest_sim** minutes”  
  → Countdown runs down at a 4:1 ratio to real time.

#### Tractor with Trailer

- Call: e.g. key **T**.  
- Precondition (optional gameplay rule):
  - Grain tank fill level above a certain threshold (e.g. > 60 %).
  - Minimum time since last call (cooldown, e.g. 2 sim-minutes).
- After the call:
  - Tractor drives from the field edge to the combine (predefined route).
  - Arrival after e.g. 2–3 sim-minutes (about 30–45 seconds in real time).

#### Unloading on the Move

- When the tractor reaches the combine:
  - It drives side by side.
  - Unloading starts automatically:
    - The combine’s grain tank level decreases.
    - (Optional) Trailer fill level increases.
- Example unloading capacity:
  - **4 t/sim-minute** → A nearly full tank (≈ 12 t) is emptied in about 3 sim-minutes.
- If the tractor is not present when the tank is full:
  - The combine can still move but **cannot harvest**:
    - Header is deactivated automatically,
    - HUD message: “Grain tank full – Harvest interrupted.”

---

## 5. Battery Indicator & Hypothetical Battery Swap Marking

### 5.1 Battery Indicator (SoC)

The battery is intended to provide a realistic feeling for energy consumption but is **not** yet decisive for gameplay in this version.

- Display:
  - **SoC bar** (0–100 %).
  - Text: “Battery: 78 % (theoretical remaining).”
- Consumption logic (example values):
  - **Harvesting (header on, in crop):**
    - high consumption, e.g. 20 kWh/sim-minute.
  - **Driving without harvesting:**
    - e.g. 5 kWh/sim-minute.
  - **Standstill with systems active:**
    - e.g. 1 kWh/sim-minute.
- At 0 % SoC:
  - In this version, the combine still keeps moving.
  - HUD note:
    - “Battery would be empty in a real scenario (no battery swap performed).”
- Goal in this phase:
  - Players develop a feel for:
    - how fast the battery drains during harvesting,
    - at which points they would **intuitively** plan a battery swap.

### 5.2 Key for Choosing a Hypothetical Battery Swap

Instead of simulating a real technical swap, we only mark the **moments and locations** at which the player **would perform a battery swap**.

#### Input & Effect

- Key for hypothetical battery swap: e.g. **S**.  
- On key press:
  - **No** actual battery change takes place.
  - **No** interruption, no standstill, no SoC reset.
  - Instead:
    - A **green glowing circle** appears around the combine (circular marker).
    - The circle may pulse slightly or remain visible for a few seconds before fading.
    - Optional: a small text label:
      - “Hypothetical Battery Swap #1”
      - with timestamp and SoC in a log panel.

#### Visual Design of the Marker

- **Shape:** Circle around the combine (thin outline + semi-transparent fill).  
- **Colour:** vivid green (e.g. #00FF66) as a signal for “energy / infrastructure action”.  
- **Duration:** e.g. visible for 2–3 seconds with a subtle pulsing alpha animation.  
- With multiple presses of S:
  - Either:
    - multiple markers with numbering (Swap #1, #2, #3),
    - or short-lived markers with full logging in the background.

#### Logging for the Study

Each key press for a hypothetical battery swap records:

- **Time** in simulation time and real time,
- **Position** of the combine on the field (x/y coordinates),
- **current SoC**,
- **current grain tank level**,
- **current field progress** (% harvested),
- optional: context (tractor nearby? tank almost full?).

This allows later reconstruction of behavioural patterns, e.g.:

- “When would most players plan a swap?”  
- “Do they prefer field edges or the middle of the field?”  
- “What role does tank fill level play?”

---

## 6. HUD Design & Information Architecture

### 6.1 HUD Elements (Suggestion)

Arranged at the top or side of the screen:

1. **Field Progress**
   - “Field: 32 % harvested”
   - Optional bar.

2. **Grain Tank**
   - Bar + text:
     - “Tank: 70 % (8.4 t)”
     - “Tank full in: 04:10 [sim-min]”

3. **Battery**
   - Bar + text:
     - “Battery: 64 % (theoretical SoC)”
   - Optional info:
     - “Consumption: High / Medium / Low”

4. **Timer**
   - Playtime (real time): “Playtime: 06:15”
   - Simulation time: “Sim-time: 24:40”

5. **Hypothetical Battery Swap Information**
   - List (e.g. in the bottom area):
     - “Swap #1 – Sim 08:30 – SoC 72 % – Tank 40 %”
     - “Swap #2 – Sim 19:10 – SoC 31 % – Tank 85 %”
   - This list may optionally be shown only at the end of the game.

---

## 7. Gameplay Flow (Loop)

### 7.1 Start

1. Display a **short tutorial**:
   - Controls: movement, header, tractor call, swap marking.
   - Explanation of indicators (tank, battery, field progress).
   - Note: “Battery swap is only a hypothetical marker in this version.”
2. Player starts at the field edge, header off.  
3. Pressing **SPACE** (or similar) activates the header and harvesting begins.

### 7.2 Main Phase

Repeating loop:

1. **Harvest a row**
   - Straight pass across unharvested tiles.
   - Tiles switch from “full wheat” to “stubble view”.
   - Tank fill level increases, battery level decreases.

2. **Monitor indicators**
   - Observe fill levels and timers:
     - “Tank full in …”
     - “Battery … % (theoretical)”
   - Player uses this information to:
     - call the tractor in time,
     - set hypothetical swap points (key S).

3. **Tractor Call & Unloading**
   - Tractor arrives, drives alongside, grain tank is emptied.
   - Player can continue harvesting while unloading (smooth workflow).

4. **Hypothetical Battery Swaps**
   - At subjectively appropriate moments:
     - Player presses key **S**.
     - Green circle marks position.
     - Event is logged.

5. **Turning & Next Row**
   - At the end of the field, header may be switched off briefly, then turn, next pass, header on again.
   - Visual change of the field shows progress.

### 7.3 End of Game

The game ends when:

- **100 % of the field area is harvested**, or  
- **10 minutes of real time** have elapsed (depending on study setup).

At the end, a **results screen** is shown:

- Percentage of harvested field.
- Number of tractor calls and unloading events.
- Final status / progression of battery and tank.
- List of all hypothetical battery swap markers with:
  - Sim time,
  - Position,
  - SoC,
  - tank level,
  - field progress.

---

## 8. Outlook: Integrating a “Real” Battery Swap (For Later)

For a later version (not part of this specification, but prepared conceptually):

- The already existing hypothetical swap points could be turned into:
  - real **battery swap events** with SoC reset and time penalties,
  - technical constraints (position at field edge, dedicated swap station).
- The current design is deliberately structured so that:
  - the SoC model, swap key and logging already exist,
  - future extension to a real battery swap mechanic is possible without a complete redesign.
