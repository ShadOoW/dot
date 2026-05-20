import { logError, logInfo, logSection } from "./console.ts";

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

export async function captureAndStream(args: string[]): Promise<string> {
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "inherit",
  });

  const parts: string[] = [];

  async function tee(stream: ReadableStream<Uint8Array>, out: typeof process.stdout | typeof process.stderr) {
    for await (const chunk of stream) {
      out.write(chunk);
      parts.push(new TextDecoder().decode(chunk));
    }
  }

  await Promise.all([tee(proc.stdout, process.stdout), tee(proc.stderr, process.stderr)]);
  await proc.exited;

  return parts.join("").replace(ANSI_RE, "").replace(/\r\n?/g, "\n");
}

// ─── MiniMax API ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You receive the raw terminal output of a Linux system update command.

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

async function callMiniMax(userContent: string, systemPromptOverride?: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;
  const apiBase = (process.env.MINIMAX_API_BASE ?? "https://api.minimax.io/v1").replace(/\/$/, "");
  const model = process.env.MINIMAX_MODEL ?? "MiniMax-Text-01";

  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY not set — add it to ~/.config/secrets/minimax");
  }

  const res = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPromptOverride ?? SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      max_tokens: 512,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }

  const data = await res.json() as { choices: { message: { content: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? "";
  if (!raw) throw new Error("empty response from API");
  const content = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return content;
}

// ─── public ──────────────────────────────────────────────────────────────────

export async function analyzeWithAI(output: string, systemPrompt?: string) {
  logSection("AI Analysis");
  logInfo("Analysing…");

  try {
    const text = await callMiniMax(output, systemPrompt);
    const lines = text.trim().split("\n");

    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

    if (lines.length === 0) {
      logInfo("Nothing to report.");
      return;
    }

    console.log();
    for (const line of lines) {
      logInfo(line);
    }
    console.log();
  } catch (err) {
    logError(`AI analysis failed: ${(err as Error).message}`);
  }
}
