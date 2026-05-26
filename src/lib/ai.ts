import { logError, logInfo, logSection } from "./console.ts";
import type { LLMProvider } from "./ai-provider.ts";
import { createMiniMaxProvider } from "./providers/minimax.ts";
import { createClaudeProvider } from "./providers/claude.ts";
import { createOllamaProvider } from "./providers/ollama.ts";
import { setCapturing } from "./spawn.ts";

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

export function detectProvider(): LLMProvider {
  if (process.env.MINIMAX_API_KEY) return createMiniMaxProvider();
  if (process.env.ANTHROPIC_API_KEY) return createClaudeProvider();
  if (process.env.OLLAMA_HOST || process.env.OLLAMA_MODEL) return createOllamaProvider();
  throw new Error(
    "No AI provider configured. Set MINIMAX_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_HOST/OLLAMA_MODEL",
  );
}

// Intercepts process.stdout/stderr at the JS write layer and enables spawnInherit
// capture mode so subprocess output is piped through process.stdout/stderr and captured.
export async function captureInProcess(fn: () => Promise<boolean>): Promise<{ ok: boolean; output: string }> {
  const parts: string[] = [];
  const dec = new TextDecoder();

  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);

  const tap = (chunk: Uint8Array | string) => {
    const text = typeof chunk === "string" ? chunk : dec.decode(chunk as Uint8Array);
    parts.push(text.replace(ANSI_RE, "").replace(/\r\n?/g, "\n"));
  };

  // @ts-expect-error — intentional stream tap
  process.stdout.write = (chunk: Uint8Array | string, ...rest: unknown[]) => {
    tap(chunk);
    return origOut(chunk as string, ...(rest as []));
  };
  // @ts-expect-error — intentional stream tap
  process.stderr.write = (chunk: Uint8Array | string, ...rest: unknown[]) => {
    tap(chunk);
    return origErr(chunk as string, ...(rest as []));
  };

  setCapturing(true);
  let ok = true;
  try {
    ok = await fn();
  } finally {
    setCapturing(false);
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }

  return { ok, output: parts.join("") };
}

export const SYSTEM_PROMPT = `You receive the raw terminal output of a Linux system update command.

Your job: identify what the user needs to act on or be aware of.

Report ONLY:
- Errors or failures
- Warnings
- Announcements (security notices, deprecation notices, important notes from tools)
- Required actions: reboot, service restart, manual steps

Do NOT report:
- Successful operations
- Version numbers (whether changed or not)
- Package counts
- "Already up to date", "unchanged", or similar status
- Anything that completed without incident

If there is nothing to report, respond with exactly:
Everything is up to date.

Respond with bullet points only. No preamble, no headers, no explanation.`;

export const STEP_PROMPT = `You receive the raw terminal output of one step in a Linux system update.

Report anything the user needs to act on or be aware of:
- Errors or failures
- Warnings
- Announcements, notices, or important messages — even if the command succeeded
- Required actions: reboot, service restart, manual steps
- Version conflicts or unexpected states

Do NOT report:
- Packages that updated normally
- Download progress or sizes
- "Already up to date" or equivalent success messages

If there is nothing to report, respond with exactly: ok

Bullet points only. No preamble, no headers.`;

export async function analyzeStep(output: string): Promise<string[] | null> {
  if (output.trim().length < 100) return null;
  try {
    const provider = detectProvider();
    const text = await provider.complete(STEP_PROMPT, output);
    const trimmed = text.trim();
    if (!trimmed || trimmed === "ok") return null;
    return trimmed.split("\n").filter((l) => l.trim());
  } catch (err) {
    return [`analysis failed: ${(err as Error).message}`];
  }
}

export const CACHE_SYSTEM_PROMPT = `You receive the raw terminal output of a Linux cache-clean command.

Your job: identify what the user needs to act on or be aware of.

Report ONLY:
- Errors or failures (permission errors, failed deletions, tool crashes)
- Warnings (missing helper tools like cargo-cache, unexpected skips)
- Required actions: tools to install, manual cleanup steps

Do NOT report:
- Successful operations or cleared caches
- Tools skipped only because they are not installed
- Disk space freed or remaining sizes
- "Cleared", "removed", or "up to date" success messages
- yay "Error reading fd" lines for download-* temp files (these are harmless)

If there is nothing to report, respond with exactly:
Cache cleaned successfully.

Respond with bullet points only. No preamble, no headers, no explanation.`;

export async function analyzeWithAI(output: string, systemPrompt?: string) {
  logSection("AI Analysis");
  logInfo("Analysing…");

  try {
    const provider = detectProvider();
    const text = await provider.complete(systemPrompt ?? SYSTEM_PROMPT, output);
    const lines = text.trim().split("\n");

    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

    if (lines.length === 0) { logInfo("Nothing to report."); return; }

    console.log();
    for (const line of lines) logInfo(line);
    console.log();
  } catch (err) {
    logError(`AI analysis failed: ${(err as Error).message}`);
  }
}
