// world.js — the persistent 3D room: geometry, lighting, and the interactive object registry.
import * as THREE from '../vendor/three.module.js';

const T = THREE;

function matStd(color, roughness = 0.85, metalness = 0.0, extra = {}) {
  return new T.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}
function box(w, h, d, mat) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, mat, seg = 20) {
  const m = new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function sph(r, mat, w = 20, h = 14) {
  const m = new T.Mesh(new T.SphereGeometry(r, w, h), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// Procedural canvas textures ---------------------------------------------
function woodTexture(base = '#8a6a4d', lines = '#6f5236') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 44; i++) {
    g.strokeStyle = `rgba(${parseInt(lines.slice(1,3),16)},${parseInt(lines.slice(3,5),16)},${parseInt(lines.slice(5,7),16)},${0.12 + Math.random() * 0.22})`;
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath();
    const y = Math.random() * 512;
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 5 + (Math.random() - 0.5) * 4);
    g.stroke();
  }
  // plank seams
  g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 2;
  for (let y = 0; y < 512; y += 85) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  const tx = new T.CanvasTexture(c);
  tx.wrapS = tx.wrapT = T.RepeatWrapping;
  return tx;
}
function wallTexture(base = '#cfc8bc') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.045})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.4, 1.4);
  }
  // a few faint scuffs — small imperfections
  for (let i = 0; i < 5; i++) {
    g.fillStyle = 'rgba(60,50,40,0.05)';
    g.beginPath(); g.ellipse(Math.random() * 256, 150 + Math.random() * 100, 14, 5, Math.random(), 0, 7); g.fill();
  }
  const tx = new T.CanvasTexture(c);
  tx.wrapS = tx.wrapT = T.RepeatWrapping;
  return tx;
}
function rugTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5c6b8a'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#8fa0c4'; g.lineWidth = 5; g.strokeRect(14, 14, 228, 228);
  g.strokeStyle = '#42506e'; g.lineWidth = 3; g.strokeRect(28, 28, 200, 200);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
  }
  return new T.CanvasTexture(c);
}
function windowViewTexture(mode = 'day') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  if (mode === 'day') { grad.addColorStop(0, '#8ec8f5'); grad.addColorStop(0.62, '#cfe6f7'); grad.addColorStop(0.66, '#9db08a'); grad.addColorStop(1, '#7b9370'); }
  else if (mode === 'evening') { grad.addColorStop(0, '#3b4a7a'); grad.addColorStop(0.5, '#c97f57'); grad.addColorStop(0.66, '#4d5340'); grad.addColorStop(1, '#33392c'); }
  else { grad.addColorStop(0, '#0a0f24'); grad.addColorStop(0.66, '#131a30'); grad.addColorStop(1, '#0c1018'); }
  g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
  // distant buildings
  g.fillStyle = mode === 'night' ? '#1a2136' : 'rgba(60,80,110,0.5)';
  for (let i = 0; i < 9; i++) {
    const w = 30 + Math.random() * 55, h = 60 + Math.random() * 160, x = i * 56;
    g.fillRect(x, 338 - h, w, h);
    if (mode !== 'day') {
      g.fillStyle = 'rgba(255,220,130,0.75)';
      for (let k = 0; k < 12; k++) if (Math.random() < 0.5) g.fillRect(x + 4 + Math.random() * (w - 10), 340 - h + Math.random() * (h - 8), 4, 5);
      g.fillStyle = mode === 'night' ? '#1a2136' : 'rgba(60,80,110,0.5)';
    }
  }
  if (mode === 'night') { g.fillStyle = '#fff'; for (let i = 0; i < 60; i++) g.fillRect(Math.random() * 512, Math.random() * 300, 1.4, 1.4); g.beginPath(); g.fillStyle = '#e8ecf5'; g.arc(400, 80, 26, 0, 7); g.fill(); }
  else if (mode === 'day') { g.fillStyle = 'rgba(255,255,255,0.85)'; for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(60 + i * 105, 70 + (i % 2) * 55, 46, 16, 0, 0, 7); g.fill(); } }
  return new T.CanvasTexture(c);
}

// ==========================================================================
export class World {
  constructor() {
    this.scene = new T.Scene();
    this.scene.background = new T.Color(0x0a0c10);
    this.objects = {};            // id -> record
    this.obstacles = [];          // AABBs for navigation
    this.tweens = [];
    this.falling = [];            // ids under gravity
    this.daylightMode = 'day';
    this.clockT = 0;
    this._buildRoom();
    this._buildLights();
    this._buildFurniture();
    this._buildItems();
  }

