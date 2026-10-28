import { useEffect, useState } from 'react';
import type { GravitySimulation } from '../simulation/GravitySimulation';
import type { BodyState, CelestialBodyDef, SimulationStatus } from '../types';

export interface Snapshot {
  time: number;
  status: SimulationStatus;
  paused: boolean;
  lagging: boolean;
  editing: boolean;
  states: Map<string, BodyState>;
  frozen: Set<string>;
  bodies: readonly CelestialBodyDef[];
  revision: number;
  generation: number;
}

function take(sim: GravitySimulation): Snapshot {
  return {
    time: sim.time,
    status: sim.status,
    paused: sim.paused,
    lagging: sim.lagging,
    editing: sim.editing,
    states: new Map(sim.bodies.map((b) => [b.id, sim.getState(b.id)!])),
    frozen: new Set(sim.bodies.filter((b) => sim.isFrozen(b.id)).map((b) => b.id)),
    bodies: sim.bodies,
    revision: sim.revision,
    generation: sim.generation,
  };
}

/** Polls the simulation for UI readouts at a modest rate, decoupled from the render loop. */
export function useSimulationSnapshot(sim: GravitySimulation, hz = 5): [Snapshot, () => void] {
  const [snap, setSnap] = useState(() => take(sim));
  useEffect(() => {
    const id = window.setInterval(() => setSnap(take(sim)), 1000 / hz);
    return () => window.clearInterval(id);
  }, [sim, hz]);
  return [snap, () => setSnap(take(sim))];
}

export function heliocentric(snap: Snapshot, id: string) {
  const s = snap.states.get(id), sun = snap.states.get('sun');
  if (!s || !sun || id === 'sun') return null;
  const r = [0, 1, 2].map((i) => s.position[i] - sun.position[i]);
  const v = [0, 1, 2].map((i) => s.velocity[i] - sun.velocity[i]);
  return { distanceAu: Math.hypot(...r), speedAuDay: Math.hypot(...v) };
}
