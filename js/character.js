// character.js — Aria's virtual body: procedural humanoid, walk cycle, two-bone IK arms,
// articulated fingers, facial animation (blink, brows, jaw lip-sync), breathing, poses.
import * as THREE from '../vendor/three.module.js';
const T = THREE;

const SKIN = 0xd9a98c, SKIN_SHADE = 0xc99878;
const HAIR = 0x3b2a1e;
const SHIRT = 0xb0503f;      // rust-red henley
const JEANS = 0x3d4d63;
const SHOE = 0xe8e4dc;

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

    this.heading = 0;                    // rotation target
    this.speed = 0;                      // gait driver
    this.phase = 0;
    this.pose = 'stand';                 // stand | sit
    this.poseBlend = 0;                  // 0 stand → 1 sit
    this.stoop = 0;                      // 0..1 crouch/bend to reach low objects
    this._stoopB = 0;
    this.mouthLevel = 0;                 // 0..1 external (voice)
    this.emotion = 'neutral';
    this.emotionT = 0;
    this.lookTarget = null;              // Vector3 | null
    this.blinkT = 1.5 + Math.random() * 2;
    this.blinkPhase = 0;
    this.breathT = 0;
    this.saccadeT = 0; this.saccade = new T.Vector2();
    this.gesture = null; this.gestureT = 0;

    this.arm = {
      left:  { mode: 'idle', target: null, grabbed: null, blend: 0, curl: 0 },
      right: { mode: 'idle', target: null, grabbed: null, blend: 0, curl: 0 },
    };

    this._build();
  }

  // ============ construction ============
  _build() {
    const R = this.root;
    const skin = mat(SKIN, 0.62);
    const shirt = mat(SHIRT, 0.88);
    const jeans = mat(JEANS, 0.92);

    // -- pelvis / torso
    this.pelvis = new T.Group(); this.pelvis.position.y = 0.94; R.add(this.pelvis);
    const hipMesh = new T.Mesh(new T.SphereGeometry(0.155, 14, 10), jeans);
    hipMesh.scale.set(1.08, 0.72, 0.82); hipMesh.castShadow = true;
    this.pelvis.add(hipMesh);

    this.spine = new T.Group(); this.spine.position.y = 0.1; this.pelvis.add(this.spine);
    const belly = new T.Mesh(new T.CylinderGeometry(0.128, 0.148, 0.24, 14), shirt);
    belly.position.y = 0.12; belly.castShadow = true; this.spine.add(belly);

    this.chest = new T.Group(); this.chest.position.y = 0.24; this.spine.add(this.chest);
    const chestMesh = new T.Mesh(new T.CylinderGeometry(0.15, 0.13, 0.26, 14), shirt);
    chestMesh.position.y = 0.1; chestMesh.scale.z = 0.78; chestMesh.castShadow = true;
    this.chest.add(chestMesh);
    this.chestMesh = chestMesh;
    // shoulders pads
    for (const s of [-1, 1]) {
      const sh = new T.Mesh(new T.SphereGeometry(0.062, 10, 8), shirt);
      sh.position.set(s * 0.165, 0.21, 0); sh.castShadow = true; this.chest.add(sh);
    }

    // -- neck & head
    this.neck = new T.Group(); this.neck.position.y = 0.245; this.chest.add(this.neck);
    const neckMesh = new T.Mesh(new T.CylinderGeometry(0.045, 0.05, 0.09, 10), skin);
    neckMesh.position.y = 0.03; this.neck.add(neckMesh);

    this.head = new T.Group(); this.head.position.y = 0.09; this.neck.add(this.head);
    const skull = new T.Mesh(new T.SphereGeometry(0.102, 24, 18), skin);
    skull.position.y = 0.085; skull.scale.set(0.92, 1.06, 0.98); skull.castShadow = true;
    this.head.add(skull);
    // jaw / chin
    this.jaw = new T.Group(); this.jaw.position.set(0, 0.045, 0.012); this.head.add(this.jaw);
    const chin = new T.Mesh(new T.SphereGeometry(0.075, 16, 12), skin);
    chin.scale.set(0.82, 0.62, 0.8); chin.position.set(0, -0.012, 0.022);
    this.jaw.add(chin);
    // lips (top lip fixed to the head; bottom lip rides on the jaw)
    const lipMat = mat(0xb96a5c, 0.55);
    this.lipTop = new T.Mesh(new T.BoxGeometry(0.038, 0.0055, 0.009), lipMat);
    this.lipTop.position.set(0, 0.031, 0.0915); this.head.add(this.lipTop);
    this.lipBot = new T.Mesh(new T.BoxGeometry(0.034, 0.0055, 0.009), lipMat);
    this.lipBot.position.set(0, -0.021, 0.079); this.jaw.add(this.lipBot);
    // mouth interior (revealed when the jaw opens)
    const mouthIn = new T.Mesh(new T.BoxGeometry(0.03, 0.013, 0.008), mat(0x53201f, 0.9));
    mouthIn.position.set(0, 0.0275, 0.0855); this.head.add(mouthIn);
    // nose
    const nose = new T.Mesh(new T.ConeGeometry(0.014, 0.035, 8), skin);
    nose.rotation.x = Math.PI / 2.25; nose.position.set(0, 0.07, 0.1); this.head.add(nose);
    // ears
    for (const s of [-1, 1]) {
      const ear = new T.Mesh(new T.SphereGeometry(0.022, 8, 8), skin);
      ear.scale.set(0.5, 1, 0.7); ear.position.set(s * 0.092, 0.08, 0.01);
      this.head.add(ear);
    }

    // -- eyes (sclera + iris + pupil + catchlight), eyelids
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eg = new T.Group(); eg.position.set(s * 0.037, 0.095, 0.083);
      const sclera = new T.Mesh(new T.SphereGeometry(0.019, 16, 12), new T.MeshStandardMaterial({ color: 0xf4f1ec, roughness: 0.25 }));
      eg.add(sclera);
      const iris = new T.Mesh(new T.CircleGeometry(0.0095, 16), new T.MeshStandardMaterial({ color: 0x5a7a52, roughness: 0.3 }));
      iris.position.z = 0.0182; eg.add(iris);
      const pupil = new T.Mesh(new T.CircleGeometry(0.0045, 12), new T.MeshBasicMaterial({ color: 0x0a0a0a }));
      pupil.position.z = 0.0186; eg.add(pupil);
      const glint = new T.Mesh(new T.CircleGeometry(0.0016, 8), new T.MeshBasicMaterial({ color: 0xffffff }));
      glint.position.set(0.003, 0.004, 0.019); eg.add(glint);
      const lid = new T.Mesh(new T.SphereGeometry(0.0205, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(SKIN_SHADE, 0.6));
      lid.rotation.x = -0.45; eg.add(lid);
      const lidBot = new T.Mesh(new T.SphereGeometry(0.0202, 16, 8, 0, Math.PI * 2, Math.PI / 1.9, Math.PI / 2.6), mat(SKIN_SHADE, 0.6));
      lidBot.rotation.x = 0.3; eg.add(lidBot);
      this.head.add(eg);
      this.eyes.push({ g: eg, lid, lidBot, s });
    }
    // brows
    this.brows = [];
    for (const s of [-1, 1]) {
      const brow = new T.Mesh(new T.BoxGeometry(0.038, 0.007, 0.012), mat(HAIR, 0.85));
      brow.position.set(s * 0.038, 0.126, 0.088); brow.rotation.z = s * -0.08;
      this.head.add(brow);
      this.brows.push({ m: brow, s, baseY: 0.126, baseRZ: s * -0.08 });
    }

    // -- hair: cap + side volume + low ponytail
    const hairMat = mat(HAIR, 0.72);
    const cap = new T.Mesh(new T.SphereGeometry(0.107, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2.4), hairMat);
    cap.position.y = 0.102; cap.rotation.x = -0.22; cap.scale.set(0.96, 1.0, 1.02); this.head.add(cap);
    const back = new T.Mesh(new T.SphereGeometry(0.1, 14, 10), hairMat);
    back.scale.set(0.9, 1.15, 0.72); back.position.set(0, 0.055, -0.052); back.castShadow = true; this.head.add(back);
    for (const s of [-1, 1]) {
      const strand = new T.Mesh(new T.CylinderGeometry(0.016, 0.01, 0.16, 8), hairMat);
      strand.position.set(s * 0.088, 0.02, 0.028); strand.rotation.z = s * 0.12; this.head.add(strand);
    }
    this.ponytail = new T.Group(); this.ponytail.position.set(0, 0.05, -0.1); this.head.add(this.ponytail);
    const pt = new T.Mesh(new T.CylinderGeometry(0.028, 0.012, 0.24, 8), hairMat);
    pt.position.y = -0.12; pt.castShadow = true; this.ponytail.add(pt);

    // -- arms
    this.armL = this._buildArm(-1, skin, shirt);
    this.armR = this._buildArm(1, skin, shirt);

    // -- legs
    this.legL = this._buildLeg(-1, jeans);
    this.legR = this._buildLeg(1, jeans);
  }

  _buildArm(side, skin, shirt) {
    const L1 = 0.28, L2 = 0.25;
    const shoulder = new T.Group();
    shoulder.position.set(side * 0.185, 0.2, 0);
    this.chest.add(shoulder);
    shoulder.add(limb(0.048, 0.04, L1, shirt));
    const sleeve = new T.Mesh(new T.CylinderGeometry(0.052, 0.046, 0.12, 10), shirt);
    sleeve.position.y = -0.06; shoulder.add(sleeve);

    const elbow = new T.Group(); elbow.position.y = -L1; shoulder.add(elbow);
    elbow.add(ball(0.037, skin));
    elbow.add(limb(0.036, 0.028, L2, skin));

    const wrist = new T.Group(); wrist.position.y = -L2; elbow.add(wrist);
    // hand: palm + 5 fingers with 2 segments + opposable thumb
    const hand = new T.Group(); wrist.add(hand);
    const palm = new T.Mesh(new T.BoxGeometry(0.055, 0.075, 0.022), skin);
    palm.position.y = -0.038; palm.castShadow = true; hand.add(palm);
    const fingers = [];
    const fw = 0.0105;
    for (let i = 0; i < 4; i++) {
      const fx = (i - 1.5) * 0.0135;
      const seg1 = new T.Group(); seg1.position.set(fx, -0.076, 0);
      const f1 = new T.Mesh(new T.CapsuleGeometry(fw / 2, 0.022, 3, 6), skin);
      f1.position.y = -0.014; seg1.add(f1);
      const seg2 = new T.Group(); seg2.position.y = -0.03; seg1.add(seg2);
      const f2 = new T.Mesh(new T.CapsuleGeometry(fw / 2.15, 0.017, 3, 6), skin);
      f2.position.y = -0.011; seg2.add(f2);
      hand.add(seg1);
      fingers.push({ s1: seg1, s2: seg2 });
    }
    const thumb1 = new T.Group(); thumb1.position.set(-side * 0.03, -0.028, 0.008);
    thumb1.rotation.z = side * 0.9;
    const t1 = new T.Mesh(new T.CapsuleGeometry(0.0065, 0.02, 3, 6), skin); t1.position.y = -0.013; thumb1.add(t1);
    const thumb2 = new T.Group(); thumb2.position.y = -0.027; thumb1.add(thumb2);
    const t2 = new T.Mesh(new T.CapsuleGeometry(0.006, 0.014, 3, 6), skin); t2.position.y = -0.009; thumb2.add(t2);
    hand.add(thumb1);
    // grab anchor — where held items sit
    const grip = new T.Group(); grip.position.set(0, -0.075, 0.028); hand.add(grip);

    return { side, L1, L2, shoulder, elbow, wrist, hand, fingers, thumb: { t1: thumb1, t2: thumb2 }, grip };
  }

  _buildLeg(side, jeans) {
    const L1 = 0.42, L2 = 0.42;
    const hip = new T.Group(); hip.position.set(side * 0.088, -0.03, 0); this.pelvis.add(hip);
    hip.add(limb(0.075, 0.055, L1, jeans));
    const knee = new T.Group(); knee.position.y = -L1; hip.add(knee);
    knee.add(ball(0.052, jeans));
    knee.add(limb(0.052, 0.04, L2, jeans));
    const ankle = new T.Group(); ankle.position.y = -L2; knee.add(ankle);
    const shoeMat = mat(SHOE, 0.6);
    const foot = new T.Mesh(new T.BoxGeometry(0.085, 0.055, 0.22), shoeMat);
    foot.position.set(0, -0.032, 0.045); foot.castShadow = true; ankle.add(foot);
    const toe = new T.Mesh(new T.SphereGeometry(0.043, 8, 6), shoeMat);
    toe.scale.set(0.95, 0.62, 0.9); toe.position.set(0, -0.045, 0.15); ankle.add(toe);
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
  playGesture(name) { this.gesture = name; this.gestureT = 0; }

  sitDown() { this.pose = 'sit'; }
  standUp() { this.pose = 'stand'; }

  // ============ per-frame ============
  update(dt, t, camPos) {
    const R = this.root;
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

    // pelvis height: stand ~0.94, walk bob, sit → seatY-adjust handled by agent placing root; here offset
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
      // weight shift
      this.pelvis.position.x = Math.sin(t * 0.18) * 0.015;
    } else {
      this.spine.rotation.x = sitB * 0.1 + (moving ? 0.06 * gaitAmp : 0);
      this.pelvis.position.x = 0;
    }
    this.spine.rotation.x += stB * 0.5; // lean forward while stooping
    this.ponytail.rotation.x = Math.sin(t * 1.9) * 0.05 + (moving ? Math.sin(ph * 2) * 0.1 : 0);

    // --- arms
    this._updateArm(this.armL, 'left', dt, t, ph, moving, gaitAmp);
    this._updateArm(this.armR, 'right', dt, t, ph, moving, gaitAmp);

    // --- head look
    let lookP = this.lookTarget;
    if (!lookP && camPos) lookP = camPos;
    if (lookP) {
      const hw = this.headWorld(new T.Vector3());
      const local = this.neck.worldToLocal(lookP.clone());
      const yaw = Math.atan2(local.x, local.z);
      const dist = Math.hypot(local.x, local.z);
      const pitch = Math.atan2(local.y - 0.09, dist);
      const cy = T.MathUtils.clamp(yaw, -1.1, 1.1);
      const cp = T.MathUtils.clamp(pitch, -0.7, 0.6);
      this.head.rotation.y += (cy * 0.75 - this.head.rotation.y) * Math.min(1, dt * 5);
      this.head.rotation.x += (-cp * 0.8 - this.head.rotation.x) * Math.min(1, dt * 5);
      this.neck.rotation.y += (cy * 0.25 - this.neck.rotation.y) * Math.min(1, dt * 3.5);
      // eyes lead the head slightly + saccades
      this.saccadeT -= dt;
      if (this.saccadeT <= 0) { this.saccadeT = 0.6 + Math.random() * 2.4; this.saccade.set((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.07); }
      for (const e of this.eyes) {
        e.g.rotation.y += ((cy - this.head.rotation.y) * 0.9 + this.saccade.x - e.g.rotation.y) * Math.min(1, dt * 12);
        e.g.rotation.x += ((-cp - this.head.rotation.x) * 0.7 + this.saccade.y - e.g.rotation.x) * Math.min(1, dt * 12);
      }
      void hw;
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
      e.lid.rotation.x = -0.45 + blink * 1.15 + emo.lidDown * 0.35;
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
    // smile — lips widen/raise
    const smile = emo.smile;
    this.lipTop.scale.x = 1 + smile * 0.45;
    this.lipBot.scale.x = 1 + smile * 0.4;
    this.lipTop.position.y = 0.028 + smile * 0.004;

    this.emotionT += dt;

    // gestures overlay
    if (this.gesture) this._updateGesture(dt);

    void R;
  }

  _emotionParams() {
    // decay to neutral over ~6s
    const k = Math.max(0, 1 - this.emotionT / 6);
    const E = { browUp: 0, browAsym: 0, browAngle: 0, lidDown: 0, smile: 0.12, jaw: 0 };
    switch (this.emotion) {
      case 'happy': E.smile = 0.15 + 0.85 * k; E.browUp = 0.3 * k; E.lidDown = 0.15 * k; break;
      case 'surprise': E.browUp = 1 * k; E.jaw = 0.9 * k; E.smile = 0.05; E.lidDown = -0.3 * k; break;
      case 'confused': E.browAsym = 0.8 * k; E.browAngle = 0.12 * k; E.smile = 0.03; break;
      case 'curious': E.browUp = 0.55 * k; E.smile = 0.2; break;
      case 'frustrated': E.browUp = -0.5 * k; E.browAngle = -0.18 * k; E.smile = -0.05; E.lidDown = 0.3 * k; break;
      case 'amused': E.smile = 0.9 * k + 0.1; E.lidDown = 0.35 * k; break;
      case 'calm': E.smile = 0.18; E.lidDown = 0.2; break;
      case 'thinking': E.browAsym = 0.4 * k; E.lidDown = 0.25; E.smile = 0.05; break;
    }
    return E;
  }

  _updateArm(armRig, sideName, dt, t, ph, moving, gaitAmp) {
    const st = this.arm[sideName];
    const s = armRig.side;
    // finger curl
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
      // carry in front of the hip/chest
      const hw = new T.Vector3(s * 0.16, 1.02 - this.poseBlend * 0.3, 0.28);
      const world = this.root.localToWorld(hw);
      this._solveArmIK(armRig, world, dt, 0.6);
      return;
    }
    if (st.mode === 'phone') {
      // hold phone up in front of the face
      const hw = new T.Vector3(s * 0.11, 1.42 - this.poseBlend * 0.34, 0.34);
      const world = this.root.localToWorld(hw);
      this._solveArmIK(armRig, world, dt, 0.8);
      return;
    }
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

  // two-bone analytic IK, smoothed
  _solveArmIK(armRig, worldTarget, dt, lerpK = 1) {
    const { L1, L2 } = armRig;
    const shoulderW = armRig.shoulder.getWorldPosition(new T.Vector3());
    const dir = worldTarget.clone().sub(shoulderW);
    let d = dir.length();
    d = T.MathUtils.clamp(d, 0.12, L1 + L2 - 0.015);
    dir.normalize();

    // interior angles from law of cosines
    const a1 = Math.acos(T.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const elbowBend = Math.PI - Math.acos(T.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));

    // world-space quaternion rotating arm rest axis (0,-1,0) to target dir
    const rest = new T.Vector3(0, -1, 0);
    const q = new T.Quaternion().setFromUnitVectors(rest, dir);
    // bend axis: keep the elbow out to the side/back for a natural pose
    const charRight = new T.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
    let bendAxis = new T.Vector3().crossVectors(dir, charRight);
    if (bendAxis.lengthSq() < 0.01) bendAxis = new T.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    bendAxis.normalize();
    const qBend = new T.Quaternion().setFromAxisAngle(bendAxis, -a1 * (armRig.side > 0 ? 1 : 1));
    const worldQ = qBend.multiply(q);

    // convert into shoulder's parent space
    const parentQ = armRig.shoulder.parent.getWorldQuaternion(new T.Quaternion());
    const localQ = parentQ.invert().multiply(worldQ);
    armRig.shoulder.quaternion.slerp(localQ, Math.min(1, dt * 8 * lerpK));
    // elbow bend around local X
    armRig.elbow.rotation.x += (-elbowBend - armRig.elbow.rotation.x) * Math.min(1, dt * 8 * lerpK);
    armRig.elbow.rotation.y = 0; armRig.elbow.rotation.z = 0;
    // orient palm roughly toward target
    armRig.wrist.rotation.x += (-0.25 - armRig.wrist.rotation.x) * Math.min(1, dt * 6);
  }

  _updateGesture(dt) {
    this.gestureT += dt;
    const g = this.gesture, gt = this.gestureT;
    if (g === 'wave') {
      const a = this.armL; // wave off to the side so she doesn't block the lens
      a.shoulder.rotation.x = -1.35;
      a.shoulder.rotation.z = 1.15 + Math.sin(gt * 9) * 0.3;
      a.elbow.rotation.x = -1.5;
      if (gt > 1.6) { this.gesture = null; this.arm.left.mode = this.arm.left.grabbed ? 'hold' : 'idle'; }
      else this.arm.left.mode = 'gesture';
    } else if (g === 'nod') {
      this.head.rotation.x += Math.sin(gt * 8) * 0.25 * Math.max(0, 1 - gt);
      if (gt > 1.1) this.gesture = null;
    } else if (g === 'shrug') {
      const k = Math.sin(Math.min(Math.PI, gt * 3));
      this.armL.shoulder.rotation.z = 0.55 * k + 0.09;
      this.armR.shoulder.rotation.z = -0.55 * k - 0.09;
      this.chest.position.y = 0.24 + k * 0.02;
      if (gt > 1.4) this.gesture = null;
    } else if (g === 'thinkChin') {
      const world = this.root.localToWorld(new T.Vector3(0.05, 1.5 - this.poseBlend * 0.34, 0.16));
      this._solveArmIK(this.armR, world, dt, 0.9);
      this.arm.right.mode = 'gesture';
      if (gt > 2.4) { this.gesture = null; this.arm.right.mode = this.arm.right.grabbed ? 'hold' : 'idle'; }
    } else {
      this.gesture = null;
    }
  }
}
