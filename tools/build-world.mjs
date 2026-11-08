// Turns raw/osm.json + raw/dem/*.png into public/data/{world.json,terrain.bin}.
// Scene axes: +X east, +Z south, +Y up, metres. Origin = Yonsei University main gate.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { BRAND_STYLES, CATEGORY_STYLES, OBSERVED_BUILDINGS, OBSERVED_SHOPS } from './street-references.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = { lat: 37.5604517, lon: 126.9368064 };
const EXTENT = { minX: -1100, maxX: 1120, minZ: -1040, maxZ: 2700 };
const CORE = { minX: -650, maxX: 650, minZ: -200, maxZ: 2150 };
const TERRAIN_DX = 8;
const DEM_ZOOM = 15;
const MIN_ELEVATION = 3;

const phi = (ORIGIN.lat * Math.PI) / 180;
const M_LAT = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const M_LON = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
const r2 = (v) => Math.round(v * 100) / 100;
const project = (lat, lon) => [r2((lon - ORIGIN.lon) * M_LON), r2(-(lat - ORIGIN.lat) * M_LAT)];
const unproject = (x, z) => [ORIGIN.lat - z / M_LAT, ORIGIN.lon + x / M_LON];

const inRect = (p, r) => p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minZ && p[1] <= r.maxZ;
const signedArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
};
const orient = (ring, positive) => ((signedArea(ring) > 0) === positive ? ring : [...ring].reverse());
const centroid = (ring) => [
  ring.reduce((s, p) => s + p[0], 0) / ring.length,
  ring.reduce((s, p) => s + p[1], 0) / ring.length,
];
const pointInRing = (x, z, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const hashRand = (seed) => {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};
const num = (v) => {
  const m = /-?\d+(\.\d+)?/.exec(v ?? '');
  return m ? parseFloat(m[0]) : null;
};

// ---------------------------------------------------------------- terrain
function buildTerrain() {
  const n = 2 ** DEM_ZOOM;
  const lonToPx = (lon) => ((lon + 180) / 360) * n * 256;
  const latToPx = (lat) => {
    const r = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * 256;
  };
  const tiles = new Map();
  const tile = (x, y) => {
    const key = `${x}_${y}`;
    if (!tiles.has(key)) {
      const png = PNG.sync.read(readFileSync(join(root, 'raw', 'dem', `${DEM_ZOOM}_${key}.png`)));
      tiles.set(key, png);
    }
    return tiles.get(key);
  };
  const px = (x, y) => {
    const t = tile(Math.floor(x / 256), Math.floor(y / 256));
    const i = ((y % 256) * 256 + (x % 256)) * 4;
    return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
  };
  const sample = (lat, lon) => {
    const fx = lonToPx(lon) - 0.5;
    const fy = latToPx(lat) - 0.5;
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    const tx = fx - x;
    const ty = fy - y;
    return (
      (px(x, y) * (1 - tx) + px(x + 1, y) * tx) * (1 - ty) +
      (px(x, y + 1) * (1 - tx) + px(x + 1, y + 1) * tx) * ty
    );
  };

  const w = Math.floor((EXTENT.maxX - EXTENT.minX) / TERRAIN_DX) + 1;
  const h = Math.floor((EXTENT.maxZ - EXTENT.minZ) / TERRAIN_DX) + 1;
  let grid = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [lat, lon] = unproject(EXTENT.minX + i * TERRAIN_DX, EXTENT.minZ + j * TERRAIN_DX);
      // Negative spikes near the south edge are source artefacts, not real ground.
      grid[j * w + i] = Math.max(MIN_ELEVATION, sample(lat, lon));
    }
  }
  // The source is ~30 m data resampled onto a finer tile grid: smooth away the stair-stepping.
  const radius = 2;
  for (let pass = 0; pass < 3; pass++) {
    for (const horizontal of [true, false]) {
      const next = new Float32Array(grid.length);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          let sum = 0;
          for (let k = -radius; k <= radius; k++) {
            const a = horizontal ? Math.min(w - 1, Math.max(0, i + k)) : i;
            const b = horizontal ? j : Math.min(h - 1, Math.max(0, j + k));
            sum += grid[b * w + a];
          }
          next[j * w + i] = sum / (radius * 2 + 1);
        }
      }
      grid = next;
    }
  }
  return { w, h, grid };
}

