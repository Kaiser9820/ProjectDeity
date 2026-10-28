import type { CelestialBodyDef, Vec3 } from '../types';
import { BODY_SCALES, bodyScaleById } from '../scene/presentation';
import { MAX_RATE_DAYS_PER_S, MAX_STEP_DAYS, RATE_PRESETS, STEP_DAYS } from '../simulation/GravitySimulation';
import {
  BLACKHOLE_DEFAULT_AT, BLACKHOLE_MASS, C_KM_S, EXPLODE_FORCE, EXPLODE_FRAGMENTS, LAUNCH_DIRS, MSUN_KG,
  fmtJ, fmtMass, launch, planBlackHole, planExplosion, supernova, type ExplodePlan, type LaunchDir,
} from '../simulation/godMode';
import { AU_KM, DAY_S, G_SI } from '../physics/units';
import { elapsed, fixed, jdToCalendar, rateLabel as fmtRate, sci } from '../lib/format';
import { parseCommand, ParseError, tokenize } from './parser';
import { suggestions } from './suggest';
import { MASS_UNITS, parseNumber, parseQuantity, unitFactor, unitNames, UnitError } from './units';
import { CATEGORY_TITLES, CommandError, type Category, type CommandOutput, type CommandSpec, type ConsoleContext, type OutLine } from './types';

/* ------------------------------------------------------------------ output helpers */

const line = (kind: OutLine['kind'], text: string): OutLine => ({ kind, text });
const ok = (text: string) => line('success', text);
const info = (text: string) => line('output', text);
const muted = (text: string) => line('muted', text);
const warn = (text: string) => line('warning', text);
const head = (text: string) => line('system', text);
const done = (lines: OutLine[], changed = false): CommandOutput => ({ lines, changed });

const KM_S_PER_AU_D = AU_KM / DAY_S;
const MEARTH = MASS_UNITS.mearth;

/* ------------------------------------------------------------------ argument helpers */

function bodyNames(ctx: ConsoleContext): string[] {
  return ctx.sim.bodies.map((b) => b.name);
}

/** Resolves a body by name or id (case-insensitive), "selected" or "."; suggests near misses. */
function resolveBody(ctx: ConsoleContext, token: string | undefined, what = 'body'): CelestialBodyDef {
  if (token === undefined || token === '') throw new CommandError(`Missing ${what} name.`, `Bodies: ${bodyNames(ctx).join(', ')}`);
  const t = token.toLowerCase();
  if (t === 'selected' || t === '.') {
    const id = ctx.ui.selectedId;
    const def = id ? ctx.sim.def(id) : undefined;
    if (!def) throw new CommandError('No body is selected.', 'Select one with `select <body>` or by clicking it.');
    return def;
  }
  const def = ctx.sim.bodies.find((b) => b.name.toLowerCase() === t || b.id.toLowerCase() === t);
  if (def) return def;
  const near = suggestions(token, bodyNames(ctx));
  throw new CommandError(`No body named "${token}".`, near.length ? `Did you mean ${near.map((n) => `"${n}"`).join(' or ')}?` : `Bodies: ${bodyNames(ctx).join(', ')}`);
}

interface FlagSpec { [flag: string]: number }

/** Splits `--flag value…` options from positional arguments; rejects unknown or incomplete flags. */
function splitFlags(args: string[], spec: FlagSpec): { pos: string[]; flags: Record<string, string[]> } {
  const pos: string[] = [];
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--') && a.length > 2) {
      const name = a.slice(2).toLowerCase();
      if (!(name in spec)) {
        const near = suggestions(name, Object.keys(spec));
        throw new CommandError(`Unknown option "${a}".`, near.length ? `Did you mean --${near[0]}?` : Object.keys(spec).length ? `Options: ${Object.keys(spec).map((f) => `--${f}`).join(', ')}` : 'This command takes no options.');
      }
      const n = spec[name];
      const vals = args.slice(i + 1, i + 1 + n);
      if (vals.length < n || vals.some((v) => v.startsWith('--'))) throw new CommandError(`--${name} needs ${n} value${n > 1 ? 's' : ''}.`);
      flags[name] = vals;
      i += n;
    } else pos.push(a);
  }
  return { pos, flags };
}

function noExtra(args: string[], from: number, usage: string) {
  if (args.length > from) throw new CommandError(`Unexpected "${args[from]}".`, `Usage: ${usage}`);
}

function wrapUnits<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof UnitError) throw new CommandError(e.message);
    throw e;
  }
}

/** "<x> <y> <z> <unit>" → canonical vector. */
function parseVector(tokens: string[], i: number, q: 'length' | 'speed', what: string): Vec3 {
  return wrapUnits(() => {
    if (tokens.length < i + 4) throw new CommandError(`${what} needs three numbers and a unit, e.g. ${q === 'length' ? '1.5 0 0 au' : '0 24 0 km/s'}.`);
    const nums = tokens.slice(i, i + 3).map((t, k) => parseNumber(t, `${what} ${'xyz'[k]}`));
    const f = unitFactor(tokens[i + 3], q);
    return nums.map((n) => n * f) as Vec3;
  });
}

function onOff(arg: string | undefined, usage: string): boolean {
  const a = arg?.toLowerCase();
  if (a === 'on' || a === 'show') return true;
  if (a === 'off' || a === 'hide') return false;
  throw new CommandError(arg === undefined ? 'Expected on or off.' : `Expected on or off, got "${arg}".`, `Usage: ${usage}`);
}

function requireRunning(ctx: ConsoleContext) {
  const s = ctx.sim.status;
  if (s.kind === 'halted') throw new CommandError(`The simulation is halted: ${s.reason}`, 'Use `undo` or `sim reset` to recover.');
}

function check(res: { ok: true } | { ok: false; message: string }) {
  if (!res.ok) throw new CommandError(res.message);
}

const fmtVec = (v: Readonly<Vec3>, digits: number) => v.map((c) => fixed(c, digits)).join('  ');
const kind = (b: CelestialBodyDef) => ({ star: 'star', terrestrial: 'terrestrial', 'gas-giant': 'gas giant', 'ice-giant': 'ice giant', fragment: 'fragment', 'black-hole': 'black hole' })[b.kind];

