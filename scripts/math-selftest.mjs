/**
 * Self-test for the local math engine (src/lib/math/solve.ts).
 *
 * Run with `npm run test:math`, which compiles the engine to .test-build/ first.
 * Two things are checked: every answer is exactly right, and every question the
 * engine must NOT answer locally (word problems, calculus, inequalities) falls
 * through to the model instead of being guessed at.
 */
import { solveLocally } from "../.test-build/solve.js";

let pass = 0, fail = 0;

// [input, expected answer]  — expected null means "must fall through to the model"
const CASES = [
  ["2+2", "4"],
  ["7 * 8", "56"],
  ["what is 12 * 12", "144"],
  ["What's 15% of 80?", "12"],
  ["144 / 12", "12"],
  ["2^10", "1024"],
  ["-2^2", "-4"],
  ["2^3^2", "512"],
  ["(3 + 5) * 2", "16"],
  ["10 - 3 - 2", "5"],
  ["100/3", "33.3333333333"],
  ["1/2 + 1/3", "0.8333333333"],
  ["sqrt(144)", "12"],
  ["sqrt 16", "4"],
  ["5!", "120"],
  ["3.5 * 2", "7"],
  ["2 + 3 * 4", "14"],
  ["0.1 + 0.2", "0.3"],
  ["1,234 + 1", "1235"],
  ["17 mod 5", "2"],
  ["gcd(48, 18)", "6"],
  ["lcm(4, 6)", "12"],
  ["sin(30 deg)", "0.5"],
  ["cos(60 degrees)", "0.5"],
  ["log(1000)", "3"],
  ["ln(e)", "1"],
  ["2 pi", "6.2831853072"],
  ["3(4+5)", "27"],
  ["ncr(5,2)", "10"],
  ["round(3.14159, 2)", "3.14"],
  ["min(3, 9)", "3"],
  ["12 squared", "144"],
  ["5 plus 6", "11"],
  ["20 divided by 4", "5"],
  ["3 x 4", "12"],
  ["1e3 + 1", "1001"],
  ["8 % 2", "0.16"],          // percent semantics: 8% * 2
  ["50%", "0.5"],
  // equations
  ["2x + 3 = 11", "x = 4"],
  ["solve 3y - 7 = 14", "y = 7"],
  ["x/2 = 8", "x = 16"],
  ["5x = 2x + 9", "x = 3"],
  ["2(x + 3) = 14", "x = 4"],
  ["x^2 - 5x + 6 = 0", "x = 2 or x = 3"],
  ["x^2 = 16", "x = -4 or x = 4"],
  ["x^2 + 1 = 0", "no real solutions (x = 0 +/- 1i)"],
  ["x^2 - 4x + 4 = 0", "x = 2 (double root)"],
  ["x^2 + 2x - 5 = 0", "x = -3.4494897428 or x = 1.4494897428"],
  // simplify
  ["2x + 3x", "5x"],
  ["(x+1)(x+2)", "x^{2} + 3x + 2"],
  // special cases
  ["is 91 prime?", "No, 91 is not prime"],
  ["is 97 prime", "Yes, 97 is prime"],
  ["prime factorization of 360", "360 = 2 x 2 x 2 x 3 x 3 x 5"],
  ["20% off 50", "40"],
  ["what percent of 200 is 50", "25%"],
  ["percent change from 40 to 50", "25%"],
  // must NOT be answered locally (word problems / prose / out of scope)
  ["Explain the Pythagorean theorem", null],
  ["A train leaves at 3pm going 60 mph, how far in 2 hours?", null],
  ["derivative of x^2", null],
  ["integrate x dx", null],
  ["why is 2+2 equal to 4", null],
  ["x^3 - 1 = 0", null],
  ["x + y = 5", null],
  ["2x > 5", null],
  ["", null],
  ["hello", null],
  ["What caused World War I?", null],
  ["1/0", null],
];

for (const [input, expected] of CASES) {
  let got;
  try {
    const r = solveLocally(input);
    got = r ? r.answer : null;
  } catch (e) {
    got = "THREW: " + e.message;
  }
  const ok = expected === null ? got === null : got === expected;
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL  ${JSON.stringify(input)}\n      expected: ${JSON.stringify(expected)}\n      got:      ${JSON.stringify(got)}`);
  }
}

// Timing
const t0 = performance.now();
for (let i = 0; i < 2000; i++) solveLocally("x^2 - 5x + 6 = 0");
const perSolve = (performance.now() - t0) / 2000;
console.log(`\n${pass} passed, ${fail} failed`);
console.log(`quadratic solve: ${(perSolve * 1000).toFixed(1)} microseconds each`);

// Fuzz: must never throw
const chars = "0123456789+-*/^()=.xy% !,sqrtincoglm ";
let threw = 0;
for (let i = 0; i < 20000; i++) {
  let s = "";
  const n = 1 + Math.floor(Math.random() * 18);
  for (let j = 0; j < n; j++) s += chars[Math.floor(Math.random() * chars.length)];
  try { solveLocally(s); } catch (e) { threw++; if (threw < 4) console.log("FUZZ THREW:", JSON.stringify(s), e.message); }
}
console.log(`fuzz: 20000 random inputs, ${threw} exceptions`);
process.exit(fail > 0 || threw > 0 ? 1 : 0);
