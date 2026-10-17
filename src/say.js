// Speak text from the command line:  node src/say.js "hello there"
import { loadConfig } from "./config.js";
import { speak } from "./tts.js";

const cfg = loadConfig();
const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.error("usage: node src/say.js \"text to speak\"");
  process.exit(1);
}
const r = speak(text, cfg);
if (!r.spoke) {
  console.error("could not speak");
  process.exit(1);
}
console.log(`spoke with ${r.engine}`);
