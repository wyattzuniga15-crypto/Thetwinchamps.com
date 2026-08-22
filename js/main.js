// main.js — boots the simulation and drives the FaceTime-style experience:
// screens, call camera, messaging, incoming calls, persistence & offline life.
import * as THREE from '../vendor/three.module.js';
import { World } from './world.js';
import { Character } from './character.js';
import { NavGrid } from './nav.js';
import { Agent } from './agent.js';
import { Memory } from './memory.js';
import { NLU } from './nlu.js';
import { Dialogue } from './dialogue.js';
import { Voice, Ringtone } from './voice.js';

const T = THREE;
const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'aria-world-v1';
const KEY_KEY = 'aria-apikey';

// ============================================================ boot
const world = new World();
const char = new Character(world.scene);
char.root.position.set(-0.5, 0, 0.2);
const nav = new NavGrid(world);
const memory = new Memory();
const agent = new Agent(world, char, nav, memory);
const nlu = new NLU(world, agent, memory);
const dialogue = new Dialogue(world, agent, memory, nlu);
const voice = new Voice();
const ringtone = new Ringtone();

voice.onLevel = (lvl) => { char.mouthLevel = lvl; };

// renderer
const canvas = $('gl');
const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio)); // keep frame rate smooth on phones

const camera = new T.PerspectiveCamera(55, 1, 0.05, 30);
camera.position.set(0, 1.5, 2);

// soft "phone screen" glow that lights her face during calls — doubles as a gentle
// beauty fill so the video call doesn't look flatly lit
const screenGlow = new T.PointLight(0xd9e8ff, 0, 3, 1.8);
world.scene.add(screenGlow);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ============================================================ state
const state = {
  screen: 'home',           // home | call | messages
  inCall: false,
  callStart: 0,
  callConnected: false,
  camMode: 'held',          // held | watch
  camPos: new T.Vector3(0, 1.5, 2),
  camLook: new T.Vector3(0, 1.4, 0),
  proppedPos: null,
  camDirective: null,       // {mode:'point'|'pov'|'roomtour', id?, until} — she aims the phone
  dragYaw: 0, dragPitch: 0, // player drag-look offsets
  messages: [],             // [{from:'me'|'ai'|'sys', text, t}]
  unread: 0,
  settings: { tts: true, captions: true, incoming: true },
  incomingTimer: 90 + Math.random() * 150,
  aiMsgTimer: 200 + Math.random() * 300,
  lastSeenAt: null,
};

