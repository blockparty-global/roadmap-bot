# Backlog Bot — Full Build Plan

## Overview

A Slack bot that acts as a scribe for a feature backlog. Team members discuss features, propose changes, and confirm them via emoji reaction. The bot maintains a live Canvas in a designated Slack channel that always shows the current backlog as a formatted markdown table. No Notion. No manual doc updates.

---

## User Flow

1. Anyone in the channel talks to the bot in natural language:
   - `@backlog-bot add a new feature: dark mode, low effort, high impact`
   - `@backlog-bot add a con to Basic Balances: no pagination hurts large wallets`
   - `@backlog-bot split Full Balances into two smaller features`
   - `@backlog-bot re-score Dark Mode effort to 4`
2. Bot interprets the request using Claude and replies with a **proposed diff** — a human-readable summary of what it would change.
3. Bot adds a ✅ reaction to its own proposal message.
4. Any team member reacts ✅ to confirm.
5. Bot updates the JSON state, re-renders the Canvas with the updated table, and replies with a confirmation.
6. Conversation messages are **ephemeral or threaded** — they don't clutter the main channel. The Canvas is always the clean source of truth.

---

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Slack SDK**: `@slack/bolt` (Socket Mode — no public URL needed)
- **AI**: Anthropic API (`claude-sonnet-4-20250514`) for natural language → structured change interpretation
- **State**: Local `backlog.json` file (flat JSON, the canvas is re-rendered from this on every update)
- **Slack surface**: Channel Canvas (markdown table, always visible in channel header)

---

## Project Structure

```
backlog-bot/
├── src/
│   ├── index.ts          # Bolt app init, event listeners
│   ├── ai.ts             # Claude integration — interprets messages, proposes diffs
│   ├── canvas.ts         # Canvas read/write/render logic
│   ├── state.ts          # Read/write backlog.json
│   └── types.ts          # Shared types
├── backlog.json           # Persisted state (auto-created if missing)
├── .env
├── tsconfig.json
└── package.json
```

---

## Data Model

```ts
// types.ts

export type Score = 1 | 2 | 3 | 4 | 5;

export type Feature = {
  id: string;                // slugified label e.g. "basic-balances"
  label: string;             // 2-5 words
  description: string;       // 10-20 words
  dod: string[];             // definition of done, 3-10 bullets
  pros: string[];
  cons: string[];
  scores: {
    effort: Score;
    impact: Score;
    reach: Score;
    recurring: Score;
    security: Score;
  };
  totalScore: number;        // effort * impact, auto-calculated
  splitOf?: string;          // parent feature id if this was split from another
  createdBy: string;         // Slack user ID
  updatedAt: string;         // ISO timestamp
};

export type Backlog = {
  features: Feature[];
  canvasId?: string;         // stored after first canvas creation
  lastUpdatedBy: string;
  lastUpdatedAt: string;
};
```

---

## Score Reference Table

| Scale | Effort | Impact | Reach | Recurring | Security |
|-------|--------|--------|-------|-----------|----------|
| 5 | 1 hour | Transformative | Everyone | Hourly | Critical |
| 4 | 1 day | Great | Majority | Daily | High |
| 3 | 1 week | Good | Minority | Weekly | Moderate |
| 2 | 1 month | Minimal | Couple/view | Monthly | Low |
| 1 | 1 quarter | None | One | Quarterly | None |

`totalScore = effort * impact` — higher is better. Each point is an order of magnitude, not incremental.

---

## Canvas Rendering

The canvas is re-rendered from scratch on every confirmed update. Format:

```markdown
# 📋 Feature Backlog
_Last updated by @username • Apr 6 2026_

| # | Feature | Score | Effort | Impact | Reach | Recurring | Security | Pros | Cons |
|---|---------|-------|--------|--------|-------|-----------|----------|------|------|
| 1 | Basic Balances | **12** | 3 | 4 | 3 | 2 | 1 | Fast to ship, unblocks partners | No pagination |
| 2 | Full Balances | **10** | 2 | 5 | 4 | 3 | 1 | Complete data | Takes a month |

---
_Sorted by Score (highest first). To propose changes, @mention the bot in this channel._
```

