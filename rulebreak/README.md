# RULEBREAK — Reality Arena (prototype v0.1)

A fast top-down 3v3 arena brawler where every hero can **break one rule of the arena**:
invert gravity in a zone, split into a copy of yourself, or bend light around corners.
The arena also fights back: shoot a Chrono Pylon and time freezes around it.

Browser-playable. Built with three.js r149 (vendored in `vendor/`, so it works offline).
Everything else is procedural: models, particles, shaders and sound. There are no asset files.

## Launch locally

Option A, just open it: double-click `rulebreak/index.html`. It runs from `file://` because all
scripts are plain `<script>` tags with no modules or fetches.

Option B, serve it (recommended, avoids any browser file-access quirks):

```bash
cd rulebreak
python3 -m http.server 8000
# then open http://localhost:8000
```

(`npx serve rulebreak` works too.) Use a desktop browser with a mouse and keyboard. Chrome, Edge or Firefox recommended.

## Controls

| Input | Action |
|---|---|
| `W A S D` / arrows | Move |
| Mouse | Aim |
| Hold left mouse | Attack (3 charges, auto-reload) |
| `Space` / `Shift` | Movement skill |
| `E` / right mouse | **Break a Rule** (Vex: hold to aim, release to cast) |
| `Esc` / `P` | Pause |
| `R` / `Enter` on results | Play again |

## Mode: Rift Control (3v3 with bots)

- Stand in the glowing **Rift** with no enemies inside to fill your team's meter. First to **100%** wins.
- A knockout adds **+3%**. The Rift **shifts** location every 40 s, and a ghost ring previews where it is going.
- After 3 minutes the higher meter wins.
- Health regenerates after a few seconds out of combat. Knocked-out heroes respawn after 3.5 s.

## Heroes

| Hero | Attack | Move | Rule |
|---|---|---|---|
| **VEX**, Gravity Breaker | Shard Burst: 5-shard shotgun fan | Ram: charge that knocks enemies back | **UPFALL**: inverts gravity in a target zone. Enemies float helplessly, their shots fall into the sky, then everyone caught slams down for damage. |
| **MIRRA**, Paradox Twin | Twin Bolts: rapid paired shots | Blink: short teleport | **ECHO**: a Twin copies your moves and shots and converges fire on your aim point. Press again to swap places. It detonates when it fades. |
| **PRISM**, Light Bender | Lance: long piercing beam | Glide: high-speed skate, refunds a charge | **BENDLIGHT**: for 5 s your shots curve around walls to hunt the nearest enemy, and you reload twice as fast. |

Landing hits shortens your Rule cooldown.

## Arena interactables

- **Chrono Pylons** (cyan crystals, north and south): shoot one to freeze time in a radius. Units and bullets inside stop. It recharges after 14 s.
- **Launch Pads** (green, in the corners): step on one to vault across the map. Landing damages nearby enemies.
- **Data Crates** (amber bands): breakable cover. Bot pathing updates when one breaks.

## Settings

The main menu sets bot difficulty (Easy / Normal / Hard, which applies to enemy bots) and toggles SFX, music and screen shake.
Settings are saved in `localStorage`.

Debug: append `?speed=4` to the URL to fast-forward the simulation. `window.__RB` exposes the game state in the console.

## Code map

```
rulebreak/
  index.html       UI markup (menus, select, HUD, modals)
  style.css        UI styling
  js/audio.js      WebAudio synth SFX + generative music loop
  js/fx.js         pooled GPU particles, shockwave rings, glow textures
  js/heroes.js     hero stats/abilities + procedural hero models
  js/arena.js      map layout, collision, Dijkstra flow-field pathfinding
  js/game.js       simulation, abilities, bots, match flow, camera, HUD, menus
  vendor/three.min.js
```
