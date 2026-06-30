/**
 * Cato screens — the four tabs + pair, presentational. State + wiring live in App.tsx.
 * Styling: StyleSheet only (no inline style objects); dynamic colors merged via helpers.
 */
import { ReactNode, useState, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator, TextInput, RefreshControl } from "react-native";
import { C, R, S, tint, MONO, STATUS, StatusKey } from "./theme";
import { Icon, Dot, StatusDot, Pill, RiskBadge, SectionLabel, Card, Btn, IconChip, L, KeyboardSafe } from "./ui";
import type { ProjectStatus, ApprovalRequest, ActivityEvent } from "./catoClient";
import { type Machine, platformLabel, machineLabel } from "./machines";

export type Tab = "talk" | "approvals" | "activity" | "projects";

export function timeAgo(ts?: string): string {
  if (!ts) return "";
  const d = Date.now() - new Date(ts).getTime();
  if (Number.isNaN(d)) return "";
  const m = Math.floor(d / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// dynamic-style helpers (runtime colors)
const tinted = (color: string, border = 0.3, bg = 0.12) => ({ borderColor: tint(color, border), backgroundColor: tint(color, bg) });

// ----- shared chrome ----------------------------------------------------------

export function AppBar({ linked, onSettings }: { linked: boolean; onSettings?: () => void }) {
  const c = linked ? C.active : C.attention;
  return (
    <View style={st.appBar}>
      <View style={st.brandRow}>
        <View style={st.logo}><Icon name="shield" size={15} color={C.onAccent} /></View>
        <Text style={st.brand}>Cato</Text>
      </View>
      <View style={st.appBarRight}>
        <View style={[st.linkPill, tinted(c, 0.25, 0.12)]}>
          <Dot color={c} glow={linked} />
          <Text style={[st.linkText, { color: c }]}>{linked ? "Desktop linked" : "Offline"}</Text>
        </View>
        {onSettings && (
          <Pressable onPress={onSettings} hitSlop={10}><Icon name="gear" size={20} color={C.textMute} /></Pressable>
        )}
      </View>
    </View>
  );
}

export function ScreenTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <View style={st.titleWrap}>
      <View style={L.rowBetween}>
        <Text style={st.h1}>{title}</Text>
        {right}
      </View>
      {sub ? <Text style={st.sub}>{sub}</Text> : null}
    </View>
  );
}