function heliocentric(ctx: ConsoleContext, id: string) {
  const sunDef = ctx.sim.bodies.find((b) => b.kind === 'star');
  if (!sunDef || sunDef.id === id) return null;
  const s = ctx.sim.getState(id)!, sun = ctx.sim.getState(sunDef.id)!;
  const r = Math.hypot(...[0, 1, 2].map((k) => s.position[k] - sun.position[k]));
  const v = Math.hypot(...[0, 1, 2].map((k) => s.velocity[k] - sun.velocity[k]));
  return { name: sunDef.name, rAu: r, vKmS: v * KM_S_PER_AU_D };
}

/** Undo/redo move simulated time to the stored state; say so whenever it actually moves. */
function timeShiftLine(days: number, ctx: ConsoleContext): OutLine[] {
  if (Math.abs(days) < 1e-9) return [];
  return [muted(`  time ${days < 0 ? 'rewound' : 'advanced'} ${elapsed(Math.abs(days))} → ${jdToCalendar(ctx.sim.epochJD + ctx.sim.time)} TDB`)];
}

/* ------------------------------------------------------------------ basics */

const help: CommandSpec = {
  name: 'help',
  aliases: ['--help', '-h', 'man'],
  category: 'basics',
  summary: 'list commands, or help for one command or category',
  usage: ['help', 'help <command>', 'help <category>', '<command> --help'],
  examples: ['help', 'help explode', 'help god'],
  run: (args) => {
    const topic = args[0]?.toLowerCase();
    if (!topic) return done(helpIndex());
    const cat = (Object.keys(CATEGORY_TITLES) as Category[]).find((c) => c === topic || CATEGORY_TITLES[c].toLowerCase().startsWith(topic));
    if (cat) return done(helpCategory(cat, true));
    const cmd = REGISTRY.get(topic);
    if (cmd) return done(commandHelp(cmd));
    const near = suggestions(topic, [...REGISTRY.keys(), ...Object.keys(CATEGORY_TITLES)]);
    throw new CommandError(`No help topic "${args[0]}".`, near.length ? `Did you mean ${near.join(', ')}?` : 'Type `help` for the list.');
  },
  complete: (args) => (args.length === 1 ? [...Object.keys(CATEGORY_TITLES), ...COMMANDS.map((c) => c.name)] : []),
};

const clear: CommandSpec = {
  name: 'clear',
  aliases: ['cls'],
  category: 'basics',
  summary: 'clear the console (Ctrl+L)',
  usage: ['clear'],
  examples: ['clear'],
  run: () => ({ lines: [], clear: true }),
};

const whoami: CommandSpec = {
  name: 'whoami',
  category: 'basics',
  summary: 'print your creator name',
  usage: ['whoami'],
  examples: ['whoami'],
  run: (_a, ctx) => done([info(ctx.creatorName)]),
};

const undo: CommandSpec = {
  name: 'undo',
  category: 'basics',
  summary: 'rewind the last undoable command',
  usage: ['undo'],
  examples: ['undo'],
  details: [
    'Restores the exact physical state from before the change, including simulated time, so time that passed since then is rewound (the console reports by how much).',
    'Shared with the toolbar Undo button, gizmo moves and inspector edits. The console transcript is never erased.',
  ],
  run: (_a, ctx) => {
    const step = ctx.history.undo(ctx.sim);
    if (!step) throw new CommandError('Nothing to undo.');
    return done([ok(`Undid: ${step.label}`), ...timeShiftLine(step.timeShiftDays, ctx)]);
  },
};

const redo: CommandSpec = {
  name: 'redo',
  category: 'basics',
  summary: 're-apply the last undone command',
  usage: ['redo'],
  examples: ['redo'],
  run: (_a, ctx) => {
    const step = ctx.history.redo(ctx.sim);
    if (!step) throw new CommandError('Nothing to redo.');
    return done([ok(`Redid: ${step.label}`), ...timeShiftLine(step.timeShiftDays, ctx)]);
  },
};

/* ------------------------------------------------------------------ bodies */

const BODY_ACTIONS = ['list', 'info', 'set', 'move', 'velocity'];

function bodyList(ctx: ConsoleContext): OutLine[] {
  const rows = ctx.sim.bodies.map((b) => {
    const h = heliocentric(ctx, b.id);
    const flags = [ctx.ui.selectedId === b.id ? 'selected' : '', ctx.sim.isFrozen(b.id) ? 'frozen' : ''].filter(Boolean).join(',');
    return `${b.name.padEnd(11)}${(kind(b) ?? '').padEnd(12)}${sci(b.physical.massKg / MEARTH, 3).padStart(10)} M⊕ ${h ? `${fixed(h.rAu, 3).padStart(7)} au` : '      —   '}${flags ? `  [${flags}]` : ''}`;
  });
  return [head(`${ctx.sim.bodies.length} bodies · mass in Earth masses · r from ${ctx.sim.bodies.find((b) => b.kind === 'star')?.name ?? 'star'}`), ...rows.map(info)];
}

function bodyInfo(ctx: ConsoleContext, b: CelestialBodyDef): OutLine[] {
  const st = ctx.sim.getState(b.id)!;
  const p = b.physical;
  const frozen = ctx.sim.isFrozen(b.id);
  const tags = [kind(b), ctx.ui.selectedId === b.id ? 'selected' : '', frozen ? 'frozen' : ''].filter(Boolean).join(' · ');
  const h = heliocentric(ctx, b.id);
  const v = st.velocity.map((c) => c * KM_S_PER_AU_D) as Vec3;
  const lines: OutLine[] = [
    head(`${b.name} · ${tags}`),
    info(`  mass        ${sci(p.massKg)} kg (${sci(p.massKg / MEARTH, 4)} M⊕)`),
    info(`  radius      ${fixed(p.meanRadiusKm, 1)} km mean`),
    info(`  density     ${fixed(p.meanDensityGcm3, 3)} g/cm³`),
    info(`  GM gravity  ${sci(b.dynamics.gmKm3s2, 6)} km³/s²`),
    info(`  position    ${fmtVec(st.position, 6)} au`),
    info(`  velocity    ${fmtVec(v, 3)} km/s${frozen ? ' (stored)' : ''}`),
    muted('              barycentric ecliptic J2000'),
  ];
  if (h) lines.push(info(`  from ${h.name.padEnd(6)} ${fixed(h.rAu, 5)} au · ${fixed(h.vKmS, 3)} km/s`));
  if (b.orbit) lines.push(info(`  ref. orbit  a ${fixed(b.orbit.semiMajorAxisAu, 4)} au · e ${fixed(b.orbit.eccentricity, 4)} · i ${fixed(b.orbit.inclinationDeg, 2)}° (J2000)`));
  if (b.godMode) lines.push(warn(`  ${b.godMode}`));
  lines.push(muted(`  → camera focus ${q(b.name)} · select ${q(b.name)}`));
  return lines;
}