// ---------------------------------------------------------------- OSM
const osm = JSON.parse(readFileSync(join(root, 'raw', 'osm.json'), 'utf8'));
const nodes = new Map();
const waysById = new Map();
for (const e of osm.elements) {
  if (e.type === 'node') nodes.set(e.id, e);
  else if (e.type === 'way') waysById.set(e.id, e);
}
const wayPoints = (w) => w.nodes.map((id) => nodes.get(id)).filter(Boolean).map((n) => project(n.lat, n.lon));
const isClosed = (w) => w.nodes.length > 3 && w.nodes[0] === w.nodes.at(-1);
const taggedWays = [...waysById.values()].filter((w) => w.tags);

// Multipolygon rings can be split over several ways.
function stitch(memberWays) {
  const open = memberWays.map((w) => [...w.nodes]);
  const rings = [];
  while (open.length) {
    let ring = open.pop();
    let grown = true;
    while (grown && ring[0] !== ring.at(-1)) {
      grown = false;
      for (let i = 0; i < open.length; i++) {
        const c = open[i];
        if (c[0] === ring.at(-1)) ring = ring.concat(c.slice(1));
        else if (c.at(-1) === ring.at(-1)) ring = ring.concat([...c].reverse().slice(1));
        else continue;
        open.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (ring[0] === ring.at(-1) && ring.length > 3) rings.push(ring);
  }
  return rings;
}
const ringFromIds = (ids) =>
  ids.slice(0, -1).map((id) => nodes.get(id)).filter(Boolean).map((n) => project(n.lat, n.lon));

const SKIP_BUILDING = new Set(['bridge', 'roof', 'canopy', 'carport', 'ruins', 'construction', 'container']);
const FLOOR_HEIGHT = { commercial: 3.5, apartments: 2.9, university: 3.9, house: 3.0 };

function buildingKind(tags) {
  const b = tags.building;
  if (['university', 'college', 'school', 'hospital', 'civic', 'public', 'government', 'dormitory'].includes(b)) return 'university';
  if (['apartments', 'residential', 'terrace'].includes(b)) return 'apartments';
  if (['house', 'detached', 'semidetached_house'].includes(b)) return 'house';
  return 'commercial';
}

function estimateFloors(kind, area, rnd, tags, centre) {
  const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  if (tags.building === 'church') return between(2, 4);
  if (kind === 'house') return between(1, 3);
  if (kind === 'apartments') return area > 450 ? between(12, 20) : area > 200 ? between(5, 9) : between(3, 5);
  if (kind === 'university') return area > 1500 ? between(5, 9) : between(3, 6);
  const nearStrip = Math.abs(centre[0]) < 170 && centre[1] > 0 && centre[1] < 650;
  if (area < 90) return between(2, 3);
  if (area < 220) return nearStrip ? between(4, 6) : between(3, 5);
  if (area < 700) return nearStrip ? between(5, 9) : between(4, 7);
  return between(5, 10);
}

function makeBuilding(id, tags, outer, holes) {
  if (SKIP_BUILDING.has(tags.building)) return null;
  if (tags.location === 'underground' || tags.indoor === 'yes' || num(tags.layer) < 0) return null;
  if (outer.length < 3 || !outer.every((p) => inRect(p, EXTENT))) return null;
  const area = Math.abs(signedArea(outer));
  if (area < 12) return null;
  const rnd = hashRand(id % 4294967291);
  const kind = buildingKind(tags);
  const fh = FLOOR_HEIGHT[kind];
  const c = centroid(outer);
  let height = num(tags.height) ?? num(tags['building:height']);
  const levels = num(tags['building:levels']);
  let source = 'height';
  let floors;
  if (height && height >= 2) {
    floors = Math.max(1, Math.round(height / fh));
  } else if (levels && levels >= 1) {
    floors = Math.round(levels);
    height = floors * fh;
    source = 'levels';
  } else {
    floors = estimateFloors(kind, area, rnd, tags, c);
    height = floors * fh;
    source = 'estimate';
  }
  return {
    id,
    r: orient(outer, true),
    h: holes.map((ring) => orient(ring, false)),
    y: r2(height),
    f: floors,
    k: kind,
    b: tags.building,
    s: source[0],
    n: tags.name ?? undefined,
    c: inRect(c, CORE) ? 1 : 0,
  };
}

const buildings = [];
const relationOuterWays = new Set();
for (const e of osm.elements) {
  if (e.type !== 'relation' || !e.tags?.building) continue;
  const outerWays = e.members.filter((m) => m.type === 'way' && m.role === 'outer').map((m) => waysById.get(m.ref)).filter(Boolean);
  const innerWays = e.members.filter((m) => m.type === 'way' && m.role === 'inner').map((m) => waysById.get(m.ref)).filter(Boolean);
  const holes = stitch(innerWays).map(ringFromIds);
  for (const w of outerWays) relationOuterWays.add(w.id);
  stitch(outerWays).forEach((ids, idx) => {
    const outer = ringFromIds(ids);
    const b = makeBuilding(e.id + idx, e.tags, outer, holes.filter((h) => pointInRing(h[0][0], h[0][1], outer)));
    if (b) buildings.push(b);
  });
}
for (const w of taggedWays) {
  if (!w.tags.building || !isClosed(w) || relationOuterWays.has(w.id)) continue;
  const b = makeBuilding(w.id, w.tags, ringFromIds(w.nodes), []);
  if (b) buildings.push(b);
}

// Spatial hash used to keep trees out of buildings.
const CELL = 24;
const buildingGrid = new Map();
for (const b of buildings) {
  const xs = b.r.map((p) => p[0]);
  const zs = b.r.map((p) => p[1]);
  for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++) {
    for (let j = Math.floor(Math.min(...zs) / CELL); j <= Math.floor(Math.max(...zs) / CELL); j++) {
      const k = `${i},${j}`;
      if (!buildingGrid.has(k)) buildingGrid.set(k, []);
      buildingGrid.get(k).push(b);
    }
  }
}
const insideBuilding = (x, z) =>
  (buildingGrid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []).some((b) => pointInRing(x, z, b.r));

// ---------------------------------------------------------------- height calibration
// Untagged buildings take the area-weighted median floor count of tagged neighbours of the same kind.
function calibrateHeights() {
  const size = 150;
  const cells = new Map();
  const tagged = buildings.filter((b) => b.s !== 'e').map((b) => {
    const [x, z] = centroid(b.r);
    return { x, z, k: b.k, f: b.f, a: Math.abs(signedArea(b.r)) };
  });
  for (const t of tagged) {
    const key = `${Math.floor(t.x / size)},${Math.floor(t.z / size)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(t);
  }
  let changed = 0;
  for (const b of buildings) {
    if (b.s !== 'e') continue;
    const [x, z] = centroid(b.r);
    const area = Math.abs(signedArea(b.r));
    const samples = [];
    const ci = Math.floor(x / size);
    const cj = Math.floor(z / size);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (const t of cells.get(`${i},${j}`) ?? []) {
          if (t.k !== b.k) continue;
          const d = Math.hypot(t.x - x, t.z - z);
          const logRatio = Math.log(area / t.a);
          samples.push([t.f, Math.exp(-d / 70) * Math.exp(-(logRatio * logRatio) / 0.6)]);
        }
      }
    }
    const total = samples.reduce((s, v) => s + v[1], 0);
    if (total < 0.35) continue;
    samples.sort((p, q) => p[0] - q[0]);
    let acc = 0;
    const median = samples.find((v) => (acc += v[1]) >= total / 2)[0];
    b.f = Math.max(1, Math.round(b.f * 0.3 + median * 0.7));
    b.y = r2(b.f * FLOOR_HEIGHT[b.k]);
    b.s = 'k';
    changed++;
  }
  return changed;
}
const calibrated = calibrateHeights();

const isSchool = (b) => b.b === 'school' || (b.n && /초등학교|중학교|고등학교|창서|창천중/.test(b.n) && !/대학/.test(b.n));
for (const b of buildings) {
  if (b.b === 'hospital' || (b.n && /병원/.test(b.n))) b.st = 'hospital';
  else if (isSchool(b)) {
    b.st = 'school';
    // Neighbouring university towers must not inflate primary and middle schools.
    if ((b.s === 'e' || b.s === 'k') && b.f > 5) {
      b.f = 5;
      b.y = r2(5 * FLOOR_HEIGHT[b.k]);
    }
  }
  if (b.n === '창천교회') b.custom = 'church';
}

function findBuilding(x, z, maxDist = 16) {
  let best = null;
  let bestD = maxDist;
  for (const b of buildings) {
    const [cx, cz] = centroid(b.r);
    if (Math.hypot(cx - x, cz - z) > 90) continue;
    if (pointInRing(x, z, b.r)) return b;
    const d = Math.hypot(cx - x, cz - z);
    if (d < bestD) { best = b; bestD = d; }
  }
  return best;
}
let observedFloors = 0;
for (const o of OBSERVED_BUILDINGS) {
  const b = findBuilding(o.at[0], o.at[1]);
  if (!b) { console.log('no building at', o.at); continue; }
  b.f = o.floors;
  b.y = o.height ?? r2(o.floors * FLOOR_HEIGHT[b.k]);
  b.s = 'r';
  b.tint = o.tint;
  if (o.style) b.st = o.style;
  observedFloors++;
}

// ---------------------------------------------------------------- real shop signs
const inStrip = (x, z) => Math.abs(x - 8) < 62 && z > -30 && z < 590;
const cleanName = (name) => name
  .replace(/\(.*?\)/g, '')
  .replace(/\s*(현대백화점\s*)?(유플렉스|유플레스|유플랙스|현대유플렉스)?\s*(신촌|연세|연대|창천동?|서강|이대)[가-힣A-Za-z0-9&·]*점\s*$/u, '')
  .replace(/\s*(PS&M).*$/u, '')
  .replace(/\s*\d+호점.*$/u, '')
  .trim();
const firstLevel = (lv) => {
  const values = String(lv ?? '').split(';').map(Number).filter((v) => Number.isFinite(v) && v >= 0);
  return values.length ? Math.min(...values) : null;
};
const UPPER_TYPES = new Set(['doctors', 'dentist', 'fitness_centre', 'internet_cafe', 'karaoke_box', 'alternative', 'games']);
const HIDDEN_TYPES = new Set(['toilets', 'apartment', 'bicycle_rental', 'parking', 'atm', 'bench', 'vending_machine', 'waste_basket', 'hotel']);

function collectShops() {
  const elements = JSON.parse(readFileSync(join(root, 'raw', 'poi.json'), 'utf8')).elements;
  const seen = [];
  for (const e of elements) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat == null) continue;
    const [x, z] = project(lat, lon);
    const type = e.tags.shop || e.tags.amenity || e.tags.office || e.tags.healthcare || e.tags.leisure || e.tags.tourism;
    if (!inStrip(x, z) || HIDDEN_TYPES.has(type) || (e.tags.level && firstLevel(e.tags.level) === null)) continue;
    const n = cleanName(e.tags.name);
    if (!n || /화장실|주차/.test(n)) continue;
    const key = n.replace(/[\s·,]/g, '').toLowerCase();
    const dupe = seen.find((s) => s.key === key && Math.hypot(s.x - x, s.z - z) < 28);
    const level = firstLevel(e.tags.level);
    if (dupe) { if (dupe.level == null && level != null) dupe.level = level; continue; }
    seen.push({ key, n, x, z, type, level });
  }
  const observed = OBSERVED_SHOPS.map((o) => ({ ...o, key: o.n, level: o.floor, observed: true }));
  const kept = seen.filter((s) => !OBSERVED_SHOPS.some((o) => o.replace?.test(s.n) && Math.hypot(o.x - s.x, o.z - s.z) < 30));
  return [...kept, ...observed];
}

function colorsFor(shop) {
  if (shop.bg) return [shop.bg, shop.fg];
  for (const [re, bg, fg] of BRAND_STYLES) if (re.test(shop.n)) return [bg, fg];
  if (CATEGORY_STYLES[shop.type]) return CATEGORY_STYLES[shop.type];
  const rnd = hashRand([...shop.n].reduce((s, c) => s * 31 + c.charCodeAt(0), 7) >>> 0);
  return [['#23395d', '#ffffff'], ['#7a2e2e', '#fff6d8'], ['#14654f', '#ffffff'], ['#3a3a3f', '#ffd24a'], ['#e7e2d6', '#222222']][Math.floor(rnd() * 5)];
}

function placeShops() {
  const groups = new Map();
  const shops = collectShops();
  const nearestEdge = (s) => {
    let best = null;
    let bestScore = 26;
    const ci = Math.floor(s.x / CELL);
    const cj = Math.floor(s.z / CELL);
    const seenB = new Set();
    for (let i = ci - 2; i <= ci + 2; i++) {
      for (let j = cj - 2; j <= cj + 2; j++) {
        for (const b of buildingGrid.get(`${i},${j}`) ?? []) {
          if (seenB.has(b) || b.custom) continue;
          seenB.add(b);
          for (let e = 0; e < b.r.length; e++) {
            const [ax, az] = b.r[e];
            const [bx, bz] = b.r[(e + 1) % b.r.length];
            const len = Math.hypot(bx - ax, bz - az);
            if (len < 2.5) continue;
            const nx = (bz - az) / len;
            const nz = -(bx - ax) / len;
            const mx = (ax + bx) / 2;
            const mz = (az + bz) / 2;
            if (insideBuilding(mx + nx * 2.5, mz + nz * 2.5)) continue;
            const t = Math.max(0, Math.min(1, ((s.x - ax) * (bx - ax) + (s.z - az) * (bz - az)) / (len * len)));
            const d = Math.hypot(ax + (bx - ax) * t - s.x, az + (bz - az) * t - s.z);
            const facesStreet = Math.abs(mx - 8) < 45 && nx * (8 - mx) > 0 && Math.abs(nx) > 0.6;
            const score = d - (facesStreet ? 7 : 0);
            if (score < bestScore) { bestScore = score; best = { b, e, t, len }; }
          }
        }
      }
    }
    return best;
  };
  let dropped = 0;
  for (const s of shops) {
    const hit = nearestEdge(s);
    if (!hit) { dropped++; continue; }
    let floor = s.level ?? (UPPER_TYPES.has(s.type) ? 2 : s.type === 'hairdresser' ? 1 : 0);
    floor = Math.min(floor, Math.max(0, hit.b.f - 1));
    const key = `${buildings.indexOf(hit.b)}:${hit.e}`;
    if (!groups.has(key)) groups.set(key, { hit, floors: new Map() });
    const floors = groups.get(key).floors;
    if (!floors.has(floor)) floors.set(floor, []);
    floors.get(floor).push({ s, t: hit.t });
  }
  const out = [];
  for (const [key, { hit, floors }] of groups) {
    const buildingIndex = Number(key.split(':')[0]);
    const levels = [...floors.keys()].sort((p, q) => p - q);
    for (let idx = 0; idx < levels.length; idx++) {
      const floor = levels[idx];
      const list = floors.get(floor).sort((p, q) => p.t - q.t);
      const capacity = Math.max(1, Math.floor(hit.len / 2.6));
      if (list.length > capacity) {
        // Korean frontages stack tenants upward when the wall runs out.
        const nextFloor = floor + 1;
        if (nextFloor < hit.b.f) {
          if (!floors.has(nextFloor)) { floors.set(nextFloor, []); levels.splice(idx + 1, 0, nextFloor); }
          floors.get(nextFloor).push(...list.splice(capacity));
        } else {
          dropped += list.length - capacity;
          list.length = capacity;
        }
      }
      list.forEach(({ s }, i) => {
        const [bg, fg] = colorsFor(s);
        out.push({ b: buildingIndex, e: hit.e, i, c: list.length, f: floor, n: s.n, bg, fg, o: s.observed ? 1 : undefined });
      });
    }
  }
  return { placed: out, dropped };
}
const shopResult = placeShops();

// ---------------------------------------------------------------- roads
const ROAD = {
  motorway: [20, 0], trunk: [18, 3.5], primary: [18, 4], secondary: [13, 3.5], tertiary: [9, 2.5],
  trunk_link: [6, 0], primary_link: [6, 0], secondary_link: [6, 0], tertiary_link: [5, 0],
  unclassified: [6, 1], residential: [5, 0], living_street: [4.5, 0], service: [3.5, 0],
  busway: [6, 0], pedestrian: [7, 0], footway: [1.8, 0], path: [1.6, 0], cycleway: [2, 0], steps: [2, 0],
};
const FOOT = new Set(['footway', 'path', 'cycleway', 'steps', 'pedestrian']);
const isDrawable = (t) =>
  (t.highway && ROAD[t.highway]) && t.tunnel !== 'yes' && t.tunnel !== 'building_passage' && t.indoor !== 'yes' &&
  t.area !== 'yes' && !(num(t.layer) < 0);

const degree = new Map();
const carWays = taggedWays.filter((w) => isDrawable(w.tags) && !FOOT.has(w.tags.highway));
for (const w of carWays) {
  w.nodes.forEach((id, i) => {
    const inc = i === 0 || i === w.nodes.length - 1 ? 1 : 2;
    degree.set(id, (degree.get(id) ?? 0) + inc);
  });
}
const bridgeNodes = new Map();
const isBridge = (t) => t.bridge && t.bridge !== 'no';
for (const w of taggedWays) {
  if (!isBridge(w.tags)) continue;
  for (const id of [w.nodes[0], w.nodes.at(-1)]) bridgeNodes.set(id, (bridgeNodes.get(id) ?? 0) + 1);
}
const bridgeInfo = (w) => {
  if (!isBridge(w.tags)) return {};
  const layer = Math.max(1, num(w.tags.layer) ?? 1);
  return {
    bh: 6.5 * layer,
    rs: bridgeNodes.get(w.nodes[0]) > 1 ? 0 : 1,
    re: bridgeNodes.get(w.nodes.at(-1)) > 1 ? 0 : 1,
  };
};
const trimToExtent = (pts) => pts.every((p) => inRect(p, EXTENT));

const roads = [];
const crossings = [];
for (const w of taggedWays) {
  const t = w.tags;
  if (!isDrawable(t)) continue;
  const pts = wayPoints(w);
  if (pts.length < 2 || !trimToExtent(pts)) continue;
  const core = pts.some((p) => inRect(p, CORE));
  if (FOOT.has(t.highway) && t.highway !== 'pedestrian' && !core) continue;
  if (t.footway === 'crossing') {
    if (core) crossings.push(pts);
    continue;
  }
  let [width, sidewalk] = ROAD[t.highway];
  const lanes = num(t.lanes);
  if (num(t.width)) width = num(t.width);
  else if (lanes) width = lanes * 3.3;
  const isYonsei = t.name === '연세로' && t.highway === 'tertiary';
  if (isYonsei) { width = 7; sidewalk = 7; }

  let s = 0;
  const junctions = [];
  w.nodes.forEach((id, i) => {
    if (i > 0) {
      const a = pts[i - 1];
      const b = pts[i];
      s += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    if (degree.get(id) >= 3) junctions.push(r2(s));
  });
  roads.push({
    p: pts, k: t.highway, w: width, sw: sidewalk, l: lanes ?? undefined, o: t.oneway === 'yes' ? 1 : 0,
    n: t.name ?? undefined, j: junctions, yr: isYonsei ? 1 : undefined, c: core ? 1 : 0, ...bridgeInfo(w),
  });
}

const rails = [];
for (const w of taggedWays) {
  const t = w.tags;
  if (!['rail', 'light_rail'].includes(t.railway) || t.tunnel === 'yes' || num(t.layer) < 0) continue;
  const pts = wayPoints(w);
  if (pts.length >= 2 && trimToExtent(pts)) rails.push({ p: pts, ...bridgeInfo(w) });
}

// ---------------------------------------------------------------- land cover and trees
const GREEN = (t) => {
  if (['wood', 'scrub'].includes(t.natural) || t.landuse === 'forest') return 'forest';
  if (['grassland', 'heath'].includes(t.natural) || ['grass', 'meadow', 'village_green', 'recreation_ground'].includes(t.landuse)) return 'grass';
  if (['park', 'garden'].includes(t.leisure)) return 'park';
  if (['pitch', 'track', 'stadium'].includes(t.leisure)) return 'pitch';
  if (t.natural === 'water' || t.waterway === 'riverbank') return 'water';
  return null;
};
const green = [];
for (const w of taggedWays) {
  const k = GREEN(w.tags);
  if (!k || !isClosed(w)) continue;
  const ring = ringFromIds(w.nodes);
  if (ring.some((p) => inRect(p, EXTENT))) green.push({ r: ring, k });
}

const trees = [];
const treeRand = hashRand(20260411);
for (const g of green) {
  if (g.k !== 'forest' && g.k !== 'park') continue;
  const spacing = g.k === 'forest' ? 8 : 17;
  const xs = g.r.map((p) => p[0]);
  const zs = g.r.map((p) => p[1]);
  for (let x = Math.min(...xs); x < Math.max(...xs); x += spacing) {
    for (let z = Math.min(...zs); z < Math.max(...zs); z += spacing) {
      const px = x + treeRand() * spacing * 0.8;
      const pz = z + treeRand() * spacing * 0.8;
      if (inRect([px, pz], EXTENT) && pointInRing(px, pz, g.r) && !insideBuilding(px, pz)) {
        trees.push([r2(px), r2(pz), r2(7 + treeRand() * 7)]);
      }
    }
  }
}
for (const road of roads) {
  if (!road.c || road.bh || !['primary', 'secondary', 'tertiary'].includes(road.k)) continue;
  const offset = road.w / 2 + Math.max(1.2, road.sw * 0.55);
  for (let i = 1; i < road.p.length; i++) {
    const [ax, az] = road.p[i - 1];
    const [bx, bz] = road.p[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1) continue;
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    for (let d = 6; d < len; d += 13) {
      for (const side of [1, -1]) {
        const x = ax + ((bx - ax) * d) / len + nx * offset * side;
        const z = az + ((bz - az) * d) / len + nz * offset * side;
        if (!insideBuilding(x, z)) trees.push([r2(x), r2(z), r2(6 + treeRand() * 3)]);
      }
    }
  }
}
trees.length = Math.min(trees.length, 10000);

// ---------------------------------------------------------------- labels
const findByName = (re) => buildings.find((b) => b.n && re.test(b.n));
const labels = [{ t: '연세대 정문', x: 0, z: 0 }];
const addNamed = (t, re) => {
  const b = findByName(re);
  if (b) {
    const [x, z] = centroid(b.r);
    labels.push({ t, x: r2(x), z: r2(z), y: b.y });
  }
};
const yonseiSouth = project(37.55557, 126.93685);
labels.push({ t: '연세로 남단 · 신촌로', x: yonseiSouth[0], z: yonseiSouth[1] });
labels.push({ t: '정문에서 2km', x: 0, z: 2000 });
addNamed('현대백화점', /현대백화점/);
addNamed('창천교회', /창천교회/);
addNamed('서강대 본관', /서강대.*본관|^본관$/);

// ---------------------------------------------------------------- write
const terrain = buildTerrain();
const outDir = join(root, 'public', 'data');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'terrain.bin'), Buffer.from(terrain.grid.buffer));

let hMin = Infinity;
let hMax = -Infinity;
for (const v of terrain.grid) { hMin = Math.min(hMin, v); hMax = Math.max(hMax, v); }
const count = (k) => buildings.filter((b) => b.s === k).length;
const stats = {
  buildings: buildings.length, core: buildings.filter((b) => b.c).length,
  fromHeight: count('h'), fromLevels: count('l'), neighbourCalibrated: calibrated, observed: observedFloors, estimated: count('e'),
  shops: shopResult.placed.length, shopsDropped: shopResult.dropped,
  roads: roads.length, crossings: crossings.length, rails: rails.length, green: green.length, trees: trees.length,
  elevation: [r2(hMin), r2(hMax)],
};
writeFileSync(
  join(outDir, 'world.json'),
  JSON.stringify({
    origin: ORIGIN, extent: EXTENT, core: CORE,
    terrain: { w: terrain.w, h: terrain.h, dx: TERRAIN_DX, url: 'data/terrain.bin' },
    buildings, roads, crossings, rails, green, trees, labels, stats, shops: shopResult.placed,
  }),
);
console.log(stats, 'labels', labels.map((l) => l.t).join(', '));
