// Downloads named shops and amenities for the corridor into raw/poi.json.
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bbox = '37.5400,126.9290,37.5625,126.9445';
const keys = ['shop', 'amenity', 'office', 'healthcare', 'leisure', 'tourism', 'craft'];
const parts = keys.flatMap((k) => [`node["${k}"]["name"](${bbox});`, `way["${k}"]["name"](${bbox});`]);
const query = `[out:json][timeout:90];(${parts.join('')});out center tags;`;
const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wait = 5000;
for (let attempt = 0; attempt < 6; attempt++) {
  const url = endpoints[attempt % endpoints.length];
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'yonsei-ro-3d-scene/0.1' },
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(120000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
    const json = JSON.parse(text);
    if (!json.elements?.length) throw new Error('empty result');
    await writeFile(join(root, 'raw', 'poi.json'), text);
    console.log(`ok ${url} elements=${json.elements.length}`);
    process.exit(0);
  } catch (e) {
    console.log(`attempt ${attempt + 1} ${url}: ${e.message}`);
    await sleep(wait);
    wait *= 2;
  }
}
process.exit(1);
