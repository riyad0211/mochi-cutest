// main.ts — "Mochi" — renders one 1024x1024 PNG to /output/entry.png.
// Node 22, standard library only. Deterministic: both runs write identical bytes.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
const W = 1024, H = 1024;
const buf = new Uint8Array(W * H * 3);

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number[], b: number[], t: number) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// ---------- palette ----------
const BG_TOP = [255, 236, 244];
const BG_BOT = [255, 206, 224];
const FUR = [255, 252, 248];
const FUR_SHADE = [249, 229, 214];
const OUTLINE = [86, 58, 62];
const EYE = [34, 28, 40];
const BLUSH = [255, 143, 160];
const EAR_IN = [255, 176, 186];
const NOSE = [255, 124, 142];
const BOW = [255, 108, 132];
const BOW_DARK = [214, 68, 96];

// ---------- shapes (pixel-exact SDF helpers) ----------
// ellipse coverage with a hard-ish edge (1.2 px antialias)
function ell(x: number, y: number, cx: number, cy: number, rx: number, ry: number, aa = 1.2): number {
  const dx = (x - cx) / rx, dy = (y - cy) / ry;
  const d = Math.sqrt(dx * dx + dy * dy);
  // approximate pixel distance = (1 - d) * min(r)
  return clamp01(((1 - d) * Math.min(rx, ry)) / aa + 0.5);
}
// stroke of an ellipse outline, `t` px thick, centred on the ellipse boundary
function ellStroke(x: number, y: number, cx: number, cy: number, rx: number, ry: number, t: number, aa = 1.2): number {
  const dx = (x - cx) / rx, dy = (y - cy) / ry;
  const d = Math.sqrt(dx * dx + dy * dy);
  const distPx = Math.abs(d - 1) * Math.min(rx, ry);
  return clamp01((t / 2 - distPx) / aa + 0.5);
}
function circ(x: number, y: number, cx: number, cy: number, r: number, aa = 1.2): number {
  const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  return clamp01((r - d) / aa + 0.5);
}
function rot(x: number, y: number, cx: number, cy: number, a: number): [number, number] {
  const dx = x - cx, dy = y - cy, c = Math.cos(a), s = Math.sin(a);
  return [dx * c + dy * s, -dx * s + dy * c];
}
// a thick arc (for the tail and the mouth)
function arc(x: number, y: number, cx: number, cy: number, r: number, t: number, from: number, to: number): number {
  const dx = x - cx, dy = y - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  let ang = Math.atan2(dy, dx);
  if (ang < from) ang += Math.PI * 2;
  if (ang > to) {
    // outside the sweep: still allow the caps
    const dc = Math.min(Math.abs(dx - r * Math.cos(from)), Math.abs(dx - r * Math.cos(to)));
    const dr = Math.abs(d - r);
    const near = Math.max(clamp01((t / 2 - dr) / 1.2 + 0.5), 0);
    return near * 0;
  }
  return clamp01((t / 2 - Math.abs(d - r)) / 1.2 + 0.5);
}

