/**
 * Portable universe files (.json).
 *
 * Layout (version 1):
 * {
 *   format: "project-deity-universe", version: 1, exportedAt: ISO-8601,
 *   app: { name, phase },
 *   creator: { name },
 *   universe: { epochJD, timeDays, paused, rateDaysPerSecond, bodies: SavedBody[] },
 *   console: { commands: string[], transcript: SavedLine[] },
 *   undo: { undo: SavedHistoryEntry[], redo: SavedHistoryEntry[] }
 * }
 *
 * Units: positions in au and velocities in au/day, both barycentric ecliptic J2000; time in days
 * of TDB since epochJD. GM and collision radius are NOT stored. They are derived on import from
 * each body's physical data, exactly as the simulation derives them. A file therefore cannot
 * smuggle in a gravity that disagrees with the masses it displays.
 *
 * Compatibility: `version` is required. Older versions run through MIGRATIONS up to the current
 * one. Newer versions are refused with a clear message instead of being guessed at.
 */
import type { BodyKind, CelestialBodyDef, TerminalLine, TerminalLineKind, Vec3 } from '../types';
import { GravitySimulation, MAX_BODIES, MAX_RATE_DAYS_PER_S, type SimulationSnapshot } from '../simulation/GravitySimulation';
import type { UndoEntry } from '../terminal/history';
import { validateCreatorName } from '../lib/creatorName';
import { AU_KM, gmToAuDay } from '../physics/units';
import { SOLAR_SYSTEM } from '../data/solarSystem';
import { EPOCH_JD_TDB } from '../simulation/initialConditions';

export const SAVE_FORMAT = 'project-deity-universe';
export const SAVE_VERSION = 1;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TRANSCRIPT = 2000;
export const MAX_COMMANDS = 100;
export const MAX_UNDO = 50;
const MAX_POSITION_AU = 1e6;
const MAX_SPEED_AU_D = (0.05 * 299_792.458 * 86_400) / AU_KM; // 5% of light speed
const MAX_TIME_DAYS = 1e8;

export interface SavedBody {
  id: string;
  name: string;
  kind: BodyKind;
  color: string;
  texture: string;
  emissive?: boolean;
  godMode?: string;
  physical: CelestialBodyDef['physical'];
  orbit?: CelestialBodyDef['orbit'];
  dynamics: CelestialBodyDef['dynamics'];
  rings?: CelestialBodyDef['rings'];
  position: Vec3;
  velocity: Vec3;
  frozen: boolean;
}

export interface SavedLine {
  kind: TerminalLineKind;
  text: string;
  prompt?: string;
  at: string;
}

export interface SavedHistoryEntry {
  label: string;
  before: { timeDays: number; bodies: SavedBody[] };
  after: { timeDays: number; bodies: SavedBody[] };
}

export interface UniverseFile {
  format: typeof SAVE_FORMAT;
  version: number;
  exportedAt: string;
  app: { name: string; phase: number };
  creator: { name: string };
  universe: { epochJD: number; timeDays: number; paused: boolean; rateDaysPerSecond: number; bodies: SavedBody[] };
  console: { commands: string[]; transcript: SavedLine[] };
  undo: { undo: SavedHistoryEntry[]; redo: SavedHistoryEntry[] };
}

/** Everything an export needs, gathered from the live app. */
export interface ExportInput {
  creatorName: string;
  snapshot: SimulationSnapshot;
  paused: boolean;
  rate: number;
  commands: readonly string[];
  transcript: readonly TerminalLine[];
  undo: readonly UndoEntry[];
  redo: readonly UndoEntry[];
  now?: Date;
}

/** A fully validated import, ready to apply in one step. */
export interface LoadedUniverse {
  file: UniverseFile;
  creatorName: string;
  snapshot: SimulationSnapshot;
  paused: boolean;
  rate: number;
  commands: string[];
  transcript: TerminalLine[];
  undo: UndoEntry[];
  redo: UndoEntry[];
}

/* ------------------------------------------------------------------ export */

export function snapshotToBodies(s: SimulationSnapshot): SavedBody[] {
  return s.bodies.map((b, i) => {
    const out: SavedBody = {
      id: b.id, name: b.name, kind: b.kind, color: b.color, texture: b.texture,
      physical: { ...b.physical },
      dynamics: { ...b.dynamics },
      position: [s.r[3 * i], s.r[3 * i + 1], s.r[3 * i + 2]],
      velocity: [s.v[3 * i], s.v[3 * i + 1], s.v[3 * i + 2]],
      frozen: s.frozen[i],
    };
    if (b.orbit) out.orbit = { ...b.orbit };
    if (b.rings) out.rings = { ...b.rings };
    if (b.emissive !== undefined) out.emissive = b.emissive;
    if (b.godMode) out.godMode = b.godMode;
    return out;
  });
}

