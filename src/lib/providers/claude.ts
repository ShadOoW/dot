import type { LLMProvider } from "../ai-provider.ts";

export function createClaudeProvider(): LLMProvider {
  return {
    async complete(system, user) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
      const model = process.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001";

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });

      if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
      const data = await res.json() as { content: { type: string; text: string }[] };
      const text = data.content?.find((c) => c.type === "text")?.text ?? "";
      if (!text) throw new Error("empty response");
      return text.trim();
    },
  };
}
