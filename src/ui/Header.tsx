import { Icon } from './Icon';
import { elapsed, jdToCalendar } from '../lib/format';
import type { Snapshot } from '../lib/useSimulationSnapshot';

interface Props {
  epochJD: number;
  snap: Snapshot;
  creatorName: string;
  onRename: () => void;
  onExport: () => void;
  onImport: () => void;
}

export function Header({ epochJD, snap, creatorName, onRename, onExport, onImport }: Props) {
  const halted = snap.status.kind === 'halted';
  const state = halted ? 'Halted' : snap.editing ? 'Editing' : snap.paused ? 'Paused' : 'Running';
  return (
    <header className="header">
      <div className="header__brand">
        <span className="brand" role="img" aria-label="Project Deity">
          <img className="brand__mark" src={`${import.meta.env.BASE_URL}brand/icon-192.png`} alt="" width={36} height={36} />
          <span className="brand__type" aria-hidden="true">
            <span>Project</span>
            <span className="brand__accent">Deity</span>
          </span>
        </span>
        <span className="header__sub">Solar System · N-body</span>
      </div>

      <dl className="readout" aria-label="Simulation clock">
        <div>
          <dt>Date (TDB)</dt>
          <dd className="num">{jdToCalendar(epochJD + snap.time)}</dd>
        </div>
        <div className="readout__secondary">
          <dt>Elapsed</dt>
          <dd className="num">{elapsed(snap.time)}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd className={`state state--${state.toLowerCase()}`}>
            <span className="state__led" aria-hidden="true" />
            {state}
          </dd>
        </div>
      </dl>

      <div className="header__files" role="group" aria-label="Universe file">
        <button type="button" className="btn-file" onClick={onExport} data-tip="Download this universe as .json">
          <Icon name="download" />
          <span className="btn-file__label">Export</span>
        </button>
        <button type="button" className="btn-file" onClick={onImport} data-tip="Open a universe .json file">
          <Icon name="upload_file" />
          <span className="btn-file__label">Import</span>
        </button>
      </div>

      <button type="button" className="creator" onClick={onRename} data-tip="Change creator name">
        <Icon name="person" />
        <span className="creator__name">{creatorName}</span>
        <span className="visually-hidden">, change creator name</span>
      </button>
    </header>
  );
}