export function TabBar({ active, onTab, approvals }: { active: Tab; onTab: (t: Tab) => void; approvals: number }) {
  const items: { key: Tab; icon: Parameters<typeof Icon>[0]["name"]; label: string }[] = [
    { key: "talk", icon: "wave", label: "Talk" },
    { key: "approvals", icon: "shield", label: "Approvals" },
    { key: "activity", icon: "pulse", label: "Activity" },
    { key: "projects", icon: "stack", label: "Projects" },
  ];
  return (
    <View style={st.tabBar}>
      {items.map((it) => {
        const on = active === it.key;
        return (
          <Pressable key={it.key} style={st.tab} onPress={() => onTab(it.key)}>
            <View>
              <Icon name={it.icon} size={23} color={on ? C.accent : C.idle} />
              {it.key === "approvals" && approvals > 0 && (
                <View style={st.badge}><Text style={st.badgeText}>{approvals}</Text></View>
              )}
            </View>
            <Text style={[st.tabLabel, { color: on ? C.accent : C.idle }]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ----- TALK -------------------------------------------------------------------

export interface ProjectPrefs { listen: boolean; notify: boolean; speak: boolean }
export const DEFAULT_PREFS: ProjectPrefs = { listen: false, notify: true, speak: true };
export type PrefKey = keyof ProjectPrefs;

export function TalkScreen({
  projects, exchange, recording, busy, hint, onPressIn, onPressOut, onOpenProject, onGoApprovals, prefs, onTogglePref,
}: {
  projects: ProjectStatus[];
  exchange?: { user?: string; cato?: string };
  recording: boolean; busy: boolean; hint: string;
  onPressIn: () => void; onPressOut: () => void;
  onOpenProject: (name: string) => void; onGoApprovals: () => void; approvals: number;
  prefs: Record<string, ProjectPrefs>; onTogglePref: (project: string, key: PrefKey) => void;
}) {
  const needs = projects.filter((p) => p.state === "waiting" || p.state === "attention");
  const quiet = projects.filter((p) => p.state === "active" || p.state === "idle");
  const ordered = [...needs, ...quiet]; // attention first, but every project gets its own row
  return (
    <View style={L.fill}>
      <ScrollView style={L.fill} contentContainerStyle={st.talkBody} showsVerticalScrollIndicator={false}>
        <SectionLabel right={
          <Pressable onPress={onGoApprovals} style={st.linkBtn}>
            <Text style={st.linkBtnText}>All {projects.length} projects</Text>
            <Icon name="arrowRight" size={13} color={C.accent} />
          </Pressable>
        }>{`NEEDS YOU · ${needs.length}`}</SectionLabel>

        <View style={st.needsList}>
          {projects.length === 0 && (
            <Card style={st.emptyCard}>
              <Icon name="check" size={22} color={C.active} />
              <Text style={st.emptyText}>No projects yet — run `cato` in a folder.</Text>
            </Card>
          )}
          {ordered.map((p) => (
            <ProjectCard
              key={p.name} p={p}
              prefs={prefs[p.name] ?? DEFAULT_PREFS}
              onPress={() => onOpenProject(p.name)}
              onToggle={(k) => onTogglePref(p.name, k)}
            />
          ))}
        </View>

        {exchange?.cato ? (
          <>
            <SectionLabel>{exchange.user ? `RECENT · “${exchange.user}”` : "RECENT"}</SectionLabel>
            <View style={L.rowTop}>
              <View style={st.miniLogo}><Icon name="wave" size={14} color={C.onAccent} /></View>
              <View style={st.bubble}><Text style={st.bubbleText}>{exchange.cato}</Text></View>
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* push-to-talk dock */}
      <View style={st.dock}>
        <Pressable onPressIn={onPressIn} onPressOut={onPressOut} style={st.pttWrap}>
          {recording && <View style={st.pulseRing} />}
          <View style={[st.pttBtn, recording && st.pttBtnActive]}>
            {busy ? <ActivityIndicator color="#fff" /> : <Icon name="mic" size={30} color="#fff" />}
          </View>
        </Pressable>
        <Text style={st.hint}>{hint}</Text>
      </View>
    </View>
  );
}

const BADGE: Record<StatusKey, string> = { waiting: "WAITING", attention: "ATTENTION", active: "ACTIVE", idle: "IDLE" };

function ProjectCard({
  p, prefs, onPress, onToggle,
}: {
  p: ProjectStatus; prefs: ProjectPrefs; onPress: () => void; onToggle: (k: PrefKey) => void;
}) {
  const key = p.state as StatusKey;
  const color = STATUS[key];
  const prominent = key === "waiting" || key === "attention";
  return (
    <Pressable
      onPress={onPress}
      style={[st.needsCard, { borderColor: prominent ? tint(color, 0.3) : C.border, backgroundColor: prominent ? C.card : C.card2 }]}
    >
      <View style={st.needsHead}>
        <Dot color={color} glow={key === "active"} />
        <Text style={st.needsName} numberOfLines={1}>{p.name}</Text>
        <Pill color={color}>{BADGE[key]}</Pill>
      </View>
      <View style={st.needsFoot}>
        <Text style={st.needsSummary} numberOfLines={1}>{p.summary || "running quietly"}</Text>
        <View style={st.cardActions}>
          {/* per-project: listen to you · notify you · speak to you */}
          <ToggleChip name="mic" on={prefs.listen} onPress={() => onToggle("listen")} />
          <ToggleChip name="bell" on={prefs.notify} onPress={() => onToggle("notify")} />
          <ToggleChip name="speaker" on={prefs.speak} onPress={() => onToggle("speak")} />
        </View>
      </View>
    </Pressable>
  );
}

function ToggleChip({ name, on, onPress }: { name: "mic" | "bell" | "speaker"; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={4} style={[st.toggleChip, on ? st.toggleChipOn : st.toggleChipOff]}>
      <Icon name={name} size={15} color={on ? C.accent : C.textDim} />
    </Pressable>
  );
}

// ----- APPROVALS --------------------------------------------------------------

export function ApprovalsScreen({
  approvals, onResolve, onOpen,
}: {
  approvals: ApprovalRequest[];
  onResolve: (id: string, decision: "allow" | "deny") => void;
  onOpen: (a: ApprovalRequest) => void;
}) {
  const oldest = approvals.length ? approvals[approvals.length - 1] : undefined;
  return (
    <View style={L.fill}>
      <ScreenTitle
        title="Approvals"
        sub={approvals.length ? `Across your projects · oldest ${timeAgo(oldest?.ts)}` : undefined}
        right={approvals.length ? (
          <Pill color={C.waiting}>
            <View style={st.pendRow}><Dot color={C.waiting} /><Text style={st.pendText}>{approvals.length} pending</Text></View>
          </Pill>
        ) : undefined}
      />
      {approvals.length === 0 ? (
        <AllClear />
      ) : (
        <ScrollView style={L.fill} contentContainerStyle={st.apList} showsVerticalScrollIndicator={false}>
          {approvals.map((a) => <ApprovalCard key={a.id} a={a} onResolve={onResolve} onOpen={() => onOpen(a)} />)}
        </ScrollView>
      )}
    </View>
  );
}

export function ApprovalCard({ a, onResolve, onOpen }: { a: ApprovalRequest; onResolve: (id: string, d: "allow" | "deny") => void; onOpen: () => void }) {
  const color = a.risk === "high" ? C.attention : a.risk === "medium" ? C.waiting : C.active;
  const diff = a.detail ? a.detail.split("\n").slice(0, 6) : [];

  // LOW risk → compact one-line row
  if (a.risk === "low") {
    return (
      <Pressable onPress={onOpen} style={st.apCompact}>
        <View style={[st.apIcon, { backgroundColor: tint(C.active, 0.12) }]}><Icon name={a.tool === "WebFetch" ? "globe" : "terminal"} size={18} color={C.active} /></View>
        <View style={st.apCompactBody}>
          <View style={st.apCompactTitleRow}>
            <Text style={st.apTitle} numberOfLines={1}>{a.title}</Text>
            <Pill color={C.active}>LOW</Pill>
          </View>
          <Text style={st.apMeta}>{[a.project, a.tool].filter(Boolean).join(" · ")}</Text>
        </View>
        <IconChip name="check" onPress={() => onResolve(a.id, "allow")} />
      </Pressable>
    );
  }

  return (
    <View style={[st.apCard, { borderColor: tint(color, a.risk === "high" ? 0.4 : 0.18) }]}>
      <View style={[st.apStripe, { backgroundColor: color }]} />
      <View style={st.apCardBody}>
        <View style={st.apHeadRow}>
          <View style={st.apHeadLeft}>
            <RiskBadge risk={a.risk} />
            <View style={st.apToolRow}>
              <Icon name={a.tool === "Bash" ? "terminal" : "edit"} size={13} color={C.textDim} />
              <Text style={st.apTool}>{a.tool}{a.stats ? ` · ${a.stats}` : ""}</Text>
            </View>
          </View>
          <Text style={st.apMeta}>{[a.project, timeAgo(a.ts)].filter(Boolean).join(" · ")}</Text>
        </View>

        <Text style={st.apHeading}>{a.title}</Text>
        {a.summary ? <Text style={st.apSummary}>{a.summary}</Text> : null}

        {/* command or diff preview */}
        {diff.length > 0 && (
          <View style={[st.codeBox, { borderColor: tint(color, 0.2) }]}>
            {diff.map((l, i) => {
              const add = l.startsWith("+"); const del = l.startsWith("-");
              return (
                <View key={i} style={[st.codeLine, add && st.addBg, del && st.delBg]}>
                  <Text style={[st.code, add && st.addFg, del && st.delFg, a.tool === "Bash" && st.delFg]} numberOfLines={1}>
                    {a.tool === "Bash" ? <Text style={st.dollar}>$ </Text> : null}{l || " "}
                  </Text>
                </View>
              );
            })}
            {a.detail.split("\n").length > 6 && <Text style={st.more}>+{a.detail.split("\n").length - 6} more lines — tap Review</Text>}
          </View>
        )}

        <View style={st.apActions}>
          {a.risk === "high" ? (
            <>
              <Btn label="Deny" kind="danger" flex={1} icon="x" onPress={() => onResolve(a.id, "deny")} />
              <Btn label="Review & approve" kind="primary" flex={1.4} icon="check" onPress={onOpen} />
            </>
          ) : (
            <>
              <IconChip name="x" color={C.textDim} bg="transparent" onPress={() => onResolve(a.id, "deny")} />
              <Btn label="Approve" kind="accent" flex={1} icon="check" onPress={() => onResolve(a.id, "allow")} />
            </>
          )}
        </View>
      </View>
    </View>
  );
}

function AllClear() {
  return (
    <View style={st.clearWrap}>
      <View style={[st.bigIcon, { backgroundColor: tint(C.active, 0.12) }]}><Icon name="check" size={34} color={C.active} /></View>
      <Text style={st.clearTitle}>You're all caught up</Text>
      <Text style={st.clearSub}>No approvals waiting. Cato will ping you the moment an agent needs a decision.</Text>
    </View>
  );
}

// ----- ACTIVITY ---------------------------------------------------------------

const EVENT_META: Record<string, { icon: Parameters<typeof Icon>[0]["name"]; color: string; label: string }> = {
  ApprovalRequested: { icon: "shield", color: C.waiting, label: "Approval requested" },
  TestsFailed: { icon: "xCircle", color: C.attention, label: "Tests failed" },
  WorkerError: { icon: "warning", color: C.attention, label: "Worker error" },
  DeploymentStarted: { icon: "rocket", color: C.accent, label: "Deployment started" },
  DeploymentFinished: { icon: "rocket", color: C.active, label: "Deployment finished" },
  DecisionMade: { icon: "check", color: C.textDim, label: "Decision made" },
  WorkerStarted: { icon: "play", color: C.active, label: "Worker started" },
  WorkerStopped: { icon: "stop", color: C.idle, label: "Worker stopped" },
};

export function ActivityScreen({ events }: { events: ActivityEvent[] }) {
  return (
    <View style={L.fill}>
      <ScreenTitle title="Activity" />
      {events.length === 0 ? (
        <View style={st.center}>
          <Icon name="pulse" size={28} color={C.idle} />
          <Text style={st.emptyMute}>No activity yet.</Text>
        </View>
      ) : (
        <ScrollView style={L.fill} contentContainerStyle={st.feedList} showsVerticalScrollIndicator={false}>
          <Text style={st.feedSection}>RECENT</Text>
          {events.map((e, i) => {
            const m = EVENT_META[e.type] ?? { icon: "pulse" as const, color: C.textDim, label: e.type };
            return (
              <View key={i} style={st.feedRow}>
                <View style={[st.feedIcon, { backgroundColor: tint(m.color, 0.14) }]}><Icon name={m.icon} size={15} color={m.color} /></View>
                <View style={st.feedBody}>
                  <View style={L.rowBetween}>
                    <Text style={st.feedTitle}>{m.label}</Text>
                    <Text style={st.feedTime}>{timeAgo(e.ts)}</Text>
                  </View>
                  <Text style={st.feedSummary} numberOfLines={2}>
                    {e.summary}{e.project ? <Text style={st.feedProject}>  · {e.project}</Text> : null}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

// ----- PROJECTS ---------------------------------------------------------------

export function ProjectsScreen({ projects, onOpen, onStart }: { projects: ProjectStatus[]; onOpen: (n: string) => void; onStart: () => void }) {
  return (
    <View style={L.fill}>
      <ScreenTitle title="Projects" right={
        <Pressable onPress={onStart} style={st.startChip}><Icon name="plus" size={15} color={C.onAccent} /><Text style={st.startChipText}>Start</Text></Pressable>
      } />
      <ScrollView style={L.fill} contentContainerStyle={st.projList} showsVerticalScrollIndicator={false}>
        {projects.length === 0 && <Text style={st.projEmpty}>No projects yet. Tap Start to launch an agent.</Text>}
        {projects.map((p) => {
          const color = STATUS[p.state as StatusKey];
          return (
            <Pressable key={p.name} onPress={() => onOpen(p.name)} style={st.projRow}>
              <View style={st.projHead}>
                <Dot color={color} glow={p.state === "active"} />
                <Text style={st.projName}>{p.name}</Text>
                <Pill color={color}>{p.state.toUpperCase()}</Pill>
              </View>
              <Text style={st.projSummary} numberOfLines={1}>{p.summary || "No active task"}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ----- PAIR -------------------------------------------------------------------

const machineIconName = (m: Machine): Parameters<typeof Icon>[0]["name"] =>
  m.platform === "darwin" ? "apple" : m.platform === "win32" ? "windows" : m.platform === "linux" ? "terminal" : "desktop";

export function PairScreen({
  machines, onConnect, onAdd, onRelay, connectingTo, refreshing, onRefresh,
}: {
  machines: Machine[];
  onConnect: (address: string) => void;
  onAdd: (address: string) => void;
  onRelay: () => void;
  connectingTo?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [addr, setAddr] = useState("");
  return (
    <KeyboardSafe>
    <ScrollView
      contentContainerStyle={st.pairWrap} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} /> : undefined}
    >
      <View style={st.spacer40} />
      <View style={st.pairLogo}><Icon name="shield" size={34} color={C.onAccent} /></View>
      <Text style={st.pairTitle}>Connect to Cato</Text>
      <Text style={st.pairSub}>Cato runs on your computer. Pick a machine to control.</Text>

      <View style={st.machineList}>
        <Text style={st.machineSection}>YOUR MACHINES</Text>
        <Text style={st.machineHint}>Cato agents broadcasting on your Wi-Fi show up here automatically.</Text>
        {machines.length === 0 && !adding && <Text style={st.machineEmpty}>Nothing found yet — make sure Cato is running, or add one by URL below.</Text>}
        {machines.map((m) => {
          const busy = connectingTo === m.address;
          return (
            <Pressable key={m.address} onPress={() => onConnect(m.address)} disabled={busy} style={[st.machineRow, m.online === false && st.machineRowOff]}>
              <View style={[st.apIcon, st.machineIcon]}><Icon name={machineIconName(m)} size={20} color={C.accent} /></View>
              <View style={st.machineBody}>
                <Text style={st.machineName} numberOfLines={1}>{machineLabel(m)}</Text>
                <View style={st.machineSub}>
                  {m.online === false ? (
                    <><Dot color={C.idle} /><Text style={[st.foundText, st.offlineText]}>Offline — is Cato running?</Text></>
                  ) : m.secured === false ? (
                    <><Dot color={C.waiting} /><Text style={[st.foundText, st.setupText]}>Setup needed</Text></>
                  ) : m.online === true ? (
                    <><Dot color={C.active} glow /><Text style={st.foundText}>Online</Text></>
                  ) : null}
                  <Text style={st.machineAddr} numberOfLines={1}>{m.online !== undefined ? "· " : ""}{m.platform ? `${platformLabel(m.platform)} · ` : ""}{m.address}</Text>
                </View>
              </View>
              {busy ? <ActivityIndicator color={C.accent} /> : <Icon name="caret" size={20} color={C.textFaint} />}
            </Pressable>
          );
        })}

        {adding ? (
          <View style={st.addBox}>
            <TextInput value={addr} onChangeText={setAddr} autoFocus autoCapitalize="none" autoCorrect={false}
              placeholder="ws://192.168.x.x:8787/v1" placeholderTextColor={C.textMute} style={st.addInput} />
            <View style={st.addRow}>
              <Btn label="Cancel" kind="ghost" flex={1} onPress={() => { setAdding(false); setAddr(""); }} />
              <Btn label="Add" kind="accent" flex={1} icon="plus" onPress={() => { const a = addr.trim(); if (a) { onAdd(a); setAddr(""); setAdding(false); } }} />
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setAdding(true)} style={st.addMachine}>
            <Icon name="plus" size={18} color={C.accent} />
            <Text style={st.addMachineText}>Add by URL</Text>
          </Pressable>
        )}
      </View>

      <Pressable onPress={onRelay} style={st.relayCard}>
        <View style={[st.apIcon, st.relayIcon]}><Icon name="globe" size={19} color={C.accent} /></View>
        <View style={L.flex1}>
          <View style={st.relayTitleRow}>
            <Text style={st.relayTitle}>Cato Relay</Text>
            <Pill bg={C.accent}><Text style={st.proText}>PRO</Text></Pill>
          </View>
          <Text style={st.relaySub}>Reach your desktop from any network — encrypted.</Text>
        </View>
        <Icon name="caret" size={15} color={C.textFaint} />
      </Pressable>
    </ScrollView>
    </KeyboardSafe>
  );
}

// ----- LISTENING OVERLAY ------------------------------------------------------

export function ListeningOverlay({ transcript }: { transcript?: string }) {
  return (
    <View style={st.listenOverlay}>
      <View style={st.listenBody}>
        <View style={st.listenLabelRow}>
          <Dot color={C.accent} />
          <Text style={st.listenLabel}>LISTENING</Text>
        </View>
        <Text style={st.listenText}>{transcript || "…"}</Text>
        <View style={st.waveRow}>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => <View key={i} style={[st.waveBar, { height: 18 + (i % 3) * 16 }]} />)}
        </View>
      </View>
      <View style={st.listenDock}>
        <View style={[st.pttBtn, st.pttBtnActive, st.pttBtnLg]}><Icon name="mic" size={34} color="#fff" /></View>
        <Text style={[st.hint, st.listenHint]}>Release to send</Text>
      </View>
    </View>
  );
}

// ----- TERMINAL (live 1:1 mirror, two-way) -----------------------------------

export function TerminalScreen({
  project, text, onInput, onClose,
}: {
  project: string; text: string;
  onInput: (text: string) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const send = () => { if (draft) { onInput(draft); setDraft(""); } };
  return (
    <View style={st.termRoot}>
      <KeyboardSafe>
        <View style={st.termHeader}>
          <Pressable onPress={onClose} hitSlop={10}><Icon name="arrowLeft" size={22} color={C.textDim} /></Pressable>
          <Text style={st.termTitle} numberOfLines={1}>{project}</Text>
          <Dot color={C.active} glow />
          <Text style={st.termLive}>live</Text>
        </View>
        <ScrollView
          ref={scrollRef}
          style={st.termBody}
          contentContainerStyle={st.termBodyContent}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {/* The agent reflows the pane to this screen's width, so it fits without scrolling. */}
          <Text style={st.termText} selectable>{cleanTerminalScreen(text) || "…"}</Text>
        </ScrollView>
        <View style={st.termBar}>
          <View style={st.termInputRow}>
            <TextInput
              value={draft} onChangeText={setDraft} placeholder="type into the terminal…" placeholderTextColor={C.textMute}
              style={st.termInput} autoCapitalize="none" autoCorrect={false} onSubmitEditing={send} blurOnSubmit={false} returnKeyType="send"
            />
            <Pressable onPress={send} style={[st.termSend, !draft && st.termSendOff]}>
              <Icon name="arrowRight" size={21} color={draft ? C.onAccent : C.textDim} />
            </Pressable>
          </View>
        </View>
      </KeyboardSafe>
    </View>
  );
}

/** Tidy the mirrored screen for display: keep everything (the status bar and Claude's boxes
 *  stay 1:1 — shown via horizontal scroll), just drop the empty bottom padding and collapse
 *  runs of blank lines so there's no huge gap. */
export function cleanTerminalScreen(text: string): string {
  if (!text) return text;
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));
  const blank = (l: string) => /^\s*$/.test(l);
  while (lines.length && blank(lines[lines.length - 1])) lines.pop(); // trailing empty pane rows
  const out: string[] = [];
  for (const l of lines) { if (blank(l) && out.length && blank(out[out.length - 1])) continue; out.push(l); }
  return out.join("\n");
}

/** Detect a terminal selection menu (numbered options + a nav footer) so the app can
 *  surface it as a tappable sheet instead of making the user type numbers. */
export function parseTerminalMenu(screen: string): { question: string; options: string[]; numbers: number[] } | null {
  if (!screen) return null;
  const lines = screen.split("\n");
  const hasFooter = lines.some((l) => /to (select|navigate|cancel)|↑\/↓|esc to/i.test(l));
  if (!hasFooter) return null;
  const optRe = /^\s*[›>❯]?\s*(\d+)[.)]\s+(.+?)\s*$/;
  const opts: { n: number; label: string }[] = [];
  for (const raw of lines) {
    const m = raw.match(optRe);
    if (m) {
      const n = parseInt(m[1], 10);
      const label = m[2].replace(/\s+/g, " ").trim();
      if (label && !opts.some((o) => o.n === n)) opts.push({ n, label });
    }
  }
  if (opts.length < 2) return null;
  const firstIdx = lines.findIndex((l) => optRe.test(l));
  let question = "";
  for (let i = firstIdx - 1; i >= 0 && i > firstIdx - 8; i--) {
    const t = lines[i].trim();
    if (!t || /^[─━—_│|╰╯╭╮▁▔=·.\s]+$/.test(t) || /^[›>❯*]/.test(t)) continue;
    question = t.replace(/^[□◇▸•◦\s]+/, "").trim();
    break;
  }
  return { question: question || "Choose an option", options: opts.map((o) => o.label), numbers: opts.map((o) => o.n) };
}

const st = StyleSheet.create({
  // chrome
  appBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: S.xl, paddingTop: 6, paddingBottom: 14 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  logo: { width: 26, height: 26, borderRadius: 8, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
  brand: { color: C.text, fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  appBarRight: { flexDirection: "row", alignItems: "center", gap: 14 },
  linkPill: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 11, paddingVertical: 6, borderRadius: R.pill, borderWidth: 1 },
  linkText: { fontSize: 12, fontWeight: "600" },
  titleWrap: { paddingHorizontal: S.xl, paddingTop: S.sm, paddingBottom: 14 },
  h1: { color: C.text, fontSize: 24, fontWeight: "700", letterSpacing: -0.5 },
  sub: { color: C.textDim, fontSize: 13, marginTop: 3 },
  pendRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  pendText: { color: C.waiting, fontWeight: "600", fontSize: 12.5 },

  // talk
  talkBody: { paddingHorizontal: S.xl, paddingBottom: 12 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  linkBtnText: { color: C.accent, fontSize: 12.5, fontWeight: "500" },
  needsList: { gap: 10, marginBottom: 16 },
  emptyCard: { alignItems: "center", paddingVertical: 22 },
  emptyText: { color: C.textDim, marginTop: 8 },
  quietRow: { flexDirection: "row", alignItems: "center", gap: 14, padding: 12, paddingHorizontal: 14, backgroundColor: C.card2, borderWidth: 1, borderColor: C.border, borderRadius: 13 },
  quietItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  quietName: { color: C.textDim, fontSize: 13, fontWeight: "500" },
  quietHint: { color: C.textFaint, fontSize: 11.5 },
  needsCard: { backgroundColor: C.card, borderWidth: 1, borderRadius: 15, padding: 13 },
  needsHead: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 9 },
  needsName: { color: C.text, fontSize: 15, fontWeight: "600", flex: 1 },
  needsFoot: { flexDirection: "row", alignItems: "center", gap: 9 },
  needsSummary: { color: C.textDim, fontSize: 12.5, flex: 1 },
  cardActions: { flexDirection: "row", gap: 6, flexShrink: 0 },
  toggleChip: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  toggleChipOn: { backgroundColor: tint(C.accent, 0.16) },
  toggleChipOff: { backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  miniLogo: { width: 26, height: 26, borderRadius: 8, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
  bubble: { maxWidth: "84%", backgroundColor: tint(C.accent, 0.1), borderWidth: 1, borderColor: tint(C.accent, 0.22), borderRadius: 18, borderTopLeftRadius: 4, padding: 13, marginLeft: 9 },
  bubbleText: { color: "#e6e2f5", fontSize: 14, lineHeight: 20 },

  // ptt dock
  dock: { alignItems: "center", paddingTop: 4, paddingBottom: 10 },
  pttWrap: { width: 88, height: 88, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  pulseRing: { position: "absolute", width: 88, height: 88, borderRadius: 44, borderWidth: 1, borderColor: tint(C.accent, 0.45) },
  pttBtn: { width: 74, height: 74, borderRadius: 37, backgroundColor: C.accent2, alignItems: "center", justifyContent: "center", shadowColor: C.accent2, shadowOpacity: 0.7, shadowRadius: 16, shadowOffset: { width: 0, height: 10 } },
  pttBtnActive: { backgroundColor: C.accent },
  pttBtnLg: { width: 84, height: 84 },
  hint: { color: C.textDim, fontSize: 13, fontWeight: "500" },

  // approvals
  apList: { paddingHorizontal: 16, paddingBottom: 14, gap: 12 },
  apCard: { backgroundColor: C.card, borderWidth: 1, borderRadius: 18, overflow: "hidden" },
  apStripe: { height: 3 },
  apCardBody: { padding: 14, paddingTop: 13 },
  apHeadRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  apHeadLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  apToolRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  apCompact: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 13, flexDirection: "row", alignItems: "center", gap: 13 },
  apCompactBody: { flex: 1, minWidth: 0 },
  apCompactTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  apIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  apTitle: { color: C.text, fontSize: 14, fontWeight: "600" },
  apMeta: { color: C.textMute, fontSize: 11.5, fontWeight: "500" },
  apTool: { color: C.textDim, fontSize: 11.5, fontWeight: "600" },
  apHeading: { color: C.text, fontSize: 16, fontWeight: "600", marginBottom: 4 },
  apSummary: { color: C.textDim, fontSize: 12.5, marginBottom: 11, lineHeight: 17 },
  codeBox: { backgroundColor: C.black, borderWidth: 1, borderRadius: 10, paddingVertical: 8, marginTop: 2 },
  codeLine: { paddingHorizontal: 13 },
  code: { fontFamily: MONO, fontSize: 12, color: C.text, lineHeight: 19 },
  addBg: { backgroundColor: tint(C.active, 0.08) },
  delBg: { backgroundColor: tint(C.attention, 0.08) },
  addFg: { color: C.add },
  delFg: { color: C.del },
  dollar: { color: C.textMute },
  more: { color: C.textMute, fontSize: 11, paddingHorizontal: 13, marginTop: 4 },
  apActions: { flexDirection: "row", gap: 10, marginTop: 13, alignItems: "center" },

  clearWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  bigIcon: { width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  clearTitle: { color: C.text, fontSize: 20, fontWeight: "700", marginBottom: 8 },
  clearSub: { color: C.textDim, fontSize: 14, textAlign: "center", lineHeight: 20 },

  // activity
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyMute: { color: C.textMute, marginTop: 10 },
  feedList: { paddingHorizontal: 16, paddingBottom: 14 },
  feedSection: { color: C.textDim, fontSize: 13, fontWeight: "600", letterSpacing: 0.4, marginBottom: 8 },
  feedRow: { flexDirection: "row", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  feedIcon: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  feedBody: { flex: 1, minWidth: 0 },
  feedTitle: { color: C.text, fontSize: 14.5, fontWeight: "600" },
  feedTime: { color: C.textMute, fontSize: 12 },
  feedSummary: { color: C.textDim, fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  feedProject: { color: C.textMute },

  // projects
  projList: { paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
  projEmpty: { color: C.textMute, padding: 16 },
  startChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: C.accent, paddingHorizontal: 12, paddingVertical: 7, borderRadius: R.pill },
  startChipText: { color: C.onAccent, fontWeight: "600", fontSize: 13 },
  projRow: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 15, padding: 14 },
  projHead: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 7 },
  projName: { color: C.text, fontSize: 15, fontWeight: "600", flex: 1 },
  projSummary: { color: C.textDim, fontSize: 12.5 },

  // pair
  pairWrap: { paddingHorizontal: 24, alignItems: "center", flexGrow: 1, paddingBottom: 40 },
  spacer40: { height: 40 },
  machineList: { width: "100%", marginBottom: 8 },
  machineSection: { color: C.textDim, fontSize: 12, fontWeight: "600", letterSpacing: 0.4, marginBottom: 4 },
  machineHint: { color: C.textMute, fontSize: 12, lineHeight: 17, marginBottom: 12 },
  machineEmpty: { color: C.textMute, fontSize: 13, marginBottom: 12, lineHeight: 18 },
  machineRow: { flexDirection: "row", alignItems: "center", gap: 13, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 15, padding: 14, marginBottom: 10 },
  machineRowOff: { opacity: 0.55 },
  machineIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: tint(C.accent, 0.12) },
  machineBody: { flex: 1, minWidth: 0 },
  machineName: { color: C.text, fontSize: 15, fontWeight: "600" },
  machineSub: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  foundText: { color: C.active, fontSize: 12, fontWeight: "600" },
  offlineText: { color: C.textMute },
  setupText: { color: C.waiting },
  machineAddr: { color: C.textDim, fontFamily: MONO, fontSize: 12, flexShrink: 1 },
  addMachine: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 13, borderRadius: 13, borderWidth: 1, borderColor: tint(C.accent, 0.3), borderStyle: "dashed" },
  addMachineText: { color: C.accent, fontSize: 14, fontWeight: "600" },
  addBox: { backgroundColor: C.card, borderWidth: 1, borderColor: tint(C.accent, 0.3), borderRadius: 14, padding: 12 },
  addInput: { color: C.text, fontFamily: MONO, fontSize: 13, backgroundColor: C.black, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 10 },
  addRow: { flexDirection: "row", gap: 10 },
  pairLogo: { width: 62, height: 62, borderRadius: 18, backgroundColor: C.accent, alignItems: "center", justifyContent: "center", marginBottom: 24 },
  pairTitle: { color: C.text, fontSize: 25, fontWeight: "700", letterSpacing: -0.5, marginBottom: 9 },
  pairSub: { color: C.textDim, fontSize: 14.5, textAlign: "center", lineHeight: 21, marginBottom: 24 },
  pairCard: { width: "100%", backgroundColor: C.card, borderWidth: 1, borderColor: tint(C.accent, 0.3), borderRadius: 18, padding: 16, flexDirection: "row", alignItems: "center", gap: 13, marginBottom: 16 },
  pairIcon: { width: 44, height: 44, borderRadius: 12 },
  pairCardBody: { flex: 1, minWidth: 0 },
  pairCardTitle: { color: C.text, fontWeight: "600", fontSize: 15 },
  pairInput: { color: C.textDim, fontFamily: MONO, fontSize: 13, marginTop: 4, padding: 0 },
  pairBtn: { width: "100%", height: 54, backgroundColor: C.accent, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  pairBtnText: { color: C.onAccent, fontWeight: "600", fontSize: 16 },
  relayCard: { width: "100%", backgroundColor: C.card, borderWidth: 1, borderColor: tint(C.accent, 0.22), borderRadius: 14, padding: 13, flexDirection: "row", alignItems: "center", gap: 12, marginTop: 24 },
  relayIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: tint(C.accent, 0.12) },
  relayTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  relayTitle: { color: C.text, fontWeight: "600", fontSize: 13.5 },
  relaySub: { color: C.textDim, fontSize: 12, marginTop: 2 },
  proText: { color: C.onAccent, fontWeight: "700", fontSize: 9 },

  // listening
  listenOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg, zIndex: 50 },
  listenBody: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 34 },
  listenLabelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 24 },
  listenLabel: { color: C.accent, fontSize: 12, fontWeight: "600", letterSpacing: 1.5 },
  listenText: { color: C.text, fontSize: 27, fontWeight: "500", lineHeight: 36, letterSpacing: -0.5, textAlign: "center" },
  waveRow: { flexDirection: "row", alignItems: "center", gap: 5, height: 64, marginTop: 40 },
  waveBar: { width: 4, borderRadius: 3, backgroundColor: C.accent },
  listenDock: { alignItems: "center", paddingBottom: 40 },
  listenHint: { marginTop: 10 },

  // terminal mirror
  termRoot: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg, zIndex: 60, paddingTop: 50 },
  termHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  termTitle: { color: C.text, fontSize: 16, fontWeight: "600", flex: 1 },
  termLive: { color: C.active, fontSize: 12, fontWeight: "600" },
  termBody: { flex: 1, backgroundColor: C.black },
  termBodyContent: { padding: 12 },
  termHScroll: { paddingRight: 24 },
  termText: { color: "#d6d7dd", fontFamily: MONO, fontSize: 11.5, lineHeight: 16 },
  termBar: { borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg },
  termInputRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 26 },
  termInput: { flex: 1, backgroundColor: C.card2, borderWidth: 1, borderColor: C.border, borderRadius: 23, paddingHorizontal: 18, height: 46, color: C.text, fontFamily: MONO, fontSize: 13 },
  termSend: { width: 46, height: 46, borderRadius: 23, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
  termSendOff: { backgroundColor: C.card },

  // tab bar
  tabBar: { height: 76, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.07)", backgroundColor: C.bg, flexDirection: "row", paddingTop: 11 },
  tab: { flex: 1, alignItems: "center", gap: 5 },
  tabLabel: { fontSize: 10, fontWeight: "600" },
  badge: { position: "absolute", top: -4, right: -9, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: C.waiting, alignItems: "center", justifyContent: "center" },
  badgeText: { color: C.onAccent, fontSize: 10, fontWeight: "700" },
});
