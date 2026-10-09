"use client";

/**
 * The four-step intro before the console, modelled on Lazarus Scan's.
 *
 * Audit decisions (Oct 2026), each fixing something the first version did:
 *
 *  1. ONE picture for all four steps. Lazarus works because the rings never
 *     change, only what is lit. Here the picture is the whole pipeline, top to
 *     bottom: the governments that publish lists → the RedStone list → the
 *     wallet you pay. Each step lights its part and dims the rest.
 *  2. Nothing changes size between steps. Every element is always rendered;
 *     steps only change opacity and colour, so the caption and the buttons
 *     never move under the cursor.
 *  3. Copy held to two sentences of similar length per step. The 8-day rule
 *     moved to step 3's caption, where it sits next to the live list age.
 *  4. Real targets: the step dots are 24px buttons. Arrow keys move between
 *     steps, Esc skips to the console.
 *  5. Balanced columns: both vertically centred, the text block has a fixed
 *     minimum height so the buttons hold their position across steps.
 *
 * Copy rules: no em dashes, plain words. Every claim must stay true of the
 * bound policy (policy/redstone).
 */

import { useCallback, useEffect, useState } from "react";
import { C, R, SP, T, BORDER, INSET_X, H } from "@/lib/ds";

type Health = { ageHours: number | null } | null;

const SANS = "var(--sans)";
const MONO = "var(--mono)";
const TINT = "#FBEDE3";
const DIM = 0.32;

const STEPS = [
  {
    eyebrow: "Why this exists",
    title: "Sanctioned wallets",
    body: "Governments name the wallets of people and groups they sanction, and the lists change every week. Paying a listed wallet can break the law, even by accident.",
  },
  {
    eyebrow: "What this demo does",
    title: "Check a wallet before you pay it.",
    body: "Pick a wallet and run the check. The policy looks it up on the sanctions lists, and Newton Protocol operators sign the result as an attestation anyone can check.",
  },
  {
    eyebrow: "Part 1 · The check",
    title: "A policy decides what to check.",
    body: "A policy is a rule plus the data it reads. Here the data is the RedStone Sanctions Oracle, which keeps 463 official lists onchain, and the rule blocks the payment if the wallet is on any of them.",
  },
  {
    eyebrow: "Part 2 · Enforcement",
    title: "Newton enforces it.",
    body: "Newton Protocol operators run the policy on the wallet you are about to pay, and a quorum signs the result. The signed result can't be altered, and anyone can check it on the explorer.",
  },
] as const;

function age(health: Health): string {
  if (!health || health.ageHours === null) return "updated weekly";
  const h = health.ageHours;
  if (h < 1) return "updated within the hour";
  if (h < 48) return `updated ${Math.round(h)} hours ago`;
  return `updated ${Math.round(h / 24)} days ago`;
}

function captionFor(step: number, health: Health): string {
  switch (step) {
    case 0:
      return "Governments publish the wallets they sanction.";
    case 1:
      return "The wallet you pay is checked against the list.";
    case 2:
      return `RedStone data, ${age(health)}. Max age 8 days.`;
    default:
      return "On a list, so the payment is blocked.";
  }
}

export default function Intro({ health, onDone }: { health: Health; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const s = STEPS[step];

  const go = useCallback((n: number) => setStep(Math.max(0, Math.min(STEPS.length - 1, n))), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") go(step + 1);
      else if (e.key === "ArrowLeft") go(step - 1);
      else if (e.key === "Escape") onDone();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, go, onDone]);

  return (
    <div className="pe-intro" style={{ padding: `${SP.x5}px ${INSET_X}` }}>
      <figure className="pe-intro-figure" style={{ margin: 0 }}>
        <Art step={step} health={health} />
        <figcaption
          aria-live="polite"
          // One line, always: captions are kept short enough to fit.
          style={{ fontFamily: SANS, ...T.valueSm, color: C.muted, textAlign: "center", marginTop: SP.x3, whiteSpace: "nowrap" }}
        >
          {captionFor(step, health)}
        </figcaption>
      </figure>

      <div className="pe-intro-text">
        <div role="tablist" aria-label="Intro steps" style={{ display: "flex", gap: SP.half, marginLeft: -8, marginBottom: SP.x2 }}>
          {STEPS.map((x, i) => (
            <button
              key={x.eyebrow}
              type="button"
              role="tab"
              aria-selected={i === step}
              aria-label={`Step ${i + 1} of ${STEPS.length}: ${x.title}`}
              onClick={() => go(i)}
              className="pe-reset"
              style={{ width: 24, height: 24, display: "grid", placeItems: "center", cursor: "pointer" }}
            >
              <span
                style={{
                  width: i === step ? 20 : 8,
                  height: 8,
                  borderRadius: R.pill,
                  background: i === step ? C.ink : C.hairline,
                  transition: "width 0.2s ease, background 0.2s ease",
                }}
              />
            </button>
          ))}
        </div>

        <div style={{ minHeight: 236 }}>
          <div
            style={{
              fontFamily: SANS,
              ...T.monoSm,
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: C.muted,
            }}
          >
            {s.eyebrow}
          </div>
          <h2 style={{ fontFamily: SANS, ...T.h3, color: C.ink, margin: `${SP.x1_5}px 0 ${SP.x2}px` }}>{s.title}</h2>
          <p style={{ fontFamily: SANS, ...T.valueLg, color: C.body, margin: 0, maxWidth: "44ch" }}>{s.body}</p>
        </div>

        <div style={{ display: "flex", gap: SP.x1_5, marginTop: SP.x4, flexWrap: "wrap" }}>
          <button type="button" onClick={onDone} className="pe-reset pe-dark" style={btn(true)}>
            Start with a policy
          </button>
          {!last && (
            <button type="button" onClick={() => go(step + 1)} className="pe-reset" style={btn(false)}>
              Next
            </button>
          )}
        </div>
        <div style={{ fontFamily: SANS, ...T.valueSm, color: C.muted2, marginTop: SP.x2 }} className="pe-intro-keys">
          ← → to move · Esc to skip
        </div>
      </div>
    </div>
  );
}

