// agent.js — Aria's embodied brain: task planning/execution, navigation,
// object manipulation, autonomous life, spontaneous events, offline simulation.
import * as THREE from '../vendor/three.module.js';
const T = THREE;

const WALK_SPEED = 0.85;

export class Agent {
  constructor(world, char, nav, memory) {
    this.world = world;
    this.char = char;
    this.nav = nav;
    this.memory = memory;
    this.queue = [];            // pending actions
    this.current = null;
    this.actionT = 0;
    this.path = null; this.wpIdx = 0;
    this.currentActivity = 'settling in';
    this.activityUntil = 0;
    this.inCall = false;
    this.onSay = null;          // (text, emotion) => void
    this.onActivity = null;     // (desc) => void
    this.lastActivityName = '';
    this.eventTimer = 40 + Math.random() * 80;
    this.sittingOn = null;
    this.playerTask = false;
    this._camPos = null;
  }

  // ============ queue API ============
  enqueue(actions) { this.queue.push(...actions); }
  enqueueFront(actions) { this.queue.unshift(...actions); }
  clearTasks() {
    this.queue.length = 0;
    this.current = null;
    this.playerTask = false;
    this.char.speed = 0;
    this.char.stoop = 0;
    this.char.setLook(null);
    this.char.relaxArm('left');
    this.char.relaxArm('right');
  }
  get busy() { return !!this.current || this.queue.length > 0; }

  say(text, emotion = null) {
    if (emotion) this.char.setEmotion(emotion);
    if (this.onSay) this.onSay(text, emotion);
  }

  setActivity(desc, name = '') {
    this.currentActivity = desc;
    this.lastActivityName = name || desc;
    if (this.onActivity) this.onActivity(desc);
  }

  objPos(id) { return this.world.worldPos(this.world.get(id)); }

  // where to stand to work with an object
  approachPoint(rec) {
    const p = this.world.worldPos(rec);
    if (rec.sittable?.approach) return { x: rec.sittable.approach.x, z: rec.sittable.approach.z };
    // step back toward room center
    const dir = new T.Vector2(-p.x, -p.z);
    if (dir.length() < 0.01) dir.set(0, 1);
    dir.normalize();
    let reach = 0.55;
    // large fixtures need more clearance
    if (['fridge', 'tv', 'bookshelf', 'desk', 'counter', 'dresser', 'window', 'door'].includes(rec.id)) reach = 0.75;
    return { x: p.x + dir.x * reach, z: p.z + dir.y * reach };
  }

  // ============ high-level plan helpers (used by NLU) ============
  planPick(id) {
    const rec = this.world.get(id);
    const acts = [];
    // if inside a closed container, open it first
    const parent = this.world.get(rec.parentId);
    if (parent && parent.container && parent.openable && !parent.state.open) {
      acts.push({ type: 'goToObj', id: parent.id }, { type: 'open', id: parent.id, open: true });
    }
    acts.push({ type: 'goToObj', id }, { type: 'pick', id });
    if (parent && parent.container && parent.openable) acts.push({ type: 'open', id: parent.id, open: false });
    return acts;
  }
  planPlace(id, dest) {
    const acts = [];
    if (dest.kind === 'container') {
      const cont = this.world.get(dest.targetId);
      acts.push({ type: 'goToObj', id: dest.targetId });
      if (cont.openable && !cont.state.open) acts.push({ type: 'open', id: dest.targetId, open: true });
      acts.push({ type: 'place', id, dest });
      if (cont.openable) acts.push({ type: 'open', id: dest.targetId, open: false });
    } else if (dest.kind === 'floor') {
      acts.push({ type: 'place', id, dest });
    } else {
      acts.push({ type: 'goToObj', id: dest.targetId }, { type: 'place', id, dest });
    }
    return acts;
  }