const q = (name: string) => (/\s/.test(name) ? `"${name}"` : name);

const body: CommandSpec = {
  name: 'body',
  aliases: ['planet', 'bodies'],
  category: 'bodies',
  summary: 'list, inspect and modify bodies',
  usage: [
    'body list',
    'body info <body>',
    'body set <body> mass <value> <unit>',
    'body set <body> radius <value> <unit>',
    'body move <body> <x> <y> <z> <unit>',
    'body velocity <body> <vx> <vy> <vz> <unit>',
  ],
  examples: ['bodies', 'planet info Earth', 'body set Earth mass 2 Mearth', 'body set Jupiter radius 80000 km', 'body move Mars 1.5 0 0 au', 'body velocity Mars 0 24 0 km/s'],
  details: [
    '`planet` is an alias of `body`. `bodies` on its own lists everything.',
    'Coordinates are barycentric, ecliptic J2000. Mass units: kg, t, Mearth, Mjup, Msun. Length: m, km, Rearth, Rjup, Rsun, au. Speed: m/s, km/s, km/h, au/d.',
    'Mass changes alter the gravity every other body feels. For planets modelled with their moons, the moons’ share is kept. Radius changes keep the mass (density follows) and are checked for overlaps.',
    'Use `selected` or `.` as the body name for the current selection.',
  ],
  undoable: true,
  run: (args, ctx) => {
    const action = (args[0] ?? 'list').toLowerCase();
    switch (action) {
      case 'list':
        noExtra(args, 1, 'body list');
        return done(bodyList(ctx));
      case 'info':
        noExtra(args, 2, 'body info <body>');
        return done(bodyInfo(ctx, resolveBody(ctx, args[1])));
      case 'set': {
        const b = resolveBody(ctx, args[1]);
        const prop = args[2]?.toLowerCase();
        requireRunning(ctx);
        if (prop === 'mass') {
          const { value, used } = wrapUnits(() => parseQuantity(args, 3, 'mass', 'mass'));
          noExtra(args, 3 + used, 'body set <body> mass <value> <unit>');
          if (!(value > 0)) throw new CommandError('Mass must be positive.');
          if (value > 1000 * MSUN_KG) throw new CommandError('Mass above 1000 Msun is not supported.');
          const rsKm = (2 * G_SI * value) / 1e9 / (C_KM_S * C_KM_S);
          if (rsKm >= b.physical.meanRadiusKm) throw new CommandError(`${b.name} would sit inside its own Schwarzschild radius (${fixed(rsKm, 2)} km). Use \`blackhole spawn\` for that.`);
          const old = b.physical.massKg;
          check(ctx.sim.setBodyMass(b.id, value));
          return done([ok(`${b.name} mass: ${sci(old)} → ${sci(value)} kg (${sci(value / MEARTH, 4)} M⊕). Gravity on every body updated.`)], true);
        }
        if (prop === 'radius') {
          const { value, used } = wrapUnits(() => parseQuantity(args, 3, 'length', 'radius'));
          noExtra(args, 3 + used, 'body set <body> radius <value> <unit>');
          if (!(value >= 0.001)) throw new CommandError('Radius must be at least 1 m.');
          if (value > 1000 * 695700) throw new CommandError('Radius above 1000 Rsun is not supported.');
          const rsKm = (2 * b.physical.gmKm3s2) / (C_KM_S * C_KM_S);
          if (value <= rsKm) throw new CommandError(`That is inside ${b.name}'s Schwarzschild radius (${fixed(rsKm, 3)} km).`);
          const old = b.physical.meanRadiusKm;
          check(ctx.sim.setBodyRadius(b.id, value));
          return done([ok(`${b.name} radius: ${fixed(old, 1)} → ${fixed(value, 1)} km. Mass unchanged; density now ${fixed(ctx.sim.def(b.id)!.physical.meanDensityGcm3, 4)} g/cm³.`)], true);
        }
        throw new CommandError(prop ? `Cannot set "${args[2]}".` : 'Missing property.', 'Settable: mass, radius. Use `body move` / `body velocity` for state.');
      }
      case 'move': {
        const b = resolveBody(ctx, args[1]);
        requireRunning(ctx);
        const p = parseVector(args, 2, 'length', 'Position');
        noExtra(args, 6, 'body move <body> <x> <y> <z> <unit>');
        const au = p.map((c) => c / AU_KM) as Vec3;
        check(ctx.sim.setBodyPosition(b.id, au));
        return done([ok(`${b.name} moved to ${fmtVec(au, 6)} au (velocity kept). Gravity takes it from here.`)], true);
      }
      case 'velocity':
      case 'vel': {
        const b = resolveBody(ctx, args[1]);
        requireRunning(ctx);
        const v = parseVector(args, 2, 'speed', 'Velocity');
        noExtra(args, 6, 'body velocity <body> <vx> <vy> <vz> <unit>');
        if (Math.hypot(...v) >= 0.05 * C_KM_S) throw new CommandError('Speeds of 5% of light speed or more are outside this Newtonian model.');
        check(ctx.sim.setBodyVelocity(b.id, v.map((c) => c / KM_S_PER_AU_D) as Vec3));
        return done([ok(`${b.name} velocity set to ${fmtVec(v, 3)} km/s (|v| ${fixed(Math.hypot(...v), 3)} km/s).`)], true);
      }
      default: {
        // `planet Earth` → treat as info if it names a body
        const asBody = ctx.sim.bodies.find((x) => x.name.toLowerCase() === action);
        if (asBody && args.length === 1) return done(bodyInfo(ctx, asBody));
        const near = suggestions(action, BODY_ACTIONS);
        throw new CommandError(`Unknown body action "${args[0]}".`, near.length ? `Did you mean \`body ${near[0]}\`?` : `Actions: ${BODY_ACTIONS.join(', ')}`);
      }
    }
  },
  complete: (args, ctx) => {
    if (args.length === 1) return BODY_ACTIONS;
    const a = args[0].toLowerCase();
    if (args.length === 2 && a !== 'list') return bodyNames(ctx);
    if (a === 'set' && args.length === 3) return ['mass', 'radius'];
    if (a === 'set' && args.length === 5) return unitNames(args[2]?.toLowerCase() === 'mass' ? 'mass' : 'length');
    if (a === 'move' && args.length === 6) return unitNames('length');
    if ((a === 'velocity' || a === 'vel') && args.length === 6) return unitNames('speed');
    return [];
  },
};

