import { RATE_PRESETS } from '../simulation/GravitySimulation';
import { BODY_SCALES } from '../scene/presentation';
import { Icon } from './Icon';
import { rateLabel } from '../lib/format';

interface Props {
  paused: boolean;
  halted: boolean;
  lagging: boolean;
  /** Simulated days per real second. */
  rate: number;
  showOrbits: boolean;
  showLabels: boolean;
  bodyScale: string;
  onBodyScale: (id: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  onUndo: () => void;
  onRedo: () => void;
  onTogglePaused: () => void;
  onReset: () => void;
  onRate: (daysPerSecond: number) => void;
  onToggleOrbits: () => void;
  onToggleLabels: () => void;
  onOverview: () => void;
}

export function Transport(p: Props) {
  const rateIndex = RATE_PRESETS.findIndex((r) => Math.abs(r.daysPerSecond - p.rate) < 1e-9);
  return (
    <div className="transport" role="toolbar" aria-label="Simulation controls">
      <div className="transport__group">
        <button
          type="button"
          className="btn-icon"
          onClick={p.onUndo}
          disabled={!p.canUndo}
          aria-label={p.undoLabel ? `Undo: ${p.undoLabel}` : 'Undo (nothing to undo)'}
          data-tip={p.undoLabel ? `Undo: ${p.undoLabel}` : 'Nothing to undo'}
        >
          <Icon name="undo" />
        </button>
        <button
          type="button"
          className="btn-icon"
          onClick={p.onRedo}
          disabled={!p.canRedo}
          aria-label={p.redoLabel ? `Redo: ${p.redoLabel}` : 'Redo (nothing to redo)'}
          data-tip={p.redoLabel ? `Redo: ${p.redoLabel}` : 'Nothing to redo'}
        >
          <Icon name="redo" />
        </button>
      </div>

      <div className="transport__group">
        <button type="button" className="btn-icon" onClick={p.onReset} aria-label="Reset to epoch" data-tip="Reset to epoch">
          <Icon name="restart_alt" />
        </button>
        <button
          type="button"
          className="btn-icon btn-icon--primary"
          onClick={p.onTogglePaused}
          disabled={p.halted}
          aria-label={p.paused ? 'Run simulation' : 'Pause simulation'}
          data-tip={p.paused ? 'Run' : 'Pause'}
        >
          <Icon name={p.paused ? 'play_arrow' : 'pause'} />
        </button>
      </div>

      <fieldset className="rate">
        <legend className="visually-hidden">Simulation rate</legend>
        {RATE_PRESETS.map((r, i) => (
          <label key={r.label} className={`rate__opt ${i === rateIndex ? 'is-active' : ''}`}>
            <input type="radio" name="rate" checked={i === rateIndex} onChange={() => p.onRate(r.daysPerSecond)} />
            <span className="num">{r.label}</span>
          </label>
        ))}
        {rateIndex < 0 && <span className="rate__opt is-active num" title="Set from the console">{rateLabel(p.rate)}</span>}
        <select
          className="rate__select num"
          value={rateIndex}
          onChange={(e) => p.onRate(RATE_PRESETS[Number(e.target.value)].daysPerSecond)}
          aria-label="Simulation rate"
        >
          {rateIndex < 0 && <option value={-1}>custom</option>}
          {RATE_PRESETS.map((r, i) => <option key={r.label} value={i}>{r.label}</option>)}
        </select>
        {p.lagging && <span className="rate__warn" role="status" data-tip="Step budget exceeded: running slower than requested"><Icon name="speed" /></span>}
      </fieldset>

      <div className="transport__group">
        <label className="size-select" data-tip="Body size (visual only)">
          <span className="visually-hidden">Body size</span>
          <select className="rate__select size-select__el num" value={p.bodyScale} onChange={(e) => p.onBodyScale(e.target.value)}>
            {BODY_SCALES.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-icon" aria-pressed={p.showOrbits} onClick={p.onToggleOrbits} aria-label="Orbit paths" data-tip={p.showOrbits ? 'Hide orbit paths' : 'Show orbit paths'}>
          <Icon name="orbit" />
        </button>
        <button type="button" className="btn-icon" aria-pressed={p.showLabels} onClick={p.onToggleLabels} aria-label="Labels" data-tip={p.showLabels ? 'Hide labels' : 'Show labels'}>
          <Icon name="label" />
        </button>
        <button type="button" className="btn-icon" onClick={p.onOverview} aria-label="System overview" data-tip="System overview">
          <Icon name="center_focus_weak" />
        </button>
      </div>
    </div>
  );
}
