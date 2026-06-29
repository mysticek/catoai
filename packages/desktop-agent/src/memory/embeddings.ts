/**
 * Embeddings — local-first (docs/ARCHITECTURE.md §1). Primary: Ollama
 * (bge-m3, 1024-dim, multilingual incl. Slovak). Fallback: a deterministic hash
 * embedder so the pipeline still works offline with no model (NOT semantic — lexical).
 *
 * The active dimension MUST match infra/db/schema.sql VECTOR(n).
 */

export interface Embedder {
  readonly dim: number;
  readonly kind: string;
  embed(text: string): Promise<number[]>;
}

/** pgvector literal: '[0.1,0.2,...]'. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

export class OllamaEmbedder implements Embedder {
  readonly kind = "ollama";
  constructor(
    readonly dim: number,
    private readonly model: string,
    private readonly url: string,
  ) {}

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.url}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!res.ok) throw new Error(`ollama embeddings HTTP ${res.status}`);
    const data = (await res.json()) as { embedding: number[] };
    if (!Array.isArray(data.embedding)) throw new Error("ollama: no embedding in response");
    return data.embedding;
  }
}

/** Deterministic, dependency-free fallback. Lexical hashing, L2-normalized. */
export class HashEmbedder implements Embedder {
  readonly kind = "hash";
  constructor(readonly dim: number) {}

  async embed(text: string): Promise<number[]> {
    const v = new Array<number>(this.dim).fill(0);
    for (const tok of text.toLowerCase().match(/[a-z0-9áäčďéíľĺňóôŕšťúýž]+/giu) ?? []) {
      let h = 2166136261;
      for (let i = 0; i < tok.length; i++) {
        h ^= tok.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % this.dim;
      v[idx]! += 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }
}

/** Pick an embedder: Ollama if reachable, else the hash fallback. */
export async function createEmbedder(opts: {
  dim: number;
  model?: string;
  url?: string;
}): Promise<Embedder> {
  const url = opts.url ?? "http://localhost:11434";
  const model = opts.model ?? "bge-m3";
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) return new OllamaEmbedder(opts.dim, model, url);
  } catch {
    /* not reachable */
  }
  return new HashEmbedder(opts.dim);
}
