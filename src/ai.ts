import Anthropic from "@anthropic-ai/sdk";
import type { Backlog, ProposedChange, Action } from "./types.js";

const VALID_ACTIONS: Set<string> = new Set([
  "add",
  "update",
  "delete",
  "split",
  "clarify",
]);

const SYSTEM_PROMPT = `You are a backlog management assistant. You interpret natural language requests from a team and produce structured JSON describing exactly what change should be made to the feature backlog.

You must always respond with a JSON object in this shape:
{
  "action": "add" | "update" | "delete" | "split" | "clarify",
  "targetId": string | null,
  "patch": Partial<Feature> | null,
  "newFeatures": Feature[] | null,
  "humanSummary": string
}

Feature shape:
{
  "label": string,
  "description": string,
  "dod": string[],
  "pros": string[],
  "cons": string[],
  "scores": { "effort": 1-5, "impact": 1-5, "reach": 1-5, "recurring": 1-5, "security": 1-5 },
  "createdBy": string
}

Score reference (each point is an order of magnitude):
| Scale | Effort      | Impact         | Reach     | Recurring  | Security |
|-------|-------------|----------------|-----------|------------|----------|
| 5     | 1 hour      | Transformative | Everyone  | Hourly     | Critical |
| 4     | 1 day       | Great          | Majority  | Daily      | High     |
| 3     | 1 week      | Good           | Minority  | Weekly     | Moderate |
| 2     | 1 month     | Minimal        | Few       | Monthly    | Low      |
| 1     | 1 quarter   | None           | One       | Quarterly  | None     |

Rules:
- Never invent scores if not specified — use 3 as default for unspecified scores
- totalScore is always effort * impact (do NOT include totalScore in your output — it is auto-calculated)
- IDs are lowercase slugs of the label (do NOT include id in your output — it is auto-generated)
- Be conservative — if the request is ambiguous, use action "clarify" and explain what you need in humanSummary
- The humanSummary will be shown to the team for confirmation before any change is committed
- For "update" action: only include changed fields in patch
- For "add" action: include the full feature in newFeatures array
- For "split" action: include all replacement features in newFeatures array
- For "delete" action: set targetId, patch and newFeatures should be null
- For "clarify" action: set targetId/patch/newFeatures to null, explain in humanSummary
- Respond with ONLY the JSON object — no markdown, no explanation, no code fences`;

const client = new Anthropic();

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  return text.trim();
}

function validateProposedChange(parsed: unknown): ProposedChange {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Claude returned a non-object response");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj["action"] !== "string" || !VALID_ACTIONS.has(obj["action"])) {
    throw new Error(
      `Invalid action: ${String(obj["action"])}. Must be one of: ${[...VALID_ACTIONS].join(", ")}`,
    );
  }

  if (typeof obj["humanSummary"] !== "string" || obj["humanSummary"] === "") {
    throw new Error("Missing or empty humanSummary in Claude response");
  }

  return {
    action: obj["action"] as Action,
    targetId: (obj["targetId"] as string) ?? null,
    patch: (obj["patch"] as ProposedChange["patch"]) ?? null,
    newFeatures: (obj["newFeatures"] as ProposedChange["newFeatures"]) ?? null,
    humanSummary: obj["humanSummary"],
  };
}

function buildUserContent(
  message: string,
  backlog: Backlog,
  userId: string,
): string {
  return [
    `User (${userId}) says: ${message}`,
    "",
    "Current backlog:",
    JSON.stringify(backlog.features, null, 2),
  ].join("\n");
}

function parseResponseText(text: string): unknown {
  const jsonStr = extractJson(text);
  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `Failed to parse JSON from Claude response: ${text.slice(0, 200)}`,
    );
  }
}

export async function interpretMessage(
  message: string,
  backlog: Backlog,
  userId: string,
): Promise<ProposedChange> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserContent(message, backlog, userId) }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text content in Claude response");
  }

  return validateProposedChange(parseResponseText(textBlock.text));
}
