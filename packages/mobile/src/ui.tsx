/**
 * Cato UI primitives — small building blocks shared across screens.
 * Icons via @expo/vector-icons (Ionicons) mapped from the design's Phosphor names.
 */
import { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, ViewStyle, TextStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { C, R, S, tint, MONO, STATUS, StatusKey } from "./theme";

/** Shared layout utilities — compose with component styles to keep JSX free of
 *  inline style objects (e.g. style={[L.rowBetween, s.card]}). */
export const L = StyleSheet.create({
  fill: { flex: 1 },
  flex1: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  rowTop: { flexDirection: "row", alignItems: "flex-start" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  center: { alignItems: "center", justifyContent: "center" },
});

type IoniconName = keyof typeof Ionicons.glyphMap;

// Design uses Phosphor; map the ones we need to Ionicons.
const ICON: Record<string, IoniconName> = {
  shield: "shield-checkmark",
  mic: "mic",
  wave: "pulse",
  bell: "notifications",
  speaker: "volume-high",
  warning: "warning",
  terminal: "terminal",
  edit: "create",
  globe: "globe",
  check: "checkmark",
  x: "close",
  arrowRight: "arrow-forward",
  arrowLeft: "arrow-back",
  pulse: "pulse",
  stack: "albums",
  desktop: "desktop",
  caret: "chevron-forward",
  chat: "chatbubble-ellipses",
  lockOpen: "lock-open",
  search: "search",
  xCircle: "close-circle",
  link: "link",
  play: "play",
  stop: "stop",
  repeat: "repeat",
  doc: "document-text",
  rocket: "rocket",
  gear: "settings",
  plus: "add",
  undo: "arrow-undo",
};

export function Icon({ name, size = 18, color = C.text }: { name: keyof typeof ICON; size?: number; color?: string }) {
  return <Ionicons name={ICON[name] ?? "ellipse"} size={size} color={color} />;
}

export function Dot({ color, glow }: { color: string; glow?: boolean }) {
  return <View style={[s.dot, { backgroundColor: color }, glow && [s.glow, { shadowColor: color }]]} />;
}

export function StatusDot({ state, glow }: { state: StatusKey; glow?: boolean }) {
  return <Dot color={STATUS[state]} glow={glow} />;
}

export function Pill({ children, color = C.textDim, bg, style }: { children: ReactNode; color?: string; bg?: string; style?: ViewStyle }) {
  return (
    <View style={[s.pill, { backgroundColor: bg ?? tint(color, 0.14) }, style]}>
      {typeof children === "string" ? <Text style={[s.pillText, { color }]}>{children}</Text> : children}
    </View>
  );
}

export function RiskBadge({ risk }: { risk: "low" | "medium" | "high" }) {
  const color = risk === "high" ? C.attention : risk === "medium" ? C.waiting : C.active;
  return (
    <View style={[s.riskBadge, { backgroundColor: tint(color, 0.16) }]}>
      {risk === "high" && <Icon name="warning" size={11} color={color} />}
      <Text style={[s.riskText, { color }]}>{risk === "high" ? "HIGH RISK" : risk.toUpperCase()}</Text>
    </View>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={s.sectionRow}>
      <Text style={s.section}>{children}</Text>
      {right}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Btn({
  label, onPress, kind = "primary", icon, flex, color,
}: {
  label: string; onPress?: () => void; kind?: "primary" | "ghost" | "danger" | "accent";
  icon?: keyof typeof ICON; flex?: number; color?: string;
}) {
  const styleMap: Record<string, { bg: string; fg: string; border?: string }> = {
    primary: { bg: C.text, fg: C.onAccent },
    accent: { bg: C.accent, fg: C.onAccent },
    ghost: { bg: "transparent", fg: C.textDim, border: C.borderStrong },
    danger: { bg: tint(C.attention, 0.08), fg: C.attention, border: tint(C.attention, 0.4) },
  };
  const v = styleMap[kind];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: v.bg, borderColor: v.border ?? "transparent", borderWidth: v.border ? 1 : 0, flex },
        pressed && { opacity: 0.8 },
      ]}
    >
      {icon && <Icon name={icon} size={16} color={color ?? v.fg} />}
      <Text style={[s.btnText, { color: color ?? v.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Mono({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[s.mono, style]}>{children}</Text>;
}

export function IconChip({ name, color = C.accent, bg, onPress }: { name: keyof typeof ICON; color?: string; bg?: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.iconChip, { backgroundColor: bg ?? tint(color, 0.16) }]}>
      <Icon name={name} size={15} color={color} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  dot: { width: 9, height: 9, borderRadius: 5 },
  glow: { shadowOpacity: 0.9, shadowRadius: 5 },
  pill: { borderRadius: R.sm, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" },
  pillText: { fontSize: 10.5, fontWeight: "700" },
  riskBadge: { borderRadius: R.sm, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4 },
  riskText: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.5 },
  mono: { fontFamily: MONO, color: C.text, fontSize: 12.5 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 11 },
  section: { color: C.textDim, fontSize: 13, fontWeight: "600", letterSpacing: 0.4 },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: R.lg, padding: 14 },
  btn: { height: 46, borderRadius: R.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 14 },
  btnText: { fontSize: 14.5, fontWeight: "600" },
  iconChip: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
});
