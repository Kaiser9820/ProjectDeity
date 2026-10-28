import { useState } from 'react';
import type { CelestialBodyDef, Vec3 } from '../types';
import { duration, fixed, sci } from '../lib/format';
import { heliocentric, type Snapshot } from '../lib/useSimulationSnapshot';
import { auPerDayToKmPerS, AU_KM } from '../physics/units';
import { magnification, type BodyScale } from '../scene/presentation';
import { Icon } from './Icon';

const KIND: Record<CelestialBodyDef['kind'], string> = {
  star: 'G2 V main-sequence star',
  terrestrial: 'Terrestrial planet',
  'gas-giant': 'Gas giant',
  'ice-giant': 'Ice giant',
  fragment: 'Fragment (god-mode)',
  'black-hole': 'Black hole (god-mode)',
};

type Row = [label: string, value: string, unit?: string];

function Table({ title, rows, note }: { title: string; rows: Row[]; note?: string }) {
  return (
    <section className="itable">
      <h3>{title}</h3>
      <dl>
        {rows.map(([k, v, u]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="num">{v}</dd>
            <dd className="unit">{u ?? ''}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="itable__note">{note}</p>}
    </section>
  );
}

const AXES = ['X', 'Y', 'Z'] as const;

interface PositionProps {
  position: Vec3;
  editing: boolean;
  halted: boolean;
  message: string | null;
  onEdit: (on: boolean) => void;
  onSetPosition: (p: Vec3) => boolean;
}

/** Barycentric position readout; in edit mode the values become typed inputs (touch/keyboard alternative to the gizmo). */
function Position({ position, editing, halted, message, onEdit, onSetPosition }: PositionProps) {
  const [draft, setDraft] = useState<{ axis: number; text: string } | null>(null);
  const commit = () => {
    if (!draft) return;
    const v = Number(draft.text);
    if (draft.text.trim() !== '' && Number.isFinite(v)) {
      const next: Vec3 = [...position];
      next[draft.axis] = v;
      onSetPosition(next);
    }
    setDraft(null);
  };
  return (
    <section className={`itable position ${editing ? 'is-editing' : ''}`}>
      <div className="position__head">
        <h3>Position · barycentric ecliptic J2000</h3>
        <button
          type="button"
          className={`btn-chip ${editing ? 'is-active' : ''}`}
          onClick={() => onEdit(!editing)}
          disabled={halted && !editing}
          aria-pressed={editing}
        >
          <Icon name={editing ? 'check' : 'open_with'} />
          {editing ? 'Done' : 'Move'}
        </button>
      </div>
      <dl>
        {AXES.map((a, i) => (
          <div key={a}>
            <dt className={`axis axis--${a.toLowerCase()}`}>{a}</dt>
            {editing ? (
              <dd>
                <input
                  className="coord-input num"
                  inputMode="decimal"
                  aria-label={`${a} coordinate in au`}
                  value={draft?.axis === i ? draft.text : position[i].toFixed(6)}
                  onFocus={(e) => {
                    setDraft({ axis: i, text: position[i].toFixed(6) });
                    e.target.select();
                  }}
                  onChange={(e) => setDraft({ axis: i, text: e.target.value })}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setDraft(null);
                      e.currentTarget.blur();
                    }
                  }}
                />
              </dd>
            ) : (
              <dd className="num">{fixed(position[i], 6)}</dd>
            )}
            <dd className="unit">au</dd>
          </div>
        ))}
      </dl>
      {editing && (
        <p className="itable__note">
          Drag the <span className="axis axis--x">X</span>, <span className="axis axis--y">Y</span> or <span className="axis axis--z">Z</span> handle,
          or type a value. <kbd>Esc</kbd> cancels a drag; <kbd>Esc</kbd> again or Done exits. Moving a body keeps its velocity and mass; gravity takes it from there.
        </p>
      )}
      {message && <p className="position__msg" role="status">{message}</p>}
    </section>
  );
}