function btn(fill: boolean): React.CSSProperties {
  return {
    height: H.control,
    padding: `0 ${SP.x3}px`,
    borderRadius: R.pill,
    border: `${BORDER}px solid ${fill ? C.ink : C.hairline}`,
    background: fill ? undefined : "transparent",
    color: fill ? undefined : C.ink,
    fontFamily: SANS,
    ...T.label,
    whiteSpace: "nowrap",
    cursor: "pointer",
  };
}

/* ── The picture ─────────────────────────────────────────── */

const SOURCES = ["OFAC", "EU", "UN", "UK", "+459"];
const ROWS = 3;
const MATCH = 1;

function Art({ step, health }: { step: number; health: Health }) {
  // What each step lights. Everything is always rendered; only emphasis moves.
  const lit = {
    sources: step === 0 || step === 2,
    upper: step === 2,
    list: step >= 1,
    lower: step === 1 || step === 3,
    wallet: step === 1 || step === 3,
  };
  const match = step === 3;
  const fade = (on: boolean): React.CSSProperties => ({ opacity: on ? 1 : DIM, transition: "opacity 0.3s ease" });

  return (
    <div className="pe-intro-art" aria-hidden style={{ width: "100%", maxWidth: 400, margin: "0 auto" }}>
      {/* Governments */}
      <div style={{ ...fade(lit.sources), textAlign: "center" }}>
        <div style={{ fontFamily: SANS, ...T.valueSm, fontSize: 12, lineHeight: "16px", color: C.muted, marginBottom: SP.x1 }}>
          Published by governments
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: SP.x1, flexWrap: "nowrap" }}>
          {SOURCES.map((t) => (
            <span
              key={t}
              style={{
                fontFamily: SANS,
                ...T.label,
                fontSize: 13,
                color: C.ink,
                border: `${BORDER}px solid ${lit.sources && step === 0 ? C.ink : C.hairline}`,
                borderRadius: R.pill,
                padding: `${SP.half}px ${SP.x1_5}px`,
                background: C.surface,
                transition: "border-color 0.3s ease",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <Connector on={lit.upper} />

      {/* The RedStone list */}
      <div
        style={{
          ...fade(lit.list),
          borderRadius: R.lg,
          border: `${BORDER}px solid ${step === 2 ? C.ink : C.hairline}`,
          background: C.surface,
          padding: SP.x2,
          transition: "opacity 0.3s ease, border-color 0.3s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: SP.x1 }}>
          <span style={{ fontFamily: SANS, ...T.label, color: C.ink }}>RedStone Sanctions Oracle</span>
          <span style={{ fontFamily: SANS, fontSize: 12, lineHeight: "16px", color: C.muted }}>Ethereum mainnet</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: SP.half, marginTop: SP.x1_5 }}>
          {Array.from({ length: ROWS }, (_, i) => {
            const hit = match && i === MATCH;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  height: 32,
                  padding: `0 ${SP.x1_5}px`,
                  borderRadius: R.sm,
                  background: hit ? TINT : C.field,
                  border: `${BORDER}px solid ${hit ? C.flag : "transparent"}`,
                  fontFamily: MONO,
                  ...T.monoSm,
                  color: hit ? C.flag : C.muted,
                  transition: "background 0.3s ease, border-color 0.3s ease, color 0.3s ease",
                }}
              >
                <span>0x····…····</span>
                <span style={{ fontFamily: SANS, fontWeight: 500, opacity: hit ? 1 : 0, transition: "opacity 0.3s ease" }}>
                  Match
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ fontFamily: SANS, fontSize: 12, lineHeight: "16px", color: C.muted, marginTop: SP.x1_5 }}>
          463 lists via OpenSanctions · {age(health)}
        </div>
      </div>

      <Connector on={lit.lower} flag={match} dashed />

      {/* The wallet you pay */}
      <div style={{ ...fade(lit.wallet), display: "flex", flexDirection: "column", alignItems: "center", gap: SP.x1_5 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: match ? C.flag : C.ink,
            color: C.surface,
            boxShadow: `0 0 0 3px ${C.surface}, 0 0 0 5px ${match ? C.flag : C.ink}`,
            fontFamily: SANS,
            ...T.label,
            transition: "background 0.3s ease, box-shadow 0.3s ease",
          }}
        >
          W
        </div>
        <div
          style={{
            fontFamily: SANS,
            ...T.valueSm,
            color: match ? C.flag : C.muted,
            border: `${BORDER}px solid ${match ? C.flag : C.hairline}`,
            background: match ? TINT : C.surface,
            borderRadius: R.pill,
            padding: `${SP.half}px ${SP.x2}px`,
            transition: "color 0.3s ease, border-color 0.3s ease, background 0.3s ease",
            whiteSpace: "nowrap",
          }}
        >
          {match ? "Blocked · signed by the quorum" : "Wallet you pay"}
        </div>
      </div>
    </div>
  );
}

function Connector({ on, flag, dashed }: { on: boolean; flag?: boolean; dashed?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div
        style={{
          width: 0,
          height: SP.x4,
          borderLeft: `${BORDER * 2}px ${dashed ? "dashed" : "solid"} ${flag ? C.flag : on ? C.ink : C.hairline}`,
          transition: "border-color 0.3s ease",
        }}
      />
    </div>
  );
}
