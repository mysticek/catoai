/**
 * Cato design tokens — from the Cato.dc.html design direction.
 * Dark, premium, purple accent. Geist-like system sans + monospace for code.
 */
import { Platform } from "react-native";

export const C = {
  // surfaces
  bg: "#0b0c0f",
  card: "#141519",
  card2: "#101114",
  black: "#000000",
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.12)",
  // text
  text: "#ececef",
  textDim: "#8a8b94",
  textMute: "#6c6d77",
  textFaint: "#56575f",
  // brand
  accent: "#a78bfa",
  accent2: "#7c5cf0",
  accentLite: "#b79dff",
  onAccent: "#0b0c0f",
  // status
  idle: "#62636d",
  active: "#3ecf8e",
  waiting: "#efb04a",
  attention: "#f96a6a",
  // diff
  add: "#8fe3b8",
  del: "#f0a0a0",
} as const;

export type StatusKey = "idle" | "active" | "waiting" | "attention";
export const STATUS: Record<StatusKey, string> = {
  idle: C.idle,
  active: C.active,
  waiting: C.waiting,
  attention: C.attention,
};

export const RISK: Record<"low" | "medium" | "high", string> = {
  low: C.active,
  medium: C.waiting,
  high: C.attention,
};

/** Translucent tint of a color (color is a hex). */
export const tint = (hex: string, alpha = 0.14): string => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

export const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) as string;

export const R = { sm: 8, md: 12, lg: 15, xl: 18, pill: 999 } as const;
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22 } as const;