  outOfPlaceItems() {
    const out = [];
    for (const rec of Object.values(this.world.objects)) {
      if (rec.kind !== 'item' || rec.parentId === 'aria') continue;
      const home = rec.home;
      const p = rec.mesh.getWorldPosition(new T.Vector3());
      const d = Math.hypot(p.x - home.pos[0], p.z - home.pos[2]) + Math.abs(p.y - home.pos[1]);
      if (rec.parentId !== home.parentId && d > 0.3) out.push(rec);
      else if (rec.parentId === 'world' && home.parentId !== 'world' && d > 0.3) out.push(rec);
    }
    return out;
  }
  planTidy(limit = 4) {
    const items = this.outOfPlaceItems().slice(0, limit);
    const acts = [];
    for (const rec of items) {
      acts.push(...this.planPick(rec.id));
      const homeParent = this.world.get(rec.home.parentId);
      if (homeParent && homeParent.container) acts.push(...this.planPlace(rec.id, { kind: 'container', targetId: homeParent.id }));
      else if (homeParent && homeParent.surface) acts.push(...this.planPlace(rec.id, { kind: 'surface', targetId: homeParent.id, at: rec.home.pos }));
      else acts.push({ type: 'goTo', x: rec.home.pos[0], z: rec.home.pos[2], range: 0.5 }, { type: 'place', id: rec.id, dest: { kind: 'floor', at: rec.home.pos } });
    }
    return { acts, count: items.length };
  }

  // ============ per-frame ============
  update(dt, t, camPos) {
    this._camPos = camPos;
    const c = this.char;

    if (!this.current && this.queue.length) {
      this.current = this.queue.shift();
      this.actionT = 0;
      this.path = null;
      this._startAction(this.current);
    }

    if (this.current) {
      this.actionT += dt;
      if (this._stepAction(this.current, dt, t)) {
        this.current = null;
        c.speed = 0;
      }
    } else {
      c.speed = 0;
      this._idle(dt, t);
    }

    // spontaneous events
    this.eventTimer -= dt;
    if (this.eventTimer <= 0) {
      this.eventTimer = 70 + Math.random() * 120;
      this._randomEvent();
    }
  }

  // ============ actions ============
  _startAction(a) {
    const w = this.world, c = this.char;
    switch (a.type) {
      case 'goTo': case 'goToObj': {
        let tx, tz;
        if (a.type === 'goToObj') {
          const rec = w.get(a.id);
          const ap = this.approachPoint(rec);
          tx = ap.x; tz = ap.z;
        } else { tx = a.x; tz = a.z; }
        const p = c.root.position;
        if (Math.hypot(tx - p.x, tz - p.z) < (a.range ?? 0.28)) { this.path = []; return; }
        if (this.sittingOn) { this._standNow(); }
        this.path = this.nav.findPath(p.x, p.z, tx, tz);
        this.wpIdx = 0;
        break;
      }
      case 'say':
        this.say(a.text, a.emotion);
        break;
      case 'sit': {
        const rec = w.get(a.id);
        const spot = rec.sittable.spots[Math.floor(Math.random() * rec.sittable.spots.length)];
        a._spot = spot;
        break;
      }
      default: break;
    }
  }

  _standNow() {
    this.char.standUp();
    this.sittingOn = null;
  }

  _faceToward(x, z, dt, rate = 7) {
    const c = this.char;
    const dx = x - c.root.position.x, dz = z - c.root.position.z;
    if (Math.hypot(dx, dz) < 0.02) return true;
    const targetH = Math.atan2(dx, dz);
    let diff = targetH - c.root.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    c.root.rotation.y += diff * Math.min(1, dt * rate);
    return Math.abs(diff) < 0.12;
  }

