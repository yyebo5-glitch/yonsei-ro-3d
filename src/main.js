import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildCity, createCollider, createHeightField, facadeUniforms } from './city.js';
import { CameraRig, MODES } from './rig.js';

const VIEWS = [
  { name: '정문에서 남쪽 보기', pos: [8, 2.2, -38], tgt: [8, 7, 140] },
  { name: '연세로 거리', pos: [10, 1.7, 215], tgt: [8, 6, 420] },
  { name: '연세로 상공', pos: [-95, 62, 110], tgt: [5, 4, 390] },
  { name: '창천교회', pos: [24, 3, 128], tgt: [78, 13, 141] },
  { name: '신촌로 교차로', pos: [62, 24, 610], tgt: [-6, 3, 500] },
  { name: '서강대 방면', pos: [-40, 110, 1040], tgt: [-90, 20, 1420] },
  { name: '2km 전체 항공', pos: [640, 760, -420], tgt: [0, 20, 980] },
  { name: '남단에서 북쪽', pos: [0, 160, 2260], tgt: [0, 10, 900] },
];
const MODE_LABEL = { orbit: '궤도', walk: '걷기', fly: '비행' };
const MODE_HINT = {
  orbit: '왼쪽 드래그 회전 · 오른쪽 드래그 이동 · 휠 확대 · 더블클릭 지점으로 이동',
  walk: '드래그로 시점 · WASD 이동 · Shift 달리기 · 건물은 통과할 수 없음',
  fly: '드래그로 시점 · WASD 이동 · E/Space 상승 · Q/C 하강 · 휠 속도',
};
const TIMES = {
  day: { label: '낮', el: 52, az: 205, sun: 3.6, sunColor: '#fff3e2', env: 0.16, exposure: 0.5, fog: '#b4c8d8', fogD: 0.00022, night: 0, sign: 0.1, sky: [1.6, 1.1, 0.005, 0.8] },
  golden: { label: '노을', el: 7, az: 262, sun: 3.4, sunColor: '#ffb06a', env: 0.55, exposure: 0.6, fog: '#c7a08c', fogD: 0.00034, night: 0.3, sign: 0.42, sky: [5, 2.2, 0.006, 0.82] },
  night: { label: '밤', el: 38, az: 150, sun: 0.35, sunColor: '#9db6dc', env: 0.5, exposure: 0.85, fog: '#141b29', fogD: 0.00036, night: 1, sign: 0.7, hemi: 2.4, sky: null },
};

const params = new URLSearchParams(location.search);
const loader = document.getElementById('loader');
const loaderText = document.getElementById('loader-text');