// ============================================================ persistence
function save() {
  try {
    const data = {
      v: 1, savedAt: Date.now(),
      world: world.serialize(),
      ai: {
        pos: char.root.position.toArray(), ry: char.root.rotation.y,
        sittingOn: agent.sittingOn, activity: agent.currentActivity,
      },
      memory: memory.serialize(),
      messages: state.messages.slice(-120),
      settings: state.settings,
      nlu: { lastObjectId: nlu.lastObjectId, lastPlaceId: nlu.lastPlaceId },
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) { /* storage may be unavailable */ }
}

function load() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { /* corrupt */ }
  if (!data) { agent.setActivity('settling into her room'); memory.logEvent('moved into her new virtual room'); return; }
  world.deserialize(data.world);
  memory.deserialize(data.memory);
  state.messages = data.messages || [];
  state.settings = { ...state.settings, ...(data.settings || {}) };
  if (data.nlu) { nlu.lastObjectId = data.nlu.lastObjectId; nlu.lastPlaceId = data.nlu.lastPlaceId; }
  if (data.ai) {
    char.root.position.fromArray(data.ai.pos);
    char.root.rotation.y = data.ai.ry || 0;
    if (data.ai.sittingOn) { char.sitDown(); agent.sittingOn = data.ai.sittingOn; }
    agent.setActivity(data.ai.activity || 'relaxing');
  }
  state.lastSeenAt = data.savedAt;
  // simulate her life while the player was away
  const awayMin = (Date.now() - data.savedAt) / 60000;
  if (awayMin > 3) {
    const done = agent.simulateOffline(awayMin);
    if (done.length && Math.random() < 0.65) {
      // she mentions it by message
      setTimeout(() => aiSendsMessage(pick([
        `omg you're back!! while you were gone I ${done[done.length - 1]} 😄`,
        `update from the room: I ${done[0]}. thrilling stuff, I know 😂 call me!!`,
        `you MISSED it — I ${pick(done)}. okay it wasn't that dramatic but still. call me later? 🥺`,
      ])), 4000 + Math.random() * 8000);
    }
  }
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
setInterval(save, 6000);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('beforeunload', save);

// ============================================================ screens
function showScreen(name) {
  state.screen = name;
  for (const s of ['home', 'call', 'messages']) $(`screen-${s}`).classList.toggle('active', s === name);
  if (name === 'messages') { state.unread = 0; updateBadge(); renderThread(); }
}

// ============================================================ avatar portraits
function renderAvatars() {
  // render a 3D headshot into the avatar canvases
  const headPos = char.headWorld(new T.Vector3());
  const cam2 = new T.PerspectiveCamera(40, 1, 0.05, 10);
  const f = new T.Vector3(Math.sin(char.root.rotation.y), 0, Math.cos(char.root.rotation.y));
  cam2.position.copy(headPos).addScaledVector(f, 0.55);
  cam2.position.y = headPos.y + 0.03;
  cam2.lookAt(headPos.x, headPos.y + 0.02, headPos.z);
  const size = 256;
  renderer.setSize(size, size, false);
  cam2.aspect = 1; cam2.updateProjectionMatrix();
  renderer.render(world.scene, cam2);
  for (const id of ['avatar-canvas', 'avatar-canvas-2', 'avatar-canvas-3']) {
    const c = $(id); if (!c) continue;
    const g = c.getContext('2d');
    g.fillStyle = '#0d1420'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(renderer.domElement, 0, 0, size, size, 0, 0, c.width, c.height);
  }
  resize();
}

// ============================================================ speech & captions
let captionTimer = null;
function ariaSays(text, emotion = null, channel = 'call') {
  if (!text) return;
  memory.addConversation('ai', text);
  if (emotion) char.setEmotion(emotion);
  if (channel === 'call' && state.inCall) {
    if (state.settings.captions) {
      const cap = $('caption');
      cap.textContent = text;
      cap.classList.remove('hidden');
      clearTimeout(captionTimer);
      captionTimer = setTimeout(() => cap.classList.add('hidden'), Math.max(2600, text.length * 65));
    }
    voice.enabled = state.settings.tts;
    voice.speak(text);
  } else {
    aiSendsMessage(text, false);
  }
}

function aiSendsMessage(text, notify = true) {
  state.messages.push({ from: 'ai', text, t: Date.now() });
  memory.addConversation('ai', text);
  if (state.screen === 'messages') renderThread();
  else if (notify !== false) { state.unread++; updateBadge(); toast(`Aria: ${text.length > 60 ? text.slice(0, 57) + '…' : text}`); }
  save();
}
function updateBadge() {
  const b = $('msg-badge');
  b.classList.toggle('hidden', state.unread === 0);
  b.textContent = state.unread;
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3600);
}

// ============================================================ player input handling
async function handleUtterance(text, channel) {
  text = text.trim();
  if (!text) return;
  memory.addConversation('me', text);
  if (channel === 'msg') {
    state.messages.push({ from: 'me', text, t: Date.now() });
    renderThread();
  }

  const parsed = nlu.parse(text);
  const respond = (r) => {
    if (!r || !r.text) return;
    if (channel === 'msg') {
      // typing indicator then reply
      $('typing-row').classList.remove('hidden');
      scrollThread();
      setTimeout(() => {
        $('typing-row').classList.add('hidden');
        aiSendsMessage(r.text, state.screen !== 'messages');
        if (r.emotion) char.setEmotion(r.emotion);
      }, 700 + Math.min(2600, r.text.length * 28));
    } else {
      ariaSays(r.text, r.emotion, 'call');
    }
  };

  if (parsed) {
    if (parsed.actions.length) {
      // player commands preempt whatever she was doing on her own
      if (!agent.playerTask) agent.clearTasks();
      agent.playerTask = true;
      agent.activityUntil = performance.now() / 1000 + 9999; // pause autonomous life
      agent.enqueue(parsed.actions);
      agent.enqueue([{ type: 'custom', fn: (ag) => { ag.playerTask = false; ag.activityUntil = 0; if (state.inCall) resumeHeldCamera(); return true; } }]);
      // only prop the phone for tasks that need her body across the room —
      // gestures and camera moves happen right on the call
      const needsBody = parsed.actions.some(a =>
        ['goTo', 'goToObj', 'pick', 'place', 'open', 'toggle', 'sit', 'push', 'water', 'throw'].includes(a.type));
      if (state.inCall && needsBody) enterWatchCamera();
      memory.logEvent(`did what you asked: “${text.length > 50 ? text.slice(0, 47) + '…' : text}”`);
    }
    respond(parsed.reply);
    return;
  }
  // conversational
  const r = await dialogue.respond(text);
  respond(r);
}

