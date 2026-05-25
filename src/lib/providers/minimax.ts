import type { LLMProvider } from "../ai-provider.ts";

export function createMiniMaxProvider(): LLMProvider {
  return {
    async complete(system, user) {
      const apiKey = process.env.MINIMAX_API_KEY;
      if (!apiKey) throw new Error("MINIMAX_API_KEY not set");
      const apiBase = (process.env.MINIMAX_API_BASE ?? "https://api.minimax.io/v1").replace(/\/$/, "");
      const model = process.env.MINIMAX_MODEL ?? "MiniMax-Text-01";

      const res = await fetch(`${apiBase}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          temperature: 0.1,
          max_tokens: 512,
        }),
      });

      if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
      const data = await res.json() as { choices: { message: { content: string } }[] };
      const raw = data.choices?.[0]?.message?.content ?? "";
      if (!raw) throw new Error("empty response");
      return raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    },
  };
}
