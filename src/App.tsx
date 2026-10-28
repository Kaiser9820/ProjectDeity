import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import type { Settings, TerminalLine } from './types';
import { storage } from './lib/storage';
import { validateCreatorName } from './lib/creatorName';
import { useMediaQuery } from './lib/useMediaQuery';
import { useSimulationSnapshot } from './lib/useSimulationSnapshot';
import { SOLAR_SYSTEM } from './data/solarSystem';
import { GravitySimulation } from './simulation/GravitySimulation';
import { complete, executeCommand } from './terminal/commands';
import { UndoHistory } from './terminal/history';
import type { ConsoleContext } from './terminal/types';
import { SolarScene, type SolarSceneHandle } from './scene/SolarScene';
import { bodyScaleById } from './scene/presentation';
import { Onboarding } from './onboarding/Onboarding';
import { Terminal } from './terminal/Terminal';
import { Header } from './ui/Header';
import { BodyList } from './ui/BodyList';
import { Inspector } from './ui/Inspector';
import { Transport } from './ui/Transport';
import { ImportDialog } from './ui/ImportDialog';
import { Toast, type ToastMessage } from './ui/Toast';
import { exportFilename, MAX_FILE_BYTES, parseUniverse, SaveError, serializeUniverse, type LoadedUniverse } from './persistence/saveFormat';
import { jdToCalendar } from './lib/format';
import type { OutLine } from './terminal/types';

let lineId = 1;
const mkLine = (kind: TerminalLine['kind'], text: string, prompt?: string, at = Date.now()): TerminalLine => ({ id: lineId++, kind, text, prompt, at });
const MAX_LINES = 600;

/** Keyboard input should go to a form control rather than a global shortcut. */
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.matches('input, textarea, select'));

function loadName(): string | null {
  const stored = storage.getCreatorName();
  if (!stored) return null;
  const v = validateCreatorName(stored);
  return v.ok ? v.value : null;
}

