/**
 * The sprite atlas: one PNG plus a JSON map of named sprites, produced by scripts/art/post.py from the picked
 * candidates. Loads lazily; until it is here (or for any key it lacks) the renderer keeps drawing its glyphs, so art
 * can land group by group.
 */
export interface SpriteRect { x: number; y: number; w: number; h: number; }

let image: HTMLImageElement | undefined; let rects: Record<string, SpriteRect> = {}; let loading = false; let ready = false;

export function loadAtlas(): void {
  if (loading || ready) return; loading = true;
  fetch('/art/atlas.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j: { sprites: Record<string, SpriteRect>; version?: string }) => {
    rects = j.sprites; const im = new Image(); im.onload = () => { image = im; ready = true; }; im.onerror = () => { loading = false; };
    im.src = `/art/atlas.png${j.version ? `?v=${j.version}` : ''}`;   // the version changes with the pixels, so a repack is never cached
  }).catch(() => { loading = false; /* no atlas yet: glyphs it is */ });
}

export const hasSprite = (key: string): boolean => ready && key in rects;

/** Draw a sprite with its bottom centre at (x, y) and the given height, keeping its aspect, over a soft ground shadow (the key-out takes the painted one). */
export function drawSprite(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, height: number, alpha = 1, shadow = true, flip = false): boolean {
  const r = rects[key]; if (!ready || !image || !r) return false;
  const w = height * (r.w / r.h);
  if (shadow) { ctx.fillStyle = 'rgba(30,20,10,0.18)'; ctx.beginPath(); ctx.ellipse(x + w * 0.06, y - height * 0.02, w * 0.42, Math.max(1.5, height * 0.09), 0, 0, Math.PI * 2); ctx.fill(); }
  if (alpha < 1) ctx.globalAlpha = alpha;
  if (flip) { ctx.save(); ctx.translate(x, 0); ctx.scale(-1, 1); ctx.drawImage(image, r.x, r.y, r.w, r.h, -w / 2, y - height, w, height); ctx.restore(); }
  else ctx.drawImage(image, r.x, r.y, r.w, r.h, x - w / 2, y - height, w, height);
  if (alpha < 1) ctx.globalAlpha = 1;
  return true;
}

/**
 * Draw a sprite stretched to fill a rectangle: ground textures and plots, which tile edge to edge. The source is
 * inset by half a pixel because bilinear sampling at the very edge pulls in the transparent gutter between atlas
 * entries, which shows up as pale seams along every tile boundary.
 */
export function drawSpriteRect(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, w: number, h: number): boolean {
  const r = rects[key]; if (!ready || !image || !r) return false;
  ctx.drawImage(image, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, x, y, w, h);
  return true;
}
