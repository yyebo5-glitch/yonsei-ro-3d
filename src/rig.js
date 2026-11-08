import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const EYE = 1.65;
const WALK = 5;
const RUN = 14;
const smooth = (t) => t * t * (3 - 2 * t);
export const MODES = ['orbit', 'walk', 'fly'];

export class CameraRig {
  constructor(camera, dom, heights, blocked, onModeChange) {
    Object.assign(this, { camera, dom, heights, blocked, onModeChange });
    this.mode = 'orbit';
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 4200;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.flySpeed = 45;
    this.transition = null;
    this.dragging = false;

    addEventListener('keydown', (e) => { if (!e.repeat) this.keys.add(e.code); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('pointerdown', (e) => {
      if (this.mode === 'orbit') return;
      this.dragging = true;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointerup', () => { this.dragging = false; });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging || this.mode === 'orbit') return;
      this.yaw -= e.movementX * 0.0034;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0034, -1.45, 1.45);
    });
    dom.addEventListener('wheel', (e) => {
      if (this.mode === 'fly') this.flySpeed = THREE.MathUtils.clamp(this.flySpeed * (e.deltaY > 0 ? 0.85 : 1.18), 5, 400);
    }, { passive: true });
    dom.addEventListener('dblclick', (e) => this.flyToPointer(e));
  }

  syncAngles() {
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.transition = null;
    this.syncAngles();
    const cam = this.camera.position;
    if (mode === 'orbit') {
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      this.controls.target.copy(cam).addScaledVector(dir, 40);
      this.controls.target.y = Math.max(this.controls.target.y, this.heights(this.controls.target.x, this.controls.target.z));
      this.controls.enabled = true;
      this.controls.update();
    } else {
      this.controls.enabled = false;
      if (mode === 'walk') {
        // Never start the walk inside a footprint.
        for (let r = 0; r < 60 && this.blocked(cam.x, cam.z); r += 2) cam.x += 2;
        cam.y = this.heights(cam.x, cam.z) + EYE;
        this.pitch = 0;
      }
    }
    this.mode = mode;
    this.onModeChange?.(mode);
  }

  cycleMode() {
    this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]);
  }

  goTo(view, instant = false) {
    this.setMode('orbit');
    const pos = new THREE.Vector3(view.pos[0], this.heights(view.pos[0], view.pos[2]) + view.pos[1], view.pos[2]);
    const target = new THREE.Vector3(view.tgt[0], this.heights(view.tgt[0], view.tgt[2]) + view.tgt[1], view.tgt[2]);
    if (instant) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.transition = {
      t: 0, duration: 1.4, fromPos: this.camera.position.clone(), fromTgt: this.controls.target.clone(), pos, target,
    };
  }

  flyToPointer(e) {
    if (this.mode !== 'orbit') return;
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = ray.ray.origin.clone();
    for (let d = 0; d < 5000; d += 4) {
      p.copy(ray.ray.origin).addScaledVector(ray.ray.direction, d);
      if (p.y < this.heights(p.x, p.z)) {
        const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(0.45);
        offset.y = Math.max(offset.y, 8);
        this.transition = {
          t: 0, duration: 1.1, fromPos: this.camera.position.clone(), fromTgt: this.controls.target.clone(),
          pos: p.clone().add(offset), target: p.clone(),
        };
        return;
      }
    }
  }

  axis() {
    const k = this.keys;
    return [
      (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
    ];
  }

  update(dt) {
    const cam = this.camera;
    if (this.transition) {
      const tr = this.transition;
      tr.t = Math.min(1, tr.t + dt / tr.duration);
      const e = smooth(tr.t);
      cam.position.lerpVectors(tr.fromPos, tr.pos, e);
      this.controls.target.lerpVectors(tr.fromTgt, tr.target, e);
      cam.lookAt(this.controls.target);
      if (tr.t >= 1) this.transition = null;
      return;
    }
    if (this.mode === 'orbit') {
      this.controls.update();
      const floor = this.heights(cam.position.x, cam.position.z) + 1.4;
      if (cam.position.y < floor) cam.position.y = floor;
      return;
    }
    const [forward, right] = this.axis();
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (this.mode === 'walk') {
      const fx = -Math.sin(this.yaw); const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw); const rz = -Math.sin(this.yaw);
      let dx = fx * forward + rx * right;
      let dz = fz * forward + rz * right;
      const len = Math.hypot(dx, dz);
      if (len > 0) {
        const step = ((run ? RUN : WALK) * dt) / len;
        dx *= step; dz *= step;
        if (!this.blocked(cam.position.x + dx, cam.position.z)) cam.position.x += dx;
        if (!this.blocked(cam.position.x, cam.position.z + dz)) cam.position.z += dz;
      }
      const ground = this.heights(cam.position.x, cam.position.z) + EYE;
      cam.position.y += (ground - cam.position.y) * Math.min(1, dt * 12);
    } else {
      const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const up = (this.keys.has('KeyE') || this.keys.has('Space') ? 1 : 0) - (this.keys.has('KeyQ') || this.keys.has('KeyC') ? 1 : 0);
      const speed = this.flySpeed * (run ? 3 : 1) * dt;
      cam.position.addScaledVector(dir, forward * speed).addScaledVector(side, right * speed);
      cam.position.y += up * speed;
      cam.position.y = Math.max(cam.position.y, this.heights(cam.position.x, cam.position.z) + 1.2);
    }
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
