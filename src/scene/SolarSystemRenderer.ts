import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CelestialBodyDef, Simulation, Vec3 } from '../types';
import type { GravitySimulation, SimulationSnapshot } from '../simulation/GravitySimulation';
import { auToScene, kmToScene, PHYSICAL_AXES, TRUE_SCALE, SCENE_UNITS_PER_AU, sceneDeltaToAu, visualRadius, type Axis, type BodyScale } from './presentation';
import { choosePick, PICK_TOLERANCE_PX, rankPicks, type PickCandidate } from './picking';
import { closestAxisParam, TranslateGizmo } from './TranslateGizmo';
import { ExplosionEffect, type EffectKind } from './effects';

export interface RendererOptions {
  reducedMotion: boolean;
  onSelect: (id: string | null) => void;
  /** Request to enter (id) or leave (null) position-editing mode. */
  onEdit: (id: string | null) => void;
  /** Feedback from an edit, e.g. a blocked move; null clears it. */
  onEditMessage: (message: string | null) => void;
  /** A completed gizmo move, with the full state before and after (for the shared undo history). */
  onEditCommit: (label: string, before: SimulationSnapshot, after: SimulationSnapshot) => void;
}

type EditableSimulation = Simulation &
  Pick<GravitySimulation, 'exportState' | 'predictPaths' | 'setBodyPosition' | 'beginEdit' | 'endEdit' | 'revision' | 'has' | 'snapshot'>;

interface GizmoDrag {
  pointerId: number;
  axis: Axis;
  bodyId: string;
  startAu: Vec3;
  /** Render origin frozen for the duration of the drag so the drag frame does not chase the body. */
  originAu: Vec3;
  s0: number;
  /** Full state at drag start, for undo. */
  before: SimulationSnapshot;
}

const DOUBLE_CLICK_MS = 400;
const SAME_SPOT_PX = 8;
const DRAG_THRESHOLD_PX = 6;
const NAV_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ShiftLeft', 'ShiftRight']);

/** True if keyboard input should go to a form control rather than scene navigation. */
function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  return t.matches('input, textarea, select, [role="radio"], [role="slider"], [role="listbox"]');
}

interface BodyVisual {
  def: CelestialBodyDef;
  group: THREE.Group;
  spin: THREE.Object3D;
  /** Holds the unit sphere, rings and glow; scaled to the rendered radius (scene units). */
  sizer: THREE.Group;
  mesh: THREE.Mesh;
  label: HTMLButtonElement;
  /** Rendered radius, scene units. */
  radius: number;
  /** GPU resources owned by this body only (released when the body is removed). */
  owned: { dispose(): void }[];
}

const OVERVIEW_DISTANCE = 1400; // scene units ≈ 9.4 au: inner system plus Jupiter
const FOCUS_SECONDS = 1.1;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Owns all Three.js state. It reads body positions from the Simulation each frame. The only
 * physical writes are explicit user edits through the gizmo, which go through
 * Simulation.setBodyPosition (the single source of truth); meshes are never moved independently. Rendering uses a floating origin: the focused point is always at the
 * scene origin, so float32 GPU precision is spent where the camera is looking.
 */
