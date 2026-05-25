import type { LLMProvider } from "../ai-provider.ts";

export function createOllamaProvider(): LLMProvider {
  return {
    async complete(system, user) {
      const host = (process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/$/, "");
      const model = process.env.OLLAMA_MODEL ?? "llama3";

      const res = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });

      if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
      const data = await res.json() as { message: { content: string } };
      return data.message?.content?.trim() ?? "";
    },
  };
}