export function buildUniverseFile(input: ExportInput): UniverseFile {
  const now = input.now ?? new Date();
  const entry = (e: UndoEntry): SavedHistoryEntry => ({
    label: e.label,
    before: { timeDays: e.before.t, bodies: snapshotToBodies(e.before) },
    after: { timeDays: e.after.t, bodies: snapshotToBodies(e.after) },
  });
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    exportedAt: now.toISOString(),
    app: { name: 'Project Deity', phase: 4 },
    creator: { name: input.creatorName },
    universe: {
      epochJD: EPOCH_JD_TDB,
      timeDays: input.snapshot.t,
      paused: input.paused,
      rateDaysPerSecond: input.rate,
      bodies: snapshotToBodies(input.snapshot),
    },
    console: {
      commands: input.commands.slice(-MAX_COMMANDS),
      transcript: input.transcript.slice(-MAX_TRANSCRIPT).map((l) => ({
        kind: l.kind, text: l.text, ...(l.prompt ? { prompt: l.prompt } : {}), at: new Date(l.at).toISOString(),
      })),
    },
    undo: { undo: input.undo.slice(-MAX_UNDO).map(entry), redo: input.redo.slice(-MAX_UNDO).map(entry) },
  };
}

export function serializeUniverse(input: ExportInput): string {
  return JSON.stringify(buildUniverseFile(input), null, 2);
}

/** e.g. deity-ada-2026-10-28-1542.json; only [a-z0-9-] survive. */
export function exportFilename(creatorName: string, now = new Date()): string {
  const safe = creatorName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'universe';
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `deity-${safe}-${stamp}.json`;
}

/* ------------------------------------------------------------------ import */

export class SaveError extends Error {}

const fail = (msg: string): never => {
  throw new SaveError(msg);
};

type Json = unknown;
const isObj = (x: Json): x is Record<string, Json> => typeof x === 'object' && x !== null && !Array.isArray(x);

function obj(x: Json, where: string): Record<string, Json> {
  return isObj(x) ? x : fail(`${where} must be an object.`);
}
function str(x: Json, where: string, max = 200, min = 0): string {
  if (typeof x !== 'string') fail(`${where} must be a string.`);
  const s = x as string;
  // eslint-disable-next-line no-control-regex
  if (s.length < min || s.length > max || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(s)) fail(`${where} is not a valid string.`);
  return s;
}
function num(x: Json, where: string, lo = -Infinity, hi = Infinity): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) fail(`${where} must be a finite number.`);
  const n = x as number;
  if (n < lo || n > hi) fail(`${where} is out of range (${n}).`);
  return n;
}
function pos(x: Json, where: string): number {
  const n = num(x, where);
  return n > 0 ? n : fail(`${where} must be positive.`);
}
function bool(x: Json, where: string): boolean {
  return typeof x === 'boolean' ? x : fail(`${where} must be true or false.`);
}
function arr(x: Json, where: string, max: number): Json[] {
  if (!Array.isArray(x)) fail(`${where} must be a list.`);
  if ((x as Json[]).length > max) fail(`${where} has too many entries (max ${max}).`);
  return x as Json[];
}
function vec(x: Json, where: string, limit: number): Vec3 {
  const a = arr(x, where, 3);
  if (a.length !== 3) fail(`${where} must have exactly 3 numbers.`);
  return a.map((c, i) => num(c, `${where}[${i}]`, -limit, limit)) as Vec3;
}

const KINDS: BodyKind[] = ['star', 'terrestrial', 'gas-giant', 'ice-giant', 'fragment', 'black-hole'];
const LINE_KINDS: TerminalLineKind[] = ['input', 'output', 'system', 'error', 'success', 'warning', 'muted'];
/** Only textures that ship with the app may be referenced: a file can never point the renderer at a URL. */
const TEXTURES = new Set(['', ...SOLAR_SYSTEM.flatMap((b) => [b.texture, b.rings?.texture ?? ''])]);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9~._-]{0,79}$/;

