import * as THREE from 'three';

const limb = (radius, length) => {
  const g = new THREE.CapsuleGeometry(radius, length, 2, 7);
  g.translate(0, -length / 2, 0);
  return g;
};
const GEO = {
  torso: new THREE.CapsuleGeometry(0.175, 0.3, 3, 8).translate(0, 0.27, 0),
  puff: new THREE.TorusGeometry(0.18, 0.028, 5, 12).rotateX(Math.PI / 2),
  zip: new THREE.BoxGeometry(0.018, 0.42, 0.012),
  head: new THREE.SphereGeometry(0.112, 10, 8),
  hair: new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.56),
  upperArm: limb(0.062, 0.25), foreArm: limb(0.05, 0.23), hand: new THREE.SphereGeometry(0.05, 6, 5),
  thigh: limb(0.08, 0.36), shin: limb(0.06, 0.37), shoe: new THREE.BoxGeometry(0.1, 0.07, 0.25),
  phone: new THREE.BoxGeometry(0.07, 0.14, 0.012),
};
const materials = new Map();
const mat = (hex, roughness = 0.82) => {
  const key = `${hex}|${roughness}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness }));
  return materials.get(key);
};
const rng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const pick = (r, list) => list[Math.floor(r() * list.length)];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bump = (a, b, c, x) => smooth(a, b, x) * (1 - smooth(b, c, x));

const SKIN = ['#e9c4a2', '#dfb592', '#f0cfae', '#d6a884'];
const HAIR = ['#17120f', '#241a14', '#3b2a1f', '#0f0f12', '#5a3b25'];
const PANTS = ['#20283a', '#2b2b30', '#3f4552', '#171a22', '#5b5146'];
const TOPS = ['#e7e4da', '#2c2f36', '#8d8f94', '#b59a6e', '#55644a', '#d9c8a8', '#3a3f4a', '#f2eee4'];

export class Person {
  constructor({ jacket, pants, seed = 1, puffer = false, scale }) {
    const r = rng(seed * 7919 + 13);
    const skin = mat(pick(r, SKIN), 0.7);
    const top = mat(jacket, puffer ? 0.55 : 0.85);
    const bottom = mat(pants ?? pick(r, PANTS));
    const part = (geo, m, parent, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const pivot = (parent, x, y, z = 0) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };
    this.root = new THREE.Group();
    this.root.scale.setScalar(scale ?? 0.95 + r() * 0.1);
    this.hips = pivot(this.root, 0, 0.9);
    this.spine = pivot(this.hips, 0, 0);
    part(GEO.torso, top, this.spine);
    if (puffer) {
      for (const y of [0.12, 0.26, 0.4]) part(GEO.puff, top, this.spine, 0, y, 0);
      part(GEO.zip, mat('#e8e8e8', 0.4), this.spine, 0, 0.27, 0.185);
    }
    this.head = pivot(this.spine, 0, 0.6);
    part(GEO.head, skin, this.head, 0, 0.06);
    const hair = part(GEO.hair, mat(pick(r, HAIR), 0.9), this.head, 0, 0.075, -0.012);
    hair.rotation.x = -0.25;
    const armSide = (s) => {
      const upper = pivot(this.spine, 0.225 * s, 0.47);
      part(GEO.upperArm, top, upper);
      const fore = pivot(upper, 0, -0.33);
      part(GEO.foreArm, top, fore);
      const hand = part(GEO.hand, skin, fore, 0, -0.3);
      return { upper, fore, hand };
    };
    const legSide = (s) => {
      const thigh = pivot(this.hips, 0.095 * s, -0.02);
      part(GEO.thigh, bottom, thigh);
      const shin = pivot(thigh, 0, -0.44);
      part(GEO.shin, bottom, shin);
      part(GEO.shoe, mat('#d8d8d4', 0.7), shin, 0, -0.44, 0.05);
      return { thigh, shin };
    };
    this.armL = armSide(1);
    this.armR = armSide(-1);
    this.legL = legSide(1);
    this.legR = legSide(-1);
  }

  place(x, y, z, rotY) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = rotY;
  }

  rest() {
    this.hips.position.y = 0.9;
    this.hips.rotation.set(0, 0, 0);
    this.spine.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    for (const a of [this.armL, this.armR]) { a.upper.rotation.set(0, 0, 0); a.fore.rotation.set(0, 0, 0); }
    for (const l of [this.legL, this.legR]) { l.thigh.rotation.set(0, 0, 0); l.shin.rotation.set(0, 0, 0); }
  }

  walkPose(phase, amount = 1) {
    this.rest();
    const s = Math.sin(phase);
    this.legL.thigh.rotation.x = -s * 0.55 * amount;
    this.legR.thigh.rotation.x = s * 0.55 * amount;
    this.legL.shin.rotation.x = Math.max(0, Math.sin(phase + 1.7)) * 0.85 * amount;
    this.legR.shin.rotation.x = Math.max(0, Math.sin(phase + 1.7 + Math.PI)) * 0.85 * amount;
    this.armL.upper.rotation.x = s * 0.5 * amount;
    this.armR.upper.rotation.x = -s * 0.5 * amount;
    this.armL.fore.rotation.x = -0.35;
    this.armR.fore.rotation.x = -0.35;
    this.hips.position.y = 0.9 + Math.abs(Math.cos(phase)) * 0.025;
  }

  stance() {
    this.hips.position.y = 0.85;
    this.legL.thigh.rotation.x = -0.42; this.legL.shin.rotation.x = 0.6;
    this.legR.thigh.rotation.x = 0.28; this.legR.shin.rotation.x = 0.35;
    this.spine.rotation.x = 0.12;
  }

  guard() {
    for (const a of [this.armL, this.armR]) { a.upper.rotation.x = -1.05; a.fore.rotation.x = -1.85; }
    this.armL.upper.rotation.z = -0.15;
    this.armR.upper.rotation.z = 0.15;
  }

  filming(sway) {
    this.rest();
    this.armR.upper.rotation.x = -1.5;
    this.armR.fore.rotation.x = -0.75;
    this.armL.upper.rotation.x = 0.05;
    this.spine.rotation.z = Math.sin(sway) * 0.03;
    this.head.rotation.x = -0.05;
  }
}

function addPhone(person) {
  const phone = new THREE.Mesh(GEO.phone, mat('#16181c', 0.3));
  phone.position.set(0, -0.34, 0.02);
  phone.rotation.x = 0.5;
  person.armR.fore.add(phone);
}

// ------------------------------------------------------------------ the brawl
function createBrawl(scene, heights, centre) {
  const pairs = [];
  const r = rng(404);
  const positions = [];
  while (positions.length < 10) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 5.4;
    const p = [centre[0] + Math.cos(a) * d, centre[1] + Math.sin(a) * d];
    if (positions.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 2.1)) positions.push(p);
  }
  positions.forEach((p, i) => {
    const blue = new Person({ jacket: '#1f55c8', seed: 100 + i, puffer: true });
    const red = new Person({ jacket: '#c8201f', seed: 200 + i, puffer: true });
    scene.add(blue.root, red.root);
    pairs.push({
      blue, red, x: p[0], z: p[1], ang: r() * Math.PI * 2, off: r() * 7,
      speed: 0.85 + r() * 0.5, kind: i % 5 === 3 ? 'kick' : i % 5 === 1 ? 'grapple' : 'punch',
    });
  });
  const crowd = [];
  for (let i = 0; i < 14; i++) {
    // The camera passes on the east side, so onlookers only fill the other arc.
    const a = 1.2 + (i / 13) * 3.9;
    const d = 7.6 + r() * 1.3;
    const p = new Person({ jacket: pick(r, TOPS), seed: 300 + i });
    addPhone(p);
    scene.add(p.root);
    crowd.push({ p, x: centre[0] + Math.cos(a) * d, z: centre[1] + Math.sin(a) * d, off: r() * 5 });
  }

  const fighter = (me, x, z, face, isAttacker, kind, f, handRight, y) => {
    me.rest();
    me.stance();
    me.guard();
    const e = bump(0.26, 0.42, 0.62, f);
    const hit = bump(0.4, 0.52, 0.86, f);
    let shift = 0;
    if (isAttacker) {
      const arm = handRight ? me.armR : me.armL;
      if (kind === 'kick') {
        me.legL.thigh.rotation.x = -1.4 * e;
        me.legL.shin.rotation.x = 0.7 * (1 - e) + 0.1;
        me.spine.rotation.x = 0.12 - 0.34 * e;
        me.hips.position.y = 0.85 + 0.03 * e;
      } else {
        arm.upper.rotation.x = -1.05 - 0.55 * e;
        arm.fore.rotation.x = -1.85 + 1.75 * e;
        me.spine.rotation.y = (handRight ? 1 : -1) * 0.5 * e;
        me.spine.rotation.x = 0.12 + 0.2 * e;
        shift = 0.17 * e;
      }
    } else {
      me.spine.rotation.x = 0.12 - 0.48 * hit;
      me.head.rotation.x = -0.5 * hit;
      me.head.rotation.y = 0.35 * hit * (handRight ? 1 : -1);
      shift = -0.26 * hit;
    }
    me.place(x + Math.sin(face) * shift, y, z + Math.cos(face) * shift, face);
  };

  return (t) => {
    for (const pair of pairs) {
      const y = heights(pair.x, pair.z) + 0.24;
      if (pair.kind === 'grapple') {
        const ang = pair.ang + t * 1.1;
        for (const [me, s] of [[pair.blue, 1], [pair.red, -1]]) {
          const px = pair.x + Math.sin(ang) * 0.36 * s;
          const pz = pair.z + Math.cos(ang) * 0.36 * s;
          me.walkPose(t * 7 + pair.off, 0.55);
          me.spine.rotation.x = 0.42;
          me.head.rotation.x = -0.3;
          for (const a of [me.armL, me.armR]) { a.upper.rotation.x = -1.35; a.fore.rotation.x = -0.65; }
          me.place(px, y, pz, Math.atan2(pair.x - px, pair.z - pz));
        }
        continue;
      }
      const c = t * pair.speed + pair.off;
      const idx = Math.floor(c);
      const f = c - idx;
      const ang = pair.ang + Math.sin(t * 0.45 + pair.off) * 0.5;
      const dx = Math.sin(ang);
      const dz = Math.cos(ang);
      const sep = 0.43;
      const blueAttacks = idx % 2 === 0;
      const right = idx % 4 < 2;
      fighter(pair.blue, pair.x - dx * sep, pair.z - dz * sep, ang, blueAttacks, pair.kind, f, right, y);
      fighter(pair.red, pair.x + dx * sep, pair.z + dz * sep, ang + Math.PI, !blueAttacks, pair.kind, f, right, y);
    }
    for (const c of crowd) {
      c.p.filming(t * 1.4 + c.off);
      c.p.place(c.x, heights(c.x, c.z) + 0.24, c.z, Math.atan2(centre[0] - c.x, centre[1] - c.z));
    }
  };
}

// ------------------------------------------------------------------ the busker
function createBusker(scene, heights, spot) {
  const r = rng(77);
  const busker = new Person({ jacket: '#2f2a26', seed: 500, pants: '#1b2230', scale: 1 });
  scene.add(busker.root);
  const faceAngle = Math.PI / 2;
  const y = heights(spot[0], spot[1]) + 0.24;
  busker.place(spot[0], y, spot[1], faceAngle);

  const guitar = new THREE.Group();
  const wood = mat('#b77a3a', 0.45);
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 16).rotateX(Math.PI / 2), wood);
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.09, 16).rotateX(Math.PI / 2), wood);
  upper.position.set(0.22, 0, 0);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.055, 14), mat('#120d09', 0.9));
  hole.position.set(0.12, 0, 0.047);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.05, 0.03), mat('#3b2717', 0.5));
  neck.position.set(0.62, 0, 0.03);
  const headstock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.03), mat('#2b1b10', 0.5));
  headstock.position.set(0.94, 0, 0.03);
  guitar.add(lower, upper, hole, neck, headstock);
  guitar.traverse((o) => { o.castShadow = true; });
  guitar.position.set(-0.08, 0.2, 0.22);
  guitar.rotation.z = 0.5;
  busker.spine.add(guitar);

  const propAt = (geo, material, offX, propY, offZ) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(spot[0] + offX, y + propY, spot[1] + offZ);
    m.castShadow = true;
    scene.add(m);
    return m;
  };
  propAt(new THREE.BoxGeometry(0.5, 0.6, 0.32), mat('#17181b', 0.6), -0.2, 0.3, 1.1);
  propAt(new THREE.BoxGeometry(0.34, 0.34, 0.01).translate(0, 0, 0.165), mat('#55585e', 0.8), -0.2, 0.32, 1.1).rotation.y = 0.6;
  propAt(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 6), mat('#202020', 0.35), 0.62, 0.75, 0);
  propAt(new THREE.CylinderGeometry(0.16, 0.2, 0.03, 12), mat('#202020', 0.5), 0.62, 0.02, 0);
  propAt(new THREE.SphereGeometry(0.045, 8, 6), mat('#8a8a8a', 0.3), 0.55, 1.52, 0);
  propAt(new THREE.BoxGeometry(0.42, 0.06, 1.05), mat('#1d1712', 0.7), 1.25, 0.03, -0.25);
  propAt(new THREE.BoxGeometry(0.36, 0.02, 0.96), mat('#8a2c33', 0.95), 1.25, 0.065, -0.25);

  const audience = [];
  for (let i = 0; i < 9; i++) {
    // Two wings either side of the busker keep the line of sight from the road open.
    const wing = i % 2 === 0 ? 1 : -1;
    const a = wing * (0.62 + (i / 8) * 0.75);
    const d = 3 + r() * 1.1;
    const p = new Person({ jacket: pick(r, TOPS), seed: 600 + i });
    if (i % 3 === 0) addPhone(p);
    scene.add(p.root);
    const x = spot[0] + Math.cos(a) * d;
    const z = spot[1] + Math.sin(a) * d;
    audience.push({ p, x, z, off: r() * 6, phone: i % 3 === 0 });
  }

  return (t) => {
    busker.rest();
    const beat = t * 4.2;
    busker.spine.rotation.z = Math.sin(t * 2.1) * 0.05;
    busker.head.rotation.z = Math.sin(t * 2.1 + 0.4) * 0.08;
    busker.head.rotation.x = 0.08 + Math.sin(t * 4.2) * 0.04;
    busker.hips.position.y = 0.9 + Math.sin(t * 4.2) * 0.008;
    busker.armR.upper.rotation.x = -0.72;
    busker.armR.upper.rotation.z = -0.15;
    busker.armR.fore.rotation.x = -0.9 + Math.sin(beat * 2) * 0.26;
    busker.armL.upper.rotation.x = -1.15;
    busker.armL.upper.rotation.z = -0.5;
    busker.armL.fore.rotation.x = -0.65 + Math.sin(t * 1.3) * 0.08;
    busker.legL.thigh.rotation.x = -0.06;
    for (const a of audience) {
      if (a.phone) a.p.filming(t * 1.2 + a.off);
      else {
        a.p.rest();
        a.p.spine.rotation.z = Math.sin(t * 2.1 + a.off) * 0.06;
        a.p.head.rotation.z = Math.sin(t * 2.1 + a.off + 0.5) * 0.08;
        a.p.armL.upper.rotation.x = -0.12;
      }
      a.p.place(a.x, heights(a.x, a.z) + 0.24, a.z, Math.atan2(spot[0] - a.x, spot[1] - a.z));
    }
  };
}

// ------------------------------------------------------------------ the drunk
function createDrunk(scene, heights, spot) {
  const drunk = new Person({ jacket: '#6c7350', seed: 700 });
  const friend = new Person({ jacket: '#d9c8a8', seed: 701 });
  scene.add(drunk.root, friend.root);
  const y = heights(spot[0], spot[1]) + 0.24;
  const facing = -Math.PI / 2;
  drunk.place(spot[0], y, spot[1], facing);

  const puddleGeo = new THREE.CircleGeometry(1, 20);
  const pos = puddleGeo.attributes.position;
  for (let i = 1; i < pos.count; i++) {
    const s = 0.72 + 0.42 * Math.abs(Math.sin(i * 2.3));
    pos.setXY(i, pos.getX(i) * s, pos.getY(i) * s);
  }
  puddleGeo.rotateX(-Math.PI / 2);
  const vomitMat = new THREE.MeshStandardMaterial({ color: '#b6a14a', roughness: 0.3 });
  const puddle = new THREE.Mesh(puddleGeo, vomitMat);
  const puddleX = spot[0] - 0.62;
  const puddleZ = spot[1];
  puddle.position.set(puddleX, y + 0.045, puddleZ);
  scene.add(puddle);
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.038, 0.23, 8), mat('#2e7a4a', 0.2));
  bottle.position.set(spot[0] + 0.3, y + 0.04, spot[1] + 0.5);
  bottle.rotation.z = Math.PI / 2;
  bottle.castShadow = true;
  scene.add(bottle);

  const COUNT = 110;
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.018, 5, 4), vomitMat, COUNT);
  drops.frustumCulled = false;
  scene.add(drops);
  const r = rng(808);
  const seeds = Array.from({ length: COUNT }, () => [r(), (r() - 0.5) * 0.3, (r() - 0.5) * 0.28, 0.6 + r() * 0.9]);
  const matrix = new THREE.Matrix4();
  const headPos = new THREE.Vector3();
  const period = 3.1;

  return (t) => {
    const c = t / period;
    const f = c - Math.floor(c);
    const heave = bump(0.08, 0.26, 0.58, f);
    drunk.rest();
    drunk.hips.position.y = 0.84 + Math.sin(t * 1.2) * 0.01;
    drunk.legL.thigh.rotation.x = -0.34; drunk.legL.shin.rotation.x = 0.42;
    drunk.legR.thigh.rotation.x = -0.3; drunk.legR.shin.rotation.x = 0.4;
    drunk.spine.rotation.x = 1.02 + heave * 0.2 + Math.sin(t * 1.6) * 0.03;
    drunk.spine.rotation.z = Math.sin(t * 0.9) * 0.06;
    drunk.head.rotation.x = -0.28 + heave * 0.2;
    for (const a of [drunk.armL, drunk.armR]) { a.upper.rotation.x = -0.72; a.fore.rotation.x = -0.25; }
    drunk.root.updateMatrixWorld(true);
    drunk.head.getWorldPosition(headPos);
    puddle.scale.setScalar(0.45 + Math.min(0.2, t * 0.002));

    seeds.forEach(([s, sx, sz, v], i) => {
      const window = 0.26;
      const start = 0.14 + s * window;
      const age = (f - start) * period;
      const flight = 0.34;
      if (age < 0 || age > flight) {
        matrix.makeScale(0, 0, 0);
      } else {
        const x = headPos.x - 0.1 - (v * 0.45 + sx * 0.3) * age;
        const py = headPos.y - 0.03 - 0.8 * age - 4.9 * age * age;
        const z = headPos.z + sz * age;
        const size = 0.7 + s;
        matrix.makeScale(size, size, size);
        matrix.setPosition(x, Math.max(y + 0.05, py), z);
      }
      drops.setMatrixAt(i, matrix);
    });
    drops.instanceMatrix.needsUpdate = true;

    friend.rest();
    const fx = spot[0] + 0.1;
    const fz = spot[1] + 0.62;
    friend.place(fx, heights(fx, fz) + 0.24, fz, Math.atan2(spot[0] - fx, spot[1] - fz) + 0.3);
    friend.spine.rotation.x = 0.28;
    friend.head.rotation.x = 0.28;
    friend.armR.upper.rotation.x = -1.05;
    friend.armR.upper.rotation.z = -0.2;
    friend.armR.fore.rotation.x = -0.45 + Math.max(0, Math.sin(t * 7)) * 0.42;
  };
}

// ------------------------------------------------------------------ ordinary pedestrians
function createPedestrians(scene, heights) {
  const r = rng(1234);
  const walkers = [];
  const segments = [[178, 320], [396, 414], [452, 466], [496, 536]];
  const weights = [18, 3, 3, 8];
  segments.forEach(([z0, z1], si) => {
    for (let i = 0; i < weights[si]; i++) {
      const p = new Person({ jacket: pick(r, TOPS), seed: 900 + walkers.length });
      scene.add(p.root);
      walkers.push({
        p, z0, z1, phase: r() * (z1 - z0), speed: 1.1 + r() * 0.45,
        x: r() < 0.5 ? -0.2 + r() * 2.8 : 15 + r() * 3,
        seed: r() * 6,
      });
    }
  });
  return (t) => {
    for (const w of walkers) {
      const span = w.z1 - w.z0;
      const travelled = w.phase + t * w.speed;
      const m = travelled % (span * 2);
      const south = m < span;
      const z = w.z0 + (south ? m : span * 2 - m);
      w.p.walkPose(travelled * 3.9 + w.seed);
      w.p.place(w.x, heights(w.x, z) + 0.24, z, south ? 0 : Math.PI);
    }
  };
}

export function createCast(scene, heights, spots) {
  const updates = [
    createBrawl(scene, heights, spots.brawl),
    createBusker(scene, heights, spots.busker),
    createDrunk(scene, heights, spots.drunk),
    createPedestrians(scene, heights),
  ];
  return (t) => updates.forEach((u) => u(t));
}
