/**
 * Local LLM for compaction/summarization (docs/MEMORY-SCHEMA.md memory pipeline).
 * Uses Ollama's chat API with a small multilingual model so summaries are produced
 * locally and in Slovak. Optional — callers fall back to a heuristic when absent.
 */

export interface Llm {
  readonly kind: string;
  /** Produce a short Slovak summary of the given lines. */
  summarize(lines: string[]): Promise<string>;
}

export class OllamaLlm implements Llm {
  readonly kind = "ollama";
  constructor(
    private readonly model: string,
    private readonly url: string,
  ) {}

  async summarize(lines: string[]): Promise<string> {
    const bullets = lines.slice(0, 20).map((l) => `- ${l}`).join("\n");
    const res = await fetch(`${this.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        options: { temperature: 0.1, num_predict: 100 },
        messages: [
          {
            role: "system",
            content:
              "Si Cato, slovenský hlasový asistent. Odpovedáš VÝHRADNE po slovensky, " +
              "nikdy po anglicky. Vždy iba jedna krátka vecná veta, žiadny úvod, žiadne odrážky.",
          },
          {
            role: "user",
            content: `Zhrň tieto udalosti do jednej slovenskej vety:\n${bullets}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`ollama chat HTTP ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string } };
    return (data.message?.content ?? "").trim().replace(/\s+/g, " ");
  }
}

/** Returns an Ollama LLM if the chat model is available, else null. */
export async function createLlm(model: string, url = "http://localhost:11434"): Promise<Llm | null> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: { name: string }[] };
    const has = data.models?.some((m) => m.name === model || m.name.startsWith(model.split(":")[0]!));
    return has ? new OllamaLlm(model, url) : null;
  } catch {
    return null;
  }
}
