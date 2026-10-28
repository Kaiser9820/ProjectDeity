import type { CelestialBodyDef } from '../types';
import { fixed } from '../lib/format';
import { heliocentric, type Snapshot } from '../lib/useSimulationSnapshot';

interface Props {
  bodies: readonly CelestialBodyDef[];
  snap: Snapshot;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function BodyList({ bodies, snap, selectedId, onSelect }: Props) {
  return (
    <section className="section bodies" aria-labelledby="bodies-h">
      <header className="section__head">
        <h2 id="bodies-h">Bodies</h2>
        <span className="section__meta">r from Sun</span>
      </header>
      <ul className="bodies__list">
        {bodies.map((b) => {
          const h = heliocentric(snap, b.id);
          const active = b.id === selectedId;
          return (
            <li key={b.id}>
              <button
                type="button"
                className={`body-row ${active ? 'is-active' : ''}`}
                aria-pressed={active}
                onClick={() => onSelect(active ? null : b.id)}
              >
                <span className="body-row__swatch" style={{ background: b.color }} aria-hidden="true" />
                <span className="body-row__name">{b.name}</span>
                <span className="body-row__value num">{h ? <>{fixed(h.distanceAu, 3)}<span className="unit">au</span></> : '—'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="credits">
        State vectors &amp; constants: <a href="https://ssd.jpl.nasa.gov/horizons/" target="_blank" rel="noreferrer">JPL Horizons</a>.
        Surface maps: <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noreferrer">Solar System Scope</a>, CC BY 4.0, from NASA imagery.
      </p>
    </section>
  );
}
