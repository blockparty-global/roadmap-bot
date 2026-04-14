import "dotenv/config";
import { App } from "@slack/bolt";
import { interpretMessage } from "./ai.js";
import {
  loadBacklog,
  saveBacklog,
  addFeature,
  updateFeature,
  deleteFeature,
  splitFeature,
} from "./state.js";
import { ensureList } from "./list.js";
import type { Backlog, ProposedChange } from "./types.js";

const CHECKMARK = "white_check_mark";
const CANCEL = "x";
const REQUIRED_CONFIRMATIONS = 3;

type PendingProposal = {
  proposal: ProposedChange;
  confirmedBy: Set<string>;
  channel: string;
};

export const pendingProposals = new Map<string, PendingProposal>();

let botUserId = "";

export function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

export function applyChange(
  backlog: Backlog,
  change: ProposedChange,
  userId: string,
): Backlog {
  let updated = backlog;

  switch (change.action) {
    case "add":
      for (const feature of change.newFeatures ?? []) {
        updated = addFeature(updated, { ...feature, createdBy: userId });
      }
      break;
    case "update":
      if (change.targetId && change.patch) {
        updated = updateFeature(updated, change.targetId, change.patch);
      }
      break;
    case "delete":
      if (change.targetId) {
        updated = deleteFeature(updated, change.targetId);
      }
      break;
    case "split":
      if (change.targetId && change.newFeatures) {
        updated = splitFeature(updated, change.targetId, change.newFeatures);
      }
      break;
  }

  updated.lastUpdatedBy = userId;
  updated.lastUpdatedAt = new Date().toISOString();
  return updated;
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

app.event("app_mention", async ({ event, say, client }) => {
  const cleanText = stripMention(event.text ?? "");
  console.log(`[mention] from ${event.user}: "${cleanText}"`);

  if (!cleanText) {
    await say({
      text: "Hey! Tell me what you'd like to do — add a feature, update scores, remove something, or split a feature into smaller ones.",
      thread_ts: event.ts,
    });
    return;
  }

  try {
    const backlog = loadBacklog();
    const proposal = await interpretMessage(cleanText, backlog, event.user ?? "unknown");

    if (proposal.action === "clarify") {
      await say({ text: proposal.humanSummary, thread_ts: event.ts });
      return;
    }

    const proposalText = [
      `*Proposal:* ${proposal.humanSummary}`,
      "",
      `Needs ${REQUIRED_CONFIRMATIONS} :white_check_mark: reactions to confirm. React :x: to cancel.`,
      "Tag reviewers in this thread if you'd like specific people to weigh in.",
    ].join("\n");

    const reply = await say({
      text: proposalText,
      thread_ts: event.ts,
    });

    const replyTs = reply.ts;
    if (!replyTs) return;

    await client.reactions.add({
      channel: event.channel,
      timestamp: replyTs,
      name: CHECKMARK,
    });

    pendingProposals.set(replyTs, {
      proposal,
      confirmedBy: new Set(),
      channel: event.channel,
    });
    console.log(`[proposal] ${proposal.action}: "${proposal.humanSummary}"`);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Something went wrong";
    console.log(`[error] mention handler: ${message}`);
    await say({ text: `Error: ${message}`, thread_ts: event.ts });
  }
});

app.event("reaction_added", async ({ event, client }) => {
  if (event.user === botUserId) return;

  const pending = pendingProposals.get(event.item.ts);
  if (!pending) return;

  if (event.reaction === CANCEL) {
    pendingProposals.delete(event.item.ts);
    await client.chat.postMessage({
      channel: event.item.channel,
      text: "Cancelled.",
      thread_ts: event.item.ts,
    });
    return;
  }

  if (event.reaction !== CHECKMARK) return;

  pending.confirmedBy.add(event.user);
  const count = pending.confirmedBy.size;
  const remaining = REQUIRED_CONFIRMATIONS - count;

  if (remaining > 0) {
    console.log(`[vote] ${event.user} confirmed (${count}/${REQUIRED_CONFIRMATIONS})`);
    await client.chat.postMessage({
      channel: event.item.channel,
      text: `${count}/${REQUIRED_CONFIRMATIONS} confirmations. ${remaining} more needed.`,
      thread_ts: event.item.ts,
    });
    return;
  }

  try {
    const backlog = loadBacklog();
    const updated = applyChange(backlog, pending.proposal, event.user);
    saveBacklog(updated);
    console.log(`[confirmed] ${pending.proposal.action} with ${count} votes`);

    pendingProposals.delete(event.item.ts);

    let listNote = "";
    try {
      const channelId = process.env.CHANNEL_ID ?? event.item.channel;
      await ensureList(client, channelId, updated);
    } catch (listErr) {
      console.log(`[error] list update failed: ${listErr instanceof Error ? listErr.message : "unknown"}`);
      listNote = " (Note: List failed to update — it will sync on next change.)";
    }

    const voters = [...pending.confirmedBy].map((u) => `<@${u}>`).join(", ");
    await client.chat.postMessage({
      channel: event.item.channel,
      text: `Done! ${pending.proposal.humanSummary}\nConfirmed by: ${voters}${listNote}`,
      thread_ts: event.item.ts,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Failed to apply change";
    console.log(`[error] confirmation handler: ${errMsg}`);
    const friendly = errMsg.includes("Feature not found")
      ? `${errMsg}. Check the feature name and try again.`
      : errMsg;
    await client.chat.postMessage({
      channel: event.item.channel,
      text: `Error: ${friendly}`,
      thread_ts: event.item.ts,
    });
  }
});

(async () => {
  await app.start();
  const auth = await app.client.auth.test();
  botUserId = auth.user_id ?? "";

  const backlog = loadBacklog();
  if (backlog.features.length > 0 && process.env.CHANNEL_ID) {
    try {
      await ensureList(app.client, process.env.CHANNEL_ID, backlog);
      console.log("List synced on startup");
    } catch (err) {
      console.log(`Canvas sync failed on startup: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  console.log(`Backlog bot running (bot user: ${botUserId})`);
})();