// ============================================================ call management
function startCall(initiatedByAria = false, reason = null) {
  showScreen('call');
  state.inCall = true;
  state.callConnected = false;
  state.callStart = 0;
  state.camDirective = null;
  state.dragYaw = 0; state.dragPitch = 0;
  agent.inCall = true;
  agent.clearTasks();
  agent.activityUntil = performance.now() / 1000 + 99999;
  $('connection-pill').textContent = initiatedByAria ? 'Connecting…' : 'Ringing…';
  $('connection-pill').classList.remove('live');

  // she walks to her phone and answers
  const phone = world.get('phone');
  const acts = [];
  if (phone.parentId !== 'aria') {
    acts.push(...agent.planPick('phone'));
  }
  acts.push({
    type: 'custom', fn: (ag) => {
      ag.char.arm.right.mode = 'phone';
      connectCall(initiatedByAria, reason);
      return true;
    }
  });
  agent.enqueueFront(acts);
}

function connectCall(byAria, reason) {
  state.callConnected = true;
  state.callStart = performance.now();
  state.camMode = 'held';
  memory.meta.callCount++;
  $('connection-pill').textContent = 'Connected · simulated';
  $('connection-pill').classList.add('live');
  triggerFocusPulse();

  const name = memory.facts.playerName ? `, ${memory.facts.playerName}` : '';
  let line;
  if (byAria && reason) line = reason;
  else {
    const act = agent.currentActivity.replace(/\bher\b/g, 'my'); // she speaks in first person
    line = pick([
      `Heyyy${name}!! Omg perfect timing, I was just ${act}.`,
      `Hiii${name}! Wait wait, one sec, I was ${act}— okay okay. HI! 😄`,
      `Heyy${name}!! I was literally just ${act} and hoping you'd call.`,
      `Omg hi${name}!! Okay you caught me ${act}, don't judge 😂`,
    ]);
  }
  setTimeout(() => { char.playGesture('wave'); ariaSays(line, 'happy'); }, 700);
}

function endCall() {
  state.inCall = false;
  state.callConnected = false;
  agent.inCall = false;
  agent.activityUntil = 0;
  voice.stop();
  char.setLook(null);
  char.arm.right.mode = char.arm.right.grabbed ? 'hold' : 'idle';
  // she puts her phone back on the coffee table eventually
  if (world.get('phone').parentId === 'aria') {
    agent.enqueue([...agent.planPlace('phone', { kind: 'surface', targetId: 'coffeeTable' })]);
  }
  showScreen('home');
  renderAvatars();
  save();
}

// camera transitions when she needs to move/do things during a call
function enterWatchCamera() {
  if (state.camMode === 'watch') return;
  state.camMode = 'watch';
  // she props the phone: place it at a good vantage near her
  const phone = world.get('phone');
  if (phone.parentId === 'aria') {
    char.releaseGrab('right');
    // choose nearest surface to prop it on
    let best = null, bd = 1e9;
    for (const id of ['coffeeTable', 'desk', 'counter', 'dresser', 'tvStand', 'bookshelf']) {
      const s = world.get(id);
      const p = world.worldPos(s);
      const d = p.distanceTo(char.root.position);
      if (d < bd) { bd = d; best = s; }
    }
    const dp = world.dropPoint(best) || new T.Vector3(0, 0.9, 0);
    world.placeInWorld(phone, dp.clone().setY(dp.y + 0.008), best.id);
    // camera sits just above the propped phone, leaned back for a usable view
    state.proppedPos = dp.clone().setY(Math.max(dp.y + 0.3, 1.05));
  } else {
    state.proppedPos = camera.position.clone();
  }
  triggerFocusPulse();
}
function resumeHeldCamera() {
  if (!state.inCall || state.camMode === 'held') return;
  const phone = world.get('phone');
  const acts = [];
  if (phone.parentId !== 'aria') acts.push(...agent.planPick('phone'));
  acts.push({ type: 'custom', fn: (ag) => { ag.char.arm.right.mode = 'phone'; state.camMode = 'held'; triggerFocusPulse(); return true; } });
  agent.enqueue(acts);
}