interface Props {
  body: CelestialBodyDef;
  snap: Snapshot;
  bodyScale: BodyScale;
  editing: boolean;
  editMessage: string | null;
  halted: boolean;
  onEdit: (on: boolean) => void;
  onSetPosition: (p: Vec3) => boolean;
  onClose: () => void;
}

export function Inspector({ body, snap, bodyScale, editing, editMessage, halted, onEdit, onSetPosition, onClose }: Props) {
  const state = snap.states.get(body.id);
  const frozen = snap.frozen.has(body.id);
  const p = body.physical;
  const h = heliocentric(snap, body.id);
  const physical: Row[] = [
    ['Mass', sci(p.massKg), 'kg'],
    ['GM', sci(p.gmKm3s2, 6), 'km³/s²'],
    ['Mean radius', fixed(p.meanRadiusKm, 1), 'km'],
    ['Equatorial radius', fixed(p.equatorialRadiusKm, 1), 'km'],
    ['Mean density', fixed(p.meanDensityGcm3, 3), 'g/cm³'],
    ['Sidereal rotation', duration(p.siderealRotationHours)],
    ['Obliquity', fixed(p.obliquityDeg, 2), '°'],
  ];
  if (p.geometricAlbedo !== undefined) physical.push(['Geometric albedo', fixed(p.geometricAlbedo, 3)]);

  return (
    <aside className="inspector" aria-labelledby="insp-title">
      <header className="inspector__head">
        <span className="inspector__swatch" style={{ background: body.color }} aria-hidden="true" />
        <div>
          <h2 id="insp-title">{body.name}</h2>
          <p className="inspector__kind">{KIND[body.kind]}</p>
        </div>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close inspector" data-tip="Close">
          <Icon name="close" />
        </button>
      </header>

      <div className="inspector__scroll">
        {state && (
          <Position position={state.position} editing={editing} halted={halted} message={editMessage} onEdit={onEdit} onSetPosition={onSetPosition} />
        )}
        {state && (
          <Table
            title={frozen ? 'Live state · frozen (god-mode)' : 'Live state · simulated'}
            rows={[
              ...(h
                ? ([
                    ['Distance from Sun', fixed(h.distanceAu, 5), 'au'],
                    ['', sci(h.distanceAu * AU_KM, 5), 'km'],
                    ['Speed rel. to Sun', fixed(auPerDayToKmPerS(h.speedAuDay), 3), 'km/s'],
                    ['Light time from Sun', fixed((h.distanceAu * AU_KM) / 299792.458 / 60, 2), 'min'],
                  ] as Row[])
                : []),
              ['Barycentric speed', fixed(auPerDayToKmPerS(Math.hypot(...state.velocity)), 3), 'km/s'],
            ]}
            note={frozen ? 'Pinned in place; the stored velocity resumes on `unfreeze`.' : undefined}
          />
        )}

        <Table
          title="Physical properties"
          rows={physical}
          note={magnification(body, bodyScale) !== 1 ? `Drawn ${magnification(body, bodyScale)}× its true radius (${bodyScale.label}). Physics and the values above use the true radius.` : 'Drawn at true size.'}
        />

        {body.orbit && (
          <Table
            title="Reference orbit · J2000"
            rows={[
              ['Semi-major axis', fixed(body.orbit.semiMajorAxisAu, 5), 'au'],
              ['Eccentricity', fixed(body.orbit.eccentricity, 5)],
              ['Inclination', fixed(body.orbit.inclinationDeg, 3), '°'],
              ['Sidereal period', fixed(body.orbit.siderealPeriodDays, 2), 'd'],
            ]}
            note="Published mean elements for reference. Motion in the view comes from the N-body integration, not from these values."
          />
        )}

        <Table
          title="Model"
          rows={[
            ['Horizons target ID', body.dynamics.horizonsId],
            ['GM used for gravity', sci(body.dynamics.gmKm3s2, 6), 'km³/s²'],
          ]}
          note={body.godMode ?? `Initial state: ${body.dynamics.horizonsName}, JPL Horizons. ${body.dynamics.note ?? ''}`}
        />
      </div>
    </aside>
  );
}
