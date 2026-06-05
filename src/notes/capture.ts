/**
 * Note capture — AI classification with tiered fallback.
 *
 * Tier 1: BAML (if pi-baml available)
 * Tier 2: Direct LLM call
 * Tier 3: Heuristic fallback
 */

import type { NoteCategory } from "./model.js";

export interface ClassifiedNote {
  title: string;
  content: string;
  category: NoteCategory;
}

export interface ClassifyOptions {
  /** pi-baml library (from EventBus) */
  baml?: { available: boolean; execBaml?: <T>(code: string, fn: string, args: Record<string, unknown>) => Promise<T> };
  /** Model for direct LLM classification */
  model?: { id: string; apiKey: string; baseUrl?: string; headers?: Record<string, string> };
}

const CLASSIFY_PROMPT = `Classify this note and extract a concise title.

Categories:
- "prompt": An action/task to perform later (e.g., "generate ADRs", "refactor auth module")
- "reminder": Something to not forget, a mental note (e.g., "check CI status", "ask about deadline")
- "reference": Information to remember for context (e.g., "auth uses JWT with RS256", "team decided on approach B")

Respond with ONLY valid JSON:
{"title": "concise title (max 50 chars)", "category": "prompt|reminder|reference"}

Note text: `;

const BAML_CODE = `
class ClassifiedNote {
  title string @description("Concise title, max 50 chars")
  category "prompt" | "reminder" | "reference" @description("prompt=action to take, reminder=don't forget, reference=info to remember")
}

function ClassifyNote(text: string) -> ClassifiedNote {
  client PiClient
  prompt #"
    Classify this note and extract a concise title.

    Categories:
    - "prompt": An action/task to perform later (generate ADRs, refactor module)
    - "reminder": Something to not forget (check CI, ask about deadline)
    - "reference": Information for context (auth uses JWT, team decided approach B)

    Note text: {{ text }}

    {{ ctx.output_format }}
  "#
}
`;

/** Classify a note using the best available method */
export async function classifyNote(text: string, options: ClassifyOptions = {}): Promise<ClassifiedNote> {
  // Tier 1: BAML
  if (options.baml?.available && options.baml.execBaml) {
    try {
      const result = await options.baml.execBaml<{ title: string; category: string }>(
        BAML_CODE,
        "ClassifyNote",
        { text },
      );
      if (isValidCategory(result.category)) {
        return { title: result.title.slice(0, 50), content: text, category: result.category };
      }
    } catch {
      // Fall through to tier 2
    }
  }

  // Tier 2: Direct LLM
  if (options.model) {
    try {
      const result = await classifyWithLLM(text, options.model);
      if (result) return result;
    } catch {
      // Fall through to tier 3
    }
  }

  // Tier 3: Heuristic fallback
  return classifyHeuristic(text);
}

async function classifyWithLLM(
  text: string,
  model: { id: string; apiKey: string; baseUrl?: string; headers?: Record<string, string> },
): Promise<ClassifiedNote | null> {
  const url = (model.baseUrl ?? "https://api.openai.com/v1") + "/chat/completions";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${model.apiKey}`,
      ...(model.headers ?? {}),
    },
    body: JSON.stringify({
      model: model.id,
      messages: [{ role: "user", content: CLASSIFY_PROMPT + text }],
      temperature: 0,
      max_tokens: 100,
    }),
  });

  if (!response.ok) return null;

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as { title?: string; category?: string };
    if (parsed.title && isValidCategory(parsed.category)) {
      return { title: parsed.title.slice(0, 50), content: text, category: parsed.category as NoteCategory };
    }
  } catch {
    // JSON parse failed
  }

  return null;
}

/** Heuristic fallback — no AI needed */
export function classifyHeuristic(text: string): ClassifiedNote {
  const title = text.length > 50 ? text.slice(0, 47) + "..." : text;
  return { title, content: text, category: "prompt" };
}

function isValidCategory(cat: unknown): cat is NoteCategory {
  return cat === "prompt" || cat === "reminder" || cat === "reference";
}