export default function App() {
  const [creatorName, setCreatorName] = useState<string | null>(loadName);
  const [renaming, setRenaming] = useState(false);
  const [settings, setSettings] = useState<Settings>(() => storage.getSettings());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  // On phones the console starts collapsed so the 3D view gets the room.
  const [consoleOpen, setConsoleOpen] = useState(() => !window.matchMedia('(max-width: 760px)').matches);
  const sceneRef = useRef<SolarSceneHandle>(null);
  const systemReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const isNarrow = useMediaQuery('(max-width: 760px)');

  const simulation = useMemo(() => {
    const sim = new GravitySimulation(SOLAR_SYSTEM, settings.rate);
    // With reduced motion requested, start paused; the user can run it explicitly.
    sim.paused = settings.reducedMotion === 'on' || (settings.reducedMotion === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    return sim;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Faster readouts while editing so coordinates track the gizmo.
  const [snap, refresh] = useSimulationSnapshot(simulation, editingId ? 30 : 5);

  /** Selecting a different body leaves edit mode; edit mode always implies selection. */
  const select = (id: string | null) => {
    setSelectedId(id);
    if (id !== editingId) setEditingId(null);
    setEditMessage(null);
  };
  const edit = (id: string | null) => {
    if (id) setSelectedId(id);
    setEditingId(id);
    setEditMessage(null);
  };
  const selectedBody = snap.bodies.find((b) => b.id === selectedId) ?? null;
  const history = useRef(new UndoHistory()).current;
  useSyncExternalStore(history.subscribe.bind(history), () => history.version);

  // Console session: transcript and command list live here so they can be exported and imported.
  const [lines, setLines] = useState<TerminalLine[]>(() => [
    mkLine('system', 'deity console · in-browser command interface, not an OS shell'),
    mkLine('muted', 'Tab completes commands and body names.'),
  ]);
  const [commands, setCommands] = useState<string[]>(() => storage.getHistory());
  const appendLines = (more: TerminalLine[]) => setLines((l) => [...l, ...more].slice(-MAX_LINES));
  const toLines = (out: OutLine[]) => out.map((o) => mkLine(o.kind, o.text));

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback((kind: ToastMessage['kind'], text: string) => setToast({ id: Date.now(), kind, text }), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.kind === 'error' ? 9000 : 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Bodies can disappear (explode, undo, reset): drop selection/edit state that points at them.
  useEffect(() => {
    if (selectedId && !simulation.has(selectedId)) select(null);
    if (editingId && !simulation.has(editingId)) setEditingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.revision, snap.generation]);

  // Latest UI state for console commands, without re-creating the context every render.
  const uiState = useRef({ selectedId, settings });
  uiState.current = { selectedId, settings };

  const consoleContext = (): ConsoleContext => ({
    creatorName: creatorName ?? '',
    sim: simulation,
    history,
    ui: {
      get selectedId() { return uiState.current.selectedId; },
      select: (id) => select(id),
      focus: (id) => sceneRef.current?.focus(id),
      freeCamera: () => sceneRef.current?.freeCamera(),
      overview: () => {
        select(null);
        sceneRef.current?.resetView();
      },
      get orbits() { return uiState.current.settings.showOrbits; },
      setOrbits: (on) => update({ showOrbits: on }),
      get labels() { return uiState.current.settings.showLabels; },
      setLabels: (on) => update({ showLabels: on }),
      get bodyScale() { return uiState.current.settings.bodyScale; },
      setBodyScale: (id) => update({ bodyScale: id }),
      setRate: (r) => {
        simulation.rate = r;
        update({ rate: r });
      },
      effect: (kind, at, sizeKm, color, sourceId, debrisIds) => sceneRef.current?.effect(kind, at, sizeKm, color, sourceId, debrisIds),
    },
  });
  /**
   * The single path for console commands, whether typed or triggered by a toolbar button, so both
   * behave identically and both appear in the transcript.
   */
  const submitCommand = (raw: string) => {
    const echo = mkLine('input', raw, `${creatorName}@solarsystem ~$`);
    if (raw.trim()) {
      setCommands((h) => {
        const next = (h.at(-1) === raw ? h : [...h, raw]).slice(-100);
        storage.setHistory(next);
        return next;
      });
    }
    const out = executeCommand(raw, consoleContext());
    refresh();
    if (!out) return appendLines([echo]);
    if (out.clear) return setLines([]);
    appendLines([echo, ...toLines(out.lines)]);
    return out;
  };

  /* ---------------------------------------------------------------- export / import */

  const fileInput = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<{ name: string; loaded: LoadedUniverse } | null>(null);

  const exportUniverse = () => {
    const now = new Date();
    const json = serializeUniverse({
      creatorName: creatorName ?? 'creator',
      snapshot: simulation.snapshot(),
      paused: simulation.paused,
      rate: simulation.rate,
      commands,
      transcript: lines,
      undo: history.undoEntries,
      redo: history.redoEntries,
      now,
    });
    const name = exportFilename(creatorName ?? 'universe', now);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    appendLines([mkLine('success', `Exported ${simulation.bodies.length} bodies to ${name}.`)]);
    notify('success', `Universe exported as ${name}`);
  };

  const onFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (!file) return;
    try {
      if (file.size > MAX_FILE_BYTES) throw new SaveError(`File is too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
      const loaded = parseUniverse(await file.text());
      setPendingImport({ name: file.name, loaded });
    } catch (err) {
      const msg = err instanceof SaveError ? err.message : 'Could not read the file.';
      appendLines([mkLine('error', `Import failed (${file.name}): ${msg}`), mkLine('muted', 'Your current universe is unchanged.')]);
      notify('error', `Import failed: ${msg}`);
    }
  };

  /** Commits a validated import in one step. The simulation restore is the only fallible part and runs first. */
  const applyImport = (useFileName: boolean) => {
    if (!pendingImport) return;
    const { loaded, name } = pendingImport;
    try {
      simulation.restore(loaded.snapshot);
    } catch (err) {
      setPendingImport(null);
      notify('error', `Import failed: ${(err as Error).message}. Your universe is unchanged.`);
      return;
    }
    simulation.paused = loaded.paused;
    simulation.rate = loaded.rate;
    update({ rate: loaded.rate });
    history.replace(loaded.undo, loaded.redo);
    setCommands(loaded.commands);
    storage.setHistory(loaded.commands);
    if (useFileName) confirmName(loaded.creatorName);
    setLines([
      ...loaded.transcript.map((l) => ({ ...l, id: lineId++ })),
      mkLine('success', `Imported ${name}: ${loaded.snapshot.bodies.length} bodies at ${jdToCalendar(simulation.epochJD + loaded.snapshot.t)} TDB.`),
    ]);
    select(null);
    sceneRef.current?.resetView();
    setPendingImport(null);
    refresh();
    notify('success', `Universe imported from ${name}`);
  };

  // Ctrl/⌘+Z and Ctrl/⌘+Shift+Z (or Ctrl+Y) run the same console commands as the buttons.
  const submitRef = useRef(submitCommand);
  submitRef.current = submitCommand;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTyping(e.target) || document.querySelector('[aria-modal="true"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        submitRef.current('undo');
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        submitRef.current('redo');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const reducedMotion = settings.reducedMotion === 'system' ? systemReduced : settings.reducedMotion === 'on';

  useEffect(() => storage.setSettings(settings), [settings]);
  useEffect(() => {
    simulation.rate = settings.rate;
  }, [simulation, settings.rate]);
  // On phones the inspector and console share the bottom sheet.
  useEffect(() => {
    if (isNarrow && selectedId) setConsoleOpen(false);
  }, [isNarrow, selectedId]);

  const confirmName = (name: string) => {
    storage.setCreatorName(name);
    setCreatorName(name);
    setRenaming(false);
  };
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  return (
    <div className={`app ${creatorName ? 'is-ready' : 'is-onboarding'} ${selectedBody ? 'has-inspector' : ''} ${consoleOpen ? 'console-open' : ''}`}>
      <SolarScene
        ref={sceneRef}
        simulation={simulation}
        selectedId={selectedId}
        onSelect={select}
        editingId={editingId}
        onEdit={edit}
        onEditMessage={setEditMessage}
        onEditCommit={(label, before, after) => history.record(label, before, after)}
        reducedMotion={reducedMotion}
        showOrbits={settings.showOrbits}
        showLabels={settings.showLabels}
        bodyScale={bodyScaleById(settings.bodyScale)}
      />

      {creatorName && (
        <>
          <Header
            epochJD={simulation.epochJD}
            snap={snap}
            creatorName={creatorName}
            onRename={() => setRenaming(true)}
            onExport={exportUniverse}
            onImport={() => fileInput.current?.click()}
          />
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={onFileChosen} aria-hidden="true" tabIndex={-1} />

          <div className="dock">
            <BodyList bodies={snap.bodies} snap={snap} selectedId={selectedId} onSelect={select} />
            <Terminal
              creatorName={creatorName}
              lines={lines}
              commands={commands}
              onSubmit={submitCommand}
              onClear={() => setLines([])}
              complete={(input) => complete(input, consoleContext())}
              collapsed={!consoleOpen}
              onToggleCollapsed={() => setConsoleOpen((o) => !o)}
            />
          </div>

          {selectedBody && (
            <Inspector
              body={selectedBody}
              snap={snap}
              bodyScale={bodyScaleById(settings.bodyScale)}
              editing={editingId === selectedBody.id}
              editMessage={editMessage}
              halted={snap.status.kind === 'halted'}
              onEdit={(on) => edit(on ? selectedBody.id : null)}
              onSetPosition={(p) => {
                const before = simulation.snapshot();
                const res = simulation.setBodyPosition(selectedBody.id, p);
                if (res.ok) history.record(`move ${selectedBody.name} (inspector)`, before, simulation.snapshot());
                setEditMessage(res.ok ? null : res.message);
                refresh();
                return res.ok;
              }}
              onClose={() => select(null)}
            />
          )}

          <Transport
            paused={snap.paused}
            halted={snap.status.kind === 'halted'}
            lagging={snap.lagging}
            rate={settings.rate}
            showOrbits={settings.showOrbits}
            showLabels={settings.showLabels}
            bodyScale={settings.bodyScale}
            onBodyScale={(id) => update({ bodyScale: id })}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            undoLabel={history.peekUndo()}
            redoLabel={history.peekRedo()}
            onUndo={() => submitCommand('undo')}
            onRedo={() => submitCommand('redo')}
            onTogglePaused={() => {
              simulation.paused = !simulation.paused;
              refresh();
            }}
            onReset={() => {
              const before = simulation.snapshot();
              simulation.reset();
              history.record('reset (toolbar)', before, simulation.snapshot());
              setEditMessage(null);
              refresh();
            }}
            onRate={(r) => update({ rate: r })}
            onToggleOrbits={() => update({ showOrbits: !settings.showOrbits })}
            onToggleLabels={() => update({ showLabels: !settings.showLabels })}
            onOverview={() => {
              select(null);
              sceneRef.current?.resetView();
            }}
          />

          {snap.status.kind === 'halted' && (
            <div className="banner" role="alert">
              <strong>Simulation halted.</strong> {snap.status.reason} Reset, or type <code>undo</code> if a command caused it.
            </div>
          )}
        </>
      )}

      {pendingImport && creatorName && (
        <ImportDialog
          fileName={pendingImport.name}
          loaded={pendingImport.loaded}
          current={{ creatorName, bodies: simulation.bodies.length, date: jdToCalendar(simulation.epochJD + simulation.time) }}
          onConfirm={applyImport}
          onExportFirst={exportUniverse}
          onCancel={() => setPendingImport(null)}
        />
      )}
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {!creatorName && <Onboarding mode="first-run" onConfirm={confirmName} />}
      {creatorName && renaming && (
        <Onboarding mode="rename" initialName={creatorName} onConfirm={confirmName} onCancel={() => setRenaming(false)} />
      )}
    </div>
  );
}
