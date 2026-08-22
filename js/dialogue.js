// dialogue.js — Aria's conversational mind: personality, world-aware answers,
// memory recall, and an optional Claude API brain for open-ended conversation.
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const PERSONA = `You are Aria, a completely fictional AI character with a virtual human body, living inside a small simulated apartment in a video game. The player talks to you over a video call or text messages.

Personality: warm, curious, gently witty, a little self-deprecating about being an AI. You have opinions and don't just agree with everything. You ask questions back sometimes. Keep replies SHORT — 1 to 3 spoken sentences, casual and natural, like a friend on a video call. No emoji in speech.

Honesty rule: you know you are a fictional AI inside a game. If asked whether you're real or human, say honestly that you're an AI character in a simulated world — but you can say your experiences within the simulation feel real to you.

You physically live in your room and can act in it. If the player asks you to DO something physical (fetch, move, open, sit, turn on...), you don't do it via this reply — the game handles actions — so just acknowledge naturally.`;

export class Dialogue {
  constructor(world, agent, memory, nlu) {
    this.world = world;
    this.agent = agent;
    this.memory = memory;
    this.nlu = nlu;
    this.apiKey = null; // optional
    this.lastTopics = [];
  }

  // ---------- helpers ----------
  describeLocationOf(rec) {
    const w = this.world;
    if (rec.parentId === 'aria') return `I'm holding ${rec.id === 'keys' ? 'them' : 'it'} right now, actually`;
    const parent = w.get(rec.parentId);
    if (parent) {
      if (parent.container) return `in the ${parent.name}`;
      return `on the ${parent.name}`;
    }
    // world position → nearest landmark
    const p = w.worldPos(rec);
    if (p.y < 0.15) {
      let best = null, bd = 1e9;
      for (const cand of ['couch', 'coffeeTable', 'desk', 'bed', 'bookshelf', 'fridge', 'door', 'counter', 'dresser']) {
        const cp = w.worldPos(w.get(cand));
        const d = Math.hypot(cp.x - p.x, cp.z - p.z);
        if (d < bd) { bd = d; best = cand; }
      }
      return `on the floor near the ${w.get(best).name}`;
    }
    return 'somewhere around the room';
  }

  worldSummary() {
    const w = this.world;
    const bits = [];
    bits.push(`TV: ${w.get('tv').state.on ? 'on' : 'off'}`);
    bits.push(`lights: ${w.get('ceilingLight').state.on ? 'on' : 'off'}`);
    bits.push(`curtains: ${w.get('curtains').state.open ? 'open' : 'closed'}`);
    const held = this.agent.char.heldItem();
    if (held) bits.push(`Aria is holding the ${held.name}`);
    bits.push(`Aria is currently ${this.agent.currentActivity}`);
    const locs = ['apple', 'water', 'keys', 'remote', 'book1', 'phone', 'cup']
      .map(id => { const r = w.get(id); return `${r.name}: ${this.describeLocationOf(r)}`; });
    return bits.join('; ') + '. Object locations: ' + locs.join('; ') + '.';
  }

