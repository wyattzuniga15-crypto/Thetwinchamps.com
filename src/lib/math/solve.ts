/**
 * Deterministic local math engine.
 *
 * This is the fast path of Math Mode: it parses and solves a question with
 * plain arithmetic in well under a millisecond, with no network call and no
 * model tokens. It is pure TypeScript with no Node APIs, so it runs in BOTH
 * the browser and the server — a solvable question is answered before a
 * request would even leave the tab.
 *
 * Design rule: correctness beats coverage. Anything this engine cannot solve
 * with certainty returns `null`, and the caller falls back to the AI model.
 * Every algebraic answer is verified by back-substitution before it is
 * returned; a failed check also returns `null`.
 */

export interface SolveStep {
  label: string;
  /** Markdown + LaTeX. */
  body: string;
}

export interface LocalSolution {
  kind: "arithmetic" | "simplify" | "linear" | "quadratic" | "percent" | "number-theory";
  /** The cleaned-up expression we actually solved. */
  input: string;
  /** Plain-text answer, e.g. "12" or "x = 2 or x = 3". */
  answer: string;
  /** LaTeX for the headline answer. */
  answerLatex: string;
  /** Secondary exact/approximate form, e.g. "= 3/4" or "~ 1.4142". */
  alt?: string;
  steps: SolveStep[];
}

class Unsupported extends Error {}

/* ------------------------------- number helpers ------------------------------ */

function isInt(n: number, eps = 1e-9): boolean {
  return Number.isFinite(n) && Math.abs(n - Math.round(n)) < eps * Math.max(1, Math.abs(n));
}

/** Trim binary-float noise: 0.30000000000000004 -> 0.3 */
function clean(n: number): number {
  if (!Number.isFinite(n)) return n;
  const r = Number(n.toPrecision(12));
  return Object.is(r, -0) ? 0 : r;
}

/** Format a number for display: integers plain, decimals trimmed. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? "undefined" : n > 0 ? "infinity" : "-infinity";
  const c = clean(n);
  if (isInt(c)) {
    const r = Math.round(c);
    return Math.abs(r) < 1e21 ? String(r) : r.toExponential(6);
  }
  const abs = Math.abs(c);
  if (abs >= 1e12 || abs < 1e-6) return c.toExponential(6);
  return String(Number(c.toFixed(10)));
}

/** Exact fraction for a decimal, when a small one exists (continued fractions). */
export function asFraction(n: number, maxDen = 9999): { num: number; den: number } | null {
  if (!Number.isFinite(n) || isInt(n)) return null;
  const sign = n < 0 ? -1 : 1;
  const target = Math.abs(n);
  let x = target;
  let h0 = 0;
  let h1 = 1;
  let k0 = 1;
  let k1 = 0;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(x);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    if (k1 > maxDen) return null;
    if (Math.abs(h1 / k1 - target) < 1e-11 * target) {
      return k1 === 1 ? null : { num: sign * h1, den: k1 };
    }
    const frac = x - a;
    if (frac < 1e-12) return null;
    x = 1 / frac;
  }
  return null;
}

function gcdInt(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/** n = k^2 * m -> [k, m]; used to print sqrt(72) as 6*sqrt(2). */
function simplifySurd(n: number): [number, number] {
  if (!isInt(n) || n < 0) return [1, n];
  let k = 1;
  let m = Math.round(n);
  for (let d = 2; d * d <= m; d++) {
    while (m % (d * d) === 0) {
      m /= d * d;
      k *= d;
    }
  }
  return [k, m];
}

/* --------------------------------- tokenizer --------------------------------- */

type Tok =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" }
  | { t: "eq" };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new Unsupported("bad number");
      toks.push({ t: "num", v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-z]/.test(c)) {
      const m = /^[a-z]+/.exec(src.slice(i));
      if (!m) throw new Unsupported("bad identifier");
      toks.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    if (c === "(" || c === "[") {
      toks.push({ t: "lp" });
      i++;
      continue;
    }
    if (c === ")" || c === "]") {
      toks.push({ t: "rp" });
      i++;
      continue;
    }
    if (c === ",") {
      toks.push({ t: "comma" });
      i++;
      continue;
    }
    if (c === "=") {
      toks.push({ t: "eq" });
      i++;
      continue;
    }
    if (src.startsWith("**", i)) {
      toks.push({ t: "op", v: "^" });
      i += 2;
      continue;
    }
    if ("+-*/^!%".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Unsupported("unexpected character " + c);
  }
  return toks;
}

/* ---------------------------------- grammar ---------------------------------- */

type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "bin"; op: string; l: Node; r: Node }
  | { k: "neg"; a: Node }
  | { k: "call"; name: string; args: Node[] }
  | { k: "post"; op: "!" | "%" | "deg"; a: Node };

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
};