const select: CommandSpec = {
  name: 'select',
  category: 'bodies',
  summary: 'select a body (opens the inspector)',
  usage: ['select <body>', 'select none'],
  examples: ['select Earth', 'select none'],
  run: (args, ctx) => {
    noExtra(args, 1, 'select <body>');
    if (args[0]?.toLowerCase() === 'none') {
      ctx.ui.select(null);
      return done([ok('Selection cleared.')]);
    }
    const b = resolveBody(ctx, args[0]);
    ctx.ui.select(b.id);
    return done([ok(`Selected ${b.name}.`)]);
  },
  complete: (args, ctx) => (args.length === 1 ? ['none', ...bodyNames(ctx)] : []),
};

/* ------------------------------------------------------------------ time */

const SIM_ACTIONS = ['pause', 'resume', 'speed', 'step', 'reset', 'status'];

function statusLines(ctx: ConsoleContext): OutLine[] {
  const s = ctx.sim;
  const state = s.status.kind === 'halted' ? 'halted' : s.paused ? 'paused' : 'running';
  const lines = [
    head('Universe status'),
    info(`  date        ${jdToCalendar(s.epochJD + s.time)} TDB`),
    info(`  elapsed     ${elapsed(s.time)} since 2026-01-01 epoch`),
    info(`  state       ${state} · speed ${rateLabel(s.rate)}`),
    info(`  bodies      ${s.bodies.length}${s.bodies.some((b) => s.isFrozen(b.id)) ? ` (${s.bodies.filter((b) => s.isFrozen(b.id)).length} frozen)` : ''}`),
    info(`  total mass  ${fmtMass(s.totalMassKg())}`),
    info(`  step        ${STEP_DAYS * 24} h fixed (velocity Verlet)`),
  ];
  if (s.status.kind === 'halted') lines.push(warn(`  ${s.status.reason}`));
  if (s.bodies.some((b) => b.godMode)) lines.push(muted('  god-mode changes are active (see `body info`)'));
  return lines;
}

const rateLabel = (daysPerS: number) => fmtRate(daysPerS, RATE_PRESETS);

const sim: CommandSpec = {
  name: 'sim',
  aliases: ['time'],
  category: 'time',
  summary: 'pause, resume, speed, step, reset, status',
  usage: ['sim pause', 'sim resume', 'sim speed <value> <unit>/s', 'sim step <duration>', 'sim reset', 'sim status'],
  examples: ['sim pause', 'sim speed 10 d/s', 'sim speed 1 yr/s', 'sim step 1d', 'sim step 6 h', 'sim reset'],
  details: [
    `Speed is simulated time per real second (max 10 yr/s). It only changes how many fixed ${STEP_DAYS * 24} h steps run per second, never the integration rule.`,
    `\`sim step\` works while paused. The duration is rounded to the nearest whole ${STEP_DAYS * 24} h step (at least one), and the actual amount is reported.`,
    'Reset restores the JPL Horizons epoch (2026-01-01) and the original nine bodies. Reset and step can be undone.',
  ],
  undoable: true,
  run: (args, ctx) => {
    const a = (args[0] ?? 'status').toLowerCase();
    switch (a) {
      case 'pause':
        noExtra(args, 1, 'sim pause');
        if (ctx.sim.paused) return done([info('Already paused.')]);
        ctx.sim.paused = true;
        return done([ok(`Paused at ${jdToCalendar(ctx.sim.epochJD + ctx.sim.time)} TDB.`)]);
      case 'resume':
      case 'run':
      case 'play':
        noExtra(args, 1, 'sim resume');
        requireRunning(ctx);
        if (!ctx.sim.paused) return done([info('Already running.')]);
        ctx.sim.paused = false;
        return done([ok(`Running at ${rateLabel(ctx.sim.rate)}.`)]);
      case 'speed':
      case 'rate': {
        if (!args[1]) return done([info(`Speed: ${rateLabel(ctx.sim.rate)}.`), muted('Set with e.g. `sim speed 10 d/s`.')]);
        const toks = args.slice(1);
        const last = toks[toks.length - 1];
        if (!/\/s$/i.test(last)) throw new CommandError('Speed needs a "per second" unit, e.g. `sim speed 10 d/s` or `sim speed 1 yr/s`.');
        toks[toks.length - 1] = last.replace(/\/s$/i, '');
        const { value, used } = wrapUnits(() => parseQuantity(toks, 0, 'duration', 'speed'));
        noExtra(toks, used, 'sim speed <value> <unit>/s');
        if (!(value > 0)) throw new CommandError('Speed must be positive. Use `sim pause` to stop.');
        if (value > MAX_RATE_DAYS_PER_S) throw new CommandError('Maximum speed is 10 yr/s.');
        ctx.ui.setRate(value);
        return done([ok(`Speed set to ${rateLabel(value)}.`)]);
      }
      case 'step': {
        requireRunning(ctx);
        const { value, used } = wrapUnits(() => parseQuantity(args, 1, 'duration', 'duration'));
        noExtra(args, 1 + used, 'sim step <duration>');
        if (!(value > 0)) throw new CommandError('Duration must be positive.');
        if (value > MAX_STEP_DAYS) throw new CommandError('Maximum single step is 200 yr.');
        const res = ctx.sim.stepDuration(value);
        if (!res.ok) {
          if (res.steps === 0) throw new CommandError(res.message);
          return done([warn(res.message)], true);
        }
        const exact = Math.abs(res.days - value) < 1e-9;
        return done([ok(`Advanced ${elapsed(res.days)} (${res.steps} steps)${exact ? '' : `, rounded from ${elapsed(value)}`}. Now ${jdToCalendar(ctx.sim.epochJD + ctx.sim.time)} TDB.`)], true);
      }
      case 'reset':
        noExtra(args, 1, 'sim reset');
        ctx.sim.reset();
        return done([ok('Universe reset to the JPL Horizons epoch, 2026-01-01 00:00 TDB. `undo` brings back what you had.')], true);
      case 'status':
        noExtra(args, 1, 'sim status');
        return done(statusLines(ctx));
      default: {
        const near = suggestions(a, SIM_ACTIONS);
        throw new CommandError(`Unknown sim action "${args[0]}".`, near.length ? `Did you mean \`sim ${near[0]}\`?` : `Actions: ${SIM_ACTIONS.join(', ')}`);
      }
    }
  },
  complete: (args) => {
    if (args.length === 1) return SIM_ACTIONS;
    if (args[0].toLowerCase() === 'speed' && args.length === 3) return ['h/s', 'd/s', 'wk/s', 'mo/s', 'yr/s'];
    if (args[0].toLowerCase() === 'step' && args.length === 3) return ['h', 'd', 'wk', 'mo', 'yr'];
    return [];
  },
};

