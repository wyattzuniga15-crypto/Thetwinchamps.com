// voice.js — speech synthesis (Aria's voice + lip-sync drive), speech recognition,
// and a WebAudio ringtone.
export class Voice {
  constructor() {
    this.enabled = true;
    this.voice = null;
    this.speaking = false;
    this.onLevel = null;      // (0..1) mouth level callback
    this.onEnd = null;
    this._levelTimer = null;
    if ('speechSynthesis' in window) {
      const load = () => {
        const vs = speechSynthesis.getVoices();
        // prefer a natural-sounding female English voice
        const prefs = [/samantha/i, /zira/i, /aria/i, /jenny/i, /female/i, /karen/i, /victoria/i, /google uk english female/i, /google us english/i];
        for (const p of prefs) {
          const v = vs.find(v2 => p.test(v2.name) && v2.lang.startsWith('en'));
          if (v) { this.voice = v; return; }
        }
        this.voice = vs.find(v2 => v2.lang.startsWith('en')) || vs[0] || null;
      };
      load();
      speechSynthesis.onvoiceschanged = load;
    }
  }

  speak(text) {
    if (!this.enabled || !('speechSynthesis' in window)) {
      // still drive the mouth so lips move with captions
      this._fakeMouth(Math.max(1.2, text.length * 0.055));
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = 1.02; u.pitch = 1.12; u.volume = 1;
    this.speaking = true;
    this._startMouth();
    u.onend = u.onerror = () => {
      this.speaking = false;
      this._stopMouth();
      if (this.onEnd) this.onEnd();
    };
    speechSynthesis.speak(u);
  }

  stop() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.speaking = false;
    this._stopMouth();
  }

  _startMouth() {
    clearInterval(this._levelTimer);
    this._levelTimer = setInterval(() => {
      if (!this.onLevel) return;
      // pseudo-visemes: random amplitude with syllable rhythm and pauses
      const lvl = Math.random() < 0.16 ? 0.05 : 0.25 + Math.random() * 0.75;
      this.onLevel(this.speaking ? lvl : 0);
    }, 90);
  }
  _stopMouth() {
    clearInterval(this._levelTimer);
    if (this.onLevel) this.onLevel(0);
  }
  _fakeMouth(dur) {
    this.speaking = true;
    this._startMouth();
    setTimeout(() => { this.speaking = false; this._stopMouth(); if (this.onEnd) this.onEnd(); }, dur * 1000);
  }

  // ---- speech recognition (push to talk) ----
  startListening(onResult, onEndCb) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;
    this.rec = new SR();
    this.rec.lang = 'en-US';
    this.rec.interimResults = false;
    this.rec.maxAlternatives = 1;
    this.rec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      if (text && onResult) onResult(text);
    };
    this.rec.onend = () => { if (onEndCb) onEndCb(); };
    this.rec.onerror = () => { if (onEndCb) onEndCb(); };
    try { this.rec.start(); return true; } catch (e) { return false; }
  }
  stopListening() {
    try { this.rec && this.rec.stop(); } catch (e) { /* noop */ }
  }
}

// ---- ringtone ----
export class Ringtone {
  constructor() { this.ctx = null; this.playing = false; }
  start() {
    if (this.playing) return;
    this.playing = true;
    try { this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const loop = () => {
      if (!this.playing) return;
      const t0 = this.ctx.currentTime;
      for (let i = 0; i < 2; i++) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(i ? 880 : 660, t0 + i * 0.35);
        g.gain.setValueAtTime(0, t0 + i * 0.35);
        g.gain.linearRampToValueAtTime(0.15, t0 + i * 0.35 + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.35 + 0.32);
        o.connect(g).connect(this.ctx.destination);
        o.start(t0 + i * 0.35); o.stop(t0 + i * 0.35 + 0.35);
      }
      this._t = setTimeout(loop, 2000);
    };
    loop();
  }
  stop() { this.playing = false; clearTimeout(this._t); }
}
