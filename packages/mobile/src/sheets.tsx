/**
 * Cato modal sheets — approval detail (+ trust scopes + deny-with-reason),
 * multi-choice prompt, and start-an-agent. Presentational; App wires the actions.
 */
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { C, R, S, tint, MONO, STATUS, StatusKey } from "./theme";
import { Icon, Dot, Pill, Btn } from "./ui";
import type { ApprovalRequest, AgentQuestion, ProjectStatus } from "./catoClient";

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
      <View style={st.root}>
        <View style={st.handleRow}>
          <Pressable onPress={close} hitSlop={10}><Icon name="arrowLeft" size={22} color={C.textDim} /></Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={st.title}>{a.title}</Text>
            <Text style={st.meta}>{[a.project, a.tool].filter(Boolean).join(" · ")}</Text>
          </View>
          <Pill color={color}>{a.risk.toUpperCase()}</Pill>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingTop: 8 }} showsVerticalScrollIndicator={false}>
          {a.risk === "high" && (
            <View style={[st.banner, { backgroundColor: tint(C.attention, 0.1), borderColor: tint(C.attention, 0.3) }]}>
              <Icon name="warning" size={19} color={C.attention} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.attention, fontWeight: "600", fontSize: 13.5, marginBottom: 3 }}>High risk · destructive</Text>
                <Text style={{ color: "#c79b9b", fontSize: 12.5, lineHeight: 18 }}>{a.summary || "This action could be hard to undo. Review carefully."}</Text>
              </View>
            </View>
          )}
          {a.risk !== "high" && a.summary ? <Text style={st.summary}>{a.summary}</Text> : null}

          <Text style={st.label}>{a.tool === "Bash" ? "COMMAND" : "CHANGES"}</Text>
          <View style={st.code}>
            {lines.map((l, i) => {
              const add = l.startsWith("+"); const del = l.startsWith("-");
              return (
                <Text key={i} style={[st.codeText, add && { color: C.add }, del && { color: C.del }, a.tool === "Bash" && { color: "#e6c4c4" }]}>
                  {a.tool === "Bash" ? <Text style={{ color: C.textMute }}>$ </Text> : null}{l || " "}
                </Text>
              );
            })}
          </View>

          {/* suggestions from the LLM (quick replies) */}
          {a.suggestions && a.suggestions.length > 0 && (
            <>
              <Text style={st.label}>CATO SUGGESTS</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {a.suggestions.map((sug, i) => (
                  <Pressable key={i} onPress={() => {
                    if (/deny|zamiet|odmiet/i.test(sug)) { onResolve(a.id, "deny", sug); close(); }
                    else { onResolve(a.id, "allow", undefined, scope); close(); }
                  }} style={st.suggestion}>
                    <Text style={{ color: C.accent, fontSize: 13, fontWeight: "500" }}>{sug}</Text>
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
              ] as [Scope, string][]).map(([k, lbl]) => (
                <Pressable key={k} onPress={() => setScope(k)} style={[st.radio, scope === k && { backgroundColor: tint(C.accent, 0.1), borderColor: C.accent }]}>
                  <View style={[st.radioDot, scope === k ? { borderColor: C.accent, borderWidth: 6 } : { borderColor: "#44454d", borderWidth: 1.5 }]} />
                  <Text style={[st.radioLabel, { color: scope === k ? C.text : "#c9cad1", fontWeight: scope === k ? "600" : "500" }]}>{lbl}</Text>
                </Pressable>
              ))}
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
              <Pressable onPress={() => { onResolve(a.id, "allow", undefined, scope); close(); }} style={[st.approve, { borderColor: tint(C.active, 0.45) }]}>
                <Icon name="lockOpen" size={17} color={C.active} />
                <Text style={{ color: C.active, fontWeight: "600", fontSize: 15 }}>Approve{scope !== "once" ? (scope === "session" ? " · this run" : " · always") : ""}</Text>
              </Pressable>
              <View style={{ flexDirection: "row", gap: 11, marginTop: 11 }}>
                <Btn label="Deny" kind="danger" flex={1} onPress={() => { onResolve(a.id, "deny"); close(); }} />
                <Btn label="Deny + reason" kind="ghost" flex={1} icon="chat" onPress={() => setReasoning(true)} />
              </View>
            </>
          ) : (
            <View style={{ flexDirection: "row", gap: 11 }}>
              <Btn label="Back" kind="ghost" flex={1} onPress={() => setReasoning(false)} />
              <Btn label="Deny + send" kind="danger" flex={1.4} icon="chat" onPress={() => { onResolve(a.id, "deny", reason.trim() || undefined); close(); }} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

export function MultiChoiceSheet({ question, onClose, onAnswer }: { question: AgentQuestion | null; onClose: () => void; onAnswer: (id: string, index: number) => void }) {
  if (!question) return null;
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} />
      <View style={st.sheet}>
        <View style={st.grabber} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 4 }}>
          <View style={st.askLogo}><Icon name="chat" size={14} color={C.onAccent} /></View>
          <Text style={{ color: C.accent, fontSize: 12, fontWeight: "600", letterSpacing: 1 }}>CATO IS ASKING</Text>
        </View>
        {question.project ? <Text style={st.meta}>{question.project} · waiting on you</Text> : null}
        <Text style={st.question}>{question.question}</Text>
        <View style={{ gap: 10, marginTop: 6 }}>
          {question.options.map((opt, i) => (
            <Pressable key={i} onPress={() => { onAnswer(question.id, i); onClose(); }} style={st.choice}>
              <View style={st.choiceNum}><Text style={{ color: C.accent, fontWeight: "700" }}>{i + 1}</Text></View>
              <Text style={st.choiceText}>{opt}</Text>
              <Icon name="caret" size={16} color={C.textFaint} />
            </Pressable>
          ))}
        </View>
        <Text style={st.sheetHint}>Tap a choice · or say it</Text>
      </View>
    </Modal>
  );
}