const universe: CommandSpec = {
  name: 'universe',
  aliases: ['status'],
  category: 'time',
  summary: 'date, speed, body count, total mass',
  usage: ['universe status'],
  examples: ['universe status', 'status'],
  run: (args, ctx) => {
    if (args[0] && args[0].toLowerCase() !== 'status') throw new CommandError(`Unknown action "${args[0]}".`, 'Usage: universe status');
    noExtra(args, 1, 'universe status');
    return done(statusLines(ctx));
  },
  complete: (args) => (args.length === 1 ? ['status'] : []),
};

/* ------------------------------------------------------------------ view */

const camera: CommandSpec = {
  name: 'camera',
  aliases: ['cam'],
  category: 'view',
  summary: 'focus a body, fly free, or show the overview',
  usage: ['camera focus <body>', 'camera free', 'camera overview'],
  examples: ['camera focus Saturn', 'camera free', 'camera overview'],
  details: ['`focus` follows the body without changing the selection. `free` stops following and leaves the camera where it is (WASD to fly).'],
  run: (args, ctx) => {
    const a = args[0]?.toLowerCase();
    if (a === 'focus') {
      noExtra(args, 2, 'camera focus <body>');
      const b = resolveBody(ctx, args[1]);
      ctx.ui.focus(b.id);
      return done([ok(`Camera following ${b.name}.`)]);
    }
    if (a === 'free') {
      noExtra(args, 1, 'camera free');
      ctx.ui.freeCamera();
      return done([ok('Camera free. Fly with WASD, orbit with right-drag.')]);
    }
    if (a === 'overview' || a === 'reset') {
      noExtra(args, 1, 'camera overview');
      ctx.ui.overview();
      return done([ok('System overview.')]);
    }
    throw new CommandError(a ? `Unknown camera action "${args[0]}".` : 'Missing camera action.', 'Actions: focus <body>, free, overview');
  },
  complete: (args, ctx) => (args.length === 1 ? ['focus', 'free', 'overview'] : args.length === 2 && args[0].toLowerCase() === 'focus' ? bodyNames(ctx) : []),
};

const orbits: CommandSpec = {
  name: 'orbits',
  aliases: ['orbit'],
  category: 'view',
  summary: 'show or hide predicted orbit paths',
  usage: ['orbits on|off'],
  examples: ['orbits off', 'orbit trails on'],
  details: ['Paths are predicted by integrating the current state forward with the same gravity model. They are shown for bodies with a known orbital period.'],
  run: (args, ctx) => {
    const a = args[0]?.toLowerCase() === 'trails' || args[0]?.toLowerCase() === 'paths' ? args.slice(1) : args;
    noExtra(a, 1, 'orbits on|off');
    const on = onOff(a[0], 'orbits on|off');
    ctx.ui.setOrbits(on);
    return done([ok(`Orbit paths ${on ? 'shown' : 'hidden'}.`)]);
  },
  complete: (args) => (args.length === 1 ? ['on', 'off', 'trails'] : args.length === 2 ? ['on', 'off'] : []),
};

const labels: CommandSpec = {
  name: 'labels',
  category: 'view',
  summary: 'show or hide body labels',
  usage: ['labels on|off'],
  examples: ['labels off'],
  run: (args, ctx) => {
    noExtra(args, 1, 'labels on|off');
    const on = onOff(args[0], 'labels on|off');
    ctx.ui.setLabels(on);
    return done([ok(`Labels ${on ? 'shown' : 'hidden'}.`)]);
  },
  complete: (args) => (args.length === 1 ? ['on', 'off'] : []),
};

const SIZE_KEYS: Record<string, string> = { true: 'true', '1': 'true', x1: 'true', '100': 'x100', x100: 'x100', '500': 'x500', x500: 'x500', '1000': 'x1000', x1000: 'x1000' };

const size: CommandSpec = {
  name: 'size',
  category: 'view',
  summary: 'visual body size: true, 100, 500, 1000',
  usage: ['size true|100|500|1000'],
  examples: ['size true', 'size 1000'],
  details: ['Presentation only: planets are magnified by a common factor (the Sun by less). Physics always uses true radii.'],
  run: (args, ctx) => {
    noExtra(args, 1, 'size true|100|500|1000');
    if (!args[0]) return done([info(`Body size: ${bodyScaleById(ctx.ui.bodyScale).label}.`)]);
    const id = SIZE_KEYS[args[0].toLowerCase().replace('×', 'x')];
    if (!id) throw new CommandError(`Unknown size "${args[0]}".`, 'Options: true, 100, 500, 1000');
    ctx.ui.setBodyScale(id);
    return done([ok(`Body size: ${BODY_SCALES.find((b) => b.id === id)!.label} (visual only).`)]);
  },
  complete: (args) => (args.length === 1 ? ['true', '100', '500', '1000'] : []),
};

/* ------------------------------------------------------------------ god mode */

