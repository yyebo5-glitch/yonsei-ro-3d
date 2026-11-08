// Downloads the raw OSM extract once. Retries with exponential backoff.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'raw', 'osm.json');
const bbox = '37.536,126.924,37.570,126.950';
const selectors = [
  'way["building"]', 'relation["building"]', 'way["highway"]', 'way["railway"]',
  'way["waterway"]', 'way["natural"]', 'way["landuse"]', 'way["leisure"]',
  'way["amenity"="university"]', 'node["barrier"="gate"]', 'node["name"~"연세대|정문"]',
];
const query = `[out:json][timeout:120];(${selectors.map((s) => `${s}(${bbox});`).join('')});out body;>;out skel qt;`;
const endpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(dirname(out), { recursive: true });
let wait = 5000;
for (let attempt = 0; attempt < 6; attempt++) {
  const url = endpoints[attempt % endpoints.length];
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'yonsei-ro-3d-scene/0.1' },
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(150000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
    const json = JSON.parse(text);
    if (!json.elements?.length) throw new Error('empty result: ' + (json.remark ?? ''));
    await writeFile(out, text);
    console.log(`ok ${url} elements=${json.elements.length} bytes=${text.length}`);
    process.exit(0);
  } catch (e) {
    console.log(`attempt ${attempt + 1} ${url}: ${e.message}`);
    await sleep(wait);
    wait *= 2;
  }
}
console.error('all attempts failed');
process.exit(1);
