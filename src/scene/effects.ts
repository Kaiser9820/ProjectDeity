import * as THREE from 'three';
import type { Vec3 } from '../types';
import { auToScene } from './presentation';

export type EffectKind = 'explosion' | 'supernova';

const DURATION: Record<EffectKind, number> = { explosion: 2.6, supernova: 4.5 };
const PARTICLES: Record<EffectKind, number> = { explosion: 700, supernova: 1600 };

/**
 * Purely visual explosion: flash, expanding shockwave ring and a particle burst, anchored to a
 * physical position (au) so it stays put under the floating origin. All GPU resources are owned
 * by the effect and released by dispose(). The physical change (fragments, mass loss) has
 * already been made in the simulation; this only shows it.
 */
export class ExplosionEffect {
  readonly root = new THREE.Group();
  private t = 0;
  private readonly duration: number;
  private flash: THREE.Sprite;
  private ring: THREE.Mesh;
  private points: THREE.Points;
  private velocities: Float32Array;
  private disposables: { dispose(): void }[] = [];

  constructor(
    readonly kind: EffectKind,
    private atAu: Vec3,
    /** Base size in scene units (already chosen to be visible from the current camera). */
    private readonly size: number,
    color: string,
    glowTexture: THREE.Texture,
    reducedMotion: boolean,
  ) {
    this.duration = reducedMotion ? 0.8 : DURATION[kind];
    const tint = new THREE.Color(color);
    const hot = new THREE.Color(kind === 'supernova' ? '#e8f0ff' : '#fff1d6');

    const fm = new THREE.SpriteMaterial({ map: glowTexture, color: hot, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    this.flash = new THREE.Sprite(fm);
    this.flash.raycast = () => {};
    this.root.add(this.flash);

    const rg = new THREE.RingGeometry(0.965, 1, 128);
    const rm = new THREE.MeshBasicMaterial({ color: kind === 'supernova' ? '#9fc2ff' : tint.clone().lerp(hot, 0.5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.ring = new THREE.Mesh(rg, rm);
    this.ring.raycast = () => {};
    this.ring.visible = !reducedMotion;
    this.root.add(this.ring);

    const n = reducedMotion ? 0 : PARTICLES[kind];
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const speed = (0.4 + Math.random() ** 2 * 1.6) * (kind === 'supernova' ? 1.6 : 1);
      this.velocities.set([s * Math.cos(th) * speed, u * speed, s * Math.sin(th) * speed], i * 3);
      c.copy(hot).lerp(tint, Math.random());
      col.set([c.r, c.g, c.b], i * 3);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pm = new THREE.PointsMaterial({ size: kind === 'supernova' ? 3 : 2.4, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.points = new THREE.Points(pg, pm);
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
    this.root.add(this.points);

    this.disposables.push(fm, rg, rm, pg, pm);
    this.root.renderOrder = 900;
  }

  /** Debris this effect rides along with (so the blast stays centred on the moving fragments). */
  debrisIds: string[] | null = null;

  /** Advances the effect; returns false once finished. `anchorAu` moves the centre if given. */
  update(dt: number, originAu: Readonly<Vec3>, camera: THREE.Camera, anchorAu?: Vec3 | null): boolean {
    if (anchorAu) this.atAu = anchorAu;
    // Clamp so a long frame (tab switch, slow GPU) cannot skip the whole effect.
    this.t += Math.min(dt, 1 / 20);
    const k = Math.min(1, this.t / this.duration);
    this.root.position.set(...auToScene(this.atAu, originAu));
    const s = this.size;

    // Flash: snaps bright, then fades over the first third.
    const fk = Math.min(1, this.t / (this.duration * 0.35));
    this.flash.scale.setScalar(s * (2.5 + 4 * Math.sqrt(fk)) * (this.kind === 'supernova' ? 2 : 1));
    (this.flash.material as THREE.SpriteMaterial).opacity = (1 - fk) ** 1.5;

    // Shockwave: billboard ring expanding with an ease-out.
    this.ring.quaternion.copy(camera.quaternion);
    this.ring.scale.setScalar(s * (1 + 7 * (1 - (1 - k) ** 3)) * (this.kind === 'supernova' ? 1.8 : 1));
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k) ** 2;

    // Particles: ballistic drift outward with slight drag, fading out.
    const pos = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const travel = s * 5 * (1 - Math.exp(-3 * k));
    for (let i = 0; i < this.velocities.length; i++) arr[i] = this.velocities[i] * travel;
    pos.needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity = (1 - k) ** 0.8;
    return k < 1;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.root.removeFromParent();
  }
}
