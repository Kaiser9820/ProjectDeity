# Project Deity

A browser sandbox of the real Solar System: the Sun and eight planets, initialised from JPL Horizons
and moved by a Newtonian N-body integrator. See [SCIENCE.md](SCIENCE.md) for data sources, units and
accuracy limits.

## Run
```
npm install
npm run dev         # http://localhost:5173
npm test            # vitest: physics, data, clock, presentation, console
npm run typecheck
npm run build       # static output in dist/ (Cloudflare Pages: build `npm run build`, output `dist`)
```

## Controls
| Input | Action |
|---|---|
| Click / tap (body, label or list row) | Select; repeat on the same spot to cycle overlapping bodies |
| Double-click / double-tap, or **Move** in the inspector | Edit position (X/Y/Z gizmo or typed coordinates) |
| Drag an axis handle | Move the body along that ecliptic axis; the simulation holds while dragging |
| `Esc` | Cancel the current drag (restores position), then leave edit mode |
| Right-drag (or left-drag in empty space) | Orbit the camera |
| Scroll / pinch | Zoom |
| `W A S D` (`Shift` = 4×) | Fly parallel to the ecliptic; speed scales with zoom |
| Arrow keys | Orbit the camera |

## Console

The console is an in-browser command interface. It never runs OS commands or JavaScript, and it has no
file access. Names are case-insensitive and can be quoted (`"Earth-f1"`). `selected` or `.` means the
current selection. **Tab** completes commands, actions and body names, **Esc** hides suggestions, and
**↑/↓** walk through history, which is kept across reloads. `help <command>` shows usage and examples,
and `help <category>` (`basics`, `bodies`, `time`, `view`, `god`) shows a group.

### Units
Every quantity needs an explicit unit. A bare number is rejected rather than guessed.

| Quantity | Units |
|---|---|
| mass | `kg`, `t`, `Mearth`, `Mjup`, `Msun` |
| length | `m`, `km`, `Rearth`, `Rjup`, `Rsun`, `au` |
| speed | `m/s`, `km/s`, `km/h`, `au/d` |
| duration | `s`, `min`, `h`, `d`, `wk`, `mo` (30.44 d), `yr` (365.25 d). The glued form `1d` also works. |

Coordinates are **barycentric, ecliptic J2000** (+z is ecliptic north).

### Commands
`↺` marks commands that can be undone.

| Command | What it does |
|---|---|
| `help`, `--help`, `help <cmd>`, `<cmd> --help` | Help |
| `clear`, `whoami` | Basics |
| `undo`, `redo` | Rewind or re-apply ↺ commands (see below) |
| `bodies` · `body list` | All bodies, with mass, distance from the star and flags |
| `body info <body>` (alias `planet`) | Mass, radius, density, GM, position, velocity, heliocentric distance and speed, reference orbit |
| `body set <body> mass <v> <unit>` ↺ | New mass. The gravity every body feels changes. For planets modelled with their moons, the moons' share of GM is kept. |
| `body set <body> radius <v> <unit>` ↺ | New radius. Mass is kept and density follows. Overlaps and sub-Schwarzschild radii are rejected. |
| `body move <body> <x> <y> <z> <unit>` ↺ | New position. Velocity is kept and accelerations are recomputed. |
| `body velocity <body> <vx> <vy> <vz> <unit>` ↺ | New velocity (below 5% of c) |
| `select <body>`, `select none` | Same as clicking |
| `sim pause`, `sim resume` | Same as the toolbar |
| `sim speed <v> <unit>/s` | e.g. `10 d/s`, `1 yr/s` (max 10 yr/s). Only changes how many fixed steps run per second. |
| `sim step <duration>` ↺ | Advances the physics while paused or running. Rounded to the nearest whole 1.5 h step (minimum 1); the actual amount is reported. Max 200 yr. |
| `sim reset` ↺ | Restores the JPL Horizons epoch and the original nine bodies |
| `sim status`, `universe status` | Date, elapsed time, state, speed, body count, total mass |
| `camera focus <body>`, `camera free`, `camera overview` | Same camera controller as the mouse and keyboard |
| `orbits on/off` (also `orbit trails on/off`), `labels on/off`, `size true/100/500/1000` | Same settings as the toolbar |

### God mode
These commands are deliberate interventions. Each one states what it conserves and what it breaks.

| Command | Model |
|---|---|
| `explode <body> [--force n]` ↺ | Replaces the body with 8 real fragments of equal mass and radius R/2, starting 1.5 R out on cube diagonals. **Mass, momentum and centre of mass are conserved exactly.** Fragments leave at `force` × the body's surface escape speed (`force` is unitless, 1–20, default 1.5). That kinetic energy is injected from nowhere, which is the nonphysical part. For planets modelled with their moons, the moons' mass is included in the fragments. |
| `explode all --confirm` ↺ | Explodes every body except black holes. Without `--confirm` it only describes what would happen. |
| `supernova <star> --confirm` ↺ | Fiction (the Sun is far too light). The star instantly keeps 30% of its mass in a 7000 km remnant. The other 70% leaves the simulation, so **mass is not conserved**. Planets keep their state and become unbound. |
| `launch <body> [<Δv> <unit>] [--dir prograde/retrograde/outward/inward/north/south]` ↺ | Instant Δv (default 10 km/s prograde) with no reaction mass, so **momentum is not conserved**. Gravity takes over afterwards. |
| `freeze <body>/all`, `unfreeze <body>/all` ↺ | A frozen body is pinned in place (an unlimited invisible force) but keeps its gravity, mass and stored velocity. It resumes with that velocity when released. Velocity edits are refused while frozen. |
| `blackhole spawn [<mass> <unit>] [--at x y z <unit>] [--vel vx vy vz <unit>]` ↺ | A Newtonian point mass (0.1–100 Msun, default 5 Msun, at rest 25 au above the ecliptic). Its collision radius is the Schwarzschild radius 2GM/c². No relativity is modelled, and it adds mass to the universe. It is drawn far larger than its true size. |

