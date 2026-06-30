/**
 * Cato — mobile command center. The brain lives on the desktop agent; this app connects,
 * captures push-to-talk audio, plays spoken replies, and renders the live state across
 * four tabs (Talk / Approvals / Activity / Projects). Implements Cato.dc.html.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Dimensions, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
// NOTE: SafeAreaView from react-native is deprecated; migrate to react-native-safe-area-context
// on the next NATIVE rebuild (it's a native module, so importing it on a JS-only build crashes).
import { StatusBar } from "expo-status-bar";
import * as Speech from "expo-speech";
import Constants from "expo-constants";
import { useAudioRecorder, AudioModule, setAudioModeAsync } from "expo-audio";
import { CatoClient, type ProjectStatus, type ProjectInfo, type ApprovalRequest, type AgentQuestion, type ActivityEvent } from "./src/catoClient";
import { readBase64, REC_OPTIONS } from "./src/audio";
import { C, tint } from "./src/theme";
import { Icon, Pill, L, BottomSheet } from "./src/ui";
import {
  TalkScreen, ApprovalsScreen, ActivityScreen, ProjectsScreen, PairScreen, TerminalScreen, TabBar, ListeningOverlay, AppBar,
  parseTerminalMenu, DEFAULT_PREFS, type Tab, type ProjectPrefs, type PrefKey,
} from "./src/screens";
import { ApprovalDetailSheet, MultiChoiceSheet, StartAgentSheet, TokenSheet, SetupGateSheet } from "./src/sheets";
import { loadMachines, saveMachines, upsert, applyIdentity, fetchMachineInfo, saveToken, loadAliases, saveAliases, type Machine } from "./src/machines";
import { useDiscovery } from "./src/discovery";

const extra = (Constants.expoConfig?.extra ?? {}) as { desktopWsUrl?: string; pairingToken?: string };
const TTS: Record<string, string> = { en: "en-US", sk: "sk-SK", cs: "cs-CZ" };

export default function App() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [active, setActive] = useState("");
  const [connectingTo, setConnectingTo] = useState<string | undefined>();
  const [locale, setLocale] = useState("en");
  const [connected, setConnected] = useState(false);

  const [tab, setTab] = useState<Tab>("talk");
  const [projects, setProjects] = useState<ProjectStatus[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [question, setQuestion] = useState<AgentQuestion | null>(null);
  const [exchange, setExchange] = useState<{ user?: string; cato?: string }>({});

  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState("");

  const [detail, setDetail] = useState<ApprovalRequest | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tokenFor, setTokenFor] = useState<string | null>(null); // address awaiting a token
  const [gateFor, setGateFor] = useState<string | null>(null); // address that needs `cato setup`
  const [terminalProject, setTerminalProject] = useState<string | null>(null); // open terminal mirror
  const [terminalText, setTerminalText] = useState("");
  const [terminalMenu, setTerminalMenu] = useState<{ question: string; options: string[]; numbers: number[] } | null>(null);
  const [allProjects, setAllProjects] = useState<ProjectInfo[]>([]);
  const [prefs, setPrefs] = useState<Record<string, ProjectPrefs>>({}); // per-project listen/notify/speak
  const [aliases, setAliases] = useState<Record<string, string>>({}); // custom project names
  useEffect(() => { void loadAliases().then(setAliases); }, []);
  const displayName = useCallback((name: string) => aliases[name]?.trim() || name, [aliases]);
  const renameProject = useCallback((name: string, alias: string) => {
    setAliases((cur) => {
      const next = { ...cur };
      const v = alias.trim();
      if (v && v !== name) next[name] = v; else delete next[name];
      void saveAliases(next);
      return next;
    });
  }, []);

  const togglePref = useCallback((project: string, key: PrefKey) => {
    setPrefs((cur) => {
      const p = cur[project] ?? DEFAULT_PREFS;
      return { ...cur, [project]: { ...p, [key]: !p[key] } };
    });
  }, []);

  const [reconnecting, setReconnecting] = useState(false);
  const client = useRef<CatoClient | null>(null);
  const enriched = useRef<Set<string>>(new Set());
  const reconnect = useRef<{ address: string; token?: string; attempts: number } | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminalProjectRef = useRef<string | null>(null);
  const recorder = useAudioRecorder(REC_OPTIONS);

  const connect = useCallback((address: string, token?: string) => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    client.current?.close();
    setActive(address);
    setConnectingTo(address);
    // Remember the target so we can auto-reconnect; keep the attempt count for the same machine.
    reconnect.current = { address, token, attempts: reconnect.current?.address === address ? reconnect.current.attempts : 0 };
    const pub = machines.find((m) => m.address === address)?.pub; // E2E when we know the key
    const c = new CatoClient(address, token ?? "changeme", {
      onWelcome: (ps, meta) => {
        setConnected(true); setConnectingTo(undefined); setReconnecting(false); setProjects(ps);
        if (reconnect.current) reconnect.current.attempts = 0;
        // Persist the working token to the Keychain, keyed by the stable machine id.
        if (meta.machineId && token) void saveToken(meta.machineId, token);
        // Learn identity (stable id + name) and dedupe by id (handles changed IPs).
        setMachines((prev) => {
          const next = applyIdentity(prev, address, { id: meta.machineId, host: meta.host, platform: meta.platform });
          void saveMachines(next);
          return next;
        });
      },
      onStatus: setProjects,
      onTranscript: (t, final) => { setTranscript(t); if (final) setExchange((e) => ({ ...e, user: t })); },
      onSpeak: (text, loc) => { setBusy(false); setExchange((e) => ({ ...e, cato: text })); Speech.speak(text, { language: TTS[loc] ?? loc }); },
      onApproval: (a) => setApprovals((prev) => [a, ...prev.filter((x) => x.id !== a.id)]),
      onApprovalUpdate: (id, summary, suggestions) =>
        setApprovals((prev) => prev.map((a) => (a.id === id ? { ...a, summary: summary ?? a.summary, suggestions: suggestions ?? a.suggestions } : a))),
      onQuestion: () => { /* menus are handled live in the terminal view, not a global popup */ },
      onActivity: (e) => setActivity((prev) => [e, ...prev].slice(0, 60)),
      onTerminalScreen: (proj, text) => setTerminalText((cur) => (proj === terminalProjectRef.current ? text : cur)),
      onProjectsAll: setAllProjects,
      onError: (code) => {
        setBusy(false); setConnectingTo(undefined);
        if (code === "not_set_up") setGateFor(address);
        else if (code === "unauthorized") setTokenFor(address);
      },
      onClose: () => {
        setConnected(false); setConnectingTo(undefined);
        // Auto-reconnect with backoff while this is still the active target.
        if (reconnect.current?.address === address) {
          reconnect.current.attempts += 1;
          const delay = Math.min(15_000, 1_000 * 2 ** (reconnect.current.attempts - 1));
          setReconnecting(true);
          reconnectTimer.current = setTimeout(() => connect(address, token), delay);
        }
      },
    }, pub);
    c.connect();
    client.current = c;
  }, [machines]);

  // Stop auto-reconnecting (user picked another machine / closed).
  const stopReconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnect.current = null;
    setReconnecting(false);
  }, []);

  // Disconnect and return to the Pair screen (to switch machines).
  const disconnect = useCallback(() => {
    stopReconnect();
    client.current?.close();
    client.current = null;
    setConnected(false);
    setSettingsOpen(false);
  }, [stopReconnect]);

  // Tap a machine → verify it's set up, then gate / token / connect.
  const handleConnect = useCallback(async (address: string) => {
    let m = machines.find((x) => x.address === address);
    // Make sure we actually know whether it's been through `cato setup`.
    if (!m || m.secured === undefined) {
      const info = await fetchMachineInfo(address);
      if (!info) { Alert.alert("Can't reach this machine", "Make sure Cato is running on it and you're on the same Wi-Fi."); return; }
      setMachines((prev) => { const next = applyIdentity(prev, address, info); void saveMachines(next); return next; });
      m = { ...(m ?? { address }), ...info, secured: info.secured, onboarded: info.onboarded, pub: info.pub } as Machine;
    }
    if (m.secured === false || m.onboarded === false) { setGateFor(address); return; } // run `cato setup`
    if (!m.token) { setTokenFor(address); return; } // pair with `cato pair`
    connect(address, m.token);
  }, [machines, connect]);

  const submitToken = useCallback((address: string, token: string) => {
    setMachines((prev) => { const next = upsert(prev, { address, token }); void saveMachines(next); return next; });
    setTokenFor(null);
    connect(address, token);
  }, [connect]);

  const addMachine = useCallback((address: string) => {
    setMachines((prev) => { const next = upsert(prev, { address }); void saveMachines(next); return next; });
    handleConnect(address);
  }, [handleConnect]);

  const onRelay = useCallback(() => {
    Alert.alert("Cato Relay · PRO", "Reach your desktop from any network with push notifications, even when the app is closed. Coming soon.");
  }, []);

  // Load saved machines on mount. No auto-connect — the user picks from the list
  // (which fills in name + Online status via mDNS + /info before they choose).
  useEffect(() => {
    let mounted = true;
    (async () => {
      let list = await loadMachines();
      if (list.length === 0 && extra.desktopWsUrl) list = [{ address: extra.desktopWsUrl }];
      if (mounted) setMachines(list);
    })();
    return () => { mounted = false; client.current?.close(); };
  }, []);

  const onPressIn = useCallback(async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setTranscript("");
      setRecording(true);
    } catch { setRecording(false); }
  }, [recorder]);

  const onPressOut = useCallback(async () => {
    setRecording(false);
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) { setBusy(false); return; }
      const audioBase64 = await readBase64(uri);
      client.current?.sendVoice({ audioBase64, locale });
    } catch { setBusy(false); }
  }, [recorder, locale]);

  const resolveApproval = useCallback((id: string, decision: "allow" | "deny", reason?: string, scope: "once" | "session" | "command" = "once") => {
    client.current?.resolveApproval(id, decision, reason, scope);
    setApprovals((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const answerQuestion = useCallback((id: string, index: number) => {
    client.current?.answerQuestion(id, index);
    setQuestion(null);
  }, []);

  // Terminal viewport in character cells, so the agent reflows the pane to fit this phone.
  const termSize = useCallback(() => {
    const { width, height } = Dimensions.get("window");
    return {
      cols: Math.max(24, Math.floor((width - 12) / 6.9)), // mono char ≈ 0.6 × 11.5px font
      rows: Math.max(20, Math.floor((height - 180) / 16)),
    };
  }, []);

  // Tap a project → open the live terminal mirror (reflowed to this screen, two-way).
  const openProject = useCallback((name: string) => {
    setTerminalText("");
    setTerminalProject(name);
    terminalProjectRef.current = name;
    const { cols, rows } = termSize();
    client.current?.getTerminal(name, cols, rows);
  }, [termSize]);

  // Load the chat history (running + past) when the Projects tab opens.
  useEffect(() => { if (tab === "projects" && connected) client.current?.listProjects(); }, [tab, connected]);
  const closeProject = useCallback((name: string) => {
    client.current?.closeSession(name);
    setTimeout(() => client.current?.listProjects(), 1200);
  }, []);
  const reopenProject = useCallback((name: string) => {
    client.current?.reopenSession(name);
    setTimeout(() => client.current?.listProjects(), 2800);
  }, []);

  // Poll the open terminal's screen ~1s for a live mirror.
  useEffect(() => {
    if (!terminalProject || !connected) return;
    const { cols, rows } = termSize();
    const t = setInterval(() => client.current?.getTerminal(terminalProject, cols, rows), 1000);
    return () => clearInterval(t);
  }, [terminalProject, connected, termSize]);

  // When the mirrored terminal shows a numbered menu, surface it as a tap sheet (no typing
  // numbers). Re-show only when the menu changes or reappears, not after the user dismisses.
  const shownMenuSig = useRef<string | null>(null);
  useEffect(() => {
    if (!terminalProject) { setTerminalMenu(null); shownMenuSig.current = null; return; }
    const m = parseTerminalMenu(terminalText);
    if (!m) { shownMenuSig.current = null; setTerminalMenu(null); return; }
    const sig = m.question + "|" + m.options.join("|");
    if (sig !== shownMenuSig.current) { shownMenuSig.current = sig; setTerminalMenu(m); }
  }, [terminalText, terminalProject]);

  const startAgent = useCallback((path: string, agent: string, task: string) => {
    client.current?.spawnWorker(agent, path, task);
    setStartOpen(false);
    // Jump straight into the new chat's terminal once its session is up.
    const name = path.split("/").filter(Boolean).pop() || path;
    setTimeout(() => openProject(name), 1500);
  }, [openProject]);

  // Live mDNS discovery while on the Pair screen; merge with the saved list.
  const discovered = useDiscovery(!connected);
  const allMachines = useMemo(() => {
    const byAddr = new Map<string, Machine>();
    for (const m of machines) byAddr.set(m.address, m);
    for (const d of discovered) {
      const ex = byAddr.get(d.address);
      byAddr.set(d.address, { ...ex, ...d, discovered: true, name: ex?.name ?? d.name, id: ex?.id ?? d.id });
    }
    // Collapse entries that share a stable id (same machine seen at two IPs).
    const byId = new Map<string, Machine>();
    const out: Machine[] = [];
    for (const m of byAddr.values()) {
      if (m.id && byId.has(m.id)) {
        const keep = byId.get(m.id)!;
        if (m.online && !keep.online) Object.assign(keep, m);
        continue;
      }
      if (m.id) byId.set(m.id, m);
      out.push(m);
    }
    return out;
  }, [machines, discovered]);

  // Re-check reachability each time we land on the Pair screen.
  useEffect(() => { if (!connected) enriched.current.clear(); }, [connected]);

  // Ping each machine's HTTP /info (once) → clean UTF-8 name + reachability (online dot).
  useEffect(() => {
    if (connected) return;
    for (const m of allMachines) {
      if (enriched.current.has(m.address)) continue;
      enriched.current.add(m.address);
      fetchMachineInfo(m.address).then((info) => {
        setMachines((prev) => {
          const next = info
            ? applyIdentity(prev, m.address, info) // dedupes by stable id
            : upsert(prev, { address: m.address, online: false });
          void saveMachines(next);
          return next;
        });
      });
    }
  }, [allMachines, connected]);

  // Pull-to-refresh on the Pair screen → re-ping every machine's /info (online/secured/pub).
  const [refreshing, setRefreshing] = useState(false);
  const refreshMachines = useCallback(async () => {
    setRefreshing(true);
    enriched.current.clear();
    await Promise.all(allMachines.map((m) =>
      fetchMachineInfo(m.address).then((info) => {
        enriched.current.add(m.address);
        setMachines((prev) => {
          const next = info ? applyIdentity(prev, m.address, info) : upsert(prev, { address: m.address, online: false });
          void saveMachines(next);
          return next;
        });
      }).catch(() => { /* unreachable */ }),
    ));
    setRefreshing(false);
  }, [allMachines]);

  // Pull-to-refresh on the home screen → re-request project statuses.
  const [homeRefreshing, setHomeRefreshing] = useState(false);
  const refreshHome = useCallback(() => {
    setHomeRefreshing(true);
    client.current?.refreshStatus();
    setTimeout(() => setHomeRefreshing(false), 700);
  }, []);

  const pendingCount = approvals.length;
  // Projects that genuinely need you right now = those with a pending approval (reliable lifecycle).
  const needyProjects = useMemo(() => new Set(approvals.map((a) => a.project).filter(Boolean) as string[]), [approvals]);
  const hint = locale === "sk" ? "Podrž a hovor · alebo „Cato…“" : "Hold to talk · or “Cato…”";

  const tokenMachine = tokenFor ? allMachines.find((m) => m.address === tokenFor) ?? { address: tokenFor } : null;
  const gateMachine = gateFor ? allMachines.find((m) => m.address === gateFor) ?? { address: gateFor } : null;

  if (!connected) {
    return (
      <SafeAreaView style={s.root}>
        <StatusBar style="light" />
        {reconnecting && (
          <View style={s.reconnectBar}>
            <ActivityIndicator color={C.accent} />
            <Text style={s.reconnectText}>Reconnecting…</Text>
            <Pressable onPress={stopReconnect} hitSlop={8}><Text style={s.reconnectStop}>Stop</Text></Pressable>
          </View>
        )}
        <PairScreen machines={allMachines} onConnect={(a) => { stopReconnect(); handleConnect(a); }} onAdd={addMachine} onRelay={onRelay} connectingTo={connectingTo} refreshing={refreshing} onRefresh={refreshMachines} />
        <TokenSheet machine={tokenMachine} onClose={() => setTokenFor(null)} onSubmit={(t) => tokenFor && submitToken(tokenFor, t)} />
        <SetupGateSheet machine={gateMachine} onClose={() => setGateFor(null)} onHaveToken={() => { setGateFor(null); setTokenFor(gateFor); }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      {recording && <ListeningOverlay transcript={transcript} />}

      {tab === "talk" && (
        <View style={L.fill}>
          <AppBar linked={connected} onSettings={() => setSettingsOpen(true)} />
          <TalkScreen
            projects={projects} exchange={exchange} recording={recording} busy={busy} hint={hint}
            onPressIn={onPressIn} onPressOut={onPressOut} onOpenProject={openProject}
            onGoApprovals={() => setTab("approvals")} approvals={pendingCount}
            prefs={prefs} onTogglePref={togglePref} displayName={displayName}
            refreshing={homeRefreshing} onRefresh={refreshHome} needy={needyProjects}
          />
        </View>
      )}
      {tab === "approvals" && <ApprovalsScreen approvals={approvals} onResolve={(id, d) => resolveApproval(id, d)} onOpen={setDetail} />}
      {tab === "activity" && <ActivityScreen events={activity} />}
      {tab === "projects" && <ProjectsScreen projects={allProjects} onOpen={openProject} onReopen={reopenProject} onClose={closeProject} onStart={() => setStartOpen(true)} displayName={displayName} />}

      <TabBar active={tab} onTab={setTab} approvals={pendingCount} />

      {terminalProject && (
        <TerminalScreen
          project={terminalProject} title={displayName(terminalProject)} text={terminalText}
          onRename={(n) => renameProject(terminalProject, n)}
          onInput={(t) => client.current?.terminalInput(terminalProject, t)}
          onClose={() => { client.current?.terminalRelease(terminalProject); setTerminalProject(null); terminalProjectRef.current = null; setTerminalMenu(null); }}
          onCloseSession={() => { closeProject(terminalProject); client.current?.terminalRelease(terminalProject); setTerminalProject(null); terminalProjectRef.current = null; setTerminalMenu(null); }}
          onOpenDesktop={() => client.current?.openOnDesktop(terminalProject)}
        />
      )}
      {terminalProject && terminalMenu && (
        <MultiChoiceSheet
          question={{ id: "terminal", question: terminalMenu.question, options: terminalMenu.options }}
          onClose={() => setTerminalMenu(null)}
          onAnswer={(_id, i) => { client.current?.terminalKey(terminalProject, String(terminalMenu.numbers[i])); setTerminalMenu(null); }}
        />
      )}

      <ApprovalDetailSheet approval={detail} onClose={() => setDetail(null)} onResolve={resolveApproval} />
      {startOpen && <StartAgentSheet address={active} token={machines.find((m) => m.address === active)?.token} onClose={() => setStartOpen(false)} onSpawn={startAgent} />}

      <SettingsSheet
        open={settingsOpen} onClose={() => setSettingsOpen(false)}
        locale={locale} onLocale={setLocale} url={active} connected={connected}
        onControl={(a) => client.current?.sendControl(a, locale)}
        onDisconnect={disconnect}
      />
    </SafeAreaView>
  );
}

function SettingsSheet({
  open, onClose, locale, onLocale, url, connected, onControl, onDisconnect,
}: {
  open: boolean; onClose: () => void; locale: string; onLocale: (l: string) => void;
  url: string; connected: boolean; onControl: (a: "continue" | "stop" | "repeat" | "summarize") => void;
  onDisconnect: () => void;
}) {
  if (!open) return null;
  const langs: [string, string][] = [["en", "English"], ["sk", "Slovenčina"], ["cs", "Čeština"]];
  return (
    <BottomSheet onClose={onClose}>
        <Text style={s.sheetTitle}>Settings</Text>

        <Text style={s.label}>LANGUAGE</Text>
        <View style={s.langRow}>
          {langs.map(([k, lbl]) => (
            <Pressable key={k} onPress={() => onLocale(k)} style={[s.tag, s.tagFlex, locale === k && s.tagOn]}>
              <Text style={[s.tagText, locale === k && s.tagTextOn]}>{lbl}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.note}>Affects speech recognition, Cato's replies, and the spoken voice.</Text>

        <Text style={s.label}>QUICK CONTROLS</Text>
        <View style={s.tagWrap}>
          {(["continue", "stop", "repeat", "summarize"] as const).map((a) => (
            <Pressable key={a} onPress={() => { onControl(a); onClose(); }} style={s.tag}><Text style={s.tagText}>{a}</Text></Pressable>
          ))}
        </View>

        <Text style={s.label}>CONNECTION</Text>
        <View style={s.connRow}>
          <View style={s.connIcon}><Icon name="desktop" size={20} color={C.accent} /></View>
          <View style={s.connBody}>
            <Text style={s.connTitle}>Desktop</Text>
            <Text style={s.connUrl} numberOfLines={1}>{url}</Text>
          </View>
          <Pill color={connected ? C.active : C.attention}>{connected ? "Linked" : "Offline"}</Pill>
        </View>
        <Pressable onPress={onDisconnect} style={s.switchBtn}>
          <Icon name="arrowLeft" size={16} color={C.accent} />
          <Text style={s.switchText}>Switch machine</Text>
        </Pressable>

        <View style={s.relayRow}>
          <View style={s.relayTitleRow}>
            <Text style={s.connTitle}>Cato Relay</Text>
            <Pill bg={C.accent}><Text style={s.proText}>PRO</Text></Pill>
          </View>
          <Text style={s.connUrl}>From anywhere · push notifications</Text>
        </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  reconnectBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: tint(C.accent, 0.12), borderBottomWidth: 1, borderBottomColor: tint(C.accent, 0.25) },
  reconnectText: { color: C.accent, fontSize: 13, fontWeight: "600", flex: 1 },
  reconnectStop: { color: C.textDim, fontSize: 13, fontWeight: "600" },
  gear: { paddingHorizontal: 18, paddingTop: 6 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#121317", borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: C.borderStrong, padding: 22, paddingBottom: 34 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.18)", marginBottom: 16 },
  sheetTitle: { color: C.text, fontSize: 22, fontWeight: "700", letterSpacing: -0.4 },
  label: { color: C.textDim, fontSize: 12, fontWeight: "600", letterSpacing: 0.4, marginTop: 20, marginBottom: 9 },
  note: { color: C.textMute, fontSize: 12, marginTop: 8, lineHeight: 17 },
  langRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9 },
  tagFlex: { flex: 1, alignItems: "center" },
  tagOn: { backgroundColor: C.accent, borderColor: C.accent },
  tagText: { color: "#c9cad1", fontWeight: "600", fontSize: 13 },
  tagTextOn: { color: C.onAccent },
  connRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 13 },
  connIcon: { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: tint(C.accent, 0.12) },
  connBody: { flex: 1, minWidth: 0 },
  connTitle: { color: C.text, fontWeight: "600", fontSize: 14 },
  connUrl: { color: C.textDim, fontSize: 12 },
  switchBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 12, marginTop: 10, borderRadius: 12, borderWidth: 1, borderColor: tint(C.accent, 0.3) },
  switchText: { color: C.accent, fontSize: 14, fontWeight: "600" },
  relayRow: { backgroundColor: C.card, borderWidth: 1, borderColor: tint(C.accent, 0.22), borderRadius: 14, padding: 13, marginTop: 10, gap: 3 },
  relayTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  proText: { color: C.onAccent, fontWeight: "700", fontSize: 9 },
});
