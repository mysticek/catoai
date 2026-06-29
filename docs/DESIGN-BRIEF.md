# Cato — Product & Design Brief

> Brief for designing the **mobile app** and the **desktop dashboard**. The current
> screens are a working prototype, not the design — this document is the basis for the
> real, ambitious redesign. Read it whole before sketching.

---

## 1. One sentence

**Cato is a voice-first command center for your AI coding agents** — it watches what
they do across all your projects, remembers everything, alerts you when something needs
you, and lets you supervise and approve their work from your phone, from anywhere.

Cato = **C**oding **A**gent **T**ask **O**rchestrator. Pronounced "KA-to". Personality:
a calm, capable, trustworthy operator — think a JARVIS-style chief of staff for your
engineering, not a cute chatbot.

---

## 2. The problem

Developers increasingly run **AI coding agents** (Claude Code, Codex) that work
semi-autonomously — editing files, running commands, deploying. Today you must sit and
babysit each one in a terminal: watch output, answer its permission prompts ("can I run
this?"), make decisions. You can't step away. Run several agents and it's chaos —
multiple terminals, no overview, no memory, constant context-switching.

Cato lets you **leave the desk**. Go for a walk, drive, sit by the pool — and still
supervise multiple agents by voice and quick taps. Cato is the persistent brain above
the agents; the agents are disposable workers.

---

## 3. Who it's for

- Developers who use Claude Code / Codex daily, often **several at once**.
- Indie hackers, agency devs, and engineering teams running multiple agents/projects.
- People comfortable in a terminal but who want **oversight + control without being chained to it**.

---

## 4. Core mental model (design must reflect this)

- **Workers are disposable. Tasks are permanent.** A "worker" is one running agent
  session (a Claude/Codex instance). It can crash or be replaced; Cato restarts it and
  the task continues. Users think in **projects** and **tasks**, not worker processes.
- **Cato owns the memory.** Everything important across all projects is remembered and
  searchable. Agents don't remember across sessions — Cato does.
- **Voice-first, glance-second.** The fastest path is speaking. Visual detail is
  optional depth you pull up when you want it.
- **Agent-agnostic.** Claude Code and Codex today; the UI must never feel
  Claude-specific. A "worker" could be any agent.
- **Local-first & private.** Runs on the user's machine; the phone talks to their own
  desktop. (A paid cloud relay for "from anywhere" comes later.)

---

## 5. Two surfaces, two jobs

| Surface | Role | Context of use |
|---|---|---|
| **Mobile app** | "Away mode" — voice-first, glanceable, push-driven decisions | walking, driving, away from desk; one-handed, eyes-often-elsewhere |
| **Desktop dashboard** (local web served by the agent, opened in a browser) | "Mission control" — rich overview + deep review across all agents | at the computer, big screen, alongside the terminal |

They share the same live data but are designed for opposite contexts. Mobile = decide
fast on a summary. Desktop = see everything, review full diffs.

---

## 6. THE killer feature: Approvals

When an agent wants to do something consequential — **run a command, edit a file, write
a file, fetch the web** — Cato intercepts it and asks the human. This is the heart of
the product. The user can approve/deny **from the phone or the dashboard, from
anywhere**, one approvals inbox across all agents.

What an approval contains (real data the UI binds to):
- **project** (e.g. "shopapp")
- **tool** ("Bash" / "Edit" / "Write" / "WebFetch")
- **title** — short, e.g. "Run command", "Edit db.ts"
- **risk** — `low` | `medium` | `high` (heuristic: `rm -rf`, `sudo`, `--force`, writing
  secrets/.env, paths outside the project → high). Must be **instantly obvious**.
- **stats** — e.g. "+4 −0 · 1 file"
- **detail** — the **exact command**, or a **diff** (old → new lines). Can be tiny
  (one line) or large (hundreds of lines, multiple files).
- Actions: **Approve**, **Deny** — and **Deny with a reason** (the reason is sent back
  to the agent, which then *adapts its plan*). 

Design challenges to solve (this is where the prototype falls short):
- **Glanceable, not a wall of text.** Small/simple changes shown inline; large diffs
  summarized (what it does + stats + risk) with full diff on demand / on desktop.
- **Safety against mis-taps.** Approve and especially **Deny** are consequential and
  must be hard to hit by accident (clear separation, maybe confirm on high-risk).
- **Multi-step fatigue.** An agent doing 8 steps = 8 approvals. Need patterns like
  "allow this command for the rest of this run" / "always allow this exact command" so
  the user isn't tapping 20 times. Design the trust-building/escalation UX.
- **Complex prompts.** Beyond simple tool gates, agents sometimes ask multi-choice or
  multi-select questions ("which approach? 1/2/3"). The design should anticipate
  rendering selectable options, not just approve/deny.
- **Notifications.** Approvals (and alerts) arrive as **push notifications** even when
  the app is closed — design the notification → tap → decide flow.

---

## 7. Mobile app — required surfaces & flows

Design these (names are functional, not final):

1. **Pair / Connect.** First run: connect the phone to the user's desktop Cato (same
   Wi-Fi today; pairing token). Should feel like pairing a trusted device, near-zero
   config. Handle "can't reach desktop" gracefully.