const DEG_WORDS = new Set(["deg", "degree", "degrees", "rad", "radian", "radians"]);

function factorial(n: number): number {
  if (!isInt(n) || n < 0 || n > 170) throw new Unsupported("factorial out of range");
  let r = 1;
  for (let i = 2; i <= Math.round(n); i++) r *= i;
  return r;
}

const FUNCS: Record<string, { arity: number[]; fn: (a: number[]) => number }> = {
  sqrt: { arity: [1], fn: (a) => Math.sqrt(a[0]) },
  cbrt: { arity: [1], fn: (a) => Math.cbrt(a[0]) },
  abs: { arity: [1], fn: (a) => Math.abs(a[0]) },
  sign: { arity: [1], fn: (a) => Math.sign(a[0]) },
  exp: { arity: [1], fn: (a) => Math.exp(a[0]) },
  ln: { arity: [1], fn: (a) => Math.log(a[0]) },
  log: { arity: [1, 2], fn: (a) => (a.length === 1 ? Math.log10(a[0]) : Math.log(a[0]) / Math.log(a[1])) },
  log2: { arity: [1], fn: (a) => Math.log2(a[0]) },
  log10: { arity: [1], fn: (a) => Math.log10(a[0]) },
  sin: { arity: [1], fn: (a) => Math.sin(a[0]) },
  cos: { arity: [1], fn: (a) => Math.cos(a[0]) },
  tan: { arity: [1], fn: (a) => Math.tan(a[0]) },
  asin: { arity: [1], fn: (a) => Math.asin(a[0]) },
  acos: { arity: [1], fn: (a) => Math.acos(a[0]) },
  atan: { arity: [1], fn: (a) => Math.atan(a[0]) },
  sinh: { arity: [1], fn: (a) => Math.sinh(a[0]) },
  cosh: { arity: [1], fn: (a) => Math.cosh(a[0]) },
  tanh: { arity: [1], fn: (a) => Math.tanh(a[0]) },
  round: {
    arity: [1, 2],
    fn: (a) => (a.length === 1 ? Math.round(a[0]) : Number(a[0].toFixed(Math.max(0, Math.min(15, Math.round(a[1])))))),
  },
  floor: { arity: [1], fn: (a) => Math.floor(a[0]) },
  ceil: { arity: [1], fn: (a) => Math.ceil(a[0]) },
  min: { arity: [2, 3, 4], fn: (a) => Math.min.apply(null, a) },
  max: { arity: [2, 3, 4], fn: (a) => Math.max.apply(null, a) },
  mod: { arity: [2], fn: (a) => ((a[0] % a[1]) + a[1]) % a[1] },
  gcd: { arity: [2, 3], fn: (a) => a.reduce(gcdInt) },
  lcm: { arity: [2, 3], fn: (a) => a.reduce((x, y) => Math.abs(x * y) / (gcdInt(x, y) || 1)) },
  fact: { arity: [1], fn: (a) => factorial(a[0]) },
  factorial: { arity: [1], fn: (a) => factorial(a[0]) },
  ncr: { arity: [2], fn: (a) => factorial(a[0]) / (factorial(a[1]) * factorial(a[0] - a[1])) },
  npr: { arity: [2], fn: (a) => factorial(a[0]) / factorial(a[0] - a[1]) },
};

class Parser {
  private i = 0;

  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private next(): Tok | undefined {
    return this.toks[this.i++];
  }

  /** True when the token `ahead` positions from here opens a call: `mod(`. */
  private startsCall(ahead: number): boolean {
    const t = this.toks[this.i + ahead];
    return !!t && t.t === "lp";
  }

  private eat(t: Tok["t"]): void {
    const tok = this.next();
    if (!tok || tok.t !== t) throw new Unsupported("expected " + t);
  }

  parseAll(): Node {
    const n = this.expr();
    if (this.i !== this.toks.length) throw new Unsupported("trailing input");
    return n;
  }