// ---------- composition ----------
const HEAD = { x: 512, y: 452, rx: 292, ry: 258 };
const BODY = { x: 512, y: 782, rx: 236, ry: 178 };
const EARS = [
  { x: 306, y: 232, r: 104, a: -0.42 },
  { x: 718, y: 232, r: 104, a: 0.42 },
];
const EYES = [
  { x: 404, y: 452, r: 58 },
  { x: 620, y: 452, r: 58 },
];
const PAWS = [
  { x: 342, y: 900, rx: 74, ry: 46 },
  { x: 512, y: 926, rx: 78, ry: 46 },
  { x: 682, y: 900, rx: 74, ry: 46 },
];
const TAIL = { cx: 800, cy: 768, r: 88, t: 56 };

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    // ---- background: soft pink gradient + tiny stars ----
    let c = mix(BG_TOP, BG_BOT, y / H);
    const h = Math.sin(x * 0.043) * Math.sin(y * 0.037);
    c = mix(c, [255, 255, 255], clamp01(h - 0.55) * 0.35);

    // ---- tail: a thick curl behind the body, on the right ----
    const tailArc = arc(x, y, TAIL.cx, TAIL.cy, TAIL.r, TAIL.t, -1.15, 1.9);
    const tailFill = Math.max(tailArc, ell(x, y, TAIL.cx + 70, TAIL.cy - 84, 44, 44));
    if (tailFill > 0) {
      let tc = FUR;
      tc = mix(tc, FUR_SHADE, 0.35);
      // tip: a warm cream knob
      const tip = ell(x, y, TAIL.cx + 70, TAIL.cy - 84, 44, 44);
      tc = mix(tc, FUR_SHADE, tip * 0.5);
      const dArc = Math.abs(Math.abs(Math.hypot(x - TAIL.cx, y - TAIL.cy) - TAIL.r) - TAIL.t / 2);
      const tipA = ell(x, y, TAIL.cx + 70, TAIL.cy - 84, 44, 44);
      // arc outline only where outside the tip circle
      const outline = clamp01((2.0 - dArc) / 1.2) * (1 - tipA);
      const tipOutline = ellStroke(x, y, TAIL.cx + 70, TAIL.cy - 84, 44, 44, 3.2) * (1 - clamp01((TAIL.t / 2 + 2 - Math.abs(Math.hypot(x - TAIL.cx, y - TAIL.cy) - TAIL.r)) / 2));
      tc = mix(tc, OUTLINE, Math.max(outline, tipOutline) * 0.9);
      c = mix(c, tc, tailFill);
    }

    // ---- ears (behind the head) ----
    for (const e of EARS) {
      const [lx, ly] = rot(x, y, e.x, e.y, e.a);
      const d = Math.sqrt((lx / e.r) ** 2 + (ly / e.r) ** 2);
      const a = clamp01(((1 - d) * e.r) / 1.2 + 0.5);
      if (a > 0) {
        const innerD = Math.sqrt((lx / (e.r * 0.62)) ** 2 + (ly / (e.r * 0.62)) ** 2);
        let ec = mix(FUR, EAR_IN, clamp01(1.15 - innerD) * 0.9);
        ec = mix(ec, OUTLINE, ellStroke(x, y, e.x, e.y, e.r, e.r, 3.4, 1.2) * 0.95);
        c = mix(c, ec, a);
      }
    }

    // ---- body ----
    const bA = ell(x, y, BODY.x, BODY.y, BODY.rx, BODY.ry);
    if (bA > 0) {
      let bc = FUR;
      // belly highlight
      bc = mix(bc, FUR_SHADE, (1 - ell(x, y, BODY.x, BODY.y + 30, BODY.rx * 0.66, BODY.ry * 0.78)) * 0.55);
      bc = mix(bc, OUTLINE, ellStroke(x, y, BODY.x, BODY.y, BODY.rx, BODY.ry, 3.4) * 0.95);
      c = mix(c, bc, bA);
    }

    // ---- head ----
    const hA = ell(x, y, HEAD.x, HEAD.y, HEAD.rx, HEAD.ry);
    if (hA > 0) {
      let hc = FUR;
      // soft shading on the lower half of the face
      hc = mix(hc, FUR_SHADE, (1 - ell(x, y, HEAD.x, HEAD.y + 120, HEAD.rx * 0.9, HEAD.ry * 0.75)) * 0.4);

      // blur helpers for eyes / blush
      for (const e of EYES) {
        const d = Math.sqrt((x - e.x) ** 2 + (y - e.y) ** 2);
        const a = clamp01((e.r - d) / 1.3 + 0.5);
        if (a > 0) {
          // iris with a lighter lower part
          const lit = clamp01((y - (e.y - e.r * 0.2)) / (e.r * 1.6));
          let ec = mix(EYE, [92, 76, 108], lit * 0.55);
          // highlights
          const h1 = Math.sqrt((x - (e.x - 19)) ** 2 + (y - (e.y - 20)) ** 2);
          ec = mix([255, 255, 255], ec, clamp01((h1 - 2) / 12));
          const h2 = Math.sqrt((x - (e.x + 16)) ** 2 + (y - (e.y + 18)) ** 2);
          ec = mix([255, 255, 255], ec, clamp01((h2 - 1) / 7));
          // outline
          ec = mix(ec, OUTLINE, clamp01((d - (e.r - 4)) / 3) * 0.95);
          hc = mix(hc, ec, a);
        }
      }

      // blush
      for (const bx of [306, 718]) {
        const a = ell(x, y, bx, 528, 62, 34, 14);
        if (a > 0) hc = mix(hc, BLUSH, a * 0.5);
      }

      // nose
      const nA = ell(x, y, 512, 500, 17, 12, 1.2);
      if (nA > 0) hc = mix(hc, NOSE, nA);

      // mouth: two small arcs under the nose
      for (const m of [-1, 1]) {
        const mcx = 512 + m * 26, mcy = 516;
        const d = Math.sqrt((x - mcx) ** 2 + (y - mcy) ** 2);
        if (y > mcy - 2) {
          const a = clamp01((2.6 - Math.abs(d - 22)) / 1.6);
          if (a > 0) hc = mix(hc, OUTLINE, a * 0.9);
        }
      }

      // whiskers: short, soft, low contrast
      for (const side of [-1, 1]) {
        for (const wy of [-12, 8]) {
          const x0 = 512 + side * 76, y0 = 508 + wy;
          const x1 = x0 + side * 74, y1 = y0 + wy * 1.6;
          const vx = x1 - x0, vy = y1 - y0;
          const t = clamp01(((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy));
          const d = Math.hypot(x - (x0 + vx * t), y - (y0 + vy * t));
          const a = clamp01((1.4 - d) / 1.4) * Math.min(1, t * 3) * Math.min(1, (1 - t) * 3);
          if (a > 0) hc = mix(hc, OUTLINE, a * 0.28);
        }
      }

      // head outline
      hc = mix(hc, OUTLINE, ellStroke(x, y, HEAD.x, HEAD.y, HEAD.rx, HEAD.ry, 3.6) * 0.95);
      c = mix(c, hc, hA);
    }

    // ---- paws (front, on top of the body) ----
    for (const p of PAWS) {
      const a = ell(x, y, p.x, p.y, p.rx, p.ry);
      if (a > 0) {
        let pc = FUR;
        pc = mix(pc, OUTLINE, ellStroke(x, y, p.x, p.y, p.rx, p.ry, 3.2) * 0.95);
        // toe creases: clearly visible short lines
        for (const dx of [-22, 22]) {
          const ta = ell(x, y, p.x + dx, p.y - p.ry * 0.72, 2.4, 15, 1.2);
          if (ta > 0) pc = mix(pc, OUTLINE, ta * 0.55);
        }
        c = mix(c, pc, a);
      }
    }

    // ---- bow on the left ear (charm) ----
    {
      const bx = 356, by = 214;
      for (const s of [-1, 1]) {
        const a = ell(x, y, bx + s * 46, by - 8 * s, 44, 30, 1.2);
        if (a > 0) {
          let bc = mix(BOW, BOW_DARK, clamp01((y - by + 20) / 46) * 0.55);
          bc = mix(bc, OUTLINE, ellStroke(x, y, bx + s * 46, by - 8 * s, 44, 30, 3.0) * 0.9);
          c = mix(c, bc, a);
        }
      }
      const knot = ell(x, y, bx, by, 17, 17, 1.2);
      if (knot > 0) {
        let kc = mix(BOW, BOW_DARK, 0.35);
        kc = mix(kc, OUTLINE, ellStroke(x, y, bx, by, 17, 17, 3.0) * 0.9);
        c = mix(c, kc, knot);
      }
    }

    const i = (y * W + x) * 3;
    buf[i] = c[0] | 0;
    buf[i + 1] = c[1] | 0;
    buf[i + 2] = c[2] | 0;
  }
}

// ---------- PNG ----------
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let cc = n;
  for (let k = 0; k < 8; k++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1;
  crcTable[n] = cc >>> 0;
}
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  Buffer.from(buf.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", new Uint8Array(0)),
]);
mkdirSync(OUT, { recursive: true });
const outPath = join(OUT, "entry.png");
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes, ${W}x${H})`);