function triggerFocusPulse() {
  const el = $('focus-pulse');
  el.classList.remove('hidden');
  el.style.left = (window.innerWidth / 2 - 35) + 'px';
  el.style.top = (window.innerHeight * 0.4) + 'px';
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  setTimeout(() => el.classList.add('hidden'), 750);
}

// ============================================================ camera directives (she aims the phone)
// ordered as a smooth pan around the room, not a zigzag
const TOUR_STOPS = ['tv', 'bookshelf', 'desk', 'bed', 'couch', 'counter', 'fridge'];
agent.onCamera = (a) => {
  const now = performance.now() / 1000;
  state.camDirective = { mode: a.mode, id: a.id || null, until: now + (a.dur ?? 5), start: now };
  triggerFocusPulse();
};

// player drag-to-look on the call screen
(() => {
  let dragging = false, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
  window.addEventListener('pointermove', (e) => {
    if (!dragging || !state.inCall) return;
    state.dragYaw = T.MathUtils.clamp(state.dragYaw - (e.clientX - lx) * 0.004, -0.9, 0.9);
    state.dragPitch = T.MathUtils.clamp(state.dragPitch - (e.clientY - ly) * 0.003, -0.45, 0.45);
    lx = e.clientX; ly = e.clientY;
  });
  window.addEventListener('pointerup', () => { dragging = false; });
})();

