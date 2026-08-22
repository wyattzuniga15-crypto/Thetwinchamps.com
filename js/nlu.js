// nlu.js — natural language understanding: verbs, object resolution,
// pronoun/context tracking, multi-action sentences → agent plans.
import * as THREE from '../vendor/three.module.js';
const T = THREE;

const VERB_STARTERS = [
  'pick', 'grab', 'take', 'get', 'fetch', 'hold', 'put', 'place', 'set', 'move', 'bring', 'drop',
  'open', 'close', 'shut', 'turn', 'switch', 'sit', 'stand', 'go', 'walk', 'come', 'look', 'watch',
  'clean', 'tidy', 'organize', 'organise', 'water', 'throw', 'toss', 'give', 'show', 'wave', 'dance',
  'lie', 'read', 'check', 'grabme', 'stop', 'wait', 'toggle',
  'jump', 'spin', 'clap', 'stretch', 'flex', 'blow', 'flip', 'point', 'do'
];

const CONFIRMS = [
  'Okiii, on it!! 💪', 'Yesss, watch this.', 'Ooh, a mission! Love it.', 'Say less 😄',
  'One sec one sec!!', 'Okay okay, doing it now!', 'Hehe okay, watch me go.'
];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class NLU {
  constructor(world, agent, memory) {
    this.world = world;
    this.agent = agent;
    this.memory = memory;
    this.lastObjectId = null;   // "it"
    this.lastPlaceId = null;    // "there"
  }

  // ---------- helpers ----------
  _norm(text) {
    return text.toLowerCase()
      .replace(/[?!.]+/g, ' ')
      .replace(/\bplease\b|\bcould you\b|\bcan you\b|\bwould you\b|\bwill you\b|\bfor me\b|\bgo ahead and\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _splitClauses(text) {
    // split on "then" and on and/commas followed by a verb
    let parts = text.split(/\s*(?:,?\s*and\s+then|,?\s*then)\s+/);
    const out = [];
    for (const part of parts) {
      let sub = part.split(/\s*(?:,|\band\b)\s+/);
      // re-join fragments that don't start with a verb (they belong to the previous clause)
      let cur = '';
      for (const s of sub) {
        const first = s.trim().split(' ')[0];
        if (cur && !VERB_STARTERS.includes(first)) cur += ' and ' + s;
        else { if (cur) out.push(cur); cur = s; }
      }
      if (cur) out.push(cur);
    }
    return out.map(s => s.trim()).filter(Boolean);
  }

  resolveObject(phrase, opts = {}) {
    const w = this.world;
    phrase = ' ' + phrase + ' ';
    // pronouns
    if (/\s(it|that|this|them|the thing)\s/.test(phrase) && this.lastObjectId && !opts.noPronoun) {
      const rec = w.get(this.lastObjectId);
      if (rec) return rec;
    }
    let best = null, bestLen = 0;
    for (const rec of Object.values(w.objects)) {
      for (const alias of rec.aliases) {
        if (phrase.includes(' ' + alias + ' ') && alias.length > bestLen) {
          // prefer objects Aria can act on; tie-break by proximity
          best = rec; bestLen = alias.length;
        }
      }
    }
    if (best) return best;
    return null;
  }

  resolvePlace(phrase) {
    // returns {kind:'surface'|'container'|'floor'|'near', targetId, nearId} or null
    const w = this.world;
    const p = ' ' + phrase + ' ';
    if (/\son the floor\s|\sdown\s*$/.test(p)) return { kind: 'floor' };
    if (/\sback\s/.test(p)) return { kind: 'home' };
    // "next to the X" / "beside the X" / "near the X"
    const nextTo = phrase.match(/(?:next to|beside|near|by) (?:the |my |her )?([a-z ]+)/);
    if (nextTo) {
      const nearRec = this.resolveObject(nextTo[1], { noPronoun: false });
      if (nearRec) {
        // find which surface it's on
        const parent = w.get(nearRec.parentId);
        if (parent && parent.surface) return { kind: 'surface', targetId: parent.id, nearId: nearRec.id };
        return { kind: 'floor', at: w.worldPos(nearRec).toArray() };
      }
    }
    const inMatch = phrase.match(/(?:in|into|inside) (?:the |her )?([a-z ]+)/);
    if (inMatch) {
      const rec = this.resolveObject(inMatch[1]);
      if (rec && rec.container) return { kind: 'container', targetId: rec.id };
      if (rec) return { kind: 'surface', targetId: rec.id };
    }
    const onMatch = phrase.match(/(?:on|onto|on top of) (?:the |her )?([a-z ]+)/);
    if (onMatch) {
      const rec = this.resolveObject(onMatch[1]);
      if (rec && rec.surface) return { kind: 'surface', targetId: rec.id };
      if (rec && rec.container) return { kind: 'container', targetId: rec.id };
    }
    if (/\sthere\s|\sover there\s/.test(p) && this.lastPlaceId) {
      const rec = w.get(this.lastPlaceId);
      if (rec?.surface) return { kind: 'surface', targetId: rec.id };
    }
    return null;
  }

  heldOrLast() {
    const held = this.agent.char.heldItem();
    if (held) return held;
    if (this.lastObjectId) return this.world.get(this.lastObjectId);
    return null;
  }

  // ---------- main entry: returns {actions, reply} or null if conversational ----------
  parse(rawText) {
    const text = this._norm(rawText);
    const clauses = this._splitClauses(text);
    const allActions = [];
    let matchedAny = false;
    let reply = null;
    let failReply = null;

    for (const clause of clauses) {
      const res = this._parseClause(clause);
      if (res === null) continue;
      matchedAny = true;
      if (res.fail) { failReply = res.fail; continue; }
      if (res.actions) allActions.push(...res.actions);
      if (res.reply) reply = res.reply;
    }

    if (!matchedAny) return null;
    if (failReply && allActions.length === 0) return { actions: [], reply: failReply };
    return { actions: allActions, reply: reply || { text: pick(CONFIRMS), emotion: null } };
  }

  _parseClause(c) {
    const ag = this.agent, w = this.world;
    const cw = ' ' + c + ' ';

    // ---- stop / cancel
    if (/^(stop|cancel|never mind|nevermind|forget it|stand still)/.test(c)) {
      ag.clearTasks();
      return { actions: [], reply: { text: pick(['Okay, stopping.', 'Alright, never mind then.', 'Okay.']), emotion: null } };
    }

    // ---- lights / TV / lamp / laptop on-off
    const onOff = c.match(/(?:turn|switch|put) (?:on |off )?(?:the |her )?([a-z ]+?)(?: (on|off))?\s*$/);
    if (/(turn|switch)/.test(c) && (cw.includes(' on ') || cw.includes(' off ') || / (on|off)$/.test(c))) {
      const wantOn = / on( |$)/.test(cw) && !/ off( |$)/.test(cw);
      let target = null;
      if (onOff) target = this.resolveObject(onOff[1] + ' ');
      if (!target) target = this.resolveObject(c);
      if (target && target.toggleable) {
        this.lastObjectId = target.id;
        if (!!target.state.on === wantOn) {
          return { actions: [], reply: { text: `The ${target.name} is already ${wantOn ? 'on' : 'off'}.`, emotion: 'amused' } };
        }
        return { actions: [{ type: 'goToObj', id: target.id }, { type: 'toggle', id: target.id, on: wantOn }] };
      }
      if (target && target.id === 'curtains') {
        return { actions: [{ type: 'goToObj', id: 'curtains' }, { type: 'open', id: 'curtains', open: wantOn }] };
      }
      if (/light/.test(c)) {
        const t2 = w.get('ceilingLight');
        return { actions: [{ type: 'goTo', x: 0.4, z: 0.2, range: 0.9 }, { type: 'toggle', id: t2.id, on: wantOn }] };
      }
      return { fail: { text: "Hmm, I'm not sure what you want me to switch.", emotion: 'confused' } };
    }

    // ---- open / close
    const oc = c.match(/^(open|close|shut) (?:up )?(?:the |her )?(.+)$/);
    if (oc) {
      const open = oc[1] === 'open';
      const target = this.resolveObject(oc[2]) || this.resolveObject(c);
      if (target && target.openable) {
        this.lastObjectId = target.id;
        if (!!target.state.open === open) {
          return { actions: [], reply: { text: `The ${target.name} ${target.id === 'curtains' ? 'are' : 'is'} already ${open ? 'open' : 'closed'}.`, emotion: 'amused' } };
        }
        const acts = [{ type: 'goToObj', id: target.id }, { type: 'open', id: target.id, open }];
        if (target.id === 'curtains') acts[0] = { type: 'goTo', x: 3.2, z: 0.6, range: 0.4 };
        return { actions: acts };
      }
      return { fail: { text: `I don't think I can ${oc[1]} that.`, emotion: 'confused' } };
    }

    // ---- water the plant
    if (/water (?:the |her )?(plant|plants|flower)/.test(c) || /give (?:the )?plant.*water/.test(c)) {
      const plant = /small|little/.test(c) ? 'plant2' : 'plant';
      this.lastObjectId = plant;
      const holding = ag.char.heldItem();
      const acts = [];
      if (!holding || (holding.id !== 'water' && holding.id !== 'cup')) {
        if (holding) acts.push({ type: 'place', id: holding.id, dest: { kind: 'floor' } });
        acts.push(...ag.planPick('water'));
      }
      acts.push({ type: 'goToObj', id: plant }, { type: 'water', id: plant });
      return { actions: acts, reply: { text: pick(['Good idea — it was looking thirsty.', 'On it. Plants first, always.']), emotion: 'happy' } };
    }

    // ---- clean / tidy
    if (/^(clean|tidy|organize|organise)/.test(c) || /clean (?:up )?(?:the )?room/.test(c)) {
      const { acts, count } = ag.planTidy(5);
      if (!count) return { actions: [], reply: { text: 'Honestly? The room is already pretty tidy. I keep on top of it.', emotion: 'amused' } };
      return {
        actions: [{ type: 'setActivity', desc: 'cleaning up the room', name: 'tidy' }, ...acts],
        reply: { text: `Okay — I can see ${count} thing${count > 1 ? 's' : ''} out of place. Give me a minute.`, emotion: null }
      };
    }

    // ---- throw
    const thr = c.match(/^(?:throw|toss) (?:the |her |that |it )?([a-z ]*?)(?:\s+(?:at|to|into|in|onto|on) (?:the |her )?([a-z ]+))?$/);
    if (thr) {
      let obj = thr[1] ? this.resolveObject(thr[1] + ' ') : this.heldOrLast();
      if (!obj || !obj.holdable) obj = this.heldOrLast();
      if (!obj) return { fail: { text: 'Throw what, exactly?', emotion: 'confused' } };
      this.lastObjectId = obj.id;
      const targetRec = thr[2] ? this.resolveObject(thr[2] + ' ') : null;
      const acts = [];
      if (ag.char.heldItem() !== obj) acts.push(...ag.planPick(obj.id));
      acts.push({ type: 'throw', id: obj.id, targetId: targetRec?.id });
      return { actions: acts, reply: { text: pick(['Heads up!', 'Okay but if this breaks something, that\'s on you.', 'Incoming!']), emotion: 'amused' } };
    }

    // ---- give / show / bring to camera (small holdables only — rooms and
    // furniture fall through to the camera branches below)
    if (/^(?:give me|show me|bring me|show|hold up) /.test(c) && !/room|apartment|place|around|tour|view|what you see/.test(c)) {
      const obj = this.resolveObject(c) || this.heldOrLast();
      if (obj && obj.holdable) {
        this.lastObjectId = obj.id;
        const acts = [];
        if (ag.char.heldItem() !== obj) acts.push(...ag.planPick(obj.id));
        acts.push({ type: 'show', id: obj.id, dur: 2.5 });
        return { actions: acts, reply: { text: pick(['Here, look!!', 'This one? Ta-daa 😄', 'Presenting… this!']), emotion: 'happy' } };
      }
      // not a holdable — fall through to the camera branches below
    }

    // ---- pick up / grab / take
    if (/^(?:pick up|pick|grab|take(?: out)?|get|fetch|hold) /.test(c)) {
      const obj = this.resolveObject(c);
      if (!obj) return { fail: { text: "Wait, which thing?? 😅 I looked around and I'm not sure which one you mean!", emotion: 'confused' } };
      if (!obj.holdable) {
        if (obj.holdableHeavy) {
          return { fail: { text: `Ooh the ${obj.name}'s kinda heavy — but I can totally drag it! Just tell me where 💪`, emotion: 'happy' } };
        }
        return { fail: { text: `LOL I cannot pick up the whole ${obj.name}?? I'm strong but I'm not THAT strong 😂`, emotion: 'amused' } };
      }
      if (ag.char.heldItem() === obj) return { actions: [], reply: { text: `I'm already holding the ${obj.name}.`, emotion: 'amused' } };
      this.lastObjectId = obj.id;
      const acts = [];
      const held = ag.char.heldItem();
      if (held) acts.push({ type: 'place', id: held.id, dest: { kind: 'floor' } });
      acts.push(...ag.planPick(obj.id));
      return { actions: acts };
    }

    // ---- put / place / move / bring / set / drop
    if (/^(?:put|place|set|move|bring|drop|leave) /.test(c) || /^(?:actually,? )?(?:move|put) /.test(c)) {
      // resolve the object from the words BEFORE the destination preposition,
      // so "move the chair next to the couch" targets the chair, not the couch
      const seg = c.match(/^(?:actually,? )?(?:put|place|set|move|bring|drop|leave) (?:the |her |that |this |my )?(.+?)(?: (?:to|on|onto|in|into|inside|next|near|by|beside|over|toward|towards|down|back|there)\b.*)?$/);
      let obj = seg ? this.resolveObject(seg[1]) : null;
      if (!obj) obj = this.resolveObject(c);
      const held = ag.char.heldItem();
      // "put it ..." → held item or last mentioned
      if (!obj || (!obj.holdable && !obj.holdableHeavy && held)) obj = held || this.heldOrLast();
      if (!obj) return { fail: { text: 'Move what? Point me at a thing.', emotion: 'confused' } };
      if (!obj.holdable && obj.holdableHeavy) {
        // heavy things get dragged/pushed rather than carried
        this.lastObjectId = obj.id;
        let pt = null;
        const destRec = this.resolvePlace(c);
        if (destRec && destRec.targetId) {
          const target = w.get(destRec.targetId);
          const ap = ag.approachPoint(target);
          pt = { x: ap.x, z: ap.z };
        } else {
          const near = c.match(/(?:to|toward|towards|next to|near|by|over to) (?:the |her )?([a-z ]+)/);
          if (near) {
            const target = this.resolveObject(near[1] + ' ');
            if (target) { const ap = ag.approachPoint(target); pt = { x: ap.x, z: ap.z }; }
          }
        }
        if (!pt) return { fail: { text: `Where should I drag the ${obj.name} to?`, emotion: 'curious' } };
        return {
          actions: [{ type: 'goToObj', id: obj.id }, { type: 'push', id: obj.id, x: pt.x, z: pt.z }],
          reply: { text: pick(['Okay — it\'s heavier than it looks, but fine.', 'Sure, let me drag it over.']), emotion: null }
        };
      }
      if (!obj.holdable) return { fail: { text: `The ${obj.name} isn't really something I can carry.`, emotion: 'amused' } };
      this.lastObjectId = obj.id;

      if (/^drop( it| that)?$/.test(c)) {
        if (held !== obj) return { fail: { text: "I'm not holding anything right now.", emotion: 'confused' } };
        return { actions: [{ type: 'place', id: obj.id, dest: { kind: 'floor' } }] };
      }

      let dest = this.resolvePlace(c);
      if (dest?.kind === 'home') {
        const hp = w.get(obj.home.parentId);
        dest = hp && hp.container ? { kind: 'container', targetId: hp.id }
          : hp && hp.surface ? { kind: 'surface', targetId: hp.id, at: obj.home.pos }
          : { kind: 'floor', at: obj.home.pos };
      }
      if (!dest) return { fail: { text: `Where should I put the ${obj.name}?`, emotion: 'curious' } };
      if (dest.targetId) this.lastPlaceId = dest.targetId;

      const acts = [];
      if (held && held !== obj) acts.push({ type: 'place', id: held.id, dest: { kind: 'floor' } });
      if (ag.char.heldItem() !== obj) acts.push(...ag.planPick(obj.id));
      acts.push(...ag.planPlace(obj.id, dest));
      return { actions: acts };
    }

    // ---- sit
    if (/^(?:go )?sit/.test(c) || /sit down/.test(c)) {
      let seat = this.resolveObject(c);
      if (!seat || !seat.sittable) seat = w.get(/desk|chair/.test(c) ? 'chair' : /bed/.test(c) ? 'bed' : 'couch');
      this.lastPlaceId = seat.id;
      return { actions: [{ type: 'goToObj', id: seat.id }, { type: 'sit', id: seat.id }] };
    }
    if (/^(?:stand|get) up/.test(c) || c === 'stand') {
      return { actions: [{ type: 'stand' }] };
    }

    // ---- lie on bed
    if (/^(?:go )?(?:lie|lay) (?:down|on)/.test(c)) {
      return { actions: [{ type: 'goToObj', id: 'bed' }, { type: 'sit', id: 'bed' }], reply: { text: 'A little rest never hurt anyone.', emotion: 'calm' } };
    }

    // ---- go to / walk / come here
    if (/^(?:go|walk|come|head) /.test(c) || c === 'come here') {
      if (/window|outside/.test(c)) {
        return { actions: [{ type: 'goTo', x: 3.2, z: 0.6 }, { type: 'face', point: new T.Vector3(4, 1.5, 0.6) }, { type: 'look', id: 'window', dur: 4 }] };
      }
      if (/here|camera|closer|to me/.test(c)) {
        return { actions: [{ type: 'custom', fn: (agent) => { const cp = agent._camPos; if (cp) { agent.enqueueFront([{ type: 'goTo', x: THREE.MathUtils.clamp(cp.x, -3.7, 3.7), z: THREE.MathUtils.clamp(cp.z, -2.7, 2.7), range: 0.7 }]); } return true; } }], reply: { text: pick(['Coming.', 'On my way.']), emotion: 'happy' } };
      }
      const target = this.resolveObject(c);
      if (target) {
        this.lastPlaceId = target.id;
        const acts = [{ type: 'goToObj', id: target.id }];
        if (target.sittable && /sit/.test(c)) acts.push({ type: 'sit', id: target.id });
        return { actions: acts };
      }
      if (/kitchen/.test(c)) return { actions: [{ type: 'goTo', x: -3.0, z: 0.5 }] };
      if (/door/.test(c)) return { actions: [{ type: 'goToObj', id: 'door' }] };
      return { fail: { text: 'Go where?', emotion: 'curious' } };
    }

    // ---- look
    if (/^(?:look|watch|check) /.test(c)) {
      if (/outside|window/.test(c)) {
        return { actions: [{ type: 'goTo', x: 3.2, z: 0.6, range: 0.4 }, { type: 'face', point: new T.Vector3(4, 1.5, 0.6) }, { type: 'look', id: 'window', dur: 5 }], reply: { text: null } };
      }
      if (/at me|camera|here/.test(c)) {
        return { actions: [{ type: 'look', id: 'camera', dur: 3 }], reply: { text: pick(['Hi there.', 'Yes?']), emotion: 'happy' } };
      }
      if (/tv|television/.test(c)) {
        const acts = [];
        if (!w.get('tv').state.on) acts.push({ type: 'goToObj', id: 'tv' }, { type: 'toggle', id: 'tv', on: true });
        acts.push({ type: 'sit', id: 'couch' }, { type: 'look', id: 'tv', dur: 15 });
        return { actions: acts };
      }
      const target = this.resolveObject(c);
      if (target) {
        this.lastObjectId = target.id;
        return { actions: [{ type: 'goToObj', id: target.id }, { type: 'look', id: target.id, dur: 3 }] };
      }
      return null; // let dialogue handle it
    }

    // ---- read
    if (/^read/.test(c)) {
      const book = this.resolveObject(c) || w.get('book1');
      const acts = [];
      if (ag.char.heldItem() !== book) acts.push(...ag.planPick(book.id));
      acts.push({ type: 'sit', id: 'couch' }, { type: 'custom', fn: (agent, d2, t2) => { const p = agent.char.gripWorld('right', new T.Vector3()); agent.char.setLook(p); agent._rT = agent._rT || t2; if (t2 - agent._rT > 8) { agent._rT = 0; agent.char.setLook(null); return true; } return false; } });
      return { actions: acts, reply: { text: 'Mm, I was in the middle of a good chapter anyway.', emotion: 'calm' } };
    }

    // ---- gestures (full-body moves)
    if (/^wave|say hi/.test(c)) return { actions: [{ type: 'look', id: 'camera', dur: 0.5 }, { type: 'gesture', name: 'wave', dur: 1.8 }], reply: { text: pick(['Hiii!! 👋', 'Heyyy!!']), emotion: 'happy' } };
    if (/^dance|do a (?:little )?dance|show me your moves|bust a move/.test(c)) {
      const acts = [];
      if (ag.sittingOn) acts.push({ type: 'stand' });
      acts.push({ type: 'look', id: 'camera', dur: 0.4 }, { type: 'gesture', name: 'dance', dur: 4.4 });
      return { actions: acts, reply: { text: pick(["Okay okay watch — I've been practicing 😂", 'Ooh yes!! DJ, drop the imaginary beat!', "Fair warning, I'm gonna be SO good at this."]), emotion: 'amused' } };
    }
    if (/^jump/.test(c)) {
      const acts = [];
      if (ag.sittingOn) acts.push({ type: 'stand' });
      acts.push({ type: 'gesture', name: 'jump', dur: 1.4 });
      return { actions: acts, reply: { text: pick(['Wheee!!', 'Boing!! 😂', 'Okay that was fun, again?']), emotion: 'happy' } };
    }
    if (/^spin|twirl|turn around/.test(c)) {
      const acts = [];
      if (ag.sittingOn) acts.push({ type: 'stand' });
      acts.push({ type: 'gesture', name: 'spin', dur: 1.2 });
      return { actions: acts, reply: { text: pick(['Wheeee~', 'Twirl!! ✨', 'Okay I got dizzy. Worth it.']), emotion: 'happy' } };
    }
    if (/^clap|applaud/.test(c)) return { actions: [{ type: 'gesture', name: 'clap', dur: 2 }], reply: { text: pick(['Yayyy!! 👏', 'Round of applause!!']), emotion: 'happy' } };
    if (/^stretch/.test(c)) return { actions: [{ type: 'gesture', name: 'stretch', dur: 2.3 }], reply: { text: 'Mmmph— okay wow, I needed that.', emotion: 'calm' } };
    if (/^flex|muscles|how strong/.test(c)) return { actions: [{ type: 'gesture', name: 'flex', dur: 2.2 }], reply: { text: pick(['Absolute unit. Fear me 😤😂', 'These? Oh these are from carrying the water bottle.']), emotion: 'amused' } };
    if (/blow (?:me )?a kiss|^kiss/.test(c)) return { actions: [{ type: 'look', id: 'camera', dur: 0.4 }, { type: 'gesture', name: 'kiss', dur: 1.9 }], reply: { text: 'Mwah!! 😘 Catch it, don\'t waste it.', emotion: 'happy' } };
    if (/^point at me|point at the camera/.test(c)) return { actions: [{ type: 'gesture', name: 'point', dur: 1.6 }], reply: { text: 'YOU. Yeah, you 😄', emotion: 'amused' } };

    // ---- camera control (she aims the phone)
    if (/show me (?:the |your )?(?:room|apartment|place)|look around|show me around|give me a tour/.test(c)) {
      return { actions: [{ type: 'camera', mode: 'roomtour', dur: 9 }], reply: { text: pick(['Okay okay, welcome to my humble kingdom!! 😄', 'Grand tour time!! It takes like nine seconds, brace yourself.']), emotion: 'happy' } };
    }
    if (/flip the camera|show me (?:your view|what you see)|what do you see/.test(c)) {
      return { actions: [{ type: 'camera', mode: 'pov', dur: 6 }], reply: { text: pick(['Okay, flipping it — THIS is my view.', "Here, look what I'm looking at!"]), emotion: 'happy' } };
    }
    const showObj = c.match(/^show me (?:the |your )?([a-z ]+)$/);
    if (showObj) {
      const target = this.resolveObject(showObj[1] + ' ');
      if (target && !target.holdable) {
        this.lastObjectId = target.id;
        return { actions: [{ type: 'camera', mode: 'point', id: target.id, dur: 5 }], reply: { text: pick([`Ta-daa, the ${target.name}!`, `Behold… the ${target.name} 😄`]), emotion: 'happy' } };
      }
      // small holdables are handled by the give/show branch above
    }

    return null; // conversational — dialogue engine takes it
  }
}
