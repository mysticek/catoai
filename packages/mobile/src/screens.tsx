/**
 * Cato screens — the four tabs + pair, presentational. State + wiring live in App.tsx.
 * Styling: StyleSheet only (no inline style objects); dynamic colors merged via helpers.
 */
import { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator, TextInput } from "react-native";
import { C, R, S, tint, MONO, STATUS, StatusKey } from "./theme";
import { Icon, Dot, StatusDot, Pill, RiskBadge, SectionLabel, Card, Btn, IconChip, L } from "./ui";
import type { ProjectStatus, ApprovalRequest, ActivityEvent } from "./catoClient";

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

export function AppBar({ linked }: { linked: boolean }) {
  const c = linked ? C.active : C.attention;
  return (
    <View style={st.appBar}>
      <View style={st.brandRow}>
        <View style={st.logo}><Icon name="shield" size={15} color={C.onAccent} /></View>
        <Text style={st.brand}>Cato</Text>
      </View>
      <View style={[st.linkPill, tinted(c, 0.25, 0.12)]}>
        <Dot color={c} glow={linked} />
        <Text style={[st.linkText, { color: c }]}>{linked ? "Desktop linked" : "Offline"}</Text>
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

export function TalkScreen({
  projects, exchange, recording, busy, hint, onPressIn, onPressOut, onOpenProject, onGoApprovals,
}: {
  projects: ProjectStatus[];
  exchange?: { user?: string; cato?: string };
  recording: boolean; busy: boolean; hint: string;
  onPressIn: () => void; onPressOut: () => void;
  onOpenProject: (name: string) => void; onGoApprovals: () => void; approvals: number;
}) {
  const needs = projects.filter((p) => p.state === "waiting" || p.state === "attention");
  const quiet = projects.filter((p) => p.state === "active" || p.state === "idle");
  return (
    <View style={L.fill}>
      <AppBar linked />
      <ScrollView style={L.fill} contentContainerStyle={st.talkBody} showsVerticalScrollIndicator={false}>
        <SectionLabel right={
          <Pressable onPress={onGoApprovals} style={st.linkBtn}>
            <Text style={st.linkBtnText}>All {projects.length} projects</Text>
            <Icon name="arrowRight" size={13} color={C.accent} />
          </Pressable>
        }>{`NEEDS YOU · ${needs.length}`}</SectionLabel>

        <View style={st.needsList}>
          {needs.length === 0 && (
            <Card style={st.emptyCard}>
              <Icon name="check" size={22} color={C.active} />
              <Text style={st.emptyText}>Nothing needs you right now.</Text>
            </Card>
          )}
          {needs.map((p) => <NeedsCard key={p.name} p={p} onPress={() => onOpenProject(p.name)} />)}

          {quiet.length > 0 && (
            <View style={st.quietRow}>
              {quiet.slice(0, 3).map((p) => (
                <View key={p.name} style={st.quietItem}>
                  <StatusDot state={p.state as StatusKey} glow={p.state === "active"} />
                  <Text style={st.quietName}>{p.name}</Text>
                </View>
              ))}
              <View style={L.flex1} />
              <Text style={st.quietHint}>running quietly</Text>
            </View>
          )}
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

function NeedsCard({ p, onPress }: { p: ProjectStatus; onPress: () => void }) {
  const color = STATUS[p.state as StatusKey];
  const label = p.state === "waiting" ? "WAITING" : "ATTENTION";
  return (
    <Pressable onPress={onPress} style={[st.needsCard, { borderColor: tint(color, 0.3) }]}>
      <View style={st.needsHead}>
        <Dot color={color} />
        <Text style={st.needsName} numberOfLines={1}>{p.name}</Text>
        <Pill color={color}>{label}</Pill>
      </View>
      <View style={st.needsFoot}>
        <Text style={st.needsSummary} numberOfLines={1}>{p.summary || "—"}</Text>
        <Icon name="caret" size={15} color={C.textFaint} />
      </View>
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
        sub={approvals.length ? `Across your projects · oldest ${timeAgo(oldest && (oldest as any).ts)}` : undefined}
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
          <Text style={st.apMeta}>{[a.project, timeAgo((a as any).ts)].filter(Boolean).join(" · ")}</Text>
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

export function PairScreen({ url, onChangeUrl, onConnect, connecting }: { url: string; onChangeUrl: (v: string) => void; onConnect: () => void; connecting: boolean }) {
  return (
    <View style={st.pairWrap}>
      <View style={st.spacer40} />
      <View style={st.pairLogo}><Icon name="shield" size={34} color={C.onAccent} /></View>
      <Text style={st.pairTitle}>Link your desktop</Text>
      <Text style={st.pairSub}>Cato runs on your computer. Enter its address to connect this phone.</Text>

      <View style={st.pairCard}>
        <View style={[st.apIcon, st.pairIcon, { backgroundColor: tint(C.accent, 0.12) }]}><Icon name="desktop" size={22} color={C.accent} /></View>
        <View style={st.pairCardBody}>
          <Text style={st.pairCardTitle}>Desktop address</Text>
          <TextInput value={url} onChangeText={onChangeUrl} autoCapitalize="none" autoCorrect={false} style={st.pairInput} placeholder="ws://192.168.x.x:8787/v1" placeholderTextColor={C.textMute} />
        </View>
      </View>

      <Pressable onPress={onConnect} style={st.pairBtn}>
        {connecting ? <ActivityIndicator color={C.onAccent} /> : <><Icon name="link" size={17} color={C.onAccent} /><Text style={st.pairBtnText}>Pair with this Mac</Text></>}
      </Pressable>

      <View style={st.relayCard}>
        <View style={[st.apIcon, st.relayIcon, { backgroundColor: tint(C.accent, 0.12) }]}><Icon name="globe" size={19} color={C.accent} /></View>
        <View style={L.flex1}>
          <View style={st.relayTitleRow}>
            <Text style={st.relayTitle}>Away from home? Cato Relay</Text>
            <Pill bg={C.accent}><Text style={st.proText}>PRO</Text></Pill>
          </View>
          <Text style={st.relaySub}>Reach your desktop from any network — encrypted.</Text>
        </View>
      </View>
    </View>
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

const st = StyleSheet.create({
  // chrome
  appBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: S.xl, paddingTop: 6, paddingBottom: 14 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  logo: { width: 26, height: 26, borderRadius: 8, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
  brand: { color: C.text, fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
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
  pairWrap: { flex: 1, paddingHorizontal: 30, alignItems: "center" },
  spacer40: { height: 40 },
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
  relayCard: { width: "100%", backgroundColor: C.card, borderWidth: 1, borderColor: tint(C.accent, 0.22), borderRadius: 14, padding: 13, flexDirection: "row", alignItems: "center", gap: 12, marginTop: "auto", marginBottom: 20 },
  relayIcon: { width: 38, height: 38, borderRadius: 11 },
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

  // tab bar
  tabBar: { height: 76, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.07)", backgroundColor: C.bg, flexDirection: "row", paddingTop: 11 },
  tab: { flex: 1, alignItems: "center", gap: 5 },
  tabLabel: { fontSize: 10, fontWeight: "600" },
  badge: { position: "absolute", top: -4, right: -9, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: C.waiting, alignItems: "center", justifyContent: "center" },
  badgeText: { color: C.onAccent, fontSize: 10, fontWeight: "700" },
});
