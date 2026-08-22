// memory.js — Aria's long-term memory: facts about the player, free-form notes,
// an event journal of her virtual life, and conversation history.
export class Memory {
  constructor() {
    this.facts = {};            // playerName, likes, etc.
    this.notes = [];            // [{text, t}]
    this.events = [];           // [{t, desc, offline}]
    this.conversations = [];    // [{from:'me'|'ai', text, t}]
    this.meta = { firstMet: Date.now(), callCount: 0 };
  }

  logEvent(desc, offline = false) {
    this.events.push({ t: Date.now(), desc, offline });
    if (this.events.length > 60) this.events.splice(0, this.events.length - 60);
  }
  recentEvents(sinceMs = null, limit = 5) {
    let evs = this.events;
    if (sinceMs) evs = evs.filter(e => e.t >= sinceMs);
    return evs.slice(-limit);
  }

  addNote(text) {
    this.notes.push({ text, t: Date.now() });
    if (this.notes.length > 80) this.notes.splice(0, this.notes.length - 80);
  }
  searchNotes(query) {
    const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2 &&
      !['the', 'where', 'did', 'put', 'what', 'was', 'were', 'you', 'remember', 'about', 'that'].includes(w));
    const scored = this.notes.map(n => {
      const lower = n.text.toLowerCase();
      let score = 0;
      for (const w of words) if (lower.includes(w)) score++;
      return { n, score };
    }).filter(s => s.score > 0).sort((a, b) => b.score - a.score || b.n.t - a.n.t);
    return scored.map(s => s.n);
  }

  addConversation(from, text) {
    this.conversations.push({ from, text, t: Date.now() });
    if (this.conversations.length > 200) this.conversations.splice(0, this.conversations.length - 200);
  }

  serialize() {
    return { facts: this.facts, notes: this.notes, events: this.events, conversations: this.conversations, meta: this.meta };
  }
  deserialize(d) {
    if (!d) return;
    this.facts = d.facts || {};
    this.notes = d.notes || [];
    this.events = d.events || [];
    this.conversations = d.conversations || [];
    this.meta = { ...this.meta, ...(d.meta || {}) };
  }
}
