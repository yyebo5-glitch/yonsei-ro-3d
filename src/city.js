import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const facadeUniforms = { uNight: { value: 0 } };

export function createHeightField(info, extent, data) {
  const { w, h, dx } = info;
  return (x, z) => {
    let fx = (x - extent.minX) / dx;
    let fz = (z - extent.minZ) / dx;
    fx = Math.min(w - 1.001, Math.max(0, fx));
    fz = Math.min(h - 1.001, Math.max(0, fz));
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * w + i;
    return (data[k] * (1 - tx) + data[k + 1] * tx) * (1 - tz) + (data[k + w] * (1 - tx) + data[k + w + 1] * tx) * tz;
  };
}

const hashInt = (n) => {
  let s = Math.floor(n % 4294967291) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
const color = (hex) => new THREE.Color(hex);

class Buffer3 {
  constructor(extra = {}) {
    this.p = []; this.n = []; this.c = []; this.uv = [];
    this.extra = Object.fromEntries(Object.entries(extra).map(([k, size]) => [k, { size, v: [] }]));
  }
  vertex(x, y, z, nx, ny, nz, c, extra) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(c.r, c.g, c.b);
    if (extra) for (const k in extra) this.extra[k].v.push(...extra[k]);
  }
  /** Quad from corners in counter-clockwise order seen from the front. */
  quad(a, b, c, d, normal, col, uv) {
    const put = (v, i) => {
      this.p.push(v[0], v[1], v[2]); this.n.push(...normal); this.c.push(col.r, col.g, col.b);
      if (uv) this.uv.push(...uv[i]);
    };
    [[a, 0], [b, 1], [c, 2], [a, 0], [c, 2], [d, 3]].forEach(([v, i]) => put(v, i));
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    for (const k in this.extra) g.setAttribute(k, new THREE.Float32BufferAttribute(this.extra[k].v, this.extra[k].size));
    return g;
  }
}