  expr(): Node {
    let l = this.term();
    for (;;) {
      const tok = this.peek();
      if (tok && tok.t === "op" && (tok.v === "+" || tok.v === "-")) {
        this.i++;
        l = { k: "bin", op: tok.v, l, r: this.term() };
      } else break;
    }
    return l;
  }

  private term(): Node {
    let l = this.unary();
    for (;;) {
      const tok = this.peek();
      if (tok && tok.t === "op" && (tok.v === "*" || tok.v === "/")) {
        this.i++;
        l = { k: "bin", op: tok.v, l, r: this.unary() };
      } else if (tok && tok.t === "id" && tok.v === "mod" && !this.startsCall(1)) {
        // Infix modulo: 17 mod 5
        this.i++;
        l = { k: "call", name: "mod", args: [l, this.unary()] };
      } else if (tok && (tok.t === "num" || tok.t === "lp" || (tok.t === "id" && !DEG_WORDS.has(tok.v)))) {
        // Implicit multiplication: 2x, 3(4+5), 2 pi
        l = { k: "bin", op: "*", l, r: this.unary() };
      } else break;
    }
    return l;
  }

  private unary(): Node {
    const tok = this.peek();
    if (tok && tok.t === "op" && (tok.v === "-" || tok.v === "+")) {
      this.i++;
      const a = this.unary();
      return tok.v === "-" ? { k: "neg", a } : a;
    }
    return this.power();
  }

  /** `^` binds tighter than unary minus and is right-associative: -2^2 = -4, 2^3^2 = 2^9. */
  private power(): Node {
    const base = this.postfix();
    const tok = this.peek();
    if (tok && tok.t === "op" && tok.v === "^") {
      this.i++;
      return { k: "bin", op: "^", l: base, r: this.unary() };
    }
    return base;
  }

  private postfix(): Node {
    let a = this.primary();
    for (;;) {
      const tok = this.peek();
      if (tok && tok.t === "op" && tok.v === "!") {
        this.i++;
        a = { k: "post", op: "!", a };
      } else if (tok && tok.t === "op" && tok.v === "%") {
        this.i++;
        a = { k: "post", op: "%", a };
      } else if (tok && tok.t === "id" && DEG_WORDS.has(tok.v)) {
        this.i++;
        if (tok.v.startsWith("deg")) a = { k: "post", op: "deg", a };
      } else break;
    }
    return a;
  }

  private primary(): Node {
    const tok = this.next();
    if (!tok) throw new Unsupported("unexpected end");
    if (tok.t === "num") return { k: "num", v: tok.v };
    if (tok.t === "lp") {
      const n = this.expr();
      this.eat("rp");
      return n;
    }
    if (tok.t === "id") {
      const name = tok.v;
      if (FUNCS[name] && this.peek() && this.peek()!.t === "lp") {
        this.i++;
        const args: Node[] = [this.expr()];
        while (this.peek() && this.peek()!.t === "comma") {
          this.i++;
          args.push(this.expr());
        }
        this.eat("rp");
        if (!FUNCS[name].arity.includes(args.length)) throw new Unsupported(name + " arity");
        return { k: "call", name, args };
      }
      if (name in CONSTANTS) return { k: "num", v: CONSTANTS[name] };
      // Bare function application: sqrt 16
      if (FUNCS[name] && FUNCS[name].arity.includes(1)) return { k: "call", name, args: [this.unary()] };
      if (name.length === 1) return { k: "var", name };
      throw new Unsupported("unknown name " + name);
    }
    throw new Unsupported("unexpected token");
  }
}

/* ---------------------------- polynomial evaluation --------------------------- */

/** Coefficients by power: [c0, c1, c2] = c0 + c1*x + c2*x^2. */
type Poly = number[];

function pTrim(p: Poly): Poly {
  const q = p.slice();
  while (q.length > 1 && Math.abs(q[q.length - 1]) < 1e-12) q.pop();
  return q;
}

function pDeg(p: Poly): number {
  return pTrim(p).length - 1;
}

function pIsConst(p: Poly): boolean {
  return pDeg(p) === 0;
}

function pAdd(a: Poly, b: Poly, sign = 1): Poly {
  const out = new Array(Math.max(a.length, b.length)).fill(0);
  for (let i = 0; i < out.length; i++) out[i] = (a[i] || 0) + sign * (b[i] || 0);
  return pTrim(out);
}

