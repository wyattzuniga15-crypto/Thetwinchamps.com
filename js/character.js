// character.js — Aria's virtual body: stylized-cute humanoid (long dark hair, big
// brown eyes, crop top + shorts + boots), walk cycle, two-bone IK arms, articulated
// fingers, facial animation (blink, brows, jaw lip-sync), breathing, poses, and a
// full set of whole-body gestures (dance, jump, spin, clap, kiss, flex…).
import * as THREE from '../vendor/three.module.js';
const T = THREE;

const SKIN = 0xe3b491, SKIN_SHADE = 0xd3a37f;
const HAIR = 0x2a1d15;
const TOP = 0xf2ead8;        // cream crop top
const SHORTS = 0x9a7b5a;     // tan shorts
const BELT = 0x6b4a30;
const BOOT = 0x8a5a3c;
const SOLE = 0xe8e0d2;

function mat(c, r = 0.75, m = 0) { return new T.MeshStandardMaterial({ color: c, roughness: r, metalness: m }); }
function limb(rTop, rBot, len, material, seg = 10) {
  const g = new T.Mesh(new T.CylinderGeometry(rTop, rBot, len, seg), material);
  g.position.y = -len / 2;
  g.castShadow = true; g.receiveShadow = true;
  return g;
}
function ball(r, material, w = 12, h = 10) {
  const m = new T.Mesh(new T.SphereGeometry(r, w, h), material);
  m.castShadow = true;
  return m;
}

export class Character {
  constructor(scene) {
    this.scene = scene;
    this.root = new T.Group();          // at floor level; faces +Z
    scene.add(this.root);

    this.heading = 0;
    this.speed = 0;
    this.phase = 0;
    this.pose = 'stand';                 // stand | sit
    this.poseBlend = 0;
    this.stoop = 0;                      // 0..1 crouch/bend to reach low objects
    this._stoopB = 0;
    this.mouthLevel = 0;
    this.emotion = 'neutral';
    this.emotionT = 0;
    this.lookTarget = null;
    this.blinkT = 1.5 + Math.random() * 2;
    this.blinkPhase = 0;
    this.breathT = 0;
    this.saccadeT = 0; this.saccade = new T.Vector2();
    this.gesture = null; this.gestureT = 0;
    this._camPos = null;

    this.arm = {
      left:  { mode: 'idle', target: null, grabbed: null, blend: 0, curl: 0 },
      right: { mode: 'idle', target: null, grabbed: null, blend: 0, curl: 0 },
    };

    this._build();
  }