// ============================================================ camera update
const camNoise = { t: 0 };
function updateCamera(dt, t) {
  camNoise.t += dt;
  const n = camNoise.t;
  let targetPos, targetLook;

  // active phone-aiming directive?
  const dir = state.camDirective;
  if (dir && performance.now() / 1000 > dir.until) state.camDirective = null;
  if (dir && state.camDirective && state.callConnected) {
    const hw = char.headWorld(new T.Vector3());
    const ry = char.root.rotation.y;
    const f = new T.Vector3(Math.sin(ry), 0, Math.cos(ry));
    const heldPos = hw.clone().addScaledVector(f, 0.55); heldPos.y = hw.y + 0.06;
    if (dir.mode === 'pov') {
      // her point of view — camera at her eyes looking where she looks
      targetPos = hw.clone().addScaledVector(f, 0.12); targetPos.y = hw.y + 0.09;
      targetLook = hw.clone().addScaledVector(f, 3); targetLook.y = hw.y - 0.15;
      camera.fov += (62 - camera.fov) * dt * 3;
    } else {
      let lookAt;
      if (dir.mode === 'roomtour') {
        const idx = Math.min(TOUR_STOPS.length - 1, Math.floor((performance.now() / 1000 - dir.start) / 1.35));
        lookAt = world.worldPos(world.get(TOUR_STOPS[idx])); lookAt.y = Math.max(0.7, lookAt.y);
      } else {
        lookAt = world.worldPos(world.get(dir.id)); lookAt.y = Math.max(0.5, lookAt.y + 0.15);
      }
      // film each stop from the open middle of the room so furniture never blocks the shot
      const toCenter = new T.Vector3(-lookAt.x, 0, -lookAt.z);
      if (toCenter.lengthSq() < 0.01) toCenter.set(0, 0, 1);
      toCenter.normalize();
      targetPos = lookAt.clone().addScaledVector(toCenter, 2.4);
      targetPos.y = 1.45;
      targetPos.x = T.MathUtils.clamp(targetPos.x, -3.6, 3.6);
      targetPos.z = T.MathUtils.clamp(targetPos.z, -2.6, 2.6);
      void heldPos;
      targetLook = lookAt;
      char.setLook(lookAt);
      camera.fov += (56 - camera.fov) * dt * 2;
    }
    const k2 = Math.min(1, dt * 5.5);
    state.camPos.lerp(targetPos, k2);
    state.camLook.lerp(targetLook, Math.min(1, dt * 4.5));
    camera.position.copy(state.camPos);
    camera.lookAt(state.camLook);
    camera.updateProjectionMatrix();
    return;
  }

  if (state.camMode === 'held' || !state.callConnected) {
    const hw = char.headWorld(new T.Vector3());
    const eye = hw.clone(); eye.y += 0.09;               // eye level
    const ry = char.root.rotation.y;                      // anchor on body only (avoids head-tracking feedback)
    const f = new T.Vector3(Math.sin(ry), 0, Math.cos(ry));
    const right = new T.Vector3(f.z, 0, -f.x);
    targetPos = eye.clone().addScaledVector(f, 0.58).addScaledVector(right, 0.04);
    targetPos.y = eye.y + 0.03;
    // handheld micro-sway
    targetPos.x += Math.sin(n * 1.3) * 0.006 + Math.sin(n * 3.7) * 0.003;
    targetPos.y += Math.sin(n * 1.7 + 1) * 0.005 + Math.sin(n * 4.3) * 0.002;
    targetPos.z += Math.cos(n * 1.1) * 0.006;
    targetLook = eye.clone();
    targetLook.y -= 0.05; // frame face + shoulders
    camera.fov += (50 - camera.fov) * dt * 3;
  } else {
    // propped / tripod view watching her act
    const base = state.proppedPos || new T.Vector3(0, 1.4, 2.2);
    targetPos = base.clone();
    const hw = char.headWorld(new T.Vector3());
    // if she's practically on top of the phone, ease the view back so she stays framed
    const flat = new T.Vector3(targetPos.x - hw.x, 0, targetPos.z - hw.z);
    const fd = flat.length();
    if (fd < 1.0 && fd > 0.001) {
      flat.normalize();
      targetPos.x = T.MathUtils.clamp(hw.x + flat.x * 1.0, -3.85, 3.85);
      targetPos.z = T.MathUtils.clamp(hw.z + flat.z * 1.0, -2.85, 2.85);
    }
    targetPos.x += Math.sin(n * 0.8) * 0.002;
    targetPos.y += Math.sin(n * 1.1) * 0.002;
    targetLook = hw.clone().lerp(char.chestWorld(new T.Vector3()), 0.4);
    // slight zoom to keep her framed when far
    const dist = targetPos.distanceTo(hw);
    const wantFov = T.MathUtils.clamp(34 + dist * 8, 42, 64);
    camera.fov += (wantFov - camera.fov) * dt * 1.5;
  }

  // player drag-look: orbit the camera around the subject, gently recentring over time
  if (state.dragYaw || state.dragPitch) {
    const off = targetPos.clone().sub(targetLook);
    off.applyAxisAngle(new T.Vector3(0, 1, 0), state.dragYaw);
    const right = new T.Vector3().crossVectors(off, new T.Vector3(0, 1, 0));
    if (right.lengthSq() > 0.0001) {
      right.normalize();
      off.applyAxisAngle(right, state.dragPitch);
    }
    targetPos = targetLook.clone().add(off);
    state.dragYaw *= 1 - Math.min(1, dt * 0.25);
    state.dragPitch *= 1 - Math.min(1, dt * 0.25);
  }

  const k = Math.min(1, dt * (state.camMode === 'held' ? 7 : 3));
  state.camPos.lerp(targetPos, k);
  state.camLook.lerp(targetLook, Math.min(1, dt * 6));
  camera.position.copy(state.camPos);
  camera.lookAt(state.camLook);
  camera.updateProjectionMatrix();

  // exposure adaptation (fake auto-exposure)
  const lightsOn = world.get('ceilingLight').state.on || world.get('lamp').state.on;
  const curtains = world.get('curtains').state.open;
  const mode = world.daylightMode;
  let targetExp = 1.18;
  if (!lightsOn && mode === 'night') targetExp = curtains ? 2.3 : 3.1;
  else if (!lightsOn) targetExp = curtains ? 1.2 : 2.0;
  else if (mode === 'night') targetExp = 1.4;
  renderer.toneMappingExposure += (targetExp - renderer.toneMappingExposure) * dt * 1.2;
}