function pMul(a: Poly, b: Poly): Poly {
  if (pDeg(a) + pDeg(b) > 2) throw new Unsupported("degree above 2");
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  }
  return pTrim(out);
}

function pPow(base: Poly, n: number): Poly {
  if (!isInt(n) || n < 0 || n > 8) throw new Unsupported("bad exponent");
  let out: Poly = [1];
  for (let i = 0; i < Math.round(n); i++) out = pMul(out, base);
  return out;
}

function evalPoly(node: Node, varName: string | null): Poly {
  switch (node.k) {
    case "num":
      return [node.v];
    case "var":
      if (varName && node.name !== varName) throw new Unsupported("two variables");
      return [0, 1];
    case "neg":
      return evalPoly(node.a, varName).map((c) => -c);
    case "post": {
      const a = evalPoly(node.a, varName);
      if (node.op === "%") return a.map((c) => c / 100);
      if (node.op === "deg") return a.map((c) => (c * Math.PI) / 180);
      if (!pIsConst(a)) throw new Unsupported("factorial of an expression");
      return [factorial(a[0])];
    }
    case "call": {
      const args = node.args.map((x) => evalPoly(x, varName));
      if (!args.every(pIsConst)) throw new Unsupported(node.name + " of an expression");
      return [FUNCS[node.name].fn(args.map((a) => a[0]))];
    }
    case "bin": {
      const l = evalPoly(node.l, varName);
      const r = evalPoly(node.r, varName);
      switch (node.op) {
        case "+":
          return pAdd(l, r);
        case "-":
          return pAdd(l, r, -1);
        case "*":
          return pMul(l, r);
        case "/":
          if (!pIsConst(r)) throw new Unsupported("divide by an expression");
          if (Math.abs(r[0]) < 1e-15) throw new Unsupported("divide by zero");
          return pTrim(l.map((c) => c / r[0]));
        case "^":
          if (!pIsConst(r)) throw new Unsupported("variable exponent");
          if (pIsConst(l)) return [Math.pow(l[0], r[0])];
          return pPow(l, r[0]);
      }
      throw new Unsupported("operator");
    }
  }
}

function findVariable(node: Node): string | null {
  let found: string | null = null;
  const walk = (n: Node): void => {
    if (n.k === "var") {
      if (found && found !== n.name) throw new Unsupported("two variables");
      found = n.name;
    } else if (n.k === "bin") {
      walk(n.l);
      walk(n.r);
    } else if (n.k === "neg" || n.k === "post") {
      walk(n.a);
    } else if (n.k === "call") {
      n.args.forEach(walk);
    }
  };
  walk(node);
  return found;
}

/* ------------------------------ input normalization --------------------------- */

const SYMBOLS: Array<[RegExp, string]> = [
  [/[×✕✖⋅·]/g, "*"],
  [/[÷∕]/g, "/"],
  [/[−–—]/g, "-"],
  [/[“”‘’]/g, ""],
  [/√/g, "sqrt"],
  [/∛/g, "cbrt"],
  [/[πΠ]/g, "pi"],
  [/[°˚]/g, " deg "],
  [/⁰/g, "^0"],
  [/¹/g, "^1"],
  [/²/g, "^2"],
  [/³/g, "^3"],
  [/⁴/g, "^4"],
  [/½/g, "(1/2)"],
  [/⅓/g, "(1/3)"],
  [/¼/g, "(1/4)"],
  [/¾/g, "(3/4)"],
  // Inequalities and comparisons are out of scope: leave a character the parser rejects.
  [/[≠≤≥<>]/g, "#"],
];

const WORD_OPS: Array<[RegExp, string]> = [
  [/\bto the power of\b/g, "^"],
  [/\braised to\b/g, "^"],
  [/\bsquare root of\b/g, "sqrt"],
  [/\bcube root of\b/g, "cbrt"],
  [/\bsquared\b/g, "^2"],
  [/\bcubed\b/g, "^3"],
  [/\bmultiplied by\b/g, "*"],
  [/\bdivided by\b/g, "/"],
  [/\bplus\b/g, "+"],
  [/\bminus\b/g, "-"],
  [/\btimes\b/g, "*"],
  [/\bequals\b/g, "="],
  [/\bfactorial of\b/g, "fact"],
  [/\bmodulo\b|\bmod\b/g, "@MOD@"],
];

