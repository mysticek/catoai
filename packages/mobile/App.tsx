/**
 * Cato — mobile command center. The brain lives on the desktop agent; this app connects,
 * captures push-to-talk audio, plays spoken replies, and renders the live state across
 * four tabs (Talk / Approvals / Activity / Projects). Implements Cato.dc.html.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Speech from "expo-speech";
import Constants from "expo-constants";
import { useAudioRecorder, AudioModule, setAudioModeAsync } from "expo-audio";
import { CatoClient, type ProjectStatus, type ApprovalRequest, type AgentQuestion, type ActivityEvent } from "./src/catoClient";
import { readBase64, REC_OPTIONS } from "./src/audio";
import { C, R, S, tint } from "./src/theme";
import { Icon, Pill, Btn } from "./src/ui";
import {
  TalkScreen, ApprovalsScreen, ActivityScreen, ProjectsScreen, PairScreen, TabBar, ListeningOverlay, AppBar, type Tab,
} from "./src/screens";
import { ApprovalDetailSheet, MultiChoiceSheet, StartAgentSheet } from "./src/sheets";

const extra = (Constants.expoConfig?.extra ?? {}) as { desktopWsUrl?: string; pairingToken?: string };
const TTS: Record<string, string> = { en: "en-US", sk: "sk-SK", cs: "cs-CZ" };

export default function App() {
  const [wsUrl, setWsUrl] = useState(extra.desktopWsUrl ?? "ws://192.168.68.102:8787/v1");
  const [locale, setLocale] = useState("en");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

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

  const client = useRef<CatoClient | null>(null);
  const recorder = useAudioRecorder(REC_OPTIONS);

  const connect = useCallback(() => {
    client.current?.close();
    setConnecting(true);
    const c = new CatoClient(wsUrl, extra.pairingToken ?? "changeme", {
      onWelcome: (ps) => { setConnected(true); setConnecting(false); setProjects(ps); },
      onStatus: setProjects,
      onTranscript: (t, final) => { setTranscript(t); if (final) setExchange((e) => ({ ...e, user: t })); },
      onSpeak: (text, loc) => { setBusy(false); setExchange((e) => ({ ...e, cato: text })); Speech.speak(text, { language: TTS[loc] ?? loc }); },
      onApproval: (a) => setApprovals((prev) => [a, ...prev.filter((x) => x.id !== a.id)]),
      onApprovalUpdate: (id, summary, suggestions) =>
        setApprovals((prev) => prev.map((a) => (a.id === id ? { ...a, summary: summary ?? a.summary, suggestions: suggestions ?? a.suggestions } : a))),
      onQuestion: (q) => setQuestion(q),
      onActivity: (e) => setActivity((prev) => [e, ...prev].slice(0, 60)),
      onError: () => setBusy(false),
      onClose: () => { setConnected(false); setConnecting(false); },
    });
    c.connect();
    client.current = c;
  }, [wsUrl]);

  // Auto-connect on mount; clean up on unmount.
  useEffect(() => { connect(); return () => client.current?.close(); }, [connect]);

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

  const openProject = useCallback((name: string) => {
    client.current?.sendVoice({ text: `how is ${name} doing`, locale });
    setBusy(true);
    setTab("talk");
  }, [locale]);

  const startAgent = useCallback((project: string, agent: string, task: string) => {
    client.current?.sendVoice({ text: `start ${agent === "codex" ? "codex" : "claude"} on project ${project}`, locale });
    if (task) setTimeout(() => client.current?.sendVoice({ text: `tell ${project} ${task}`, locale }), 800);
    setTab("projects");
  }, [locale]);

  const pendingCount = approvals.length;
  const hint = locale === "sk" ? "Podrž a hovor · alebo „Cato…“" : "Hold to talk · or “Cato…”";

  if (!connected) {
    return (
      <SafeAreaView style={s.root}>
        <StatusBar style="light" />
        <PairScreen url={wsUrl} onChangeUrl={setWsUrl} onConnect={connect} connecting={connecting} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      {recording && <ListeningOverlay transcript={transcript} />}

      {tab === "talk" && (
        <View style={{ flex: 1 }}>
          <View style={s.gearBar}>
            <View style={{ flex: 1 }}><AppBar linked={connected} /></View>
            <Pressable onPress={() => setSettingsOpen(true)} hitSlop={10} style={s.gear}><Icon name="gear" size={20} color={C.textMute} /></Pressable>
          </View>
          <TalkScreen
            projects={projects} exchange={exchange} recording={recording} busy={busy} hint={hint}
            onPressIn={onPressIn} onPressOut={onPressOut} onOpenProject={openProject}
            onGoApprovals={() => setTab("approvals")} approvals={pendingCount}
          />
        </View>
      )}
      {tab === "approvals" && <ApprovalsScreen approvals={approvals} onResolve={(id, d) => resolveApproval(id, d)} onOpen={setDetail} />}
      {tab === "activity" && <ActivityScreen events={activity} />}
      {tab === "projects" && <ProjectsScreen projects={projects} onOpen={openProject} onStart={() => setStartOpen(true)} />}

      <TabBar active={tab} onTab={setTab} approvals={pendingCount} />

      <ApprovalDetailSheet approval={detail} onClose={() => setDetail(null)} onResolve={resolveApproval} />
      <MultiChoiceSheet question={question} onClose={() => setQuestion(null)} onAnswer={answerQuestion} />
      {startOpen && <StartAgentSheet projects={projects} onClose={() => setStartOpen(false)} onStart={startAgent} />}

      <SettingsSheet
        open={settingsOpen} onClose={() => setSettingsOpen(false)}
        locale={locale} onLocale={setLocale} url={wsUrl} connected={connected}
        onControl={(a) => client.current?.sendControl(a, locale)}
      />
    </SafeAreaView>
  );
}

function SettingsSheet({
  open, onClose, locale, onLocale, url, connected, onControl,
}: {
  open: boolean; onClose: () => void; locale: string; onLocale: (l: string) => void;
  url: string; connected: boolean; onControl: (a: "continue" | "stop" | "repeat" | "summarize") => void;
}) {
  if (!open) return null;
  const langs: [string, string][] = [["en", "English"], ["sk", "Slovenčina"], ["cs", "Čeština"]];
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.grabber} />
        <Text style={s.sheetTitle}>Settings</Text>

        <Text style={s.label}>LANGUAGE</Text>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
          {langs.map(([k, lbl]) => (
            <Pressable key={k} onPress={() => onLocale(k)} style={[s.tag, { flex: 1, alignItems: "center" }, locale === k && s.tagOn]}>
              <Text style={[s.tagText, locale === k && { color: C.onAccent }]}>{lbl}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.note}>Affects speech recognition, Cato's replies, and the spoken voice.</Text>

        <Text style={s.label}>QUICK CONTROLS</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(["continue", "stop", "repeat", "summarize"] as const).map((a) => (
            <Pressable key={a} onPress={() => { onControl(a); onClose(); }} style={s.tag}><Text style={s.tagText}>{a}</Text></Pressable>
          ))}
        </View>

        <Text style={s.label}>CONNECTION</Text>
        <View style={s.connRow}>
          <View style={[s.connIcon, { backgroundColor: tint(C.accent, 0.12) }]}><Icon name="desktop" size={20} color={C.accent} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: C.text, fontWeight: "600", fontSize: 14 }}>Desktop</Text>
            <Text style={{ color: C.textDim, fontSize: 12 }} numberOfLines={1}>{url}</Text>
          </View>
          <Pill color={connected ? C.active : C.attention}>{connected ? "Linked" : "Offline"}</Pill>
        </View>

        <View style={s.relayRow}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <Text style={{ color: C.text, fontWeight: "600", fontSize: 14 }}>Cato Relay</Text>
            <Pill bg={C.accent}><Text style={{ color: C.onAccent, fontWeight: "700", fontSize: 9 }}>PRO</Text></Pill>
          </View>
          <Text style={{ color: C.textDim, fontSize: 12 }}>From anywhere · push notifications</Text>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  gearBar: { flexDirection: "row", alignItems: "center" },
  gear: { paddingHorizontal: 18, paddingTop: 6 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#121317", borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: C.borderStrong, padding: 22, paddingBottom: 34 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.18)", marginBottom: 16 },
  sheetTitle: { color: C.text, fontSize: 22, fontWeight: "700", letterSpacing: -0.4 },
  label: { color: C.textDim, fontSize: 12, fontWeight: "600", letterSpacing: 0.4, marginTop: 20, marginBottom: 9 },
  note: { color: C.textMute, fontSize: 12, marginTop: 8, lineHeight: 17 },
  tag: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9 },
  tagOn: { backgroundColor: C.accent, borderColor: C.accent },
  tagText: { color: "#c9cad1", fontWeight: "600", fontSize: 13 },
  connRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 13 },
  connIcon: { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  relayRow: { backgroundColor: C.card, borderWidth: 1, borderColor: tint(C.accent, 0.22), borderRadius: 14, padding: 13, marginTop: 10, gap: 3 },
});