export class SolarSystemRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private timer = new THREE.Timer();
  private raycaster = new THREE.Raycaster();
  private pointerDown: { x: number; y: number; id: number; button: number } | null = null;
  private activePointers = new Set<number>();
  private lastClick: { t: number; x: number; y: number; id: string | null } | null = null;
  private gizmo = new TranslateGizmo();
  private drag: GizmoDrag | null = null;
  private editingId: string | null = null;
  private pathsRevision = -1;
  private keys = new Set<string>();
  private navVelocity = new THREE.Vector3();
  private visuals = new Map<string, BodyVisual>();
  private paths = new THREE.Group();
  private pathsGeneration = -1;
  private pathsTime = 0;
  private pathWorker: Worker | null = null;
  private pathRequestId = 0;
  private pathPending = false;
  private stars: THREE.Points;
  private sunLight: THREE.PointLight;
  private bodyScale: BodyScale = TRUE_SCALE;
  private loader = new THREE.TextureLoader();
  private textures = new Map<string, THREE.Texture>();
  private unitSphere = new THREE.SphereGeometry(1, 96, 48);
  private glowTexture: THREE.CanvasTexture;
  private effects: ExplosionEffect[] = [];
  private syncedRevision = -1;
  private syncedGeneration = -1;
  private labelLayer: HTMLDivElement;
  private frameId = 0;
  private disposables: { dispose(): void }[] = [];
  private resizeObserver: ResizeObserver;
  private reducedMotion: boolean;
  private showLabels = true;
  private selectedId: string | null = null;

  /** Current origin of the render frame, au (barycentric). */
  private focusAu: Vec3 = [0, 0, 0];
  /** Body the camera follows; null after free navigation (WASD). */
  private focusId: string | null = 'sun';
  /** Alternatively, a group (e.g. explosion debris) whose centre of mass the camera follows. */
  private focusGroup: string[] | null = null;
  private transition: { from: Vec3; fromDist: number; toDist: number; fromDir: THREE.Vector3; toDir: THREE.Vector3; t: number } | null = null;

  constructor(
    private container: HTMLElement,
    private simulation: EditableSimulation,
    private options: RendererOptions,
  ) {
    this.reducedMotion = options.reducedMotion;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    const el = this.renderer.domElement;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'Solar System view. Drag or right-drag to orbit, scroll or pinch to zoom, W A S D to move, arrow keys to orbit. Click a body to select it; double-click to move it.');
    container.appendChild(el);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'labels';
    container.appendChild(this.labelLayer);

    this.scene.background = new THREE.Color('#05060a');
    this.camera = new THREE.PerspectiveCamera(45, 1, 1e-5, 1e7);
    this.setCameraOffset(new THREE.Vector3(0, 0.55, 0.84).normalize().multiplyScalar(OVERVIEW_DISTANCE));

    this.controls = new OrbitControls(this.camera, el);
    this.controls.enablePan = false;
    this.controls.enableDamping = !this.reducedMotion;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 1.4;
    this.controls.maxDistance = 30 * SCENE_UNITS_PER_AU * 3;
    // Left- and right-drag both orbit; middle-drag dollies. Keyboard is handled below.
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    el.tabIndex = 0;

    this.scene.add(new THREE.AmbientLight('#ffffff', 0.035));
    this.sunLight = new THREE.PointLight('#fff4e6', 2.6, 0, 0);
    this.scene.add(this.sunLight);
    this.stars = this.buildStarfield();
    this.scene.add(this.paths);
    this.scene.add(this.gizmo.root);

    this.glowTexture = this.makeGlowTexture();
    this.disposables.push(this.unitSphere, this.glowTexture);
    this.syncVisuals();
    this.applyMinDistance();

    // Capture phase so a gizmo grab can claim the pointer before OrbitControls sees it.
    el.addEventListener('pointerdown', this.handlePointerDown, { capture: true });
    el.addEventListener('pointermove', this.handlePointerMove);
    el.addEventListener('pointerup', this.handlePointerUp);
    el.addEventListener('pointercancel', this.handlePointerCancel);
    el.addEventListener('lostpointercapture', this.handleLostCapture);
    container.addEventListener('contextmenu', this.preventDefault);
    window.addEventListener('keydown', this.handleKeyDown, { capture: true });
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  // ------------------------------------------------------------- public API

  setReducedMotion(value: boolean) {
    this.reducedMotion = value;
    this.controls.enableDamping = !value;
  }

  setShowOrbits(value: boolean) {
    this.paths.visible = value;
  }

  setShowLabels(value: boolean) {
    this.showLabels = value;
    this.labelLayer.hidden = !value;
  }

  /** Select a body and fly the camera to it; null keeps the current focus but clears selection. */
  select(id: string | null) {
    this.selectedId = id && this.visuals.has(id) ? id : null;
    for (const v of this.visuals.values()) v.label.classList.toggle('is-selected', v.def.id === this.selectedId);
    if (this.selectedId) this.focus(this.selectedId, this.visuals.get(this.selectedId)!.radius * 8, this.daySideDirection(this.selectedId));
  }

  /** Apply a size preset. Purely visual: rings, glow, picking and the gizmo follow the rendered size. */
  setBodyScale(scale: BodyScale) {
    this.bodyScale = scale;
    for (const v of this.visuals.values()) this.applySize(v);
    if (!this.transition) this.applyMinDistance();
  }

  /** Fly to a body and follow it, without changing the selection. */
  focusBody(id: string) {
    const v = this.visuals.get(id);
    if (v) this.focus(id, v.radius * 8, this.daySideDirection(id));
  }

  /** Stop following; the camera stays exactly where it is. */
  freeCamera() {
    if (this.transition) this.transition = null;
    this.focusId = null;
    this.focusGroup = null;
    this.applyMinDistance();
  }

  /**
   * Visual-only explosion at a physical position. Size adapts so it is visible from the current view.
   * If the camera was following the destroyed body, it follows the debris' centre of mass instead.
   */
  effect(kind: EffectKind, atAu: Vec3, sizeKm: number, color: string, sourceId?: string, debrisIds?: string[]) {
    if (sourceId && debrisIds?.length && this.focusId === sourceId) {
      this.focusGroup = debrisIds;
      this.focusId = null;
    }
    const center = new THREE.Vector3(...auToScene(atAu, this.focusAu));
    const dist = center.distanceTo(this.camera.position);
    const size = Math.max(kmToScene(sizeKm) * this.bodyScale.planet * 1.2, dist * 0.02);
    const fx = new ExplosionEffect(kind, atAu, size, color, this.glowTexture, this.reducedMotion);
    fx.debrisIds = debrisIds?.length ? debrisIds : null;
    this.scene.add(fx.root);
    this.effects.push(fx);
  }

  /** Mass-weighted centre of the followed group, or null if none of it exists any more. */
  private groupCentre(ids: string[] | null = this.focusGroup): Vec3 | null {
    if (!ids) return null;
    const c: Vec3 = [0, 0, 0];
    let m = 0;
    for (const id of ids) {
      const s = this.simulation.getState(id);
      const w = this.simulation.bodies.find((b) => b.id === id)?.physical.massKg;
      if (!s || !w) continue;
      for (let k = 0; k < 3; k++) c[k] += s.position[k] * w;
      m += w;
    }
    if (!m) {
      if (ids === this.focusGroup) this.focusGroup = null;
      return null;
    }
    return [c[0] / m, c[1] / m, c[2] / m];
  }

  private applySize(v: BodyVisual) {
    v.radius = visualRadius(v.def, this.bodyScale);
    v.sizer.scale.setScalar(v.radius);
  }

  /**
   * Reconciles visuals with the simulation's current body set after any edit: creates new
   * bodies, disposes removed ones (mesh, textures, label), refreshes sizes and names, and drops
   * focus, selection and editing state that pointed at removed bodies.
   */
  private syncVisuals() {
    this.syncedRevision = this.simulation.revision;
    this.syncedGeneration = this.simulation.generation;
    const live = new Set(this.simulation.bodies.map((b) => b.id));
    for (const [id, v] of this.visuals) {
      if (live.has(id)) continue;
      v.group.removeFromParent();
      v.label.remove();
      for (const d of v.owned) d.dispose();
      this.visuals.delete(id);
      if (this.focusId === id) this.freeCamera();
      if (this.selectedId === id) this.selectedId = null;
      if (this.editingId === id) {
        this.setEditing(null);
        this.options.onEdit(null);
      }
    }
    for (const def of this.simulation.bodies) {
      let v = this.visuals.get(def.id);
      if (!v) v = this.buildBody(def);
      v.def = def;
      v.label.querySelector('.label__name')!.textContent = def.name;
      this.applySize(v);
    }
  }

  private texture(url: string) {
    let t = this.textures.get(url);
    if (!t) {
      t = this.loader.load(import.meta.env.BASE_URL + url);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.textures.set(url, t);
      this.disposables.push(t);
    }
    return t;
  }

  /** Enter or leave position-editing mode for a body (the gizmo appears on it). */
  setEditing(id: string | null) {
    const next = id && this.visuals.has(id) ? id : null;
    if (next === this.editingId) return;
    if (this.drag) this.endDrag(false);
    this.editingId = next;
    this.gizmo.root.visible = next !== null;
    this.gizmo.setHover(null);
    this.renderer.domElement.style.cursor = '';
  }

  resetView() {
    this.select(null);
    this.focus('sun', OVERVIEW_DISTANCE, new THREE.Vector3(0, 0.55, 0.84));
  }

  dispose() {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    if (this.drag) this.endDrag(false);
    el.removeEventListener('pointerdown', this.handlePointerDown, { capture: true });
    el.removeEventListener('pointermove', this.handlePointerMove);
    el.removeEventListener('pointerup', this.handlePointerUp);
    el.removeEventListener('pointercancel', this.handlePointerCancel);
    el.removeEventListener('lostpointercapture', this.handleLostCapture);
    this.container.removeEventListener('contextmenu', this.preventDefault);
    window.removeEventListener('keydown', this.handleKeyDown, { capture: true });
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.controls.dispose();
    this.gizmo.dispose();
    this.timer.dispose();
    this.pathWorker?.terminate();
    this.clearPaths();
    for (const fx of this.effects) fx.dispose();
    for (const v of this.visuals.values()) {
      v.label.remove();
      for (const d of v.owned) d.dispose();
    }
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    el.remove();
    this.labelLayer.remove();
  }

  // ------------------------------------------------------------- build

  private buildStarfield() {
    // Stars sit on a sphere that follows the camera, i.e. at optical infinity.
    const count = 5000;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pos.set([s * Math.cos(th) * 1e6, u * 1e6, s * Math.sin(th) * 1e6], i * 3);
      const b = 0.25 + Math.random() ** 3 * 0.75;
      c.setHSL(Math.random() < 0.75 ? 0.6 : 0.09, 0.2, b);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, vertexColors: true, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);
    this.disposables.push(geo, mat);
    return points;
  }

  private buildBody(def: CelestialBodyDef): BodyVisual {
    const owned: { dispose(): void }[] = [];
    const group = new THREE.Group();
    const sizer = new THREE.Group();
    group.add(sizer);
    // Tilt pivot: obliquity relative to the orbit plane (approximated as the ecliptic).
    const tilt = new THREE.Group();
    tilt.rotation.z = THREE.MathUtils.degToRad(def.physical.obliquityDeg);
    const spin = new THREE.Group();
    tilt.add(spin);
    sizer.add(tilt);

    const isHole = def.kind === 'black-hole';
    const glowing = def.kind === 'star' || def.emissive;
    let mat: THREE.Material;
    if (isHole) mat = new THREE.MeshBasicMaterial({ color: '#000000' });
    else if (glowing) mat = new THREE.MeshBasicMaterial({ map: this.texture(def.texture), color: new THREE.Color(2.2, 1.9, 1.45) });
    else mat = new THREE.MeshStandardMaterial({ map: this.texture(def.texture), roughness: 0.92, metalness: 0 });
    // Fragments are irregular chunks, not spheres.
    const geo = def.kind === 'fragment' ? new THREE.IcosahedronGeometry(1, 1) : this.unitSphere;
    if (geo !== this.unitSphere) owned.push(geo);
    if (def.kind === 'fragment') this.roughen(geo as THREE.BufferGeometry, def.id);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.bodyId = def.id;
    spin.add(mesh);
    owned.push(mat);

    if (glowing || isHole) {
      const sm = new THREE.SpriteMaterial({
        map: this.glowTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
        opacity: isHole ? 0.35 : def.kind === 'star' ? 0.55 : 0.3, color: isHole ? '#8a6cff' : '#ffffff',
      });
      const sprite = new THREE.Sprite(sm);
      sprite.scale.setScalar(isHole ? 4 : 5);
      sprite.raycast = () => {};
      sizer.add(sprite);
      owned.push(sm);
    }

    if (isHole) {
      // Accretion disc: a hot, thin ring around the shadow (illustrative).
      const dg = new THREE.RingGeometry(1.4, 3.2, 160, 1);
      const p = dg.attributes.position as THREE.BufferAttribute, uv = dg.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) uv.setXY(i, (Math.hypot(p.getX(i), p.getY(i)) - 1.4) / 1.8, 0.5);
      const cv = document.createElement('canvas');
      cv.width = 256;
      cv.height = 1;
      const ctx = cv.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, 256, 0);
      g.addColorStop(0, 'rgba(255,240,220,1)');
      g.addColorStop(0.25, 'rgba(255,170,90,0.9)');
      g.addColorStop(1, 'rgba(120,60,200,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 1);
      const dt = new THREE.CanvasTexture(cv);
      dt.colorSpace = THREE.SRGBColorSpace;
      const dm = new THREE.MeshBasicMaterial({ map: dt, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const disc = new THREE.Mesh(dg, dm);
      disc.rotation.x = -Math.PI / 2 + 0.35;
      disc.raycast = () => {};
      sizer.add(disc);
      owned.push(dg, dt, dm);
    }

    if (def.rings) {
      // Ring radii in units of the planet's radius, since the sizer scales everything together.
      const inner = def.rings.innerKm / def.physical.meanRadiusKm, outer = def.rings.outerKm / def.physical.meanRadiusKm;
      const rg = new THREE.RingGeometry(inner, outer, 180, 1);
      const p = rg.attributes.position as THREE.BufferAttribute, uv = rg.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) uv.setXY(i, (Math.hypot(p.getX(i), p.getY(i)) - inner) / (outer - inner), 0.5);
      const rm = new THREE.MeshStandardMaterial({ map: this.texture(def.rings.texture), transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 1 });
      const ring = new THREE.Mesh(rg, rm);
      ring.rotation.x = -Math.PI / 2;
      ring.raycast = () => {};
      tilt.add(ring);
      owned.push(rg, rm);
    }

    const label = document.createElement('button');
    label.type = 'button';
    label.className = `label${def.kind === 'fragment' ? ' label--minor' : ''}`;
    label.tabIndex = -1; // keyboard users select from the body list instead
    label.style.setProperty('--body', def.color);
    label.innerHTML = '<span class="label__reticle"></span><span class="label__dot"></span><span class="label__name"></span>';
    label.querySelector('.label__name')!.textContent = def.name;
    label.addEventListener('click', (e) => this.handleClickResult([def.id], e.clientX, e.clientY));
    label.addEventListener('contextmenu', this.preventDefault);
    this.labelLayer.appendChild(label);

    this.scene.add(group);
    const v: BodyVisual = { def, group, spin, sizer, mesh, label, radius: kmToScene(def.physical.meanRadiusKm), owned };
    this.visuals.set(def.id, v);
    return v;
  }

  /** Deterministic lumpy displacement so each fragment looks like rubble. */
  private roughen(geo: THREE.BufferGeometry, seed: string) {
    let h = 2166136261;
    for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = Math.sin(v.x * 3.1 + (h & 255)) * Math.cos(v.y * 2.7 + ((h >> 8) & 255)) * Math.sin(v.z * 3.7 + ((h >> 16) & 255));
      v.multiplyScalar(0.8 + 0.25 * n);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
  }

  private makeGlowTexture() {
    const s = 256, cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const ctx = cv.getContext('2d')!;
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,240,215,0.9)');
    g.addColorStop(0.2, 'rgba(255,200,130,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /**
   * Orbit paths come from integrating the current state forward with the same gravity model.
   * The work runs in a Web Worker so the render loop never stalls.
   */
  private requestPaths() {
    this.pathsGeneration = this.simulation.generation;
    this.pathsRevision = this.simulation.revision;
    this.pathsTime = this.simulation.time;
    const id = ++this.pathRequestId;
    try {
      this.pathWorker ??= this.createPathWorker();
      this.pathPending = true;
      this.pathWorker.postMessage({ id, req: this.simulation.exportState() });
    } catch {
      // Workers unavailable: compute synchronously.
      this.setPaths(this.simulation.predictPaths());
    }
  }

  private createPathWorker() {
    const w = new Worker(new URL('../simulation/pathWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; paths: Record<string, Float64Array> }>) => {
      this.pathPending = false;
      if (e.data.id !== this.pathRequestId) return; // superseded by a newer request
      const map = new Map<string, Vec3[]>();
      for (const [k, flat] of Object.entries(e.data.paths)) {
        const pts: Vec3[] = [];
        for (let i = 0; i < flat.length; i += 3) pts.push([flat[i], flat[i + 1], flat[i + 2]]);
        map.set(k, pts);
      }
      this.setPaths(map);
    };
    return w;
  }

  private setPaths(predicted: Map<string, Vec3[]>) {
    this.clearPaths();
    for (const [id, pts] of predicted) {
      const v = this.visuals.get(id);
      if (!v || pts.length < 2) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...auToScene(p))));
      const mat = new THREE.LineBasicMaterial({ color: v.def.color, transparent: true, opacity: 0.32, depthWrite: false });
      this.paths.add(new THREE.Line(geo, mat));
    }
  }

  private clearPaths() {
    for (const l of [...this.paths.children] as THREE.Line[]) {
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
      this.paths.remove(l);
    }
  }

  // ------------------------------------------------------------- runtime

  /** A three-quarter view from the sunlit side, so a newly focused planet is not seen in shadow. */
  private daySideDirection(id: string): THREE.Vector3 | undefined {
    const body = this.simulation.getState(id), sun = this.simulation.getState('sun');
    if (!body || !sun || id === 'sun') return undefined;
    const toSun = new THREE.Vector3(...auToScene(sun.position, body.position)).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(toSun, up).normalize();
    return toSun.multiplyScalar(0.75).add(side.multiplyScalar(0.55)).add(up.multiplyScalar(0.3)).normalize();
  }

  private focus(id: string, distance: number, direction?: THREE.Vector3) {
    const offset = this.camera.position.clone();
    const fromDir = offset.clone().normalize();
    this.transition = {
      from: [...this.focusAu], fromDist: offset.length(), toDist: distance,
      fromDir, toDir: direction ? direction.clone().normalize() : fromDir.clone(),
      t: this.reducedMotion ? 1 : 0,
    };
    this.focusId = id;
    this.focusGroup = null;
    this.controls.minDistance = 0;
  }

  private setCameraOffset(v: THREE.Vector3) {
    this.camera.position.copy(v);
    this.camera.lookAt(0, 0, 0);
  }

  private applyMinDistance() {
    const v = this.focusId ? this.visuals.get(this.focusId) : undefined;
    this.controls.minDistance = v ? v.radius * 1.6 : 1e-4;
  }

  private loop = () => {
    this.frameId = requestAnimationFrame(this.loop);
    this.timer.update();
    const dt = this.timer.getDelta();
    this.simulation.step(dt);

    // Refresh predicted paths after a reset or an edit, and every 20 simulated years.
    if (
      this.pathsGeneration !== this.simulation.generation ||
      (!this.pathPending && (this.pathsRevision !== this.simulation.revision || Math.abs(this.simulation.time - this.pathsTime) > 20 * 365.25))
    )
      this.requestPaths();

    if (this.simulation.revision !== this.syncedRevision || this.simulation.generation !== this.syncedGeneration) this.syncVisuals();
    this.navigate(dt);

    // Floating origin: follow the focused body, easing in after a focus change. During a gizmo
    // drag the origin is frozen so the drag frame stays fixed while the body moves.
    const target: Vec3 = this.focusId ? (this.simulation.getState(this.focusId)?.position ?? this.focusAu) : this.groupCentre() ?? this.focusAu;
    if (this.drag) {
      this.focusAu = [...this.drag.originAu];
    } else if (this.transition) {
      const tr = this.transition;
      tr.t = Math.min(1, tr.t + dt / FOCUS_SECONDS);
      const k = ease(tr.t);
      this.focusAu = [0, 1, 2].map((i) => tr.from[i] + (target[i] - tr.from[i]) * k) as Vec3;
      const dist = Math.exp(Math.log(tr.fromDist) + (Math.log(tr.toDist) - Math.log(tr.fromDist)) * k);
      const dir = tr.fromDir.clone().lerp(tr.toDir, k);
      if (dir.lengthSq() < 1e-12) dir.copy(tr.toDir); // exactly opposite directions
      dir.normalize();
      this.camera.position.copy(dir.multiplyScalar(dist));
      this.camera.lookAt(0, 0, 0);
      if (tr.t >= 1) {
        this.transition = null;
        this.applyMinDistance();
      }
    } else {
      this.focusAu = [...target];
    }

    const days = this.simulation.time;
    let light: BodyVisual | null = null;
    for (const v of this.visuals.values()) {
      const s = this.simulation.getState(v.def.id);
      if (!s) continue;
      v.group.position.set(...auToScene(s.position, this.focusAu));
      // Spin is purely visual: sidereal rotation period applied to simulated time. Phase is arbitrary.
      const period = v.def.physical.siderealRotationHours;
      if (period) v.spin.rotation.y = ((days * 24) / period) * Math.PI * 2;
      if (v.def.kind === 'star' && (!light || v.def.physical.massKg > light.def.physical.massKg)) light = v;
    }
    // Light comes from the most massive star; if every star is gone, the system goes dark.
    this.sunLight.intensity = light ? 2.6 : 0;
    if (light) this.sunLight.position.copy(light.group.position);
    this.effects = this.effects.filter((fx) => {
      if (fx.update(dt, this.focusAu, this.camera, this.groupCentre(fx.debrisIds))) return true;
      fx.dispose();
      return false;
    });
    this.paths.position.set(...auToScene([0, 0, 0], this.focusAu));

    this.controls.update();
    if (this.editingId) {
      const v = this.visuals.get(this.editingId)!;
      this.gizmo.update(v.group.position, this.camera, this.container.clientHeight || 1, v.radius);
    }
    this.stars.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
    if (this.showLabels) this.updateLabels();
  };

  private updateLabels() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const p = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const pxPerUnitAtDist = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    for (const v of this.visuals.values()) {
      p.copy(v.group.position);
      const dist = p.distanceTo(this.camera.position);
      const inFront = p.clone().sub(this.camera.position).dot(camDir) > 0;
      p.project(this.camera);
      const screenR = (v.radius / dist) * pxPerUnitAtDist;
      const visible = inFront && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
      v.label.hidden = !visible;
      if (!visible) continue;
      const x = (p.x * 0.5 + 0.5) * w, y = (-p.y * 0.5 + 0.5) * h;
      v.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      v.label.style.setProperty('--offset', `${Math.max(6, screenR + 6).toFixed(1)}px`);
      v.label.style.setProperty('--reticle', `${Math.max(16, screenR * 2 + 12).toFixed(1)}px`);
      v.label.classList.toggle('is-resolved', screenR > 4);
    }
  }

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  // ------------------------------------------------------------- picking

  private eventToNdc(e: { clientX: number; clientY: number }) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  private pickCandidates(): PickCandidate[] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
    const pxPerUnit = rect.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    const out: PickCandidate[] = [];
    for (const v of this.visuals.values()) {
      const rel = v.group.position.clone().sub(this.camera.position);
      if (rel.dot(camDir) <= 0) continue;
      const depth = rel.length();
      const p = v.group.position.clone().project(this.camera);
      out.push({
        id: v.def.id,
        x: rect.left + (p.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-p.y * 0.5 + 0.5) * rect.height,
        screenRadius: (v.radius / depth) * pxPerUnit,
        depth,
      });
    }
    return out;
  }

  /** Single click selects; a second click on the same body within the double-click window edits it. */
  private handleClickResult(ranked: string[], x: number, y: number) {
    const now = performance.now();
    const last = this.lastClick;
    const sameSpot = !!last && Math.hypot(last.x - x, last.y - y) <= SAME_SPOT_PX;
    if (last && sameSpot && now - last.t <= DOUBLE_CLICK_MS && last.id && ranked.includes(last.id)) {
      this.lastClick = null;
      this.options.onEdit(last.id);
      return;
    }
    const id = choosePick(ranked, this.selectedId, sameSpot);
    this.lastClick = { t: now, x, y, id };
    if (id) this.options.onSelect(id);
  }

  // ------------------------------------------------------------- pointer input

  private preventDefault = (e: Event) => e.preventDefault();

  private handlePointerDown = (e: PointerEvent) => {
    this.activePointers.add(e.pointerId);
    this.gizmo.touchMode = e.pointerType === 'touch';
    // A second touch while dragging cancels the edit; the gesture becomes a camera gesture.
    if (this.drag && e.pointerId !== this.drag.pointerId) {
      this.endDrag(false);
      return;
    }
    if (e.button === 0 && this.editingId && this.activePointers.size === 1) {
      this.raycaster.setFromCamera(this.eventToNdc(e), this.camera);
      const axis = this.gizmo.pick(this.raycaster);
      if (axis) {
        e.stopImmediatePropagation(); // OrbitControls never sees this pointer
        e.preventDefault();
        this.startDrag(e, axis);
        return;
      }
    }
    this.pointerDown = { x: e.clientX, y: e.clientY, id: e.pointerId, button: e.button };
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (this.drag) {
      if (e.pointerId === this.drag.pointerId) this.updateDrag(e);
      return;
    }
    if (this.editingId && e.pointerType === 'mouse' && e.buttons === 0) {
      this.raycaster.setFromCamera(this.eventToNdc(e), this.camera);
      const axis = this.gizmo.pick(this.raycaster);
      this.gizmo.setHover(axis);
      this.renderer.domElement.style.cursor = axis ? 'pointer' : '';
    }
  };

  private handlePointerUp = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    if (this.drag && e.pointerId === this.drag.pointerId) {
      this.endDrag(true);
      return;
    }
    const start = this.pointerDown;
    this.pointerDown = null;
    // Only a primary-button press that did not move is a click; any drag is a camera gesture.
    if (!start || start.id !== e.pointerId || start.button !== 0 || this.activePointers.size > 0) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_THRESHOLD_PX) return;
    const tol = PICK_TOLERANCE_PX[e.pointerType === 'touch' ? 'touch' : 'mouse'];
    this.handleClickResult(rankPicks(this.pickCandidates(), e.clientX, e.clientY, tol), e.clientX, e.clientY);
  };

  private handlePointerCancel = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    if (this.drag && e.pointerId === this.drag.pointerId) this.endDrag(false);
    if (this.pointerDown?.id === e.pointerId) this.pointerDown = null;
  };

  private handleLostCapture = (e: PointerEvent) => {
    // Capture lost without a pointerup (e.g. element removed, OS gesture): treat as cancel.
    if (this.drag && e.pointerId === this.drag.pointerId) this.endDrag(false);
  };

  // ------------------------------------------------------------- gizmo drag

  private axisLine(drag: GizmoDrag) {
    const origin = new THREE.Vector3(...auToScene(drag.startAu, drag.originAu));
    return { origin, dir: new THREE.Vector3(...PHYSICAL_AXES[drag.axis].scene) };
  }

  private startDrag(e: PointerEvent, axis: Axis) {
    const id = this.editingId!;
    const state = this.simulation.getState(id);
    if (!state) return;
    const drag: GizmoDrag = { pointerId: e.pointerId, axis, bodyId: id, startAu: [...state.position], originAu: [...this.focusAu], s0: 0, before: this.simulation.snapshot() };
    this.raycaster.setFromCamera(this.eventToNdc(e), this.camera);
    const { origin, dir } = this.axisLine(drag);
    const s0 = closestAxisParam(origin, dir, this.raycaster.ray.origin, this.raycaster.ray.direction);
    if (s0 === null) {
      this.options.onEditMessage('That axis points at the camera. Orbit the view to drag along it.');
      return;
    }
    drag.s0 = s0;
    this.drag = drag;
    this.transition = null;
    this.simulation.beginEdit();
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.gizmo.setActive(axis);
    this.options.onEditMessage(null);
  }

  private updateDrag(e: PointerEvent) {
    const drag = this.drag!;
    this.raycaster.setFromCamera(this.eventToNdc(e), this.camera);
    const { origin, dir } = this.axisLine(drag);
    const s = closestAxisParam(origin, dir, this.raycaster.ray.origin, this.raycaster.ray.direction);
    if (s === null) return;
    const deltaAu = sceneDeltaToAu(dir.clone().multiplyScalar(s - drag.s0).toArray() as Vec3);
    const next: Vec3 = [drag.startAu[0] + deltaAu[0], drag.startAu[1] + deltaAu[1], drag.startAu[2] + deltaAu[2]];
    const res = this.simulation.setBodyPosition(drag.bodyId, next);
    this.options.onEditMessage(res.ok ? null : res.message);
  }

  /** commit=false restores the position from before the drag (Escape, cancel, blur). */
  private endDrag(commit: boolean) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (!commit) {
      const res = this.simulation.setBodyPosition(drag.bodyId, drag.startAu);
      this.options.onEditMessage(res.ok ? 'Move cancelled.' : res.message);
    } else {
      const end = this.simulation.getState(drag.bodyId)?.position;
      if (end && end.some((c, i) => c !== drag.startAu[i])) {
        const name = this.simulation.bodies.find((b) => b.id === drag.bodyId)?.name ?? drag.bodyId;
        this.options.onEditCommit(`move ${name} (gizmo)`, drag.before, this.simulation.snapshot());
      }
    }
    this.simulation.endEdit();
    this.gizmo.setActive(null);
    const el = this.renderer.domElement;
    if (el.hasPointerCapture(drag.pointerId)) el.releasePointerCapture(drag.pointerId);
    this.activePointers.delete(drag.pointerId);
    // Ease the frozen origin back onto the followed body instead of jumping.
    const dist = this.camera.position.length();
    const dir = this.camera.position.clone().normalize();
    this.transition = { from: [...drag.originAu], fromDist: dist, toDist: dist, fromDir: dir, toDir: dir.clone(), t: this.reducedMotion ? 1 : 0 };
  }

  // ------------------------------------------------------------- keyboard

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Highest priority: cancel an in-progress drag, even while typing.
      if (this.drag) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.endDrag(false);
        return;
      }
      if (this.editingId && !isTypingTarget(e.target) && !document.querySelector('[aria-modal="true"]')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.options.onEdit(null);
      }
      return;
    }
    if (!NAV_KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target) || document.querySelector('[aria-modal="true"]')) return;
    this.keys.add(e.code);
    if (e.code.startsWith('Arrow') || e.code.startsWith('Key')) e.preventDefault(); // no page scroll
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  /** Losing focus must not leave keys held, pointers captured or a drag half-applied. */
  private handleBlur = () => {
    this.keys.clear();
    this.navVelocity.set(0, 0, 0);
    if (this.drag) this.endDrag(false);
    for (const id of this.activePointers) {
      this.renderer.domElement.dispatchEvent(new PointerEvent('pointercancel', { pointerId: id, bubbles: true }));
    }
    this.activePointers.clear();
    this.pointerDown = null;
  };

  /**
   * WASD moves the focus point across the plane parallel to the ecliptic, in the direction the
   * camera faces; arrow keys orbit. Speed scales with camera distance so both the inner system
   * and the outer planets are navigable. Smoothed with a frame-rate-independent exponential.
   */
  private navigate(dt: number) {
    const k = this.keys;
    const fwdIn = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const rightIn = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const up = new THREE.Vector3(0, 1, 0);
    const target = new THREE.Vector3();
    if (fwdIn || rightIn) {
      const forward = this.camera.getWorldDirection(new THREE.Vector3()).projectOnPlane(up);
      // Looking straight down: use the camera's screen-up as "forward".
      if (forward.lengthSq() < 1e-6) forward.copy(up).applyQuaternion(this.camera.quaternion).projectOnPlane(up);
      forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, up).normalize();
      const fast = k.has('ShiftLeft') || k.has('ShiftRight');
      const speed = this.camera.position.length() * 0.8 * (fast ? 4 : 1); // scene units per second
      target.addScaledVector(forward, fwdIn).addScaledVector(right, rightIn).normalize().multiplyScalar(speed);
    }
    const blend = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 10);
    this.navVelocity.lerp(target, blend);
    // Stop cleanly once the glide has decayed, rather than creeping forever.
    if (target.lengthSq() === 0 && this.navVelocity.length() < this.camera.position.length() * 1e-3) this.navVelocity.set(0, 0, 0);

    if (this.navVelocity.lengthSq() > 0 && !this.drag) {
      if (this.focusId || this.focusGroup) {
        // Detach from the followed body: from here the camera flies freely.
        this.focusId = null;
        this.focusGroup = null;
        this.transition = null;
        this.applyMinDistance();
      }
      const d = sceneDeltaToAu(this.navVelocity.clone().multiplyScalar(dt).toArray() as Vec3);
      this.focusAu = [this.focusAu[0] + d[0], this.focusAu[1] + d[1], this.focusAu[2] + d[2]];
    }

    const yaw = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
    const pitch = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    if (yaw || pitch) {
      const sph = new THREE.Spherical().setFromVector3(this.camera.position);
      sph.theta += yaw * 1.4 * dt;
      sph.phi = THREE.MathUtils.clamp(sph.phi - pitch * 1.0 * dt, 0.05, Math.PI - 0.05);
      this.camera.position.setFromSpherical(sph);
      this.camera.lookAt(0, 0, 0);
    }
  }
}