const LEAD_NOISE =
  /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:help me\s+)?(?:whats|what is|what are|how much is|how many is|calculate|compute|evaluate|work out|simplify|solve for [a-z]\b|solve|the value of|value of)\b[:\s]*/;

/** Turn a natural-language question into a bare expression. */
export function normalize(raw: string): string {
  let s = raw.toLowerCase().trim();
  for (const [re, to] of SYMBOLS) s = s.replace(re, to);
  s = s.replace(/what's/g, "whats");
  s = s.replace(/[?.]+$/g, "");
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(LEAD_NOISE, "").trim();
    if (s === before) break;
  }
  for (const [re, to] of WORD_OPS) s = s.replace(re, to);
  s = s.replace(/\bpercent\b|\bpct\b/g, "%");
  s = s.replace(/\bof\b/g, "*");
  s = s.replace(/(\d),(?=\d{3}(?!\d))/g, "$1"); // 1,234 -> 1234
  s = s.replace(/\$/g, "");
  // "3 x 4" means multiplication when there is no equation to solve.
  if (!s.includes("=")) {
    for (let i = 0; i < 4; i++) s = s.replace(/(\d)\s*x\s*(\d)/g, "$1*$2");
  }
  s = s.replace(/@MOD@/g, " mod ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/[=\s]+$/g, "").trim();
  return s;
}

/* ------------------------------- rendering bits ------------------------------- */

function polyLatex(p: Poly, v: string): string {
  const t = pTrim(p);
  const parts: string[] = [];
  for (let d = t.length - 1; d >= 0; d--) {
    const c = clean(t[d]);
    if (Math.abs(c) < 1e-12) continue;
    const sign = c < 0 ? "-" : parts.length ? "+" : "";
    const mag = Math.abs(c);
    const coef = d === 0 || Math.abs(mag - 1) > 1e-12 ? fmt(mag) : "";
    const power = d === 0 ? "" : d === 1 ? v : v + "^{" + d + "}";
    parts.push((sign + " " + coef + power).trim());
  }
  return parts.length ? parts.join(" ") : "0";
}

function altForm(n: number): string | undefined {
  const f = asFraction(n);
  if (f) return "= " + f.num + "/" + f.den;
  if (!isInt(n) && Number.isFinite(n)) {
    const rounded = Number(n.toFixed(4));
    if (Math.abs(rounded - n) > 1e-12) return "~ " + rounded;
  }
  return undefined;
}

/** Recognize the classic exact values so 0.7071... prints as sqrt(2)/2. */
const NICE: Array<[number, string]> = [
  [Math.SQRT1_2, "\\frac{\\sqrt{2}}{2}"],
  [Math.sqrt(3) / 2, "\\frac{\\sqrt{3}}{2}"],
  [Math.sqrt(3), "\\sqrt{3}"],
  [Math.SQRT2, "\\sqrt{2}"],
  [1 / Math.sqrt(3), "\\frac{\\sqrt{3}}{3}"],
];

function niceLatex(n: number): string | null {
  for (const [v, tex] of NICE) {
    if (Math.abs(n - v) < 1e-12) return tex;
    if (Math.abs(n + v) < 1e-12) return "-" + tex;
  }
  return null;
}

function texEscape(s: string): string {
  return s.replace(/\*/g, " \\times ").replace(/%/g, "\\%");
}

/* ---------------------------- special-case patterns --------------------------- */

function isPrime(n: number): boolean {
  if (!isInt(n) || n < 2) return false;
  const m = Math.round(n);
  if (m < 4) return true;
  if (m % 2 === 0 || m % 3 === 0) return m === 2 || m === 3;
  for (let i = 5; i * i <= m; i += 6) {
    if (m % i === 0 || m % (i + 2) === 0) return false;
  }
  return true;
}

function primeFactors(n: number): number[] {
  const out: number[] = [];
  let m = Math.round(Math.abs(n));
  for (let d = 2; d * d <= m; d++) {
    while (m % d === 0) {
      out.push(d);
      m /= d;
    }
  }
  if (m > 1) out.push(m);
  return out;
}

const MAX_NT = 1e12;
const NUM = "(-?\\d+(?:\\.\\d+)?)";

/** Number-theory and percent questions that a plain expression parse would miss. */
function specialCase(lower: string): LocalSolution | null {
  const s = lower.replace(/[?.!]+$/, "").trim();
  let m: RegExpMatchArray | null;

  if ((m = s.match(/^is\s+(\d+)\s+(?:a\s+)?prime(?:\s+number)?$/))) {
    const n = Number(m[1]);
    if (n > MAX_NT) return null;
    const prime = isPrime(n);
    const f = prime ? [] : primeFactors(n);
    return {
      kind: "number-theory",
      input: "is " + n + " prime?",
      answer: prime ? "Yes, " + n + " is prime" : "No, " + n + " is not prime",
      answerLatex: prime ? n + "\\ \\text{is prime}" : n + " = " + f.join(" \\times "),
      steps: [
        {
          label: "Test divisors",
          body: prime
            ? "No integer from 2 to $\\lfloor\\sqrt{" +
              n +
              "}\\rfloor = " +
              Math.floor(Math.sqrt(n)) +
              "$ divides " +
              n +
              ", so it is prime."
            : n +
              " is divisible by " +
              f[0] +
              ", so it is composite. Its prime factorization is $" +
              f.join(" \\times ") +
              "$.",
        },
      ],
    };
  }

  if ((m = s.match(/^(?:prime\s+)?factor(?:i[sz]ation|s|ize|ise)?\s*(?:of\s+)?(\d+)$/))) {
    const n = Number(m[1]);
    if (n < 2 || n > MAX_NT) return null;
    const f = primeFactors(n);
    const grouped: string[] = [];
    for (let i = 0; i < f.length; ) {
      let j = i;
      while (j < f.length && f[j] === f[i]) j++;
      grouped.push(j - i === 1 ? String(f[i]) : f[i] + "^{" + (j - i) + "}");
      i = j;
    }
    return {
      kind: "number-theory",
      input: "prime factorization of " + n,
      answer: n + " = " + f.join(" x "),
      answerLatex: n + " = " + grouped.join(" \\times "),
      steps: [
        { label: "Divide out primes", body: "$" + n + " = " + f.join(" \\times ") + "$" },
        { label: "Group repeats", body: "$" + n + " = " + grouped.join(" \\times ") + "$" },
      ],
    };
  }

  if ((m = s.match(new RegExp("^" + NUM + "\\s*%\\s*off\\s*\\$?" + NUM + "$")))) {
    const p = Number(m[1]);
    const base = Number(m[2]);
    const off = (base * p) / 100;
    const final = base - off;
    return {
      kind: "percent",
      input: p + "% off " + base,
      answer: fmt(final),
      answerLatex: fmt(final),
      alt: "a discount of " + fmt(off),
      steps: [
        { label: "Find the discount", body: "$" + p + "\\% \\times " + base + " = " + fmt(off) + "$" },
        { label: "Subtract it", body: "$" + base + " - " + fmt(off) + " = " + fmt(final) + "$" },
      ],
    };
  }

  if ((m = s.match(new RegExp("^what\\s+percent\\s+of\\s+" + NUM + "\\s+is\\s+" + NUM + "$")))) {
    const whole = Number(m[1]);
    const part = Number(m[2]);
    if (whole === 0) return null;
    const pct = (part / whole) * 100;
    return {
      kind: "percent",
      input: "what percent of " + whole + " is " + part,
      answer: fmt(pct) + "%",
      answerLatex: fmt(pct) + "\\%",
      steps: [
        {
          label: "Part over whole, times 100",
          body: "$\\frac{" + part + "}{" + whole + "} \\times 100 = " + fmt(pct) + "\\%$",
        },
      ],
    };
  }

  if (
    (m = s.match(
      new RegExp("^percent(?:age)?\\s+(?:change|increase|decrease)\\s+from\\s+" + NUM + "\\s+to\\s+" + NUM + "$")
    ))
  ) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0) return null;
    const pct = ((b - a) / Math.abs(a)) * 100;
    return {
      kind: "percent",
      input: "percent change from " + a + " to " + b,
      answer: fmt(pct) + "%",
      answerLatex: fmt(pct) + "\\%",
      alt: pct >= 0 ? "an increase" : "a decrease",
      steps: [
        { label: "Amount of change", body: "$" + b + " - " + a + " = " + fmt(b - a) + "$" },
        {
          label: "Compare to the starting value",
          body: "$\\frac{" + fmt(b - a) + "}{" + fmt(Math.abs(a)) + "} \\times 100 = " + fmt(pct) + "\\%$",
        },
      ],
    };
  }

  return null;
}

