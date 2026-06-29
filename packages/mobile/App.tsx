/**
 * Cato — mobile voice terminal. The whole brain lives on the desktop agent; this
 * screen only: connects, captures push-to-talk audio, plays spoken replies (TTS),
 * and shows a minimal status/log. See docs/PROJECT.md (mobile = voice terminal only).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Speech from "expo-speech";
import Constants from "expo-constants";
import { CatoClient, type ProjectStatus, type ApprovalRequest } from "./src/catoClient";
import { useAudioRecorder, AudioModule, setAudioModeAsync } from "expo-audio";
import { readBase64, REC_OPTIONS } from "./src/audio";

const extra = (Constants.expoConfig?.extra ?? {}) as { desktopWsUrl?: string; pairingToken?: string };

const STATE_COLOR: Record<ProjectStatus["state"], string> = {
  idle: "#6b7280",
  active: "#22c55e",
  waiting: "#eab308",
  attention: "#ef4444",
};

export default function App() {
  const [wsUrl, setWsUrl] = useState(extra.desktopWsUrl ?? "ws://192.168.68.102:8787/v1");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [projects, setProjects] = useState<ProjectStatus[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  const client = useRef<CatoClient | null>(null);
  const recorder = useAudioRecorder(REC_OPTIONS);

  const append = useCallback((line: string) => setLog((l) => [...l.slice(-40), line]), []);

  const connect = useCallback(() => {
    client.current?.close();
    const c = new CatoClient(wsUrl, extra.pairingToken ?? "changeme", {
      onWelcome: () => { setConnected(true); append("• connected"); },
      onTranscript: (t) => append(`🎙️  ${t}`),
      onSpeak: (text, locale) => {
        append(`🔊 ${text}`);
        setBusy(false);
        Speech.speak(text, { language: locale === "sk" ? "sk-SK" : locale });
      },
      onStatus: setProjects,
      onApproval: (a) => setApprovals((prev) => [a, ...prev.filter((x) => x.id !== a.id)]),
      onError: (code, msg) => { append(`❌ ${code}: ${msg}`); setBusy(false); },
      onClose: () => setConnected(false),
    });
    c.connect();
    client.current = c;
  }, [wsUrl, append]);

  useEffect(() => () => client.current?.close(), []);

  const onPressIn = useCallback(async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { append("❌ mic permission denied"); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e) {
      setRecording(false);
      append("❌ record failed: " + (e as Error).message);
    }
  }, [append, recorder]);

  const onPressOut = useCallback(async () => {
    setRecording(false);
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) { setBusy(false); append("❌ no audio captured"); return; }
      const audioBase64 = await readBase64(uri);
      client.current?.sendVoice({ audioBase64, locale: "sk" });
    } catch (e) {
      setBusy(false);
      append("❌ stop failed: " + (e as Error).message);
    }
  }, [append, recorder]);

  const sendText = useCallback(() => {
    if (!draft.trim()) return;
    setBusy(true);
    client.current?.sendVoice({ text: draft.trim(), locale: "sk" });
    setDraft("");
  }, [draft]);

  const resolveApproval = useCallback((approvalId: string, decision: "allow" | "deny") => {
    client.current?.resolveApproval(approvalId, decision);
    setApprovals((prev) => prev.filter((a) => a.id !== approvalId));
    append(decision === "allow" ? "✅ approved" : "⛔ denied");
  }, [append]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <Text style={styles.title}>Cato</Text>

      {!connected ? (
        <View style={styles.connectRow}>
          <TextInput style={styles.input} value={wsUrl} onChangeText={setWsUrl} autoCapitalize="none" />
          <Pressable style={styles.btn} onPress={connect}><Text style={styles.btnText}>Connect</Text></Pressable>
        </View>
      ) : (
        <>
          {approvals.map((a) => {
            const lineCount = a.detail ? a.detail.split("\n").length : 0;
            const short = !!a.detail && lineCount <= 8 && a.detail.length <= 500;
            const open = short || expanded.has(a.id); // short → always open
            const riskStyle = a.risk === "high" ? styles.riskHigh : a.risk === "medium" ? styles.riskMed : styles.riskLow;
            return (
              <View key={a.id} style={styles.approvalCard}>
                <View style={styles.approvalHead}>
                  <Text style={styles.approvalTitle} numberOfLines={1}>
                    {a.project ? a.project + " · " : ""}{a.title}
                  </Text>
                  <View style={[styles.riskPill, riskStyle]}><Text style={styles.riskText}>{a.risk}</Text></View>
                </View>
                {a.stats ? <Text style={styles.statsText}>{a.stats}</Text> : null}
                {/* Toggle only for LONG content, kept in the top cluster (away from buttons). */}
                {a.detail && !short ? (
                  <Pressable hitSlop={6} onPress={() => setExpanded((s) => {
                    const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n;
                  })}>
                    <Text style={styles.expandBtn}>{expanded.has(a.id) ? "▾ skryť celý diff" : `▸ zobraziť celý diff (${lineCount} riadkov)`}</Text>
                  </Pressable>
                ) : null}
                {open && a.detail ? (
                  <ScrollView style={styles.diffBox}>
                    {a.detail.split("\n").map((l, i) => (
                      <Text key={i} style={[styles.diffLine, l.startsWith("+") ? styles.diffAdd : l.startsWith("-") ? styles.diffDel : undefined]}>
                        {l || " "}
                      </Text>
                    ))}
                  </ScrollView>
                ) : null}
                <View style={styles.approvalBtns}>
                  <Pressable style={[styles.apBtn, styles.deny]} onPress={() => resolveApproval(a.id, "deny")}>
                    <Text style={styles.apBtnText}>Deny</Text>
                  </Pressable>
                  <Pressable style={[styles.apBtn, styles.allow]} onPress={() => resolveApproval(a.id, "allow")}>
                    <Text style={styles.apBtnText}>Approve</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}

          <ScrollView style={styles.statusBox} contentContainerStyle={{ gap: 6 }}>
            {projects.length === 0 && <Text style={styles.dim}>Zatiaľ sa nič nedeje.</Text>}
            {projects.map((p) => (
              <View key={p.name} style={styles.statusRow}>
                <View style={[styles.dot, { backgroundColor: STATE_COLOR[p.state] }]} />
                <Text style={styles.project}>{p.name}</Text>
                <Text style={styles.summary} numberOfLines={1}>{p.summary}</Text>
              </View>
            ))}
          </ScrollView>

          <ScrollView style={styles.logBox}>
            {log.map((l, i) => <Text key={i} style={styles.logLine}>{l}</Text>)}
          </ScrollView>

          <View style={styles.controls}>
            {(["continue", "stop", "repeat", "summarize"] as const).map((a) => (
              <Pressable key={a} style={styles.chip} onPress={() => client.current?.sendControl(a)}>
                <Text style={styles.chipText}>{a}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={[styles.talk, recording && styles.talkActive]}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
          >
            {busy && !recording
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.talkText}>{recording ? "● Počúvam…" : "Podrž a hovor"}</Text>}
          </Pressable>

          <View style={styles.connectRow}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="alebo napíš príkaz…"
              placeholderTextColor="#6b7280"
              onSubmitEditing={sendText}
            />
            <Pressable style={styles.btn} onPress={sendText}><Text style={styles.btnText}>Send</Text></Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b0f14", paddingTop: 8, paddingBottom: 8, paddingHorizontal: 16, gap: 12 },
  title: { color: "#e5e7eb", fontSize: 28, fontWeight: "700" },
  connectRow: { flexDirection: "row", gap: 8 },
  input: { flex: 1, backgroundColor: "#111827", color: "#e5e7eb", borderRadius: 10, paddingHorizontal: 12, height: 44 },
  btn: { backgroundColor: "#2563eb", borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  approvalCard: { backgroundColor: "#15110a", borderColor: "#a16207", borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  approvalHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  approvalTitle: { color: "#fde68a", fontWeight: "700", flex: 1 },
  riskPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  riskText: { color: "#fff", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  riskLow: { backgroundColor: "#16a34a" },
  riskMed: { backgroundColor: "#d97706" },
  riskHigh: { backgroundColor: "#dc2626" },
  statsText: { color: "#9ca3af", fontSize: 12 },
  expandBtn: { color: "#93c5fd", fontSize: 13, paddingVertical: 4 },
  diffBox: { maxHeight: 220, backgroundColor: "#0b0f14", borderRadius: 8, padding: 8 },
  diffLine: { color: "#cbd5e1", fontFamily: "Menlo", fontSize: 11 },
  diffAdd: { color: "#4ade80" },
  diffDel: { color: "#f87171" },
  // Clear separation so the action buttons can't be hit by mistake.
  approvalBtns: { flexDirection: "row", gap: 12, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#3f2d12" },
  apBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  allow: { backgroundColor: "#16a34a" },
  deny: { backgroundColor: "#dc2626" },
  apBtnText: { color: "#fff", fontWeight: "700" },
  statusBox: { maxHeight: 160, backgroundColor: "#0f1620", borderRadius: 12, padding: 12 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  project: { color: "#e5e7eb", fontWeight: "600", width: 90 },
  summary: { color: "#9ca3af", flex: 1 },
  dim: { color: "#6b7280" },
  logBox: { flex: 1, backgroundColor: "#0f1620", borderRadius: 12, padding: 12 },
  logLine: { color: "#cbd5e1", fontSize: 13, marginBottom: 4 },
  controls: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { backgroundColor: "#1f2937", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { color: "#e5e7eb" },
  talk: { backgroundColor: "#2563eb", borderRadius: 16, height: 72, alignItems: "center", justifyContent: "center" },
  talkActive: { backgroundColor: "#ef4444" },
  talkText: { color: "#fff", fontSize: 18, fontWeight: "700" },
});