// ============================================================ messages UI
function renderThread() {
  const el = $('msg-thread');
  el.innerHTML = '';
  let lastT = 0;
  for (const m of state.messages) {
    if (m.t - lastT > 1000 * 60 * 30) {
      const time = document.createElement('div');
      time.className = 'msg-time';
      time.textContent = new Date(m.t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      el.appendChild(time);
    }
    lastT = m.t;
    const b = document.createElement('div');
    b.className = `bubble ${m.from}`;
    b.textContent = m.text;
    el.appendChild(b);
  }
  scrollThread();
}
function scrollThread() {
  const el = $('msg-thread');
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

// ============================================================ incoming calls & AI-initiated messages
function maybeIncoming(dt) {
  if (state.inCall || !state.settings.incoming || state.screen === 'call') return;
  state.incomingTimer -= dt;
  state.aiMsgTimer -= dt;
  if (state.incomingTimer <= 0) {
    state.incomingTimer = 400 + Math.random() * 500;
    showIncomingCall();
  } else if (state.aiMsgTimer <= 0) {
    state.aiMsgTimer = 500 + Math.random() * 600;
    const ev = memory.recentEvents(null, 1)[0];
    aiSendsMessage(pick([
      ev ? `okay tiny update: ${ev.desc} 😂 life in here is WILD` : 'thinking of rearranging the books… by color or by how much I like them?? this is urgent',
      'okay real question: TV or book tonight?? I cannot decide and it\'s becoming a whole thing 😂',
      memory.facts.playerName ? `heyyy ${memory.facts.playerName}, you around? 👀` : 'heyyy, you around? 👀',
      'me and the plant miss you!! okay mostly me. the plant is famously hard to read 🌱',
      'I just want you to know the apple is still staring at me and I am staying strong 😤',
    ]));
  }
}

let incomingReason = null;
function showIncomingCall() {
  const ev = memory.recentEvents(null, 1)[0];
  incomingReason = ev
    ? pick([`“OKAY so — ${ev.desc}. I had to tell someone!!”`, `“You will NEVER guess what happened. Okay it's small. But still!!”`])
    : pick(['“I found something and you need to see it right now.”', '“EMERGENCY. Okay not emergency. Cushion-related question.”', '“I just miss your face, pick uppp!”']);
  $('incoming-reason').textContent = incomingReason;
  $('incoming').classList.remove('hidden');
  renderAvatars();
  ringtone.start();
}
$('btn-accept').addEventListener('click', () => {
  ringtone.stop();
  $('incoming').classList.add('hidden');
  const ev = memory.recentEvents(null, 1)[0];
  const line = ev
    ? `HI okay okay — you have to hear this — ${ev.desc}!! I KNOW. Biggest news of my entire day 😂`
    : pick(['Heyy!! Honestly? I just wanted to see your face. How are youuu?', 'Hi!! Okay urgent question: cushions like THIS, or like this?? Wait, I\'ll show you.']);
  startCall(true, line);
});
$('btn-decline').addEventListener('click', () => {
  ringtone.stop();
  $('incoming').classList.add('hidden');
  setTimeout(() => aiSendsMessage(pick([
    'noooo you declined me 💔😂 okay okay, call me when you\'re free!!',
    'missed youu! it wasn\'t urgent. okay it was a LITTLE urgent. cushion stuff. you\'ll see.',
  ])), 2500);
});

// ============================================================ UI wiring
$('btn-call').addEventListener('click', () => startCall(false));
$('btn-message').addEventListener('click', () => showScreen('messages'));
$('msg-back').addEventListener('click', () => { showScreen('home'); renderAvatars(); });
$('msg-call-btn').addEventListener('click', () => startCall(false));
$('btn-end').addEventListener('click', endCall);

$('call-send').addEventListener('click', () => {
  const inp = $('call-input');
  handleUtterance(inp.value, 'call');
  inp.value = '';
});
$('call-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { handleUtterance(e.target.value, 'call'); e.target.value = ''; } });

$('msg-send').addEventListener('click', () => {
  const inp = $('msg-input');
  handleUtterance(inp.value, 'msg');
  inp.value = '';
});
$('msg-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { handleUtterance(e.target.value, 'msg'); e.target.value = ''; } });

// mic (push-to-talk toggle)
let listening = false;
$('btn-mic').addEventListener('click', () => {
  if (listening) { voice.stopListening(); return; }
  const ok = voice.startListening(
    (text) => { $('listening-pill').classList.add('hidden'); handleUtterance(text, 'call'); },
    () => { listening = false; $('btn-mic').classList.remove('active-mic'); $('listening-pill').classList.add('hidden'); }
  );
  if (ok) {
    listening = true;
    $('btn-mic').classList.add('active-mic');
    $('listening-pill').classList.remove('hidden');
  } else {
    toast('Speech recognition isn\'t available in this browser — use the text box instead.');
  }
});
$('btn-voice-out').addEventListener('click', (e) => {
  state.settings.tts = !state.settings.tts;
  $('set-tts').checked = state.settings.tts;
  e.currentTarget.classList.toggle('muted', !state.settings.tts);
  if (!state.settings.tts) voice.stop();
});

// settings
$('btn-settings').addEventListener('click', () => {
  $('set-tts').checked = state.settings.tts;
  $('set-captions').checked = state.settings.captions;
  $('set-incoming').checked = state.settings.incoming;
  $('set-apikey').value = dialogue.apiKey || '';
  $('settings').classList.remove('hidden');
});
$('settings-close').addEventListener('click', () => {
  state.settings.tts = $('set-tts').checked;
  state.settings.captions = $('set-captions').checked;
  state.settings.incoming = $('set-incoming').checked;
  const key = $('set-apikey').value.trim();
  dialogue.apiKey = key || null;
  try { key ? localStorage.setItem(KEY_KEY, key) : localStorage.removeItem(KEY_KEY); } catch (e) { /* noop */ }
  $('settings').classList.add('hidden');
  save();
});
$('btn-reset-world').addEventListener('click', () => {
  if (confirm('Reset Aria\'s world and all memories? This cannot be undone.')) {
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  }
});

// ============================================================ home screen live status
setInterval(() => {
  if (state.screen === 'home') {
    $('activity-text').textContent = 'Aria is ' + agent.currentActivity;
    if (state.lastSeenAt) {
      const min = Math.round((Date.now() - state.lastSeenAt) / 60000);
      $('last-seen').textContent = min < 2 ? 'World state: live' : `You were last here ${min < 60 ? min + ' min' : Math.round(min / 60) + ' h'} ago — her world kept going.`;
    } else {
      $('last-seen').textContent = 'A brand-new world just started for you.';
    }
  }
  $('msg-peer-status').textContent = agent.currentActivity;
}, 1500);

// call timer
setInterval(() => {
  if (state.inCall && state.callConnected) {
    const s = Math.floor((performance.now() - state.callStart) / 1000);
    $('call-timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
}, 500);

// ============================================================ main loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.12, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  const camPos = state.inCall ? camera.position : null;
  world.update(dt, t);
  agent.update(dt, t, camPos);
  char.update(dt, t, state.inCall ? camera.position : null);
  maybeIncoming(dt);

  if (state.screen === 'call') {
    updateCamera(dt, t);
    // the video feed appears only once Aria has picked up
    if (state.callConnected) {
      screenGlow.position.copy(camera.position);
      screenGlow.intensity = 0.9;
      renderer.render(world.scene, camera);
    } else {
      screenGlow.intensity = 0;
      renderer.clear();
    }
  }
}

// debug handle (console access)
window.__G = { world, char, agent, nlu, dialogue, memory, state, camera, renderer };

// ============================================================ go
try { dialogue.apiKey = localStorage.getItem(KEY_KEY) || null; } catch (e) { /* noop */ }
load();
requestAnimationFrame(frame);
// initial avatar snapshot once everything has settled a frame
setTimeout(renderAvatars, 400);
setInterval(() => { if (state.screen !== 'call') renderAvatars(); }, 30000);