function applyExplosions(ctx: ConsoleContext, plans: ExplodePlan[], effectKind: 'explosion' | 'supernova' = 'explosion') {
  const origins = plans.map((p) => {
    const id = p.remove[0];
    const def = ctx.sim.def(id)!;
    return { id, debris: p.add.map((f) => f.def.id), pos: ctx.sim.getState(id)!.position, sizeKm: def.physical.meanRadiusKm, color: def.color };
  });
  check(ctx.sim.replaceBodies(plans.flatMap((p) => p.remove), plans.flatMap((p) => p.add)));
  for (const o of origins) ctx.ui.effect(effectKind, o.pos, o.sizeKm, o.color, o.id, o.debris);
}

const explode: CommandSpec = {
  name: 'explode',
  aliases: ['boom'],
  category: 'god',
  summary: 'shatter a body into 8 fragments',
  usage: ['explode <body> [--force <n>]', 'explode all --confirm [--force <n>]'],
  examples: ['explode Earth', 'explode Mars --force 3', 'explode all --confirm'],
  details: [
    `The body is replaced by ${EXPLODE_FRAGMENTS} real fragments, each with 1/${EXPLODE_FRAGMENTS} of the mass and the same density. Mass, momentum and centre of mass are conserved exactly.`,
    `--force (unitless, ${EXPLODE_FORCE.min}–${EXPLODE_FORCE.max}, default ${EXPLODE_FORCE.default}) sets the fragment launch speed as a multiple of the body's surface escape speed. That kinetic energy is injected from nowhere; this is the god-mode part.`,
    'Fragments are ordinary bodies afterwards: gravity, collisions and all commands apply. `undo` restores the original body.',
  ],
  undoable: true,
  run: (args, ctx) => {
    const { pos, flags } = splitFlags(args, { force: 1, confirm: 0 });
    noExtra(pos, 1, 'explode <body> [--force <n>]');
    requireRunning(ctx);
    const force = flags.force ? wrapUnits(() => parseNumber(flags.force[0], 'force')) : EXPLODE_FORCE.default;
    if (!(force >= EXPLODE_FORCE.min && force <= EXPLODE_FORCE.max)) throw new CommandError(`--force must be between ${EXPLODE_FORCE.min} and ${EXPLODE_FORCE.max} (multiple of escape speed).`);
    if (pos[0]?.toLowerCase() === 'all') {
      const targets = ctx.sim.bodies.filter((b) => b.kind !== 'black-hole');
      if (!('confirm' in flags)) {
        return done([
          warn(`This destroys all ${targets.length} bodies and replaces them with ${targets.length * EXPLODE_FRAGMENTS} fragments.`),
          info('Mass and momentum are conserved, but the Solar System will be gone. `undo` can restore it.'),
          info('Run `explode all --confirm` to proceed.'),
        ]);
      }
      const plans = targets.map((b) => planExplosion(ctx.sim, b.id, force));
      const bad = plans.find((p): p is { error: string } => 'error' in p);
      if (bad) throw new CommandError(bad.error);
      applyExplosions(ctx, plans as ExplodePlan[]);
      return done([ok(`${targets.length} bodies shattered into ${targets.length * EXPLODE_FRAGMENTS} fragments. Silence, then debris.`), muted('`undo` rewinds it all.')], true);
    }
    if ('confirm' in flags) throw new CommandError('--confirm is only used with `explode all`.');
    const b = resolveBody(ctx, pos[0]);
    const plan = planExplosion(ctx.sim, b.id, force);
    if ('error' in plan) throw new CommandError(plan.error);
    applyExplosions(ctx, [plan]);
    return done([
      ok(`${b.name} is gone. ${EXPLODE_FRAGMENTS} fragments fly outward at ${fixed(plan.kickKmS, 2)} km/s.`),
      muted(`  ${fmtMass(plan.add.reduce((m, f) => m + f.def.physical.massKg, 0))} conserved across fragments · ${fmtJ(plan.energyJ)} injected (god-mode).`),
    ], true);
  },
  complete: (args, ctx) => (args.length === 1 ? ['all', ...bodyNames(ctx)] : ['--force', '--confirm']),
};

const supernovaCmd: CommandSpec = {
  name: 'supernova',
  category: 'god',
  summary: 'a star blows off 70% of its mass',
  usage: ['supernova <star> --confirm'],
  examples: ['supernova Sun --confirm'],
  details: [
    'Simplified, fictional model: the star instantly keeps 30% of its mass in an Earth-sized remnant. The ejected 70% leaves the simulation, so mass is deliberately not conserved.',
    'Planets keep their positions and velocities, but with less than half the central mass left, their orbits are no longer bound. Watch them drift away. The real Sun is far too light to do this.',
  ],
  undoable: true,
  run: (args, ctx) => {
    const { pos, flags } = splitFlags(args, { confirm: 0 });
    noExtra(pos, 1, 'supernova <star> --confirm');
    requireRunning(ctx);
    const b = resolveBody(ctx, pos[0], 'star');
    if (b.kind !== 'star') throw new CommandError(`${b.name} is not a star.`);
    if (!('confirm' in flags)) {
      return done([
        warn(`${b.name} will lose 70% of its mass instantly. Every orbit around it will unbind.`),
        info(`Run \`supernova ${q(b.name)} --confirm\` to proceed. \`undo\` can restore it.`),
      ]);
    }
    const at = ctx.sim.getState(b.id)!.position;
    const sizeKm = b.physical.meanRadiusKm;
    const res = supernova(ctx.sim, b.id);
    if (!res.ok) throw new CommandError(res.message);
    ctx.ui.effect('supernova', at, sizeKm, '#cfe3ff');
    return done([ok(`${b.name} has gone supernova. ${fmtMass(res.ejectedKg!)} hurled into the void.`), muted('  remnant: 0.3 of the mass in a 7000 km core · planets are now unbound (god-mode).')], true);
  },
  complete: (args, ctx) => (args.length === 1 ? ctx.sim.bodies.filter((b) => b.kind === 'star').map((b) => b.name) : ['--confirm']),
};

