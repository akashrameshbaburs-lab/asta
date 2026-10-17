// Verify the wake matcher against real transcripts observed from whisper.
import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/asta.js", import.meta.url), "utf8");
// Pull the matcher + its tables out of asta.js so we test the real implementation.
const start = src.indexOf("const WAKE_FILLER");
const end = src.indexOf("/**\n * Speak, while continuously draining");
const snippet = src.slice(start, end);
const mod = new Function(`${snippet}; return detectWake;`)();
const detectWake = mod;

const cases = [
  // should wake
  ["Asta, what time is it?", true],
  ["Asta", true],
  ["He Asta.", true],
  ["Hey Asta", true],
  ["Asta what is the weather today", true],
  ["Asta, what is the weather today?", true],
  ["Asta remind me to call mom.", true],
  ["Astaire remind me to call mom.", true],
  ["A star, what time is it?", true],
  ["Heya Stah.", true],
  ["Okay Asta, set a timer", true],
  ["Asta, list my reminders", true],
  // should NOT wake
  ["Star Wars is a good film.", false],
  ["As a matter of fact, I agree.", false],
  ["That was not bad.", false],
  ["Stop.", false],
  ["Okay.", false],
  ["What is the weather today?", false],
  ["I need to buy some groceries.", false],
  ["He is a good friend.", false],
  ["So anyway, as I was saying.", false],
  ["Astounded by the result.", false],
  ["", false],
];

let failures = 0;
for (const [text, shouldWake] of cases) {
  const r = detectWake(text);
  const woke = r !== null;
  const ok = woke === shouldWake;
  if (!ok) failures++;
  console.log(
    `${ok ? "pass" : "FAIL"}  woke=${String(woke).padEnd(5)} "${text}"${r ? `  -> command: "${r.rest}"` : ""}`
  );
}
console.log(`\n${cases.length - failures}/${cases.length} passed`);
process.exitCode = failures ? 1 : 0;
