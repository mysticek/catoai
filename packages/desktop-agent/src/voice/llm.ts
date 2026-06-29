/**
 * Local LLM for compaction/summarization (docs/MEMORY-SCHEMA.md memory pipeline).
 * Uses Ollama's chat API with a small multilingual model so summaries are produced
 * locally and in Slovak. Optional — callers fall back to a heuristic when absent.
 */

export interface Llm {
  readonly kind: string;
  /** Short summary of the given lines, in the requested language (en/sk/cs). */
  summarize(lines: string[], locale: string): Promise<string>;
  /** Describe what an agent is doing RIGHT NOW from its recent output (works
   *  mid-task), in the requested language. */
  describeActivity(project: string, lines: string[], locale: string): Promise<string>;
  /** Classify a free-form command (any of en/sk/cs) into a structured intent —
   *  used as a fallback when fast regex parsing fails. */
  classifyIntent(text: string, projects: string[]): Promise<ClassifiedIntent>;
}

export interface ClassifiedIntent {
  kind: "status" | "projectStatus" | "tell" | "continue" | "stop" | "repeat" | "summarize" | "spawnWorker" | "unknown";
  project?: string;
  agentKind?: string;
  message?: string;
}

/** Human language name for the LLM directive. */
export function langName(locale: string): string {
  const l = (locale || "en").slice(0, 2).toLowerCase();
  return l === "sk" ? "Slovak" : l === "cs" ? "Czech" : "English";
}

export class OllamaLlm implements Llm {
  readonly kind = "ollama";
  constructor(
    private readonly model: string,
    private readonly url: string,
  ) {}

  async summarize(lines: string[], locale: string): Promise<string> {
    const lang = langName(locale);
    const bullets = lines.slice(0, 20).map((l) => `- ${l}`).join("\n");
    return this.#chat(
      `You are Cato, a voice assistant. Reply ONLY in ${lang}. One short factual sentence, no preamble, no bullets.`,
      `Summarize these events into one ${lang} sentence:\n${bullets}`,
      100,
    );
  }

  async describeActivity(project: string, lines: string[], locale: string): Promise<string> {
    const lang = langName(locale);
    // Use the TAIL of the agent's live output → describe current (possibly in-progress) state.
    const tail = lines.slice(-60).join("\n");
    return this.#chat(
      `You are Cato, a voice assistant. Reply ONLY in ${lang}, factual, max two short sentences. No preamble, no bullets, no code.`,
      `This is the latest terminal output of an AI coding agent on project "${project}". ` +
        `In ${lang}, tell me what it is doing right now or its state — even if the task is still in progress:\n\n${tail}`,
      160,
    );
  }

  async classifyIntent(text: string, projects: string[]): Promise<ClassifiedIntent> {
    const system =
      "You classify a developer's spoken command (English, Slovak, or Czech) to an " +
      "AI-coding-agent orchestrator. Output ONLY a JSON object, no prose.\n" +
      'Schema: {"kind": one of ' +
      '"status"|"projectStatus"|"tell"|"continue"|"stop"|"repeat"|"summarize"|"spawnWorker"|"unknown", ' +
      '"project"?: string, "agentKind"?: "claude-code"|"codex", "message"?: string}\n' +
      "Rules: status = general 'what is happening / how is it going / overview' with NO " +
      "specific project. projectStatus = asking about ONE named project's state (set project). " +
      "tell = instruct an agent to do something (set project if named, message = the instruction). " +
      "spawnWorker = start an agent on a project (set agentKind + project). " +
      "continue/stop/repeat/summarize = control verbs. unknown = none of these.\n" +
      "Examples:\n" +
      '"what\'s happening" -> {"kind":"status"}\n' +
      '"ako to vypadá" -> {"kind":"status"}\n' +
      '"jak to jde" -> {"kind":"status"}\n' +
      '"how is shopapp doing" -> {"kind":"projectStatus","project":"shopapp"}\n' +
      '"čo robí shopapp" -> {"kind":"projectStatus","project":"shopapp"}\n' +
      '"tell api to run the tests" -> {"kind":"tell","project":"api","message":"run the tests"}\n' +
      '"povedz shopapp nech commitne" -> {"kind":"tell","project":"shopapp","message":"commitni"}\n' +
      '"zastav to" -> {"kind":"stop"}\n' +
      '"zhrň to" -> {"kind":"summarize"}\n' +
      '"start codex on web" -> {"kind":"spawnWorker","agentKind":"codex","project":"web"}\n' +
      `Known projects: ${projects.join(", ") || "(none)"}.`;
    const raw = await this.#chatJson(system, `Command: "${text}"`);
    try {
      const o = JSON.parse(raw) as ClassifiedIntent;
      return o && typeof o.kind === "string" ? o : { kind: "unknown" };
    } catch {
      return { kind: "unknown" };
    }
  }

  async #chatJson(system: string, user: string): Promise<string> {
    const res = await fetch(`${this.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: false, // qwen3 etc. are reasoning models — disable so we get the answer, not its thinking
        format: "json",
        options: { temperature: 0, num_predict: 200 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`ollama chat HTTP ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string } };
    return (data.message?.content ?? "{}").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  }

  async #chat(system: string, user: string, numPredict: number): Promise<string> {
    const res = await fetch(`${this.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: false,
        options: { temperature: 0.1, num_predict: numPredict },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`ollama chat HTTP ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string } };
    return (data.message?.content ?? "")
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .trim()
      .replace(/\s+/g, " ");
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
