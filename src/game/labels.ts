import * as THREE from 'three';

export const LABEL_FONT_STACK =
  '"Nunito", "Baloo 2", "Fredoka", "Varela Round", "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif';

const OUTLINE = '#07051a';

function font(px: number): string {
  return `900 ${px}px ${LABEL_FONT_STACK}`;
}

function makeTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Draw bold white text with a thick dark outline, centered at (cx, cy). */
function drawOutlinedText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, px: number): void {
  ctx.font = font(px);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = px * 0.12;
  ctx.lineWidth = px * 0.24;
  ctx.strokeStyle = OUTLINE;
  ctx.strokeText(text, cx, cy);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, cx, cy);
}

export function makeLabelSprite(tex: THREE.Texture | null): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.renderOrder = 20;
  return s;
}

/**
 * Canvas textures for everything drawn in the (non-bloomed) overlay:
 * asteroid numbers (cached per value), ✓/✗ icons, and equation labels.
 */
export class LabelFactory {
  private numbers = new Map<number, { tex: THREE.CanvasTexture; aspect: number }>();
  private icons = new Map<string, THREE.CanvasTexture>();
  private speedy = new Map<number, { tex: THREE.CanvasTexture; aspect: number }>();

  /** "⚡ Speedy! +80" popup (bolt drawn as a path so it looks the same everywhere). */
  speedyTexture(bonus: number): { tex: THREE.CanvasTexture; aspect: number } {
    let entry = this.speedy.get(bonus);
    if (entry) return entry;
    const H = 128;
    const px = 76;
    const text = bonus > 0 ? `Speedy! +${bonus}` : 'Speedy!';
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = font(px);
    const tw = measure.measureText(text).width;
    const bolt = 70;
    const W = Math.ceil(bolt + tw + px * 0.5);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    // lightning bolt
    const bx = 14;
    const by = 16;
    ctx.beginPath();
    ctx.moveTo(bx + 34, by);
    ctx.lineTo(bx + 6, by + 54);
    ctx.lineTo(bx + 28, by + 54);
    ctx.lineTo(bx + 18, by + 96);
    ctx.lineTo(bx + 52, by + 38);
    ctx.lineTo(bx + 30, by + 38);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 12;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = '#ffd23b';
    ctx.fill();
    drawOutlinedText(ctx, text, bolt + 8 + tw / 2, H / 2 + 4, px);
    entry = { tex: makeTexture(c), aspect: W / H };
    this.speedy.set(bonus, entry);
    return entry;
  }

  /**
   * Number label texture (cached per value). The canvas widens for 2–3 digit
   * numbers so every digit keeps the same glyph height: `aspect` is width/height.
   */
  numberTexture(value: number): { tex: THREE.CanvasTexture; aspect: number } {
    let entry = this.numbers.get(value);
    if (entry) return entry;
    const H = 200;
    const px = 150;
    const text = String(value);
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = font(px);
    const tw = measure.measureText(text).width;
    // power-of-two-ish widths keep mipmaps tidy; 1 digit → 200, 3 digits → ~340
    const W = Math.max(H, Math.ceil(tw + px * 0.42));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    drawOutlinedText(ctx, text, W / 2, H / 2 + px * 0.05, px);
    entry = { tex: makeTexture(c), aspect: W / H };
    this.numbers.set(value, entry);
    return entry;
  }

  iconTexture(kind: 'check' | 'cross'): THREE.CanvasTexture {
    let tex = this.icons.get(kind);
    if (tex) return tex;
    const S = 256;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d')!;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 14;
    if (kind === 'check') {
      // round badge + check mark
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, 96, 0, Math.PI * 2);
      ctx.fillStyle = '#16b95e';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 14;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(80, 132);
      ctx.lineTo(114, 166);
      ctx.lineTo(178, 94);
      ctx.lineWidth = 40;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      ctx.lineWidth = 24;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    } else {
      // rounded-square badge (different silhouette) + X
      const r = 30;
      const x0 = 40;
      const x1 = S - 40;
      ctx.beginPath();
      ctx.moveTo(x0 + r, x0);
      ctx.arcTo(x1, x0, x1, x1, r);
      ctx.arcTo(x1, x1, x0, x1, r);
      ctx.arcTo(x0, x1, x0, x0, r);
      ctx.arcTo(x0, x0, x1, x0, r);
      ctx.closePath();
      ctx.fillStyle = '#e8541f';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 14;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(92, 92);
      ctx.lineTo(164, 164);
      ctx.moveTo(164, 92);
      ctx.lineTo(92, 164);
      ctx.lineWidth = 40;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      ctx.lineWidth = 24;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
    tex = makeTexture(c);
    this.icons.set(kind, tex);
    return tex;
  }

  /**
   * An equation label on a dark pill. Returns the texture and its aspect ratio
   * (width / height). The caller owns (and disposes) the texture.
   */
  equationTexture(text: string, accent: string): { tex: THREE.CanvasTexture; aspect: number } {
    const H = 160;
    const px = 104;
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = font(px);
    const tw = measure.measureText(text).width;
    const W = Math.ceil(tw + px * 1.1);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    const pad = 10;
    const r = (H - pad * 2) / 2;
    ctx.beginPath();
    ctx.moveTo(pad + r, pad);
    ctx.lineTo(W - pad - r, pad);
    ctx.arc(W - pad - r, H / 2, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(pad + r, H - pad);
    ctx.arc(pad + r, H / 2, r, Math.PI / 2, (Math.PI * 3) / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(6, 5, 24, 0.78)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = accent;
    ctx.stroke();
    drawOutlinedText(ctx, text, W / 2, H / 2 + 4, px);
    return { tex: makeTexture(c), aspect: W / H };
  }

  dispose(): void {
    for (const t of this.numbers.values()) t.tex.dispose();
    for (const t of this.icons.values()) t.dispose();
    for (const t of this.speedy.values()) t.tex.dispose();
    this.speedy.clear();
    this.numbers.clear();
    this.icons.clear();
  }
}
