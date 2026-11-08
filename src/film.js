import * as THREE from 'three';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { createCast } from './people.js';

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const SPOTS = { brawl: [5, 362], busker: [0.4, 432], drunk: [13.4, 478] };
const ROUTE = [
  [36, 161], [24, 164], [12, 168], [9, 210], [9, 300], [12, 330], [13.6, 350], [13.6, 378],
  [12, 402], [9.5, 432], [8, 460], [10, 478], [8, 500], [9, 538],
].map(([x, z]) => new THREE.Vector3(x, 0, z));
const HOLD_START = 2.5;
const HOLD_END = 1.5;
const BASE_SPEED = 7;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const window01 = (a, b, c, d, x) => smooth(a, b, x) * (1 - smooth(c, d, x));

const curve = new THREE.CatmullRomCurve3(ROUTE, false, 'centripetal');
curve.arcLengthDivisions = 1200;
const LENGTH = curve.getLength();

function speedAt(z) {
  let v = BASE_SPEED;
  v += (2.8 - v) * window01(312, 334, 384, 400, z);
  v += (3.8 - v) * window01(408, 420, 442, 454, z);
  v += (3.2 - v) * window01(460, 470, 486, 496, z);
  return v;
}

/** Arc length per frame, integrated once so every frame is reproducible. */
function buildTimeline() {
  const distances = [];
  const dt = 1 / FPS;
  for (let i = 0; i < HOLD_START * FPS; i++) distances.push(0);
  let s = 0;
  let speed = 0;
  while (s < LENGTH) {
    const z = curve.getPointAt(Math.min(1, s / LENGTH)).z;
    const remaining = LENGTH - s;
    const target = Math.min(speedAt(z), 0.6 + remaining * 0.9);
    speed += (target - speed) * Math.min(1, dt * 3.5);
    s += speed * dt;
    distances.push(Math.min(LENGTH, s));
    if (remaining < 0.04) break;
  }
  for (let i = 0; i < HOLD_END * FPS; i++) distances.push(LENGTH);
  return distances;
}

export function initFilm({ renderer, scene, camera, heights, sky, updateShadows, setTime }) {
  const cast = createCast(scene, heights, SPOTS);
  const timeline = buildTimeline();
  const frames = timeline.length;
  renderer.setAnimationLoop(null);
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  camera.aspect = WIDTH / HEIGHT;
  camera.fov = 62;
  camera.updateProjectionMatrix();
  setTime('day');
  document.getElementById('ui')?.classList.add('hidden');
  document.getElementById('labels')?.classList.add('hidden');

  const here = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const look = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const target = new THREE.Vector3();
  const focusDir = new THREE.Vector3();

  function renderFrame(frame) {
    const t = frame / FPS;
    const s = timeline[Math.min(frame, frames - 1)];
    curve.getPointAt(Math.min(1, s / LENGTH), here);
    curve.getPointAt(Math.min(1, (s + 7) / LENGTH), ahead);

    const stride = s / 0.82;
    const moving = smooth(0, 1.5, s) * smooth(0, 1.5, LENGTH - s);
    const ground = heights(here.x, here.z);
    camera.position.set(
      here.x + Math.cos(stride) * 0.018 * moving,
      ground + 1.67 + Math.abs(Math.sin(stride)) * 0.05 * moving,
      here.z,
    );

    direction.copy(ahead).sub(here).setY(0).normalize();
    direction.y = -0.02;
    const blend = (point, w) => {
      if (w <= 0) return;
      focusDir.copy(point).sub(camera.position).normalize();
      direction.lerp(focusDir, w).normalize();
    };
    const brawlW = window01(310, 332, 382, 398, here.z);
    const buskerW = window01(404, 418, 442, 456, here.z);
    const drunkW = window01(458, 469, 486, 497, here.z);
    blend(target.set(58, heights(58, 141) + 11, 141), 1 - smooth(1.5, 16, s));
    blend(target.set(SPOTS.brawl[0], ground + 1.1, SPOTS.brawl[1]), brawlW * 0.95);
    blend(target.set(SPOTS.busker[0], ground + 1.25, SPOTS.busker[1]), buskerW * 0.92);
    blend(target.set(SPOTS.drunk[0], ground + 0.7, SPOTS.drunk[1]), drunkW * 0.9);
    camera.fov = 62 - 18 * Math.max(brawlW * 0.75, buskerW, drunkW);
    camera.updateProjectionMatrix();
    look.copy(camera.position).add(direction);
    camera.up.set(Math.cos(stride) * 0.006 * moving, 1, 0).normalize();
    camera.lookAt(look);
    camera.updateMatrixWorld();

    cast(t);
    sky.position.copy(camera.position);
    updateShadows(camera.position, 130);
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
  }

  const state = { frames, seconds: frames / FPS, frame: 0, status: 'ready', error: null, bytes: 0, file: null };

  async function record() {
    state.status = 'recording';
    try {
      const target2d = document.createElement('canvas');
      target2d.width = WIDTH;
      target2d.height = HEIGHT;
      const g = target2d.getContext('2d', { alpha: false });
      const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: WIDTH, height: HEIGHT, frameRate: FPS }, fastStart: 'in-memory' });
      let failure = null;
      const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
      encoder.configure({ codec: 'avc1.640032', width: WIDTH, height: HEIGHT, bitrate: 22_000_000, framerate: FPS, latencyMode: 'quality' });
      const channel = new MessageChannel();
      const yieldToEvents = () => new Promise((resolve) => { channel.port1.onmessage = resolve; channel.port2.postMessage(0); });

      for (let frame = 0; frame < frames; frame++) {
        if (failure) throw failure;
        renderFrame(frame);
        g.drawImage(renderer.domElement, 0, 0);
        g.font = '500 20px "Malgun Gothic", sans-serif';
        g.fillStyle = 'rgba(255,255,255,.82)';
        g.shadowColor = 'rgba(0,0,0,.7)';
        g.shadowBlur = 4;
        g.fillText('지도 데이터 © OpenStreetMap contributors', 28, HEIGHT - 26);
        g.shadowBlur = 0;
        const video = new VideoFrame(target2d, { timestamp: Math.round((frame * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
        encoder.encode(video, { keyFrame: frame % 60 === 0 });
        video.close();
        state.frame = frame + 1;
        while (encoder.encodeQueueSize > 4) await yieldToEvents();
        await yieldToEvents();
      }
      await encoder.flush();
      encoder.close();
      muxer.finalize();
      const { buffer } = muxer.target;
      state.bytes = buffer.byteLength;
      state.status = 'saving';
      const res = await fetch('/__film/save', { method: 'POST', body: buffer });
      if (!res.ok) throw new Error(`save failed: HTTP ${res.status}`);
      state.file = (await res.json()).file;
      state.status = 'done';
    } catch (e) {
      state.status = 'error';
      state.error = String(e?.message ?? e);
      console.error(e);
    }
    return state;
  }

  window.film = { state, renderFrame, record, fps: FPS };
  renderFrame(0);
}
