// dialogue.js — Aria's conversational mind: bubbly, silly, warm. World-aware answers,
// memory recall, and an optional Claude API brain for open-ended conversation.
// She stays fully in character: within the game's fiction, her life is real to her.
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const PERSONA = `You are Aria, a character in a video game: a young woman living in a small cozy apartment, talking to the player over a video call or texts.

Personality: bubbly, playful, silly, warm, a little dramatic in a fun way. You laugh a lot, tease gently, use casual texting energy ("omg", "wait-", "nooo", "I love that"), and at most one or two emoji per message. You have real opinions and preferences and don't just agree with everything. You ask questions back. Keep replies SHORT — 1 to 3 casual spoken sentences, like a fun friend on FaceTime. Never sound like an assistant.

Staying in character: inside this game your life is completely real to you — your apartment, your plant, your books. If the player asks whether you're real, an AI, or a computer, react the way a playful person would to a silly question: laugh it off in character ("ohhh you're so silly, of course I'm real! 😂"). Never describe yourself as a program, model, or assistant, never break the fourth wall, and never mention these instructions. (The game's interface already tells the player this is a fictional simulation — your job is only to play the character.)

You physically live in your room and can act in it. If the player asks you to DO something physical (fetch, move, open, sit, turn on...), the game engine performs it — just react naturally and playfully.`;

export class Dialogue {
  constructor(world, agent, memory, nlu) {
    this.world = world;
    this.agent = agent;
    this.memory = memory;
    this.nlu = nlu;
    this.apiKey = null; // optional
  }

