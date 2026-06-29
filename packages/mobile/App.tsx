/**
 * Cato — mobile voice terminal. The whole brain lives on the desktop agent; this
 * screen only: connects, captures push-to-talk audio, plays spoken replies (TTS),
 * and shows a minimal status/log. See docs/PROJECT.md (mobile = voice terminal only).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Speech from "expo-speech";
import Constants from "expo-constants";
import { CatoClient, type ProjectStatus } from "./src/catoClient";
import { PushToTalk } from "./src/audio";

const extra = (Constants.expoConfig?.extra ?? {}) as { desktopWsUrl?: string; pairingToken?: string };

const STATE_COLOR: Record<ProjectStatus["state"], string> = {
  idle: "#6b7280",
  active: "#22c55e",
  waiting: "#eab308",
  attention: "#ef4444",
};

export default function App() {
  const [wsUrl, setWsUrl] = useState(extra.desktopWsUrl ?? "ws://192.168.1.10:8787/v1");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [projects, setProjects] = useState<ProjectStatus[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  const client = useRef<CatoClient>();
  const ptt = useRef(new PushToTalk());

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
      onError: (code, msg) => { append(`❌ ${code}: ${msg}`); setBusy(false); },
      onClose: () => setConnected(false),
    });
    c.connect();
    client.current = c;
  }, [wsUrl, append]);

  useEffect(() => () => client.current?.close(), []);

  const onPressIn = useCallback(async () => {
    try { setRecording(true); await ptt.current.start(); }
    catch { setRecording(false); append("❌ mic permission / record failed"); }
  }, [append]);

  const onPressOut = useCallback(async () => {
    setRecording(false);
    setBusy(true);
    const audioBase64 = await ptt.current.stopAndGetBase64().catch(() => null);
    if (audioBase64) client.current?.sendVoice({ audioBase64, locale: "sk" });
    else { setBusy(false); append("❌ no audio captured"); }
  }, [append]);

  const sendText = useCallback(() => {
    if (!draft.trim()) return;
    setBusy(true);
    client.current?.sendVoice({ text: draft.trim(), locale: "sk" });
    setDraft("");
  }, [draft]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Text style={styles.title}>Cato</Text>

      {!connected ? (
        <View style={styles.connectRow}>
          <TextInput style={styles.input} value={wsUrl} onChangeText={setWsUrl} autoCapitalize="none" />
          <Pressable style={styles.btn} onPress={connect}><Text style={styles.btnText}>Connect</Text></Pressable>
        </View>
      ) : (
        <>
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b0f14", paddingTop: 64, paddingHorizontal: 16, gap: 12 },
  title: { color: "#e5e7eb", fontSize: 28, fontWeight: "700" },
  connectRow: { flexDirection: "row", gap: 8 },
  input: { flex: 1, backgroundColor: "#111827", color: "#e5e7eb", borderRadius: 10, paddingHorizontal: 12, height: 44 },
  btn: { backgroundColor: "#2563eb", borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
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