  // returns true when done
  _stepAction(a, dt, t) {
    const w = this.world, c = this.char;
    switch (a.type) {
      case 'goTo': case 'goToObj': {
        if (!this.path || this.path.length === 0 || this.wpIdx >= this.path.length) { c.speed = 0; return true; }
        const [wx, wz] = this.path[this.wpIdx];
        const p = c.root.position;
        const dx = wx - p.x, dz = wz - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.14) { this.wpIdx++; return this.wpIdx >= this.path.length; }
        this._faceToward(wx, wz, dt, 8);
        const sp = Math.min(WALK_SPEED, dist * 3 + 0.25);
        c.speed = sp;
        p.x += (dx / dist) * sp * dt;
        p.z += (dz / dist) * sp * dt;
        // walking cancels sitting
        if (c.pose === 'sit') { c.standUp(); this.sittingOn = null; }
        return false;
      }

      case 'face': {
        const p = a.point || this.objPos(a.id);
        return this._faceToward(p.x, p.z, dt) || this.actionT > 1.6;
      }

      case 'pick': {
        const rec = w.get(a.id);
        if (!rec) return true;
        const p = this.objPos(a.id);
        this._faceToward(p.x, p.z, dt);
        // crouch/bend by height
        c.stoop = p.y < 0.35 ? 1 : p.y < 0.65 ? 0.45 : 0;
        c.setLook(p);
        if (this.actionT < 0.75) {
          c.reach('right', p);
          return false;
        }
        if (!a._grabbed) {
          a._grabbed = true;
          c.grab('right', rec);
        }
        if (this.actionT > 1.05) {
          c.stoop = 0;
          c.setLook(this.inCall ? null : null);
          return true;
        }
        return false;
      }

      case 'place': {
        const rec = w.get(a.id);
        if (!rec) return true;
        const dest = a.dest;
        let dropPos = null;
        if (dest.kind === 'surface') {
          const surf = w.get(dest.targetId);
          const near = dest.nearId ? this.objPos(dest.nearId) : (dest.at ? new T.Vector3(...dest.at) : null);
          a._drop = a._drop || w.dropPoint(surf, near);
          dropPos = a._drop;
        } else if (dest.kind === 'container') {
          const cont = w.get(dest.targetId);
          dropPos = w.worldPos(cont).add(new T.Vector3(0, 0.6, 0));
        } else { // floor
          const at = dest.at || [c.root.position.x + Math.sin(c.root.rotation.y) * 0.45, 0, c.root.position.z + Math.cos(c.root.rotation.y) * 0.45];
          dropPos = new T.Vector3(at[0], (rec.grabOffset ?? 0.03), at[2]);
          a._drop = dropPos;
        }
        this._faceToward(dropPos.x, dropPos.z, dt);
        c.stoop = dropPos.y < 0.35 ? 1 : dropPos.y < 0.65 ? 0.4 : 0;
        c.setLook(dropPos);
        if (this.actionT < 0.7) { c.reach('right', dropPos.clone().setY(dropPos.y + 0.06)); return false; }
        if (!a._released) {
          a._released = true;
          c.releaseGrab('right');
          if (dest.kind === 'container') w.placeInContainer(rec, w.get(dest.targetId));
          else if (dest.kind === 'surface') { w.placeInWorld(rec, a._drop.clone().setY(a._drop.y + (rec.grabOffset ?? 0.02)), dest.targetId); }
          else w.placeInWorld(rec, a._drop, 'world');
          // a spot the player chose becomes the item's new home — tidying won't undo it
          if (this.playerTask) {
            const nwp = new T.Vector3();
            rec.mesh.getWorldPosition(nwp);
            rec.home = { pos: [nwp.x, nwp.y, nwp.z], parentId: rec.parentId };
          }
        }
        if (this.actionT > 1.0) { c.stoop = 0; c.relaxArm('right'); c.setLook(null); return true; }
        return false;
      }

      case 'push': { // drag a heavy object (chair) to a target point
        const rec = w.get(a.id);
        if (!rec) return true;
        const p = c.root.position;
        const dx = a.x - p.x, dz = a.z - p.z;
        const dist = Math.hypot(dx, dz);
        // lean into it and keep both hands on the object
        const op = this.objPos(a.id);
        c.stoop = 0.35;
        c.reach('right', op.clone().setY(0.75));
        c.reach('left', op.clone().setY(0.75));
        c.setLook(op);
        if (dist < 0.3) {
          c.stoop = 0;
          c.relaxArm('left'); c.relaxArm('right'); c.setLook(null);
          // keep its sittable spot in sync with the new position
          if (rec.sittable) {
            const np = rec.mesh.position;
            rec.sittable.spots[0].x = np.x; rec.sittable.spots[0].z = np.z;
            rec.sittable.approach = { x: np.x - Math.sin(c.root.rotation.y) * 0.5, z: np.z - Math.cos(c.root.rotation.y) * 0.5 };
          }
          this.memory.logEvent(`moved the ${rec.name}`);
          return true;
        }
        this._faceToward(a.x, a.z, dt, 6);
        const sp = Math.min(0.6, dist);
        c.speed = sp * 0.8;
        p.x += (dx / dist) * sp * dt;
        p.z += (dz / dist) * sp * dt;
        // the object slides along just in front of her
        const f = new T.Vector3(Math.sin(c.root.rotation.y), 0, Math.cos(c.root.rotation.y));
        rec.mesh.position.set(
          T.MathUtils.clamp(p.x + f.x * 0.48, -3.8, 3.8), rec.mesh.position.y,
          T.MathUtils.clamp(p.z + f.z * 0.48, -2.8, 2.8));
        return false;
      }

      case 'throw': {
        const rec = w.get(a.id);
        if (!rec || c.heldItem() !== rec) return true;
        const targetP = a.targetId ? this.objPos(a.targetId) : new T.Vector3(c.root.position.x, 0.5, c.root.position.z + 2);
        this._faceToward(targetP.x, targetP.z, dt);
        if (this.actionT < 0.5) { c.reach('right', c.root.localToWorld(new T.Vector3(0.25, 1.6, -0.1))); return false; }
        if (!a._thrown) {
          a._thrown = true;
          c.releaseGrab('right');
          const from = c.gripWorld('right', new T.Vector3());
          w.placeInWorld(rec, from, 'world');
          const dir = targetP.clone().sub(from);
          const dist = dir.length(); dir.normalize();
          const vel = dir.multiplyScalar(Math.min(4, dist * 1.6));
          vel.y = Math.min(3.2, 1.6 + dist * 0.35);
          w.release(rec, vel);
        }
        return this.actionT > 0.9;
      }

      case 'toggle': {
        const rec = w.get(a.id);
        if (!rec) return true;
        const p = this.objPos(a.id);
        this._faceToward(p.x, p.z, dt);
        c.setLook(p);
        if (this.actionT < 0.55) { c.reach('right', p); return false; }
        if (!a._done) { a._done = true; w.setToggle(a.id, a.on); }
        if (this.actionT > 0.85) { c.relaxArm('right'); c.setLook(null); return true; }
        return false;
      }

      case 'open': {
        const rec = w.get(a.id);
        if (!rec) return true;
        const p = this.objPos(a.id);
        this._faceToward(p.x, p.z, dt);
        c.setLook(p);
        if (this.actionT < 0.5) { c.reach(c.heldItem() ? 'left' : 'right', p.clone().setY(Math.max(0.7, Math.min(1.4, p.y + 0.4)))); return false; }
        if (!a._done) { a._done = true; w.setOpen(a.id, a.open); }
        if (this.actionT > 1.0) { c.relaxArm('left'); c.relaxArm('right'); c.setLook(null); return true; }
        return false;
      }

      case 'sit': {
        const rec = w.get(a.id);
        const spot = a._spot;
        this._faceToward(spot.x + Math.sin(spot.ry), spot.z + Math.cos(spot.ry), dt);
        // slide into the seat
        const p = c.root.position;
        p.x += (spot.x - p.x) * Math.min(1, dt * 3);
        p.z += (spot.z - p.z) * Math.min(1, dt * 3);
        let diff = spot.ry - c.root.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
        c.root.rotation.y += diff * Math.min(1, dt * 4);
        if (this.actionT > 0.5) c.sitDown();
        if (this.actionT > 1.2) { this.sittingOn = a.id; return true; }
        return false;
      }

      case 'stand': {
        if (!this.sittingOn && c.pose === 'stand') return true;
        this._standNow();
        // step away
        const rec = this.sittingOn ? w.get(this.sittingOn) : null;
        void rec;
        return this.actionT > 0.7;
      }

      case 'look': {
        let p = null;
        if (a.id === 'window') p = new T.Vector3(3.98, 1.55, 0.6);
        else if (a.id === 'camera') p = this._camPos ? this._camPos.clone() : null;
        else if (a.point) p = a.point;
        else if (a.id) p = this.objPos(a.id);
        if (p) c.setLook(p);
        if (this.actionT >= (a.dur ?? 1.5)) { if (!a.keep) c.setLook(null); return true; }
        return false;
      }

      case 'water': {
        const rec = w.get(a.id);
        const p = this.objPos(a.id);
        this._faceToward(p.x, p.z, dt);
        c.setLook(p);
        const held = c.heldItem();
        if (held) {
          // pour: tip the bottle over the plant
          c.reach('right', p.clone().setY(p.y + 0.35));
          if (this.actionT > 0.7 && !a._done) { a._done = true; w.waterPlant(a.id); this.memory.logEvent(`watered the ${rec.name}`); }
        } else if (!a._done) { a._done = true; w.waterPlant(a.id); }
        if (this.actionT > 1.8) { c.relaxArm('right'); c.setLook(null); return true; }
        return false;
      }

      case 'drink': {
        const hw = c.headWorld(new T.Vector3());
        c.reach('right', hw.clone().add(new T.Vector3(0, -0.05, 0.08)));
        if (this.actionT > 1.6) { c.relaxArm('right'); return true; }
        return false;
      }

      case 'show': { // hold item up toward the camera
        const camP = this._camPos;
        const up = camP ? camP.clone().lerp(c.headWorld(new T.Vector3()), 0.55) : c.root.localToWorld(new T.Vector3(0.1, 1.45, 0.3));
        c.reach('right', up);
        c.setLook(camP || null);
        if (this.actionT > (a.dur ?? 2)) { c.relaxArm('right'); return true; }
        return false;
      }

      case 'gesture':
        if (!a._done) { a._done = true; c.playGesture(a.name); }
        return this.actionT > (a.dur ?? 1.2);

      case 'wait':
        return this.actionT >= a.dur;

      case 'camera': // she aims/flips the phone — handled by the call UI
        if (!a._sent) { a._sent = true; if (this.onCamera) this.onCamera(a); }
        return this.actionT >= (a.dur ?? 0.1);

      case 'setActivity':
        this.setActivity(a.desc, a.name);
        return true;

      case 'emote':
        c.setEmotion(a.emotion);
        return true;

      case 'custom':
        return a.fn(this, dt, t) !== false;

      default:
        return true;
    }
  }

  // ============ idle / autonomous life ============
  _idle(dt, t) {
    const c = this.char;
    if (this.inCall) {
      // attend to the camera
      if (this._camPos) c.setLook(this._camPos);
      return;
    }
    if (t < this.activityUntil) return;
    this._pickAutonomousActivity();
  }

  _pickAutonomousActivity() {
    const w = this.world;
    const options = [];
    const push = (name, weight, fn) => { if (name !== this.lastActivityName) options.push({ name, weight, fn }); };

    push('watchTV', 3, () => {
      this.enqueue([
        { type: 'setActivity', desc: 'about to watch some TV', name: 'watchTV' },
        ...(!w.get('tv').state.on ? [{ type: 'goToObj', id: 'tv' }, { type: 'toggle', id: 'tv', on: true }] : []),
        { type: 'sit', id: 'couch' },
        { type: 'setActivity', desc: 'watching TV on the couch', name: 'watchTV' },
        { type: 'look', id: 'tv', dur: 25 + Math.random() * 30, keep: false },
      ]);
    });
    push('read', 2.5, () => {
      const book = ['book1', 'book2', 'book3'].find(b => w.get(b).parentId !== 'aria');
      if (!book) return false;
      this.enqueue([
        { type: 'setActivity', desc: 'picking out a book', name: 'read' },
        ...this.planPick(book),
        { type: 'sit', id: 'couch' },
        { type: 'setActivity', desc: 'reading on the couch', name: 'read' },
        { type: 'custom', fn: (ag, dt2, t2) => { const p = ag.char.gripWorld('right', new T.Vector3()); ag.char.setLook(p); return (ag._readT = (ag._readT || t2) ) && t2 - ag._readT > 20 + Math.random() * 20 ? (ag._readT = 0, true) : false; } },
        ...this.planPlace(book, { kind: 'surface', targetId: 'coffeeTable' }),
      ]);
    });
    push('laptop', 2.5, () => {
      this.enqueue([
        { type: 'setActivity', desc: 'heading to her desk', name: 'laptop' },
        { type: 'goToObj', id: 'chair' },
        { type: 'sit', id: 'chair' },
        ...(!w.get('laptop').state.on ? [{ type: 'toggle', id: 'laptop', on: true }] : []),
        { type: 'setActivity', desc: 'working on her laptop at the desk', name: 'laptop' },
        { type: 'look', id: 'laptop', dur: 25 + Math.random() * 25 },
      ]);
    });
    push('phoneScroll', 1.6, () => {
      const phone = w.get('phone');
      if (phone.parentId === 'aria') return false;
      this.enqueue([
        { type: 'setActivity', desc: 'checking her phone', name: 'phoneScroll' },
        ...this.planPick('phone'),
        { type: 'sit', id: 'couch' },
        { type: 'custom', fn: (ag, d2, t2) => { const p = ag.char.gripWorld('right', new T.Vector3()); ag.char.setLook(p); ag._phT = ag._phT || t2; if (t2 - ag._phT > 15 + Math.random() * 12) { ag._phT = 0; return true; } return false; } },
        ...this.planPlace('phone', { kind: 'surface', targetId: 'coffeeTable' }),
      ]);
    });
    push('drink', 1.4, () => {
      const water = w.get('water');
      this.enqueue([
        { type: 'setActivity', desc: 'getting some water from the kitchen', name: 'drink' },
        ...this.planPick(water.id),
        { type: 'drink' },
        ...this.planPlace('water', { kind: 'surface', targetId: 'counter' }),
      ]);
      this.memory.logEvent('had a glass of water');
    });
    push('lookOutside', 1.5, () => {
      this.enqueue([
        { type: 'setActivity', desc: 'looking out the window', name: 'lookOutside' },
        { type: 'goTo', x: 3.2, z: 0.6, range: 0.3 },
        { type: 'face', point: new T.Vector3(4, 1.5, 0.6) },
        { type: 'look', id: 'window', dur: 12 + Math.random() * 14 },
      ]);
    });
    push('tidy', this.outOfPlaceItems().length > 0 ? 3.2 : 0, () => {
      const { acts, count } = this.planTidy(2);
      if (!count) return false;
      this.enqueue([{ type: 'setActivity', desc: 'tidying up the room', name: 'tidy' }, ...acts]);
      this.memory.logEvent('tidied up a little');
    });
    push('waterPlants', w.get('plant').state.watered ? 0.3 : 1.4, () => {
      this.enqueue([
        { type: 'setActivity', desc: 'watering the plant', name: 'waterPlants' },
        ...this.planPick('water'),
        { type: 'goToObj', id: 'plant' },
        { type: 'water', id: 'plant' },
        ...this.planPlace('water', { kind: 'surface', targetId: 'counter' }),
      ]);
    });
    push('wander', 1, () => {
      const spots = [[-0.5, 0], [1.8, 0.5], [-2.5, -1.5], [0.5, 1.8], [2.2, -0.5]];
      const [x, z] = spots[Math.floor(Math.random() * spots.length)];
      this.enqueue([
        { type: 'setActivity', desc: 'wandering around the room', name: 'wander' },
        { type: 'goTo', x, z },
        { type: 'wait', dur: 3 + Math.random() * 4 },
      ]);
    });
    push('sitAndThink', 1, () => {
      this.enqueue([
        { type: 'setActivity', desc: 'relaxing on the couch', name: 'sitAndThink' },
        { type: 'sit', id: 'couch' },
        { type: 'gesture', name: 'thinkChin', dur: 2.5 },
        { type: 'wait', dur: 10 + Math.random() * 15 },
      ]);
    });

    const total = options.reduce((s, o) => s + o.weight, 0);
    let r = Math.random() * total;
    for (const o of options) {
      r -= o.weight;
      if (r <= 0) {
        const res = o.fn();
        if (res === false) continue;
        this.activityUntil = 0;
        return;
      }
    }
  }

  // ============ spontaneous events ============
  _randomEvent() {
    const w = this.world;
    const roll = Math.random();
    if (roll < 0.3) {
      // a book slides off the shelf
      const book = ['book2', 'book3'].map(id => w.get(id)).find(b => b.parentId === 'bookshelf');
      if (book) {
        w.release(book, new T.Vector3((Math.random() - 0.5) * 0.4, 0, 0.7 + Math.random() * 0.4));
        this.memory.logEvent('a book slid off the bookshelf and fell on the floor');
        if (!this.busy && !this.inCall) {
          this.enqueue([
            { type: 'emote', emotion: 'surprise' },
            { type: 'setActivity', desc: 'checking what that noise was', name: 'investigate' },
            { type: 'goToObj', id: book.id },
            { type: 'look', id: book.id, dur: 2 },
          ]);
        }
        return;
      }
    }
    if (roll < 0.5) {
      // lights flicker
      if (w.get('ceilingLight').state.on) {
        const base = w.ceilLight.intensity;
        w.tween(w.ceilLight, 'intensity', base * 0.25, 0.12);
        setTimeout(() => w.tween(w.ceilLight, 'intensity', base, 0.3), 300);
        this.memory.logEvent('the ceiling light flickered for a moment');
        if (!this.busy && !this.inCall) this.char.setEmotion('confused');
        return;
      }
    }
    if (roll < 0.7) {
      // her phone buzzes
      w.phoneScreenMat.emissiveIntensity = 1.4;
      setTimeout(() => { w.phoneScreenMat.emissiveIntensity = 0.35; }, 2600);
      this.memory.logEvent('her phone buzzed with a notification');
      if (!this.busy && !this.inCall) {
        const phone = w.get('phone');
        if (phone.parentId !== 'aria') {
          this.enqueue([
            { type: 'emote', emotion: 'curious' },
            { type: 'setActivity', desc: 'checking a notification on her phone', name: 'phoneCheck' },
            { type: 'goToObj', id: 'phone' },
            { type: 'look', id: 'phone', dur: 3 },
          ]);
        }
      }
      return;
    }
    if (roll < 0.85 && w.get('tv').state.on) {
      w.get('tv').state.channel = (w.get('tv').state.channel + 1) % 3;
      this.memory.logEvent('the TV switched programmes');
      return;
    }
    // otherwise: nothing this time
  }

  // ============ offline life simulation ============
  simulateOffline(minutes) {
    const w = this.world;
    const steps = Math.min(10, Math.max(1, Math.floor(minutes / 4)));
    const done = [];
    const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
    for (let i = 0; i < steps; i++) {
      const pick = rand(['tv', 'book', 'water', 'tidy', 'move', 'fruit', 'lamp', 'laptop', 'plant']);
      try {
        if (pick === 'tv') {
          const on = Math.random() < 0.5;
          w.setToggle('tv', on);
          done.push(on ? 'watched some TV' : 'turned the TV off');
        } else if (pick === 'book') {
          const book = ['book1', 'book2', 'book3'].map(id => w.get(id)).find(b => b.parentId === 'bookshelf' || b.parentId === 'coffeeTable');
          if (book) {
            const dest = rand(['couch', 'coffeeTable', 'bed']);
            const dp = w.dropPoint(w.get(dest));
            if (dp) { w.placeInWorld(book, dp.setY(dp.y + (book.grabOffset ?? 0.02)), dest); done.push(`read the ${book.name} for a while (left it on the ${w.get(dest).name})`); }
          }
        } else if (pick === 'water') {
          const water = w.get('water');
          const dest = rand(['counter', 'coffeeTable']);
          const dp = w.dropPoint(w.get(dest));
          if (dp && water.parentId !== 'fridge') { w.placeInWorld(water, dp.setY(dp.y + 0.1), dest); done.push('had some water'); }
          else done.push('got a drink from the fridge');
        } else if (pick === 'tidy') {
          const items = this.outOfPlaceItems();
          if (items.length) {
            const rec = items[0];
            const hp = this.world.get(rec.home.parentId);
            if (hp && hp.container) w.placeInContainer(rec, hp);
            else { w.scene.attach(rec.mesh); rec.mesh.position.fromArray(rec.home.pos); rec.parentId = rec.home.parentId; }
            done.push(`put the ${rec.name} back where it belongs`);
          }
        } else if (pick === 'move') {
          const spots = [[-0.5, 0.2], [1.5, 0.8], [-2.6, -1.2], [2.4, -0.4]];
          const [x, z] = rand(spots);
          this.char.root.position.set(x, 0, z);
          this.char.root.rotation.y = Math.random() * Math.PI * 2;
        } else if (pick === 'fruit') {
          const fruit = rand([w.get('apple'), w.get('banana')]);
          if (fruit.parentId === 'counter' && Math.random() < 0.5) {
            const dp = w.dropPoint(w.get('coffeeTable'));
            if (dp) { w.placeInWorld(fruit, dp.setY(dp.y + (fruit.grabOffset ?? 0.03)), 'coffeeTable'); done.push(`snacked near the ${fruit.name} (left it on the coffee table)`); }
          }
        } else if (pick === 'lamp') {
          const on = Math.random() < 0.5;
          w.setToggle('lamp', on);
          done.push(on ? 'turned the floor lamp on' : 'switched the floor lamp off');
        } else if (pick === 'laptop') {
          w.setToggle('laptop', true);
          done.push('spent some time on her laptop');
        } else if (pick === 'plant') {
          if (!w.get('plant').state.watered) { w.waterPlant('plant'); done.push('watered the big plant'); }
        }
      } catch (e) { /* keep simulating */ }
    }
    // end sitting or standing somewhere sensible
    const endStates = [
      { desc: 'sitting on the couch', act: () => { this.char.root.position.set(-1.5, 0, 1.85); this.char.root.rotation.y = Math.PI; this.char.sitDown(); this.sittingOn = 'couch'; } },
      { desc: 'at her desk', act: () => { this.char.root.position.set(3.0, 0, -1.5); this.char.root.rotation.y = Math.PI / 2; this.char.sitDown(); this.sittingOn = 'chair'; } },
      { desc: 'standing by the window', act: () => { this.char.root.position.set(3.2, 0, 0.6); this.char.root.rotation.y = Math.PI / 2; } },
      { desc: 'in the kitchen', act: () => { this.char.root.position.set(-3.0, 0, 0.5); this.char.root.rotation.y = -Math.PI / 2; } },
    ];
    const end = rand(endStates);
    end.act();
    this.setActivity(end.desc);
    for (const d of done) this.memory.logEvent(d, true);
    return done;
  }
}
