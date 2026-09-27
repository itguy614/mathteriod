import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MAX_DPR, WORLD_SPAN } from './constants';

const BLOOM_STRENGTH = 0.95;

/**
 * Renderer, scenes, camera and post-processing.
 *
 * `scene` is rendered through bloom. `overlay` (number labels, equation label,
 * ✓/✗ icons) is drawn afterwards straight to the canvas, so text never blooms
 * or blurs: readability first.
 */
export class Graphics {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly overlay = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly canvas: HTMLCanvasElement;

  halfW = WORLD_SPAN / 2;
  halfH = WORLD_SPAN / 4;
  /** CSS pixels per world unit. */
  pxPerUnit = 10;
  dpr = 1;

  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private envTex: THREE.Texture;
  private shakeAmt = 0;
  private shakeTime = 0;
  private bloomPulse = 0;
  private resizeCbs: Array<() => void> = [];

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x03040b, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'mt-canvas';
    container.appendChild(this.canvas);

    this.camera = new THREE.OrthographicCamera(-50, 50, 25, -25, 1, 600);
    this.camera.position.set(0, 0, 250);
    this.camera.lookAt(0, 0, 0);

    // Lighting: key light from the upper-left, cool rim from lower-right,
    // soft environment for the metallic hulls.
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-40, 60, 90);
    const rim = new THREE.DirectionalLight(0x7f8cff, 1.1);
    rim.position.set(60, -50, 30);
    const amb = new THREE.HemisphereLight(0x8090c0, 0x100818, 0.35);
    this.scene.add(key, rim, amb);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.45;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM_STRENGTH, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
  }

  onResize(cb: () => void): void {
    this.resizeCbs.push(cb);
  }

  resize(w: number, h: number): void {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(w, h);

    const aspect = w / h;
    const worldW = aspect >= 1 ? WORLD_SPAN : WORLD_SPAN * aspect;
    const worldH = worldW / aspect;
    this.halfW = worldW / 2;
    this.halfH = worldH / 2;
    this.pxPerUnit = w / worldW;
    this.camera.left = -this.halfW;
    this.camera.right = this.halfW;
    this.camera.top = this.halfH;
    this.camera.bottom = -this.halfH;
    this.camera.updateProjectionMatrix();
    for (const cb of this.resizeCbs) cb();
  }

  /** World-unit height for a label: `worldH`, but never smaller than `minPx` on screen. */
  labelSize(worldH: number, minPx: number): number {
    return Math.max(worldH, minPx / this.pxPerUnit);
  }

  shake(amount: number, duration = 0.35): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  pulseBloom(amount: number): void {
    this.bloomPulse = Math.max(this.bloomPulse, amount);
  }

  render(dt: number): void {
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const k = Math.max(0, this.shakeTime) * 3;
      const a = this.shakeAmt * Math.min(1, k);
      this.camera.position.x = (Math.random() * 2 - 1) * a;
      this.camera.position.y = (Math.random() * 2 - 1) * a;
      if (this.shakeTime <= 0) {
        this.shakeAmt = 0;
        this.camera.position.x = 0;
        this.camera.position.y = 0;
      }
    }
    this.bloomPulse = Math.max(0, this.bloomPulse - dt * 2.5);
    this.bloom.strength = BLOOM_STRENGTH + this.bloomPulse;

    this.renderer.autoClear = true;
    this.composer.render(dt);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.overlay, this.camera);
  }

  dispose(): void {
    this.composer.dispose();
    this.bloom.dispose();
    this.envTex.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

/** Wrap a coordinate onto the torus [-half-margin, half+margin]. */
export function wrapCoord(v: number, half: number, margin: number): number {
  const h = half + margin;
  if (v > h) return v - 2 * h;
  if (v < -h) return v + 2 * h;
  return v;
}

/** Recursively dispose geometries and materials under an object. */
export function disposeObject(obj: THREE.Object3D, disposeMaterials = true): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (disposeMaterials && m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.dispose();
    }
  });
}