  // ---- registry helpers --------------------------------------------------
  register(rec) {
    rec.state = rec.state || {};
    rec.aliases = rec.aliases || [rec.name];
    rec.parentId = rec.parentId || 'world';
    rec.home = rec.home || { pos: rec.mesh.position.toArray(), parentId: rec.parentId };
    this.objects[rec.id] = rec;
    return rec;
  }
  get(id) { return this.objects[id]; }
  addObstacle(cx, cz, w, d) { this.obstacles.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 }); }

  worldPos(rec) {
    const v = new T.Vector3();
    rec.mesh.getWorldPosition(v);
    return v;
  }

  itemsOn(surfaceId) {
    return Object.values(this.objects).filter(o => o.parentId === surfaceId);
  }

  // find a free spot on a surface (world coords)
  dropPoint(surfRec, nearWorldPos = null) {
    const s = surfRec.surface;
    if (!s) return null;
    const occupied = this.itemsOn(surfRec.id).map(o => this.worldPos(o));
    const tryPt = (x, z) => {
      for (const p of occupied) if (Math.hypot(p.x - x, p.z - z) < 0.16) return false;
      return true;
    };
    if (nearWorldPos) {
      for (let r = 0.14; r < 0.6; r += 0.08)
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
          const x = T.MathUtils.clamp(nearWorldPos.x + Math.cos(a) * r, s.minX + 0.06, s.maxX - 0.06);
          const z = T.MathUtils.clamp(nearWorldPos.z + Math.sin(a) * r, s.minZ + 0.06, s.maxZ - 0.06);
          if (tryPt(x, z)) return new T.Vector3(x, s.y, z);
        }
    }
    for (let i = 0; i < 30; i++) {
      const x = s.minX + 0.08 + Math.random() * (s.maxX - s.minX - 0.16);
      const z = s.minZ + 0.08 + Math.random() * (s.maxZ - s.minZ - 0.16);
      if (tryPt(x, z)) return new T.Vector3(x, s.y, z);
    }
    return new T.Vector3((s.minX + s.maxX) / 2, s.y, (s.minZ + s.maxZ) / 2);
  }

  // Re-parent an item mesh into world space at a world position
  placeInWorld(rec, worldPos, parentId = 'world') {
    this.scene.attach(rec.mesh);
    rec.mesh.position.copy(worldPos);
    rec.mesh.rotation.set(0, rec.mesh.rotation.y, 0);
    rec.parentId = parentId;
  }
  // Put an item inside a container (fridge/drawer/trash)
  placeInContainer(rec, contRec) {
    const slot = contRec.containerSlots[this.itemsOn(contRec.id).length % contRec.containerSlots.length];
    const wp = contRec.mesh.localToWorld(slot.clone());
    this.scene.attach(rec.mesh);
    rec.mesh.position.copy(wp);
    rec.parentId = contRec.id;
    // keep item visually inside — parent to container group so door animations carry it
    contRec.mesh.attach(rec.mesh);
  }

  release(rec, vel = null) {
    this.scene.attach(rec.mesh);
    rec.parentId = 'world';
    rec.vel = vel ? vel.clone() : new T.Vector3(0, 0, 0);
    if (!this.falling.includes(rec.id)) this.falling.push(rec.id);
  }

  tween(obj, prop, target, dur, ease = 'inout') {
    this.tweens.push({ obj, prop, from: obj[prop], to: target, t: 0, dur, ease });
  }

  // ---- room shell ----------------------------------------------------------
  _buildRoom() {
    const S = this.scene;
    // floor
    const floorTx = woodTexture(); floorTx.repeat.set(4, 3);
    const floor = new T.Mesh(new T.PlaneGeometry(8, 6), new T.MeshStandardMaterial({ map: floorTx, roughness: 0.6, metalness: 0.05 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    S.add(floor);

    // subtle floor scuffs
    const scuffC = document.createElement('canvas'); scuffC.width = scuffC.height = 128;
    const sg = scuffC.getContext('2d');
    sg.fillStyle = 'rgba(20,14,8,0.5)'; sg.beginPath(); sg.ellipse(64, 64, 50, 22, 0.6, 0, 7); sg.fill();
    const scuff = new T.Mesh(new T.PlaneGeometry(0.5, 0.3), new T.MeshBasicMaterial({ map: new T.CanvasTexture(scuffC), transparent: true, opacity: 0.16, depthWrite: false }));
    scuff.rotation.x = -Math.PI / 2; scuff.position.set(0.8, 0.005, 0.4); S.add(scuff);

    const wallTx = wallTexture(); wallTx.repeat.set(3, 1.4);
    const wallMat = new T.MeshStandardMaterial({ map: wallTx, roughness: 0.95 });
    const H = 2.7;
    const mkWall = (w, x, z, ry) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, H), wallMat);
      m.position.set(x, H / 2, z); m.rotation.y = ry; m.receiveShadow = true;
      S.add(m); return m;
    };
    mkWall(8, 0, -3, 0);            // north
    mkWall(8, 0, 3, Math.PI);       // south
    mkWall(6, -4, 0, Math.PI / 2);  // west
    // east wall has a window hole — build as 4 planes around opening (x=4, opening z in [-0.3,1.5], y in [0.9,2.2])
    const em = wallMat;
    const east = new T.Group();
    const seg = (w, h, y, z) => { const p = new T.Mesh(new T.PlaneGeometry(w, h), em); p.rotation.y = -Math.PI / 2; p.position.set(4, y, z); p.receiveShadow = true; east.add(p); };
    seg(6, 0.9, 0.45, 0);                       // below window (full width strip)
    seg(6, 0.5, 2.45, 0);                       // above window
    seg(2.7, 1.3, 1.55, -1.65);                 // north of window (z -3..-0.3)
    seg(1.5, 1.3, 1.55, 2.25);                  // south of window (z 1.5..3)
    S.add(east);

    // ceiling
    const ceil = new T.Mesh(new T.PlaneGeometry(8, 6), matStd(0xd8d2c8, 0.95));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = H; S.add(ceil);

    // baseboards
    const bbMat = matStd(0xefe9df, 0.7);
    const bb = (w, x, z, ry) => { const m = box(w, 0.1, 0.02, bbMat); m.position.set(x, 0.05, z); m.rotation.y = ry; S.add(m); };
    bb(8, 0, -2.99, 0); bb(8, 0, 2.99, 0); bb(6, -3.99, 0, Math.PI / 2); bb(6, 3.99, 0, Math.PI / 2);

    // window frame + glass + outside view
    const win = new T.Group();
    const frameMat = matStd(0xf2ece2, 0.5);
    const fr = (w, h, d, x, y, z) => { const m = box(w, h, d, frameMat); m.position.set(x, y, z); win.add(m); };
    fr(0.08, 1.34, 0.1, 0, 1.55 - 1.55, -0.92); // will offset below
    win.position.set(3.985, 1.55, 0.6);
    win.rotation.y = -Math.PI / 2;
    win.clear();
    // local coords: window plane spans width 1.8 (z world) x height 1.3
    const mk = (w, h, x, y) => { const m = box(w, h, 0.09, frameMat); m.position.set(x, y, 0); win.add(m); };
    mk(1.9, 0.07, 0, 0.665); mk(1.9, 0.07, 0, -0.665); mk(0.07, 1.4, -0.935, 0); mk(0.07, 1.4, 0.935, 0); mk(0.05, 1.3, 0, 0); mk(1.8, 0.05, 0, 0);
    this.windowViewMat = new T.MeshBasicMaterial({ map: windowViewTexture('day') });
    const view = new T.Mesh(new T.PlaneGeometry(1.8, 1.3), this.windowViewMat);
    view.position.z = -0.18; view.rotation.y = Math.PI; win.add(view);
    const glass = new T.Mesh(new T.PlaneGeometry(1.8, 1.3), new T.MeshPhysicalMaterial({
      color: 0xffffff, transmission: 0.92, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0
    }));
    glass.rotation.y = Math.PI; glass.position.z = -0.02; win.add(glass);
    S.add(win);
    this.windowGroup = win;

    // curtains — two panels sliding along the window
    const curtMat = matStd(0x9b7f6a, 0.9, 0, { side: T.DoubleSide });
    const cw = 1.05, ch = 1.7;
    const mkCurtain = (side) => {
      const g = new T.Group();
      for (let i = 0; i < 6; i++) {
        const fold = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, ch, 8, 1, true, 0, Math.PI), curtMat);
        fold.position.x = -cw / 2 + i * (cw / 5);
        fold.castShadow = true;
        g.add(fold);
      }
      g.position.set(3.93, 1.6, 0.6 + side * 0.55);
      g.rotation.y = -Math.PI / 2;
      g.userData.side = side;
      S.add(g);
      return g;
    };
    const rod = cyl(0.02, 0.02, 2.3, matStd(0x5a4632, 0.4, 0.4)); rod.rotation.x = Math.PI / 2; rod.position.set(3.93, 2.48, 0.6); S.add(rod);
    const curtainL = mkCurtain(-1), curtainR = mkCurtain(1);
    this.register({
      id: 'curtains', name: 'curtains', aliases: ['curtains', 'curtain', 'drapes', 'blinds'],
      kind: 'fixture', mesh: new T.Group(), openable: true, state: { open: true },
      panels: [curtainL, curtainR]
    });
    this._applyCurtains(true, true);

    // door (south wall)
    const doorG = new T.Group();
    const door = box(0.95, 2.1, 0.06, matStd(0x7d5b3f, 0.7));
    door.position.set(0.475, 1.05, 0);
    doorG.add(door);
    const knob = sph(0.035, matStd(0xc9b26a, 0.3, 0.8)); knob.position.set(0.85, 1.02, -0.06); doorG.add(knob);
    doorG.position.set(-2.98, 0, 2.97);
    this.scene.add(doorG);
    const dframe = box(1.1, 2.2, 0.1, matStd(0xefe9df, 0.6)); dframe.position.set(-2.5, 1.1, 2.99); S.add(dframe);
    this.register({
      id: 'door', name: 'door', aliases: ['door', 'front door'], kind: 'fixture',
      mesh: doorG, openable: true, state: { open: false }, doorPivot: doorG
    });

    // pictures on walls (slightly tilted — imperfection)
    const pic = (w, h, x, y, z, ry, hue) => {
      const g = new T.Group();
      const frame = box(w, h, 0.03, matStd(0x3a2e22, 0.5));
      const cc = document.createElement('canvas'); cc.width = 128; cc.height = 96;
      const gg = cc.getContext('2d');
      const gr = gg.createLinearGradient(0, 0, 128, 96);
      gr.addColorStop(0, `hsl(${hue},45%,55%)`); gr.addColorStop(1, `hsl(${hue + 60},40%,30%)`);
      gg.fillStyle = gr; gg.fillRect(0, 0, 128, 96);
      gg.fillStyle = 'rgba(255,255,255,.25)';
      gg.beginPath(); gg.arc(40 + Math.random() * 40, 30 + Math.random() * 30, 18, 0, 7); gg.fill();
      const art = new T.Mesh(new T.PlaneGeometry(w - 0.06, h - 0.06), new T.MeshStandardMaterial({ map: new T.CanvasTexture(cc), roughness: 0.9 }));
      art.position.z = 0.017;
      g.add(frame, art);
      g.position.set(x, y, z); g.rotation.y = ry; g.rotation.z = (Math.random() - 0.5) * 0.03;
      S.add(g); return g;
    };
    pic(0.6, 0.45, -1.2, 1.8, -2.96, 0, 200);
    pic(0.45, 0.6, 0.2, 1.75, -2.96, 0, 30);
    pic(0.5, 0.4, -3.96, 1.7, 1.9, Math.PI / 2, 120);
    this.register({ id: 'pictures', name: 'pictures', aliases: ['pictures', 'picture', 'painting', 'art', 'paintings'], kind: 'decor', mesh: new T.Group() });

    // rug
    const rug = new T.Mesh(new T.PlaneGeometry(2.6, 1.9), new T.MeshStandardMaterial({ map: rugTexture(), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2; rug.rotation.z = 0.02; rug.position.set(-1.5, 0.01, 0.9); rug.receiveShadow = true;
    S.add(rug);
  }

  _applyCurtains(open, instant = false) {
    const rec = this.get('curtains');
    rec.state.open = open;
    for (const p of rec.panels) {
      const side = p.userData.side;
      const targetZ = open ? 0.6 + side * 1.28 : 0.6 + side * 0.48;
      const targetSX = open ? 0.42 : 1.0;
      if (instant) { p.position.z = targetZ; p.scale.x = targetSX; }
      else { this.tween(p.position, 'z', targetZ, 1.4); this.tween(p.scale, 'x', targetSX, 1.4); }
    }
  }

  // ---- lights --------------------------------------------------------------
  _buildLights() {
    const S = this.scene;
    this.hemi = new T.HemisphereLight(0xcfe4ff, 0x3a3025, 0.35);
    S.add(this.hemi);

    this.sun = new T.DirectionalLight(0xfff1dd, 2.2);
    this.sun.position.set(9, 4.5, 1.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -6; this.sun.shadow.camera.right = 6;
    this.sun.shadow.camera.top = 6; this.sun.shadow.camera.bottom = -6;
    this.sun.shadow.bias = -0.0004;
    S.add(this.sun);
    S.add(this.sun.target);
    this.sun.target.position.set(0, 0, 0);

    // ceiling fixture
    const fixture = new T.Group();
    const bowl = new T.Mesh(new T.SphereGeometry(0.18, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), matStd(0xfff6e0, 0.4, 0, { emissive: 0xffe9b8, emissiveIntensity: 0.9 }));
    bowl.rotation.x = Math.PI;
    fixture.add(bowl);
    fixture.position.set(0, 2.66, 0);
    S.add(fixture);
    this.ceilBowlMat = bowl.material;
    this.ceilLight = new T.PointLight(0xffe6c0, 30, 12, 1.8);
    this.ceilLight.position.set(0, 2.45, 0);
    this.ceilLight.castShadow = true;
    this.ceilLight.shadow.mapSize.set(1024, 1024);
    this.ceilLight.shadow.bias = -0.002;
    S.add(this.ceilLight);
    this.register({
      id: 'ceilingLight', name: 'lights', aliases: ['lights', 'light', 'ceiling light', 'the lights'],
      kind: 'appliance', mesh: fixture, toggleable: true, state: { on: true }
    });
  }

  // ---- furniture -------------------------------------------------------------
  _buildFurniture() {
    const S = this.scene;
    const woodTx = woodTexture('#6f523a', '#54402c'); woodTx.repeat.set(1, 1);
    const woodMat = new T.MeshStandardMaterial({ map: woodTx, roughness: 0.65 });
    const darkWood = matStd(0x4a3626, 0.6);
    const fabric = matStd(0x54607a, 0.95);
    const fabricDark = matStd(0x46516a, 0.95);

    // --- couch (facing north/TV) at (-1.5, 1.9)
    const couch = new T.Group();
    const base = box(2.1, 0.42, 0.95, fabric); base.position.y = 0.24; couch.add(base);
    const backR = box(2.1, 0.62, 0.22, fabricDark); backR.position.set(0, 0.72, 0.42); backR.rotation.x = 0.12; couch.add(backR);
    for (const sx of [-1, 1]) { const arm = box(0.24, 0.36, 0.95, fabricDark); arm.position.set(sx * 1.02, 0.6, 0); couch.add(arm); }
    for (let i = 0; i < 3; i++) { const cush = box(0.64, 0.14, 0.8, matStd(0x5d6a86, 0.98)); cush.position.set(-0.66 + i * 0.66, 0.5, -0.03); cush.rotation.y = (Math.random() - 0.5) * 0.04; couch.add(cush); }
    const pillow = box(0.34, 0.3, 0.12, matStd(0xc9a24f, 0.95)); pillow.position.set(-0.75, 0.75, 0.32); pillow.rotation.z = 0.4; pillow.rotation.x = -0.25; couch.add(pillow);
    for (const [sx, sz] of [[-0.95, -0.4], [0.95, -0.4], [-0.95, 0.4], [0.95, 0.4]]) { const leg = cyl(0.03, 0.025, 0.12, darkWood); leg.position.set(sx, 0.06, sz); couch.add(leg); }
    couch.position.set(-1.5, 0, 1.9); couch.rotation.y = Math.PI;
    S.add(couch);
    this.addObstacle(-1.5, 1.9, 2.3, 1.1);
    this.register({
      id: 'couch', name: 'couch', aliases: ['couch', 'sofa'], kind: 'furniture', mesh: couch,
      sittable: { spots: [{ x: -2.1, z: 1.85, ry: Math.PI }, { x: -1.5, z: 1.85, ry: Math.PI }, { x: -0.9, z: 1.85, ry: Math.PI }], seatY: 0.57, approach: { x: -1.5, z: 1.0 } },
      surface: { y: 0.6, minX: -2.3, maxX: -0.7, minZ: 1.6, maxZ: 2.1 }
    });

    // --- coffee table at (-1.5, 0.6)
    const ct = new T.Group();
    const top = box(1.15, 0.05, 0.6, woodMat); top.position.y = 0.42; ct.add(top);
    const shelf2 = box(1.0, 0.03, 0.5, woodMat); shelf2.position.y = 0.16; ct.add(shelf2);
    for (const [sx, sz] of [[-0.52, -0.25], [0.52, -0.25], [-0.52, 0.25], [0.52, 0.25]]) { const leg = box(0.05, 0.42, 0.05, darkWood); leg.position.set(sx, 0.21, sz); ct.add(leg); }
    ct.position.set(-1.5, 0, 0.55); ct.rotation.y = 0.015;
    S.add(ct);
    this.addObstacle(-1.5, 0.55, 1.3, 0.75);
    this.register({
      id: 'coffeeTable', name: 'coffee table', aliases: ['coffee table', 'table', 'small table'],
      kind: 'furniture', mesh: ct, surface: { y: 0.455, minX: -2.02, maxX: -0.98, minZ: 0.3, maxZ: 0.8 }
    });

    // --- TV stand + TV on north wall at (-1.5, -2.7)
    const stand = new T.Group();
    const sbody = box(1.7, 0.45, 0.42, darkWood); sbody.position.y = 0.225; stand.add(sbody);
    stand.position.set(-1.5, 0, -2.7); S.add(stand);
    this.addObstacle(-1.5, -2.7, 1.8, 0.55);
    this.register({
      id: 'tvStand', name: 'tv stand', aliases: ['tv stand', 'media console'], kind: 'furniture', mesh: stand,
      surface: { y: 0.455, minX: -2.3, maxX: -0.7, minZ: -2.85, maxZ: -2.55 }
    });

    const tv = new T.Group();
    const frame = box(1.35, 0.78, 0.05, matStd(0x14161a, 0.35, 0.4)); frame.position.y = 0.39; tv.add(frame);
    this.tvCanvas = document.createElement('canvas'); this.tvCanvas.width = 480; this.tvCanvas.height = 270;
    this.tvTexture = new T.CanvasTexture(this.tvCanvas);
    this.tvMat = new T.MeshBasicMaterial({ map: this.tvTexture, color: 0x0a0a0a });
    const screen = new T.Mesh(new T.PlaneGeometry(1.27, 0.7), this.tvMat);
    screen.position.set(0, 0.39, 0.027); tv.add(screen);
    const foot = box(0.4, 0.03, 0.2, matStd(0x14161a, 0.35, 0.4)); foot.position.y = 0.015; tv.add(foot);
    tv.position.set(-1.5, 0.47, -2.72); S.add(tv);
    this.tvLight = new T.PointLight(0x87a6ff, 0, 5, 2); this.tvLight.position.set(-1.5, 1.0, -2.2); S.add(this.tvLight);
    this.register({
      id: 'tv', name: 'TV', aliases: ['tv', 'television', 'telly'], kind: 'appliance', mesh: tv,
      toggleable: true, state: { on: false, channel: 0 }
    });

    // --- bookshelf north wall (1.2, -2.8)
    const shelf = new T.Group();
    const sh = (y) => { const p = box(1.1, 0.03, 0.3, woodMat); p.position.y = y; shelf.add(p); };
    const side = (x) => { const p = box(0.03, 1.9, 0.3, woodMat); p.position.set(x, 0.95, 0); shelf.add(p); };
    sh(0.05); sh(0.52); sh(0.99); sh(1.46); sh(1.88); side(-0.55); side(0.55);
    const backP = box(1.1, 1.9, 0.02, darkWood); backP.position.set(0, 0.95, -0.14); shelf.add(backP);
    // decorative books rows (static)
    const bookColors = [0x8a3b3b, 0x3b6b8a, 0x6b8a3b, 0xb08a3f, 0x5a4a7a, 0x9a6a4a, 0x476b58];
    for (const y of [0.55, 1.02]) {
      let x = -0.5;
      while (x < 0.28) {
        const w = 0.035 + Math.random() * 0.03, h = 0.26 + Math.random() * 0.12;
        const b = box(w, h, 0.2, matStd(bookColors[Math.floor(Math.random() * bookColors.length)], 0.85));
        b.position.set(x + w / 2, y + h / 2, 0);
        b.rotation.z = Math.random() < 0.12 ? 0.1 : 0;
        shelf.add(b); x += w + 0.006;
      }
    }
    shelf.position.set(1.2, 0, -2.8); S.add(shelf);
    this.addObstacle(1.2, -2.8, 1.25, 0.45);
    this.register({
      id: 'bookshelf', name: 'bookshelf', aliases: ['bookshelf', 'shelf', 'shelves', 'book shelf'],
      kind: 'furniture', mesh: shelf, surface: { y: 1.49, minX: 0.75, maxX: 1.65, minZ: -2.88, maxZ: -2.72 }
    });

    // --- desk against east wall at (3.55, -1.5), chair west of it
    const desk = new T.Group();
    const dtop = box(0.65, 0.04, 1.4, woodMat); dtop.position.y = 0.74; desk.add(dtop);
    for (const [sx, sz] of [[-0.28, -0.62], [0.28, -0.62], [-0.28, 0.62], [0.28, 0.62]]) { const leg = box(0.05, 0.74, 0.05, darkWood); leg.position.set(sx, 0.37, sz); desk.add(leg); }
    const drawerBox = box(0.55, 0.15, 0.45, woodMat); drawerBox.position.set(0, 0.62, 0.4); desk.add(drawerBox);
    desk.position.set(3.55, 0, -1.5); S.add(desk);
    this.addObstacle(3.55, -1.5, 0.8, 1.55);
    this.register({
      id: 'desk', name: 'desk', aliases: ['desk', 'work desk', 'computer desk'], kind: 'furniture', mesh: desk,
      surface: { y: 0.765, minX: 3.3, maxX: 3.82, minZ: -2.15, maxZ: -0.85 }
    });

    const chair = new T.Group();
    const seat = box(0.44, 0.05, 0.44, matStd(0x333a48, 0.8)); seat.position.y = 0.46; chair.add(seat);
    const backC = box(0.42, 0.5, 0.05, matStd(0x333a48, 0.8)); backC.position.set(0, 0.78, 0.21); chair.add(backC);
    const pole = cyl(0.025, 0.025, 0.4, matStd(0x22252c, 0.4, 0.6)); pole.position.y = 0.25; chair.add(pole);
    for (let i = 0; i < 5; i++) { const legA = box(0.26, 0.03, 0.04, matStd(0x22252c, 0.4, 0.6)); legA.position.y = 0.03; legA.rotation.y = i * Math.PI * 2 / 5; legA.position.x = Math.cos(i * Math.PI * 2 / 5) * 0.13; legA.position.z = Math.sin(i * Math.PI * 2 / 5) * 0.13; chair.add(legA); }
    chair.position.set(3.0, 0, -1.5); chair.rotation.y = -Math.PI / 2;
    S.add(chair);
    this.register({
      id: 'chair', name: 'desk chair', aliases: ['chair', 'desk chair', 'office chair'], kind: 'furniture', mesh: chair,
      holdableHeavy: true,
      sittable: { spots: [{ x: 3.0, z: -1.5, ry: -Math.PI / 2 }], seatY: 0.5, approach: { x: 2.5, z: -1.5 } }
    });

    // --- bed southeast (2.8, 2.2), headboard on south wall
    const bed = new T.Group();
    const bframe = box(1.5, 0.25, 2.1, darkWood); bframe.position.y = 0.18; bed.add(bframe);
    const matt = box(1.42, 0.22, 2.0, matStd(0xe8e2d6, 0.95)); matt.position.y = 0.42; bed.add(matt);
    const duvet = box(1.46, 0.1, 1.35, matStd(0x7a8ba8, 0.98)); duvet.position.set(0, 0.55, -0.3); duvet.rotation.y = 0.01; bed.add(duvet);
    const pil1 = box(0.55, 0.12, 0.35, matStd(0xf2eee6, 0.95)); pil1.position.set(-0.33, 0.6, 0.75); pil1.rotation.y = 0.08; bed.add(pil1);
    const pil2 = box(0.55, 0.12, 0.35, matStd(0xf2eee6, 0.95)); pil2.position.set(0.35, 0.6, 0.73); pil2.rotation.y = -0.05; bed.add(pil2);
    const hb = box(1.5, 0.7, 0.08, darkWood); hb.position.set(0, 0.75, 1.05); bed.add(hb);
    bed.position.set(2.9, 0, 1.85); S.add(bed);
    this.addObstacle(2.9, 1.85, 1.65, 2.25);
    this.register({
      id: 'bed', name: 'bed', aliases: ['bed'], kind: 'furniture', mesh: bed,
      sittable: { spots: [{ x: 2.15, z: 1.6, ry: -Math.PI / 2 }], seatY: 0.56, approach: { x: 1.8, z: 1.6 } },
      surface: { y: 0.62, minX: 2.3, maxX: 3.5, minZ: 1.0, maxZ: 2.6 }
    });

    // --- dresser south wall (0.4, 2.8) with a working drawer
    const dresser = new T.Group();
    const dbody = box(1.0, 0.8, 0.45, woodMat); dbody.position.y = 0.4; dresser.add(dbody);
    const drawerG = new T.Group();
    const dface = box(0.9, 0.28, 0.03, darkWood); dface.position.set(0, 0, 0.24); drawerG.add(dface);
    const dknob = sph(0.02, matStd(0xc9b26a, 0.3, 0.8)); dknob.position.set(0, 0, 0.27); drawerG.add(dknob);
    const dtray = new T.Mesh(new T.BoxGeometry(0.86, 0.02, 0.4), woodMat); dtray.position.set(0, -0.12, 0.02); drawerG.add(dtray);
    for (const sx of [-0.43, 0.43]) { const wallD = box(0.02, 0.24, 0.4, woodMat); wallD.position.set(sx, 0, 0.02); drawerG.add(wallD); }
    drawerG.position.set(0, 0.62, 0);
    dresser.add(drawerG);
    const dface2 = box(0.9, 0.28, 0.03, darkWood); dface2.position.set(0, 0.28, 0.24); dresser.add(dface2);
    const dknob2 = sph(0.02, matStd(0xc9b26a, 0.3, 0.8)); dknob2.position.set(0, 0.28, 0.27); dresser.add(dknob2);
    dresser.position.set(0.4, 0, 2.72); dresser.rotation.y = Math.PI;
    S.add(dresser);
    this.addObstacle(0.4, 2.72, 1.15, 0.6);
    this.register({
      id: 'dresser', name: 'dresser', aliases: ['dresser', 'drawers', 'chest of drawers', 'cabinet'],
      kind: 'furniture', mesh: dresser, surface: { y: 0.82, minX: 0.0, maxX: 0.8, minZ: 2.6, maxZ: 2.85 }
    });
    this.register({
      id: 'drawer', name: 'drawer', aliases: ['drawer', 'the drawer', 'top drawer'], kind: 'fixture',
      mesh: drawerG, openable: true, state: { open: false },
      container: true, containerSlots: [new T.Vector3(-0.2, -0.09, 0.05), new T.Vector3(0.1, -0.09, 0.0), new T.Vector3(0.25, -0.09, 0.08)],
      drawerAxis: 'z', drawerOpenOffset: 0.34
    });

    // --- kitchenette: counter along west wall + fridge + cabinets
    const counter = new T.Group();
    const cbody = box(0.6, 0.85, 2.0, matStd(0x8f8f96, 0.55, 0.15)); cbody.position.y = 0.425; counter.add(cbody);
    const ctop = box(0.66, 0.05, 2.06, matStd(0x2e3138, 0.25, 0.35)); ctop.position.y = 0.875; counter.add(ctop);
    // sink
    const sink = new T.Mesh(new T.BoxGeometry(0.4, 0.05, 0.5), matStd(0xb9bec8, 0.25, 0.85)); sink.position.set(0, 0.885, -0.55); counter.add(sink);
    const faucet = new T.Group();
    const fpipe = cyl(0.018, 0.018, 0.25, matStd(0xc9ccd4, 0.2, 0.9)); fpipe.position.y = 0.125; faucet.add(fpipe);
    const fh = cyl(0.015, 0.015, 0.2, matStd(0xc9ccd4, 0.2, 0.9)); fh.rotation.z = Math.PI / 2; fh.position.set(0.08, 0.25, 0); faucet.add(fh);
    faucet.position.set(-0.22, 0.88, -0.55); counter.add(faucet);
    counter.position.set(-3.65, 0, 0.5); S.add(counter);
    this.addObstacle(-3.65, 0.5, 0.8, 2.2);
    this.register({
      id: 'counter', name: 'kitchen counter', aliases: ['counter', 'kitchen counter', 'countertop', 'kitchen'],
      kind: 'furniture', mesh: counter, surface: { y: 0.9, minX: -3.9, maxX: -3.45, minZ: -0.35, maxZ: 1.4 }
    });
    // wall cabinets
    const cab = box(0.4, 0.7, 1.8, woodMat); cab.position.set(-3.78, 1.95, 0.5); S.add(cab);
    const cabDoorL = box(0.03, 0.64, 0.85, darkWood); cabDoorL.position.set(-3.56, 1.95, 0.06); S.add(cabDoorL);
    const cabDoorR = box(0.03, 0.64, 0.85, darkWood); cabDoorR.position.set(-3.56, 1.95, 0.95); S.add(cabDoorR);
    this.register({ id: 'cabinets', name: 'cabinets', aliases: ['cabinets', 'cupboard', 'cupboards'], kind: 'fixture', mesh: cab });

    // fridge
    const fridge = new T.Group();
    const fbody = box(0.75, 1.7, 0.7, matStd(0xd8dde4, 0.35, 0.5)); fbody.position.y = 0.85; fridge.add(fbody);
    // interior visible when open
    const interior = box(0.65, 1.55, 0.55, matStd(0xeef1f5, 0.6)); interior.position.set(0, 0.85, 0.0); fridge.add(interior);
    for (const y of [0.55, 0.95, 1.35]) { const shf = box(0.6, 0.02, 0.5, matStd(0xcfd6de, 0.4)); shf.position.set(0, y, 0.02); fridge.add(shf); }
    const fdoorG = new T.Group();
    const fdoor = box(0.75, 1.7, 0.08, matStd(0xd8dde4, 0.3, 0.55)); fdoor.position.set(0.375, 0.85, 0); fdoorG.add(fdoor);
    const fhandle = box(0.03, 0.5, 0.05, matStd(0x9aa1ab, 0.3, 0.8)); fhandle.position.set(0.72, 1.0, -0.08); fdoorG.add(fhandle);
    fdoorG.position.set(-0.375, 0, 0.39);
    fridge.add(fdoorG);
    fridge.position.set(-3.6, 0, -1.6); fridge.rotation.y = Math.PI / 2;
    S.add(fridge);
    this.addObstacle(-3.6, -1.6, 0.85, 0.85);
    this.register({
      id: 'fridge', name: 'refrigerator', aliases: ['fridge', 'refrigerator', 'freezer'], kind: 'appliance',
      mesh: fridge, openable: true, state: { open: false }, doorPivot: fdoorG,
      container: true, containerSlots: [
        new T.Vector3(-0.15, 0.99, 0.05), new T.Vector3(0.12, 0.99, -0.1), new T.Vector3(0, 0.59, 0.05),
        new T.Vector3(-0.14, 1.39, -0.02), new T.Vector3(0.14, 0.59, -0.12)
      ]
    });

    // trash can near counter end
    const trash = new T.Group();
    const tcan = cyl(0.14, 0.11, 0.4, matStd(0x6a7078, 0.5, 0.4)); tcan.position.y = 0.2; trash.add(tcan);
    trash.position.set(-3.55, 0, 1.85); S.add(trash);
    this.register({
      id: 'trash', name: 'trash can', aliases: ['trash', 'trash can', 'bin', 'garbage', 'rubbish bin'],
      kind: 'fixture', mesh: trash, container: true,
      containerSlots: [new T.Vector3(0, 0.3, 0)]
    });

    // floor lamp near couch
    const lamp = new T.Group();
    const lbase = cyl(0.14, 0.16, 0.03, matStd(0x2a2d33, 0.4, 0.5)); lbase.position.y = 0.015; lamp.add(lbase);
    const lpole = cyl(0.02, 0.02, 1.45, matStd(0x2a2d33, 0.4, 0.5)); lpole.position.y = 0.75; lamp.add(lpole);
    this.lampShadeMat = matStd(0xf5e8cf, 0.8, 0, { emissive: 0xffdf9e, emissiveIntensity: 0 });
    const lshade = cyl(0.13, 0.18, 0.26, this.lampShadeMat); lshade.position.y = 1.55; lamp.add(lshade);
    lamp.position.set(-2.75, 0, 2.35); S.add(lamp);
    this.lampLight = new T.PointLight(0xffd9a0, 0, 6, 2); this.lampLight.position.set(-2.75, 1.55, 2.35); S.add(this.lampLight);
    this.register({
      id: 'lamp', name: 'floor lamp', aliases: ['lamp', 'floor lamp'], kind: 'appliance', mesh: lamp,
      toggleable: true, state: { on: false }
    });

    // plants
    const mkPlant = (x, z, scale = 1) => {
      const g = new T.Group();
      const pot = cyl(0.12 * scale, 0.09 * scale, 0.18 * scale, matStd(0xa96b41, 0.85)); pot.position.y = 0.09 * scale; g.add(pot);
      const soil = cyl(0.11 * scale, 0.11 * scale, 0.02, matStd(0x3a2b1c, 1)); soil.position.y = 0.175 * scale; g.add(soil);
      const leafMat = matStd(0x3f7a3a, 0.8, 0, { side: T.DoubleSide });
      for (let i = 0; i < 7; i++) {
        const leaf = new T.Mesh(new T.ConeGeometry(0.05 * scale, 0.5 * scale, 5), leafMat);
        leaf.position.y = 0.35 * scale;
        leaf.rotation.z = (Math.random() - 0.5) * 1.1;
        leaf.rotation.y = i * 0.9;
        leaf.castShadow = true;
        g.add(leaf);
      }
      g.position.set(x, 0, z);
      S.add(g); return g;
    };
    const plant1 = mkPlant(3.6, -2.7, 1.35);
    this.register({
      id: 'plant', name: 'plant', aliases: ['plant', 'big plant', 'the plant', 'pot plant', 'houseplant'],
      kind: 'plant', mesh: plant1, state: { watered: false }
    });
    const plant2 = mkPlant(-3.7, 1.25, 0.6);
    plant2.position.y = 0.9; // on counter
    this.register({ id: 'plant2', name: 'small plant', aliases: ['small plant', 'little plant'], kind: 'plant', mesh: plant2, parentId: 'counter', state: { watered: false } });

    // boxes near the door
    const bx1 = box(0.4, 0.3, 0.35, matStd(0xb08a5a, 0.95)); bx1.position.set(-3.4, 0.15, 2.55); bx1.rotation.y = 0.2; S.add(bx1);
    const bx2 = box(0.32, 0.26, 0.3, matStd(0xa87f50, 0.95)); bx2.position.set(-3.35, 0.43, 2.5); bx2.rotation.y = -0.12; S.add(bx2);
    const boxes = new T.Group(); boxes.position.set(-3.4, 0, 2.5);
    this.register({ id: 'boxes', name: 'boxes', aliases: ['boxes', 'box', 'cardboard boxes'], kind: 'decor', mesh: boxes });
    this.addObstacle(-3.4, 2.5, 0.6, 0.6);
  }

  // ---- movable items -----------------------------------------------------------
  _buildItems() {
    const S = this.scene;
    const it = (id, name, aliases, mesh, pos, opt = {}) => {
      mesh.position.copy(pos);
      S.add(mesh);
      return this.register({ id, name, aliases, kind: 'item', holdable: true, mesh, ...opt });
    };

    // apple — in fruit bowl on counter
    const bowl = new T.Mesh(new T.SphereGeometry(0.13, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.3), matStd(0x3e5a70, 0.4));
    bowl.scale.y = 0.55; bowl.rotation.x = Math.PI; bowl.position.set(-3.68, 0.955, 0.15); bowl.receiveShadow = true; S.add(bowl);

    const appleG = new T.Group();
    const apple = sph(0.045, matStd(0xc23b2e, 0.45)); apple.scale.y = 0.94; appleG.add(apple);
    const stem = cyl(0.004, 0.004, 0.03, matStd(0x4a3320, 0.9)); stem.position.y = 0.05; stem.rotation.z = 0.2; appleG.add(stem);
    it('apple', 'apple', ['apple', 'the apple', 'red apple'], appleG, new T.Vector3(-3.66, 0.96, 0.12), { parentId: 'counter', grabOffset: 0.045 });

    const bananaG = new T.Group();
    for (let i = 0; i < 4; i++) {
      const segB = cyl(0.016, 0.014, 0.05, matStd(0xdec541, 0.6), 8);
      segB.position.set(Math.sin(i * 0.42) * 0.052, i * 0.028 - 0.03, 0);
      segB.rotation.z = 0.55 - i * 0.28;
      bananaG.add(segB);
    }
    it('banana', 'banana', ['banana', 'the banana'], bananaG, new T.Vector3(-3.72, 0.985, 0.22), { parentId: 'counter', grabOffset: 0.03 });

    // water bottle — in the fridge
    const bottleG = new T.Group();
    const bod = cyl(0.035, 0.035, 0.2, new T.MeshPhysicalMaterial({ color: 0xbfe0f5, transmission: 0.7, transparent: true, opacity: 0.85, roughness: 0.15 })); bod.position.y = 0.1; bottleG.add(bod);
    const cap = cyl(0.018, 0.018, 0.03, matStd(0x2d6fc2, 0.4)); cap.position.y = 0.215; bottleG.add(cap);
    it('water', 'water bottle', ['water', 'water bottle', 'bottle', 'the water'], bottleG, new T.Vector3(0, 0, 0), { grabOffset: 0.1 });

    // cup & plate on counter
    const cupG = new T.Group();
    const cupBody = cyl(0.04, 0.032, 0.1, matStd(0xe8e4dc, 0.35)); cupBody.position.y = 0.05; cupG.add(cupBody);
    const handle = new T.Mesh(new T.TorusGeometry(0.025, 0.007, 8, 14, Math.PI * 1.5), matStd(0xe8e4dc, 0.35));
    handle.position.set(0.045, 0.05, 0); handle.rotation.y = Math.PI / 2; handle.rotation.z = Math.PI / 4; cupG.add(handle);
    it('cup', 'cup', ['cup', 'mug', 'the cup', 'coffee cup', 'glass'], cupG, new T.Vector3(-3.6, 0.9, 0.75), { parentId: 'counter', grabOffset: 0.05 });

    const plateM = cyl(0.11, 0.09, 0.015, matStd(0xf0ece4, 0.3));
    it('plate', 'plate', ['plate', 'dish', 'the plate'], plateM, new T.Vector3(-3.7, 0.908, 1.0), { parentId: 'counter', grabOffset: 0.008 });

    // remote — on the couch cushion
    const remoteG = new T.Group();
    const rb = box(0.05, 0.02, 0.15, matStd(0x1c1e24, 0.5)); remoteG.add(rb);
    for (let i = 0; i < 6; i++) { const btn = cyl(0.006, 0.006, 0.006, matStd(0x555c68, 0.4), 8); btn.position.set((i % 2) * 0.02 - 0.01, 0.012, -0.05 + Math.floor(i / 2) * 0.035); remoteG.add(btn); }
    it('remote', 'remote', ['remote', 'tv remote', 'remote control', 'the remote', 'clicker'], remoteG, new T.Vector3(-0.85, 0.585, 1.85), { parentId: 'couch', grabOffset: 0.012 });

    // phone (Aria's) on coffee table
    const phoneG = new T.Group();
    const ph = box(0.075, 0.012, 0.155, matStd(0x14161c, 0.25, 0.4));
    this.phoneScreenMat = matStd(0x0a0c10, 0.15, 0, { emissive: 0x1a2b40, emissiveIntensity: 0.35 });
    const scr = new T.Mesh(new T.PlaneGeometry(0.066, 0.145), this.phoneScreenMat);
    scr.rotation.x = -Math.PI / 2; scr.position.y = 0.0065;
    phoneG.add(ph, scr);
    it('phone', 'phone', ['phone', 'her phone', 'smartphone', 'cell phone', 'mobile'], phoneG, new T.Vector3(-1.75, 0.47, 0.55), { parentId: 'coffeeTable', grabOffset: 0.007 });

    // laptop on desk
    const lapG = new T.Group();
    const lbase2 = box(0.32, 0.015, 0.23, matStd(0x8d939e, 0.35, 0.6)); lapG.add(lbase2);
    const lidG = new T.Group();
    const lid = box(0.32, 0.012, 0.23, matStd(0x8d939e, 0.35, 0.6)); lid.position.set(0, 0, -0.115); lidG.add(lid);
    this.laptopScreenMat = matStd(0x0b0d12, 0.2, 0, { emissive: 0x2a4a6a, emissiveIntensity: 0 });
    const lscr = new T.Mesh(new T.PlaneGeometry(0.29, 0.2), this.laptopScreenMat);
    lscr.position.set(0, 0.012, -0.113); lscr.rotation.x = -Math.PI / 2; lscr.scale.y = -1;
    lidG.add(lscr);
    lidG.position.set(0, 0.012, 0.115); lidG.rotation.x = -1.85;
    lapG.add(lidG);
    lapG.rotation.y = -Math.PI / 2;
    it('laptop', 'laptop', ['laptop', 'computer', 'the laptop', 'notebook computer', 'pc'], lapG, new T.Vector3(3.6, 0.77, -1.5), {
      parentId: 'desk', toggleable: true, openable: true, state: { on: true, open: true }, lidPivot: lidG, grabOffset: 0.01
    });

    // books (movable) — one on the coffee table, two on the shelf
    const mkBook = (color, w = 0.14, h = 0.03, d = 0.2) => {
      const g = new T.Group();
      const cover = box(w, h, d, matStd(color, 0.7)); g.add(cover);
      const pages = box(w * 0.92, h * 0.72, d * 0.96, matStd(0xf1ead8, 0.95)); pages.position.x = -0.004; g.add(pages);
      return g;
    };
    const b1 = mkBook(0x8a3b3b); b1.rotation.y = 0.4;
    it('book1', 'red book', ['red book', 'book', 'the book', 'novel'], b1, new T.Vector3(-1.2, 0.47, 0.62), { parentId: 'coffeeTable', grabOffset: 0.015 });
    const b2 = mkBook(0x3b6b8a); b2.rotation.y = -0.1;
    it('book2', 'blue book', ['blue book', 'book', 'other book'], b2, new T.Vector3(1.4, 1.505, -2.8), { parentId: 'bookshelf', grabOffset: 0.015 });
    const b3 = mkBook(0x476b58, 0.13, 0.025, 0.18);
    it('book3', 'green book', ['green book', 'book'], b3, new T.Vector3(1.0, 1.5, -2.79), { parentId: 'bookshelf', grabOffset: 0.013 });

    // keys on the dresser
    const keysG = new T.Group();
    const ring = new T.Mesh(new T.TorusGeometry(0.02, 0.004, 8, 16), matStd(0xb8b0a0, 0.3, 0.8)); ring.rotation.x = Math.PI / 2; keysG.add(ring);
    for (let i = 0; i < 2; i++) {
      const key = box(0.012, 0.004, 0.045, matStd(0xcfc49a, 0.35, 0.8));
      key.position.set(0.015 + i * 0.01, 0, 0.03); key.rotation.y = i * 0.5 - 0.2;
      keysG.add(key);
    }
    it('keys', 'keys', ['keys', 'the keys', 'key'], keysG, new T.Vector3(0.25, 0.83, 2.7), { parentId: 'dresser', grabOffset: 0.005 });

    // backpack near desk
    const bpG = new T.Group();
    const bpBody = box(0.3, 0.4, 0.16, matStd(0x365a4a, 0.9)); bpBody.position.y = 0.2; bpG.add(bpBody);
    const bpPocket = box(0.22, 0.2, 0.06, matStd(0x2c4a3c, 0.9)); bpPocket.position.set(0, 0.14, 0.1); bpG.add(bpPocket);
    bpG.rotation.y = 0.7; bpG.rotation.z = 0.12;
    it('backpack', 'backpack', ['backpack', 'bag', 'the backpack'], bpG, new T.Vector3(2.85, 0, -2.35), { grabOffset: 0.2 });

    // shoes near the door
    const mkShoe = (dx) => {
      const g = new T.Group();
      const sole = box(0.09, 0.025, 0.24, matStd(0xe8e4dc, 0.7)); sole.position.y = 0.012; g.add(sole);
      const upper = box(0.085, 0.06, 0.17, matStd(0x88503c, 0.85)); upper.position.set(0, 0.05, -0.02); g.add(upper);
      g.position.x = dx;
      return g;
    };
    const shoesG = new T.Group();
    const shoe1 = mkShoe(0); const shoe2 = mkShoe(0.13); shoe2.rotation.y = 0.35;
    shoesG.add(shoe1, shoe2);
    it('shoes', 'shoes', ['shoes', 'sneakers', 'the shoes'], shoesG, new T.Vector3(-2.15, 0, 2.75), { grabOffset: 0.04 });

    // put water bottle in the fridge initially
    const water = this.get('water');
    this.placeInContainer(water, this.get('fridge'));

    // folded clothes on the bed
    const clothesG = new T.Group();
    for (let i = 0; i < 3; i++) {
      const c = box(0.3, 0.05, 0.22, matStd([0x7a5a8a, 0x4a6a8a, 0x8a7a4a][i], 0.95));
      c.position.y = 0.03 + i * 0.052; c.rotation.y = (Math.random() - 0.5) * 0.2;
      clothesG.add(c);
    }
    it('clothes', 'clothes', ['clothes', 'laundry', 'folded clothes', 'shirts'], clothesG, new T.Vector3(3.15, 0.62, 1.2), { parentId: 'bed', grabOffset: 0.08 });

    // lock in each item's "home" (where tidying returns it) using world coordinates
    for (const rec of Object.values(this.objects)) {
      if (rec.kind !== 'item') continue;
      const wp = new T.Vector3();
      rec.mesh.getWorldPosition(wp);
      rec.home = { pos: [wp.x, wp.y, wp.z], parentId: rec.parentId };
    }
  }

  // ---- interactions ---------------------------------------------------------
  setToggle(id, on) {
    const rec = this.get(id);
    if (!rec) return;
    rec.state.on = on;
    if (id === 'ceilingLight') {
      this.tween(this.ceilLight, 'intensity', on ? 30 : 0, 0.4);
      this.ceilBowlMat.emissiveIntensity = on ? 0.9 : 0.02;
    } else if (id === 'lamp') {
      this.tween(this.lampLight, 'intensity', on ? 12 : 0, 0.4);
      this.lampShadeMat.emissiveIntensity = on ? 0.8 : 0;
    } else if (id === 'tv') {
      this.tvMat.color.set(on ? 0xffffff : 0x0a0a0a);
      this.tween(this.tvLight, 'intensity', on ? 4 : 0, 0.5);
    } else if (id === 'laptop') {
      this.laptopScreenMat.emissiveIntensity = on ? 0.9 : 0;
    }
  }

  setOpen(id, open) {
    const rec = this.get(id);
    if (!rec) return;
    rec.state.open = open;
    if (id === 'fridge') {
      this.tween(rec.doorPivot.rotation, 'y', open ? -1.9 : 0, 0.8);
    } else if (id === 'drawer') {
      this.tween(rec.mesh.position, 'z', open ? rec.drawerOpenOffset : 0, 0.7);
    } else if (id === 'curtains') {
      this._applyCurtains(open);
    } else if (id === 'door') {
      this.tween(rec.doorPivot.rotation, 'y', open ? -1.4 : 0, 1.0);
    } else if (id === 'laptop') {
      this.tween(rec.lidPivot.rotation, 'x', open ? -1.85 : 0, 0.9);
      if (!open) this.setToggle('laptop', false);
    }
  }

  waterPlant(id) {
    const rec = this.get(id);
    if (!rec) return;
    rec.state.watered = true;
    rec.mesh.traverse(o => { if (o.material && o.material.color && o.geometry?.type === 'ConeGeometry') o.material.color.offsetHSL(0, 0.05, 0.02); });
  }

  // daylight by real hour
  setDaylight(hour) {
    let mode = 'day';
    if (hour >= 20 || hour < 6) mode = 'night';
    else if (hour >= 17) mode = 'evening';
    if (mode !== this.daylightMode || !this._litOnce) {
      this._litOnce = true;
      this.daylightMode = mode;
      this.windowViewMat.map = windowViewTexture(mode);
      this.windowViewMat.needsUpdate = true;
    }
    const curtOpen = this.get('curtains').state.open;
    const sunTargets = { day: 2.4, evening: 1.1, night: 0.12 };
    const hemiTargets = { day: 0.4, evening: 0.22, night: 0.09 };
    this.sun.intensity += ((curtOpen ? sunTargets[mode] : sunTargets[mode] * 0.18) - this.sun.intensity) * 0.05;
    this.hemi.intensity += ((curtOpen ? hemiTargets[mode] : hemiTargets[mode] * 0.5) - this.hemi.intensity) * 0.05;
    this.sun.color.set(mode === 'evening' ? 0xffc48a : mode === 'night' ? 0x9db4e8 : 0xfff1dd);
  }

  // ---- TV programme ---------------------------------------------------------
  _drawTV(t) {
    const g = this.tvCanvas.getContext('2d');
    const W = 480, H = 270;
    const ch = this.get('tv').state.channel || 0;
    if (ch === 0) { // news
      g.fillStyle = '#10233c'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#1c3a5e'; g.fillRect(0, 0, W, 40);
      g.fillStyle = '#fff'; g.font = 'bold 22px Arial'; g.fillText('CHANNEL 7 NEWS', 14, 28);
      // anchor
      g.fillStyle = '#c98d6a'; g.beginPath(); g.arc(150, 140, 34, 0, 7); g.fill();
      g.fillStyle = '#334'; g.fillRect(110, 172, 80, 60);
      g.fillStyle = '#25476e'; g.fillRect(250, 80, 200, 120);
      g.fillStyle = '#7fa8d8'; g.font = '13px Arial';
      g.fillText('LIVE', 260, 100);
      g.fillStyle = '#d8b13c'; g.fillRect(0, H - 44, W, 30);
      g.fillStyle = '#111'; g.font = 'bold 16px Arial';
      const ticker = 'BREAKING: LOCAL BAKERY MAKES WORLD\'S LARGEST CROISSANT · WEATHER: SUNNY SPELLS · SPORTS: TWINS WIN 4–2 · ';
      const off = (t * 60) % (g.measureText(ticker).width);
      g.fillText(ticker + ticker, -off, H - 22);
    } else if (ch === 1) { // nature doc
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#7db8e8'); sky.addColorStop(0.6, '#c8e0c8'); sky.addColorStop(1, '#4a7a3a');
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      g.fillStyle = '#e8e4d0';
      const bx = (Math.sin(t * 0.4) * 0.5 + 0.5) * W;
      g.beginPath(); g.ellipse(bx, 90 + Math.sin(t * 2) * 10, 16, 6, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, H - 34, W, 34);
      g.fillStyle = '#eee'; g.font = 'italic 15px Georgia'; g.fillText('…the migration continues at dawn.', 16, H - 12);
    } else { // movie
      g.fillStyle = '#0a0a10'; g.fillRect(0, 0, W, H);
      g.fillStyle = `hsl(${(t * 20) % 360}, 30%, ${18 + Math.sin(t * 3) * 6}%)`;
      g.fillRect(0, 30, W, H - 60);
      g.fillStyle = '#e8d8a0'; g.font = 'bold 18px Georgia';
      g.fillText('MIDNIGHT EXPRESSWAY', 140, H / 2);
    }
    this.tvTexture.needsUpdate = true;
  }

  // ---- per-frame update -------------------------------------------------------
  update(dt, t) {
    this.clockT = t;
    // tweens
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      let k = Math.min(1, tw.t / tw.dur);
      k = k * k * (3 - 2 * k);
      tw.obj[tw.prop] = tw.from + (tw.to - tw.from) * k;
      if (tw.t >= tw.dur) this.tweens.splice(i, 1);
    }
    // gravity for released items
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const rec = this.get(this.falling[i]);
      if (!rec || rec.parentId !== 'world' || !rec.vel) { this.falling.splice(i, 1); continue; }
      rec.vel.y -= 9.8 * dt;
      rec.mesh.position.addScaledVector(rec.vel, dt);
      // land on any surface underneath
      let landed = false;
      const p = rec.mesh.position;
      for (const s of Object.values(this.objects)) {
        if (!s.surface || s.id === rec.id) continue;
        const sf = s.surface;
        if (p.x > sf.minX && p.x < sf.maxX && p.z > sf.minZ && p.z < sf.maxZ && p.y <= sf.y + 0.02 && rec.vel.y < 0 && p.y > sf.y - 0.15) {
          p.y = sf.y; rec.parentId = s.id; landed = true; break;
        }
      }
      const floorY = rec.grabOffset ?? 0.03;
      if (!landed && p.y <= floorY) {
        p.y = floorY;
        if (Math.abs(rec.vel.y) > 1.2) { rec.vel.y = -rec.vel.y * 0.25; rec.vel.x *= 0.5; rec.vel.z *= 0.5; }
        else landed = true;
      }
      // clamp to room
      p.x = T.MathUtils.clamp(p.x, -3.9, 3.9);
      p.z = T.MathUtils.clamp(p.z, -2.9, 2.9);
      if (landed) { rec.vel = null; this.falling.splice(i, 1); }
    }
    // TV
    if (this.get('tv').state.on && Math.floor(t * 12) !== this._lastTvFrame) {
      this._lastTvFrame = Math.floor(t * 12);
      this._drawTV(t);
      this.tvLight.intensity = 3.2 + Math.sin(t * 7.3) * 0.8 + Math.sin(t * 13.7) * 0.5;
    }
    this.setDaylight(new Date().getHours());
  }

  // ---- state (persistence) ----------------------------------------------------
  serialize() {
    const objs = {};
    const wp = new T.Vector3();
    for (const [id, rec] of Object.entries(this.objects)) {
      rec.mesh.getWorldPosition(wp);
      objs[id] = {
        p: [+wp.x.toFixed(3), +wp.y.toFixed(3), +wp.z.toFixed(3)],
        ry: +rec.mesh.rotation.y.toFixed(3),
        parent: rec.parentId,
        state: rec.state
      };
    }
    return objs;
  }
  deserialize(objs) {
    for (let [id, s] of Object.entries(objs || {})) {
      const rec = this.get(id);
      if (!rec) continue;
      rec.state = { ...rec.state, ...s.state };
      // an item saved mid-carry lands gently on the floor where she stood
      if (s.parent === 'aria') s = { ...s, parent: 'world', p: [s.p[0], rec.grabOffset ?? 0.03, s.p[2]] };
      if (rec.kind === 'item') {
        // detach from any previous parent
        this.scene.attach(rec.mesh);
        rec.parentId = s.parent;
        const contRec = this.objects[s.parent];
        if (contRec && contRec.container) {
          rec.mesh.position.fromArray(s.p);
          contRec.mesh.attach(rec.mesh);
        } else {
          rec.mesh.position.fromArray(s.p);
        }
        rec.mesh.rotation.y = s.ry;
      }
      if (rec.toggleable) this.setToggle(id, !!rec.state.on);
      if (rec.openable) {
        // apply instantly
        this.setOpen(id, !!rec.state.open);
        for (const tw of this.tweens) { tw.t = tw.dur - 0.001; }
      }
      if (rec.kind === 'plant' && rec.state.watered) this.waterPlant(id);
    }
  }
}
