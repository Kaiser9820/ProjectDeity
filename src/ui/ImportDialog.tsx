import { useEffect, useRef, useState } from 'react';
import type { LoadedUniverse } from '../persistence/saveFormat';
import { elapsed, jdToCalendar } from '../lib/format';
import { Icon } from './Icon';

interface Props {
  fileName: string;
  loaded: LoadedUniverse;
  current: { creatorName: string; bodies: number; date: string };
  onConfirm: (useFileCreatorName: boolean) => void;
  onExportFirst: () => void;
  onCancel: () => void;
}

/** Confirms replacing the current universe. Nothing changes until "Replace universe" is pressed. */
export function ImportDialog({ fileName, loaded, current, onConfirm, onExportFirst, onCancel }: Props) {
  const [useName, setUseName] = useState(loaded.creatorName === current.creatorName);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const u = loaded.file.universe;
  const godBodies = loaded.snapshot.bodies.filter((b) => b.godMode).length;
  const frozen = loaded.snapshot.frozen.filter(Boolean).length;

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title" aria-describedby="import-warn">
      <div className="modal__card">
        <p className="modal__eyebrow"><Icon name="upload_file" /> Import universe</p>
        <h2 id="import-title" className="modal__title">{fileName}</h2>

        <dl className="modal__facts">
          <div><dt>Creator</dt><dd>{loaded.creatorName}</dd></div>
          <div><dt>Exported</dt><dd className="num">{new Date(loaded.file.exportedAt).toLocaleString()}</dd></div>
          <div><dt>Simulated date</dt><dd className="num">{jdToCalendar(u.epochJD + loaded.snapshot.t)} TDB</dd></div>
          <div><dt>Elapsed</dt><dd className="num">{elapsed(loaded.snapshot.t)}</dd></div>
          <div>
            <dt>Bodies</dt>
            <dd className="num">
              {loaded.snapshot.bodies.length}
              {godBodies ? ` · ${godBodies} god-mode` : ''}
              {frozen ? ` · ${frozen} frozen` : ''}
            </dd>
          </div>
          <div><dt>State</dt><dd>{loaded.paused ? 'paused' : 'running'}</dd></div>
          <div><dt>History</dt><dd className="num">{loaded.commands.length} commands · {loaded.undo.length} undo steps</dd></div>
        </dl>

        <p id="import-warn" className="modal__warn">
          <Icon name="warning" />
          <span>
            This replaces your current universe ({current.bodies} bodies, {current.date} TDB), its undo history and
            the console transcript. Importing can't be undone. Export first if you want to keep what you have.
          </span>
        </p>

        {loaded.creatorName !== current.creatorName && (
          <label className="modal__check">
            <input type="checkbox" checked={useName} onChange={(e) => setUseName(e.target.checked)} />
            <span>Use the file's creator name <strong>{loaded.creatorName}</strong> (instead of {current.creatorName})</span>
          </label>
        )}

        <div className="modal__actions">
          <button type="button" className="btn btn--ghost modal__export" onClick={onExportFirst}>
            <Icon name="download" /> Export current first
          </button>
          <span className="modal__spacer" />
          <button type="button" className="btn" ref={cancelRef} onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={() => onConfirm(useName)}>Replace universe</button>
        </div>
      </div>
    </div>
  );
}