function parseBody(x: Json, where: string): SavedBody {
  const o = obj(x, where);
  const id = str(o.id, `${where}.id`, 80, 1);
  if (!ID_RE.test(id)) fail(`${where}.id "${id}" has unsupported characters.`);
  const kind = str(o.kind, `${where}.kind`, 20) as BodyKind;
  if (!KINDS.includes(kind)) fail(`${where}.kind "${kind}" is not a supported body type.`);
  const color = str(o.color, `${where}.color`, 7);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail(`${where}.color must be #rrggbb.`);
  const texture = str(o.texture, `${where}.texture`, 80);
  if (!TEXTURES.has(texture)) fail(`${where}.texture "${texture}" is not a bundled texture.`);
  const p = obj(o.physical, `${where}.physical`);
  const physical: CelestialBodyDef['physical'] = {
    massKg: pos(p.massKg, `${where}.physical.massKg`),
    gmKm3s2: pos(p.gmKm3s2, `${where}.physical.gmKm3s2`),
    meanRadiusKm: pos(p.meanRadiusKm, `${where}.physical.meanRadiusKm`),
    equatorialRadiusKm: pos(p.equatorialRadiusKm, `${where}.physical.equatorialRadiusKm`),
    meanDensityGcm3: num(p.meanDensityGcm3, `${where}.physical.meanDensityGcm3`, 0),
    siderealRotationHours: num(p.siderealRotationHours, `${where}.physical.siderealRotationHours`, -1e9, 1e9),
    obliquityDeg: num(p.obliquityDeg, `${where}.physical.obliquityDeg`, -360, 360),
    ...(p.geometricAlbedo !== undefined ? { geometricAlbedo: num(p.geometricAlbedo, `${where}.physical.geometricAlbedo`, 0, 10) } : {}),
  };
  if (physical.massKg > 1e33) fail(`${where}.physical.massKg exceeds 500 000 solar masses.`);
  const d = obj(o.dynamics, `${where}.dynamics`);
  const dynamics: CelestialBodyDef['dynamics'] = {
    horizonsId: str(d.horizonsId, `${where}.dynamics.horizonsId`, 20),
    horizonsName: str(d.horizonsName, `${where}.dynamics.horizonsName`, 80),
    gmKm3s2: pos(d.gmKm3s2, `${where}.dynamics.gmKm3s2`),
    ...(d.note !== undefined ? { note: str(d.note, `${where}.dynamics.note`, 500) } : {}),
  };
  if (dynamics.gmKm3s2 < physical.gmKm3s2 * (1 - 1e-9)) fail(`${where}: gravitating GM is smaller than the body's own GM.`);
  const body: SavedBody = {
    id, kind, color, texture, physical, dynamics,
    name: str(o.name, `${where}.name`, 40, 1),
    position: vec(o.position, `${where}.position`, MAX_POSITION_AU),
    velocity: vec(o.velocity, `${where}.velocity`, MAX_SPEED_AU_D),
    frozen: bool(o.frozen, `${where}.frozen`),
  };
  if (o.orbit !== undefined) {
    const r = obj(o.orbit, `${where}.orbit`);
    body.orbit = {
      semiMajorAxisAu: pos(r.semiMajorAxisAu, `${where}.orbit.semiMajorAxisAu`),
      eccentricity: num(r.eccentricity, `${where}.orbit.eccentricity`, 0, 1),
      inclinationDeg: num(r.inclinationDeg, `${where}.orbit.inclinationDeg`, -180, 180),
      siderealPeriodDays: num(r.siderealPeriodDays, `${where}.orbit.siderealPeriodDays`, 1, 1e7),
    };
  }
  if (o.rings !== undefined) {
    const r = obj(o.rings, `${where}.rings`);
    const tex = str(r.texture, `${where}.rings.texture`, 80);
    if (!TEXTURES.has(tex) || !tex) fail(`${where}.rings.texture is not a bundled texture.`);
    body.rings = { innerKm: pos(r.innerKm, `${where}.rings.innerKm`), outerKm: pos(r.outerKm, `${where}.rings.outerKm`), texture: tex };
    if (body.rings.outerKm <= body.rings.innerKm) fail(`${where}.rings: outer radius must exceed inner radius.`);
  }
  if (o.emissive !== undefined) body.emissive = bool(o.emissive, `${where}.emissive`);
  if (o.godMode !== undefined) body.godMode = str(o.godMode, `${where}.godMode`, 600);
  return body;
}

function parseBodies(x: Json, where: string): SavedBody[] {
  const list = arr(x, where, MAX_BODIES).map((b, i) => parseBody(b, `${where}[${i}]`));
  if (!list.length) fail(`${where} is empty.`);
  const ids = new Set<string>();
  for (const b of list) {
    if (ids.has(b.id)) fail(`${where}: duplicate body id "${b.id}".`);
    ids.add(b.id);
  }
  return list;
}

/** Rebuilds a simulation snapshot, deriving GM and collision radius from physical data. */
export function bodiesToSnapshot(bodies: readonly SavedBody[], timeDays: number): SimulationSnapshot {
  const defs: CelestialBodyDef[] = bodies.map(({ position: _p, velocity: _v, frozen: _f, ...def }) => def);
  return {
    bodies: defs,
    gm: bodies.map((b) => gmToAuDay(b.dynamics.gmKm3s2)),
    radius: bodies.map((b) => b.physical.meanRadiusKm / AU_KM),
    r: bodies.flatMap((b) => b.position),
    v: bodies.flatMap((b) => b.velocity),
    frozen: bodies.map((b) => b.frozen),
    t: timeDays,
  };
}