Features are always sorted by `totalScore` descending.

---

## AI Integration (`ai.ts`)

### System prompt

```
You are a backlog management assistant. You interpret natural language requests from a team and produce structured JSON describing exactly what change should be made to the feature backlog.

You must always respond with a JSON object in this shape:
{
  "action": "add" | "update" | "delete" | "split",
  "targetId": string | null,        // existing feature id if updating/deleting/splitting
  "patch": Partial<Feature> | null, // fields to update (for "update" action)
  "newFeatures": Feature[] | null,  // full feature objects (for "add" or "split" actions)
  "humanSummary": string            // 1-2 sentence plain English description of the proposed change
}

The humanSummary will be shown to the team for confirmation before any change is committed.
Rules:
- Never invent scores if not specified — use 3 as default
- totalScore is always effort * impact
- ids are lowercase slugs of the label
- Be conservative — if the request is ambiguous, reflect that in humanSummary and use best-guess values
```

### Flow

1. Receive Slack message text + current backlog JSON
2. Send both to Claude
3. Parse response JSON
4. Post `humanSummary` as a threaded reply with a ✅ reaction
5. Store the pending change in memory keyed by the proposal message `ts`
6. On `reaction_added` event for ✅ on that message → commit the change

---

## Slack Event Handlers (`index.ts`)

### `app_mention`
- Triggered when someone @mentions the bot
- Extract message text, pass to `ai.ts` with current backlog state
- Post proposal as a thread reply
- Add ✅ reaction to the proposal
- Store pending proposal in a `Map<string, ProposedChange>` keyed by message `ts`

### `reaction_added`
- Check if the reaction is ✅
- Check if the message `ts` is in the pending proposals map
- If yes → commit the change via `state.ts`, re-render canvas via `canvas.ts`, reply confirming update
- Remove from pending map

---

## Canvas API (`canvas.ts`)

### On first run
- Call `conversations.canvases.create` with the channel ID to create the canvas
- Store the returned `canvas_id` in `backlog.json`

### On every confirmed update
- Call `canvases.sections.lookup` to get current content (optional, for safety)
- Call `canvases.sections.update` or just do a full content replace using the document_id
- Re-render full markdown table from current backlog state

### Relevant Slack API methods
- `conversations.canvases.create` — creates a canvas for a channel
- `canvases.edit` — updates canvas content (use `retain_all` + replace sections)

---

## Environment Variables

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
ANTHROPIC_API_KEY=...
CHANNEL_ID=C0XXXXXXX
```

---

## Slack App Config Requirements

### OAuth Scopes (Bot Token)
- `chat:write`
- `chat:write.public`
- `canvases:write`
- `canvases:read`
- `channels:history`
- `reactions:read`
- `reactions:write`

### Event Subscriptions (Socket Mode)
- `app_mention`
- `reaction_added`

### Socket Mode
- Enabled, with an App-Level Token scoped to `connections:write`

---

## npm Dependencies

```json
{
  "dependencies": {
    "@slack/bolt": "^3.x",
    "@anthropic-ai/sdk": "^0.x",
    "dotenv": "^16.x",
    "slugify": "^1.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/node": "^20.x",
    "ts-node": "^10.x"
  }
}
```

---

## Edge Cases to Handle

- **Bot mentioned but request is unclear** — Claude should still respond with a best-guess `humanSummary` asking for clarification, no change committed
- **Feature not found** — if `targetId` doesn't match any feature, bot replies asking to clarify
- **Duplicate feature id** — slugify + append a number suffix
- **Canvas not yet created** — create it on first confirmed update, store the id
- **Multiple pending proposals** — each is stored independently by message `ts`, all can be confirmed independently
- **Bot reacts to its own proposal** — the ✅ that the bot adds should NOT trigger a commit; only a human reaction should. Check that the `reaction_added` event user is not the bot's own user ID.

---

## Running the Bot

```bash
# Development
npx ts-node src/index.ts

# Or compile and run
npx tsc && node dist/index.ts
```

No server needed — Socket Mode uses a persistent WebSocket connection.
