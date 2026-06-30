/**
 * Cato modal sheets — approval detail (+ trust scopes + deny-with-reason),
 * multi-choice prompt, and start-an-agent. StyleSheet only; App wires the actions.
 */
import { useState, useEffect, useCallback } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { C, tint, MONO } from "./theme";
import { Icon, Pill, Btn, L, Mono, BottomSheet, KeyboardSafe } from "./ui";
import type { ApprovalRequest, AgentQuestion } from "./catoClient";
import { browseFolders, createFolder, machineLabel, type Machine } from "./machines";

type Scope = "once" | "session" | "command";

export function ApprovalDetailSheet({
  approval, onClose, onResolve,
}: {
  approval: ApprovalRequest | null;
  onClose: () => void;
  onResolve: (id: string, decision: "allow" | "deny", reason?: string, scope?: Scope) => void;
}) {
  const [scope, setScope] = useState<Scope>("once");
  const [reasoning, setReasoning] = useState(false);
  const [reason, setReason] = useState("");
  if (!approval) return null;
  const a = approval;
  const color = a.risk === "high" ? C.attention : a.risk === "medium" ? C.waiting : C.active;
  const lines = a.detail ? a.detail.split("\n") : [];

  const close = () => { setScope("once"); setReasoning(false); setReason(""); onClose(); };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={close}>
      <KeyboardSafe style={st.root}>
        <View style={st.handleRow}>
          <Pressable onPress={close} hitSlop={10}><Icon name="arrowLeft" size={22} color={C.textDim} /></Pressable>
          <View style={st.handleBody}>
            <Text style={st.title}>{a.title}</Text>
            <Text style={st.meta}>{[a.project, a.tool].filter(Boolean).join(" · ")}</Text>
          </View>
          <Pill color={color}>{a.risk.toUpperCase()}</Pill>
        </View>

        <ScrollView style={L.fill} contentContainerStyle={st.body} showsVerticalScrollIndicator={false}>
          {a.risk === "high" && (
            <View style={st.banner}>
              <Icon name="warning" size={19} color={C.attention} />
              <View style={L.flex1}>
                <Text style={st.bannerTitle}>High risk · destructive</Text>
                <Text style={st.bannerText}>{a.summary || "This action could be hard to undo. Review carefully."}</Text>
              </View>
            </View>
          )}
          {a.risk !== "high" && a.summary ? <Text style={st.summary}>{a.summary}</Text> : null}

          <Text style={st.label}>{a.tool === "Bash" ? "COMMAND" : "CHANGES"}</Text>
          <View style={st.code}>
            {lines.map((l, i) => {
              const add = l.startsWith("+"); const del = l.startsWith("-");
              return (
                <Text key={i} style={[st.codeText, add && st.addFg, del && st.delFg, a.tool === "Bash" && st.cmdFg]}>
                  {a.tool === "Bash" ? <Text style={st.dollar}>$ </Text> : null}{l || " "}
                </Text>
              );
            })}
          </View>

          {/* LLM quick replies */}
          {a.suggestions && a.suggestions.length > 0 && (
            <>
              <Text style={st.label}>CATO SUGGESTS</Text>
              <View style={st.suggestions}>
                {a.suggestions.map((sug, i) => (
                  <Pressable key={i} onPress={() => {
                    if (/deny|zamiet|odmiet/i.test(sug)) { onResolve(a.id, "deny", sug); close(); }
                    else { onResolve(a.id, "allow", undefined, scope); close(); }
                  }} style={st.suggestion}>
                    <Text style={st.suggestionText}>{sug}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {!reasoning && (
            <>
              <Text style={st.label}>IF YOU APPROVE</Text>
              {([
                ["once", "Just this once"],
                ["session", "Allow for the rest of this run"],
                ["command", "Always allow this exact command"],
              ] as [Scope, string][]).map(([k, lbl]) => {
                const on = scope === k;
                return (
                  <Pressable key={k} onPress={() => setScope(k)} style={[st.radio, on && st.radioOn]}>
                    <View style={[st.radioDot, on ? st.radioDotOn : st.radioDotOff]} />
                    <Text style={[st.radioLabel, on && st.radioLabelOn]}>{lbl}</Text>
                  </Pressable>
                );
              })}
            </>
          )}

          {reasoning && (
            <>
              <Text style={st.label}>REASON (sent to the agent — it adapts)</Text>
              <TextInput
                value={reason} onChangeText={setReason} multiline autoFocus
                placeholder="e.g. use pnpm instead, don't touch prod…" placeholderTextColor={C.textMute}
                style={st.reasonInput}
              />
            </>
          )}
        </ScrollView>

        <View style={st.dock}>
          {!reasoning ? (
            <>
              <Pressable onPress={() => { onResolve(a.id, "allow", undefined, scope); close(); }} style={st.approve}>
                <Icon name="lockOpen" size={17} color={C.active} />
                <Text style={st.approveText}>Approve{scope !== "once" ? (scope === "session" ? " · this run" : " · always") : ""}</Text>
              </Pressable>
              <View style={st.dockRow}>
                <Btn label="Deny" kind="danger" flex={1} onPress={() => { onResolve(a.id, "deny"); close(); }} />
                <Btn label="Deny + reason" kind="ghost" flex={1} icon="chat" onPress={() => setReasoning(true)} />
              </View>
            </>
          ) : (
            <View style={st.dockRowTight}>
              <Btn label="Back" kind="ghost" flex={1} onPress={() => setReasoning(false)} />
              <Btn label="Deny + send" kind="danger" flex={1.4} icon="chat" onPress={() => { onResolve(a.id, "deny", reason.trim() || undefined); close(); }} />
            </View>
          )}
        </View>
      </KeyboardSafe>
    </Modal>
  );
}

export function MultiChoiceSheet({ question, onClose, onAnswer }: { question: AgentQuestion | null; onClose: () => void; onAnswer: (id: string, index: number) => void }) {
  if (!question) return null;
  return (
    <BottomSheet onClose={onClose}>
      <View style={st.askRow}>
        <View style={st.askLogo}><Icon name="chat" size={14} color={C.onAccent} /></View>
        <Text style={st.askLabel}>CATO IS ASKING</Text>
      </View>
      {question.project ? <Text style={st.meta}>{question.project} · waiting on you</Text> : null}
      <Text style={st.question}>{question.question}</Text>
      <View style={st.choices}>
        {question.options.map((opt, i) => (
          <Pressable key={i} onPress={() => { onAnswer(question.id, i); onClose(); }} style={st.choice}>
            <View style={st.choiceNum}><Text style={st.choiceNumText}>{i + 1}</Text></View>
            <Text style={st.choiceText}>{opt}</Text>
            <Icon name="caret" size={16} color={C.textFaint} />
          </Pressable>
        ))}
      </View>
      <Text style={st.sheetHint}>Tap a choice · or say it</Text>
    </BottomSheet>
  );
}

export function StartAgentSheet({ address, token, onClose, onSpawn }: { address: string; token?: string; onClose: () => void; onSpawn: (path: string, agent: string, task: string) => void }) {
  const [root, setRoot] = useState("");
  const [cwd, setCwd] = useState("");
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState("claude-code");
  const [task, setTask] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const load = useCallback(async (path: string) => {
    setLoading(true);
    const r = await browseFolders(address, path, token);
    if (r) { setRoot(r.root); setCwd(r.path); setDirs(r.dirs); }
    setLoading(false);
  }, [address, token]);
  useEffect(() => { void load(""); }, [load]);

  const crumbs = cwd ? cwd.split("/") : [];
  const rootName = root.replace(/\/+$/, "").split("/").pop() || "~";
  const here = crumbs.length ? crumbs[crumbs.length - 1] : rootName;

  const create = async () => {
    const n = newName.trim();
    if (!n) return;
    const p = cwd ? `${cwd}/${n}` : n;
    if (await createFolder(address, p, token)) { setNewName(""); setCreating(false); void load(p); }
  };

  return (
    <BottomSheet onClose={onClose}>
        <Text style={[st.question, st.startTitle]}>Start an agent</Text>

        <Text style={st.label}>PICK A FOLDER (tap to open, then start inside it)</Text>
        {/* breadcrumb — shows exactly where you are */}
        <View style={st.crumbs}>
          <Pressable onPress={() => void load("")} style={st.crumb}><Icon name="home" size={13} color={cwd ? C.accent : C.text} /><Text style={[st.crumbText, !cwd && st.crumbHere]}>{rootName}</Text></Pressable>
          {crumbs.map((c, i) => (
            <View key={i} style={st.crumb}>
              <Icon name="caret" size={12} color={C.textFaint} />
              <Pressable onPress={() => void load(crumbs.slice(0, i + 1).join("/"))}>
                <Text style={[st.crumbText, i === crumbs.length - 1 && st.crumbHere]}>{c}</Text>
              </Pressable>
            </View>
          ))}
        </View>

        {/* folder list */}
        <ScrollView style={st.browser} keyboardShouldPersistTaps="handled">
          {loading ? (
            <ActivityIndicator color={C.accent} style={{ marginVertical: 16 }} />
          ) : dirs.length === 0 ? (
            <Text style={st.startEmpty}>No subfolders here. Create one, or start the agent in this folder.</Text>
          ) : (
            dirs.map((d) => (
              <Pressable key={d} onPress={() => void load(cwd ? `${cwd}/${d}` : d)} style={st.dirRow}>
                <Icon name="folder" size={17} color={C.accent} />
                <Text style={st.dirName} numberOfLines={1}>{d}</Text>
                <Icon name="caret" size={16} color={C.textFaint} />
              </Pressable>
            ))
          )}
        </ScrollView>

        {creating ? (
          <View style={st.newBox}>
            <Text style={st.newHint}>New folder inside <Text style={st.newPath}>{cwd ? `${rootName}/${cwd}` : rootName}</Text></Text>
            <View style={st.newRow}>
              <TextInput value={newName} onChangeText={setNewName} autoFocus placeholder="folder-name" placeholderTextColor={C.textMute} autoCapitalize="none" autoCorrect={false} style={[st.input, st.newInput]} />
              <Btn label="Create" kind="accent" onPress={create} />
            </View>
            <Pressable onPress={() => { setCreating(false); setNewName(""); }}><Text style={st.newCancel}>Cancel</Text></Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setCreating(true)} style={st.newFolder}>
            <Icon name="plus" size={16} color={C.accent} />
            <Text style={st.newFolderText}>New folder inside {here}</Text>
          </Pressable>
        )}

        <Text style={st.label}>TASK</Text>
        <TextInput value={task} onChangeText={setTask} multiline placeholder="What should it work on?" placeholderTextColor={C.textMute} style={[st.input, st.taskInput]} />

        <Text style={st.label}>AGENT</Text>
        <View style={st.agentRow}>
          {[["claude-code", "Claude Code"], ["codex", "Codex"]].map(([k, lbl]) => (
            <Pressable key={k} onPress={() => setAgent(k)} style={[st.tag, st.agentTag, agent === k && st.tagOn]}>
              <Text style={[st.tagText, agent === k && st.tagTextOn]}>{lbl}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => { onSpawn(cwd, agent, task.trim()); onClose(); }} style={st.pairBtn}>
          <Icon name="rocket" size={17} color={C.onAccent} />
          <Text style={st.pairBtnText}>Start in {here}</Text>
        </Pressable>
    </BottomSheet>
  );
}

export function TokenSheet({ machine, onClose, onSubmit }: { machine: Machine | null; onClose: () => void; onSubmit: (token: string) => void }) {
  const [token, setToken] = useState("");
  if (!machine) return null;
  return (
    <BottomSheet onClose={onClose}>
      <View style={st.askRow}>
        <View style={st.askLogo}><Icon name="shield" size={14} color={C.onAccent} /></View>
        <Text style={st.askLabel}>PAIRING TOKEN</Text>
      </View>
      <Text style={st.question}>Connect to {machineLabel(machine)}</Text>
      <Text style={st.tokenHint}>Scan the QR — or enter the token — from <Mono style={st.tokenMono}>cato pair</Mono> on that machine.</Text>
      <TextInput
        value={token} onChangeText={setToken} autoFocus autoCapitalize="characters" autoCorrect={false}
        placeholder="ABCD-EFGH" placeholderTextColor={C.textMute} style={[st.input, st.tokenInput]}
      />
      <Pressable onPress={() => { const t = token.trim().toUpperCase(); if (t) { onSubmit(t); } }} style={[st.pairBtn, !token.trim() && st.disabled]}>
        <Icon name="link" size={17} color={C.onAccent} />
        <Text style={st.pairBtnText}>Connect</Text>
      </Pressable>
    </BottomSheet>
  );
}

export function SetupGateSheet({ machine, onClose, onHaveToken }: { machine: Machine | null; onClose: () => void; onHaveToken: () => void }) {
  if (!machine) return null;
  return (
    <BottomSheet onClose={onClose}>
      <View style={[st.gateIcon, { backgroundColor: tint(C.waiting, 0.14) }]}><Icon name="warning" size={26} color={C.waiting} /></View>
      <Text style={st.question}>Finish setup on {machineLabel(machine)}</Text>
      <Text style={st.tokenHint}>This machine isn't secured yet. On the desktop, run:</Text>
      <View style={st.gateCmd}><Mono style={st.gateCmdText}>cato setup</Mono></View>
      <Text style={st.tokenHint}>It picks your workspace folder and shows a pairing token. Until then, Cato won't expose anything — not even on your Wi-Fi.</Text>
      <Pressable onPress={onHaveToken} style={[st.pairBtn, { marginTop: 16 }]}>
        <Icon name="check" size={17} color={C.onAccent} />
        <Text style={st.pairBtnText}>I've run it — enter token</Text>
      </Pressable>
    </BottomSheet>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingTop: 54 },
  handleRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 14 },
  handleBody: { flex: 1, marginLeft: 12 },
  title: { color: C.text, fontSize: 16, fontWeight: "600" },
  meta: { color: C.textMute, fontSize: 12, fontWeight: "500", marginTop: 1 },
  body: { padding: 20, paddingTop: 8 },
  banner: { flexDirection: "row", gap: 11, alignItems: "flex-start", borderWidth: 1, borderRadius: 14, padding: 13, marginBottom: 14, backgroundColor: tint(C.attention, 0.1), borderColor: tint(C.attention, 0.3) },
  bannerTitle: { color: C.attention, fontWeight: "600", fontSize: 13.5, marginBottom: 3 },
  bannerText: { color: "#c79b9b", fontSize: 12.5, lineHeight: 18 },
  summary: { color: C.textDim, fontSize: 13.5, lineHeight: 19, marginBottom: 14 },
  label: { color: C.textDim, fontSize: 12, fontWeight: "600", letterSpacing: 0.4, marginTop: 18, marginBottom: 9 },
  code: { backgroundColor: C.black, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 13 },
  codeText: { fontFamily: MONO, fontSize: 13, color: C.text, lineHeight: 21 },
  addFg: { color: C.add },
  delFg: { color: C.del },
  cmdFg: { color: "#e6c4c4" },
  dollar: { color: C.textMute },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  suggestion: { backgroundColor: tint(C.accent, 0.1), borderWidth: 1, borderColor: tint(C.accent, 0.25), borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  suggestionText: { color: C.accent, fontSize: 13, fontWeight: "500" },
  radio: { flexDirection: "row", alignItems: "center", gap: 11, padding: 13, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, marginBottom: 8 },
  radioOn: { backgroundColor: tint(C.accent, 0.1), borderColor: C.accent },
  radioDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.bg },
  radioDotOn: { borderColor: C.accent, borderWidth: 6 },
  radioDotOff: { borderColor: "#44454d", borderWidth: 1.5 },
  radioLabel: { fontSize: 14, color: "#c9cad1", fontWeight: "500" },
  radioLabelOn: { color: C.text, fontWeight: "600" },
  reasonInput: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 13, color: C.text, fontSize: 14, minHeight: 90, textAlignVertical: "top" },
  dock: { padding: 20, paddingBottom: 32, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg },
  dockRow: { flexDirection: "row", gap: 11, marginTop: 11 },
  dockRowTight: { flexDirection: "row", gap: 11 },
  approve: { height: 54, borderRadius: 15, borderWidth: 1, backgroundColor: tint(C.active, 0.16), borderColor: tint(C.active, 0.45), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  approveText: { color: C.active, fontWeight: "600", fontSize: 15 },

  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#121317", borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: C.borderStrong, padding: 22, paddingBottom: 34 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.18)", marginBottom: 16 },
  askRow: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 4 },
  askLogo: { width: 24, height: 24, borderRadius: 7, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
  askLabel: { color: C.accent, fontSize: 12, fontWeight: "600", letterSpacing: 1 },
  question: { color: C.text, fontSize: 20, fontWeight: "600", letterSpacing: -0.3, marginTop: 8, lineHeight: 27 },
  startTitle: { marginBottom: 14 },
  choices: { gap: 10, marginTop: 6 },
  choice: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14 },
  choiceNum: { width: 26, height: 26, borderRadius: 8, backgroundColor: tint(C.accent, 0.16), alignItems: "center", justifyContent: "center" },
  choiceNumText: { color: C.accent, fontWeight: "700" },
  choiceText: { color: C.text, fontSize: 15, fontWeight: "500", flex: 1 },
  sheetHint: { color: C.textMute, fontSize: 12.5, textAlign: "center", marginTop: 16 },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  agentRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  agentTag: { flex: 1, alignItems: "center" },
  tag: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9 },
  tagOn: { backgroundColor: C.accent, borderColor: C.accent },
  tagText: { color: "#c9cad1", fontWeight: "600", fontSize: 13 },
  tagTextOn: { color: C.onAccent },
  startEmpty: { color: C.textMute, fontSize: 13, lineHeight: 18, padding: 14 },
  crumbs: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, marginBottom: 8 },
  crumb: { flexDirection: "row", alignItems: "center", gap: 4 },
  crumbText: { color: C.textDim, fontSize: 13, fontWeight: "500" },
  crumbHere: { color: C.text, fontWeight: "700" },
  browser: { maxHeight: 180, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.card2 },
  dirRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 13, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  dirName: { color: C.text, fontSize: 14.5, flex: 1 },
  newBox: { backgroundColor: C.card, borderWidth: 1, borderColor: tint(C.accent, 0.3), borderRadius: 12, padding: 12, marginTop: 8 },
  newHint: { color: C.textDim, fontSize: 12.5, marginBottom: 9 },
  newPath: { color: C.text, fontFamily: MONO, fontSize: 12.5 },
  newRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  newInput: { flex: 1, marginBottom: 0 },
  newCancel: { color: C.textMute, fontSize: 13, textAlign: "center", marginTop: 10 },
  newFolder: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 11, marginTop: 6 },
  newFolderText: { color: C.accent, fontSize: 14, fontWeight: "600" },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 13, color: C.text, fontSize: 14, marginBottom: 8, textAlignVertical: "top" },
  taskInput: { height: 70, marginBottom: 14 },
  pairBtn: { height: 54, backgroundColor: C.accent, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  pairBtnText: { color: C.onAccent, fontWeight: "600", fontSize: 16 },
  disabled: { opacity: 0.5 },
  tokenHint: { color: C.textDim, fontSize: 13.5, lineHeight: 19, marginTop: 8 },
  tokenMono: { color: C.accent, fontSize: 13 },
  tokenInput: { marginTop: 14, fontFamily: MONO, fontSize: 16, letterSpacing: 1, textAlign: "center" },
  gateIcon: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  gateCmd: { backgroundColor: C.black, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 13, marginTop: 10 },
  gateCmdText: { color: C.accent, fontSize: 14 },
});