Explosions and supernovae also show a visual effect (flash, shockwave, particles). It plays on top of
the real state change and does not replace it. If the camera was following the destroyed body, it
follows the debris' centre of mass instead.

### Safety and undo
- Every command validates its input before it changes anything. If a ↺ command fails partway through,
  the state is rolled back, so a failed command never prints a success message.
- **One shared undo history.** It is used by the `undo`/`redo` commands, the toolbar **Undo/Redo**
  buttons, the shortcuts **Ctrl/⌘+Z** and **Ctrl/⌘+Shift+Z** (or Ctrl+Y), gizmo moves, typed inspector
  coordinates and the toolbar reset. The buttons and shortcuts run the same `undo`/`redo` console
  commands, so the result also appears in the transcript.
- Each entry stores the complete physical state before and after the change: bodies, masses, radii,
  positions, velocities, frozen flags and simulated time. Restoring is exact, even after `explode`.
- **Time:** undo returns to the moment before the change, so time that passed since then is rewound.
  The console always reports the shift (e.g. `time rewound 10.0 d → 2026-01-11 00:00 TDB`).
- Undo never edits the console transcript or the command list. The record of what you ran is kept.
- History is capped at 50 steps. Selection, camera and display settings are not part of it.
- Collisions and numerical failures still halt the simulation. While it is halted, edits are refused;
  `undo` or `sim reset` recovers it.
- The world is capped at 160 bodies, because the cost grows with N².

## Saving and sharing universes

**Export** (header, download icon) saves the whole universe as a `.json` file named
`deity-<creator>-YYYY-MM-DD-HHMM.json`. **Import** (upload icon) opens your system file picker. The file
is validated completely first. Then a dialog shows what's inside (creator, simulated date, bodies,
god-mode and frozen counts, history) and warns that it will replace the current universe. You can
**Export current first**, **Cancel** (or press Esc), or **Replace universe**. Nothing changes before
you confirm, and nothing changes if the file is rejected. The error is shown in a notice and in the
console. Everything runs in the browser, with no server or account; files can be shared as-is.

**What a file contains** (format `project-deity-universe`, version 1):

| Section | Contents |
|---|---|
| `exportedAt`, `app`, `creator.name` | Metadata. On import you choose whether to adopt the file's creator name. |
| `universe` | `epochJD` (2026-01-01 TDB), `timeDays`, `paused`, `rateDaysPerSecond`, and every body: id, name, type, colour, bundled texture, physical data, reference orbit, gravitating GM, god-mode note, `position` (au), `velocity` (au/day, barycentric ecliptic J2000) and `frozen`. Fragments, black holes and supernova remnants are ordinary bodies here. A frozen body's stored velocity is what it resumes with. |
| `console` | The command list (for ↑/↓) and the transcript, with each line's type and timestamp. Recorded output only, nothing reconstructed. |
| `undo` | The undo and redo stacks (each with full before/after states), so undo keeps working after import |

**Validation:**
- Wrong format and malformed JSON are refused.
- A newer `version` is refused with "update Project Deity"; older versions go through explicit
  migrations.
- Types and bounds are checked, and NaN/∞ values are refused.
- Duplicate or malformed ids and unknown body types are refused.
- Textures must be ones bundled with the app, so a file can never make the app load a URL.
- Bodies may not overlap.
- Caps: 8 MB, 160 bodies, 2000 transcript lines, 50 undo steps.
- The gravitating GM and collision radius are not read from the file. They are rebuilt from each
  body's physical data, exactly as the engine computes them, and accelerations and orbit paths are
  recomputed.

**Import and history:** importing replaces the undo history with the file's own. It cannot be undone,
and undo cannot reach the universe you had before the import (export first if you want to keep it).
Display settings (orbits, labels, size) and the camera are not stored.

### Limitations
God-mode results are Newtonian consequences of nonphysical edits, not predictions. Fragments and black
holes have no predicted orbit path, because they have no reference period. Close passes between
massive fragments or near a black hole use the same fixed 1.5 h step, so accuracy drops sharply there.
Physical contact halts the run. See [SCIENCE.md](SCIENCE.md) for the baseline model's accuracy.

## Layout
- `src/physics`: units, `NBodySystem` (velocity Verlet), `SimulationClock` (fixed-step accumulator)
- `src/data`: body catalogue with sources, plus Horizons initial state vectors
- `src/simulation`: `GravitySimulation` (implements `Simulation`), path prediction and its Web Worker
- `src/scene`: Three.js renderer (read-only view of the simulation) and presentation scaling
- `src/simulation/godMode.ts`: explode, launch, black hole and supernova models
- `src/terminal`: parser, units, command registry (`commands.ts`), undo history and the console UI
- `src/ui`, `src/onboarding`: interface
- `scripts/fetch-horizons.mjs`: regenerates ephemeris data
- `tests`: vitest suites and Horizons validation fixture
