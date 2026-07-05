import { defineCommand } from "citty";
import { text, isCancel } from "@clack/prompts";
import wordlist from "../../assets/eff-large-wordlist.json" with { type: "json" };
import { colors, logError, logSuccess } from "../../lib/console.ts";

// ─── secure word selection ────────────────────────────────────────────────────

// Rejection sampling avoids modulo bias: wordlist.length (7776) doesn't evenly
// divide any power of two, so `randomByte % wordlist.length` would favor
// low indices. Instead we draw just enough random bits and discard out-of-range draws.
function secureRandomIndex(range: number): number {
  const bits = Math.ceil(Math.log2(range));
  const bytes = Math.ceil(bits / 8);
  const mask = (1 << bits) - 1;
  const buf = new Uint8Array(bytes);
  while (true) {
    crypto.getRandomValues(buf);
    let val = 0;
    for (const b of buf) val = (val << 8) | b;
    val &= mask;
    if (val < range) return val;
  }
}

function rollWord(): string {
  return wordlist[secureRandomIndex(wordlist.length)];
}

function entropyBits(wordCount: number): number {
  return wordCount * Math.log2(wordlist.length);
}

function printPassphrase(words: string[], separator: string) {
  console.log("");
  words.forEach((w, i) => console.log(`  ${colors.dim(`${i + 1}:`)} ${w}`));
  console.log(`\n  ${colors.bold(words.join(separator))}`);
  console.log(`  ${colors.dim(`(~${entropyBits(words.length).toFixed(1)} bits of entropy)`)}\n`);
}

function parseIndices(input: string, max: number): number[] | null {
  const parts = input.split(",").map((p) => p.trim()).filter(Boolean);
  const indices: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1 || n > max) return null;
    indices.push(n - 1);
  }
  return indices;
}

// ─── command ─────────────────────────────────────────────────────────────────

export const passphraseCommand = defineCommand({
  meta: { description: "Generate a secure diceware passphrase, with per-word reroll" },
  args: {
    words: { type: "string", default: "8", description: "Number of words in the passphrase" },
    separator: { type: "string", default: " ", description: "Separator between words" },
  },
  async run({ args }) {
    const wordCount = parseInt(args.words, 10);
    if (!Number.isInteger(wordCount) || wordCount < 1) {
      logError(`Invalid word count "${args.words}"`);
      process.exit(1);
    }

    const separator = args.separator;
    const words = Array.from({ length: wordCount }, rollWord);
    printPassphrase(words, separator);

    while (true) {
      const answer = await text({
        message: "Reroll indices (comma-separated, blank to accept)",
      });

      if (isCancel(answer) || !answer) {
        logSuccess("Accepted.");
        break;
      }

      const indices = parseIndices(answer, wordCount);
      if (!indices) {
        logError(`Invalid indices. Use numbers between 1 and ${wordCount}, comma-separated.`);
        continue;
      }
      if (indices.length === 0) {
        logSuccess("Accepted.");
        break;
      }

      for (const i of indices) words[i] = rollWord();
      printPassphrase(words, separator);
    }

    process.exit(0);
  },
});