  // ============ construction ============
  _build() {
    const R = this.root;
    const skin = mat(SKIN, 0.6);
    const top = mat(TOP, 0.85);
    const shorts = mat(SHORTS, 0.9);

    // -- pelvis / torso
    this.pelvis = new T.Group(); this.pelvis.position.y = 0.94; R.add(this.pelvis);
    const hipMesh = new T.Mesh(new T.SphereGeometry(0.155, 14, 10), shorts);
    hipMesh.scale.set(1.08, 0.72, 0.82); hipMesh.castShadow = true;
    this.pelvis.add(hipMesh);
    // belt
    const belt = new T.Mesh(new T.CylinderGeometry(0.152, 0.152, 0.045, 16), mat(BELT, 0.6));
    belt.scale.z = 0.8; belt.position.y = 0.075; this.pelvis.add(belt);
    const buckle = new T.Mesh(new T.BoxGeometry(0.05, 0.032, 0.015), mat(0xc9b26a, 0.3, 0.7));
    buckle.position.set(0, 0.075, 0.124); this.pelvis.add(buckle);

    this.spine = new T.Group(); this.spine.position.y = 0.1; this.pelvis.add(this.spine);
    // bare midriff
    const belly = new T.Mesh(new T.CylinderGeometry(0.122, 0.142, 0.22, 14), skin);
    belly.position.y = 0.1; belly.castShadow = true; this.spine.add(belly);

    this.chest = new T.Group(); this.chest.position.y = 0.24; this.spine.add(this.chest);
    const chestMesh = new T.Mesh(new T.CylinderGeometry(0.148, 0.135, 0.24, 14), top);
    chestMesh.position.y = 0.09; chestMesh.scale.z = 0.78; chestMesh.castShadow = true;
    this.chest.add(chestMesh);
    this.chestMesh = chestMesh;
    // crop-top hem
    const hem = new T.Mesh(new T.CylinderGeometry(0.139, 0.146, 0.03, 14), mat(0xe3d9c2, 0.85));
    hem.position.y = -0.025; hem.scale.z = 0.78; this.chest.add(hem);
    // shoulders (bare)
    for (const s of [-1, 1]) {
      const sh = new T.Mesh(new T.SphereGeometry(0.058, 10, 8), skin);
      sh.position.set(s * 0.163, 0.2, 0); sh.castShadow = true; this.chest.add(sh);
      // top strap
      const strap = new T.Mesh(new T.BoxGeometry(0.035, 0.1, 0.02), top);
      strap.position.set(s * 0.09, 0.21, 0.055); strap.rotation.z = s * -0.35; this.chest.add(strap);
    }
    // little pendant necklace
    const chain = new T.Mesh(new T.TorusGeometry(0.055, 0.0035, 6, 20, Math.PI), mat(0xd8c688, 0.3, 0.8));
    chain.position.set(0, 0.2, 0.075); chain.rotation.x = 1.25; chain.rotation.z = Math.PI; this.chest.add(chain);

    // -- neck & head (slightly bigger head — cute proportions)
    this.neck = new T.Group(); this.neck.position.y = 0.235; this.chest.add(this.neck);
    const neckMesh = new T.Mesh(new T.CylinderGeometry(0.044, 0.05, 0.09, 10), skin);
    neckMesh.position.y = 0.03; this.neck.add(neckMesh);

    this.head = new T.Group(); this.head.position.y = 0.09; this.neck.add(this.head);
    const skull = new T.Mesh(new T.SphereGeometry(0.108, 24, 18), skin);
    skull.position.y = 0.088; skull.scale.set(0.95, 1.07, 1.0); skull.castShadow = true;
    this.head.add(skull);
    // jaw / chin
    this.jaw = new T.Group(); this.jaw.position.set(0, 0.045, 0.012); this.head.add(this.jaw);
    const chin = new T.Mesh(new T.SphereGeometry(0.078, 16, 12), skin);
    chin.scale.set(0.84, 0.6, 0.8); chin.position.set(0, -0.012, 0.022);
    this.jaw.add(chin);
    // lips (top lip fixed to the head; bottom lip rides on the jaw)
    const lipMat = mat(0xc06a58, 0.5);
    this.lipTop = new T.Mesh(new T.BoxGeometry(0.038, 0.0068, 0.009), lipMat);
    this.lipTop.position.set(0, 0.031, 0.094); this.head.add(this.lipTop);
    this.lipBot = new T.Mesh(new T.BoxGeometry(0.034, 0.0068, 0.009), lipMat);
    this.lipBot.position.set(0, -0.021, 0.081); this.jaw.add(this.lipBot);
    // mouth interior (revealed when the jaw opens)
    const mouthIn = new T.Mesh(new T.BoxGeometry(0.032, 0.013, 0.008), mat(0x53201f, 0.9));
    mouthIn.position.set(0, 0.0275, 0.088); this.head.add(mouthIn);
    // nose — small and soft
    const nose = new T.Mesh(new T.SphereGeometry(0.012, 8, 8), skin);
    nose.scale.set(0.9, 1.0, 1.1); nose.position.set(0, 0.068, 0.102); this.head.add(nose);
    // ears
    for (const s of [-1, 1]) {
      const ear = new T.Mesh(new T.SphereGeometry(0.022, 8, 8), skin);
      ear.scale.set(0.5, 1, 0.7); ear.position.set(s * 0.096, 0.08, 0.005);
      this.head.add(ear);
    }
    // soft blush
    for (const s of [-1, 1]) {
      const blush = new T.Mesh(new T.CircleGeometry(0.016, 12), new T.MeshBasicMaterial({ color: 0xe89a86, transparent: true, opacity: 0.28 }));
      blush.position.set(s * 0.062, 0.055, 0.086); blush.rotation.y = s * 0.5;
      this.head.add(blush);
    }

    // -- eyes: big, warm brown, sparkly
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eg = new T.Group(); eg.position.set(s * 0.041, 0.093, 0.083);
      const sclera = new T.Mesh(new T.SphereGeometry(0.0235, 16, 12), new T.MeshStandardMaterial({ color: 0xfaf7f2, roughness: 0.2 }));
      sclera.scale.set(1, 1.12, 0.7);
      eg.add(sclera);
      const iris = new T.Mesh(new T.CircleGeometry(0.0145, 18), new T.MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.25 }));
      iris.position.z = 0.0168; eg.add(iris);
      const irisRim = new T.Mesh(new T.RingGeometry(0.0135, 0.0155, 18), new T.MeshBasicMaterial({ color: 0x4a2c14 }));
      irisRim.position.z = 0.0169; eg.add(irisRim);
      const pupil = new T.Mesh(new T.CircleGeometry(0.0068, 14), new T.MeshBasicMaterial({ color: 0x140b06 }));
      pupil.position.z = 0.0172; eg.add(pupil);
      const glint = new T.Mesh(new T.CircleGeometry(0.0028, 8), new T.MeshBasicMaterial({ color: 0xffffff }));
      glint.position.set(0.0045, 0.006, 0.0176); eg.add(glint);
      const glint2 = new T.Mesh(new T.CircleGeometry(0.0014, 8), new T.MeshBasicMaterial({ color: 0xffffff }));
      glint2.position.set(-0.004, -0.004, 0.0176); eg.add(glint2);
      const lid = new T.Mesh(new T.SphereGeometry(0.0245, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(SKIN_SHADE, 0.6));
      lid.scale.set(1, 1.1, 0.72); lid.rotation.x = -0.5; eg.add(lid);
      const lidBot = new T.Mesh(new T.SphereGeometry(0.0242, 16, 8, 0, Math.PI * 2, Math.PI / 1.9, Math.PI / 2.6), mat(SKIN_SHADE, 0.6));
      lidBot.scale.set(1, 1.1, 0.72); lidBot.rotation.x = 0.3; eg.add(lidBot);
      // lashes — a thin dark arc above the eye
      const lash = new T.Mesh(new T.TorusGeometry(0.0225, 0.0022, 6, 14, Math.PI * 0.75), mat(0x241a12, 0.8));
      lash.position.z = 0.006; lash.rotation.z = Math.PI * 0.125; lash.scale.set(1, 1.05, 0.6);
      eg.add(lash);
      this.head.add(eg);
      this.eyes.push({ g: eg, lid, lidBot, s });
    }
    // brows — soft, thin
    this.brows = [];
    for (const s of [-1, 1]) {
      const brow = new T.Mesh(new T.BoxGeometry(0.036, 0.0052, 0.01), mat(0x33241a, 0.85));
      brow.position.set(s * 0.041, 0.128, 0.09); brow.rotation.z = s * -0.1;
      this.head.add(brow);
      this.brows.push({ m: brow, s, baseY: 0.128, baseRZ: s * -0.1 });
    }

    // -- hair: long, dark, loose — center part cap + curtains + long back
    const hairMat = mat(HAIR, 0.68);
    const cap = new T.Mesh(new T.SphereGeometry(0.114, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2.02), hairMat);
    cap.position.y = 0.096; cap.rotation.x = -0.1; cap.scale.set(0.99, 1.03, 1.06); this.head.add(cap);
    // volume at the back of the skull
    const backVol = new T.Mesh(new T.SphereGeometry(0.105, 14, 10), hairMat);
    backVol.scale.set(0.95, 1.12, 0.75); backVol.position.set(0, 0.06, -0.055); backVol.castShadow = true; this.head.add(backVol);
    // long swaying locks: side curtains + back panel
    this.hairSway = [];
    const mkLock = (x, z, w, d, len, rz) => {
      const g = new T.Group(); g.position.set(x, 0.06, z);
      const lock = new T.Mesh(new T.BoxGeometry(w, len, d), hairMat);
      lock.position.y = -len / 2 + 0.02; lock.castShadow = true;
      g.add(lock);
      const tip = new T.Mesh(new T.SphereGeometry(w * 0.55, 8, 6), hairMat);
      tip.scale.set(1, 0.7, d / w); tip.position.y = -len + 0.02; g.add(tip);
      g.rotation.z = rz;
      this.head.add(g);
      this.hairSway.push(g);
      return g;
    };
    mkLock(-0.108, -0.005, 0.04, 0.05, 0.34, 0.12);  // left curtain
    mkLock(0.108, -0.005, 0.04, 0.05, 0.34, -0.12);  // right curtain
    mkLock(-0.06, -0.085, 0.055, 0.045, 0.42, 0.05); // back left
    mkLock(0.06, -0.085, 0.055, 0.045, 0.42, -0.05); // back right
    mkLock(0, -0.098, 0.07, 0.04, 0.45, 0);          // back center

    // -- arms (bare skin + brown wrist cuffs)
    this.armL = this._buildArm(-1, skin);
    this.armR = this._buildArm(1, skin);

    // -- legs (bare, shorts at top, boots)
    this.legL = this._buildLeg(-1, skin, shorts);
    this.legR = this._buildLeg(1, skin, shorts);
  }

  _buildArm(side, skin) {
    const L1 = 0.28, L2 = 0.25;
    const shoulder = new T.Group();
    shoulder.position.set(side * 0.185, 0.2, 0);
    this.chest.add(shoulder);
    shoulder.add(limb(0.045, 0.037, L1, skin));

    const elbow = new T.Group(); elbow.position.y = -L1; shoulder.add(elbow);
    elbow.add(ball(0.035, skin));
    elbow.add(limb(0.034, 0.026, L2, skin));
    // wrist cuff (like the reference)
    const cuff = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.035, 10), mat(BELT, 0.7));
    cuff.position.y = -L2 + 0.035; elbow.add(cuff);

    const wrist = new T.Group(); wrist.position.y = -L2; elbow.add(wrist);
    const hand = new T.Group(); wrist.add(hand);
    const palm = new T.Mesh(new T.BoxGeometry(0.052, 0.072, 0.021), skin);
    palm.position.y = -0.036; palm.castShadow = true; hand.add(palm);
    const fingers = [];
    const fw = 0.0102;
    for (let i = 0; i < 4; i++) {
      const fx = (i - 1.5) * 0.0132;
      const seg1 = new T.Group(); seg1.position.set(fx, -0.073, 0);
      const f1 = new T.Mesh(new T.CapsuleGeometry(fw / 2, 0.021, 3, 6), skin);
      f1.position.y = -0.013; seg1.add(f1);
      const seg2 = new T.Group(); seg2.position.y = -0.029; seg1.add(seg2);
      const f2 = new T.Mesh(new T.CapsuleGeometry(fw / 2.15, 0.016, 3, 6), skin);
      f2.position.y = -0.01; seg2.add(f2);
      hand.add(seg1);
      fingers.push({ s1: seg1, s2: seg2 });
    }
    const thumb1 = new T.Group(); thumb1.position.set(-side * 0.029, -0.027, 0.008);
    thumb1.rotation.z = side * 0.9;
    const t1 = new T.Mesh(new T.CapsuleGeometry(0.0063, 0.019, 3, 6), skin); t1.position.y = -0.012; thumb1.add(t1);
    const thumb2 = new T.Group(); thumb2.position.y = -0.026; thumb1.add(thumb2);
    const t2 = new T.Mesh(new T.CapsuleGeometry(0.0058, 0.013, 3, 6), skin); t2.position.y = -0.008; thumb2.add(t2);
    hand.add(thumb1);
    const grip = new T.Group(); grip.position.set(0, -0.072, 0.027); hand.add(grip);

    return { side, L1, L2, shoulder, elbow, wrist, hand, fingers, thumb: { t1: thumb1, t2: thumb2 }, grip };
  }

  _buildLeg(side, skin, shorts) {
    const L1 = 0.42, L2 = 0.42;
    const hip = new T.Group(); hip.position.set(side * 0.088, -0.03, 0); this.pelvis.add(hip);
    hip.add(limb(0.07, 0.052, L1, skin));
    // shorts leg
    const shortLeg = new T.Mesh(new T.CylinderGeometry(0.078, 0.072, 0.17, 12), shorts);
    shortLeg.position.y = -0.085; shortLeg.castShadow = true; hip.add(shortLeg);
    const knee = new T.Group(); knee.position.y = -L1; hip.add(knee);
    knee.add(ball(0.048, skin));
    knee.add(limb(0.048, 0.036, L2, skin));
    // boot shaft
    const shaft = new T.Mesh(new T.CylinderGeometry(0.052, 0.056, 0.16, 12), mat(BOOT, 0.75));
    shaft.position.y = -L2 + 0.075; knee.add(shaft);
    const ankle = new T.Group(); ankle.position.y = -L2; knee.add(ankle);
    const bootMat = mat(BOOT, 0.7);
    const foot = new T.Mesh(new T.BoxGeometry(0.088, 0.06, 0.21), bootMat);
    foot.position.set(0, -0.03, 0.04); foot.castShadow = true; ankle.add(foot);
    const toe = new T.Mesh(new T.SphereGeometry(0.045, 8, 6), bootMat);
    toe.scale.set(0.95, 0.64, 0.9); toe.position.set(0, -0.042, 0.14); ankle.add(toe);
    const sole = new T.Mesh(new T.BoxGeometry(0.092, 0.022, 0.23), mat(SOLE, 0.85));
    sole.position.set(0, -0.058, 0.05); ankle.add(sole);
    return { side, L1, L2, hip, knee, ankle };
  }

  // ============ public control ============
  get position() { return this.root.position; }

  headWorld(out = new T.Vector3()) { return this.head.getWorldPosition(out); }
  chestWorld(out = new T.Vector3()) { return this.chest.getWorldPosition(out); }
  gripWorld(side, out = new T.Vector3()) {
    return (side === 'left' ? this.armL : this.armR).grip.getWorldPosition(out);
  }

  setEmotion(name) { this.emotion = name; this.emotionT = 0; }
  setLook(target) { this.lookTarget = target; }

  reach(side, worldTarget) {
    const a = this.arm[side];
    a.mode = 'reach'; a.target = worldTarget.clone();
  }
  holdPose(side) {
    const a = this.arm[side];
    a.mode = 'hold'; a.target = null;
  }
  relaxArm(side) {
    const a = this.arm[side];
    if (!a.grabbed) { a.mode = 'idle'; a.target = null; }
    else a.mode = 'hold';
  }
  grab(side, rec) {
    const armR = side === 'left' ? this.armL : this.armR;
    const a = this.arm[side];
    a.grabbed = rec;
    a.curlTarget = 1;
    rec.prevParentId = rec.parentId;
    rec.parentId = 'aria';
    armR.grip.attach(rec.mesh);
    rec.mesh.position.set(0, -(rec.grabOffset || 0.02) * 0.3, 0.01);
    a.mode = 'hold';
  }
  releaseGrab(side) {
    const a = this.arm[side];
    const rec = a.grabbed;
    a.grabbed = null; a.curlTarget = 0; a.mode = 'idle';
    return rec;
  }
  heldItem() {
    return this.arm.right.grabbed || this.arm.left.grabbed;
  }
  playGesture(name) { this.gesture = name; this.gestureT = 0; this._gestureInit = false; }

  sitDown() { this.pose = 'sit'; }
  standUp() { this.pose = 'stand'; }

  // ============ per-frame ============
  update(dt, t, camPos) {
    this._camPos = camPos;
    // --- pose blend
    const target = this.pose === 'sit' ? 1 : 0;
    this.poseBlend += (target - this.poseBlend) * Math.min(1, dt * 4);
    const sitB = this.poseBlend;

    // --- gait
    const sp = this.speed;
    const moving = sp > 0.05 && sitB < 0.4;
    if (moving) this.phase += dt * (4.6 + sp * 3.2);
    else this.phase += (Math.round(this.phase / Math.PI) * Math.PI - this.phase) * Math.min(1, dt * 8);
    const ph = this.phase;
    const gaitAmp = Math.min(1, sp / 0.9);

    // stoop blend (crouch + bend to reach low things)
    this._stoopB += (this.stoop - this._stoopB) * Math.min(1, dt * 5);
    const stB = this._stoopB;

    // pelvis height: stand ~0.94, walk bob, sit drop, stoop drop
    const bob = moving ? Math.abs(Math.sin(ph)) * 0.028 * gaitAmp : 0;
    const sitDrop = sitB * 0.36;
    this.pelvis.position.y = 0.94 + bob - sitDrop - stB * 0.3;
    this.pelvis.rotation.z = moving ? Math.sin(ph) * 0.045 * gaitAmp : 0;
    this.pelvis.rotation.x = sitB * -0.06;

    // legs
    const legSwing = (leg, s) => {
      const swing = Math.sin(ph + (s > 0 ? 0 : Math.PI));
      const lift = Math.max(0, Math.sin(ph + (s > 0 ? 0 : Math.PI) + Math.PI / 2));
      if (stB > 0.15 && sitB < 0.5 && !moving) {
        leg.hip.rotation.x += (-1.0 * stB - leg.hip.rotation.x) * Math.min(1, dt * 5);
        leg.knee.rotation.x += (1.55 * stB - leg.knee.rotation.x) * Math.min(1, dt * 5);
        leg.ankle.rotation.x += (-0.5 * stB - leg.ankle.rotation.x) * Math.min(1, dt * 5);
        leg.hip.rotation.z = s * 0.02;
        return;
      }
      if (sitB > 0.5) {
        leg.hip.rotation.x += (-1.45 - leg.hip.rotation.x) * Math.min(1, dt * 5);
        leg.knee.rotation.x += (1.5 - leg.knee.rotation.x) * Math.min(1, dt * 5);
        leg.ankle.rotation.x += (-0.1 - leg.ankle.rotation.x) * Math.min(1, dt * 5);
      } else if (moving) {
        leg.hip.rotation.x = -swing * 0.55 * gaitAmp;
        leg.knee.rotation.x = Math.max(0, lift * 0.9 * gaitAmp);
        leg.ankle.rotation.x = swing * 0.25 * gaitAmp;
      } else {
        leg.hip.rotation.x += (0 - leg.hip.rotation.x) * Math.min(1, dt * 6);
        leg.knee.rotation.x += (0.03 - leg.knee.rotation.x) * Math.min(1, dt * 6);
        leg.ankle.rotation.x += (0 - leg.ankle.rotation.x) * Math.min(1, dt * 6);
      }
      leg.hip.rotation.z = s * 0.02;
    };
    legSwing(this.legL, -1); legSwing(this.legR, 1);

    // --- breathing & idle sway
    this.breathT += dt;
    const breath = Math.sin(this.breathT * 1.7) * 0.5 + 0.5;
    this.chestMesh.scale.x = 1 + breath * 0.022;
    this.chestMesh.scale.z = 0.78 + breath * 0.02;
    this.chest.position.y = 0.24 + breath * 0.004;
    if (!moving && sitB < 0.5) {
      this.spine.rotation.x = Math.sin(t * 0.4) * 0.012;
      this.spine.rotation.z = Math.sin(t * 0.27 + 1) * 0.01;
      this.pelvis.position.x = Math.sin(t * 0.18) * 0.015;
    } else {
      this.spine.rotation.x = sitB * 0.1 + (moving ? 0.06 * gaitAmp : 0);
      this.pelvis.position.x = 0;
    }
    this.spine.rotation.x += stB * 0.5; // lean forward while stooping

    // hair sway — long locks follow motion
    for (let i = 0; i < this.hairSway.length; i++) {
      const g = this.hairSway[i];
      const base = i < 2 ? (i === 0 ? 0.1 : -0.1) : i === 4 ? 0 : (i === 2 ? 0.05 : -0.05);
      g.rotation.z = base + Math.sin(t * 1.7 + i * 1.3) * 0.03;
      g.rotation.x = Math.sin(t * 1.4 + i) * 0.025 + (moving ? Math.sin(ph * 2 + i) * 0.09 : 0);
    }

    // --- arms
    this._updateArm(this.armL, 'left', dt, t, ph, moving, gaitAmp);
    this._updateArm(this.armR, 'right', dt, t, ph, moving, gaitAmp);

    // --- head look
    let lookP = this.lookTarget;
    if (!lookP && camPos) lookP = camPos;
    if (lookP) {
      const local = this.neck.worldToLocal(lookP.clone());
      const yaw = Math.atan2(local.x, local.z);
      const dist = Math.hypot(local.x, local.z);
      const pitch = Math.atan2(local.y - 0.09, dist);
      const cy = T.MathUtils.clamp(yaw, -1.1, 1.1);
      const cp = T.MathUtils.clamp(pitch, -0.7, 0.6);
      this.head.rotation.y += (cy * 0.75 - this.head.rotation.y) * Math.min(1, dt * 5);
      this.head.rotation.x += (-cp * 0.8 - this.head.rotation.x) * Math.min(1, dt * 5);
      this.neck.rotation.y += (cy * 0.25 - this.neck.rotation.y) * Math.min(1, dt * 3.5);
      this.saccadeT -= dt;
      if (this.saccadeT <= 0) { this.saccadeT = 0.6 + Math.random() * 2.4; this.saccade.set((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.07); }
      for (const e of this.eyes) {
        e.g.rotation.y += ((cy - this.head.rotation.y) * 0.9 + this.saccade.x - e.g.rotation.y) * Math.min(1, dt * 12);
        e.g.rotation.x += ((-cp - this.head.rotation.x) * 0.7 + this.saccade.y - e.g.rotation.x) * Math.min(1, dt * 12);
      }
    } else {
      this.head.rotation.y *= 1 - Math.min(1, dt * 2);
      this.head.rotation.x *= 1 - Math.min(1, dt * 2);
    }

    // --- blink
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinkPhase = 0.001; this.blinkT = 1.6 + Math.random() * 3.4; }
    if (this.blinkPhase > 0) {
      this.blinkPhase += dt * 9;
      if (this.blinkPhase >= Math.PI) this.blinkPhase = 0;
    }
    const blink = Math.sin(Math.min(Math.PI, this.blinkPhase));
    const emo = this._emotionParams();
    for (const e of this.eyes) {
      e.lid.rotation.x = -0.5 + blink * 1.2 + emo.lidDown * 0.35;
      e.lidBot.rotation.x = 0.3 - blink * 0.35;
    }
    // brows
    for (const b of this.brows) {
      const raise = emo.browUp + (b.s === -1 ? emo.browAsym : -emo.browAsym);
      b.m.position.y += (b.baseY + raise * 0.014 - b.m.position.y) * Math.min(1, dt * 6);
      b.m.rotation.z += (b.baseRZ + b.s * -emo.browAngle - b.m.rotation.z) * Math.min(1, dt * 6);
    }
    // jaw / lip-sync
    const jawOpen = Math.min(1, this.mouthLevel) * 0.32 + emo.jaw * 0.1;
    this.jaw.rotation.x += (jawOpen - this.jaw.rotation.x) * Math.min(1, dt * 18);
    // smile — she smiles a lot by default (gentle widening, no rubber-band lips)
    const smile = Math.min(1, emo.smile);
    this.lipTop.scale.x = 1 + smile * 0.22;
    this.lipBot.scale.x = 1 + smile * 0.2;
    this.lipTop.position.y = 0.031 + smile * 0.004;

    this.emotionT += dt;

    // gestures overlay
    if (this.gesture) this._updateGesture(dt);
    else if (this._rootYOffset) { // restore after a jump that got interrupted
      this.root.position.y *= 1 - Math.min(1, dt * 10);
      if (Math.abs(this.root.position.y) < 0.005) { this.root.position.y = 0; this._rootYOffset = false; }
    }
  }

  _emotionParams() {
    const k = Math.max(0, 1 - this.emotionT / 6);
    // baseline smile is higher — she's a sunny person
    const E = { browUp: 0, browAsym: 0, browAngle: 0, lidDown: 0, smile: 0.22, jaw: 0 };
    switch (this.emotion) {
      case 'happy': E.smile = 0.28 + 0.8 * k; E.browUp = 0.35 * k; E.lidDown = 0.15 * k; break;
      case 'surprise': E.browUp = 1 * k; E.jaw = 0.9 * k; E.smile = 0.15; E.lidDown = -0.3 * k; break;
      case 'confused': E.browAsym = 0.8 * k; E.browAngle = 0.12 * k; E.smile = 0.1; break;
      case 'curious': E.browUp = 0.55 * k; E.smile = 0.28; break;
      case 'frustrated': E.browUp = -0.5 * k; E.browAngle = -0.18 * k; E.smile = 0.02; E.lidDown = 0.3 * k; break;
      case 'amused': E.smile = 1.0 * k + 0.2; E.lidDown = 0.4 * k; break;
      case 'calm': E.smile = 0.25; E.lidDown = 0.2; break;
      case 'thinking': E.browAsym = 0.4 * k; E.lidDown = 0.25; E.smile = 0.12; break;
    }
    return E;
  }

  _updateArm(armRig, sideName, dt, t, ph, moving, gaitAmp) {
    const st = this.arm[sideName];
    const s = armRig.side;
    const curlTarget = st.grabbed ? 0.85 : (st.mode === 'reach' ? 0.25 : 0.12);
    st.curl = st.curl ?? 0.12;
    st.curl += (curlTarget - st.curl) * Math.min(1, dt * 8);
    for (const f of armRig.fingers) {
      f.s1.rotation.x = -st.curl * 1.15;
      f.s2.rotation.x = -st.curl * 1.3;
    }
    armRig.thumb.t1.rotation.x = -st.curl * 0.7;
    armRig.thumb.t2.rotation.x = -st.curl * 0.8;

    if (st.mode === 'reach' && st.target) {
      this._solveArmIK(armRig, st.target, dt);
      return;
    }
    if (st.mode === 'hold') {
      const hw = new T.Vector3(s * 0.16, 1.02 - this.poseBlend * 0.3, 0.28);
      const world = this.root.localToWorld(hw);
      this._solveArmIK(armRig, world, dt, 0.6);
      return;
    }
    if (st.mode === 'phone') {
      const hw = new T.Vector3(s * 0.11, 1.42 - this.poseBlend * 0.34, 0.34);
      const world = this.root.localToWorld(hw);
      this._solveArmIK(armRig, world, dt, 0.8);
      return;
    }
    if (st.mode === 'gesture') return; // gesture routine drives this arm directly
    // idle / swing
    const sitB = this.poseBlend;
    const targetRX = moving ? Math.sin(ph + (s > 0 ? Math.PI : 0)) * 0.4 * gaitAmp
      : sitB > 0.5 ? -0.9 : Math.sin(t * 0.45 + s) * 0.02;
    const targetRZ = s * (0.09 + (sitB > 0.5 ? 0.08 : 0));
    const targetElbow = moving ? -0.25 - Math.max(0, -Math.sin(ph + (s > 0 ? Math.PI : 0))) * 0.35 : sitB > 0.5 ? -0.85 : -0.14;
    armRig.shoulder.rotation.x += (targetRX - armRig.shoulder.rotation.x) * Math.min(1, dt * 5);
    armRig.shoulder.rotation.z += (targetRZ - armRig.shoulder.rotation.z) * Math.min(1, dt * 5);
    armRig.shoulder.rotation.y *= 1 - Math.min(1, dt * 5);
    armRig.elbow.rotation.x += (targetElbow - armRig.elbow.rotation.x) * Math.min(1, dt * 5);
    armRig.wrist.rotation.x *= 1 - Math.min(1, dt * 5);
  }

  _solveArmIK(armRig, worldTarget, dt, lerpK = 1) {
    const { L1, L2 } = armRig;
    const shoulderW = armRig.shoulder.getWorldPosition(new T.Vector3());
    const dir = worldTarget.clone().sub(shoulderW);
    let d = dir.length();
    d = T.MathUtils.clamp(d, 0.12, L1 + L2 - 0.015);
    dir.normalize();

    const a1 = Math.acos(T.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const elbowBend = Math.PI - Math.acos(T.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));

    const rest = new T.Vector3(0, -1, 0);
    const q = new T.Quaternion().setFromUnitVectors(rest, dir);
    const charRight = new T.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
    let bendAxis = new T.Vector3().crossVectors(dir, charRight);
    if (bendAxis.lengthSq() < 0.01) bendAxis = new T.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    bendAxis.normalize();
    const qBend = new T.Quaternion().setFromAxisAngle(bendAxis, -a1);
    const worldQ = qBend.multiply(q);

    const parentQ = armRig.shoulder.parent.getWorldQuaternion(new T.Quaternion());
    const localQ = parentQ.invert().multiply(worldQ);
    armRig.shoulder.quaternion.slerp(localQ, Math.min(1, dt * 8 * lerpK));
    armRig.elbow.rotation.x += (-elbowBend - armRig.elbow.rotation.x) * Math.min(1, dt * 8 * lerpK);
    armRig.elbow.rotation.y = 0; armRig.elbow.rotation.z = 0;
    armRig.wrist.rotation.x += (-0.25 - armRig.wrist.rotation.x) * Math.min(1, dt * 6);
  }

  // ============ gestures — whole-body routines ============
  _armPose(rig, rx, rz, elbow, dt, sp = 10) {
    rig.shoulder.rotation.x += (rx - rig.shoulder.rotation.x) * Math.min(1, dt * sp);
    rig.shoulder.rotation.z += (rz - rig.shoulder.rotation.z) * Math.min(1, dt * sp);
    rig.elbow.rotation.x += (elbow - rig.elbow.rotation.x) * Math.min(1, dt * sp);
  }
  _endGesture() {
    this.gesture = null;
    this.arm.left.mode = this.arm.left.grabbed ? 'hold' : 'idle';
    this.arm.right.mode = this.arm.right.grabbed ? 'hold' : 'idle';
    this.pelvis.rotation.y = 0;
  }

  _updateGesture(dt) {
    this.gestureT += dt;
    const g = this.gesture, gt = this.gestureT;

    if (g === 'wave') {
      // hand up beside her head, out of the lens
      const a = this.armL;
      this.arm.left.mode = 'gesture';
      this._armPose(a, -0.35, 1.5 + Math.sin(gt * 9) * 0.25, -2.15, dt);
      if (gt > 1.6) this._endGesture();

    } else if (g === 'nod') {
      this.head.rotation.x += Math.sin(gt * 8) * 0.25 * Math.max(0, 1 - gt);
      if (gt > 1.1) this._endGesture();

    } else if (g === 'shrug') {
      const k = Math.sin(Math.min(Math.PI, gt * 3));
      this.armL.shoulder.rotation.z = 0.55 * k + 0.09;
      this.armR.shoulder.rotation.z = -0.55 * k - 0.09;
      this.chest.position.y = 0.24 + k * 0.02;
      if (gt > 1.4) this._endGesture();

    } else if (g === 'thinkChin') {
      const world = this.root.localToWorld(new T.Vector3(0.05, 1.5 - this.poseBlend * 0.34, 0.16));
      this._solveArmIK(this.armR, world, dt, 0.9);
      this.arm.right.mode = 'gesture';
      if (gt > 2.4) this._endGesture();

    } else if (g === 'dance') {
      // a happy little groove: hips, alternating arms, head bob, finish with a spin
      this.arm.left.mode = 'gesture'; this.arm.right.mode = 'gesture';
      const beat = gt * 5.2;
      this.pelvis.rotation.z = Math.sin(beat) * 0.12;
      this.pelvis.position.x = Math.sin(beat) * 0.05;
      this.pelvis.position.y = 0.9 + Math.abs(Math.sin(beat)) * 0.05;
      this.pelvis.rotation.y = Math.sin(beat * 0.5) * 0.25;
      this.head.rotation.z = Math.sin(beat + 1) * 0.09;
      this._armPose(this.armL, -0.6 + Math.sin(beat) * 0.9, 0.7, -1.6 + Math.sin(beat) * 0.4, dt, 14);
      this._armPose(this.armR, -0.6 - Math.sin(beat) * 0.9, -0.7, -1.6 - Math.sin(beat) * 0.4, dt, 14);
      if (gt > 3.2 && gt < 3.9) this.root.rotation.y += dt * 9; // finishing spin!
      if (gt > 4.2) { this.pelvis.rotation.y = 0; this.head.rotation.z = 0; this._endGesture(); }

    } else if (g === 'jump') {
      this.arm.left.mode = 'gesture'; this.arm.right.mode = 'gesture';
      this._rootYOffset = true;
      if (gt < 0.25) { // crouch
        this.pelvis.position.y = 0.94 - gt * 0.6;
        this._armPose(this.armL, 0.5, 0.3, -0.9, dt, 16);
        this._armPose(this.armR, 0.5, -0.3, -0.9, dt, 16);
      } else if (gt < 0.85) { // airborne — arms up!
        const jt = (gt - 0.25) / 0.6;
        this.root.position.y = Math.sin(jt * Math.PI) * 0.32;
        this._armPose(this.armL, -2.6, 0.5, -0.25, dt, 18);
        this._armPose(this.armR, -2.6, -0.5, -0.25, dt, 18);
        this.legL.knee.rotation.x = 0.8; this.legR.knee.rotation.x = 0.8;
      } else {
        this.root.position.y *= 1 - Math.min(1, dt * 14);
      }
      if (gt > 1.3) { this.root.position.y = 0; this._rootYOffset = false; this._endGesture(); }

    } else if (g === 'spin') {
      this._spinTotal = (this._spinTotal || 0) + dt * 7;
      this.root.rotation.y += dt * 7;
      this.armL.shoulder.rotation.z = 0.9; this.armR.shoulder.rotation.z = -0.9;
      this.arm.left.mode = 'gesture'; this.arm.right.mode = 'gesture';
      if (this._spinTotal >= Math.PI * 2) { this._spinTotal = 0; this._endGesture(); }

    } else if (g === 'clap') {
      this.arm.left.mode = 'gesture'; this.arm.right.mode = 'gesture';
      const gap = 0.06 + Math.abs(Math.sin(gt * 11)) * 0.12;
      const l = this.root.localToWorld(new T.Vector3(-gap, 1.32 - this.poseBlend * 0.3, 0.3));
      const r = this.root.localToWorld(new T.Vector3(gap, 1.32 - this.poseBlend * 0.3, 0.3));
      this._solveArmIK(this.armL, l, dt, 1.4);
      this._solveArmIK(this.armR, r, dt, 1.4);
      if (gt > 1.8) this._endGesture();

    } else if (g === 'stretch') {
      this.arm.left.mode = 'gesture'; this.arm.right.mode = 'gesture';
      const k = Math.sin(Math.min(Math.PI, gt * 1.6));
      this._armPose(this.armL, -2.8 * k, 0.35, -0.15, dt, 8);
      this._armPose(this.armR, -2.8 * k, -0.35, -0.15, dt, 8);
      this.spine.rotation.x = -0.12 * k;
      this.chest.position.y = 0.24 + k * 0.015;
      if (gt > 2.1) this._endGesture();

    } else if (g === 'kiss') {
      // use whichever hand is free — the other one may be holding her phone
      const side = (this.arm.right.grabbed || this.arm.right.mode === 'phone') ? 'left' : 'right';
      const rig = side === 'left' ? this.armL : this.armR;
      this.arm[side].mode = 'gesture';
      if (gt < 0.7) { // hand to lips
        const world = this.head.localToWorld(new T.Vector3(side === 'left' ? -0.02 : 0.02, 0.02, 0.13));
        this._solveArmIK(rig, world, dt, 1.3);
      } else { // blow it toward the camera
        const to = this._camPos ? this._camPos.clone() : this.root.localToWorld(new T.Vector3(0, 1.5, 1));
        const world = this.headWorld(new T.Vector3()).lerp(to, 0.3);
        this._solveArmIK(rig, world, dt, 1.2);
        if (gt > 0.75 && gt < 0.95) this.blinkPhase = Math.PI / 2; // little wink-ish blink
      }
      if (gt > 1.7) this._endGesture();

    } else if (g === 'point') {
      const side = (this.arm.right.grabbed || this.arm.right.mode === 'phone') ? 'left' : 'right';
      const rig = side === 'left' ? this.armL : this.armR;
      this.arm[side].mode = 'gesture';
      const to = this._camPos ? this._camPos.clone() : this.root.localToWorld(new T.Vector3(0, 1.4, 1));
      const world = this.headWorld(new T.Vector3()).lerp(to, 0.35);
      this._solveArmIK(rig, world, dt, 1.3);
      if (gt > 1.4) this._endGesture();

    } else if (g === 'flex') {
      this.arm.left.mode = 'gesture'; this.arm.right.mode = 'gesture';
      this._armPose(this.armL, -1.2, 1.35, -2.2, dt, 10);
      this._armPose(this.armR, -1.2, -1.35, -2.2, dt, 10);
      if (gt > 2.0) this._endGesture();

    } else {
      this._endGesture();
    }
  }
}