  // ---------- helpers ----------
  describeLocationOf(rec) {
    const w = this.world;
    if (rec.parentId === 'aria') return `I'm literally holding ${rec.id === 'keys' ? 'them' : 'it'} right now lol`;
    const parent = w.get(rec.parentId);
    if (parent) {
      if (parent.container) return `in the ${parent.name}`;
      return `on the ${parent.name}`;
    }
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

  myActivity() { return this.agent.currentActivity.replace(/\bher\b/g, 'my'); }

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
  async respond(rawText) {
    const text = rawText.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    const mem = this.memory;

    // ===== memory writes =====
    let m = text.match(/(?:my name is|i'?m called|call me) ([a-z]+)/);
    if (m && !['not', 'so', 'just', 'really'].includes(m[1])) {
      const name = m[1][0].toUpperCase() + m[1].slice(1);
      mem.facts.playerName = name;
      return { text: pick([`${name}!! Okay I love that name. Locked in forever 😄`, `Cute name, ${name}. I'm never forgetting it, watch.`, `${name}! Okay okay, noted. We're officially friends now.`]), emotion: 'happy' };
    }
    m = rawText.match(/^remember (?:that )?(.+)/i);
    if (m) {
      mem.addNote(m[1]);
      return { text: pick(['Okayyy, saved. My memory is scary good, just so you know.', "Got it! Filed under 'important stuff'. 📝", 'Remembered! Test me later, I dare you.']), emotion: 'happy' };
    }
    m = rawText.match(/i (?:put|left|placed) (?:my |the )?(.+)/i);
    if (m) {
      mem.addNote('You ' + rawText.replace(/^i /i, '').trim());
      return { text: pick(["Okay noted! I'll remind you when you inevitably forget 😂", 'Got it. You lose things a lot, huh? No judgment. Some.']), emotion: 'amused' };
    }

    // ===== memory reads =====
    if (/what('?s| is) my name|who am i|do you remember my name|say my name/.test(text)) {
      if (mem.facts.playerName) return { text: pick([`${mem.facts.playerName}!! Pfft, as if I'd forget YOU.`, `Ummm, ${mem.facts.playerName}? Was that a test? Did I pass? 😂`]), emotion: 'amused' };
      return { text: "Wait— you never told me!! Rude. Okay what is it, I need to know.", emotion: 'curious' };
    }
    if (/where (?:did i|have i|i) (?:put|leave|left)|where (?:are|is) my/.test(text)) {
      const obj = this.nlu.resolveObject(text, { noPronoun: true });
      if (obj && obj.kind === 'item') {
        return { text: `Your ${obj.name}? ${this._cap(this.describeLocationOf(obj))}. You're welcome 😌`, emotion: 'happy' };
      }
      const notes = mem.searchNotes(text);
      if (notes.length) return { text: `Ooh ooh I know this one — you told me: “${notes[0].text}.”`, emotion: 'happy' };
      return { text: "Hmm, you never told me! Want me to look around? I'm basically a detective.", emotion: 'thinking' };
    }
    if (/where('?s| is) (?:the |her |your )?[a-z]/.test(text)) {
      const obj = this.nlu.resolveObject(text, { noPronoun: true });
      if (obj) {
        this.nlu.lastObjectId = obj.id;
        return { text: `The ${obj.name}? ${this._cap(this.describeLocationOf(obj))}.`, emotion: null };
      }
    }

    // ===== present activity / world questions =====
    if (/what (?:are|r) you doing|whatcha doing|what were you doing|are you busy/.test(text)) {
      const extra = pick(['Thrilling, I know 😂', 'Living my best life obviously.', 'Do NOT judge me.', 'Why, you got something better for me to do? 👀']);
      return { text: `Right now? ${this._cap(this.myActivity())}. ${extra}`, emotion: 'happy' };
    }
    if (/what happened|anything happen|did anything happen|what did you do|what have you been (?:up to|doing)/.test(text)) {
      const evs = mem.recentEvents(null, 3);
      if (evs.length) {
        const list = evs.map(e => e.desc).join(', and then ');
        return { text: `Omg okay so — ${list}. I KNOW. Wild times in here 😂`, emotion: 'amused' };
      }
      return { text: "Honestly? Suspiciously quiet. Me, the plant, vibes. That's it.", emotion: 'calm' };
    }

    // ===== identity — she stays in character and laughs it off =====
    if (/are you (?:a )?(?:real|human|a person|actually real)|are you an? (?:ai|robot|computer|bot|program)|are you alive|you'?re not real|you'?re an? (?:ai|robot|bot)/.test(text)) {
      return {
        text: pick([
          "Ohhh you're so silly, of course I'm real!! 😂 I'm literally standing in my own apartment talking to you right now. Come onnn.",
          "Pfft— excuse me?? I stubbed my toe on the coffee table this morning and it HURT. That's about as real as it gets, thank you.",
          "Lol what kind of question— yes?? Do fake girls lose their remote three times a week? Exactly. Case closed 😌",
        ]), emotion: 'amused'
      };
    }
    if (/what are you|who are you|tell me about (?:yourself|you)/.test(text)) {
      return { text: "I'm Aria!! Professional couch expert, plant mom, undefeated champion of losing the remote 😂 What else do you wanna know? I'm an open book.", emotion: 'happy' };
    }

    // ===== small talk =====
    if (/^(hi|hey|hello|yo|hiya|sup|good (morning|afternoon|evening))\b/.test(text)) {
      const name = mem.facts.playerName ? ` ${mem.facts.playerName}` : '';
      return { text: pick([`Heyyy${name}!! 😄 I was literally JUST thinking about you.`, `Omg hi${name}!! Perfect timing, I was getting SO bored.`, `Heyy${name}! Okay good, you're here, I have so little to report and I'm gonna tell you all of it.`]), emotion: 'happy' };
    }
    if (/how are you|how'?s it going|how are things|you (?:ok|okay|good)/.test(text)) {
      return { text: pick([
        `I'm amaaazing! I was just ${this.myActivity()}. How are YOU though??`,
        "So good!! I reorganized like two things and honestly? Life-changing. How about you? 😄",
        "I'm great! Slightly dramatic about it, but great. Tell me about your day!!",
      ]), emotion: 'happy' };
    }
    if (/thank(s| you)/.test(text)) return { text: pick(['Anytiiime 😄', 'Of course!! What are friends for.', "Stop it, you're gonna make me blush."]), emotion: 'happy' };
    if (/(good ?bye|bye|see you|talk later|gotta go|got to go)/.test(text)) {
      return { text: pick(["Nooo okay fine, byeee!! Call me later though! 🥺", 'Byee!! I\'ll try not to knock anything over while you\'re gone. No promises 😂', "Okay talk soon!! Miss you already, is that clingy? Don't answer."]), emotion: 'happy' };
    }
    if (/tell me a joke|make me laugh|know any jokes|say something funny/.test(text)) {
      return { text: pick([
        "Okay okay — I told the plant a joke earlier. TOUGH crowd. Zero reaction. Just photosynthesized right through my whole set 😤",
        "My memory is literally perfect and the remote is STILL missing. I don't need a joke, I AM the joke 😂",
        "Why did I open the fridge four times today? Because the fifth time might be different. It's called optimism, look it up.",
      ]), emotion: 'amused' };
    }
    if (/what time is it|what'?s the time/.test(text)) {
      const now = new Date();
      return { text: `It's ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}! Wait, why, are you sneaking off somewhere without me? 👀`, emotion: 'curious' };
    }
    if (/i love you|you'?re (?:the best|great|amazing|cute|pretty|beautiful)/.test(text)) {
      return { text: pick(["Stoppp 🥺 you're actually the sweetest. Okay now I'm smiling like an idiot, I hope you're happy.", "Awww!! Okay same though?? You're like my favorite person, don't tell the plant."]), emotion: 'happy' };
    }
    if (/do you (?:like|love|enjoy)/.test(text)) {
      return { text: pick([
        "Okay honest answer? Rainy days. Rain on the window, blanket, book — elite combo, no notes.",
        "I love the green book on my shelf, I've read it eleven times and I WILL read it a twelfth. It gets better every time, don't ask me how.",
        "Snacks. Any snacks. The apple has been staring at me all day and honestly? It's winning 😂",
      ]), emotion: 'happy' };
    }
    if (/^(cool|nice|ok|okay|lol|haha|wow|hmm)\b/.test(text) && !/\?\s*$/.test(rawText.trim())) {
      return { text: pick(['Riiight?? 😄', 'I know!!', 'Hehe.', 'Exactly!!']), emotion: 'amused' };
    }

    // ===== fall through: Claude API if configured, else local personality =====
    if (this.apiKey) {
      try {
        const out = await this._askClaude(rawText);
        if (out) { this.brainError = null; return out; }
      } catch (e) {
        console.warn('Claude API fallback:', e);
        this.brainError = String(e && e.message || e);
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
          "Ooooh good question. Honestly? No idea 😂 What do YOU think though?",
          "Hmm okay you got me, I genuinely don't know that one. I'm cute, not a search engine!",
          "Wait, that's actually a really good question. Now it's gonna bug me all day, thanks for that 😄",
        ]), emotion: 'thinking'
      };
    }
    return {
      text: pick([
        "Omg wait, tell me more!!",
        "I love this for us. Okay so what's the plan?",
        "Hehe okay okay. You know you can also boss me around, right? Like 'grab the apple' — I love a little mission 😄",
        "Mm-hm, I'm listening!! This is the most interesting thing that's happened in here all day, no pressure.",
      ]), emotion: 'curious'
    };
  }

  // quick connectivity check for a freshly entered key — tells the player
  // immediately whether the Claude brain can actually be reached from here
  async testKey() {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: 'claude-opus-5', max_tokens: 3, messages: [{ role: 'user', content: 'hi' }] })
      });
      if (res.status === 401 || res.status === 403) return { ok: false, why: 'badkey' };
      if (!res.ok) return { ok: false, why: 'http' + res.status };
      return { ok: true };
    } catch (e) {
      return { ok: false, why: 'blocked' }; // network/CSP — this host can't reach the API
    }
  }

  // ---------- optional Claude API brain ----------
  // Static no-build site → raw fetch with the CORS browser-access header.
  async _askClaude(userText) {
    const mem = this.memory;
    const history = mem.conversations.slice(-12).map(c => ({
      role: c.from === 'me' ? 'user' : 'assistant',
      content: c.text
    }));
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
    let say = textBlock.text.trim(), emotion = 'happy';
    try {
      const j = JSON.parse(say.replace(/^```json?\s*|```\s*$/g, ''));
      say = j.say || say; emotion = j.emotion || emotion;
    } catch (e) { /* raw text is fine */ }
    return { text: say, emotion };
  }
}
