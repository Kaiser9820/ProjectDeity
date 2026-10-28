import * as THREE from 'three';
import { PHYSICAL_AXES, type Axis } from './presentation';

const COLORS: Record<Axis, { base: string; hover: string }> = {
  x: { base: '#e5484d', hover: '#ff8589' },
  y: { base: '#46a758', hover: '#7fd98d' },
  z: { base: '#3e7bf0', hover: '#8ab4ff' },
};
const ACTIVE = '#ffe08a';
/** Target on-screen length of each arrow, CSS pixels. */
const SCREEN_LENGTH = { mouse: 110, touch: 150 };

interface Handle {
  axis: Axis;
  materials: THREE.MeshBasicMaterial[];
  pick: THREE.Mesh;
  label: THREE.Sprite;
}

/**
 * Three-axis translation handles in the style of a DCC/level-editor move tool.
 * Purely visual + picking; the renderer owns the drag math and writes to the simulation.
 * Drawn on top of everything (no depth test) and scaled for constant screen size.
 */
export class TranslateGizmo {
  readonly root = new THREE.Group();
  private handles: Handle[] = [];
  private disposables: { dispose(): void }[] = [];
  private hovered: Axis | null = null;
  private active: Axis | null = null;
  touchMode = false;

  constructor() {
    this.root.visible = false;
    this.root.renderOrder = 1000;
    const shaftGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.78, 12);
    shaftGeo.translate(0, 0.39 + 0.06, 0);
    const tipGeo = new THREE.ConeGeometry(0.055, 0.2, 20);
    tipGeo.translate(0, 0.94, 0);
    // Invisible, fat pick volume: generous target without visual bulk.
    const pickGeo = new THREE.CylinderGeometry(0.11, 0.11, 1.1, 8);
    pickGeo.translate(0, 0.55, 0);
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    this.disposables.push(shaftGeo, tipGeo, pickGeo, pickMat);

    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      const group = new THREE.Group();
      const dir = new THREE.Vector3(...PHYSICAL_AXES[axis].scene);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const materials = [0, 1].map(() => {
        const m = new THREE.MeshBasicMaterial({ color: COLORS[axis].base, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9, toneMapped: false });
        this.disposables.push(m);
        return m;
      });
      const shaft = new THREE.Mesh(shaftGeo, materials[0]);
      const tip = new THREE.Mesh(tipGeo, materials[1]);
      for (const m of [shaft, tip]) {
        m.renderOrder = 1000;
        m.raycast = () => {};
      }
      const pick = new THREE.Mesh(pickGeo, pickMat);
      pick.userData.axis = axis;
      const label = this.makeLabel(axis.toUpperCase(), COLORS[axis].base);
      label.position.set(0, 1.18, 0);
      group.add(shaft, tip, pick, label);
      this.root.add(group);
      this.handles.push({ axis, materials, pick, label });
    }
    const hubGeo = new THREE.SphereGeometry(0.04, 16, 12);
    const hubMat = new THREE.MeshBasicMaterial({ color: '#e3e5e9', depthTest: false, depthWrite: false, transparent: true, opacity: 0.85, toneMapped: false });
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.renderOrder = 1000;
    hub.raycast = () => {};
    this.root.add(hub);
    this.disposables.push(hubGeo, hubMat);
  }

  private makeLabel(text: string, color: string) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.font = '600 40px "IBM Plex Sans Condensed", "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 32, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(0.16);
    s.renderOrder = 1001;
    s.raycast = () => {};
    this.disposables.push(tex, mat);
    return s;
  }

  /** Keep a constant on-screen size, but always reach beyond the body's rendered sphere. */
  update(position: THREE.Vector3, camera: THREE.PerspectiveCamera, viewportHeight: number, bodyRadius: number) {
    this.root.position.copy(position);
    const dist = camera.position.distanceTo(position);
    const worldPerPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / viewportHeight;
    const len = SCREEN_LENGTH[this.touchMode ? 'touch' : 'mouse'] * worldPerPx;
    this.root.scale.setScalar(Math.max(len, bodyRadius * 1.9));
  }

  pick(raycaster: THREE.Raycaster): Axis | null {
    if (!this.root.visible) return null;
    const hit = raycaster.intersectObjects(this.handles.map((h) => h.pick), false)[0];
    return hit ? (hit.object.userData.axis as Axis) : null;
  }

  setHover(axis: Axis | null) {
    this.hovered = axis;
    this.paint();
  }

  setActive(axis: Axis | null) {
    this.active = axis;
    this.paint();
  }

  private paint() {
    for (const h of this.handles) {
      const isActive = this.active === h.axis;
      const color = isActive ? ACTIVE : this.hovered === h.axis && !this.active ? COLORS[h.axis].hover : COLORS[h.axis].base;
      const dim = this.active !== null && !isActive;
      for (const m of h.materials) {
        m.color.set(color);
        m.opacity = dim ? 0.35 : 1;
      }
      (h.label.material as THREE.SpriteMaterial).opacity = dim ? 0.35 : 1;
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}

/**
 * Parameter s along the axis line (origin a, unit direction d) of the point closest to the ray
 * (origin o, unit direction u). Returns null when the ray is nearly parallel to the axis, where the
 * closest point is ill-conditioned and would make the body jump.
 */
export function closestAxisParam(a: THREE.Vector3, d: THREE.Vector3, o: THREE.Vector3, u: THREE.Vector3): number | null {
  const w = a.clone().sub(o);
  const b = d.dot(u);
  const denom = 1 - b * b;
  if (denom < 1e-4) return null;
  return (b * u.dot(w) - d.dot(w)) / denom;
}