function checkedSnapshot(bodiesJson: Json, timeJson: Json, where: string): SimulationSnapshot {
  const snap = bodiesToSnapshot(parseBodies(bodiesJson, `${where}.bodies`), num(timeJson, `${where}.timeDays`, 0, MAX_TIME_DAYS));
  const problem = GravitySimulation.checkSnapshot(snap);
  if (problem) fail(`${where}: ${problem}`);
  return snap;
}

/** Upgrades older files step by step. Add `n: (file) => file` entries when version n+1 appears. */
const MIGRATIONS: Record<number, (f: Record<string, Json>) => Record<string, Json>> = {};

/**
 * Parses and fully validates a universe file. Throws SaveError with a user-facing message on any
 * problem. Nothing is applied here; the caller commits the result in one step.
 */
export function parseUniverse(text: string): LoadedUniverse {
  if (text.length > MAX_FILE_BYTES) fail(`File is too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
  let raw: Json;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('This file is not valid JSON.');
  }
  let f = obj(raw, 'File');
  if (f.format !== SAVE_FORMAT) fail('This is not a Project Deity universe file.');
  let version = num(f.version, 'version', 1);
  if (!Number.isInteger(version)) fail('version must be an integer.');
  if (version > SAVE_VERSION) fail(`This file uses save format v${version}; this app reads up to v${SAVE_VERSION}. Update Project Deity to open it.`);
  while (version < SAVE_VERSION) {
    const m = MIGRATIONS[version] ?? fail(`Save format v${version} is no longer supported.`);
    f = m(f);
    version++;
  }

  const exportedAt = str(f.exportedAt, 'exportedAt', 40);
  if (Number.isNaN(Date.parse(exportedAt))) fail('exportedAt is not a valid date.');
  const app = obj(f.app, 'app');
  const creator = obj(f.creator, 'creator');
  const creatorName = str(creator.name, 'creator.name', 40, 1);
  const nameCheck = validateCreatorName(creatorName);
  if (!nameCheck.ok) fail(`creator.name: ${nameCheck.error}`);

  const u = obj(f.universe, 'universe');
  const epochJD = num(u.epochJD, 'universe.epochJD');
  if (epochJD !== EPOCH_JD_TDB) fail(`This universe uses epoch JD ${epochJD}; this app only supports JD ${EPOCH_JD_TDB} (2026-01-01 TDB).`);
  const snapshot = checkedSnapshot(u.bodies, u.timeDays, 'universe');
  const paused = bool(u.paused, 'universe.paused');
  const rate = num(u.rateDaysPerSecond, 'universe.rateDaysPerSecond', 0, MAX_RATE_DAYS_PER_S);
  if (!(rate > 0)) fail('universe.rateDaysPerSecond must be positive.');

  const c = obj(f.console, 'console');
  const commands = arr(c.commands, 'console.commands', MAX_COMMANDS).map((x, i) => str(x, `console.commands[${i}]`, 256));
  const transcript: TerminalLine[] = arr(c.transcript, 'console.transcript', MAX_TRANSCRIPT).map((x, i) => {
    const l = obj(x, `console.transcript[${i}]`);
    const kind = str(l.kind, `console.transcript[${i}].kind`, 10) as TerminalLineKind;
    if (!LINE_KINDS.includes(kind)) fail(`console.transcript[${i}].kind is invalid.`);
    const at = Date.parse(str(l.at, `console.transcript[${i}].at`, 40));
    if (Number.isNaN(at)) fail(`console.transcript[${i}].at is not a valid date.`);
    return {
      id: 0, kind, at,
      text: str(l.text, `console.transcript[${i}].text`, 4000),
      ...(l.prompt !== undefined ? { prompt: str(l.prompt, `console.transcript[${i}].prompt`, 80) } : {}),
    };
  });

  const h = obj(f.undo, 'undo');
  const entries = (x: Json, where: string): UndoEntry[] =>
    arr(x, where, MAX_UNDO).map((e, i) => {
      const o = obj(e, `${where}[${i}]`);
      const b = obj(o.before, `${where}[${i}].before`), a = obj(o.after, `${where}[${i}].after`);
      return {
        label: str(o.label, `${where}[${i}].label`, 256, 1),
        before: checkedSnapshot(b.bodies, b.timeDays, `${where}[${i}].before`),
        after: checkedSnapshot(a.bodies, a.timeDays, `${where}[${i}].after`),
      };
    });

  return {
    file: { ...(f as unknown as UniverseFile), app: { name: str(app.name, 'app.name', 40), phase: num(app.phase, 'app.phase', 0, 1e3) } },
    creatorName,
    snapshot,
    paused,
    rate,
    commands,
    transcript,
    undo: entries(h.undo, 'undo.undo'),
    redo: entries(h.redo, 'undo.redo'),
  };
}