// ------------------------------------------------------------------ terrain
function groundTexture(world, renderer) {
  const { extent } = world;
  const W = extent.maxX - extent.minX;
  const H = extent.maxZ - extent.minZ;
  const scale = Math.min(4096 / H, 4096 / W);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const g = canvas.getContext('2d');
  g.fillStyle = '#8d8a83';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const rnd = hashInt(77);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? '255,250,240' : '40,40,45'},${0.02 + rnd() * 0.04})`;
    const s = 6 + rnd() * 34;
    g.fillRect(rnd() * canvas.width, rnd() * canvas.height, s, s);
  }
  const fills = { forest: '#46603a', grass: '#70874f', park: '#68824b', pitch: '#7a6f5a', water: '#3f6b80' };
  const order = ['grass', 'park', 'forest', 'pitch', 'water'];
  for (const kind of order) {
    g.fillStyle = fills[kind];
    for (const a of world.green) {
      if (a.k !== kind) continue;
      g.beginPath();
      a.r.forEach(([x, z], i) => {
        const px = (x - extent.minX) * scale;
        const py = (z - extent.minZ) * scale;
        if (i) g.lineTo(px, py); else g.moveTo(px, py);
      });
      g.closePath();
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function buildTerrain(world, heights, renderer) {
  const { w, h, dx } = world.terrain;
  const { extent } = world;
  const pos = new Float32Array(w * h * 3);
  const uv = new Float32Array(w * h * 2);
  const W = extent.maxX - extent.minX;
  const H = extent.maxZ - extent.minZ;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const x = extent.minX + i * dx;
      const z = extent.minZ + j * dx;
      pos[k * 3] = x; pos[k * 3 + 1] = heights(x, z); pos[k * 3 + 2] = z;
      uv[k * 2] = (x - extent.minX) / W;
      uv[k * 2 + 1] = 1 - (z - extent.minZ) / H;
    }
  }
  const index = new Uint32Array((w - 1) * (h - 1) * 6);
  let n = 0;
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = j * w + i;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      index[n++] = a; index[n++] = c; index[n++] = b;
      index[n++] = b; index[n++] = c; index[n++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: groundTexture(world, renderer), roughness: 1 }));
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ roads
const ROAD_Y = { sidewalk: 0.16, road: 0.24, mark: 0.3 };
const COL = {
  asphalt: color('#3b3d41'), path: color('#a9a397'), sidewalk: color('#a8a39a'), brick: color('#9b9992'),
  white: color('#e8e8e2'), yellow: color('#e2b53a'), rail: color('#6b6660'), steel: color('#30302f'), deck: color('#8a8983'),
};

class Polyline {
  constructor(points) {
    this.points = points;
    this.s = [0];
    for (let i = 1; i < points.length; i++) {
      this.s.push(this.s[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    this.length = this.s.at(-1);
  }
  /** Position and unit tangent at arc length s. */
  at(s) {
    let i = 1;
    while (i < this.s.length - 1 && this.s[i] < s) i++;
    const [ax, az] = this.points[i - 1];
    const [bx, bz] = this.points[i];
    const len = this.s[i] - this.s[i - 1] || 1;
    const t = (s - this.s[i - 1]) / len;
    return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, tx: (bx - ax) / len, tz: (bz - az) / len };
  }
}

function bridgeLift(way, line) {
  if (!way.bh) return () => 0;
  const ramp = Math.min(40, line.length / 2);
  const ease = (d) => { const t = Math.min(1, d / ramp); return t * t * (3 - 2 * t); };
  return (s) => way.bh * (way.rs ? ease(s) : 1) * (way.re ? ease(line.length - s) : 1);
}

function ribbon(buf, way, line, width, y, col, lift, heights) {
  const steps = Math.max(1, Math.ceil(line.length / 5));
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const s = (line.length * i) / steps;
    const a = line.at(Math.max(0, s - 0.6));
    const b = line.at(Math.min(line.length, s + 0.6));
    const c = line.at(s);
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len; tz /= len;
    const nx = -tz;
    const nz = tx;
    const hw = width / 2;
    const L = [c.x + nx * hw, 0, c.z + nz * hw];
    const R = [c.x - nx * hw, 0, c.z - nz * hw];
    const l = lift(s);
    if (l > 0.01) {
      const base = heights(c.x, c.z) + l + y;
      L[1] = base; R[1] = base;
    } else {
      L[1] = heights(L[0], L[2]) + y;
      R[1] = heights(R[0], R[2]) + y;
    }
    if (prev) {
      buf.quad(prev.R, prev.L, L, R, [0, 1, 0], col);
      if (way.bh && l > 1 && y >= ROAD_Y.road - 0.01) {
        const drop = (v) => [v[0], v[1] - 1.3, v[2]];
        const sideL = [nx, 0, nz];
        const sideR = [-nx, 0, -nz];
        buf.quad(drop(L), L, prev.L, drop(prev.L), sideL, COL.deck);
        buf.quad(drop(prev.R), prev.R, R, drop(R), sideR, COL.deck);
        buf.quad(drop(prev.L), drop(L), drop(R), drop(prev.R), [0, -1, 0], COL.deck);
      }
    }
    prev = { L, R };
  }
}

function addBox(buf, cx, y0, cz, sx, h, sz, col, ex) {
  const x0 = cx - sx / 2; const x1 = cx + sx / 2;
  const z0 = cz - sz / 2; const z1 = cz + sz / 2;
  const y1 = y0 + h;
  const faces = [
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]],
    [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]],
    [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [0, 0, 1]],
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1]],
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]],
  ];
  for (const [a, b, c, d, n] of faces) {
    if (ex) {
      for (const v of [a, b, c, a, c, d]) buf.vertex(v[0], v[1], v[2], n[0], n[1], n[2], col, ex);
    } else {
      buf.quad(a, b, c, d, n, col);
    }
  }
}

function addPiers(buf, way, line, lift, heights) {
  for (let s = 12; s < line.length - 6; s += 26) {
    const l = lift(s);
    if (l < 3) continue;
    const c = line.at(s);
    const g = heights(c.x, c.z);
    addBox(buf, c.x, g - 0.5, c.z, Math.min(3, way.w * 0.25), l - 0.3, 1.6, COL.deck);
  }
}

function addMarkings(buf, way, line, heights, lift) {
  if (way.w < 6 || ['pedestrian', 'service'].includes(way.k)) return;
  const lanes = way.l ?? Math.max(2, Math.round(way.w / 3.3));
  const clear = (s) => way.j.every((j) => Math.abs(j - s) > way.w * 0.75 + 5) && s > 3 && s < line.length - 3;
  const piece = (s0, s1, off, width, col) => {
    const a = line.at(s0);
    const b = line.at(s1);
    const nx = -a.tz; const nz = a.tx;
    const hw = width / 2;
    const yA = heights(a.x + nx * off, a.z + nz * off) + lift(s0) + ROAD_Y.mark;
    const yB = heights(b.x + nx * off, b.z + nz * off) + lift(s1) + ROAD_Y.mark;
    const p = (q, side, y) => [q.x + nx * (off + side * hw), y, q.z + nz * (off + side * hw)];
    buf.quad(p(a, -1, yA), p(a, 1, yA), p(b, 1, yB), p(b, -1, yB), [0, 1, 0], col);
  };
  const dashed = (off) => {
    for (let s = 0; s + 3 < line.length; s += 7.5) if (clear(s) && clear(s + 3)) piece(s, s + 3, off, 0.15, COL.white);
  };
  const solid = (off, col) => {
    for (let s = 0; s + 4 <= line.length; s += 4) if (clear(s) && clear(s + 4)) piece(s, s + 4, off, 0.15, col);
  };
  const laneW = way.w / lanes;
  if (way.yr) {
    // Tactile paving strips along both Yonsei-ro sidewalks.
    for (const side of [-1, 1]) {
      const off = side * (way.w / 2 + 1.1);
      for (let s = 0; s + 4 <= line.length; s += 4) piece(s, s + 4, off, 0.42, COL.yellow);
    }
  }
  if (way.o) {
    for (let i = 1; i < lanes; i++) dashed(-way.w / 2 + laneW * i);
  } else {
    solid(0.16, COL.yellow);
    solid(-0.16, COL.yellow);
    const perSide = Math.floor(lanes / 2);
    for (let i = 1; i < perSide; i++) { dashed(laneW * i); dashed(-laneW * i); }
  }
}

function addCrossing(buf, pts, heights) {
  const line = new Polyline(pts);
  if (line.length > 45 || line.length < 2) return;
  for (let s = 0.4; s < line.length - 0.3; s += 1.05) {
    const a = line.at(s);
    const nx = -a.tz; const nz = a.tx;
    const y = heights(a.x, a.z) + ROAD_Y.mark;
    const corner = (along, side) => [a.x + a.tx * along + nx * side, y, a.z + a.tz * along + nz * side];
    buf.quad(corner(0, -1.9), corner(0, 1.9), corner(0.5, 1.9), corner(0.5, -1.9), [0, 1, 0], COL.white);
  }
}

function buildRoads(world, heights) {
  const buf = new Buffer3();
  const marks = new Buffer3();
  const foot = new Set(['footway', 'path', 'steps', 'cycleway']);
  // Draw wide roads last so they stay on top of the small ones at equal height.
  const sorted = [...world.roads].sort((a, b) => a.w - b.w);
  for (const way of sorted) {
    const line = new Polyline(way.p);
    if (line.length < 0.5) continue;
    const lift = bridgeLift(way, line);
    if (way.sw > 0 && !way.bh) {
      ribbon(buf, way, line, way.w + way.sw * 2, ROAD_Y.sidewalk, way.yr ? COL.brick : COL.sidewalk, lift, heights);
    }
    const isFoot = foot.has(way.k);
    ribbon(buf, way, line, way.w, isFoot ? ROAD_Y.sidewalk - 0.04 : ROAD_Y.road, isFoot || way.k === 'pedestrian' ? COL.path : COL.asphalt, lift, heights);
    if (way.bh) addPiers(buf, way, line, lift, heights);
    if (way.c && !isFoot) addMarkings(marks, way, line, heights, lift);
  }
  for (const pts of world.crossings) addCrossing(marks, pts, heights);
  for (const rail of world.rails) {
    const line = new Polyline(rail.p);
    const lift = bridgeLift(rail, line);
    const way = { ...rail, w: 7 };
    ribbon(buf, way, line, 5, ROAD_Y.road, COL.rail, lift, heights);
    if (rail.bh) addPiers(buf, way, line, lift, heights);
    for (const off of [-0.72, 0.72]) {
      const shifted = rail.p.map((p, i) => {
        const a = rail.p[Math.max(0, i - 1)];
        const b = rail.p[Math.min(rail.p.length - 1, i + 1)];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [p[0] - ((b[1] - a[1]) / len) * off, p[1] + ((b[0] - a[0]) / len) * off];
      });
      const shiftedLine = new Polyline(shifted);
      ribbon(marks, { ...rail, bh: rail.bh ? rail.bh : 0 }, shiftedLine, 0.14, ROAD_Y.mark, COL.steel, bridgeLift(rail, shiftedLine), heights);
    }
  }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, side: THREE.DoubleSide });
  const group = new THREE.Group();
  group.name = 'roads';
  for (const b of [buf, marks]) {
    const mesh = new THREE.Mesh(b.toGeometry(), material);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// ------------------------------------------------------------------ buildings
const PALETTE = {
  commercial: ['#c9c3b6', '#b7b3ac', '#d5cfc2', '#a9a6a1', '#9c8f83', '#c7b8a3', '#8e9196', '#d9d6cf'],
  apartments: ['#e0ddd4', '#d5d2c8', '#e8e4d8', '#cfc8b8'],
  university: ['#8d5a48', '#7f5244', '#a06a52', '#b8b2a6', '#c2bcaf'],
  house: ['#b98a6b', '#c9b49a', '#a97c62', '#d2c8b8'],
};
const ROOFS = ['#7fa78c', '#6f9a7e', '#8a8a86', '#9a9892', '#74746f', '#a7a39b'];

const WINDOW_STYLE = { punched: 1, curtain: 2, campus: 3, slab: 4, brick: 5, hospital: 6, school: 7, blueglass: 8, plainbrick: 9 };
const inStrip = (x, z) => Math.abs(x - 8) < 62 && z > -30 && z < 590;
const isBrickColour = (hex) => hex === '#8d5a48' || hex === '#7f5244' || hex === '#a06a52';

function patchFacade(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = facadeUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aFacade; attribute float aSeed;
        varying vec4 vFacade; flat varying float vSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFacade = aFacade; vSeed = aSeed;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; varying vec4 vFacade; flat varying float vSeed;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float rectMask(vec2 f, vec2 m, vec2 aa){
          vec2 a = smoothstep(m - aa, m + aa, f) * (1.0 - smoothstep(1.0 - m - aa, 1.0 - m + aa, f));
          return a.x * a.y;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float win = 0.0; float lit = 0.0; float shopGlow = 0.0;
        if (vFacade.w > 0.5) {
          vec2 q = vFacade.xy;
          vec2 id = floor(q);
          vec2 f = fract(q);
          vec2 dd = fwidth(q);
          float detail = 1.0 - smoothstep(0.24, 0.62, max(dd.x, dd.y));
          vec2 aa = clamp(dd * 0.9, 0.003, 0.2);
          float style = floor(vFacade.w + 0.5);
          if (style == 5.0 || style == 9.0) {
            // Running-bond brick: about 14 bricks per bay and 50 courses per floor.
            vec2 bs = vec2(14.0, 50.0);
            vec2 bq = q * bs;
            float row = floor(bq.y);
            bq.x += 0.5 * mod(row, 2.0);
            vec2 bid = floor(bq);
            float brickDetail = 1.0 - smoothstep(0.2, 0.55, max(dd.x * bs.x, dd.y * bs.y));
            float mortar = rectMask(fract(bq), vec2(0.05, 0.1), clamp(dd * bs, 0.01, 0.3));
            vec3 brick = diffuseColor.rgb * (0.78 + 0.42 * h21(bid + vec2(vSeed * 11.0, 3.0)));
            diffuseColor.rgb = mix(diffuseColor.rgb * 0.97, mix(vec3(0.5, 0.47, 0.43), brick, mortar), brickDetail);
          }
          vec2 m = vec2(0.17, 0.25);
          if (style == 4.0) m = vec2(0.05, 0.3);
          else if (style == 3.0 || style == 5.0) m = vec2(0.28, 0.17);
          else if (style == 2.0 || style == 8.0) m = vec2(0.035, 0.05);
          else if (style == 6.0) m = vec2(0.02, 0.3);
          else if (style == 7.0) m = vec2(0.12, 0.27);
          float shop = step(0.5, vFacade.z) * (1.0 - step(1.0, q.y));
          if (shop > 0.5) m = vec2(0.04, 0.0);
          float mask = id.y >= 0.0 ? rectMask(f, m, aa) : 0.0;
          if (style == 9.0) mask = 0.0;
          if (style == 6.0 && mod(id.x, 4.0) < 0.5) mask = 0.0;
          if (style == 7.0 && f.y < 0.1) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.26, 0.2), detail);
          if (shop > 0.5) mask *= 1.0 - smoothstep(0.7 - aa.y, 0.7 + aa.y, f.y);
          float r = h21(id + vec2(vSeed * 91.0, vSeed * 37.0));
          vec3 glass = mix(vec3(0.07, 0.1, 0.14), vec3(0.16, 0.22, 0.27), r);
          if (style == 6.0) glass = mix(vec3(0.16, 0.3, 0.33), vec3(0.24, 0.4, 0.42), r);
          if (style == 8.0) glass = mix(diffuseColor.rgb * 0.8, diffuseColor.rgb * 1.2, mod(id.x + floor(id.y / 3.0), 2.0) * 0.6 + 0.4 * r);
          if (shop > 0.5) { glass = vec3(0.3, 0.33, 0.34); shopGlow = mask; }
          float coverage = style == 9.0 ? 0.0 : (1.0 - 2.0 * m.x) * (1.0 - 2.0 * m.y);
          diffuseColor.rgb = mix(diffuseColor.rgb * mix(1.0, 0.62, coverage), mix(diffuseColor.rgb, glass, mask), detail);
          diffuseColor.rgb *= 0.93 + 0.1 * h21(vec2(id.y, vSeed));
          win = mask * detail;
          float r2 = h21(id.yx + vec2(vSeed * 53.0, 7.0));
          lit = step(0.68, r) * (0.18 + 0.5 * r2 * r2) * mix(coverage * 0.9, mask, detail);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.1, win);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.55, win);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uNight * (lit * vec3(1.0, 0.78, 0.5) + shopGlow * vec3(0.62, 0.5, 0.36));`);
  };
  material.customProgramCacheKey = () => 'facade-v3';
  return material;
}