async function start() {
  const [world, buffer] = await Promise.all([
    fetch('data/world.json').then((r) => r.json()),
    fetch('data/terrain.bin').then((r) => r.arrayBuffer()),
  ]);
  const heightData = new Float32Array(buffer);
  loaderText.textContent = '도시를 만드는 중…';
  await new Promise((r) => setTimeout(r, 30));

  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: params.has('capture') });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  document.getElementById('scene').append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 50000);
  const heights = createHeightField(world.terrain, world.extent, heightData);
  const { root, signMaterials } = buildCity(world, heights, renderer);
  scene.add(root);

  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 1.4;
  scene.add(sun, sun.target);

  // Continues the ground past the data extent so the map edge fades into the fog.
  const outer = new THREE.Mesh(
    new THREE.CircleGeometry(45000, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial(),
  );
  // Stands in for street lighting after dark: warm light bouncing up from the ground.
  const streetGlow = new THREE.HemisphereLight('#39476a', '#b98a55', 0);
  scene.add(streetGlow);
  outer.position.set(0, 1, 800);
  outer.name = 'outer-ground';
  scene.add(outer);

  const sky = new Sky();
  sky.scale.setScalar(10000);
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  let envTarget = null;
  const sunDir = new THREE.Vector3();
  let timeKey = 'day';
  let shadowFocus = null;
  let shadowRadius = 0;

  function setTime(key) {
    timeKey = key;
    const t = TIMES[key];
    const el = THREE.MathUtils.degToRad(t.el);
    const az = THREE.MathUtils.degToRad(t.az);
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    sun.color.set(t.sunColor);
    sun.intensity = t.sun;
    renderer.toneMappingExposure = t.exposure;
    scene.fog = new THREE.FogExp2(t.fog, t.fogD);
    outer.material.color.set(t.fog);
    streetGlow.intensity = t.hemi ?? 0;
    facadeUniforms.uNight.value = t.night;
    signMaterials.forEach((m) => { m.emissiveIntensity = t.sign; });

    envScene.clear();
    if (t.sky) {
      const [turbidity, rayleigh, mie, g] = t.sky;
      const u = sky.material.uniforms;
      u.turbidity.value = turbidity;
      u.rayleigh.value = rayleigh;
      u.mieCoefficient.value = mie;
      u.mieDirectionalG.value = g;
      u.sunPosition.value.copy(sunDir);
      sky.visible = true;
      scene.background = null;
      const clone = new Sky();
      clone.scale.setScalar(5000);
      clone.material.uniforms = u;
      envScene.background = null;
      envScene.add(clone);
    } else {
      sky.visible = false;
      scene.background = new THREE.Color('#0b1120');
      envScene.background = new THREE.Color('#1a2438');
    }
    envTarget?.dispose();
    envTarget = pmrem.fromScene(envScene, 0, 1, 12000);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = t.env;
    shadowFocus = null;
    document.querySelectorAll('#times button').forEach((b) => b.classList.toggle('on', b.dataset.key === key));
  }

  function updateShadows(focus, distance) {
    const radius = THREE.MathUtils.clamp(distance * 1.25, 170, 2000);
    const moved = !shadowFocus || shadowFocus.distanceTo(focus) > radius * 0.18;
    if (!moved && Math.abs(radius - shadowRadius) < shadowRadius * 0.2) return;
    shadowFocus = focus.clone();
    shadowRadius = radius;
    const c = sun.shadow.camera;
    c.left = -radius; c.right = radius; c.top = radius; c.bottom = -radius;
    c.near = 10; c.far = radius * 2 + 2500;
    c.updateProjectionMatrix();
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(sunDir, radius + 1200);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
  }

  // UI
  const button = (parent, html, onClick, key) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = html;
    if (key) b.dataset.key = key;
    b.addEventListener('click', () => { onClick(); b.blur(); });
    parent.append(b);
    return b;
  };
  const hint = document.getElementById('hint');
  const onMode = (mode) => {
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.key === mode));
    hint.textContent = MODE_HINT[mode];
  };
  const collider = createCollider(world);
  const rig = new CameraRig(camera, renderer.domElement, heights, collider, onMode);

  VIEWS.forEach((v, i) => button(document.getElementById('views'), `${v.name}<kbd>${i + 1}</kbd>`, () => rig.goTo(v)));
  MODES.forEach((m) => button(document.getElementById('modes'), MODE_LABEL[m], () => rig.setMode(m), m));
  Object.entries(TIMES).forEach(([k, t]) => button(document.getElementById('times'), t.label, () => setTime(k), k));
  onMode('orbit');

  const labelHost = document.getElementById('labels');
  const labels = world.labels.map((l) => {
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = l.t;
    labelHost.append(el);
    return { el, p: new THREE.Vector3(l.x, heights(l.x, l.z) + (l.y ?? 0) + 14, l.z) };
  });
  const v = new THREE.Vector3();
  function updateLabels() {
    for (const l of labels) {
      v.copy(l.p).project(camera);
      const d = camera.position.distanceTo(l.p);
      const high = camera.position.y - heights(camera.position.x, camera.position.z) > 90;
      const show = v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && d > 25 && d < (high ? 3200 : 420);
      l.el.style.display = show ? '' : 'none';
      if (show) l.el.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
    }
  }

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key >= '1' && e.key <= String(VIEWS.length)) rig.goTo(VIEWS[Number(e.key) - 1]);
    else if (e.code === 'KeyV') rig.cycleMode();
    else if (e.code === 'KeyT') {
      const keys = Object.keys(TIMES);
      setTime(keys[(keys.indexOf(timeKey) + 1) % keys.length]);
    } else if (e.code === 'KeyH') {
      document.getElementById('ui').classList.toggle('hidden');
      labelHost.classList.toggle('hidden');
    }
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  setTime(TIMES[params.get('time')] ? params.get('time') : 'day');
  rig.goTo(VIEWS[Math.min(VIEWS.length - 1, Math.max(0, Number(params.get('view') ?? 1) - 1))], true);

  const clock = new THREE.Clock();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    rig.update(dt);
    camera.updateMatrixWorld();
    sky.position.copy(camera.position);
    const orbit = rig.mode === 'orbit';
    const focus = orbit ? rig.controls.target : camera.position;
    updateShadows(focus, orbit ? camera.position.distanceTo(focus) : 170);
    renderer.render(scene, camera);
    updateLabels();
  }
  renderer.setAnimationLoop(frame);
  window.city = { renderer, scene, camera, rig, world, heights, setTime, frame };
  if (params.has('film')) {
    const { initFilm } = await import('./film.js');
    initFilm({ renderer, scene, camera, heights, sky, updateShadows, setTime });
  }

  loader.classList.add('done');
  setTimeout(() => loader.remove(), 500);
}

start().catch((e) => {
  console.error(e);
  loader.classList.add('error');
  loaderText.textContent = `불러오지 못했습니다: ${e.message}`;
});