2. **Home / Talk (default).** Big **push-to-talk** affordance (hold to speak). Live
   **status of projects** (cards: name + state). The recent spoken exchange
   (what you said → what Cato said). Voice is the hero here.
3. **Approvals.** The pending-decisions queue (see §6). Often reached via a push
   notification. The single most important screen to get right.
4. **Activity / Feed.** Timeline of notable events across projects — `TestsFailed`,
   `WorkerError`, `DeploymentFinished`, `ApprovalRequested`, worker started/stopped —
   color-coded, scannable, with project + time.
5. **Project / "How is it doing".** Tap a project (or ask "how is shopapp doing") →
   Cato reads the agent's **live output** and gives a natural spoken+written summary,
   **even mid-task** ("It's refactoring the parser; tests not run yet"). Plus the
   current task and recent activity.
6. **Quick controls.** continue · stop · repeat · summarize (and "start an agent on
   project X").
7. **Settings.** **Language: EN / SK / CS** (affects speech recognition, Cato's spoken
   replies, and TTS voice). Desktop address / re-pair. (Keep minimal.)

Voice in/out: the user speaks (any of EN/SK/CS, mixed technical terms); Cato replies in
the chosen language by **text + spoken TTS**. Design for spoken-first but readable.

### Project states (status color system)
- `idle` — nothing happening
- `active` — agent working
- `waiting` — needs your decision (approval pending)
- `attention` — something wrong (tests failing, error)

---

## 8. Desktop dashboard — required surfaces

Local web app served by the desktop agent (open in browser). "Mission control":

1. **Grid of agents/projects** — one card per project: state, current task, last events,
   a **live preview** of recent output. Like a CI dashboard for your AI agents.
2. **Approvals panel** — pending decisions with **full context**: complete syntax-
   highlighted diff / full command, risk, project. Approve / Deny / Deny-with-reason.
   This is where you do the *deep* review the phone defers.
3. **Timeline** — the full event stream across projects.
4. **Memory search** — query everything Cato remembers ("what did we decide about
   auth?") with semantic results. Surfaces the memory as a first-class asset.
5. **Project / task detail** — task intent, the worker(s) over time (incl. crashes &
   recoveries), full captured output.

It's **oversight + control, not an editor**. Users still work in their terminal; the
dashboard is the bird's-eye view they don't have today.

---

## 9. Live data the UI binds to (shapes)

Everything is real-time over a local WebSocket. Key payloads a designer should know:

- **Project status:** `{ name, state: idle|active|waiting|attention, summary }`
- **Approval request:** `{ id, project, tool, title, risk: low|medium|high, stats, detail }`
- **Event (push):** `{ type, project, summary, importance, ts }` — types include
  `TestsFailed`, `WorkerError`, `ApprovalRequested`, `DeploymentStarted/Finished`,
  `WorkerStarted/Stopped`, `DecisionMade`.
- **Transcript:** what the user's speech was recognized as.
- **Speak:** Cato's reply text (also spoken via TTS).

The app reacts live: status updates, events arrive unprompted, approvals pop in,
pending approvals replay when the phone reconnects.

---

## 10. UX principles & constraints (please honor)

- **Voice-first, eyes-light.** On a walk/in a car: large tap targets, minimal reading,
  one-handed. The phone should be usable with a glance.
- **Glanceable depth.** Summary first (risk + what + stats); details on demand.
- **Safety.** Destructive/high-risk actions stand out (color, iconography) and are
  protected from accidental taps. Deny and Approve must be unmistakable and separated.
- **Honest latency.** Speech recognition and the local summarizer take ~1–10 seconds —
  design clear "listening / thinking / running" states; never a dead frozen screen.
- **Calm, trustworthy tone.** Cato is a capable operator. Confident, concise, never
  cutesy. Dark theme by default (devs, often at night).
- **Multilingual.** EN / SK / CS for all spoken + written copy; copy must work in all
  three (some words get longer — leave room).
- **Local-first.** Works on the LAN with no cloud; handle disconnect/reconnect cleanly.
- **Accessibility** for on-the-go: high contrast, large type option, haptics for
  approve/deny confirmation, works with the screen mostly glanced at.

---

## 11. Brand notes

- Name: **Cato**. Wake-word style address ("Cato, what's happening?"). Short, calm.
- Vibe: an elite, discreet chief-of-staff for engineering. Premium, focused, a little
  futuristic — but tool-serious, not toy. Reference points: Linear's precision, a
  cockpit/mission-control feel, JARVIS's calm competence.

---

## 12. Scope

**Now (MVP, working):** voice loop (speak → recognize → act → spoken reply), project
status, memory + semantic recall, multi-agent capture & recovery, live "what is X
doing" summaries, the approval channel (tool gates with command/diff/risk),
proactive push, EN/SK/CS.

**This redesign should cover:** the mobile app (all of §7) and the desktop dashboard
(all of §8), with the **approvals experience** (§6) as the centerpiece.

**Future / out of scope for now:** Apple Watch, CarPlay, Vision Pro, wake-word
hands-free, Slack/GitHub/CI integrations, team/shared-memory multi-user, cloud relay.
(Design can leave room for these but needn't solve them.)
