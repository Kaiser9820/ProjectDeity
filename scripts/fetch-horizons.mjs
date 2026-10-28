// Regenerates src/data/horizons-2026-01-01.json from the JPL Horizons API.
// Usage: node scripts/fetch-horizons.mjs [YYYY-MM-DD] [output path]
//   default: 2026-01-01 → src/data/horizons-2026-01-01.json (initial conditions)
//   2027-01-01 → tests/fixtures/horizons-2027-01-01.json (validation only)
// Frame: ICRF / ecliptic of J2000.0, origin: Solar System Barycenter (500@0),
// time scale: TDB, units: au and au/day, geometric states (no light-time correction).
import { writeFileSync } from 'node:fs';

const DATE = process.argv[2] ?? '2026-01-01';
const EPOCH = `${DATE} 00:00`;
const OUT = process.argv[3] ?? `src/data/horizons-${DATE}.json`;
const TARGETS = { sun: '10', mercury: '199', venus: '299', earth: '3', mars: '4', jupiter: '5', saturn: '6', uranus: '7', neptune: '8' };

const out = { epoch: { calendarTDB: EPOCH, jdTDB: 0 }, frame: 'Ecliptic of J2000.0', origin: 'Solar System Barycenter (500@0)', units: { position: 'au', velocity: 'au/day' }, source: 'JPL Horizons API (https://ssd.jpl.nasa.gov/horizons/)', retrieved: new Date().toISOString().slice(0, 10), states: {} };

for (const [id, cmd] of Object.entries(TARGETS)) {
  const q = new URLSearchParams({
    format: 'json', COMMAND: `'${cmd}'`, EPHEM_TYPE: 'VECTORS', CENTER: "'500@0'", START_TIME: `'${EPOCH}'`, STOP_TIME: `'${DATE} 00:01'`,
    STEP_SIZE: "'1'", OUT_UNITS: "'AU-D'", REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'ICRF'", VEC_TABLE: "'2'", VEC_CORR: "'NONE'", CSV_FORMAT: "'YES'", OBJ_DATA: "'NO'", TIME_TYPE: "'TDB'",
  });
  const res = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${q}`);
  const { result } = await res.json();
  const name = /Target body name: (.+?)\s{2,}/.exec(result)?.[1];
  const row = result.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n')[0].split(',').map((s) => s.trim());
  const [jd, , x, y, z, vx, vy, vz] = row;
  out.epoch.jdTDB = Number(jd);
  out.states[id] = { horizonsId: cmd, horizonsName: name, r: [x, y, z].map(Number), v: [vx, vy, vz].map(Number) };
  console.log(id, name, x, y, z);
}
writeFileSync(new URL(`../${OUT}`, import.meta.url), JSON.stringify(out, null, 2) + '\n');