/* ------------------------------ equation solving ------------------------------ */

function solveLinear(p: Poly, v: string, lhs: string, rhs: string): LocalSolution | null {
  const c0 = p[0] || 0;
  const c1 = p[1] || 0;
  const x = -c0 / c1;
  if (!Number.isFinite(x)) return null;
  const frac = asFraction(x);
  const exact = frac ? "\\frac{" + frac.num + "}{" + frac.den + "}" : fmt(x);
  return {
    kind: "linear",
    input: lhs + " = " + rhs,
    answer: v + " = " + fmt(x),
    answerLatex: v + " = " + exact,
    alt: frac ? "~ " + fmt(x) : undefined,
    steps: [
      { label: "Move every term to one side", body: "$" + polyLatex(p, v) + " = 0$" },
      {
        label: "Isolate " + v,
        body:
          "$" +
          fmt(c1) +
          v +
          " = " +
          fmt(-c0) +
          "$, so $" +
          v +
          " = \\frac{" +
          fmt(-c0) +
          "}{" +
          fmt(c1) +
          "} = " +
          exact +
          "$",
      },
      {
        label: "Check",
        body: "Substituting $" + v + " = " + fmt(x) + "$ back into the original equation balances both sides.",
      },
    ],
  };
}

function solveQuadratic(p: Poly, v: string, lhs: string, rhs: string): LocalSolution {
  const c = p[0] || 0;
  const b = p[1] || 0;
  const a = p[2];
  const disc = clean(b * b - 4 * a * c);
  const steps: SolveStep[] = [
    {
      label: "Standard form",
      body: "$" + polyLatex(p, v) + " = 0$ with $a = " + fmt(a) + "$, $b = " + fmt(b) + "$, $c = " + fmt(c) + "$",
    },
    {
      label: "Discriminant",
      body:
        "$b^2 - 4ac = (" + fmt(b) + ")^2 - 4(" + fmt(a) + ")(" + fmt(c) + ") = " + fmt(disc) + "$",
    },
  ];

  if (disc < -1e-12) {
    const re = -b / (2 * a);
    const im = Math.sqrt(-disc) / (2 * Math.abs(a));
    steps.push({
      label: "Negative discriminant",
      body:
        "There are no real solutions. Over the complex numbers $" +
        v +
        " = " +
        fmt(re) +
        " \\pm " +
        fmt(im) +
        "i$.",
    });
    return {
      kind: "quadratic",
      input: lhs + " = " + rhs,
      answer: "no real solutions (" + v + " = " + fmt(re) + " +/- " + fmt(im) + "i)",
      answerLatex: v + " = " + fmt(re) + " \\pm " + fmt(im) + "i",
      steps,
    };
  }

  if (Math.abs(disc) < 1e-12) {
    const x = -b / (2 * a);
    steps.push({
      label: "One repeated root",
      body: "$" + v + " = \\frac{-(" + fmt(b) + ")}{2 \\cdot " + fmt(a) + "} = " + fmt(x) + "$",
    });
    return {
      kind: "quadratic",
      input: lhs + " = " + rhs,
      answer: v + " = " + fmt(x) + " (double root)",
      answerLatex: v + " = " + fmt(x),
      steps,
    };
  }

  const root = Math.sqrt(disc);
  const x1 = (-b + root) / (2 * a);
  const x2 = (-b - root) / (2 * a);
  const surd = simplifySurd(disc);
  const exact =
    isInt(disc) && surd[1] !== 1
      ? " = \\frac{" +
        fmt(-b) +
        " \\pm " +
        (surd[0] === 1 ? "" : String(surd[0])) +
        "\\sqrt{" +
        surd[1] +
        "}}{" +
        fmt(2 * a) +
        "}"
      : "";
  steps.push({
    label: "Quadratic formula",
    body:
      "$" +
      v +
      " = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a} = \\frac{" +
      fmt(-b) +
      " \\pm \\sqrt{" +
      fmt(disc) +
      "}}{" +
      fmt(2 * a) +
      "}" +
      exact +
      "$",
  });
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  steps.push({ label: "Two solutions", body: "$" + v + " = " + fmt(lo) + "$ or $" + v + " = " + fmt(hi) + "$" });
  if (isInt(lo) && isInt(hi)) {
    steps.push({
      label: "Check by factoring",
      body:
        "$" +
        polyLatex(p, v) +
        " = " +
        (Math.abs(a - 1) < 1e-12 ? "" : fmt(a)) +
        "(" +
        v +
        (lo <= 0 ? " + " : " - ") +
        fmt(Math.abs(lo)) +
        ")(" +
        v +
        (hi <= 0 ? " + " : " - ") +
        fmt(Math.abs(hi)) +
        ")$",
    });
  }
  return {
    kind: "quadratic",
    input: lhs + " = " + rhs,
    answer: v + " = " + fmt(lo) + " or " + v + " = " + fmt(hi),
    answerLatex: v + " = " + fmt(lo) + " \\quad\\text{or}\\quad " + v + " = " + fmt(hi),
    steps,
  };
}