export function StartAgentSheet({ projects, onClose, onStart }: { projects: ProjectStatus[]; onClose: () => void; onStart: (project: string, agent: string, task: string) => void }) {
  const [project, setProject] = useState(projects[0]?.name ?? "");
  const [custom, setCustom] = useState("");
  const [agent, setAgent] = useState("claude-code");
  const [task, setTask] = useState("");
  const chosen = project === "__new" ? custom.trim() : project;
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} />
      <View style={st.sheet}>
        <View style={st.grabber} />
        <Text style={[st.question, { marginBottom: 14 }]}>Start an agent</Text>

        <Text style={st.label}>PROJECT</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {projects.map((p) => (
            <Pressable key={p.name} onPress={() => setProject(p.name)} style={[st.tag, project === p.name && st.tagOn]}>
              <Text style={[st.tagText, project === p.name && { color: C.onAccent }]}>{p.name}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setProject("__new")} style={[st.tag, project === "__new" && st.tagOn]}>
            <Text style={[st.tagText, project === "__new" && { color: C.onAccent }]}>+ New</Text>
          </Pressable>
        </View>
        {project === "__new" && (
          <TextInput value={custom} onChangeText={setCustom} placeholder="project name" placeholderTextColor={C.textMute} autoCapitalize="none" style={st.input} />
        )}

        <Text style={st.label}>TASK</Text>
        <TextInput value={task} onChangeText={setTask} multiline placeholder="What should it work on?" placeholderTextColor={C.textMute} style={[st.input, { height: 70, marginBottom: 14 }]} />

        <Text style={st.label}>AGENT</Text>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 18 }}>
          {[["claude-code", "Claude Code"], ["codex", "Codex"]].map(([k, lbl]) => (
            <Pressable key={k} onPress={() => setAgent(k)} style={[st.tag, { flex: 1, alignItems: "center" }, agent === k && st.tagOn]}>
              <Text style={[st.tagText, agent === k && { color: C.onAccent }]}>{lbl}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={() => { if (chosen) { onStart(chosen, agent, task.trim()); onClose(); } }}
          style={[st.pairBtn, !chosen && { opacity: 0.5 }]}
        >
          <Icon name="rocket" size={17} color={C.onAccent} />
          <Text style={{ color: C.onAccent, fontWeight: "600", fontSize: 16 }}>Start agent</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingTop: 54 },
  handleRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 14 },
  title: { color: C.text, fontSize: 16, fontWeight: "600" },
  meta: { color: C.textMute, fontSize: 12, fontWeight: "500", marginTop: 1 },
  banner: { flexDirection: "row", gap: 11, alignItems: "flex-start", borderWidth: 1, borderRadius: 14, padding: 13, marginBottom: 14 },
  summary: { color: C.textDim, fontSize: 13.5, lineHeight: 19, marginBottom: 14 },
  label: { color: C.textDim, fontSize: 12, fontWeight: "600", letterSpacing: 0.4, marginTop: 18, marginBottom: 9 },
  code: { backgroundColor: C.black, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 13 },
  codeText: { fontFamily: MONO, fontSize: 13, color: C.text, lineHeight: 21 },
  suggestion: { backgroundColor: tint(C.accent, 0.1), borderWidth: 1, borderColor: tint(C.accent, 0.25), borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  radio: { flexDirection: "row", alignItems: "center", gap: 11, padding: 13, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, marginBottom: 8 },
  radioDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.bg },
  radioLabel: { fontSize: 14 },
  reasonInput: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 13, color: C.text, fontSize: 14, minHeight: 90, textAlignVertical: "top" },
  dock: { padding: 20, paddingBottom: 32, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg },
  approve: { height: 54, borderRadius: 15, borderWidth: 1, backgroundColor: tint(C.active, 0.16), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },

  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#121317", borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: C.borderStrong, padding: 22, paddingBottom: 34 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.18)", marginBottom: 16 },
  askLogo: { width: 24, height: 24, borderRadius: 7, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
  question: { color: C.text, fontSize: 20, fontWeight: "600", letterSpacing: -0.3, marginTop: 8, lineHeight: 27 },
  choice: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14 },
  choiceNum: { width: 26, height: 26, borderRadius: 8, backgroundColor: tint(C.accent, 0.16), alignItems: "center", justifyContent: "center" },
  choiceText: { color: C.text, fontSize: 15, fontWeight: "500", flex: 1 },
  sheetHint: { color: C.textMute, fontSize: 12.5, textAlign: "center", marginTop: 16 },
  tag: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9 },
  tagOn: { backgroundColor: C.accent, borderColor: C.accent },
  tagText: { color: "#c9cad1", fontWeight: "600", fontSize: 13 },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 13, color: C.text, fontSize: 14, marginBottom: 8, textAlignVertical: "top" },
  pairBtn: { height: 54, backgroundColor: C.accent, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
});