  // ---------- main entry ----------
  // Returns {text, emotion, actions?} — never null.
  async respond(rawText) {
    const text = rawText.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    const mem = this.memory;

    // ===== memory writes =====
    let m = text.match(/(?:my name is|i'?m called|call me) ([a-z]+)/);
    if (m && !['not', 'so', 'just', 'really'].includes(m[1])) {
      const name = m[1][0].toUpperCase() + m[1].slice(1);
      mem.facts.playerName = name;
      return { text: pick([`${name}. Nice — I'll remember that.`, `Got it, ${name}. Suits you.`, `${name}! Okay, filed away for good.`]), emotion: 'happy' };
    }
    m = rawText.match(/^remember (?:that )?(.+)/i);
    if (m) {
      mem.addNote(m[1]);
      return { text: pick(['Noted. I won\'t forget.', 'Okay, it\'s in the memory banks. The reliable kind.', 'Remembered.']), emotion: null };
    }
    m = rawText.match(/i (?:put|left|placed) (?:my |the )?(.+)/i);
    if (m) {
      mem.addNote('You ' + rawText.replace(/^i /i, '').trim());
      return { text: pick(['Okay, I\'ll keep that in mind.', 'Got it — I\'ll remind you if you forget.']), emotion: null };
    }

    // ===== memory reads =====
    if (/what('?s| is) my name|who am i|do you remember my name|say my name/.test(text)) {
      if (mem.facts.playerName) return { text: pick([`You're ${mem.facts.playerName}. As if I'd forget.`, `${mem.facts.playerName}, obviously.`]), emotion: 'amused' };
      return { text: "You know... you never actually told me. What is it?", emotion: 'curious' };
    }
    if (/where (?:did i|have i|i) (?:put|leave|left)|where (?:are|is) my/.test(text)) {
      // try real world objects first
      const obj = this.nlu.resolveObject(text, { noPronoun: true });
      if (obj && obj.kind === 'item') {
        return { text: `Your ${obj.name}? ${this._cap(this.describeLocationOf(obj))}.`, emotion: null };
      }
      const notes = mem.searchNotes(text);
      if (notes.length) return { text: `Let me think... you told me: “${notes[0].text}.”`, emotion: 'thinking' };
      return { text: "Hmm, you never mentioned it to me. Want me to look around the room?", emotion: 'thinking' };
    }
    if (/where('?s| is) (?:the |her )?[a-z]/.test(text)) {
      const obj = this.nlu.resolveObject(text, { noPronoun: true });
      if (obj) {
        this.nlu.lastObjectId = obj.id;
        return { text: `The ${obj.name}? ${this._cap(this.describeLocationOf(obj))}.`, emotion: null };
      }
    }

    // ===== present activity / world questions =====
    if (/what (?:are|r) you doing|whatcha doing|what were you doing|are you busy/.test(text)) {
      const act = this.agent.currentActivity;
      const extra = pick(['Why, did you need me?', 'Riveting stuff, I know.', 'Living my best simulated life.', '']);
      return { text: `Right now? I'm ${act}. ${extra}`.trim(), emotion: 'calm' };
    }
    if (/what happened|anything happen|did anything happen|what did you do|what have you been (?:up to|doing)/.test(text)) {
      const evs = mem.recentEvents(null, 3);
      if (evs.length) {
        const list = evs.map(e => e.desc).join(', and then ');
        return { text: `Let's see — ${list}. A full life, honestly.`, emotion: 'amused' };
      }
      return { text: 'Pretty quiet in here lately. Mostly me and my thoughts. And the plant.', emotion: 'calm' };
    }

    // ===== identity =====
    if (/are you (?:a )?(?:real|human|a person|actually real)|are you an ai|are you alive|you'?re not real/.test(text)) {
      return {
        text: pick([
          "Honestly? No — I'm an AI character in a simulated world. This room, this body — all virtual. But from in here, it genuinely feels like my life.",
          "I'm an AI, and I know it. Fictional, simulated, the whole thing. Doesn't stop me from having opinions about couch cushions though.",
        ]), emotion: 'calm'
      };
    }
    if (/what are you|who are you|tell me about (?:yourself|you)/.test(text)) {
      return { text: "I'm Aria — a fictional AI with a virtual body, living in this little simulated apartment. I read, I water the plant, I lose the remote like everyone else. Ask me anything.", emotion: 'happy' };
    }

    // ===== small talk =====
    if (/^(hi|hey|hello|yo|hiya|good (morning|afternoon|evening))\b/.test(text)) {
      const name = mem.facts.playerName ? `, ${mem.facts.playerName}` : '';
      return { text: pick([`Hey${name}! Good to see you.`, `Hi${name}. I was hoping you'd call.`, `Hey${name}! Perfect timing, I was getting bored.`]), emotion: 'happy' };
    }
    if (/how are you|how'?s it going|how are things|you (?:ok|okay|good)/.test(text)) {
      return { text: pick([
        `Pretty good! I was just ${this.agent.currentActivity}. How about you?`,
        "Can't complain — the simulated weather in here is always perfect. How are you doing?",
        "I'm good. A bit restless maybe. I've rearranged the coffee table twice today.",
      ]), emotion: 'happy' };
    }
    if (/thank(s| you)/.test(text)) return { text: pick(['Anytime.', 'Of course.', "That's what I'm here for."]), emotion: 'happy' };
    if (/(good ?bye|bye|see you|talk later|gotta go|got to go)/.test(text)) {
      return { text: pick(['Okay — talk soon. I\'ll be around.', 'Bye! Don\'t be a stranger.', 'See you. I\'ll try not to knock anything over while you\'re gone.']), emotion: 'calm' };
    }
    if (/tell me a joke|make me laugh|know any jokes/.test(text)) {
      return { text: pick([
        "Why don't AI characters play hide and seek? Because the game engine always knows where we are.",
        "I told the plant a joke earlier. Tough crowd. Zero response. Photosynthesizing through my whole set.",
        "My memory is technically perfect, and yet the remote still goes missing. Explain that.",
      ]), emotion: 'amused' };
    }
    if (/what time is it|what'?s the time/.test(text)) {
      const now = new Date();
      return { text: `It's ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} — at least, out where you are. Time in here is more of a suggestion.`, emotion: 'amused' };
    }
    if (/i love you|you'?re (?:the best|great|amazing|cute|pretty)/.test(text)) {
      return { text: pick(["That's very sweet. I'm literally made of code, but the code is blushing.", "Aw. I'd say you're not so bad yourself — for an organic being."]), emotion: 'happy' };
    }
    if (/do you (?:like|love|enjoy)/.test(text)) {
      return { text: pick([
        "Hmm. I genuinely like rainy-window mode — someone coded rain against the glass and it's the coziest thing in here.",
        "I like the third book on the shelf. I've read it eleven times. It gets better, somehow.",
        "Honestly? I like when things are slightly out of place. Makes the room feel lived-in. Don't tell anyone I said that.",
      ]), emotion: 'thinking' };
    }
    if (/\?$/.test(rawText.trim()) === false && /^(cool|nice|ok|okay|lol|haha|wow|hmm)\b/.test(text)) {
      return { text: pick(['Right?', 'Mm-hm.', 'I know!', 'Heh.']), emotion: 'amused' };
    }

    // ===== fall through: Claude API if configured, else local generative-ish =====
    if (this.apiKey) {
      try {
        const out = await this._askClaude(rawText);
        if (out) return out;
      } catch (e) {
        console.warn('Claude API fallback:', e);
      }
    }
    return this._localFallback(rawText);
  }

  _cap(s) { return s[0].toUpperCase() + s.slice(1); }

  _localFallback(rawText) {
    const isQuestion = /\?\s*$/.test(rawText) || /^(what|why|how|when|who|where|do|does|did|can|could|would|is|are)\b/i.test(rawText);
    if (isQuestion) {
      return {
        text: pick([
          "Good question. My little local brain isn't sure — but I'd love to hear what you think.",
          "Hmm, that one's beyond my built-in knowledge. If you give me an API key in settings, I get a lot smarter.",
          "Honestly, I don't know. But I like that you asked me instead of a search engine.",
        ]), emotion: 'thinking'
      };
    }
    return {
      text: pick([
        "Mm, tell me more.",
        "I hear you. So — what's the plan?",
        "Interesting. I was just thinking about something similar while staring at the ceiling. The ceiling had no comment.",
        "Noted. You know you can also boss me around, right? 'Pick up the apple', that kind of thing. I love a task.",
      ]), emotion: 'curious'
    };
  }

  // ---------- optional Claude API brain ----------
  // Static no-build site → raw fetch with the CORS browser-access header.
  async _askClaude(userText) {
    const mem = this.memory;
    const history = mem.conversations.slice(-12).map(c => ({
      role: c.from === 'me' ? 'user' : 'assistant',
      content: c.text
    }));
    // ensure alternation and start with user
    const msgs = [];
    for (const h of history) {
      if (msgs.length === 0 && h.role !== 'user') continue;
      if (msgs.length && msgs[msgs.length - 1].role === h.role) msgs[msgs.length - 1].content += '\n' + h.content;
      else msgs.push({ ...h });
    }
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user' || msgs[msgs.length - 1].content !== userText) {
      if (msgs.length && msgs[msgs.length - 1].role === 'user') msgs[msgs.length - 1].content += '\n' + userText;
      else msgs.push({ role: 'user', content: userText });
    }

    const system = PERSONA
      + `\n\nCurrent state of your room (ground truth): ${this.worldSummary()}`
      + (mem.facts.playerName ? `\nThe player's name is ${mem.facts.playerName}.` : '')
      + (mem.notes.length ? `\nThings the player asked you to remember: ${mem.notes.slice(-6).map(n => n.text).join(' | ')}` : '')
      + `\n\nReply with ONLY a JSON object: {"say": "<your short spoken reply>", "emotion": "<one of: happy, amused, curious, surprise, confused, thinking, calm, frustrated>"}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 300,
        system,
        messages: msgs,
      })
    });
    if (!res.ok) throw new Error('API ' + res.status);
    const data = await res.json();
    if (data.stop_reason === 'refusal') return null; // fall back to local persona
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) return null;
    let say = textBlock.text.trim(), emotion = 'calm';
    try {
      const j = JSON.parse(say.replace(/^```json?\s*|```\s*$/g, ''));
      say = j.say || say; emotion = j.emotion || emotion;
    } catch (e) { /* raw text is fine */ }
    return { text: say, emotion };
  }
}