/** Confidence gate: put each root back into the polynomial and require ~0. */
function verifyRoots(p: Poly, roots: number[]): boolean {
  const scale = Math.max(1, ...p.map((c) => Math.abs(c)));
  return roots.every((x) => {
    if (!Number.isFinite(x)) return false;
    let acc = 0;
    for (let d = 0; d < p.length; d++) acc += p[d] * Math.pow(x, d);
    return Math.abs(acc) < 1e-7 * scale * Math.max(1, x * x);
  });
}

/* --------------------------------- entry point -------------------------------- */

const FUNC_WORDS = new RegExp(
  "\\b(" + Object.keys(FUNCS).concat(Object.keys(CONSTANTS), ["deg", "degrees", "degree"]).join("|") + ")\\b",
  "g"
);

/**
 * Solve `raw` locally, or return null when the AI model should handle it.
 * Never throws.
 */
export function solveLocally(raw: string): LocalSolution | null {
  try {
    if (!raw || raw.trim().length === 0 || raw.length > 240) return null;

    const special = specialCase(raw.toLowerCase().trim());
    if (special) return special;

    const s = normalize(raw);
    if (!s) return null;
    if (!/\d/.test(s) && !/[a-z]/.test(s)) return null;
    // Prose that survived normalization is a word problem: not ours to answer.
    if (/[a-z]{2,}/.test(s.replace(FUNC_WORDS, ""))) return null;

    const eqParts = s.split("=");
    if (eqParts.length > 2) return null;

    if (eqParts.length === 2) {
      const lhsSrc = eqParts[0].trim();
      const rhsSrc = eqParts[1].trim();
      if (!lhsSrc || !rhsSrc) return null;
      const lhs = new Parser(tokenize(lhsSrc)).parseAll();
      const rhs = new Parser(tokenize(rhsSrc)).parseAll();
      const v = findVariable(lhs) || findVariable(rhs);
      if (!v) return null;
      const diff = pAdd(evalPoly(lhs, v), evalPoly(rhs, v), -1);
      const deg = pDeg(diff);
      if (deg === 1) {
        const sol = solveLinear(diff, v, lhsSrc, rhsSrc);
        return sol && verifyRoots(diff, [-diff[0] / diff[1]]) ? sol : null;
      }
      if (deg === 2) {
        const c = diff[0] || 0;
        const b = diff[1] || 0;
        const a = diff[2];
        const disc = b * b - 4 * a * c;
        if (disc >= -1e-12) {
          const r = Math.sqrt(Math.max(0, disc));
          if (!verifyRoots(diff, [(-b + r) / (2 * a), (-b - r) / (2 * a)])) return null;
        }
        return solveQuadratic(diff, v, lhsSrc, rhsSrc);
      }
      return null; // identity, contradiction, or higher degree: let the model explain it
    }

    const ast = new Parser(tokenize(s)).parseAll();
    const v = findVariable(ast);
    const poly = evalPoly(ast, v);

    if (v) {
      if (pDeg(poly) < 1) return null;
      const tex = polyLatex(poly, v);
      return {
        kind: "simplify",
        input: s,
        answer: tex,
        answerLatex: tex,
        steps: [{ label: "Combine like terms", body: "$" + texEscape(s) + " = " + tex + "$" }],
      };
    }

    const value = clean(poly[0]);
    if (!Number.isFinite(value)) return null;
    const nice = niceLatex(value);
    return {
      kind: "arithmetic",
      input: s,
      answer: fmt(value),
      answerLatex: nice ? nice + " \\approx " + fmt(value) : fmt(value),
      alt: altForm(value),
      steps: [{ label: "Evaluate", body: "$" + texEscape(s) + " = " + fmt(value) + "$" }],
    };
  } catch {
    return null;
  }
}