function roadIndex(world) {
  const cells = new Map();
  for (const way of world.roads) {
    if (way.w < 3.5 || way.bh || ['footway', 'path', 'steps', 'cycleway'].includes(way.k)) continue;
    const line = new Polyline(way.p);
    for (let s = 0; s <= line.length; s += 6) {
      const { x, z } = line.at(s);
      const key = `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push([x, z, way.w / 2 + way.sw]);
    }
  }
  return (x, z, margin) => {
    const ci = Math.floor(x / 16);
    const cj = Math.floor(z / 16);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (const [px, pz, half] of cells.get(`${i},${j}`) ?? []) {
          if (Math.hypot(px - x, pz - z) < half + margin) return true;
        }
      }
    }
    return false;
  };
}

function signAtlas(words, cols, rows, cw, ch, vertical) {
  const canvas = document.createElement('canvas');
  canvas.width = cols * cw;
  canvas.height = rows * ch;
  const g = canvas.getContext('2d');
  const looks = [['#c8232c', '#fff'], ['#f4c21f', '#222'], ['#1457a8', '#fff'], ['#0f8a5f', '#fff'], ['#f7f4ea', '#c8232c'],
    ['#242428', '#ffd24a'], ['#e8611a', '#fff'], ['#7a2fa0', '#fff'], ['#ffffff', '#1457a8'], ['#0f9fb3', '#fff']];
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  words.forEach((word, i) => {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    const [bg, fg] = looks[i % looks.length];
    g.fillStyle = bg;
    g.fillRect(x + 2, y + 2, cw - 4, ch - 4);
    g.fillStyle = fg;
    if (vertical) {
      const chars = [...word];
      const size = Math.min(cw * 0.66, (ch * 0.86) / chars.length);
      g.font = `700 ${size}px "Malgun Gothic", sans-serif`;
      chars.forEach((c, k) => g.fillText(c, x + cw / 2, y + (ch * (k + 0.5)) / chars.length));
    } else {
      g.font = `700 ${ch * 0.62}px "Malgun Gothic", sans-serif`;
      g.fillText(word, x + cw / 2, y + ch / 2, cw * 0.9);
    }
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const SIGN_WORDS = ['카페', '치킨', '분식', '호프', '노래방', 'PC방', '약국', '안경', '미용실', '편의점', '서점', '떡볶이',
  '국밥', '고기집', '피자', '베이커리', '문구', '네일', '스터디', '당구장', '부동산', '학원', '의원', '치과'];
const VERTICAL_WORDS = ['노래연습장', '영어학원', '당구장', '치과의원', 'PC방', '호프집', '스터디카페', '피부과'];

function addSigns(b, ring, ground, top, near, rnd, signs, verticals) {
  const white = color('#ffffff');
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 4.5) continue;
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    const nx = dz; const nz = -dx;
    const mx = (ax + bx) / 2; const mz = (az + bz) / 2;
    // The Yonsei-ro frontage gets real shop names instead of generic signs.
    if (inStrip(mx, mz) || !near(mx + nx * 3, mz + nz * 3, 7)) continue;
    const out = 0.22;
    const panels = Math.max(1, Math.floor(len / 8));
    for (let p = 0; p < panels; p++) {
      const w = Math.min(len / panels - 0.6, 3.2 + rnd() * 3);
      const c = ((p + 0.5) / panels) * len;
      const y0 = ground + 2.75;
      const y1 = y0 + Math.min(1.05, w * 0.3);
      const ax2 = ax + dx * (c - w / 2) + nx * out; const az2 = az + dz * (c - w / 2) + nz * out;
      const bx2 = ax + dx * (c + w / 2) + nx * out; const bz2 = az + dz * (c + w / 2) + nz * out;
      const cell = Math.floor(rnd() * 24);
      const u0 = (cell % 6) / 6; const u1 = u0 + 1 / 6;
      const v1 = 1 - Math.floor(cell / 6) / 4; const v0 = v1 - 1 / 4;
      signs.quad([bx2, y0, bz2], [ax2, y0, az2], [ax2, y1, az2], [bx2, y1, bz2], [nx, 0, nz], white, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    }
    if (b.f >= 3 && rnd() < 0.5) {
      const edge = rnd() < 0.5 ? 0.6 : len - 0.6;
      const vy0 = ground + 4.4;
      const vy1 = Math.min(top - 0.5, vy0 + 3 + rnd() * Math.min(9, (b.f - 2) * 3));
      if (vy1 - vy0 < 2.5) continue;
      const px = ax + dx * edge; const pz = az + dz * edge;
      const cell = Math.floor(rnd() * 8);
      const u0 = cell / 8; const u1 = u0 + 1 / 8;
      // Blade sign standing out from the wall, readable from along the street.
      const o0 = 0.15; const o1 = 1.15;
      const A = [px + nx * o0, vy0, pz + nz * o0];
      const B = [px + nx * o1, vy0, pz + nz * o1];
      const C = [px + nx * o1, vy1, pz + nz * o1];
      const D = [px + nx * o0, vy1, pz + nz * o0];
      const uv = [[u0, 0], [u1, 0], [u1, 1], [u0, 1]];
      verticals.quad(A, B, C, D, [dx, 0, dz], white, uv);
      verticals.quad(B, A, D, C, [-dx, 0, -dz], white, uv);
    }
  }
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------------ Changcheon Church
function pushTriangle(buf, a, b, c, outward, col, ex) {
  const u = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const v = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const n = u.cross(v).normalize();
  const tri = n.dot(outward) >= 0 ? [a, b, c] : [a, c, b];
  if (n.dot(outward) < 0) n.negate();
  for (const p of tri) buf.vertex(p[0], p[1], p[2], n.x, n.y, n.z, col, ex(p));
}

function churchDecal(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round((512 * height) / width);
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const stone = '#c9c1b2';
  const glass = '#26364a';
  const lancet = (cx, base, w, h) => {
    g.beginPath();
    g.moveTo(cx - w / 2, base);
    g.lineTo(cx - w / 2, base - h);
    g.quadraticCurveTo(cx - w / 2, base - h - w * 0.75, cx, base - h - w);
    g.quadraticCurveTo(cx + w / 2, base - h - w * 0.75, cx + w / 2, base - h);
    g.lineTo(cx + w / 2, base);
    g.closePath();
  };
  const framed = (cx, base, w, h) => {
    g.fillStyle = stone; lancet(cx, base, w + 18, h + 6); g.fill();
    g.fillStyle = glass; lancet(cx, base, w, h); g.fill();
    g.strokeStyle = stone; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx, base); g.lineTo(cx, base - h - w * 0.9); g.stroke();
    for (let y = base - 34; y > base - h; y -= 34) { g.beginPath(); g.moveTo(cx - w / 2, y); g.lineTo(cx + w / 2, y); g.stroke(); }
  };
  framed(W * 0.26, H * 0.93, 62, H * 0.5);
  framed(W * 0.74, H * 0.93, 62, H * 0.5);
  framed(W * 0.5, H * 0.93, 54, H * 0.2);
  const cx = W * 0.5;
  const cy = H * 0.4;
  const R = W * 0.17;
  g.fillStyle = stone; g.beginPath(); g.arc(cx, cy, R + 14, 0, 7); g.fill();
  g.fillStyle = '#3a5a86'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
  g.strokeStyle = stone; g.lineWidth = 6;
  for (let a = 0; a < 12; a++) {
    g.beginPath(); g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos((a * Math.PI) / 6) * R, cy + Math.sin((a * Math.PI) / 6) * R); g.stroke();
  }
  g.beginPath(); g.arc(cx, cy, R * 0.42, 0, 7); g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function buildChurch(b, heights, buf, group) {
  // Oriented box from the longest footprint edge; the gable front faces Yonsei-ro to the west.
  let longest = 0;
  let dir = [1, 0];
  b.r.forEach(([ax, az], i) => {
    const [bx, bz] = b.r[(i + 1) % b.r.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len > longest) { longest = len; dir = [(bx - ax) / len, (bz - az) / len]; }
  });
  if (dir[0] < 0) dir = [-dir[0], -dir[1]];
  const side = [-dir[1], dir[0]];
  const us = b.r.map(([x, z]) => x * dir[0] + z * dir[1]);
  const vs = b.r.map(([x, z]) => x * side[0] + z * side[1]);
  const u0 = Math.min(...us); const u1 = Math.max(...us);
  const v0 = Math.min(...vs); const v1 = Math.max(...vs);
  const at = (u, v, y) => [dir[0] * u + side[0] * v, y, dir[1] * u + side[1] * v];
  const ground = heights(...at((u0 + u1) / 2, (v0 + v1) / 2, 0).filter((_, i) => i !== 1));
  const base = ground - 1;
  const brick = color('#7d3f30');
  const slate = color('#4b4742');
  const stone = color('#bdb5a6');
  const seed = 0.37;
  const ex = (u, v, st) => ({ aFacade: [u, v, 0, st], aSeed: [seed] });
  const flat = () => ({ aFacade: [0, 0, 0, 0], aSeed: [seed] });

  const wall = (a, c, top, bays, floors, st) => {
    // Corners a -> c run with the solid on the left, like building rings.
    const dx = c[0] - a[0]; const dz = c[2] - a[2];
    const len = Math.hypot(dx, dz);
    const nx = dz / len; const nz = -dx / len;
    const vBot = -0.2;
    const quad = [
      [c[0], base, c[2], 0, vBot], [a[0], base, a[2], bays, vBot], [a[0], top, a[2], bays, floors],
      [c[0], base, c[2], 0, vBot], [a[0], top, a[2], bays, floors], [c[0], top, c[2], 0, floors],
    ];
    for (const [x, y, z, u, v] of quad) buf.vertex(x, y, z, nx, 0, nz, brick, ex(u, v, st));
  };
  const prism = (ua, ub, va, vb, top, bays, floors, st) => {
    const fl = at(ua, va, 0); const fr = at(ua, vb, 0); const br = at(ub, vb, 0); const bl = at(ub, va, 0);
    // at() maps (dir, side) right-handed in x/z, so this loop has the solid on its left.
    wall(fl, bl, top, bays, floors, st); wall(bl, br, top, bays, floors, st);
    wall(br, fr, top, bays, floors, st); wall(fr, fl, top, bays, floors, st);
  };
  const spire = (cu, cv, half, y0, y1, col) => {
    const tip = at(cu, cv, y1);
    const up = new THREE.Vector3(0, 1, 0);
    const corners = [at(cu - half, cv - half, y0), at(cu + half, cv - half, y0), at(cu + half, cv + half, y0), at(cu - half, cv + half, y0)];
    corners.forEach((p, i) => {
      const q = corners[(i + 1) % 4];
      const out = new THREE.Vector3((p[0] + q[0]) / 2 - tip[0], 0.2, (p[2] + q[2]) / 2 - tip[2]).add(up.clone().multiplyScalar(0.2));
      pushTriangle(buf, p, q, tip, out, col, flat);
    });
  };

  const eave = ground + 11;
  const W = v1 - v0;
  const L = u1 - u0;
  const ridge = eave + W * 0.5;
  const vm = (v0 + v1) / 2;
  prism(u0, u1, v0, v1, eave, Math.max(4, Math.round(L / 4.5)), 2, WINDOW_STYLE.brick);

  // Gabled roof.
  const fl = at(u0, v0, eave); const fr = at(u0, v1, eave); const bl = at(u1, v0, eave); const br = at(u1, v1, eave);
  const rf = at(u0, vm, ridge); const rb = at(u1, vm, ridge);
  const sideOut = (s) => new THREE.Vector3(side[0] * s, 0.8, side[1] * s);
  pushTriangle(buf, fl, rf, rb, sideOut(-1), slate, flat); pushTriangle(buf, fl, rb, bl, sideOut(-1), slate, flat);
  pushTriangle(buf, fr, br, rb, sideOut(1), slate, flat); pushTriangle(buf, fr, rb, rf, sideOut(1), slate, flat);
  const brickFace = (p) => {
    const uu = (p[0] * side[0] + p[2] * side[1] - v0) / 3.1;
    return { aFacade: [uu, (p[1] - ground) / 3.9, 0, WINDOW_STYLE.plainbrick], aSeed: [seed] };
  };
  pushTriangle(buf, fl, fr, rf, new THREE.Vector3(-dir[0], 0, -dir[1]), brick, brickFace);
  pushTriangle(buf, bl, br, rb, new THREE.Vector3(dir[0], 0, dir[1]), brick, brickFace);

  // Bell tower on the south-west corner, slender fleche on the north-west corner.
  const towerSize = Math.max(5.5, W * 0.3);
  const towerTop = ground + 27;
  const inward = 0.5;
  const tu0 = u0 - inward; const tu1 = tu0 + towerSize;
  const tvHigh = side[1] > 0 ? v1 : v0;
  const tv0 = side[1] > 0 ? tvHigh - towerSize + inward : tvHigh - inward;
  const tv1 = tv0 + towerSize;
  prism(tu0, tu1, tv0, tv1, towerTop, 2, 7, WINDOW_STYLE.brick);
  spire((tu0 + tu1) / 2, (tv0 + tv1) / 2, towerSize / 2 + 0.2, towerTop, towerTop + 13, slate);
  const fHalf = 1.2;
  const fv = side[1] > 0 ? v0 + 2.2 : v1 - 2.2;
  const fu = u0 + 3;
  prism(fu - fHalf, fu + fHalf, fv - fHalf, fv + fHalf, ground + 17, 1, 4, WINDOW_STYLE.brick);
  spire(fu, fv, fHalf + 0.1, ground + 17, ground + 27, slate);
  // Stone cross on the tower.
  const cross = at((tu0 + tu1) / 2, (tv0 + tv1) / 2, towerTop + 13);
  addBox(buf, cross[0], cross[1], cross[2], 0.25, 2.4, 0.25, stone, flat());
  addBox(buf, cross[0], cross[1] + 1.5, cross[2], 1.3, 0.25, 0.25, stone, flat());

  // Rose window and lancets on the west gable.
  const decalH = ridge - ground - 1;
  const decalW = W * 0.82;
  const mid = at(u0 - 0.08, vm, ground + 1 + decalH / 2);
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(decalW, decalH),
    new THREE.MeshStandardMaterial({ map: churchDecal(decalW, decalH), transparent: true, alphaTest: 0.5, roughness: 0.4, metalness: 0.2 }),
  );
  decal.position.set(mid[0], mid[1], mid[2]);
  decal.rotation.y = Math.atan2(-dir[0], -dir[1]);
  group.add(decal);
}

// ------------------------------------------------------------------ real shop signs
function realSignAtlas(shops) {
  const cols = 8; const cw = 512; const ch = 96;
  const rows = Math.ceil(shops.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cw;
  canvas.height = rows * ch;
  const g = canvas.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  shops.forEach((s, i) => {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    g.fillStyle = s.bg;
    g.fillRect(x, y, cw, ch);
    g.fillStyle = s.fg;
    g.font = `700 ${ch * 0.66}px "Malgun Gothic", sans-serif`;
    g.fillText(s.n, x + cw / 2, y + ch / 2 + 2, cw * 0.92);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  const cell = (i, x0, x1) => {
    const u0 = ((i % cols) + x0) / cols; const u1 = ((i % cols) + x1) / cols;
    const row = Math.floor(i / cols);
    // Inset so mipmaps do not bleed the neighbouring cell into the sign edge.
    const inset = 0.08 / rows;
    const v1 = 1 - row / rows - inset; const v0 = 1 - (row + 1) / rows + inset;
    return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  };
  return { tex, cell };
}

function verticalAtlas(names) {
  const cw = 96; const ch = 512;
  const cols = Math.min(40, Math.max(1, names.length));
  const rows = Math.ceil(names.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cw;
  canvas.height = rows * ch;
  const g = canvas.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  names.forEach((s, i) => {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    g.fillStyle = s.bg;
    g.fillRect(x + 2, y + 2, cw - 4, ch - 4);
    g.fillStyle = s.fg;
    const chars = [...s.n];
    const size = Math.min(cw * 0.72, (ch * 0.9) / chars.length);
    g.font = `700 ${size}px "Malgun Gothic", sans-serif`;
    chars.forEach((c, k) => g.fillText(c, x + cw / 2, y + (ch * (k + 0.5)) / chars.length));
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const cell = (i) => {
    const u0 = (i % cols) / cols; const u1 = u0 + 1 / cols;
    const row = Math.floor(i / cols);
    const v1 = 1 - row / rows; const v0 = 1 - (row + 1) / rows;
    return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  };
  return { tex, cell };
}

function addRealSigns(world, grounds, group, signMaterials) {
  const shops = world.shops;
  if (!shops.length) return;
  const white = color('#ffffff');
  const fascia = new Buffer3();
  const blades = new Buffer3();
  const atlas = realSignAtlas(shops);
  const bladeShops = shops.filter((s) => s.f >= 1 && [...s.n].length <= 8);
  const vAtlas = verticalAtlas(bladeShops);
  shops.forEach((s, index) => {
    const b = world.buildings[s.b];
    const [ax, az] = b.r[s.e];
    const [bx, bz] = b.r[(s.e + 1) % b.r.length];
    const len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len; const dz = (bz - az) / len;
    const nx = dz; const nz = -dx;
    const ground = grounds.get(b);
    const floorH = b.y / b.f;
    const slot = len / s.c;
    const c0 = slot * s.i + 0.12;
    const c1 = slot * (s.i + 1) - 0.12;
    const point = (t, out) => [ax + dx * t + nx * out, az + dz * t + nz * out];
    const band = (t0, t1, y0, y1, out, uv) => {
      const [x0, z0] = point(t1, out);
      const [x1, z1] = point(t0, out);
      fascia.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], [nx, 0, nz], white, uv);
    };
    const y0 = s.f === 0 ? ground + 2.65 : ground + floorH * s.f + floorH * 0.62;
    const width = c1 - c0;
    const bandH = s.f === 0 ? 1.05 : Math.min(0.9, floorH * 0.3);
    // A sliver of the sign's own background stretches into the full-width fascia.
    band(c0, c1, y0, y0 + bandH, 0.2, atlas.cell(index, 0.004, 0.012));
    const textH = Math.min(bandH * 0.96, width / 5.33);
    const textW = textH * 5.33;
    const mid = (c0 + c1) / 2;
    const textY = y0 + (bandH - textH) / 2;
    band(mid - textW / 2, mid + textW / 2, textY, textY + textH, 0.24, atlas.cell(index, 0.012, 0.988));

    const bi = bladeShops.indexOf(s);
    if (bi >= 0 && width > 2) {
      const vy0 = y0 - 0.3;
      const height = Math.min(b.y - (vy0 - ground) - 0.3, Math.max(2.4, [...s.n].length * 0.72));
      if (height > 1.6) {
        const [x0, z0] = point(c0 + 0.15, 0.15);
        const [x1, z1] = point(c0 + 0.15, 1.05);
        const uv = vAtlas.cell(bi);
        blades.quad([x0, vy0, z0], [x1, vy0, z1], [x1, vy0 + height, z1], [x0, vy0 + height, z0], [dx, 0, dz], white, uv);
        blades.quad([x1, vy0, z1], [x0, vy0, z0], [x0, vy0 + height, z0], [x1, vy0 + height, z1], [-dx, 0, -dz], white, uv);
      }
    }
  });
  const add = (buf, tex) => {
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.55 });
    signMaterials.push(m);
    const mesh = new THREE.Mesh(buf.toGeometry(), m);
    mesh.name = 'real-signs';
    group.add(mesh);
  };
  add(fascia, atlas.tex);
  if (blades.p.length) add(blades, vAtlas.tex);
}

function buildBuildings(world, heights) {
  const buf = new Buffer3({ aFacade: 4, aSeed: 1 });
  const signs = new Buffer3();
  const verticals = new Buffer3();
  const near = roadIndex(world);
  const noFacade = [0, 0, 0, 0];
  const grounds = new Map();
  const group = new THREE.Group();
  group.name = 'buildings';

  for (const b of world.buildings) {
    if (b.custom === 'church') {
      buildChurch(b, heights, buf, group);
      continue;
    }
    const rnd = hashInt(b.id);
    const seed = rnd();
    const hex = pick(rnd, b.st === 'hospital' ? ['#e9e8e2', '#dfe3e2'] : b.st === 'school' ? ['#dccfa9', '#d8c7a0'] : PALETTE[b.k]);
    const wall = color(b.tint ?? hex);
    const roofCol = color(pick(rnd, ROOFS));
    const area = Math.abs(ringArea(b.r));
    let style = WINDOW_STYLE.punched;
    if (b.st && WINDOW_STYLE[b.st]) style = WINDOW_STYLE[b.st];
    else if (b.k === 'university') style = isBrickColour(hex) ? WINDOW_STYLE.brick : WINDOW_STYLE.campus;
    else if (b.k === 'apartments') style = WINDOW_STYLE.slab;
    else if (b.k === 'commercial' && (b.f >= 11 || (area > 600 && rnd() < 0.25))) style = WINDOW_STYLE.curtain;
    if (style === WINDOW_STYLE.curtain && !b.tint) wall.lerp(color('#5f7686'), 0.55);

    let sum = 0; let low = Infinity;
    for (const [x, z] of b.r) { const y = heights(x, z); sum += y; low = Math.min(low, y); }
    const ground = sum / b.r.length;
    grounds.set(b, ground);
    const top = ground + b.y;
    const bottom = low - 0.6;
    const floorH = b.y / b.f;
    const canShop = b.k === 'commercial' && b.c === 1;
    const bayWidth = style === WINDOW_STYLE.curtain ? 2 : style === WINDOW_STYLE.slab ? 3.8 : 3.1;
    const ex = (u, v, shop, st) => ({ aFacade: [u, v, shop, st], aSeed: [seed] });

    for (const ring of [b.r, ...b.h]) {
      for (let i = 0; i < ring.length; i++) {
        const [ax, az] = ring[i];
        const [bx, bz] = ring[(i + 1) % ring.length];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.2) continue;
        const nx = (bz - az) / len;
        const nz = -(bx - ax) / len;
        const bays = Math.max(1, Math.round(len / bayWidth));
        const st = len < 1.7 ? 0 : style;
        const shop = canShop && st && near((ax + bx) / 2 + nx * 3, (az + bz) / 2 + nz * 3, 7) ? 1 : 0;
        const vBot = (bottom - ground) / floorH;
        const verts = [
          [bx, bottom, bz, 0, vBot], [ax, bottom, az, bays, vBot], [ax, top, az, bays, b.f],
          [bx, bottom, bz, 0, vBot], [ax, top, az, bays, b.f], [bx, top, bz, 0, b.f],
        ];
        for (const [x, y, z, u, v] of verts) buf.vertex(x, y, z, nx, 0, nz, wall, ex(u, v, shop, st));
      }
    }

    const contour = b.r.map(([x, z]) => new THREE.Vector2(x, z));
    const holes = b.h.map((ring) => ring.map(([x, z]) => new THREE.Vector2(x, z)));
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    const all = [...b.r, ...b.h.flat()];
    const roofEx = { aFacade: noFacade, aSeed: [seed] };
    for (const [i0, i1, i2] of faces) {
      const a = all[i0]; const c = all[i1]; const d = all[i2];
      const cross = (c[1] - a[1]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[1] - a[1]);
      const tri = cross > 0 ? [a, c, d] : [a, d, c];
      for (const [x, z] of tri) buf.vertex(x, top, z, 0, 1, 0, roofCol, roofEx);
    }

    if (b.f >= 4 && area > 110 && rnd() < 0.65) {
      const cx = b.r.reduce((s, p) => s + p[0], 0) / b.r.length;
      const cz = b.r.reduce((s, p) => s + p[1], 0) / b.r.length;
      if (pointInRing(cx, cz, b.r)) {
        addBox(buf, cx, top, cz, 3 + rnd() * 3, 2.3 + rnd(), 3 + rnd() * 3, color('#b9b6ae'), roofEx);
      }
    }
    if (canShop && b.f >= 2 && signs.p.length < 900000) addSigns(b, b.r, ground, top, near, rnd, signs, verticals);
  }

  const mesh = new THREE.Mesh(
    buf.toGeometry(),
    patchFacade(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 })),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const signMaterials = [];
  const addSignMesh = (b2, tex) => {
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.55 });
    signMaterials.push(m);
    group.add(new THREE.Mesh(b2.toGeometry(), m));
  };
  addSignMesh(signs, signAtlas(SIGN_WORDS, 6, 4, 256, 96, false));
  addSignMesh(verticals, signAtlas(VERTICAL_WORDS, 8, 1, 96, 512, true));
  addRealSigns(world, grounds, group, signMaterials);
  return { group, signMaterials };
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

// ------------------------------------------------------------------ trees
function buildTrees(world, heights) {
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const rawCrown = new THREE.IcosahedronGeometry(1, 1);
  rawCrown.deleteAttribute('normal');
  rawCrown.deleteAttribute('uv');
  const crownGeo = mergeVertices(rawCrown);
  const pos = crownGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const wobble = 0.86 + 0.28 * Math.abs(Math.sin(v.x * 7.1 + v.y * 4.3 + v.z * 5.7));
    pos.setXYZ(i, v.x * wobble, v.y * wobble * 1.15, v.z * wobble);
  }
  crownGeo.computeVertexNormals();
  const n = world.trees.length;
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#4d3f33', roughness: 1 }), n);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.95 }), n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  const rnd = hashInt(9182);
  world.trees.forEach(([x, z, h], i) => {
    const y = heights(x, z);
    const trunkH = h * 0.42;
    m.compose(new THREE.Vector3(x, y, z), q.identity(), new THREE.Vector3(1, trunkH, 1));
    trunks.setMatrixAt(i, m);
    const r = h * (0.3 + rnd() * 0.1);
    q.setFromAxisAngle(up, rnd() * 6.28);
    m.compose(new THREE.Vector3(x, y + trunkH + r * 0.72, z), q, new THREE.Vector3(r, r, r));
    crowns.setMatrixAt(i, m);
    c.setHSL(0.24 + rnd() * 0.07, 0.34 + rnd() * 0.16, 0.21 + rnd() * 0.1);
    crowns.setColorAt(i, c);
  });
  crowns.castShadow = true;
  crowns.receiveShadow = true;
  trunks.castShadow = true;
  const group = new THREE.Group();
  group.name = 'trees';
  group.add(trunks, crowns);
  group.traverse((o) => { o.frustumCulled = false; });
  return group;
}

// ------------------------------------------------------------------ collision for walk mode
export function createCollider(world) {
  const size = 30;
  const cells = new Map();
  for (const b of world.buildings) {
    const xs = b.r.map((p) => p[0]);
    const zs = b.r.map((p) => p[1]);
    for (let i = Math.floor(Math.min(...xs) / size); i <= Math.floor(Math.max(...xs) / size); i++) {
      for (let j = Math.floor(Math.min(...zs) / size); j <= Math.floor(Math.max(...zs) / size); j++) {
        const k = `${i},${j}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(b);
      }
    }
  }
  const inside = (x, z) => (cells.get(`${Math.floor(x / size)},${Math.floor(z / size)}`) ?? []).some((b) => pointInRing(x, z, b.r));
  return (x, z, r = 0.4) => inside(x + r, z) || inside(x - r, z) || inside(x, z + r) || inside(x, z - r);
}

export function buildCity(world, heights, renderer) {
  const root = new THREE.Group();
  root.add(buildTerrain(world, heights, renderer));
  root.add(buildRoads(world, heights));
  const { group, signMaterials } = buildBuildings(world, heights);
  root.add(group);
  root.add(buildTrees(world, heights));
  return { root, signMaterials };
}
