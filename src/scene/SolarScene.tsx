import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { GravitySimulation, SimulationSnapshot } from '../simulation/GravitySimulation';
import { SolarSystemRenderer } from './SolarSystemRenderer';
import type { BodyScale } from './presentation';
import type { EffectKind } from './effects';
import type { Vec3 } from '../types';

export interface SolarSceneHandle {
  resetView(): void;
  focus(id: string): void;
  freeCamera(): void;
  effect(kind: EffectKind, atAu: Vec3, sizeKm: number, color: string, sourceId?: string, debrisIds?: string[]): void;
}

interface Props {
  simulation: GravitySimulation;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onEditMessage: (message: string | null) => void;
  onEditCommit: (label: string, before: SimulationSnapshot, after: SimulationSnapshot) => void;
  reducedMotion: boolean;
  showOrbits: boolean;
  showLabels: boolean;
  bodyScale: BodyScale;
}

/** Thin React wrapper; all Three.js lifecycle lives in SolarSystemRenderer. */
export const SolarScene = forwardRef<SolarSceneHandle, Props>(function SolarScene(
  { simulation, selectedId, onSelect, editingId, onEdit, onEditMessage, onEditCommit, reducedMotion, showOrbits, showLabels, bodyScale },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SolarSystemRenderer | null>(null);
  const callbacks = useRef({ onSelect, onEdit, onEditMessage, onEditCommit });
  callbacks.current = { onSelect, onEdit, onEditMessage, onEditCommit };
  const initial = useRef({ reducedMotion, showOrbits, showLabels, selectedId, editingId, bodyScale });

  useEffect(() => {
    const r = new SolarSystemRenderer(containerRef.current!, simulation, {
      reducedMotion: initial.current.reducedMotion,
      onSelect: (id) => callbacks.current.onSelect(id),
      onEdit: (id) => callbacks.current.onEdit(id),
      onEditMessage: (m) => callbacks.current.onEditMessage(m),
      onEditCommit: (label, before, after) => callbacks.current.onEditCommit(label, before, after),
    });
    r.setShowOrbits(initial.current.showOrbits);
    r.setShowLabels(initial.current.showLabels);
    r.setBodyScale(initial.current.bodyScale);
    r.select(initial.current.selectedId);
    r.setEditing(initial.current.editingId);
    rendererRef.current = r;
    // Dev-only handle for manual/automated interaction checks; stripped from production builds.
    if (import.meta.env.DEV) (window as unknown as { __deityRenderer?: SolarSystemRenderer }).__deityRenderer = r;
    return () => {
      r.dispose();
      rendererRef.current = null;
    };
  }, [simulation]);

  useEffect(() => rendererRef.current?.setReducedMotion(reducedMotion), [reducedMotion]);
  useEffect(() => rendererRef.current?.setShowOrbits(showOrbits), [showOrbits]);
  useEffect(() => rendererRef.current?.setShowLabels(showLabels), [showLabels]);
  useEffect(() => rendererRef.current?.setBodyScale(bodyScale), [bodyScale]);
  useEffect(() => rendererRef.current?.select(selectedId), [selectedId]);
  useEffect(() => rendererRef.current?.setEditing(editingId), [editingId]);

  useImperativeHandle(
    ref,
    () => ({
      resetView: () => rendererRef.current?.resetView(),
      focus: (id) => rendererRef.current?.focusBody(id),
      freeCamera: () => rendererRef.current?.freeCamera(),
      effect: (kind, at, sizeKm, color, sourceId, debrisIds) => rendererRef.current?.effect(kind, at, sizeKm, color, sourceId, debrisIds),
    }),
    [],
  );

  return (
    <div className="scene" ref={containerRef}>
      <p className="scene-hint scene-hint--pointer" aria-hidden="true">
        Click select · Double-click move · Right-drag orbit · Scroll zoom · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly · <kbd>Shift</kbd> faster
      </p>
      <p className="scene-hint scene-hint--touch" aria-hidden="true">Tap select · Double-tap move · Drag orbit · Pinch zoom</p>
    </div>
  );
});