const launchCmd: CommandSpec = {
  name: 'launch',
  aliases: ['kick'],
  category: 'god',
  summary: 'give a body an instant Δv impulse',
  usage: ['launch <body> [<Δv> <unit>] [--dir <direction>]'],
  examples: ['launch Earth', 'launch Mars 5 km/s --dir outward', 'launch Jupiter 2 km/s --dir north'],
  details: [
    `Δv defaults to 10 km/s. Directions: ${LAUNCH_DIRS.join(', ')} (default prograde). They are relative to the body's motion around the most massive other body; north and south follow the ecliptic pole.`,
    'Instant impulse with no reaction mass, so momentum is not conserved (god-mode). Gravity takes over afterwards.',
  ],
  undoable: true,
  run: (args, ctx) => {
    const { pos, flags } = splitFlags(args, { dir: 1 });
    const b = resolveBody(ctx, pos[0]);
    requireRunning(ctx);
    let dv = 10;
    if (pos.length > 1) {
      const { value, used } = wrapUnits(() => parseQuantity(pos, 1, 'speed', 'Δv'));
      noExtra(pos, 1 + used, 'launch <body> [<Δv> <unit>] [--dir <direction>]');
      dv = value;
    }
    const dir = (flags.dir?.[0]?.toLowerCase() ?? 'prograde') as LaunchDir;
    if (!LAUNCH_DIRS.includes(dir)) throw new CommandError(`Unknown direction "${flags.dir[0]}".`, `Directions: ${LAUNCH_DIRS.join(', ')}`);
    const before = Math.hypot(...ctx.sim.getState(b.id)!.velocity) * KM_S_PER_AU_D;
    check(launch(ctx.sim, b.id, dv, dir));
    const after = Math.hypot(...ctx.sim.getState(b.id)!.velocity) * KM_S_PER_AU_D;
    return done([ok(`${b.name} launched ${dir}: Δv ${fixed(dv, 2)} km/s (speed ${fixed(before, 2)} → ${fixed(after, 2)} km/s).`)], true);
  },
  complete: (args, ctx) => (args.length === 1 ? bodyNames(ctx) : args.at(-2) === '--dir' ? LAUNCH_DIRS : ['--dir', 'km/s']),
};

function freezeCommand(frozen: boolean): CommandSpec {
  const name = frozen ? 'freeze' : 'unfreeze';
  return {
    name,
    category: 'god',
    summary: frozen ? 'pin a body in place (still pulls others)' : 'release frozen bodies',
    usage: [`${name} <body>`, `${name} all`],
    examples: [`${name} Jupiter`, `${name} all`],
    details: frozen
      ? ['A frozen body stops moving but keeps its gravity, mass and stored velocity. Pinning it applies an unlimited invisible force (god-mode). `unfreeze` resumes with the velocity it had.']
      : ['Released bodies continue with the velocity they had when frozen.'],
    undoable: true,
    run: (args, ctx) => {
      noExtra(args, 1, `${name} <body>|all`);
      requireRunning(ctx);
      const targets = args[0]?.toLowerCase() === 'all' ? [...ctx.sim.bodies] : [resolveBody(ctx, args[0])];
      const affected = targets.filter((b) => ctx.sim.isFrozen(b.id) !== frozen);
      if (!affected.length) return done([info(targets.length === 1 ? `${targets[0].name} is already ${frozen ? 'frozen' : 'free'}.` : `Nothing to ${name}.`)]);
      for (const b of affected) check(ctx.sim.setFrozen(b.id, frozen));
      const names = affected.length > 4 ? `${affected.length} bodies` : affected.map((b) => b.name).join(', ');
      return done([ok(frozen ? `${names} frozen in place. Their gravity still pulls.` : `${names} released with their stored velocities.`)], true);
    },
    complete: (args, ctx) => (args.length === 1 ? ['all', ...bodyNames(ctx)] : []),
  };
}

const blackhole: CommandSpec = {
  name: 'blackhole',
  aliases: ['bh'],
  category: 'god',
  summary: 'spawn a black hole (Newtonian point mass)',
  usage: ['blackhole spawn [<mass> <unit>] [--at <x> <y> <z> <unit>] [--vel <vx> <vy> <vz> <unit>]'],
  examples: ['blackhole spawn', 'blackhole spawn 20 Msun --at 0 0 40 au', 'blackhole spawn 3 Msun --at 30 0 0 au --vel 0 5 0 km/s'],
  details: [
    `Default: ${BLACKHOLE_MASS.defaultMsun} Msun, at rest, ${BLACKHOLE_DEFAULT_AT[2]} au above the ecliptic. Allowed mass ${BLACKHOLE_MASS.minMsun}–${BLACKHOLE_MASS.maxMsun} Msun.`,
    'Modelled as a Newtonian point mass. The Schwarzschild radius r_s = 2GM/c² is its collision radius. No relativity, accretion or horizon physics. It adds mass to the universe (god-mode).',
  ],
  undoable: true,
  run: (args, ctx) => {
    const { pos, flags } = splitFlags(args, { at: 4, vel: 4 });
    if (pos[0]?.toLowerCase() !== 'spawn') throw new CommandError(pos[0] ? `Unknown action "${pos[0]}".` : 'Missing action.', 'Usage: blackhole spawn [<mass> <unit>] [--at x y z au]');
    requireRunning(ctx);
    let mass = BLACKHOLE_MASS.defaultMsun * MSUN_KG;
    if (pos.length > 1) {
      const { value, used } = wrapUnits(() => parseQuantity(pos, 1, 'mass', 'mass'));
      noExtra(pos, 1 + used, 'blackhole spawn [<mass> <unit>]');
      mass = value;
    }
    const at = flags.at ? (parseVector(flags.at, 0, 'length', 'Position').map((c) => c / AU_KM) as Vec3) : BLACKHOLE_DEFAULT_AT;
    const vel = flags.vel ? (parseVector(flags.vel, 0, 'speed', 'Velocity').map((c) => c / KM_S_PER_AU_D) as Vec3) : ([0, 0, 0] as Vec3);
    const plan = planBlackHole(ctx.sim, mass, at, vel);
    if ('error' in plan) throw new CommandError(plan.error);
    check(ctx.sim.replaceBodies([], [plan]));
    ctx.ui.effect('explosion', at, 3e6, '#c9a7ff');
    return done([
      ok(`${plan.def.name} spawned: ${fixed(mass / MSUN_KG, 2)} Msun at ${fmtVec(at, 2)} au.`),
      muted(`  r_s = ${fixed(plan.def.physical.meanRadiusKm, 2)} km · drawn enlarged · Newtonian point mass (god-mode).`),
    ], true);
  },
  complete: (args) => (args.length === 1 ? ['spawn'] : ['--at', '--vel', 'Msun']),
};

