/**
 * Cato design tokens — from the Cato.dc.html design direction (Desktop · Mission control).
 * Dark, premium, purple accent. Geist sans + JetBrains Mono for code.
 * Mirrors packages/mobile/src/theme.ts so the two surfaces stay visually identical.
 */

export const C = {
  // surfaces
  bg: "#0b0c0f",
  panel: "#0e0f12", // sidebar / inset panels
  card: "#141519",
  card2: "#101114",
  chrome: "#16171c",
  black: "#000000",
  codeBg: "#08090b",
  border: "rgba(255,255,255,0.06)",
  borderMid: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.12)",
  // text
  text: "#ececef",
  textBright: "#ffffff",
  textSoft: "#c9cad1",
  textDim: "#8a8b94",
  textMute: "#6c6d77",
  textFaint: "#56575f",
  textGhost: "#3a3b42",
  // brand
  accent: "#a78bfa",
  accent2: "#7c5cf0",
  accentLite: "#b79dff",
  accentInk: "#c8b9ff",
  onAccent: "#0b0c0f",
  // status
  idle: "#62636d",
  active: "#3ecf8e",
  waiting: "#efb04a",
  attention: "#f96a6a",
  // diff / code
  add: "#8fe3b8",
  del: "#f0a0a0",
} as const;

export type StateKey = "idle" | "active" | "waiting" | "attention";
export const STATE_COLOR: Record<StateKey, string> = {
  idle: C.idle,
  active: C.active,
  waiting: C.waiting,
  attention: C.attention,
};

export type RiskKey = "low" | "medium" | "high";
export const RISK_COLOR: Record<RiskKey, string> = {
  low: C.active,
  medium: C.waiting,
  high: C.attention,
};

export const SANS = "'Geist', -apple-system, 'Helvetica Neue', Arial, sans-serif";
export const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";

/** Translucent tint of a hex color. */
export const tint = (hex: string, alpha = 0.14): string => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};
