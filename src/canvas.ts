import type { WebClient } from "@slack/web-api";
import type { Backlog } from "./types.js";
import { saveBacklog } from "./state.js";

function formatDate(iso: string): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function truncateList(items: string[], max: number = 3): string {
  if (items.length === 0) return "—";
  const shown = items.slice(0, max);
  return shown.join(", ");
}

export function renderMarkdown(backlog: Backlog): string {
  if (backlog.features.length === 0) {
    return [
      "# Roadmap",
      "",
      "_No features yet — @mention the bot to add one._",
    ].join("\n");
  }

  const sorted = [...backlog.features].sort(
    (a, b) => b.totalScore - a.totalScore,
  );

  const header = [
    "# Roadmap",
    `_Last updated by <@${backlog.lastUpdatedBy}> • ${formatDate(backlog.lastUpdatedAt)}_`,
    "",
    "| Feature | Score | E/I/R/C/S |",
    "|---------|-------|-----------|",
  ];

  const rows = sorted.map((f) => {
    const s = f.scores;
    const scores = `${s.effort}/${s.impact}/${s.reach}/${s.recurring}/${s.security}`;
    return `| ${f.label} | **${f.totalScore}** | ${scores} |`;
  });

  const footer = [
    "",
    "---",
    "_E/I/R/C/S = Effort / Impact / Reach / Recurring / Security (1-5 each). Score = Effort × Impact._",
    "_Sorted by Score (highest first). To propose changes, @mention the bot in the channel._",
  ];

  return [...header, ...rows, ...footer].join("\n");
}

async function createCanvas(
  client: WebClient,
  channelId: string,
  markdown: string,
): Promise<string> {
  const result = await client.conversations.canvases.create({
    channel_id: channelId,
    title: "Roadmap",
    document_content: { type: "markdown", markdown },
  });

  const canvasId = result.canvas_id;
  if (!canvasId) {
    throw new Error("Canvas creation succeeded but no canvas_id returned");
  }
  return canvasId;
}

async function updateCanvas(
  client: WebClient,
  canvasId: string,
  markdown: string,
): Promise<void> {
  await client.canvases.edit({
    canvas_id: canvasId,
    changes: [
      {
        operation: "replace" as const,
        document_content: { type: "markdown" as const, markdown },
      },
    ],
  });
}

export async function ensureCanvas(
  client: WebClient,
  channelId: string,
  backlog: Backlog,
): Promise<string> {
  const markdown = renderMarkdown(backlog);

  if (backlog.canvasId) {
    try {
      await updateCanvas(client, backlog.canvasId, markdown);
      return backlog.canvasId;
    } catch {
      console.log("Canvas update failed (may be deleted), creating new one");
      backlog.canvasId = undefined;
    }
  }

  const canvasId = await createCanvas(client, channelId, markdown);
  backlog.canvasId = canvasId;
  saveBacklog(backlog);
  return canvasId;
}