/* ------------------------------------------------------------------ registry */

export const COMMANDS: CommandSpec[] = [
  help, clear, whoami, undo, redo,
  body, select,
  sim, universe,
  camera, orbits, labels, size,
  explode, supernovaCmd, launchCmd, freezeCommand(true), freezeCommand(false), blackhole,
];

const REGISTRY = new Map<string, CommandSpec>();
for (const c of COMMANDS) for (const n of [c.name, ...(c.aliases ?? [])]) REGISTRY.set(n, c);

export function lookupCommand(name: string): CommandSpec | undefined {
  return REGISTRY.get(name.toLowerCase());
}

function helpIndex(): OutLine[] {
  const lines: OutLine[] = [head('Project Deity console · Phase 3')];
  for (const cat of Object.keys(CATEGORY_TITLES) as Category[]) lines.push(...helpCategory(cat, false));
  lines.push(info(''), muted('help <command> for usage and examples · help god'), muted('Tab completes · ↑/↓ history · units are always explicit'));
  return lines;
}

function helpCategory(cat: Category, verbose: boolean): OutLine[] {
  const cmds = COMMANDS.filter((c) => c.category === cat);
  const lines: OutLine[] = [info(''), head(CATEGORY_TITLES[cat])];
  for (const c of cmds) {
    lines.push(info(`  ${c.name.padEnd(10)}${c.summary}${c.undoable ? ' ↺' : ''}`));
    if (verbose) for (const e of c.examples.slice(0, 2)) lines.push(muted(`              ${e}`));
  }
  if (cat === 'god') lines.push(muted('  These break conservation laws on purpose; `help <cmd>` says how.'));
  if (!verbose && cat === 'basics') lines.push(muted('  ↺ = can be undone'));
  return lines;
}

function commandHelp(c: CommandSpec): OutLine[] {
  const lines: OutLine[] = [head(`${c.name} · ${c.summary}`)];
  if (c.aliases?.length) lines.push(muted(`aliases: ${c.aliases.join(', ')}`));
  lines.push(info('usage:'), ...c.usage.map((u) => info(`  ${u}`)));
  if (c.details) for (const d of c.details) lines.push(info(''), info(d));
  lines.push(info(''), info('examples:'), ...c.examples.map((e) => muted(`  ${e}`)));
  if (c.undoable) lines.push(muted('Changes made by this command can be undone with `undo`.'));
  return lines;
}

/* ------------------------------------------------------------------ execution */

/**
 * Runs one line of input. Commands come from a fixed registry; nothing is evaluated, nothing
 * touches the OS. Undoable commands are bracketed by full-state snapshots: a failure after a
 * partial change rolls back, and a successful change is recorded for undo.
 */
export function executeCommand(raw: string, ctx: ConsoleContext): CommandOutput | null {
  let parsed;
  try {
    parsed = parseCommand(raw);
  } catch (e) {
    if (e instanceof ParseError) return { lines: [line('error', e.message)] };
    throw e;
  }
  if (!parsed) return null;
  const cmd = REGISTRY.get(parsed.name);
  if (!cmd) {
    const near = suggestions(parsed.name, [...REGISTRY.keys()].filter((k) => !k.startsWith('-')));
    return {
      lines: [
        line('error', `${parsed.name}: command not found.`),
        muted(near.length ? `Did you mean ${near.map((n) => `\`${n}\``).join(' or ')}? Type --help for all commands.` : 'Type --help to see the commands.'),
      ],
    };
  }
  if (cmd !== help && parsed.args.some((a) => a === '--help' || a === '-h')) return { lines: commandHelp(cmd) };

  const before = cmd.undoable ? ctx.sim.snapshot() : null;
  const rev0 = ctx.sim.revision;
  try {
    const out = cmd.run(parsed.args, ctx);
    if (before && out.changed && ctx.sim.revision !== rev0) ctx.history.record(parsed.raw, before, ctx.sim.snapshot());
    return out;
  } catch (e) {
    if (before && ctx.sim.revision !== rev0) ctx.sim.restore(before);
    if (e instanceof CommandError) return { lines: [line('error', e.message), ...(e.hint ? [muted(e.hint)] : [])] };
    console.error(e);
    return { lines: [line('error', `${cmd.name}: internal error. ${before ? 'State restored.' : ''}`.trim())] };
  }
}

/* ------------------------------------------------------------------ completion */

export interface Completion {
  /** Input with the current token replaced (if a unique or common-prefix completion exists). */
  value: string;
  /** All candidates for the current token (shown when more than one). */
  candidates: string[];
}

export function complete(input: string, ctx: ConsoleContext): Completion {
  const tokens = tokenize(input, true);
  if (tokens.length === 0) return { value: input, candidates: COMMANDS.map((c) => c.name) };
  const current = tokens[tokens.length - 1];
  let pool: string[];
  if (tokens.length === 1) pool = [...new Set([...COMMANDS.map((c) => c.name), ...COMMANDS.flatMap((c) => c.aliases ?? []).filter((a) => !a.startsWith('-'))])];
  else {
    const cmd = REGISTRY.get(tokens[0].toLowerCase());
    pool = cmd?.complete?.(tokens.slice(1), ctx) ?? [];
  }
  const lc = current.toLowerCase();
  const candidates = [...new Set(pool.filter((p) => p.toLowerCase().startsWith(lc)))];
  if (!candidates.length) return { value: input, candidates: [] };
  const prefix = commonPrefix(candidates);
  const quoteIfNeeded = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  const head = input.slice(0, input.length - currentRawLength(input, current));
  if (candidates.length === 1) return { value: `${head}${quoteIfNeeded(candidates[0])} `, candidates };
  return { value: prefix.length > current.length ? `${head}${prefix}` : input, candidates };
}

function commonPrefix(xs: string[]): string {
  let p = xs[0];
  for (const x of xs) while (!x.toLowerCase().startsWith(p.toLowerCase())) p = p.slice(0, -1);
  return p;
}

/** Length of the raw text making up the last token (including an opening quote). */
function currentRawLength(input: string, token: string): number {
  if (token === '') return 0;
  const m = /(["'])[^"']*$/.exec(input);
  if (m && input.slice(m.index + 1) === token) return token.length + 1;
  return token.length;
}
