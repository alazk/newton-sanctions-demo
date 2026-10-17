/**
 * Lazarus / Newton Explorer tokens.
 *
 * Source: lazarus-demo/design/tokens.css. Suisse Intl is the licensed brand
 * face; Inter stands in. Weights are 400 and 500. Outcome colour is leaf,
 * ruby, and gold. Interaction is ink.
 */

/* ── Spacing. 4px baseline, section gap tops out at 48. ── */
export const SP = {
  half: 4,
  x1: 8,
  x1_5: 12,
  x2: 16,
  page: 20,
  x3: 24,
  x4: 32,
  x5: 40,
  x6: 48,
  x8: 64,
  x10: 80,
} as const;

/* ── Radii. Controls 12, surfaces 16, pill for buttons. ── */
export const R = {
  sm: 12,
  md: 12,
  lg: 16,
  xl: 16,
  pill: 999,
} as const;

/* ── Control heights. Touch target 44, field 48, pill 40. ── */
export const H = {
  field: 48,
  control: 44,
  action: 44,
  radio: 24,
  chip: 40,
} as const;

/**
 * Shared horizontal inset: clamp(24px, 4vw, 48px).
 * Mast, console, and verdict use it so their edges line up.
 */
export const INSET_X = "clamp(24px, 4vw, 48px)";

/* ── Type. Product scale, not display marketing sizes. ── */
export const T = {
  /** Buttons, nav, row titles. 14 / 500. */
  label: { fontSize: 14, lineHeight: 1.4, fontWeight: 500 },
  /** Intro body and verdict reason. 16 / 400. */
  valueLg: { fontSize: 16, lineHeight: 1.45, fontWeight: 400 },
  /** Default body. 14 / 400. */
  value: { fontSize: 14, lineHeight: 1.45, fontWeight: 400 },
  /** Captions and metadata. 12 / 400. */
  valueSm: { fontSize: 12, lineHeight: 1.4, fontWeight: 400 },
  /** Section labels. 12 / 500, tracked, uppercase at the call site. */
  eyebrow: { fontSize: 12, lineHeight: 1.4, fontWeight: 500, letterSpacing: "0.08em" },

  /** Verdict headline. 24–28 / 500. */
  h1: {
    fontSize: "clamp(1.5rem, 1.2rem + 1.5vw, 1.75rem)",
    lineHeight: 1.15,
    fontWeight: 500,
    letterSpacing: "-0.015em",
  },
  /** Page title. 18–20 / 500. */
  h2: {
    fontSize: "clamp(1.125rem, 1rem + 0.6vw, 1.25rem)",
    lineHeight: 1.2,
    fontWeight: 500,
    letterSpacing: "-0.01em",
  },
  /** Card and section heading. 18 / 500. */
  h3: { fontSize: 18, lineHeight: 1.25, fontWeight: 500, letterSpacing: "-0.01em" },

  /** Addresses and hashes. 14, mono. */
  mono: { fontSize: 14, lineHeight: 1.45, fontWeight: 400 },
  monoSm: { fontSize: 12, lineHeight: 1.4, fontWeight: 400 },
} as const;

/* ── Colour. Bone, ink, and the three outcome tones. ── */
export const C = {
  ink: "#0E0E0F",
  ink2: "#6B6B6C",
  field: "#F5F5F6",
  surface: "#FFFFFF",
  bone: "#FBFCFE",
  hairline: "#E3E3E4",
  control: "#9A9A9B",
  body: "#6B6B6C",
  muted: "#6B6B6C",
  muted2: "#737374",

  accent: "#0E0E0F",
  /** White at 18% over ink. */
  accentHover: "#393939",
  accentTint: "#F5F5F6",

  pass: "#0B6E4F",
  passText: "#095A41",
  passWash: "#E6F2EE",
  flag: "#AD2B03",
  flagText: "#8F2402",
  flagWash: "#FBE9E3",
  error: "#8F2402",
  caution: "#8A5E14",
  cautionWash: "#FCF4E5",
} as const;

export const BORDER = 1;
