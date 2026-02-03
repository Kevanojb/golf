import React, { useState, useEffect, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPER_ADMIN_EMAILS = ["kevanojb@icloud.com"]; // global admin(s)


// Back-compat league labels (some components reference these)
let LEAGUE_SLUG = "";
let LEAGUE_TITLE = "";
let LEAGUE_HEADER_TITLE = "";

// =========================
// VITE RUNTIME HELPERS (module-scope)
// Some helpers were previously declared inside blocks which makes them block-scoped in ES modules.
// Defining them here prevents "ReferenceError: Can't find variable" crashes.
// =========================
const _num = (n, d = 0) => {
  const x = Number(n);
  return Number.isFinite(x) ? x : d;
};

// Compatibility shim: original single-file app expected window.supabase.createClient
if (typeof window !== "undefined") {
  window.supabase = window.supabase || {};
  window.supabase.createClient = window.supabase.createClient || createClient;
}

// Used for per-hole accumulators (defaults to 18 holes of zeros)
var makeBlank = function (n, fill) {
  if (n === undefined || n === null) n = 18;
  if (fill === undefined) fill = 0;
  return Array.from({ length: n }, function () { return fill; });
};

// Format strokes vs par like "+5", "-2", or "E"
var formatGrossVsPar = function (n) {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "E";
  return (n > 0 ? "+" : "") + String(n);
};

// =========================
// TENANT ROUTE + BRANDING (module-scope)
// In the multi-tenant build, AuthGate sets these globals BEFORE App renders.
// We no longer use URL hash switching.
// =========================
function getActiveSociety() {
  try {
    const id = (typeof window !== "undefined" ? window.__activeSocietyId : "") || "";
    const slug = (typeof window !== "undefined" ? window.__activeSocietySlug : "") || "";
    const name = (typeof window !== "undefined" ? window.__activeSocietyName : "") || "";
    const role = (typeof window !== "undefined" ? window.__activeSocietyRole : "") || "";
    return { id, slug, name, role };
  } catch (e) {
    return { id: "", slug: "", name: "", role: "" };
  }
}

// =========================
// PUBLIC TENANT FROM URL (module-scope)
// Allow public access via /<repo>/<society-slug>/... without requiring AuthGate.
// Example (GitHub Pages): /golf/den-society/  -> society slug "den-society"
// =========================
function _repoBaseSegment() {
  try {
    const base = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL)
      ? String(import.meta.env.BASE_URL)
      : "/";
    const seg = base.replace(/^\/+/, "").split("/")[0] || "";
    return seg;
  } catch {
    return "";
  }
}

function _parseSocietySlugFromUrl() {
  try {
    if (typeof window === "undefined") return "";
    const repoSeg = _repoBaseSegment(); // e.g. "golf"
    const parts = String(window.location.pathname || "")
      .split("?")[0]
      .split("#")[0]
      .split("/")
      .filter(Boolean);

    if (!parts.length) return "";

    // If we're hosted under a repo segment (GitHub Pages), slug is the segment after it.
    if (repoSeg) {
      const i = parts.indexOf(repoSeg);
      if (i >= 0 && parts[i + 1]) return decodeURIComponent(parts[i + 1]);
    }

    // Fallback: first segment could be the society slug (non-GH Pages hosting)
    return decodeURIComponent(parts[0] || "");
  } catch {
    return "";
  }
}


// NOTE: tenant selection is now decided at runtime (props from AuthGate),
// so we must NOT freeze SOCIETY_ID/PREFIX at module-load time.
// (In Vite/ESM, module-scope constants run once on import, which can be before globals are set.)
// --- 9-hole / partial round support ---
// Guaranteed global helper (using `var`) so missing holes stay missing instead of becoming zeros.
var _safeNum = function (v, fallback) {
  if (fallback === undefined) fallback = NaN;
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    var s = v.trim();
    if (!s || s === "—" || s === "-") return fallback;
    v = s;
  }
  var n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};


// --- Shared helper: parse per-hole par & stroke index arrays from a round (used by WHS + reports) ---
// Use `var` so it is globally available across views/components.
var _tryGetParsSI = function (r) {
  var pars = (r && (r.parsPerHole || r.parPerHole || r.parsArr || r.pars || r.parHoles || r.par)) || null;
  var si   = (r && (r.siPerHole || r.strokeIndexPerHole || r.siArr || r.si || r.strokeIndex)) || null;
  var pArr = Array.isArray(pars) ? pars.map(Number) : null;
  var sArr = Array.isArray(si) ? si.map(Number) : null;
  return { pArr: pArr, sArr: sArr };

};

// --- Shared helper: instructional advice for Focus buckets (neutral coaching tone) ---
function PR_focusAdviceLabelKey(label){
  const s = String(label || "").trim();
  return s;
}
function PR_focusAdvice(label){
  const s = PR_focusAdviceLabelKey(label);
  const norm = s.replace(/\s+/g," ").trim();
  const lower = norm.toLowerCase();

  // Stroke Index buckets
  if (/^si\s*1\s*[–-]\s*6$/i.test(norm)) {
    return {
      why: "These are the toughest holes. The fastest gains come from cutting out doubles by choosing a conservative line and accepting bogey when needed.",
      drill1: "15 mins: ‘Bogey-is-good’ sim — pick 6 hard holes, play them in your head, and rehearse the safest target/club choice for each.",
      drill2: "Finish: 10 pressure reps where ‘short-side’ is an automatic fail.",
      rule: "Bogey is a win here. Avoid doubles by defaulting to the fattest target and the safest miss."
    };
  }
  if (/^si\s*7\s*[–-]\s*12$/i.test(norm)) {
    return {
      why: "These holes decide your baseline scoring. Small improvements come from better planning (target + miss) and fewer loose swings.",
      drill1: "10 mins: ‘One target, one swing’ — pick a precise start line and commit; no resets.",
      drill2: "Finish: 10 must-execute reps (7/10 pass) with a pre-shot checklist: target → miss → tempo.",
      rule: "Commit early. Swing freely. If you’re between targets, choose the safer one."
    };
  }
  if (/^si\s*13\s*[–-]\s*18$/i.test(norm)) {
    return {
      why: "These are your advantage holes. The leak is usually over-aggression: forcing flags or taking on short-side misses when par is already ‘banked’.",
      drill1: "15 mins: ‘2‑Pointer First’ — 6 reps where your only goal is an uphill two‑putt. Short-side miss = fail.",
      drill2: "Finish: 10 reps where you say out loud: ‘What’s my safe miss?’ If you can’t answer, restart.",
      rule: "If birdie needs a perfect strike, play for par: fat green, uphill putt, two‑putt exit."
    };
  }

  // Par buckets
  if (/^par\s*3$/i.test(norm)) {
    return {
      why: "Par 3s amplify indecision and start-line errors. The quickest wins come from centre-green targets, clean club selection, and committed swings.",
      drill1: "12–15 mins: Par‑3 sim — choose 3 clubs, hit 4 balls each. Score a ‘pass’ only if you’d have a two‑putt from there.",
      drill2: "Finish: 6 ‘one ball only’ shots (full routine) — walk away between reps.",
      rule: "Middle of the green beats perfect distance. If between clubs, take the longer one and swing smooth."
    };
  }
  if (/^par\s*4$/i.test(norm)) {
    return {
      why: "Par 4 scoring is driven by tee-shot positioning and avoiding the wrong side. One poor tee ball turns a simple hole into a scramble.",
      drill1: "15 mins: ‘Fairway side’ drill — pick a side of the fairway; 10 drives/tees where you must start it on that side.",
      drill2: "Finish: 10 approach reps to a fat target (centre/away from trouble) — pin is irrelevant.",
      rule: "Prioritise position over power. Pick the side that removes trouble and keeps your next shot simple."
    };
  }
  if (/^par\s*5$/i.test(norm)) {
    return {
      why: "Par 5s are about sequencing: a good lay‑up and smart target choices beat low‑percentage hero shots.",
      drill1: "15 mins: ‘Three‑shot par 5’ — rehearse: safe tee ball → favourite lay‑up yardage → wedge to fat green.",
      drill2: "Finish: 10 wedge reps to your lay‑up ‘money’ yardage (e.g. 70–90).",
      rule: "If you can’t reach in two with your normal strike, lay up to your favourite wedge number."
    };
  }

  // Distance buckets (your app starts at <150)
  if (/^<\s*150$/i.test(norm) || lower.includes("<150")) {
    return {
      why: "This is the scoring zone. The leak is usually distance control and dispersion: missing pin‑high and leaving awkward up‑and‑downs.",
      drill1: "15 mins: Distance ladder — pick 3 wedge numbers under 150 (e.g. 80/105/130). 5 balls each; must finish ±5y long/short.",
      drill2: "Finish: 5 balls — you need 2 pin‑high (not long) to pass.",
      rule: "Distance first, direction second. Miss pin‑high on the fat side — never long."
    };
  }
  if (/150\s*[–-]\s*200/i.test(norm)) {
    return {
      why: "Mid‑iron approaches reward smart misses. The quickest gains come from aiming away from short‑side trouble and accepting 20–30ft putts.",
      drill1: "12 mins: ‘Green‑centre bias’ — 10 balls where the target is centre-green regardless of the pin.",
      drill2: "Finish: 6 reps where you must call your safe miss before you swing.",
      rule: "Aim at the biggest part of the green. Short-side misses are the only real mistake here."
    };
  }
  if (/200\+/.test(norm) || lower.includes("200+")) {
    return {
      why: "Long approaches are about damage control. Trying to hit it tight creates short‑sides and doubles. Your goal is a stress-free next shot.",
      drill1: "10 mins: ‘Front edge’ drill — land 10 balls on the front half / short of the pin line.",
      drill2: "Finish: 6 reps where ‘green or easy chip’ is the pass condition.",
      rule: "Default to centre/short of centre. If you miss, miss short and simple — not long and nasty."
    };
  }

  // Hole-yardage bands (by hole length): 201–350 / 351–420 / 420+
  if (/201\s*[–-]\s*350/i.test(norm)) {
    return {
      why: "These are your mid-length holes. The biggest gains come from solid tee-ball placement and choosing the correct ‘side’ of the green rather than chasing pins.",
      drill1: "15 mins: ‘Fairway side’ rehearsal — pick a side (left/right) and hit 10 reps where you start it on that side.",
      drill2: "Finish: 8 approach reps to a fat target (centre/away from trouble). Score a pass if you’d have a stress-free two-putt.",
      rule: "Position first. If the pin is near trouble, aim away and take your par putt."
    };
  }
  if (/351\s*[–-]\s*420/i.test(norm)) {
    return {
      why: "These longer holes punish weak targets. The leak is usually short-siding yourself after a decent tee shot. Centre-green thinking turns big numbers into bogeys at worst.",
      drill1: "12 mins: ‘Green-centre bias’ — 10 balls where the target is the middle of the green, regardless of the pin.",
      drill2: "Finish: 6 reps where you must call your safe miss before you swing.",
      rule: "Aim at the biggest part of the green. Your ‘bad’ outcome should be an easy chip or long putt — not a short-side scramble."
    };
  }
  if (/^420\+$/i.test(norm) || lower.includes("420+")) {
    return {
      why: "These are true ‘damage control’ holes. Trying to force birdies creates doubles. The quickest gains come from a conservative plan and a reliable lay-up/wedge sequence.",
      drill1: "15 mins: ‘Three-shot plan’ — rehearse safe tee ball → favourite lay-up yardage → wedge to fat green.",
      drill2: "Finish: 10 wedges to your favourite number (e.g. 70–95). Track carry and keep misses short of the pin line.",
      rule: "Play the hole backwards: pick your best wedge yardage, then build the tee shot and lay-up to reach it."
    };
  }


  // Default fallback
  return {
    why: "This bucket is currently your biggest net leak. Turning it from “bad” to “average” is usually the fastest way to improve.",
    drill1: "10 minutes: one constraint + 10 pressure reps.",
    drill2: "Finish with 10 “must execute” reps (score it: 7/10 target).",
    rule: "Default to the safe target. Your goal is fewer big numbers, not more hero shots."
  };
}

function PR_focusWhy(label){ return PR_focusAdvice(label).why; }
function PR_focusDrill1(label, edgeSuggestion){
  const a = PR_focusAdvice(label);
  // if we fell back to default and edgeSuggestion exists, prefer edgeSuggestion as first bullet
  const isDefault = a && String(a.why||"").indexOf("biggest net leak") !== -1;
  if (isDefault && typeof edgeSuggestion === "function") {
    try { return edgeSuggestion({ label }); } catch { /* ignore */ }
  }
  return a.drill1;
}
function PR_focusDrill2(label){ return PR_focusAdvice(label).drill2; }
function PR_focusRule(label){ return PR_focusAdvice(label).rule; }

/**
 * Global edgeSuggestion fallback used by some legacy UI strings.
 * Kept neutral and safe: the detailed coaching is generated by PR_focusAdvice.
 */
var edgeSuggestion = function(row){
  return "Pick a safe target, commit to one simple constraint, and measure it over the next 3–5 rounds.";
};


// Fixed-layout 18-hole reader.
// Works for Squabbit-style rows where holes sit in fixed columns and totals sit at OUT/IN/TOTAL columns.
// - holeStart: index of Hole 1 cell in the row
// - returns length-18 array with NaN for missing/unplayed holes
function _read18HoleBlock(row, holeStart, opts) {
  const o = opts || {};
  const pickupAsZero = !!o.pickupAsZero;     // for Stableford rows: P, \, / => 0
  const max = (o.max === undefined ? Infinity : o.max);
  const min = (o.min === undefined ? -Infinity : o.min);
  const parseIntMode = (o.intMode !== false); // default true
  const vals = new Array(18).fill(NaN);

  if (!row || holeStart === undefined || holeStart === null) return vals;

  for (let h = 0; h < 18; h++) {
    // Layout: H1..H9, OUT, H10..H18, IN, TOTAL
    // So after the first 9 holes there is one extra OUT column to skip.
    const col = holeStart + h + (h >= 9 ? 1 : 0);
    const raw0 = (col < row.length ? row[col] : "");
    let raw = String(raw0 ?? "").trim();

    // Common "no score" markers
    if (raw === "" || raw === "—" || raw === "-") {
      vals[h] = NaN;
      continue;
    }

    // Pickups / NR markers
    if (raw === "P" || raw === "p" || raw === "\\" || raw === "/") {
      vals[h] = pickupAsZero ? 0 : NaN;
      continue;
    }

    // Clean number (strip stray letters like P)
    const cleaned = raw.replace(/[^0-9.\-]/g, "");
    let n = parseIntMode ? parseInt(cleaned, 10) : parseFloat(cleaned);

    if (!Number.isFinite(n)) {
      vals[h] = NaN;
      continue;
    }

    // Clamp to sensible range
    if (n < min || n > max) {
      vals[h] = NaN;
      continue;
    }

    vals[h] = n;
  }

  return vals;
}

// Detect 9-hole (or partial) round: true if holes 10–18 are all missing
function _isNineHole(vals) {
  if (!vals || vals.length < 18) return false;
  for (let i = 9; i < 18; i++) {
    if (Number.isFinite(vals[i])) return false;
  }
  return true;
}

// Detect whether the CURRENT event is 9-hole or 18-hole.
// Rule: if ANY player has any finite value on holes 10–18 (Stableford OR gross),
// treat the event as 18. Otherwise treat as 9.
function detectEventHoleCount(computed) {
  try {
    const arr = Array.isArray(computed) ? computed : [];
    if (!arr.length) return 18;

    for (const p of arr) {
      const ph = Array.isArray(p?.perHole) ? p.perHole : null;
      const gh = Array.isArray(p?.grossPerHole) ? p.grossPerHole : null;

      for (let i = 9; i < 18; i++) {
        const pts = ph ? Number(ph[i]) : NaN;
        const g = gh ? Number(gh[i]) : NaN;
        if (Number.isFinite(pts) || Number.isFinite(g)) return 18;
      }
    }
    return 9;
  } catch (e) {
    return 18;
  }
}

      
  // --- Trend helper: slope (least squares) on last N samples ---
// Returns + when values are rising.
function _slope(arr) {
  const a0 = Array.isArray(arr) ? arr : [];
  // keep only finite numbers
  const a = [];
  for (let i=0;i<a0.length;i++){
    const v = Number(a0[i]);
    if (Number.isFinite(v)) a.push(v);
  }
  if (a.length < 6) return NaN;
  const N = Math.min(10, a.length);
  const y = a.slice(-N);
  const xbar = (N - 1) / 2;
  const ybar = y.reduce((s,v)=>s+v,0) / N;
  let num = 0, den = 0;
  for (let i=0;i<N;i++){
    const dx = i - xbar;
    num += dx * (y[i] - ybar);
    den += dx * dx;
  }
  return den ? (num / den) : NaN;
}

// --- Tone helper: green/red/grey vs-field deltas ---
// returns a Tailwind text-* class.
// higherIsBetter=true when positive delta is good; false when negative delta is good.
function _toneFromVsField(delta, higherIsBetter, thresh) {
  if (!Number.isFinite(delta)) return "text-neutral-500";
  const t = Number.isFinite(thresh) ? thresh : 0.10;
  if (Math.abs(delta) <= t) return "text-neutral-500";
  const better = higherIsBetter ? (delta > 0) : (delta < 0);
  return better ? "text-emerald-700" : "text-rose-700";
}
function _statusFromVsField(delta, higherIsBetter, thresh) {
  if (!Number.isFinite(delta)) return "";
  const t = Number.isFinite(thresh) ? thresh : 0.10;
  if (Math.abs(delta) <= t) return "avg vs field";
  const better = higherIsBetter ? (delta > 0) : (delta < 0);
  return better ? "better vs field" : "worse vs field";
}
// =========================
  // HARDENING LAYER (runtime-safe)
  // Ensures common helpers exist so local/offline runs don't crash with ReferenceError.
  // IMPORTANT: In ES modules (Vite), function declarations inside blocks are block-scoped.
  // Safari/iOS is especially strict here. Use `var` fallbacks instead (module-scoped).
  // =========================

  var tone = (typeof tone === "function") ? tone : function tone(){
    // neutral fallback
    return "ok";
  };

  var badge = (typeof badge === "function") ? badge : function badge(metric, v){
    // Always return a badge object so JSX like b.cls / b.txt never crashes.
    try{
      if (!Number.isFinite(v)) return { txt: "OK", cls: "bg-neutral-100 text-neutral-800 border border-neutral-200" };
      const t = (typeof tone === "function") ? tone(metric, v) : "ok";
      if (t === "good") return { txt: "Good", cls: "bg-emerald-100 text-emerald-800 border border-emerald-200" };
      if (t === "bad")  return { txt: "Bad",  cls: "bg-rose-100 text-rose-800 border border-rose-200" };
      return { txt: "OK", cls: "bg-neutral-100 text-neutral-800 border border-neutral-200" };
    }catch(e){
      return { txt: "OK", cls: "bg-neutral-100 text-neutral-800 border border-neutral-200" };
    }
  };

  var toneClass = (typeof toneClass === "function") ? toneClass : function toneClass(){
    return "";
  };


// =========================
  // EXTRA HARDENING (report helpers)
  // If a helper is defined inside another component, Safari will throw ReferenceError when PlayerReportView tries to call it.
  // These stubs keep the app stable; when the "real" helpers exist, they will be used instead.
  // =========================
  if (typeof _num !== "function") {
    function _num(n, d=0){ const x = Number(n); return Number.isFinite(x) ? x : d; }
  }
  if (typeof _avgPts !== "function") {
    function _avgPts(agg){ const holes=_num(agg?.holes,0); return holes>0 ? _num(agg?.val,0)/holes : NaN; }
  }
  if (typeof _avgGross !== "function") {
    function _avgGross(agg){ const holes=_num(agg?.holes,0); return holes>0 ? _num(agg?.val,0)/holes : NaN; }
  }
  if (typeof _makeAggGross !== "function") {
    function _makeAggGross(){ return { holes: 0, val: 0, sumSq: 0, bogeyPlus: 0, parOrBetter: 0, birdieOrBetter: 0, doublePlus: 0, eaglePlus: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0, triplesPlus: 0 }; }
  }
  if (typeof _wipeRate !== "function") {
    function _wipeRate(t){ const h=_num(t?.holes,0); return h>0 ? _num(t?.wipes,0)/h : NaN; }
  }
  if (typeof _fmt1 !== "function") {
    function _fmt1(x){ return fmt(x,1); }
  }
  if (typeof _pp !== "function") {
    function _pp(x){ return Number.isFinite(x) ? `${(x*100).toFixed(1)}%` : "—"; }
  }
  if (typeof _ppDiff !== "function") {
    function _ppDiff(a,b){ return (Number.isFinite(a)&&Number.isFinite(b)) ? `${((a-b)*100>=0?"+":"") + ((a-b)*100).toFixed(1)}%` : "—"; }
  }
  if (typeof _bucketLabel !== "function") {
    function _bucketLabel(kind, k){ return String(k); }
  }

  // Filter series using window.__dslUiState (seasonYear / seasonLimit)
function __filterSeries(series){
      const s0 = Array.isArray(series) ? series.slice() : [];
      const ui = (typeof window !== "undefined" && window.__dslUiState) ? window.__dslUiState : {};
      const year = ui && ui.seasonYear ? String(ui.seasonYear) : "All";
      const limitRaw = ui && ui.seasonLimit ? String(ui.seasonLimit) : "All";
      // normalize + sort by dateMs or idx
      const s = s0.filter(Boolean).slice().sort((a,b)=>{
        const ax = (Number.isFinite(Number(a?.dateMs)) ? Number(a.dateMs) : Number(a?.idx||0));
        const bx = (Number.isFinite(Number(b?.dateMs)) ? Number(b.dateMs) : Number(b?.idx||0));
        return ax - bx;
      });
      let out = s;
      if (year && year.toLowerCase() !== "all") {
        const norm = (x) => {
          const t = String(x ?? "").trim();
          const m = t.match(/^(\d{4})-(\d{2})$/);
          if (m) {
            const start = m[1];
            const end = String(Number(start.slice(0,2) + m[2]));
            return `${start}-${end}`;
          }
          return t;
        };
        const sid = norm(year);
        out = out.filter(r => {
          // Prefer explicit seasonId embedded on the round (some views attach it directly)
          const s = (r && (r.seasonId ?? r.season_id)) ??
            (r && r.parsed && (r.parsed.seasonId ?? r.parsed.season_id)) ??
            (r && r.meta && (r.meta.seasonId ?? r.meta.season_id));

          if (s !== undefined && s !== null && String(s).trim() !== "") return norm(s) === sid;

          // Otherwise, map the round date into a season using seasonsDef date ranges (same as Players Progress)
          const ms = Number.isFinite(Number(r?.dateMs)) ? Number(r.dateMs)
            : (Number.isFinite(Number(r?.parsed?.dateMs)) ? Number(r.parsed.dateMs)
            : (r?.date ? _coerceDateMs(r.date) : NaN));

          if (Number.isFinite(ms)) {
            try {
              const seasonsArr = (typeof window !== "undefined" && window.__dslSeasonsDef) ? window.__dslSeasonsDef : [];
              const mapped = seasonIdForDateMs(ms, seasonsArr);
              if (mapped !== null && mapped !== undefined && String(mapped).trim() !== "") return norm(mapped) === sid;
            } catch (e) { /* ignore */ }
          }

          return false;
        });
      }
      if (limitRaw && limitRaw.toLowerCase() !== "all") {
        const n = Number(limitRaw);
        if (Number.isFinite(n) && n>0) out = out.slice(-n);
      }
      return out;
    }
  if (typeof _bucketSentence !== "function") {
    function _bucketSentence(x){ return String(x?.label || ""); }
  }
  if (typeof _bestWorstSentences !== "function") {
    function _bestWorstSentences(){ return []; }
  }
 
// =========================================================
// FIXED LOGIC: Ensures "Good" stats never appear as "Costs"
// =========================================================
function _keyDriversByImpact(current, field, scoringMode, games) {
  const isGross = scoringMode === "gross";

  // 1) Determine total rounds in sample (divisor)
  const _roundCount = (() => {
    const gNum = Number(games);
    if (Number.isFinite(gNum) && gNum > 0) return gNum;
    if (Array.isArray(games) && games.length) return games.length;

    // Fallback: estimate from total hole count / 18 (only as last resort)
    const t = isGross ? (current?.totalsGross || current?.totals) : current?.totals;
    const totalHoles = PR_num(t?.holes || t?.h || 0, 0);
    return (totalHoles > 0) ? (totalHoles / 18) : 1;
  })();

  const avgFor = (agg) => (isGross ? PR_avgGross(agg) : PR_avgPts(agg));

  // 2) Core truth: per-hole delta (positive = better, regardless of scoring mode)
  const getPerHoleDelta = (meAvg, fldAvg) => {
    if (!Number.isFinite(meAvg) || !Number.isFinite(fldAvg)) return NaN;
    return isGross ? (fldAvg - meAvg) : (meAvg - fldAvg);
  };

  const candidates = [];

  const addBucket = (label, meAgg, fldAgg) => {
    const holesPlayed = PR_num(meAgg?.holes || meAgg?.n || meAgg?.count || 0, 0);
    if (holesPlayed < 12) return; // avoid noise (multi-course / low sample)

    const meAvg = avgFor(meAgg);
    const fldAvg = avgFor(fldAgg);
    const perHole = getPerHoleDelta(meAvg, fldAvg);
    if (!Number.isFinite(perHole)) return;

    // 3) Projection: per-round impact (per-hole gain scaled by how often bucket occurs per round)
    const frequencyPerRound = holesPlayed / (_roundCount > 0 ? _roundCount : 1);
    const impactPerRound = perHole * frequencyPerRound;

    candidates.push({
      label,
      deltaPerHole: perHole,
      holes: holesPlayed,
      impactPerRound
    });
  };

  // helper to map object keys
  const processMap = (meMap, fldMap, prefix = "") => {
    if (!meMap) return;
    Object.keys(meMap).forEach(key => {
      let label = String(key);
      const kLow = String(key).toLowerCase();
      if (prefix === "Par" && !kLow.startsWith("par")) label = `Par ${key}`;
      else if (prefix && !kLow.startsWith(prefix.toLowerCase())) label = `${prefix} ${key}`;
      addBucket(label, meMap[key], fldMap?.[key]);
    });
  };

  processMap(isGross ? current?.byParGross : current?.byPar, isGross ? field?.byParGross : field?.byPar, "Par");
  processMap(isGross ? current?.bySIGross : current?.bySI, isGross ? field?.bySIGross : field?.bySI, "SI");
  processMap(isGross ? current?.byYardsGross : current?.byYards, isGross ? field?.byYardsGross : field?.byYards, "");

  const sorted = candidates.slice().sort((a, b) => a.impactPerRound - b.impactPerRound);

  const helping = sorted.filter(x => x.impactPerRound > 0)
    .sort((a, b) => b.impactPerRound - a.impactPerRound)
    .slice(0, 3);

  const hurting = sorted.filter(x => x.impactPerRound < 0).slice(0, 3);

  return {
    helping,
    hurting,
    // keep existing consumer compatibility
    worstWeighted: hurting
  };
}

// Global helper: average strokes over par per hole from an aggregate {holes, val}
var avgOverParPH = function(agg){
  var h = _num(agg && agg.holes !== undefined ? agg.holes : 0, 0);
  var v = _num(agg && agg.val !== undefined ? agg.val : NaN, NaN);
  return h ? (v / h) : NaN;
};


// --- Helper Shims ---

if (typeof toneSub !== "function") {
  function toneSub(){ return "ok"; }
}
if (typeof _fmtStrokesOverPar !== "function") {
  function _fmtStrokesOverPar(v){ return _fmtOverPar(v); }
}

// Defensive: normalize best/worst sentences helper
if (typeof window !== "undefined" && typeof window._bestWorstSentences !== "undefined" && typeof window._bestWorstSentences !== "function") {
  const bw = window._bestWorstSentences;
  window._bestWorstSentences = () => (Array.isArray(bw) ? bw : (bw ? [bw] : []));
}

// --- Shared handicap preview mode for Reports/Progress/Q&A (independent of leaderboard) ---
// Persists per-browser via localStorage.
function useReportNextHcapMode(defaultMode="den") {
  const KEY = "DEN_REPORT_NEXT_HCAP_MODE";
  const [mode, setModeState] = React.useState(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v || defaultMode;
    } catch (e) {
      return defaultMode;
    }
  });
  const setMode = (next) => {
    const v = String(next || defaultMode);
    setModeState(v);
    try { localStorage.setItem(KEY, v); } catch (e) {}
  };
  return [mode, setMode];
}


const POINTS_TABLE = [20, 17, 15, 13, 11, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const csvEscape = (s) => {
  if (s == null) return "";
  const str = String(s);
  return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
};

const to1 = (x) => Math.round((Number(x) || 0) * 10) / 10;
// --- Name normalisation + fuzzy matching (handles double-spaces / NBSP / small typos) ---
function normalizeName(name) {
  return String(name || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
function lastToken(name) {
  const parts = normalizeName(name).split(" ").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}
function levenshtein(a, b) {
  a = normalizeName(a); b = normalizeName(b);
  if (a === b) return 0;
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  const dp = new Array(m + 1);
  for (let j = 0; j <= m; j++) dp[j] = j;
  for (let i = 1; i <= n; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= m; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[m];
}
function isFuzzyMatch(a, b) {
  const A = normalizeName(a), B = normalizeName(b);
  if (!A || !B) return false;
  if (A === B) return true;
  if (A.includes(B) || B.includes(A)) return true;

  const lnA = lastToken(A), lnB = lastToken(B);
  const d = levenshtein(A, B);
  const len = Math.max(A.length, B.length);

  if (lnA && lnB && lnA === lnB) return d <= (len <= 10 ? 2 : 3);
  return d <= (len <= 8 ? 1 : 2);
}

      function toast(msg) {
        try {
          const t = document.createElement("div");
          t.className =
            "fixed bottom-4 right-4 left-4 md:left-auto md:right-4 px-3 py-2 rounded-lg bg-black text-white text-sm shadow z-50 text-center";
          t.textContent = msg;
          document.body.appendChild(t);
          setTimeout(() => {
            t.style.opacity = "0";
            t.style.transition = "opacity .2s";
            setTimeout(() => t.remove(), 220);
          }, 1400);
        } catch {}
      }

      function LoginModal({ open, onClose, onSubmit, busy }) {
        const [email, setEmail] = useState("");
        const [password, setPassword] = useState("");
        const [err, setErr] = useState("");

        useEffect(() => {
          if (!open) { setEmail(""); setPassword(""); setErr(""); }
        }, [open]);

        if (!open) return null;

        const submit = async (e) => {
          e.preventDefault();
          setErr("");
          const em = (email || "").trim();
          if (!em || !password) { setErr("Enter email + password."); return; }
          try {
            await onSubmit(em, password);
          } catch (ex) {
            setErr(ex?.message || String(ex));
          }
        };

        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40" onClick={onClose} />
            <div className="relative w-full max-w-md glass-card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-extrabold text-squab-900">Admin sign in</div>
                  <div className="text-xs text-neutral-500">Use your Supabase account.</div>
                </div>
                <button className="btn-secondary" type="button" onClick={onClose}>✕</button>
              </div>

              <form className="mt-4 space-y-3" onSubmit={submit}>
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">Email</label>
                  <input
                    className="w-full px-3 py-2 rounded-xl border border-squab-200 bg-white/90 focus:outline-none focus:ring-2 focus:ring-squab-300"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e)=>setEmail(e.target.value)}
                    placeholder="name@example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">Password</label>
                  <input
                    className="w-full px-3 py-2 rounded-xl border border-squab-200 bg-white/90 focus:outline-none focus:ring-2 focus:ring-squab-300"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e)=>setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>

                {err ? (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{err}</div>
                ) : null}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={busy}>
                    {busy ? "Signing in..." : "Sign in"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      }

function AdminPasswordModal({ open, onClose, onSubmit }) {
  const [pw, setPw] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setPw("");
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (!e) return;
      if (e.key === "Escape") onClose && onClose();
      if (e.key === "Enter") onSubmit && onSubmit(pw);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pw, onClose, onSubmit]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[75vh] rounded-t-3xl bg-white border border-neutral-200 shadow-2xl overflow-hidden">
        <div className="p-4 border-b border-neutral-200 bg-white/90 backdrop-blur-md">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black tracking-widest uppercase text-squab-700">Admin</div>
              <div className="text-xl font-black text-neutral-900">Enter password</div>
              <div className="text-xs text-neutral-600 mt-1">Unlocks player management on this device.</div>
            </div>
            <button className="chip border-neutral-200 bg-white text-neutral-700 hover:opacity-90" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="p-4">
          <input
            value={pw}
            onChange={(e)=>setPw(e.target.value)}
            placeholder="Password..."
            type="password"
            className="w-full rounded-2xl border border-neutral-200 px-4 py-3 bg-white"
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={() => onSubmit && onSubmit(pw)}>Unlock</button>
          </div>
          <div className="mt-2 text-[11px] text-neutral-500">
            Tip: set <span className="font-mono">window.DEN_ADMIN_PASSWORD</span> in the file to change the password.
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerVisibilitySheet({ open, onClose, isAdmin, players, hiddenKeys, onSave }) {
  const [q, setQ] = React.useState("");
  const [draftHidden, setDraftHidden] = React.useState([]);
  const fileRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    setQ("");
    setDraftHidden(Array.isArray(hiddenKeys) ? hiddenKeys.slice() : []);
  }, [open, hiddenKeys]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e && e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Note: keep hook order stable; render null only after hooks.

  const rows = React.useMemo(() => {
    const arr = Array.isArray(players) ? players : [];
    const out = arr
      .map(p => {
        const name = String(p?.name || "").trim();
        const key = normalizeName(name);
        return { name, key };
      })
      .filter(r => r.name && r.key);

    // de-dup by key (merge near-identical names)
    const seen = new Set();
    const uniq = [];
    for (const r of out.sort((a,b)=>a.name.localeCompare(b.name))) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
      uniq.push(r);
    }
    return uniq;
  }, [players]);

  const ql = (q || "").toLowerCase().trim();
  const filtered = ql ? rows.filter(r => r.name.toLowerCase().includes(ql)) : rows;

  const hiddenSet = new Set(draftHidden);
  const includedCount = rows.reduce((acc, r) => acc + (hiddenSet.has(r.key) ? 0 : 1), 0);

  function toggleInclude(key, nextIncluded) {
    setDraftHidden(prev => {
      const s = new Set(Array.isArray(prev) ? prev : []);
      if (nextIncluded) s.delete(key);
      else s.add(key);
      return Array.from(s);
    });
  }

  function includeAll() { setDraftHidden([]); }
  function excludeAll() { setDraftHidden(rows.map(r => r.key)); }

function doExport() {
  try {
    const payload = JSON.stringify({ hiddenKeys: Array.from(new Set(draftHidden)) }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "player_visibility.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {}
}

async function onImportFile(e) {
  const f = e?.target?.files?.[0];
  if (!f) return;
  try {
    const txt = await f.text();
    const j = JSON.parse(txt);
    const keys = Array.isArray(j?.hiddenKeys) ? j.hiddenKeys : (Array.isArray(j?.hidden) ? j.hidden : []);
    const cleaned = Array.from(new Set((keys || []).map(x => String(x||"").trim()).filter(Boolean)));
    setDraftHidden(cleaned);
  } catch (err) {
    alert("Could not import file (invalid JSON).");
  } finally {
    try { e.target.value = ""; } catch {}
  }
}

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[92vh] rounded-t-3xl bg-white border border-neutral-200 shadow-2xl overflow-hidden flex flex-col">
        <div className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-neutral-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Admin</div>
              <div className="text-xl font-black text-neutral-900">Player filter</div>
              <div className="text-xs text-neutral-600 mt-1">
                Show only the players you want in leaderboards & reports. You can re‑add anyone anytime.
              </div>
            </div>
            <button className="chip border-neutral-200 bg-white text-neutral-700 hover:opacity-90" onClick={onClose}>Close</button>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[11px] text-neutral-600">
              Showing <span className="font-black">{includedCount}</span> / <span className="font-black">{rows.length}</span> players
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              <button className="chip border-neutral-200 bg-white text-neutral-700" onClick={includeAll}>Include all</button>
              <button className="chip border-neutral-200 bg-white text-neutral-700" onClick={excludeAll}>Exclude all</button>
              <button className="chip border-neutral-200 bg-white text-neutral-700" onClick={doExport} title="Download current visibility list">Export</button>
              <button className="chip border-neutral-200 bg-white text-neutral-700" onClick={() => fileRef.current && fileRef.current.click()} title="Import a previously exported list">Import</button>
              <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={onImportFile} />
            </div>
          </div>

          <div className="mt-3">
            <input
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              placeholder="Search player..."
              className="w-full rounded-2xl border border-neutral-200 px-4 py-2 bg-white"
            />
          </div>
        </div>

        <div className="p-4 overflow-y-auto flex-1 min-h-0">
          {!rows.length ? (
            <div className="text-sm text-neutral-600">No players yet — scan/import some games first.</div>
          ) : (
            <div className="space-y-2">
              {filtered.map((r) => {
                const included = !hiddenSet.has(r.key);
                return (
                  <label key={r.key} className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3">
                    <div className="min-w-0">
                      <div className="font-extrabold text-neutral-900 truncate">{r.name}</div>
                      <div className="text-xs text-neutral-600">{included ? "Included" : "Excluded"}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={(e) => toggleInclude(r.key, e.target.checked)}
                      className="h-5 w-5"
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>

                <div className="border-t border-neutral-200 p-4 flex items-center justify-between gap-3">
          <div className="text-xs text-neutral-600">
            {isAdmin ? "Save publishes to the league." : "Save stores locally on this device (sign in to publish to everyone)."}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button
              className="btn-primary"
              onClick={() => onSave && onSave(draftHidden)}
              title={isAdmin ? "Publish player visibility" : "Save locally"}
            >
              {isAdmin ? "Publish" : "Save locally"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function playingCapByGender(g) {
        return 36;
      }
      function rangeForHcap(h) {
        if (!Number.isFinite(h)) return null;
        if (h <= 9) return "0-9";
        if (h <= 18) return "10-18";
        if (h <= 28) return "19-28";
        return "29-36";
      }
      function cutPerPointOver34(h) {
        const r = rangeForHcap(h);
        return r === "0-9" ? 0.5 : r === "10-18" ? 1 : r === "19-28" ? 1 : 1.5;
      }
      function winnerBonusCut(h) {
        const r = rangeForHcap(h);
        return r === "0-9" ? 1 : r === "10-18" ? 2 : r === "19-28" ? 2.5 : 3;
      }
      function computeNewExactHandicap(start, g, pts, b9, isWinner) {
        const startPlay = Math.round(start);
        let exact = start;

        if (pts >= 35) {
          exact -= cutPerPointOver34(startPlay) * (pts - 34);
        } else if (pts <= 31) {
          exact += 0.5 * (32 - pts);
        }

        if (isWinner) exact -= winnerBonusCut(startPlay);

        const max = playingCapByGender(g);
        const bounded = clamp(exact, 0, 36);
        const nextPlay = clamp(Math.round(bounded), 0, max);

        return {
          nextExact: bounded,
          nextPlaying: nextPlay,
        };
      }

      const isTeamLike = (name) => {
        const s = (name || "").trim();
        return (
          /^players?$/i.test(s) ||
          /^team(\s*\d+)?$/i.test(s) ||
          /^team average$/i.test(s) ||
          /^stableford$/i.test(s) ||
          /^strokeplay$/i.test(s) ||
          /^round\s*\d+$/i.test(s) ||
          /^(out|in|total|s\.i\.|par)$/i.test(s)
        );
      };

// Quote-aware CSV/TSV line splitter (handles commas inside quotes)
function splitSmart(line) {
  if (!line) return [];
  const delim = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out.map(s => s.replace(/^"|"$/g, ""));
}

      function toNum(x) {
        const v = parseFloat(
          String(x == null ? "" : x).replace(/[^0-9.\-]/g, "")
        );
        return Number.isFinite(v) ? v : NaN;
      }

      // Player Report numeric helper (missing in some builds)
      function PR_num(x, fallback){
        const v = toNum(x);
        return Number.isFinite(v) ? v : fallback;
      }

      // =========================================================
      // Benchmarking helpers for multi-course, mixed-handicap fields
      // benchMode: "peerGroup" benchmarks against players in the same handicap band (rangeForHcap)
      // =========================================================
      const benchMode = "peerGroup"; // "peerGroup" | "allField"

      // Safe handicap extractor (handles different data shapes)
      function _hcapOf(p){
  // Robust handicap extractor across different Supabase schemas.
  const keys = [
    "startExact","start_exact","hcap","handicap","playingHcap",
    "handicapIndex","handicap_index","hi","HI","exact","hcp","HCP"
  ];
  const pickFromObj = (o)=>{
    if(!o) return NaN;
    for(const k of keys){
      const v = PR_num(o[k], NaN);
      if(Number.isFinite(v)) return v;
    }
    return NaN;
  };

  try{
    const series = Array.isArray(p?.windowSeries) ? p.windowSeries
                : Array.isArray(p?.roundSeries) ? p.roundSeries
                : Array.isArray(p?.series) ? p.series
                : Array.isArray(p?.rounds) ? p.rounds
                : null;

    if(series && series.length){
      const last = series[series.length-1] || {};
      let v = pickFromObj(last);
      if(Number.isFinite(v)) return Math.round(v*10)/10;

      // Average over series if needed
      let sum=0, n=0;
      for(const r of series){
        const x = pickFromObj(r);
        if(Number.isFinite(x)){ sum+=x; n++; }
      }
      if(n) return Math.round((sum/n)*10)/10;
    }

    // metrics / profile fallbacks
    const mv = PR_num(p?.metrics?.avgHcap,
               PR_num(p?.metrics?.avg_handicap,
               PR_num(p?.avgHcap,
               PR_num(p?.handicapIndex,
               PR_num(p?.handicap_index, NaN)))));
    if(Number.isFinite(mv)) return Math.round(mv*10)/10;

    const v = pickFromObj(p);
    if(Number.isFinite(v)) return Math.round(v*10)/10;
  }catch(e){}
  return NaN;
}
      // Sum/average aggregator maps across a list of players
      function _sumAggMaps(players, prop){
        const out = {};
        (players || []).forEach(p => {
          const m = p?.[prop] || {};
          Object.keys(m).forEach(k => {
            const v = m[k];
            if (!out[k]) out[k] = { sumMe: 0, sumField: 0, holes: 0 };
            out[k].sumMe += PR_num(v?.me, 0);
            out[k].sumField += PR_num(v?.fieldAvg, 0);
            out[k].holes += PR_num(v?.holes, 0);
          });
        });
        // Convert to the shape used by the report: { me, fieldAvg, holes }
        Object.keys(out).forEach(k => {
          const a = out[k];
          const h = Math.max(0, a.holes);
          out[k] = { me: h ? (a.sumMe / h) : 0, fieldAvg: h ? (a.sumField / h) : 0, holes: h };
        });
        return out;
      }


/* ===========================
   WHS Utilities (compliant)
   - Does NOT change CSV playing handicaps / Den rules
   - Only used for WHS preview display (Score Differential + updated HI)
   =========================== */

// Course Handicap (WHS): round(HI * (Slope/113) + (CR - Par))
function WHS_courseHandicap(handicapIndex, slope, courseRating, parTotal){
  const hi = toNum(handicapIndex);
  const sl = toNum(slope);
  const cr = toNum(courseRating);
  const par = toNum(parTotal);
  if (!Number.isFinite(hi) || !Number.isFinite(sl) || sl <= 0 || !Number.isFinite(cr) || !Number.isFinite(par)) return NaN;
  return Math.round(hi * (sl / 113) + (cr - par));
}

// Strokes received on a hole given Course Handicap & SI (1..18)
// Handles CH > 18 by giving everyone base strokes + extra for lowest SIs.
// Note: This is the standard allocation method.
function WHS_strokesReceivedOnHole(courseHcap, holeSI){
  const ch = Math.trunc(toNum(courseHcap));
  const si = Math.trunc(toNum(holeSI));
  if (!Number.isFinite(ch) || !Number.isFinite(si) || si < 1 || si > 18) return 0;
  if (ch <= 0) return 0; // scratch or plus-handicap not supported here (rare in this league context)
  const base = Math.floor(ch / 18);
  const rem = ch % 18;
  return base + (si <= rem ? 1 : 0);
}

// WHS hole cap (Net Double Bogey): max strokes = Par + strokesReceived + 2
function WHS_holeMaxStrokes(par, strokesReceived){
  const p = Math.trunc(toNum(par));
  const sr = Math.trunc(toNum(strokesReceived));
  if (!Number.isFinite(p)) return NaN;
  return p + (Number.isFinite(sr) ? sr : 0) + 2;
}

// Compute Adjusted Gross Score (AGS) for a round from grossPerHole + tee layout (pars + si) and HI.
function WHS_adjustedGrossFromHoleScores(grossPerHole, teeLayout, handicapIndex, slope, courseRating){
  const gph = Array.isArray(grossPerHole) ? grossPerHole : [];
  const pars = Array.isArray(teeLayout?.pars) ? teeLayout.pars : Array.isArray(teeLayout?.par) ? teeLayout.par : [];
  const si = Array.isArray(teeLayout?.si) ? teeLayout.si : Array.isArray(teeLayout?.SI) ? teeLayout.SI : [];
  const parTotal = pars.reduce((a,v)=>a + (Number.isFinite(toNum(v))?toNum(v):0), 0);

  const ch = WHS_courseHandicap(handicapIndex, slope, courseRating, parTotal);
  if (!Number.isFinite(ch)) return NaN;

  let sum = 0;
  let n = 0;
  for (let i=0;i<18;i++){
    const gross = toNum(gph[i]);
    const p = toNum(pars[i]);
    const s = toNum(si[i]);
    if (!Number.isFinite(gross) || !Number.isFinite(p) || p<=0) continue;
    const sr = WHS_strokesReceivedOnHole(ch, s);
    const mx = WHS_holeMaxStrokes(p, sr);
    const adj = Number.isFinite(mx) ? Math.min(gross, mx) : gross;
    sum += adj;
    n += 1;
  }
  // Need enough holes to be meaningful
  return n >= 9 ? sum : NaN;
}

// WHS Score Differential: (AGS - CourseRating - PCC) * 113 / Slope
function WHS_scoreDifferential(ags, slope, courseRating, pcc){
  const A = toNum(ags);
  const sl = toNum(slope);
  const cr = toNum(courseRating);
  const PCC = Number.isFinite(toNum(pcc)) ? toNum(pcc) : 0;
  if (!Number.isFinite(A) || !Number.isFinite(sl) || sl <= 0 || !Number.isFinite(cr)) return NaN;
  return ((A - cr - PCC) * 113) / sl;
}

// WHS Handicap Index from most recent differentials (<=20), using "fewer than 20 scores" rules.
// Returns rounded to 1 decimal.
function WHS_handicapIndexFromDiffs(diffs){
  const ds = (Array.isArray(diffs) ? diffs : []).map(toNum).filter(Number.isFinite);
  const n = ds.length;
  if (n < 3) return NaN;

  // Determine how many lowest diffs to average + any adjustment (only for 3-4 scores)
  let take = 0;
  let adj = 0;
  if (n === 3) { take = 1; adj = -2.0; }
  else if (n === 4) { take = 1; adj = -1.0; }
  else if (n === 5) { take = 1; adj = 0; }
  else if (n === 6) { take = 2; adj = 0; }
  else if (n === 7 || n === 8) { take = 2; adj = 0; }
  else if (n === 9 || n === 10 || n === 11) { take = 3; adj = 0; }
  else if (n === 12 || n === 13 || n === 14) { take = 4; adj = 0; }
  else if (n === 15 || n === 16) { take = 5; adj = 0; }
  else if (n === 17 || n === 18) { take = 6; adj = 0; }
  else if (n === 19) { take = 7; adj = 0; }
  else { take = 8; adj = 0; } // 20+

  const sorted = ds.slice().sort((a,b)=>a-b);
  const chosen = sorted.slice(0, take);
  if (!chosen.length) return NaN;
  const avg = chosen.reduce((s,v)=>s+v,0) / chosen.length;
  const hi = avg + adj;
  // WHS HI rounded to 1 decimal
  return Math.round(hi * 10) / 10;
}

/* ===========================
   Player Report Utilities
   =========================== */


// --- Problem holes (same setup): build from player's round series (Stableford points per hole) ---
function PR_buildProblemHolePack(series){
  if (!Array.isArray(series)) return { ok:false, reason:"no_series" };

  // Group by Course + Tee
  const groups = new Map();
  for (const r of series){
    const courseName = r?.courseName || r?.course || r?.clubName || r?.venueName || "";
    const teeName = r?.teeName || r?.tee || r?.teeLabel || "";
    const k = `${String(courseName)}|${String(teeName)}`;
    if (!groups.has(k)) groups.set(k, { courseName, teeName, rounds: [] });
    groups.get(k).rounds.push(r);
  }
  const best = Array.from(groups.values()).sort((a,b)=> (b.rounds?.length||0) - (a.rounds?.length||0))[0];
  if (!best || (best.rounds?.length||0) < 2) return { ok:false, reason:"need_2_rounds", groups: Array.from(groups.values()) };

  const holes = 18;
  const sums = Array(holes).fill(0);
  const ns   = Array(holes).fill(0);

  for (const r of best.rounds){
    const ph = Array.isArray(r?.perHole) ? r.perHole : (Array.isArray(r?.pointsPerHole) ? r.pointsPerHole : null);
    if (!ph) continue;
    for (let i=0;i<holes;i++){
      const v = Number(ph[i]);
      if (Number.isFinite(v)){
        sums[i] += v;
        ns[i] += 1;
      }
    }
  }

  const avgs = sums.map((s,i)=> (ns[i] ? s/ns[i] : NaN));
  const vals = avgs.filter(Number.isFinite);
  const overall = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : NaN;

  const rows = avgs.map((a,i)=>({
    hole: i+1,
    avg: a,
    vsOverall: (Number.isFinite(a) && Number.isFinite(overall)) ? (a - overall) : NaN,
    samples: ns[i]||0
  })).filter(r=> Number.isFinite(r.avg) && r.samples>0)
    .sort((a,b)=> a.avg - b.avg);

  const flagged = rows.filter(r=> Number.isFinite(r.vsOverall) && r.vsOverall <= -0.5);

  return {
    ok:true,
    courseName: best.courseName || "—",
    teeName: best.teeName || "",
    rounds: best.rounds.length,
    overallAvg: overall,
    flagged,
    rows
  };
}

// Number formatter used by PR_fmt / PlayerProgressView (Safari-safe: top-level)
function fmt(value, a = 0, b) {
  // Supports calls like:
  // fmt(x) -> "12"
  // fmt(x, 1) -> "12.3"
  // fmt(x, { dp: 1, suffix: "%", sign: true })
  // fmt(x, 1, "%") -> "12.3%"

  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";

  // If second argument is an options object
  if (typeof a === "object" && a) {
    const { dp = 0, suffix = "", prefix = "", sign = false } = a;
    const s = n.toFixed(dp);
    const signed = sign && n > 0 ? `+${s}` : s;
    return `${prefix}${signed}${suffix}`;
  }

  // If called like fmt(n, dp, suffix)
  const dp = typeof a === "number" ? a : 0;
  const suffix = typeof b === "string" ? b : "";
  return `${n.toFixed(dp)}${suffix}`;
}


function PR_fmt(v, opts){
  // Safe number formatting for UI (no external deps)
  const n = (v === null || v === undefined || v === "" ? NaN : Number(v));
  if (!Number.isFinite(n)) return "—";

  const o = opts && typeof opts === "object" ? opts : {};
  // Back-compat: allow PR_fmt(x, 2) to mean 2 decimal places
  if (typeof opts === "number" && Number.isFinite(opts)) {
    o.min = opts;
    o.max = opts;
  }
  const min = Number.isFinite(o.min) ? o.min : 0;
  const max = Number.isFinite(o.max) ? o.max : (Number.isFinite(o.dp) ? o.dp : min);
  const sign = o.sign === true;

  try {
    const nf = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    });
    const s = nf.format(n);
    return sign && n > 0 ? `+${s}` : s;
  } catch {
    // Very old browsers fallback
    const dp = max;
    const s = dp ? n.toFixed(dp) : String(Math.round(n));
    return sign && n > 0 ? `+${s}` : s;
  }
}


// Smart signed formatter: shows 3dp for tiny but real deltas (e.g. 0.004), otherwise defaults to 2dp.
function fmtSignedSmart(v, dpDefault=2){
  const x = Number(v);
  if (!Number.isFinite(x)) return "—";
  const ax = Math.abs(x);
  const dp = (ax > 0 && ax < 0.01) ? 3 : dpDefault;
  const s = x > 0 ? "+" : "";
  return s + x.toFixed(dp);
}


function PR_clamp(x, a, b){
  const v = Number(x);
  if (!Number.isFinite(v)) return a;
  return Math.max(a, Math.min(b, v));
}

function PR_avgPts(agg){
  const h = PR_num(agg?.holes, NaN);
  const p = PR_num(agg?.pts, NaN);
  if (!Number.isFinite(h) || h <= 0 || !Number.isFinite(p)) return NaN;
  return p / h;
}

// Gross aggs in this build track strokes-over-par in `val`
function PR_avgGross(agg){
  const h = PR_num(agg?.holes, NaN);
  const v = PR_num(agg?.val, NaN);
  if (!Number.isFinite(h) || h <= 0 || !Number.isFinite(v)) return NaN;
  return v / h;
}

// Return a delta where positive is always "better"
// stableford: higher is better => player - baseline
// gross: lower (less over-par) is better => baseline - player
function PR_goodDelta(mode, playerValue, baselineValue){
  const p = Number(playerValue);
  const b = Number(baselineValue);
  if (!Number.isFinite(p) || !Number.isFinite(b)) return NaN;
  return (String(mode) === "gross") ? (b - p) : (p - b);
}

// Standardise map objects into rows used by Player Report
function PR_buildRawRows({ scoringMode, dim, mapObj, fieldObj, limit }){
  const isGross = String(scoringMode) === "gross";
  const rows = [];
  const keys = Object.keys(mapObj || {});
  for (const k of keys){
    const meAgg = mapObj?.[k];
    const fldAgg = fieldObj?.[k];
    const holes = PR_num(meAgg?.holes, 0);
    if (!holes) continue;

    const playerAvg = isGross ? PR_avgGross(meAgg) : PR_avgPts(meAgg);
    const fieldAvg  = isGross ? PR_avgGross(fldAgg) : PR_avgPts(fldAgg);

    // Labeling rules
    let label = String(k);
    if (dim === "SI") label = `SI ${k}`;
    if (dim === "Par") label = String(k);
    // Yardage keys are typically already bands ("0–120", "121–150") so keep as-is.

    rows.push({ key: String(k), label, holes, playerAvg, fieldAvg });
  }

  // Sort: Par in natural order, SI in natural order, Yardage by numeric start if possible
  const natKey = (s) => {
    const m = String(s).match(/(-?\d+\.?\d*)/);
    return m ? Number(m[1]) : NaN;
  };

  if (dim === "Par"){
    const order = {"Par 3":1,"Par 4":2,"Par 5":3,"Unknown":9};
    rows.sort((a,b)=> (order[a.key]||99) - (order[b.key]||99));
  } else if (dim === "SI"){
    const order = {"1–6":1,"7–12":2,"13–18":3,"Unknown":9,"1-6":1,"7-12":2,"13-18":3};
    rows.sort((a,b)=> (order[a.key]||99) - (order[b.key]||99));
  } else {
    rows.sort((a,b)=>{
      const ax = natKey(a.key), bx = natKey(b.key);
      if (Number.isFinite(ax) && Number.isFinite(bx) && ax !== bx) return ax - bx;
      return a.key.localeCompare(b.key);
    });
  }

  // Optionally keep top-N by holes (useful for very fragmented yardage buckets)
  if (Number.isFinite(Number(limit)) && Number(limit) > 0 && rows.length > Number(limit)){
    rows.sort((a,b)=> (b.holes||0) - (a.holes||0));
    return rows.slice(0, Number(limit));
  }
  return rows;
}

// ===========================
// Shared Delta Bucket Chart (used by Player Progress + Player Report)
// ===========================
function DeltaBucketChart({ title, rows, scoringMode, comparisonMode="field", deepDiveMetric="round", roundCount=1 }) {
  const [reportNextHcapMode, setReportNextHcapMode] = useReportNextHcapMode();
  const isParMode = comparisonMode === "par";
  // "Deep Dive" toggles between raw per-hole truth and per-round projection (Vs Field only)
  const showProjected = (!isParMode && deepDiveMetric === "round");

  const totalH = React.useMemo(() => rows.reduce((a, r) => a + (PR_num(r?.holes, 0) || 0), 0), [rows]);

  // Safeguard round count
  const safeRounds = (roundCount && roundCount > 0)
    ? roundCount
    : (totalH > 0 ? Math.max(1, totalH / 18) : 1); // last-resort fallback

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3">
      <div className="flex justify-between items-center mb-3">
        <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">{title}</div>
        {!isParMode && (
          <div className="text-[10px] text-neutral-400 font-medium">
            {showProjected ? "Impact: per round (projected)" : "Impact: per hole (actual)"}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {rows.map(row => {
          const holes = PR_num(row?.holes, 0);
          const insufficient = holes < 12;

          // 1) Establish baseline
          const baseline = isParMode ? (scoringMode === "gross" ? 0 : 2) : row.fieldAvg;

          // 2) Truth: per-hole delta (positive = better)
          const perHoleDelta = PR_goodDelta(scoringMode, row.playerAvg, baseline);

          // 3) Projection: per-round impact based on actual frequency in sample
          const occurrencePerRound = holes / safeRounds;
          const perRoundDelta = Number.isFinite(perHoleDelta) ? (perHoleDelta * Math.abs(occurrencePerRound)) : NaN;

          // 4) Decide what to display
          const displayValue = (!isParMode && showProjected) ? perRoundDelta : perHoleDelta;

          // Scale bars from the same view the user is looking at
          const valuesForScale = rows.map(r => {
            const b = isParMode ? (scoringMode === "gross" ? 0 : 2) : r.fieldAvg;
            const ph = PR_goodDelta(scoringMode, r.playerAvg, b);
            const occ = (PR_num(r?.holes, 0) || 0) / safeRounds;
            return (!isParMode && showProjected) ? (ph * Math.abs(occ)) : ph;
          }).filter(v => Number.isFinite(v));

          const maxScale = Math.max(0.2, ...valuesForScale.map(v => Math.abs(v)));
          const barFrac = PR_clamp(displayValue / maxScale, -1, 1);

          const barW = Math.abs(barFrac) * 50;
          const barL = barFrac >= 0 ? 50 : (50 - barW);

          // Field marker (Par mode only)
          const fieldDelta = isParMode ? PR_goodDelta(scoringMode, row.fieldAvg, baseline) : 0;
          const fieldFrac = PR_clamp(fieldDelta / maxScale, -1, 1);
          const fieldPos = 50 + (fieldFrac * 50);

          return (
            <div key={row.key} className="flex items-center gap-3">
              <div className="w-16 text-xs font-bold text-neutral-600 truncate" title={row.label}>{row.label}</div>
              <div className="w-10 text-[10px] text-neutral-400 font-mono tabular-nums text-right">{holes}h</div>

              <div className="flex-1 relative h-8 bg-neutral-100 rounded-lg overflow-hidden shadow-inner border border-neutral-200/50">
                {/* Center marker */}
                <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-neutral-300 z-10 opacity-50" />

                {/* Value bar */}
                <div
                  className={`absolute top-0 bottom-0 transition-all duration-500 ease-out ${
                    insufficient
                      ? "bg-neutral-300"
                      : (barFrac >= 0
                          ? "bg-gradient-to-r from-emerald-400 to-emerald-500"
                          : "bg-gradient-to-l from-rose-400 to-rose-500")
                  }`}
                  style={{ left: `${barL}%`, width: `${barW}%` }}
                />

                {/* Par-mode comparator marker */}
                {isParMode && (
                  <div className="absolute top-0 bottom-0 w-0.5 flex items-center justify-center z-20" style={{ left: `${fieldPos}%` }}>
                    <div className="w-2 h-2 bg-neutral-900 rotate-45 transform"></div>
                  </div>
                )}
              </div>

              <div className="w-24 text-right">
                <div className="text-xs tabular-nums font-medium text-neutral-700">
                  {insufficient ? "—" : ((displayValue >= 0 ? "+" : "") + (showProjected ? PR_fmt(displayValue, 1) : PR_fmt(displayValue, (Math.abs(displayValue) > 0 && Math.abs(displayValue) < 0.01) ? 3 : 2)))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Pick top strengths and leaks by per-hole delta (vs field)
function PR_pickExtremes(scoringMode, rows, n=1){
  const out = (rows||[]).map(r=>{
    const d = PR_goodDelta(scoringMode, r.playerAvg, r.fieldAvg);
    return { ...r, delta: d };
  }).filter(r=>Number.isFinite(r.delta) && (r.holes||0) >= 4);

  const strengths = out.slice().sort((a,b)=>b.delta-a.delta).slice(0, n);
  const leaks     = out.slice().sort((a,b)=>a.delta-b.delta).slice(0, n);
  return { strengths, leaks };
}

// Pick the worst weighted leak in "per round" terms
function PR_pickWorstWeighted(scoringMode, rows, roundCount=0){
  const rr = Array.isArray(rows) ? rows : [];
  const totalH = rr.reduce((a,r)=>a + (PR_num(r?.holes,0) || 0), 0) || 0;
  if (!totalH) return null;

  const weighted = rr.map(r=>{
    const d = PR_goodDelta(scoringMode, r.playerAvg, r.fieldAvg);
    const holes = PR_num(r?.holes,0);
    if (!Number.isFinite(d) || !holes) return null;
    const exposure = (roundCount && roundCount > 0) ? (holes / roundCount) : ((holes / totalH) * 18); // holes per round
    const perRound = d * exposure;
    return { ...r, delta: d, perRound };
  }).filter(Boolean);

  if (!weighted.length) return null;
  // worst = most negative perRound
  return weighted.sort((a,b)=>a.perRound-b.perRound)[0];
}

/* ===========================
   Player Report UI Blocks
   (Some builds referenced these components but did not define them.)
   =========================== */

// A small 3-card "story" strip under the Player Report hero.
const StoryDeck = ({ current, scoringMode, rawPar, rawSI, rawYd }) => {
  const all = [...(rawPar || []), ...(rawSI || []), ...(rawYd || [])];
  const { strengths, leaks } = PR_pickExtremes(scoringMode, all, 1);
  const best = strengths?.[0];
  const worst = leaks?.[0];
  const worstWeighted = PR_pickWorstWeighted(scoringMode, all);

  const Card = ({ tag, title, value, sub, good }) => (
    <div className="rounded-3xl border border-neutral-200 bg-white shadow-sm p-4 md:p-5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-black tracking-widest uppercase text-neutral-400">{tag}</div>
        {typeof good === "boolean" ? (
          <span className={`text-[10px] font-black tracking-widest uppercase ${good ? "text-emerald-600" : "text-rose-600"}`}>{good ? "GOOD" : "LEAK"}</span>
        ) : null}
      </div>
      <div className="mt-2 text-lg md:text-xl font-black tracking-tight text-neutral-900 truncate">{title}</div>
      <div className={`mt-2 text-2xl md:text-3xl font-black tabular-nums ${good === false ? "text-rose-600" : "text-emerald-600"}`}>{value}</div>
      {sub ? <div className="mt-1 text-[11px] text-neutral-500">{sub}</div> : null}
    </div>
  );

  const fmtDelta = (d) => {
    if (!Number.isFinite(d)) return "—";
    const s = d >= 0 ? "+" : "";
    return s + PR_fmt(d, 2);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <Card
        tag="Best Area"
        title={best?.label || "—"}
        value={fmtDelta(best?.delta)}
        sub="per hole vs field"
        good={true}
      />
      <Card
        tag="Biggest Leak"
        title={worst?.label || "—"}
        value={fmtDelta(worst?.delta)}
        sub="per hole vs field"
        good={false}
      />
      <Card
        tag="Costs You Most"
        title={worstWeighted?.label || "—"}
        value={Number.isFinite(worstWeighted?.perRound) ? PR_fmt(worstWeighted.perRound, 2) : "—"}
        sub="per round vs field"
        good={false}
      />
    </div>
  );
};

// A compact scouting panel: hard numbers, low clutter.
const ScoutingReport = (props) => {
  const {
    scoringMode,
    games,
    overallVsFieldPerRound,
    velocity,
    volatility,
    reportNextHcapMode,
    setReportNextHcapMode,
  } = props || {};
  const isGross = String(scoringMode) === "gross";
  const unit = isGross ? "strokes" : "pts";

  // Dynamic color for the "Big Number"
  const isGood = overallVsFieldPerRound >= 0;
  const mainColor = isGood ? "text-emerald-600" : "text-rose-600";
  const trendIcon = velocity > 0 ? "↗" : velocity < 0 ? "↘" : "→";

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      {/* 1. The Big Metric Card */}
      <div className="md:col-span-2 relative overflow-hidden rounded-3xl bg-neutral-900 text-white p-6 shadow-xl">
        <div className="absolute top-0 right-0 -mr-8 -mt-8 w-48 h-48 bg-emerald-500 rounded-full blur-3xl opacity-20"></div>

        <div className="relative z-10 flex flex-col justify-between h-full">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-1">Performance vs Field</div>
            <div className="text-5xl font-black tracking-tighter">
              {overallVsFieldPerRound > 0 ? "+" : ""}{Number.isFinite(overallVsFieldPerRound) ? overallVsFieldPerRound.toFixed(1) : "—"}
              <span className="text-lg font-medium text-neutral-400 ml-2">{unit}/rd</span>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-6">
            <div>
              <div className="text-[10px] uppercase text-neutral-500 font-bold">Trend</div>
              <div className="text-xl font-bold flex items-center gap-1">
                {trendIcon} {Number.isFinite(velocity) ? Math.abs(velocity).toFixed(2) : "—"}
              </div>
            </div>
            <div className="w-px h-8 bg-neutral-800"></div>
            <div>
              <div className="text-[10px] uppercase text-neutral-500 font-bold">Consistency</div>
              <div className="text-xl font-bold">
                {Number.isFinite(volatility) ? volatility.toFixed(1) : "—"} <span className="text-xs font-normal text-neutral-500">σ</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. The Sample Context Card */}
      <div className="rounded-3xl border border-neutral-200 bg-white p-6 flex flex-col justify-center items-center text-center shadow-sm">
        <div className="text-4xl mb-2">📊</div>
        <div className="text-2xl font-black text-neutral-900">{games}</div>
        <div className="text-xs font-bold uppercase tracking-widest text-neutral-400">Rounds Analysed</div>
      </div>
    </div>
  );
};

// A tiny what-if: if you halve your biggest leak, what does it do?
const WhatIfSimulatorA = () => null;

function readStablefordPerHole(row) {
        if (!row || !row.length) return new Array(18).fill(NaN);

        let tokenIdx = -1;
        for (let i = 0; i < row.length; i++) {
          if (String(row[i]).trim().toLowerCase() === "stableford") { tokenIdx = i; break; }
        }
        if (tokenIdx < 0) return new Array(18).fill(NaN);

        // Layout: [ "", "Stableford", "<strokes received>", H1..H9, OUT, H10..H18, IN, TOTAL ]
        const holeStart = tokenIdx + 2;

        // Stableford points are 0..6, pickups are 0 points but still played.
        const vals = _read18HoleBlock(row, holeStart, { min: 0, max: 6, intMode: false, pickupAsZero: true });

        return vals;
      }

      function readBestBallPerHole(row) {
        if (!row || !row.length) return new Array(18).fill(NaN);

        let tokenIdx = -1;
        for (let i = 0; i < row.length; i++) {
          if (String(row[i]).trim().toLowerCase() === "best ball") { tokenIdx = i; break; }
        }
        if (tokenIdx < 0) return new Array(18).fill(NaN);

        const holeStart = tokenIdx + 2;

        // Best Ball points are also 0..6
        const vals = _read18HoleBlock(row, holeStart, { min: 0, max: 6, intMode: false, pickupAsZero: true });

        return vals;
      }

      function parseMultiTeeCourseLayout(lines, startIdx) {
        let courseName = "";
        const tees = [];
        let i = startIdx + 1;
        while (i < lines.length) {
          const row = lines[i] || [];
          const key = (row[0] || "").trim().toLowerCase();
          if (!key) { i++; continue; }
          if (key === "courselayout") break;
          if (key === "course") {
            courseName = (row[1] || "").trim() || courseName;
            i++; continue;
          }
          if (key === "tee") {
            const teeName = (row[1] || "").trim();
            const genderRaw = (row[2] || "").trim().toUpperCase();
            const gender = genderRaw === "F" ? "F" : "M";
            const header = lines[i + 1] || [];
            const hKey = (header[0] || "").trim().toLowerCase();
            if (hKey !== "hole") { i++; continue; }
            const colPar = header.findIndex(c => String(c).trim().toLowerCase() === "par");
            const colYards = header.findIndex(c => String(c).trim().toLowerCase() === "yards");
            const colSI = header.findIndex(c => String(c).trim().toLowerCase() === "si");
            if (colYards < 0 || colPar < 0 || colSI < 0) { i += 2; continue; }
            const holes = Array(18).fill(null).map((_, idx) => ({ hole: idx + 1, par: 0, yards: 0, si: 0 }));
            let j = i + 2;
            while (j < lines.length) {
              const r = lines[j] || [];
              const first = (r[0] || "").trim().toLowerCase();
              if (!first || first === "tee" || first === "course" || first === "courselayout") break;
              const h = parseInt(r[0], 10);
              if (!Number.isFinite(h) || h < 1 || h > 18) break;
              holes[h - 1] = {
                 hole: h,
                 par: parseInt(r[colPar] || "0", 10),
                 yards: parseInt(r[colYards] || "0", 10),
                 si: parseInt(r[colSI] || "0", 10)
              };
              j++;
            }
            tees.push({ teeName, gender, pars: holes.map(h=>h.par), yards: holes.map(h=>h.yards), si: holes.map(h=>h.si) });
            i = j; continue;
          }
          i++;
        }
        if (!tees.length) return null;
        return { courseName, tees };
      }

      function parseSimpleCourseLayout(lines, startIdx) {
        let headerIdx = -1;
        for (let i = startIdx + 1; i < lines.length; i++) {
          const row = lines[i] || [];
          const first = (row[0] || "").trim().toLowerCase();
          if (!first) continue;
          if (first === "courselayout") break;
          if (first === "hole") { headerIdx = i; break; }
        }
        if (headerIdx < 0) return null;
        const header = lines[headerIdx].map((h) => String(h || ""));
        const norm = (s) => s.replace(/\s+/g, "").toLowerCase();
        const idxMensYards = header.findIndex((c) => norm(c) === "mensyards");
        const idxMensPar = header.findIndex((c) => norm(c) === "menspar");
        const idxMensSI = header.findIndex((c) => norm(c) === "menssi");
        const idxWomYards = header.findIndex((c) => norm(c) === "womensyards" || norm(c) === "ladiesyards");
        const idxWomPar = header.findIndex((c) => norm(c) === "womenspar" || norm(c) === "ladiespar");
        const idxWomSI = header.findIndex((c) => norm(c) === "womenssi" || norm(c) === "ladiessi");
        if (idxMensYards < 0 || idxMensPar < 0 || idxMensSI < 0) return null;
        
        const holesMen = Array(18).fill(null).map((_, idx) => ({ hole: idx + 1, par: 0, yards: 0, si: 0 }));
        const holesWom = Array(18).fill(null).map((_, idx) => ({ hole: idx + 1, par: 0, yards: 0, si: 0 }));
        
        let i = headerIdx + 1;
        while (i < lines.length) {
          const row = lines[i] || [];
          const first = (row[0] || "").trim().toLowerCase();
          if (!first || first === "courselayout") break;
          const h = parseInt(row[0], 10);
          if (!Number.isFinite(h) || h < 1 || h > 18) break;
          holesMen[h - 1] = { hole: h, par: parseInt(row[idxMensPar]||0), yards: parseInt(row[idxMensYards]||0), si: parseInt(row[idxMensSI]||0) };
          if (idxWomPar >= 0) holesWom[h - 1] = { hole: h, par: parseInt(row[idxWomPar]||0), yards: parseInt(row[idxWomYards]||0), si: parseInt(row[idxWomSI]||0) };
          i++;
        }
        const tees = [{ teeName: "Men", gender: "M", pars: holesMen.map(h=>h.par), yards: holesMen.map(h=>h.yards), si: holesMen.map(h=>h.si) }];
        if (idxWomPar >= 0 && holesWom.some(h=>h.par>0)) {
           tees.push({ teeName: "Women", gender: "F", pars: holesWom.map(h=>h.par), yards: holesWom.map(h=>h.yards), si: holesWom.map(h=>h.si) });
        }
        return { courseName: "", tees };
      }

      function parseCourseLayout(lines) {
        let startIdx = -1;
        for (let i = 0; i < lines.length; i++) {
          if ((lines[i][0] || "").trim().toLowerCase() === "courselayout") { startIdx = i; break; }
        }
        if (startIdx < 0) return null;
        let hasTee = false;
        for (let i = startIdx + 1; i < lines.length; i++) {
          const first = (lines[i][0] || "").trim().toLowerCase();
          if (first === "tee") { hasTee = true; break; }
          if (first === "courselayout") break;
        }
        return hasTee ? parseMultiTeeCourseLayout(lines, startIdx) : parseSimpleCourseLayout(lines, startIdx);
      }

      function chooseTeeForPlayer(player, courseTees) {
        if (!courseTees || !courseTees.length) return null;
        const label = (player.teeLabel || "").toLowerCase();
        const gender = (player.gender || "M").toUpperCase();
        if (label) {
          let t = courseTees.find((tt) => (tt.teeName || "").toLowerCase() === label);
          if (t) return t;
          t = courseTees.find((tt) => {
            const n = (tt.teeName || "").toLowerCase();
            return n && (n.includes(label) || label.includes(n));
          });
          if (t) return t;
        }
        let t = courseTees.find((tt) => (tt.gender || "M").toUpperCase() === gender);
        return t || null;
      }

      function parseSquabbitCSV(text) {
        const rows = text.replace(/\r/g, "").split("\n");
        const lines = rows.map(splitSmart);

        let internalCourseName = "";
        let scorecardHeaderIdx = -1;
        for (let i = 0; i < lines.length; i++) {
           const rowStr = lines[i].join("").toLowerCase();
           if (rowStr.includes("hole 1") && rowStr.includes("hole 18")) {
             scorecardHeaderIdx = i;
             break;
           }
        }
        if (scorecardHeaderIdx > 0) {
           for (let k = scorecardHeaderIdx - 1; k >= 0; k--) {
             const cell = (lines[k][0] || "").trim();
             if (cell && !/round\s*\d+/i.test(cell) && !/stableford|strokeplay/i.test(cell)) {
                 const rowJoin = (lines[k] || []).join(" ");
                 const hasDate = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(rowJoin) && /\b20\d{2}\b/.test(rowJoin);
                 const prev = k > 0 ? String((lines[k-1] && lines[k-1][0]) || "").trim() : "";
                 let name = cell;
                 if (hasDate && prev && !/round\s*\d+/i.test(prev) && !/stableford|strokeplay/i.test(prev)) {
                   const noSpace = /[a-z]$/.test(prev) && /^[a-z]/.test(cell);
                   name = noSpace ? (prev + cell) : (prev + " " + cell);
                 }
                 internalCourseName = name;
                 break;
             }
           }
        }

        let parsedPars = null;
        let parsedSIs = null;
        for (let i = 0; i < lines.length; i++) {
          const row = lines[i];
          const k0 = String(row[0] || "").trim().toLowerCase();
          if (k0 === "s.i." || k0 === "si" || k0 === "s.i" ) {
            const nums = [];
            for (let j = 3; j < row.length; j++) {
              const n = parseInt(String(row[j] || "").trim(), 10);
              if (!Number.isNaN(n)) nums.push(n);
            }
            if (nums.length >= 19) parsedSIs = nums.slice(0, 9).concat(nums.slice(10, 19));
            else if (nums.length === 18) parsedSIs = nums.slice(0, 18);
          }
        }

        for (let i = 0; i < lines.length; i++) {
          const row = lines[i];
          if ((row[0] || "").trim().toLowerCase() === "par") {
            const nums = [];
            for (let j = 3; j < row.length; j++) {
              const n = parseInt(String(row[j] || "").trim(), 10);
              if (!Number.isNaN(n)) nums.push(n);
            }
            if (nums.length >= 19) parsedPars = nums.slice(0, 9).concat(nums.slice(10, 19));
            else if (nums.length === 18) parsedPars = nums.slice(0, 18);
            break;
          }
        }

        let layoutRaw = null;
        try { layoutRaw = parseCourseLayout(lines); } catch(e) {}

        const tees = (layoutRaw && layoutRaw.tees) ? layoutRaw.tees.map((t) => {
          let pars = t.pars || [];
          if (!pars || pars.length !== 18 || pars.every((p) => !p)) {
            if (parsedPars && parsedPars.length === 18) pars = parsedPars.slice();
          }
          return {
            teeName: t.teeName || "",
            gender: (t.gender || "M").toUpperCase(),
            pars,
            yards: t.yards || [],
            si: (t.si && t.si.length===18 ? t.si : (parsedSIs && parsedSIs.length===18 ? parsedSIs.slice() : [])),
          };
        }) : [];

        
        // --- Players: parse Name/Hdcp + (if present) Gender/Tee columns ---
        const normGender = (g) => {
          const v = String(g || "").trim().toLowerCase();
          if (!v) return "";
          if (v === "m" || v === "male" || v === "man" || v === "men" || v === "gents" || v === "gent") return "M";
          if (v === "f" || v === "female" || v === "woman" || v === "women" || v === "ladies" || v === "lady") return "F";
          return "";
        };

        const findColIdx = (row, candidates) => {
          const cells = (row || []).map((x) => String(x || "").trim().toLowerCase());
          for (const c of candidates) {
            const idx = cells.findIndex((t) => t === c || t.replace(/\s+/g, "") === c.replace(/\s+/g, ""));
            if (idx >= 0) return idx;
          }
          return -1;
        };

        let playerHeaderRow = -1;
        let idxName = 0, idxHdcp = 1, idxGender = -1, idxTee = -1;

        for (let i = 0; i < lines.length; i++) {
          const row = lines[i];
          if (!row || !row.length) continue;

          const nameIdx = findColIdx(row, ["name", "player", "player name", "playername"]);
          const hdcpIdx = findColIdx(row, ["hdcp", "handicap", "hcp"]);
          if (nameIdx >= 0 && hdcpIdx >= 0) {
            playerHeaderRow = i;
            idxName = nameIdx;
            idxHdcp = hdcpIdx;

            // Optional columns (won't exist on older exports)
            idxGender = findColIdx(row, ["gender", "sex"]);
            idxTee = findColIdx(row, ["tee", "teelabel", "tee label", "tee name", "teename"]);
            break;
          }
        }

        const players = [];
        if (playerHeaderRow >= 0) {
          for (let i = playerHeaderRow + 1; i < lines.length; i++) {
            const row = lines[i];
            if (!row) break;

            const name = (row[idxName] || "").trim();
            if (!name) break;
            if (isTeamLike(name) || /^player$/i.test(name)) continue;

            const hcap = parseFloat(String(row[idxHdcp] || "").trim());
            if (Number.isNaN(hcap)) continue;

            const g = idxGender >= 0 ? normGender(row[idxGender]) : "";
            const tee = idxTee >= 0 ? String(row[idxTee] || "").trim() : "";

            // Defaults preserve old behaviour, but allow explicit CSV fields to override
            players.push({
              name,
              handicap: hcap,
              gender: g || "M",
              teeLabel: tee || ""
            });
          }
        }

        // --- Fallback heuristic: if export didn't include Gender/Tee in the player block ---
        // Try to infer tee labels and genders from anywhere in the file (legacy exports).
        const genderMap = {};
        const teeLabelMap = {};
        const looksLikeTeeLabel = (s) => {
          const v = String(s || "").trim();
          if (!v) return false;
          // Avoid leaderboard numbers like "21" / "15"
          if (/^[+-]?\d+(?:\.\d+)?$/.test(v)) return false;
          const t = v.toLowerCase();
          return /tee|white|yellow|red|blue|black|green|gold|silver|champ|championship|mens|men|gents|ladies|women|forward|back/.test(t);
        };

        for (let r = 0; r < lines.length; r++) {
          const row = lines[r];
          if (!row) continue;
          const nm = (row[0] || "").trim();
          if (!nm) continue;

          // Check a few early columns (exports vary)
          for (let c = 1; c <= 4; c++) {
            const cell = (row[c] || "").trim();
            if (!cell) continue;
            if (looksLikeTeeLabel(cell) && !teeLabelMap[nm]) teeLabelMap[nm] = cell;
            const cellLower = cell.toLowerCase();
            if (/women|ladies/.test(cellLower)) genderMap[nm] = "F";
          }
          if (genderMap[nm] == null) genderMap[nm] = "M";
        }

        for (const p of players) {
          if (!p.gender && genderMap[p.name]) p.gender = genderMap[p.name];
          if (!p.teeLabel && teeLabelMap[p.name]) p.teeLabel = teeLabelMap[p.name];
        }


        if (typeof window !== "undefined" && window.__SMART_ODDS_DEBUG) {
          console.log("[PARSE CSV PLAYERS]", {
            count: players.length,
            sample: players.slice(0, 5).map(p => ({ name: p.name, handicap: p.handicap, gender: p.gender, teeLabel: p.teeLabel }))
          });
        }

// Build a minimal tee layout when CourseLayout is missing.
        // Uses Par + SI from the scorecard, and tee labels found inside the CSV (e.g., "66 tee").
        let teesFinal = tees;
        if ((!teesFinal || !teesFinal.length) && parsedPars && parsedPars.length === 18) {
          const labels = Array.from(new Set(players.map(p => String(p.teeLabel || "").trim()).filter(Boolean)));
          const useLabels = labels.length ? labels : ["Default tee"];
          teesFinal = useLabels.map((lbl) => ({
            teeName: lbl,
            gender: /women|ladies|red\b/.test(String(lbl).toLowerCase()) ? "F" : "M",
            pars: parsedPars.slice(),
            yards: [],
            si: (parsedSIs && parsedSIs.length === 18) ? parsedSIs.slice() : [],
          }));
        }

        let totalsStart = -1;
        for (let i = 0; i < lines.length; i++) {
          if ((lines[i][0] || "").trim().toLowerCase() === "stableford") { totalsStart = i; break; }
        }
        const totals = {};
        if (totalsStart >= 0) {
          for (let i = totalsStart + 2; i < lines.length; i++) {
            const row = lines[i];
            if (!row) break;
            const name = (row[0] || "").trim();
            if (!name || name === "..." || /^round\s*\d+/i.test(name) || /^(player)$/i.test(name) || isTeamLike(name)) break;
            const numeric = [];
            for (let j = 1; j < row.length; j++) {
              const v = toNum(row[j]);
              if (Number.isFinite(v)) numeric.push(v);
            }
            if (!numeric.length) continue;
            totals[name] = numeric[numeric.length - 1];
            if (!players.some((p) => p.name === name)) {
              players.push({ name, handicap: 0, gender: genderMap[name] || "M", teeLabel: teeLabelMap[name] || "" });
            }
          }
        }

const holeData = {};
        // --- Robust player-block parsing (no magic row offsets) ---
        const playerNames = players.map(pp => (pp.name || "").trim()).filter(Boolean);

        const isLikelyScoreRow = (row, name) => {
          if (!row) return false;
          if ((row[0] || "").trim() !== name) return false;

          // Critical guard: score rows have a tee label in column 2 (e.g. "66 tee").
          const tee = String(row[1] || "").trim().toLowerCase();
          if (!tee || !tee.includes("tee")) return false;

          // Count plausible stroke numbers in the hole area (ignore currency/fees rows etc).
          let nums = 0;
          for (let j = 3; j < row.length; j++) {
            const raw = String(row[j] ?? "").trim();
            if (!raw) continue;
            if (raw.includes("£")) continue;
            const n = parseInt(raw.replace(/[^0-9\-]/g, ""), 10);
            if (Number.isFinite(n) && n >= 1 && n <= 19) nums++;
          }
          // 9-hole cards still pass (>=6 on first 9 is fine); 18-hole will easily exceed.
          return nums >= 6;
        };

        const rowHasToken = (row, token) =>
          Array.isArray(row) &&
          row.some((c) => String(c || "").trim().toLowerCase() === token);

        const rowHasBestBall = (row) =>
          Array.isArray(row) &&
          row.some((c) => String(c || "").trim().toLowerCase().replace(/\s+/g, "") === "bestball");

        const findPlayerBlockStart = (name) => {
          const startScan = (scorecardHeaderIdx >= 0 ? scorecardHeaderIdx : 0);
          for (let i = startScan; i < lines.length; i++) {
            if (isLikelyScoreRow(lines[i], name)) return i;
          }
          return -1;
        };

        const findPlayerBlockEnd = (startIdx, currentName) => {
          for (let i = startIdx + 1; i < lines.length; i++) {
            const first = (lines[i]?.[0] || "").trim();
            if (!first) continue;

            // Next player block?
            if (first !== currentName && playerNames.includes(first) && isLikelyScoreRow(lines[i], first)) return i;

            // Hard section boundaries
            const firstLower = first.toLowerCase();
            if (firstLower === "stableford" || firstLower === "courselayout") return i;
          }
          return lines.length;
        };

        const findRowInBlock = (startIdx, endIdx, predicate) => {
          for (let i = startIdx; i < endIdx; i++) {
            const r = lines[i];
            if (predicate(r)) return r;
          }
          return null;
        };

        for (const p of players) {
          const startIdx = findPlayerBlockStart(p.name);
          if (startIdx < 0) {
            console.warn("[parseSquabbitCSV] Player block not found:", p.name);
            holeData[p.name] = {
              perHole: Array(18).fill(0),
              back9: 0,
              hcapCard: NaN,
              totalFromCard: NaN,
              grossPerHole: Array(18).fill(NaN),
              bestBallPerHole: null,
              bestBallHcapCard: NaN
            };
            continue;
          }

          const endIdx = findPlayerBlockEnd(startIdx, p.name);
          const scoreRow = lines[startIdx] || [];

          // --- Gross strokes per hole from the score row ---
// Supports two common CSV shapes:
//  1) Explicit "Gross" token row (rare)
//  2) Player score row itself contains gross strokes: Name, Tee, Hdcp, H1..H18, OUT, H10..H18, IN, TOTAL (common)
          const readGrossPerHole = (row) => {
            if (!row || !row.length) return new Array(18).fill(NaN);

            // Two shapes:
            //  1) Player score row: Name, Tee, Hcp, H1..H9, OUT, H10..H18, IN, TOTAL
            //  2) Token row containing "Gross": [..., "Gross", <strokes?>, H1.., ...]
            let tokenIdx = -1;
            for (let i = 0; i < row.length; i++) {
              if (String(row[i]).trim().toLowerCase() === "gross") { tokenIdx = i; break; }
            }

            // Player rows almost always start holes at index 3.
            let holeStart = 3;

            if (tokenIdx >= 0) {
              // In token rows (rare), layout usually: "", "Gross", "<something>", H1...
              // so Hole1 is typically tokenIdx+2.
              holeStart = tokenIdx + 2;
            }

            const vals = _read18HoleBlock(row, holeStart, { min: 1, max: 19, intMode: true, pickupAsZero: false });

            return vals;
          };

          let grossPerHole = Array(18).fill(NaN);

          // --- Stableford row (identified by token, not by offset) ---
          let stRowIdx = -1;
          for (let i = startIdx + 1; i < endIdx; i++) {
            if (rowHasToken(lines[i], "stableford")) { stRowIdx = i; break; }
          }
          const stRow = stRowIdx >= 0 ? lines[stRowIdx] : null;

          let perHole = Array(18).fill(0);
          let hcapCard = NaN;
          let totalFromCard = NaN;

          if (stRow) {
            perHole = readStablefordPerHole(stRow) || Array(18).fill(0);

            let stIndex = -1;
            for (let j = 0; j < stRow.length; j++) {
              if (String(stRow[j]).trim().toLowerCase() === "stableford") { stIndex = j; break; }
            }
            if (stIndex >= 0) {
              hcapCard = toNum(stRow[stIndex + 1]);
              for (let j = stRow.length - 1; j > stIndex; j--) {
                const v = toNum(stRow[j]);
                if (Number.isFinite(v)) { totalFromCard = v; break; }
              }
            }
          }

          // Gross strokes MUST come from the CSV score row (row above Stableford when present)
          const grossRow = (stRowIdx > startIdx ? (lines[stRowIdx - 1] || scoreRow) : scoreRow);
          grossPerHole = readGrossPerHole(grossRow) || Array(18).fill(NaN);

          // --- Best Ball row (optional; identified by token, not by offset) ---
          const bbRow = findRowInBlock(startIdx + 1, endIdx, (r) => rowHasBestBall(r));
          let bestBallPerHole = null;
          let bestBallHcapCard = NaN;

          if (bbRow) {
            bestBallPerHole = readBestBallPerHole(bbRow);
            // find the cell containing best ball token and read the next cell as course handicap
            let bbIndex = -1;
            for (let j = 0; j < bbRow.length; j++) {
              const s = String(bbRow[j] || "").trim().toLowerCase().replace(/\s+/g, "");
              if (s === "bestball") { bbIndex = j; break; }
            }
            if (bbIndex >= 0) bestBallHcapCard = toNum(bbRow[bbIndex + 1]);
          }

          const back9 = (perHole || []).slice(9).reduce((a, b) => a + (Number(b) || 0), 0);

          holeData[p.name] = {
            perHole,
            back9,
            hcapCard,
            totalFromCard,
            grossPerHole,
            bestBallPerHole,
            bestBallHcapCard
          };
        }
const finalPlayers = players.filter(p => p.name && !/^player$/i.test(p.name.trim()) && !isTeamLike(p.name)).map((p) => {
          const card = holeData[p.name] || {};
          let handicap = Number.isFinite(p.handicap) ? p.handicap : NaN;
          if (!Number.isFinite(handicap) || handicap <= 0) handicap = Number.isFinite(card.hcapCard) ? card.hcapCard : 0;
          let points = 0;
          if (Number.isFinite(totals[p.name])) points = totals[p.name];
          else if (Number.isFinite(card.totalFromCard)) points = card.totalFromCard;
          return {
            name: p.name,
            gender: p.gender || genderMap[p.name] || "M",
            teeLabel: p.teeLabel || teeLabelMap[p.name] || "",
            handicap,
            points,
            back9: card.back9 || 0,
            perHole: card.perHole || [],
            grossPerHole: card.grossPerHole || Array(18).fill(NaN),
            courseHandicap: Number.isFinite(card.hcapCard) ? card.hcapCard : handicap,
            bestBallPerHole: card.bestBallPerHole || null,
            bestBallCourseHandicap: card.bestBallHcapCard,
            pars: parsedPars || null,
            sis: parsedSIs || null,
          };
        });

        const detectedCourseName = internalCourseName || (layoutRaw ? layoutRaw.courseName : "");

        // --- WHS-style completion: fill missing hole scores as Net Double Bogey (NDB) ---
        // Applies only to PARTIAL rounds (at least 1 hole recorded). Does NOT fabricate a round for non-starters.
        try {
          const eventHoles = (() => {
            let h = 9;
            for (const pl of (finalPlayers || [])) {
              const ph = Array.isArray(pl?.perHole) ? pl.perHole : null;
              const gh = Array.isArray(pl?.grossPerHole) ? pl.grossPerHole : null;
              for (let i = 9; i < 18; i++) {
                const pts = ph ? Number(ph[i]) : NaN;
                const g   = gh ? Number(gh[i]) : NaN;
                if (Number.isFinite(pts) || Number.isFinite(g)) { h = 18; break; }
              }
              if (h === 18) break;
            }
            return h;
          })();
        
          function _strokesRec(courseHcp, si) {
            const ch = Math.max(0, Math.round(Number(courseHcp) || 0));
            const s = Number(si);
            if (!Number.isFinite(s) || s <= 0) return 0;
            const full = Math.floor(ch / 18);
            const rem = ch % 18;
            return full + ((rem > 0 && s <= rem) ? 1 : 0);
          }
          function _ndb(par, courseHcp, si) {
            const p = Number.isFinite(Number(par)) ? Number(par) : 4;
            const s = Number.isFinite(Number(si))  ? Number(si)  : 1;
            return p + _strokesRec(courseHcp, s) + 2;
          }
        
          for (const pl of (finalPlayers || [])) {
            const ph = Array.isArray(pl?.perHole) ? pl.perHole.slice() : new Array(18).fill(NaN);
            const gh = Array.isArray(pl?.grossPerHole) ? pl.grossPerHole.slice() : new Array(18).fill(NaN);
            const imputed = new Array(18).fill(false);
        
            // Only impute if the player has at least one recorded hole in the played segment
            let anyRecorded = false;
            for (let i = 0; i < eventHoles; i++) {
              const pts = Number(ph[i]);
              const g = Number(gh[i]);
              if (Number.isFinite(pts) || (Number.isFinite(g) && g > 0)) { anyRecorded = true; break; }
            }
            if (!anyRecorded) {
              pl.imputedMask = imputed;
            pl.imputedGrossPerHole = gh;
              continue;
            }
        
            // Get par/SI arrays (prefer player's, else tee layout)
            let parsArr = Array.isArray(pl?.pars) && pl.pars.length === 18 ? pl.pars : null;
            let siArr   = Array.isArray(pl?.sis)  && pl.sis.length  === 18 ? pl.sis  : null;
            if ((!parsArr || !siArr) && Array.isArray(teesFinal) && teesFinal.length) {
              const tl = String(pl?.teeLabel || pl?.tee || "").trim().toLowerCase();
              const g  = String(pl?.gender || "").trim().toUpperCase();
              let tee = teesFinal.find(t => String(t?.teeName || "").trim().toLowerCase() === tl) || null;
              if (!tee) tee = teesFinal.find(t => String(t?.gender || "").toUpperCase() === g) || teesFinal[0];
              if (tee) {
                if (!parsArr && Array.isArray(tee.pars) && tee.pars.length === 18) parsArr = tee.pars;
                if (!siArr   && Array.isArray(tee.sis)  && tee.sis.length  === 18) siArr   = tee.sis;
              }
            }
        
            const courseHcp = Number.isFinite(Number(pl?.courseHandicap)) ? Number(pl.courseHandicap) : (Number.isFinite(Number(pl?.handicap)) ? Number(pl.handicap) : 0);
        
            for (let i = 0; i < eventHoles; i++) {
              const g = Number(gh[i]);
              if (!Number.isFinite(g) || g <= 0) {
                const par = parsArr ? parsArr[i] : 4;
                const si  = siArr   ? siArr[i]   : (i + 1);
                gh[i] = _ndb(par, courseHcp, si);
                imputed[i] = true;
                // Stableford for NDB is always 0, so fill missing points to 0 for completeness.
                if (!Number.isFinite(Number(ph[i]))) ph[i] = 0;
              }
            }
        
            pl.perHole = ph;
            pl.grossPerHole = gh;
            pl.imputedMask = imputed;
            pl.imputedGrossPerHole = gh;
          }
        } catch (e) {
          // don't fail parsing if imputation has unexpected data
        }
        return { players: finalPlayers, courseTees: teesFinal, courseName: detectedCourseName };
      }
// --- Generic CSV scorecard parser (wide / matrix formats) ---
// Keeps Squabbit parsing unchanged; used only as a fallback when parseScorecardCSV() throws.
function parseGenericScorecardCSV(csvText) {
  const text = String(csvText || "");
  const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.length > 0);
  if (!lines.length) throw new Error("CSV is empty.");

  const rows = lines.map(splitSmart);

  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.]/g, "");
  const isNum = (v) => v !== null && v !== undefined && v !== "" && !Number.isNaN(Number(v));
  const toNum = (v) => {
    const n = Number(String(v || "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : NaN;
  };

  // 1) Metadata: Course name
  let courseName = "";
  for (const r of rows.slice(0, 10)) {
    if (!r || !r.length) continue;
    const a0 = norm(r[0]);
    if (a0 === "course name" || a0 === "course") {
      for (let j = 1; j < r.length; j++) {
        const v = String(r[j] || "").trim();
        if (v) { courseName = v; break; }
      }
      if (courseName) break;
    }
  }
  // Also accept "Course Name,XYZ,,Location,..." format
  if (!courseName) {
    const r0 = rows[0] || [];
    if (norm(r0[0]) === "course name") {
      courseName = String(r0.find((x, i) => i > 0 && String(x || "").trim()) || "").trim();
    }
  }

  // 2) Find hole header row: "Hole,1,2,...,18"
  let holeRowIdx = -1;
  let holeColIdxs = []; // indices of columns for holes 1..18 in order
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r.length) continue;
    if (norm(r[0]) !== "hole") continue;
    // Build mapping from hole number -> column index
    const map = {};
    for (let j = 1; j < r.length; j++) {
      const cell = String(r[j] || "").trim();
      const hn = parseInt(cell, 10);
      if (hn >= 1 && hn <= 18) map[hn] = j;
    }
    if (Object.keys(map).length >= 9) {
      holeRowIdx = i;
      holeColIdxs = Array.from({ length: 18 }, (_, k) => map[k + 1]).filter(Boolean);
      // Ensure we have 18 if possible; if only 9, keep 9.
      break;
    }
  }
  if (holeRowIdx < 0 || holeColIdxs.length < 9) {
    throw new Error("Unrecognised CSV format (could not locate Hole 1–18 header row).");
  }

  const holesCount = holeColIdxs.length; // 9 or 18
  const holeNums = Array.from({ length: holesCount }, (_, i) => i + 1);

  // 3) Par / SI / Yards rows (matrix formats)
  const findMatrixRow = (labelSet) => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || [];
      const a0 = norm(r[0]);
      if (labelSet.has(a0)) return i;
    }
    return -1;
  };

  const parIdx = findMatrixRow(new Set(["par"]));
  const siIdx = findMatrixRow(new Set(["si", "s i", "stroke index", "hcp", "handicap"]));
  const yardsIdx = findMatrixRow(new Set(["yards", "yds", "yd", "yardage"]));
  const metersIdx = findMatrixRow(new Set(["meters", "metres", "m"]));

  const pars = parIdx >= 0 ? holeColIdxs.map(ci => toNum((rows[parIdx] || [])[ci])) : [];
  const sis = siIdx >= 0 ? holeColIdxs.map(ci => toNum((rows[siIdx] || [])[ci])) : [];
  const yards = yardsIdx >= 0 ? holeColIdxs.map(ci => toNum((rows[yardsIdx] || [])[ci])) :
               (metersIdx >= 0 ? holeColIdxs.map(ci => {
                 const m = toNum((rows[metersIdx] || [])[ci]);
                 return Number.isFinite(m) ? Math.round(m * 1.09361) : NaN;
               }) : []);

  // 4) Find player header row if present: "Player,Tee,1,2,..."
  let playerHeaderIdx = -1;
  let playerNameCol = 0;
  let teeCol = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r.length) continue;
    const a0 = norm(r[0]);
    if (a0 !== "player" && a0 !== "name") continue;

    playerHeaderIdx = i;
    playerNameCol = 0;

    // detect tee column if present
    for (let j = 0; j < r.length; j++) {
      if (norm(r[j]) === "tee" || norm(r[j]) === "tees") { teeCol = j; break; }
    }
    // In "Player,Tee,1,2..." the tee is typically col 1
    if (teeCol < 0 && r.length > 2 && (norm(r[1]) === "tee" || norm(r[1]) === "tees")) teeCol = 1;
    break;
  }

  const normalizeNameKey = (s) => norm(String(s || "")).replace(/\s+/g, " ").trim();
  const stripParens = (s) => String(s || "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();

  const isTeamLike = (name) => /team|best\s*ball|scramble|fourball|foursomes/i.test(String(name || ""));
  const isPointsRow = (name) => /stableford|net\s*pts|net\s*points|points/i.test(String(name || ""));

  const extractEmbedded = (nameCell) => {
    const raw = String(nameCell || "");
    let name = raw;
    // split at first "(" to get base display name
    if (raw.includes("(")) name = raw.split("(")[0].trim();
    name = name.trim();
    let tee = "";
    let hcp = NaN;

    const mT = raw.match(/tee\s*:\s*([a-z0-9]+)/i);
    if (mT && mT[1]) tee = String(mT[1]).trim();
    const mH = raw.match(/hcp\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (mH && mH[1]) hcp = toNum(mH[1]);

    return { name, tee, hcp };
  };

  const playersMap = new Map(); // key -> player obj under construction
  const pointsMap = new Map();  // key -> per-hole stableford array

  const readHoleVals = (r, offset) => {
    // r is array, offset is where hole1 starts (column index)
    const vals = [];
    for (let k = 0; k < holesCount; k++) {
      const ci = holeColIdxs[k];
      vals.push(toNum(r[ci]));
    }
    return vals;
  };

  // 5) Iterate player rows
  const startIdx = playerHeaderIdx >= 0 ? (playerHeaderIdx + 1) : (Math.max(holeRowIdx, parIdx, siIdx, yardsIdx, metersIdx) + 1);

  for (let i = startIdx; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r.length) continue;

    const label0 = String(r[0] || "").trim();
    if (!label0) continue;

    // stop if we hit another section header
    const a0 = norm(label0);
    if (["hole", "par", "si", "s i", "players"].includes(a0)) continue;

    // Must contain at least some numeric hole values
    const sampleNums = holeColIdxs.slice(0, Math.min(holesCount, 6)).map(ci => r[ci]).filter(isNum).length;
    if (sampleNums < 2) continue;

    // Determine row type + base key
    let embedded = extractEmbedded(label0);
    let name = embedded.name || label0;
    const tee = (teeCol >= 0 ? String(r[teeCol] || "").trim() : embedded.tee) || "";
    const hcp = embedded.hcp;

    if (isTeamLike(name)) continue;

    if (isPointsRow(label0)) {
      // points row, map to base player name (strip stableford/points words)
      const base = stripParens(label0)
        .replace(/net\s*pts\s*\(.*?\)/i, "")
        .replace(/net\s*pts/i, "")
        .replace(/net\s*points/i, "")
        .replace(/\(.*stableford.*\)/i, "")
        .replace(/stableford/i, "")
        .replace(/points?/i, "")
        .trim();
      const key = normalizeNameKey(base || name);
      const perHolePts = readHoleVals(r);
      pointsMap.set(key, perHolePts);
      continue;
    }

    const key = normalizeNameKey(name);
    const grossPerHole = readHoleVals(r);

    const existing = playersMap.get(key) || { name, gender: "M", teeLabel: tee, handicap: NaN, courseHandicap: NaN, grossPerHole: Array(18).fill(NaN), perHole: [], points: 0, back9: 0, pars: null, sis: null };
    existing.name = name;
    if (tee) existing.teeLabel = tee;
    if (Number.isFinite(hcp)) { existing.handicap = hcp; existing.courseHandicap = hcp; }
    // place gross values into first holesCount positions
    const g = existing.grossPerHole.slice();
    for (let k = 0; k < holesCount; k++) g[k] = grossPerHole[k];
    existing.grossPerHole = g;

    playersMap.set(key, existing);
  }

  // 6) Merge points rows onto players, compute totals/back9
  const finalPlayers = Array.from(playersMap.entries()).map(([key, p]) => {
    const pts = pointsMap.get(key);
    if (Array.isArray(pts) && pts.length) {
      p.perHole = pts.slice();
      p.points = pts.reduce((a, b) => a + (Number(b) || 0), 0);
      p.back9 = pts.slice(9, 18).reduce((a, b) => a + (Number(b) || 0), 0);
    } else {
      p.perHole = [];
      p.points = 0;
      p.back9 = 0;
    }
    p.pars = (pars && pars.length === holesCount) ? pars.slice() : null;
    p.sis = (sis && sis.length === holesCount) ? sis.slice() : null;
    if (!Number.isFinite(p.courseHandicap)) p.courseHandicap = Number.isFinite(p.handicap) ? p.handicap : 0;
    if (!Number.isFinite(p.handicap)) p.handicap = 0;
    return p;
  }).filter(p => p.name && !isTeamLike(p.name));

  // 7) courseTees: one tee per unique teeLabel (kept minimal; Supabase will enrich after import)
  const teeSet = new Set(finalPlayers.map(p => String(p.teeLabel || "").trim()).filter(Boolean));
  const courseTees = Array.from(teeSet).map(tn => ({
    teeName: tn,
    gender: "M",
    pars: (pars && pars.length === holesCount) ? pars.slice() : [],
    yards: (yards && yards.length === holesCount) ? yards.slice() : [],
    si: (sis && sis.length === holesCount) ? sis.slice() : [],
  }));

  return { players: finalPlayers, courseTees, courseName };
}

// Parses either Squabbit CSV (preferred) or a generic scorecard CSV as a fallback.
// DOES NOT change Squabbit behaviour; only runs generic parser if Squabbit parsing throws.
function parseScorecardCSV(csvText) {
  try {
    // Keep Squabbit parsing strict and unchanged
    return parseSquabbitCSV(String(csvText || ""));
  } catch (err) {
    // Fallback: wide/matrix scorecard formats from other apps
    return parseGenericScorecardCSV(String(csvText || ""));
  }
}

function simpleRank(players){
  return [...players].map(p=>{
    const grossTotal=(p.grossPerHole||[]).filter(n=>Number.isFinite(n)).reduce((a,b)=>a+b,0);
    return {...p,grossTotal};
  }).sort((a,b)=>{
    if((b.points||0)!==(a.points||0)) return (b.points||0)-(a.points||0);
    if((a.grossTotal||0)!==(b.grossTotal||0)) return (a.grossTotal||0)-(b.grossTotal||0);
    return (b.back9||0)-(a.back9||0);
  });
}

function Breadcrumbs({ items }) {
  if (!items || !items.length) return null;
  return (
    <div className="hide-print mb-3">
      <div className="flex flex-wrap items-center gap-1 text-xs text-neutral-500">
        {items.map((it, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            {i > 0 && <span className="text-neutral-300">/</span>}
            {it.onClick ? (
              <button
                className="px-2 py-1 rounded-full bg-white/70 border border-squab-200 hover:bg-white transition"
                onClick={it.onClick}
                title={it.title}
              >
                {it.label}
              </button>
            ) : (
              <span className="px-2 py-1 rounded-full bg-neutral-100 border border-neutral-200">
                {it.label}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}


function ImproveTopNav({ active="progress", setView }) {
  return null;
  const Tab = ({ id, label, hint, onClick }) => {
    const on = active === id;
    return (
      <button
        className={
          "px-3 py-1.5 rounded-full text-xs font-extrabold border transition " +
          (on
            ? "bg-neutral-900 text-white border-neutral-900"
            : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50")
        }
        onClick={onClick}
        type="button"
      >
        <span className="inline-flex items-center gap-3">
          <span className={"w-8 h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-black border-2 " + (on ? "border-white/70 text-white/90" : "border-neutral-300 text-neutral-600")}>
            {id === "progress" ? "1" : id === "summary" ? "2" : "3"}
          </span>
          <span className="flex flex-col leading-tight text-left">
            <span>{label}</span>
            <span className={"text-[11px] sm:text-xs font-extrabold tracking-wide " + (on ? "text-white/80" : "text-neutral-500")}>
              {hint}
            </span>
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="mt-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="flex flex-col items-center justify-center gap-3">
        <div className="text-center">
          
          <div className="mt-1 text-sm sm:text-base font-extrabold text-neutral-900">Go 1, 2, 3 to improve</div>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 justify-center w-full">
          <Tab id="progress" label="Overview" hint="Outcome" onClick={() => setView("player_progress")} />
        </div>
      </div>
    </div>
  );
}
function SeasonSelectionBar({
  seasonModel,
  seasonPlayer,
  setSeasonPlayer,
  seasonYear,
  setSeasonYear,
  seasonLimit,
  setSeasonLimit,
  seasonYears,
  scoringMode,
  setScoringMode,
}) {
  const players = (seasonModel?.players || []).filter(p => p && p.name && !(typeof isTeamLike === "function" && isTeamLike(p.name)));
  const activePlayer = seasonPlayer || (players?.[0]?.name || "");
  const yr = seasonYear || "All";
  const lim = seasonLimit || "All";
  const mode = scoringMode || "stableford";

  const summary = [
    activePlayer || "—",
    (String(lim).toLowerCase() === "all" ? "All games" : `Last ${lim}`),
    (String(yr).toLowerCase() === "all" ? "All years" : String(yr)),
    (mode === "gross" ? "Gross" : "Stableford"),
  ].join(" · ");

  return null; // removed Active bar (controls moved into Performance Mirror)
}


function Header({ leagueHeaderTitle, eventName, statusMsg, courseName, view, setView }) {
  return (
    <div className="hide-print sticky top-0 z-40" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {/* Slim sticky bar */}
      <div className="glass-card app-topbar shadow-md px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          {/* On mobile, drop the left title to avoid duplication + reclaim space */}
          <div className="min-w-0 hidden sm:block">
            <h1 className="text-lg md:text-xl font-extrabold tracking-tight text-squab-900 truncate">
              {leagueHeaderTitle || "Den Society League — Ultimate Edition"}
            </h1>
            <div className="text-[11px] text-neutral-500 truncate">
              {eventName || "Untitled Event"}
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end min-w-0">
  {view !== "home" ? (
    <button
      className="topbtn px-3 py-2 text-sm"
      onClick={() => setView("home")}
      title="Back to Main Menu"
      aria-label="Back to Main Menu"
    >
      <span className="ico">🏠</span>Home
    </button>
  ) : null}
  <span className="topchip px-3 py-2 text-sm max-w-[70vw] sm:max-w-none">
    <span className="ico">⛳</span><span className="txt truncate">{eventName || "Untitled Event"}</span>
  </span>
</div>
        </div>
      </div>
    </div>
  );}



function BottomStatusBar({ statusMsg, courseName }) {
  const connected = String(statusMsg || "").toLowerCase().includes("connected");
  return (
    <div className="status-mini" aria-label="Connection status">
      <span className={"dot " + (connected ? "bg-emerald-500" : "bg-rose-500")} aria-hidden="true" />
      <span className="lbl">Supabase</span>
      <span className="mono">{statusMsg || "—"}</span>
      <span className="mx-2 text-neutral-300">•</span>
      <span className="lbl">Course</span>
      <span className={courseName ? "text-neutral-700" : "text-neutral-400"}>{courseName || "—"}</span>
    </div>
  );
}

function SoloNav({ setView, left = null, title = null, right = null }) {
  return (
    <div className="nav-wrap mb-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {left}
          {title ? <span className="chip">{title}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          {right}
        </div>
      </div>
    </div>
  );
}


function SeasonPicker({ seasonsDef, seasonYear, setSeasonYear, leagueTitle }) {
  // Build nice labels, especially for Den Society seasons that span two calendar years.
  const labelFor = (s) => {
    const raw = String((s && s.label) ? s.label : "").trim();
    const id = String(s?.season_id ?? "").trim();

    // Prefer explicit label if it exists
    let base = raw;

    // Otherwise derive from start/end dates (e.g. Oct 2025 -> Apr 2026 => 2025-2026)
    if (!base) {
      const a = String(s?.start_date || s?.startDate || "").slice(0, 10);
      const b = String(s?.end_date || s?.endDate || "").slice(0, 10);
      const y1 = a ? a.slice(0, 4) : "";
      const y2 = b ? b.slice(0, 4) : "";
      if (y1 && y2 && y1 !== y2) base = `${y1}-${y2}`;
      else if (y1) base = y1;
      else base = id || "";
    }

    // Brand it as the active league title unless it already includes it
    const brand = String(leagueTitle || "Den Society League").trim();
    const baseLower = base.toLowerCase();
    const brandLower = brand.toLowerCase();
    if (brand && !baseLower.includes(brandLower)) base = `${brand} ${base}`.trim();
return base || id || "";
  };

  const opts = (seasonsDef || []).map((s) => ({
    id: String(s.season_id),
    label: labelFor(s),
  }));

  // Prevent the <select> going blank when the current value isn't in the options.
  const cur = String(seasonYear ?? "");
  const fallback = (opts[0]?.id) ? String(opts[0].id) : "All";
  const safeValue = (cur && (cur.toLowerCase() === 'all' || opts.some(o => o.id === cur))) ? cur : fallback;

  React.useEffect(() => {
    const cur2 = String(seasonYear ?? "");
    const ok = (cur2 && (cur2.toLowerCase() === 'all' || opts.some(o => o.id === cur2)));
    if (!ok && safeValue && safeValue !== cur2) setSeasonYear(safeValue);
  }, [seasonsDef]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-black tracking-widest uppercase text-neutral-500">Season</span>
      <div className="select-wrap">
        <select
          className="select-premium"
          value={String(safeValue || "")}
          onChange={(e) => setSeasonYear(e.target.value)}
        >
          <option value="All">All</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <svg className="select-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
function EventNav({ setView, hasEvent = true }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  // Close on outside click / ESC
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // IMPORTANT: Dropdown is ONLY the "in-game" icon navigation.
  // Main Menu items (League/Eclectic/Analyse Game/Guide/etc) are intentionally NOT duplicated here.
  const items = [
    { k: "event", label: "⛳ Game" },
    { k: "graphs", label: "📈 Graphs" },
    { k: "scorecard", label: "🧾 Player Scorecard" },
    { k: "course_stats", label: "🗺️ Course Stats" },
    { k: "ratings", label: "⭐ Ratings" },
    { sep: true },

    { k: "banter", label: "😂 Banter" },
    { k: "style", label: "🎯 Styles" },
    { k: "story", label: "📖 Story" },
    { k: "replay", label: "📺 Replay" },
    { k: "team_replay", label: "🤼 Teams" },
    { k: "casino", label: "🎰 Casino" },
    { k: "trophies", label: "🏆 Trophies" },
    { k: "partner", label: "🤝 Partners" },
    { k: "headtohead", label: "🥊 Rivalry" },
  ];

  const go = (k) => {
    setOpen(false);
    setView(k);
  };

  const left = hasEvent ? (
    <div className="relative z-[200]" ref={menuRef}>
      <button
        className="btn-secondary"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        title="Open in‑game menu"
      >
        ☰ Menu
      </button>

      {open ? (
        <div
          className="absolute left-0 mt-2 w-72 max-w-[85vw] rounded-2xl border border-squab-200 bg-white/95 shadow-xl backdrop-blur p-2 z-[200]"
          role="menu"
        >
          <div className="px-2 pt-2 pb-1 text-[10px] font-black tracking-widest uppercase text-neutral-500">
            In‑game tools
          </div>

          {items.map((it, idx) => {
            if (it.sep) {
              return <div key={"sep" + idx} className="my-2 h-px bg-neutral-200/80" />;
            }
            return (
              <button
                key={it.k}
                className="w-full text-left px-3 py-2 rounded-xl hover:bg-squab-50 active:bg-squab-100 transition flex items-center justify-between gap-3"
                onClick={() => go(it.k)}
                role="menuitem"
              >
                <span className="font-extrabold text-neutral-900">{it.label}</span>
                <span className="text-xs text-neutral-500">→</span>
              </button>
            );
          })}

          <div className="mt-2 px-2 py-1 text-[11px] text-neutral-500">
            League & Eclectic live on the Main Menu. Review Past Games and Guide are on Home.
          </div>
        </div>
      ) : null}
    </div>
  ) : (
    <button className="btn-secondary" onClick={() => setView("past")}>
      🗂️ Review Your Past Games
    </button>
  );

  return <SoloNav setView={setView} left={left} />;
}

function Home({
  activeRole,
  isSuperAdmin,
  setView,
  fileInputRef,
  importLocalCSV,
  runSeasonAnalysis,
  computed,
  addEventToSeason,
  removeEventFromSeason,
  clearSeason,
  user,
  handleLogin,
  handleLogout,
  handleSwitchSociety,
  openPlayersAdmin,
  visiblePlayersCount,
  totalPlayersCount,
}) {
  const signedIn = !!user;
  const isAdmin = !!(user && (user.is_admin || user.role === "admin"));
  const adminLabel = isAdmin ? (user.email || "Admin") : "Not signed in";

  // Best-effort stats (won't break if your computed shape changes)
  const rounds = (computed && (
    (computed.seasonEvents && computed.seasonEvents.length) ||
    (computed.events && computed.events.length) ||
    (computed.rounds && computed.rounds.length)
  )) || 0;

  const formats = (computed && (
    computed.formatsCount ||
    (computed.formats && computed.formats.length)
  )) || 0;

  const holes = (computed && (
    computed.holesExplored ||
    computed.holeCount ||
    (computed.holes && computed.holes.length)
  )) || 0;

  const statsText =
    (rounds || formats || holes)
      ? `${rounds} rounds analyzed \u00b7 ${formats || 0} formats \u00b7 ${holes || 0} holes explored`
      : `Explore trends, surprises, and scoring patterns`;

  return (
    <section id="player-report-top" className="content-card" style={{ padding: 14 }}>
      
      <style>{`
        /* Mobile menu CTA consistency (Home screen) */
        .hm-cta-row{ display:flex; flex-direction:column; gap:10px; align-items:stretch; margin-top:12px; }
        .hm-cta{ width:100%; justify-content:center; }
        .hm-stats{ font-size:12px; line-height:1.35; opacity:.92; }

        /* Make the smaller card action buttons behave like the main CTA on mobile */
        .hm-card-action{ display:flex; align-items:center; gap:10px; }
        .hm-linkbtn{ display:inline-flex; align-items:center; justify-content:center; white-space:nowrap; }
        @media (max-width: 640px){
          .hm-cta-row{ gap:12px; }
          .hm-cta{ width:100%; }
          .hm-card-inner{ display:flex; flex-direction:column; gap:12px; }
          .hm-card-action{ width:100%; }
          .hm-linkbtn{
            width:100%;
            padding:14px 16px;
            border-radius:18px;
            font-weight:900;
            letter-spacing:-0.01em;
            background: linear-gradient(180deg, rgba(255,212,75,1) 0%, rgba(245,166,35,1) 100%);
            color: rgba(23,17,0,0.96);
            box-shadow: 0 10px 24px rgba(0,0,0,0.18);
          }
          .hm-pill{ display:none; }
        }
        @media (min-width: 641px){
          .hm-cta-row{ flex-direction:row; align-items:center; justify-content:space-between; gap:12px; }
          .hm-cta{ width:auto; }
        }
      `}</style>

      {/* Scorecard stack: print course/name/totals INSIDE the top sheet artwork */}
      <style>{`
        /* Top sheet (front-most) gets the branded header + totals. Back sheets keep the subtle grid look. */
        .hm-sheet.s3{
          background-image:
            url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22640%22%20height%3D%22360%22%20viewBox%3D%220%200%20640%20360%22%3E%0A%3Crect%20width%3D%22640%22%20height%3D%22360%22%20rx%3D%2212%22%20ry%3D%2212%22%20fill%3D%22rgba%28255%2C255%2C255%2C0.0%29%22/%3E%0A%3Crect%20x%3D%220%22%20y%3D%220%22%20width%3D%22640%22%20height%3D%2256%22%20fill%3D%22rgba%2816%2C185%2C129%2C0.18%29%22/%3E%0A%3Ctext%20x%3D%2218%22%20y%3D%2226%22%20font-size%3D%2216%22%20font-family%3D%22Arial%22%20font-weight%3D%22900%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.70%29%22%3EChart%20Hills%3C/text%3E%0A%3Ctext%20x%3D%22622%22%20y%3D%2226%22%20font-size%3D%2216%22%20font-family%3D%22Arial%22%20font-weight%3D%22900%22%20text-anchor%3D%22end%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.70%29%22%3EBen%20Hogan%3C/text%3E%0A%3Ctext%20x%3D%2218%22%20y%3D%2246%22%20font-size%3D%2212%22%20font-family%3D%22Arial%22%20font-weight%3D%22700%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.55%29%22%3EStrokes%3A%2059%20%20%C2%B7%20%20Stableford%3A%2054%3C/text%3E%0A%3Cg%3E%0A%3Ctext%20x%3D%2260%22%20y%3D%2292%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E6%3C/text%3E%3Ctext%20x%3D%22116%22%20y%3D%2292%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E7%3C/text%3E%3Ctext%20x%3D%22172%22%20y%3D%2292%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E8%3C/text%3E%3Ctext%20x%3D%22228%22%20y%3D%2292%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E9%3C/text%3E%3Ctext%20x%3D%22284%22%20y%3D%2292%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E1%3C/text%3E%3Ctext%20x%3D%22340%22%20y%3D%2292%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E2%3C/text%3E%3Ctext%20x%3D%22396%22%20y%3D%2292%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E3%3C/text%3E%3Ctext%20x%3D%22452%22%20y%3D%2292%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E4%3C/text%3E%3Ctext%20x%3D%22508%22%20y%3D%2292%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E5%3C/text%3E%3Ctext%20x%3D%2260%22%20y%3D%22144%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E9%3C/text%3E%3Ctext%20x%3D%22116%22%20y%3D%22144%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E1%3C/text%3E%3Ctext%20x%3D%22172%22%20y%3D%22144%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E2%3C/text%3E%3Ctext%20x%3D%22228%22%20y%3D%22144%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E3%3C/text%3E%3Ctext%20x%3D%22284%22%20y%3D%22144%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E4%3C/text%3E%3Ctext%20x%3D%22340%22%20y%3D%22144%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E5%3C/text%3E%3Ctext%20x%3D%22396%22%20y%3D%22144%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E6%3C/text%3E%3Ctext%20x%3D%22452%22%20y%3D%22144%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E7%3C/text%3E%3Ctext%20x%3D%22508%22%20y%3D%22144%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E8%3C/text%3E%3Ctext%20x%3D%2260%22%20y%3D%22196%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E3%3C/text%3E%3Ctext%20x%3D%22116%22%20y%3D%22196%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E4%3C/text%3E%3Ctext%20x%3D%22172%22%20y%3D%22196%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E5%3C/text%3E%3Ctext%20x%3D%22228%22%20y%3D%22196%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E6%3C/text%3E%3Ctext%20x%3D%22284%22%20y%3D%22196%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E7%3C/text%3E%3Ctext%20x%3D%22340%22%20y%3D%22196%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E8%3C/text%3E%3Ctext%20x%3D%22396%22%20y%3D%22196%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E9%3C/text%3E%3Ctext%20x%3D%22452%22%20y%3D%22196%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E1%3C/text%3E%3Ctext%20x%3D%22508%22%20y%3D%22196%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E2%3C/text%3E%3Ctext%20x%3D%2260%22%20y%3D%22248%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E6%3C/text%3E%3Ctext%20x%3D%22116%22%20y%3D%22248%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E7%3C/text%3E%3Ctext%20x%3D%22172%22%20y%3D%22248%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E8%3C/text%3E%3Ctext%20x%3D%22228%22%20y%3D%22248%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E9%3C/text%3E%3Ctext%20x%3D%22284%22%20y%3D%22248%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E1%3C/text%3E%3Ctext%20x%3D%22340%22%20y%3D%22248%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E2%3C/text%3E%3Ctext%20x%3D%22396%22%20y%3D%22248%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E3%3C/text%3E%3Ctext%20x%3D%22452%22%20y%3D%22248%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E4%3C/text%3E%3Ctext%20x%3D%22508%22%20y%3D%22248%22%20font-size%3D%2218%22%20font-family%3D%22Arial%22%20fill%3D%22rgba%2815%2C23%2C42%2C0.35%29%22%3E5%3C/text%3E%0A%3C/g%3E%0A%3C/svg%3E"),
            linear-gradient(180deg, rgba(226,232,240,0.95) 0%, rgba(226,232,240,0.95) 16%, transparent 16%),
            repeating-linear-gradient(0deg, rgba(148,163,184,0.22) 0px, rgba(148,163,184,0.22) 1px, transparent 1px, transparent 12px),
            repeating-linear-gradient(90deg, rgba(148,163,184,0.18) 0px, rgba(148,163,184,0.18) 1px, transparent 1px, transparent 22px),
            linear-gradient(180deg, rgba(255,255,255,0.90), rgba(255,255,255,0.66));
          background-size: cover, auto, auto, auto, auto;
          background-blend-mode: normal, normal, normal, normal, normal;
        }
      `}</style>
<div className="hm-stage">
        <div className="hm-grid">

          {/* HERO */}
          <div className="hm-hero">
            <div className="hm-glow" />
            <div className="hm-hero-inner">
              <div>
                <h2>Explore Your Games</h2>
                <p className="hm-sub">Dive into your rounds. Find patterns. Spot surprises.</p>

                <div style={{ color: "rgba(255,255,255,0.84)", fontWeight: 800, marginTop: 8 }}>
                  Inside you’ll find:
                </div>


                <div className="hm-cta-row">
                  <button className="hm-cta" onClick={() => setView("past")}>
                    <span className="hm-arrow">→</span>
                    <span>Enter Game Explorer</span>
                  </button>
                  <div className="hm-stats">{statsText}</div>
                  
                </div>


                
                <div className="hm-inline-menu" aria-label="Menu options (visual)">
                  <div className="hm-inline-menu-grid">
                    <div className="hm-inline-item"><span className="hm-ico">⛳</span><span>Game</span></div>
                    <div className="hm-inline-item"><span className="hm-ico">📈</span><span>Graphs</span></div>
                    <div className="hm-inline-item"><span className="hm-ico">🧾</span><span>Player Scorecard</span></div>
                    <div className="hm-inline-item"><span className="hm-ico">🗺️</span><span>Course Stats</span></div>
                    <div className="hm-inline-item"><span className="hm-ico">⭐</span><span>Ratings</span></div>
                    <div className="hm-inline-item"><span className="hm-ico">😂</span><span>Banter</span></div>
                    <div className="hm-inline-item"><span className="hm-ico">🎯</span><span>Styles</span></div>
                    <div className="hm-inline-item"><span className="hm-ico">📖</span><span>Story</span></div>
                    <div className="hm-inline-item"><span className="hm-ico">📺</span><span>Replay</span></div>
                    <div className="hm-inline-item"><span className="hm-ico">🤼</span><span>Teams</span></div>
                    <div className="hm-inline-item"><span className="hm-ico">🎰</span><span>Casino</span></div>
                    <div className="hm-inline-item"><span className="hm-ico">🏆</span><span>Trophies</span></div>
                    <div className="hm-inline-item"><span className="hm-ico">🤝</span><span>Partners</span></div>
                    <div className="hm-inline-item"><span className="hm-ico">🥊</span><span>Rivalry</span></div>
                  </div>
                </div>
              </div>

              <div className="hm-hero-right">
                <div className="hm-mini-stack" aria-hidden="true">
                  <div className="hm-sheet s1" />
                  <div className="hm-sheet s2" />
                  <div className="hm-sheet s3" />
                </div>
              </div>
            </div>
          </div>

          {/* REVIEW & IMPROVE */}
          <button className="hm-card heroish" onClick={() => setView("player_progress")} style={{ textAlign: "left", cursor: "pointer" }}>
            <div className="hm-card-inner">
              <div style={{ minWidth: 0 }}>
                <h3>Review &amp; Improve</h3>
                <div className="hm-desc">Turn insight into better scores.</div>
                <ul>
                  <li><span className="hm-ico2">🧾</span><span>See what actually costs you points</span></li>
                  <li><span className="hm-ico2">💪</span><span>Find your biggest strengths vs the field</span></li>
                  <li><span className="hm-ico2">🧭</span><span>Build simple game plans that work</span></li>
                </ul>
              </div>

              <div className="hm-card-action">
                <button className="hm-linkbtn" onClick={(e) => { e.stopPropagation(); setView("player_progress"); }}>
                  <span>→ Review Performance</span>
                </button>
                <div className="hm-pill">⋯</div>
              </div>
            </div>
          </button>

          {/* TWO-UP ROW */}
          <div className="hm-row2">
            <button className="hm-card heroish" onClick={() => setView("standings")} style={{ textAlign: "left", cursor: "pointer" }}>
              <div className="hm-card-inner">
                <div style={{ minWidth: 0 }}>
                  <h3>League Standings</h3>
                  <div className="hm-desc">How the season is shaping up.</div>
                  <ul>
                    <li><span className="hm-ico2">📋</span><span>Current rankings</span></li>
                    <li><span className="hm-ico2">📉</span><span>Points gaps &amp; momentum</span></li>
                    <li><span className="hm-ico2">📈</span><span>Who’s climbing, who’s slipping</span></li>
                  </ul>
                </div>
                <div className="hm-card-action">
                  <button className="hm-linkbtn" onClick={(e) => { e.stopPropagation(); setView("standings"); }}>
                    <span>→ View League</span>
                  </button>
                  <div className="hm-pill">⋯</div>
                </div>
              </div>
            </button>

            <button className="hm-card heroish" onClick={() => setView("eclectic")} style={{ textAlign: "left", cursor: "pointer" }}>
              <div className="hm-card-inner">
                <div style={{ minWidth: 0 }}>
                  <h3>Eclectic</h3>
                  <div className="hm-desc">Your best golf, stitched together.</div>
                  <ul>
                    <li><span className="hm-ico2">🏁</span><span>Best score on every hole</span></li>
                    <li><span className="hm-ico2">🧩</span><span>What your “perfect round” looks like</span></li>
                    <li><span className="hm-ico2">🛠️</span><span>Where improvement still lives</span></li>
                  </ul>
                </div>
                <div className="hm-card-action">
                  <button className="hm-linkbtn" onClick={(e) => { e.stopPropagation(); setView("eclectic"); }}>
                    <span>→ View Eclectic</span>
                  </button>
                  <div className="hm-pill">⋯</div>
                </div>
              </div>
            </button>
          </div>

          {/* ADMIN BAR */}
          <button className="hm-admin" onClick={() => setView("admin")} style={{ textAlign: "left", cursor: "pointer" }}>
            <div className="hm-admin-inner">
              <div>
                <div className="hm-admin-title">
                  <span className="hm-gear">⚙️</span>
                  <span>Admin</span>
                </div>
                <div className="hm-admin-sub">
                  Settings, imports, season setup, players
                  {totalPlayersCount != null ? ` \u00b7 Players: ${visiblePlayersCount}/${totalPlayersCount}` : ""}
                  {signedIn ? ` \u00b7 Signed in as ${adminLabel}` : ""}
                </div>
              </div>
              <div className="hm-pill" style={{ background: "rgba(255,255,255,0.10)", borderColor: "rgba(255,255,255,0.18)" }}>↗</div>
            </div>
          </button>

          <div className="hm-foot">
            Most players discover something new every time they explore their games. 💡
          </div>

        </div>
      </div>
    </section>
  );
}



function AdminView({
  activeRole,
  isSuperAdmin,
  setView,
  fileInputRef,
  importLocalCSV,
  computed,
  addEventToSeason,
  removeEventFromSeason,
  clearSeason,
  seasonsDef,
  leagueSeasonYear,
  setLeagueSeasonYear,
  activeSocietyId,
  activeSocietySlug,
  user,
  handleLogin,
  handleLogout,
  handleSwitchSociety,
  openPlayersAdmin,
  visiblePlayersCount,
  totalPlayersCount,
}) {
  const role = String(activeRole || "").toLowerCase();
  const isAdmin = !!user && (isSuperAdmin || role === "admin" || role === "captain");
  const adminLabel = isAdmin ? (user.email || "Admin") : "Not signed in";
  const hasLoadedEvent = !!(computed && computed.length);

  function slugify(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  const seasons = Array.isArray(seasonsDef) ? seasonsDef : [];
  const seasonsSorted = seasons
    .slice()
    .sort((a, b) => String(a?.label || a?.season_id || "").localeCompare(String(b?.label || b?.season_id || "")));

  const [createSeasonOpen, setCreateSeasonOpen] = React.useState(false);
  const [seasonLabel, setSeasonLabel] = React.useState("");
  const [seasonCompetition, setSeasonCompetition] = React.useState("season");
  const [seasonStart, setSeasonStart] = React.useState("");
  const [seasonEnd, setSeasonEnd] = React.useState("");
  const [seasonBusy, setSeasonBusy] = React.useState(false);

  const [actionStatus, setActionStatus] = React.useState("");

  const [createSocietyOpen, setCreateSocietyOpen] = React.useState(false);
  const [societyName, setSocietyName] = React.useState("");
  const [societySlug, setSocietySlug] = React.useState("");
  const [societyFirstSeason, setSocietyFirstSeason] = React.useState("");
  const [captainEmail, setCaptainEmail] = React.useState("");
  const [captainBusy, setCaptainBusy] = React.useState(false);
  const [captainStatus, setCaptainStatus] = React.useState("");
  const [societyCompetition, setSocietyCompetition] = React.useState("season");
  const [societyBusy, setSocietyBusy] = React.useState(false);

  React.useEffect(() => {
    if (!societyName) return;
    if (societySlug) return;
    setSocietySlug(slugify(societyName));
  }, [societyName, societySlug]);

  async function handleCreateSeason() {
    if (!isAdmin) return;
    const supabase = window.__supabase_client__;
    if (!supabase) {
      setActionStatus("Supabase client missing.");
      return;
    }

    // Creating seasons is protected by RLS (requires an authenticated captain).
    // If the user isn't signed in with Supabase Auth (e.g. they haven't completed
    // the magic-link or email+password sign-in), the insert will fail with 403/42501.
    try {
      const { data: sessData } = await supabase.auth.getSession();
      if (!sessData?.session?.user?.id) {
        setActionStatus("You must Sign in as Captain before creating a season.");
        return;
      }
    } catch {
      setActionStatus("You must Sign in as Captain before creating a season.");
      return;
    }

    const label = (seasonLabel || "").trim();
    if (!label) {
      setActionStatus("Enter a season name.");
      return;
    }

    const competition = (seasonCompetition || "season").trim();
    const season_id = slugify(label) || `season-${Date.now()}`;

    // Default dates: today -> +1 year (safe minimum; captains can edit later in Supabase if they want)
    const today = new Date();
    const yyyyMmDd = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    const start_date = (seasonStart || "").trim() || yyyyMmDd(today);
    const end = new Date(today);
    end.setFullYear(end.getFullYear() + 1);
    const end_date = (seasonEnd || "").trim() || yyyyMmDd(end);

    setSeasonBusy(true);
    setActionStatus("Creating season…");
    try {
      const { error } = await supabase.from("seasons").insert([
        {
          society_id: activeSocietyId,
          competition,
          season_id,
          label,
          start_date,
          end_date,
          is_active: false,
        },
      ]);
      if (error) throw error;

      setActionStatus(`✅ Season created: ${label}`);
      setCreateSeasonOpen(false);
      setSeasonLabel("");
      setSeasonStart("");
      setSeasonEnd("");
      // Select the new season for follow-up actions
      setLeagueSeasonYear(season_id);
    } catch (e) {
      setActionStatus(e?.message || String(e));
    } finally {
      setSeasonBusy(false);
    }
  }

  async function handleCreateSociety() {
    if (!isAdmin) return;
    const supabase = window.__supabase_client__;
    if (!supabase) {
      setActionStatus("Supabase client missing.");
      return;
    }

    // The idea: any existing captain can create a new society quickly.
    // This needs a SECURITY DEFINER RPC in Supabase (see note in status message if it fails).
    const name = (societyName || "").trim();
    const slug = ((societySlug || "") || slugify(name)).trim();
    const firstSeason = (societyFirstSeason || "").trim();
    if (!name) return setActionStatus("Enter a society name.");
    if (!slug) return setActionStatus("Enter a slug (or let it auto-generate).");

    setSocietyBusy(true);
    setActionStatus("Creating society…");
    try {
      const { data, error } = await supabase.rpc("create_society_as_captain", {
        society_name: name,
        society_slug: slug,
        first_season_name: firstSeason || null,
      });
      if (error) throw error;

      const newSocId = String(data || "");
      if (!newSocId) {
        throw new Error("Create society RPC returned no id.");
      }

      setActionStatus(`✅ Society created: ${name}`);
      setCreateSocietyOpen(false);
      setSocietyName("");
      setSocietySlug("");
      setSocietyFirstSeason("");

      // Jump to the new society URL (viewer link style). AuthGate will then pick it up.
      const base = (import.meta?.env?.BASE_URL || "/").replace(/\/+$/, "/");
      window.location.href = `${base}${slug}`;
    } catch (e) {
      const msg = e?.message || String(e);
      // Make the failure actionable.
      if (/create_society_as_captain/i.test(msg) || /function .* does not exist/i.test(msg)) {
        setActionStatus(
          "Create society needs a Supabase SQL RPC called create_society_as_captain (security definer). If you haven’t added it yet, ask me for the SQL and I’ll give you a copy/paste migration."
        );
      } else {
        setActionStatus(msg);
      }
    } finally {
      setSocietyBusy(false);
    }
  }
  async function handleAddCaptainEmail(e) {
    e?.preventDefault?.();
    setCaptainStatus("");
    const email = (captainEmail || "").trim().toLowerCase();
    if (!email) return;

    const supabase = window.__supabase_client__;
    if (!supabase) {
      setCaptainStatus("Supabase client missing.");
      return;
    }

    setCaptainBusy(true);
    try {
      const { error } = await supabase.rpc("add_captain_email", {
        p_society_id: activeSocietyId,
        p_email: email,
      });
      if (error) throw error;
      setCaptainStatus("Captain invite recorded. They will become captain on first login.");
      setCaptainEmail("");
    } catch (err) {
      setCaptainStatus("Error: " + (err?.message || err));
    } finally {
      setCaptainBusy(false);
    }
  }



  return (
    <section className="content-card p-4 md:p-6 hm-stage">
      <SoloNav
        setView={setView}
        title="Admin"
        left={
          <button className="btn-secondary" onClick={() => setView("home")}>
            ← Home
          </button>
        }
      />

      <div className="glass-card p-4 border border-neutral-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Access</div>
            <div className="mt-1 text-sm font-extrabold text-neutral-900 truncate">{adminLabel}</div>
            <div className="text-xs text-neutral-500">
              Sign in to upload/delete events and edit season standings.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isAdmin ? (
              <button className="btn-primary" onClick={handleLogin}>Sign In</button>
            ) : (
              <>
                <button className="btn-secondary" onClick={handleSwitchSociety}>Switch Society</button>
                <button className="btn-secondary" onClick={handleLogout}>Sign Out</button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid md:grid-cols-2 gap-3">
        <button
          className={"btn-primary w-full " + (!isAdmin ? "opacity-50 cursor-not-allowed" : "")}
          onClick={() => isAdmin && (fileInputRef.current && fileInputRef.current.click())}
          disabled={!isAdmin}
          title={!isAdmin ? "Sign in first" : "Load a new CSV event"}
        >
          ⬆️ Import New Games
        </button>

        <div className="glass-card p-3 border border-neutral-200">
          <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Loaded event</div>
          <div className="mt-1 text-sm font-extrabold text-neutral-900">
            {hasLoadedEvent ? "Ready" : "None loaded"}
          </div>
          <div className="text-xs text-neutral-500 mt-1">
            {hasLoadedEvent ? "You can add/remove this event from the season." : "Load an event before using Add/Remove."}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const text = await f.text();
          importLocalCSV(text, f.name, f);
          e.target.value = "";
        }}
      />

      <div className="mt-4 grid md:grid-cols-3 gap-3">
        <button
          className={"btn-primary w-full " + (!isAdmin || !hasLoadedEvent ? "opacity-50 cursor-not-allowed" : "")}
          onClick={() => isAdmin && hasLoadedEvent && addEventToSeason && addEventToSeason()}
          disabled={!isAdmin || !hasLoadedEvent}
          title={!isAdmin ? "Sign in first" : (!hasLoadedEvent ? "Load an event first" : "Uploads the loaded event and updates standings")}
        >
          ➕ Add Event to Season
        </button>

        <button
          className={"btn-secondary w-full " + (!hasLoadedEvent ? "opacity-50 cursor-not-allowed" : "")}
          onClick={() => hasLoadedEvent && removeEventFromSeason && removeEventFromSeason()}
          disabled={!hasLoadedEvent}
          title={!hasLoadedEvent ? "Load an event first" : "Removes the loaded event's points from season standings"}
        >
          ➖ Remove Loaded Event
        </button>

        <button
          className={"btn-secondary w-full " + (!isAdmin || !leagueSeasonYear ? "opacity-50 cursor-not-allowed" : "")}
          onClick={() => (isAdmin && leagueSeasonYear && clearSeason ? clearSeason() : null)}
          disabled={!isAdmin || !leagueSeasonYear}
          title={!isAdmin ? "Sign in first" : !leagueSeasonYear ? "Pick a season first" : "Deletes the selected season's data"}
        >
          🗑️ Delete whole season
        </button>
      </div>

      {/* Season picker (used by Add game to season + Delete season) */}
      <div className="mt-4 glass-card p-4 border border-neutral-200">
        <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Season / competition</div>
        <div className="mt-1 text-sm font-extrabold text-neutral-900">Choose a season</div>
        <div className="mt-3">
          <select
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm"
            value={leagueSeasonYear || ""}
            onChange={(e) => setLeagueSeasonYear && setLeagueSeasonYear(e.target.value)}
            disabled={!isAdmin}
            title={!isAdmin ? "Sign in first" : "Select the season you want to work on"}
          >
            <option value="">-- Select season --</option>
            {(seasonsSorted || []).map((s) => {
              const key = String(s.season_id || "");
              const label = String(s.label || s.season_id || "(unnamed)");
              const comp = String(s.competition || "");
              return (
                <option key={key} value={key}>
                  {label}{comp ? ` (${comp})` : ""}
                </option>
              );
            })}
          </select>
          <div className="mt-2 text-xs text-neutral-500">
            This selection is used by <span className="font-black">Add game to season</span> and <span className="font-black">Delete whole season</span>.
          </div>
        </div>
      </div>

      {/* Create season */}
      <div className="mt-4 glass-card p-4 border border-neutral-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Season</div>
            <div className="mt-1 text-sm font-extrabold text-neutral-900">Create a new season</div>
            <div className="text-xs text-neutral-500">Creates a new season in the current society.</div>
          </div>
          <button
            className={"btn-primary " + (!isAdmin ? "opacity-50 cursor-not-allowed" : "")}
            onClick={() => (isAdmin ? setCreateSeasonOpen(true) : null)}
            disabled={!isAdmin}
            title={!isAdmin ? "Sign in first" : "Create a new season"}
          >
            ➕ Create a new season
          </button>
        </div>

        {createSeasonOpen ? (
  <form
    className="mt-4 grid gap-2"
    onSubmit={(e) => {
      e.preventDefault();
      handleCreateSeason();
    }}
  >
    <label className="text-xs font-black text-neutral-600">Season / Competition label</label>
    <input
      className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm"
      value={seasonLabel}
      onChange={(e) => setSeasonLabel(e.target.value)}
      placeholder="e.g. Winter League 2026"
    />

    <label className="text-xs font-black text-neutral-600 mt-2">Competition type</label>
    <select
      className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm"
      value={seasonCompetition}
      onChange={(e) => setSeasonCompetition(e.target.value)}
    >
      <option value="season">season</option>
      <option value="winter">winter</option>
      <option value="league">league</option>
    </select>

    <div className="grid grid-cols-2 gap-2 mt-2">
      <div>
        <label className="text-xs font-black text-neutral-600">Start date</label>
        <input
          className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm"
          type="date"
          value={seasonStart}
          onChange={(e) => setSeasonStart(e.target.value)}
        />
      </div>
      <div>
        <label className="text-xs font-black text-neutral-600">End date</label>
        <input
          className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm"
          type="date"
          value={seasonEnd}
          onChange={(e) => setSeasonEnd(e.target.value)}
        />
      </div>
    </div>

    {actionStatus ? (
      <div className="mt-2 text-xs rounded-xl px-3 py-2 border border-neutral-200 bg-neutral-50">
        {actionStatus}
      </div>
    ) : null}

    <div className="grid grid-cols-2 gap-2 mt-2">
      <button
        type="button"
        className="btn"
        onClick={() => {
          setCreateSeasonOpen(false);
          setActionStatus("");
        }}
        disabled={seasonBusy}
      >
        Cancel
      </button>
      <button type="submit" className="btn-primary" disabled={seasonBusy}>
        {seasonBusy ? "Creating…" : "Create season"}
      </button>
    </div>
  </form>
) : null}
      </div>

      {/* Create society */}
      <div className="mt-4 glass-card p-4 border border-neutral-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Society</div>
            <div className="mt-1 text-sm font-extrabold text-neutral-900">Create a new society</div>
            <div className="text-xs text-neutral-500">
              Captains can create a new society quickly — no invite code required.
            </div>
          </div>
          <button
            className={"btn-primary " + (!isAdmin ? "opacity-50 cursor-not-allowed" : "")}
            onClick={() => (isAdmin ? setCreateSocietyOpen(true) : null)}
            disabled={!isAdmin}
            title={!isAdmin ? "Sign in first" : "Create a new society"}
          >
            🏁 Create a new Society
          </button>
        </div>

        {createSocietyOpen ? (
          <form
            className="mt-4 grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateSociety();
            }}
          >
            <label className="text-xs font-black text-neutral-600">Society name</label>
            <input
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm"
              value={societyName}
              onChange={(e) => setSocietyName(e.target.value)}
              placeholder="e.g. Dennis The Menace"
            />

            <label className="text-xs font-black text-neutral-600 mt-2">Slug (optional)</label>
            <input
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm"
              value={societySlug}
              onChange={(e) => setSocietySlug(e.target.value)}
              placeholder="e.g. dennis-the-menace"
            />
            <div className="text-xs text-neutral-500">
              This becomes the golfer link: <span className="font-mono">/golf/&lt;slug&gt;</span>
            </div>

            <label className="text-xs font-black text-neutral-600 mt-2">First season label</label>
            <input
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm"
              value={societyFirstSeason}
              onChange={(e) => setSocietyFirstSeason(e.target.value)}
              placeholder="e.g. Holiday"
            />

            <label className="text-xs font-black text-neutral-600 mt-2">Competition type</label>
            <select
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm"
              value={societyCompetition}
              onChange={(e) => setSocietyCompetition(e.target.value)}
            >
              <option value="season">season</option>
              <option value="winter">winter</option>
              <option value="league">league</option>
            </select>

            {actionStatus ? (
              <div className="mt-2 text-xs rounded-xl px-3 py-2 border border-neutral-200 bg-neutral-50">{actionStatus}</div>
            ) : null}

            <div className="flex items-center justify-between gap-2 mt-2">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setActionStatus("");
                  setCreateSocietyOpen(false);
                }}
              >
                Back
              </button>
              <button className="btn-primary" disabled={societyBusy}>
                {societyBusy ? "Creating…" : "Create society"}
              </button>
            </div>

            <div className="mt-2 text-xs text-neutral-500">
              Note: this uses a Supabase RPC called <span className="font-mono">create_society_as_captain</span>.
              If you haven't created that function yet, this will fail.
            </div>
          </form>
        ) : null}
      </div>
      {/* Captain access (app admin only) */}
      {isSuperAdmin ? (
        <div className="mt-4 glass-card p-4 border border-neutral-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Captains</div>
              <div className="mt-1 text-sm font-extrabold text-neutral-900">Add captain by email</div>
              <div className="text-xs text-neutral-500">
                Add an email here. When they sign in via magic link, they’ll automatically become captain.
              </div>
            </div>
          </div>

          <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={handleAddCaptainEmail}>
            <label className="flex-1 min-w-[240px]">
              <div className="text-xs font-bold text-neutral-500 mb-1">Captain email</div>
              <input
                className="input w-full"
                type="email"
                value={captainEmail}
                onChange={(e) => setCaptainEmail(e.target.value)}
                placeholder="captain@domain.com"
              />
            </label>
            <button type="submit" className="btn-primary" disabled={captainBusy || !captainEmail.trim()}>
              {captainBusy ? "Adding…" : "Add captain"}
            </button>
          </form>

          {captainStatus ? (
            <div className="mt-2 text-xs font-semibold text-neutral-600">{captainStatus}</div>
          ) : null}
        </div>
      ) : null}


      {/* Player link */}
      <div className="mt-4 glass-card p-4 border border-neutral-200">
        <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Players view</div>
        <div className="mt-1 text-sm font-extrabold text-neutral-900">Share this link with golfers</div>
        <div className="mt-2 text-sm">
          <a
            className="underline font-mono"
            href={`https://kevanojb.github.io/golf/${String(activeSocietySlug || "")}`}
            target="_blank"
            rel="noreferrer"
          >
            {`https://kevanojb.github.io/golf/${String(activeSocietySlug || "")}`}
          </a>
        </div>
        {!activeSocietySlug ? (
          <div className="mt-2 text-xs text-amber-700">
            This society has no slug set — please set a slug so golfers can use a friendly URL.
          </div>
        ) : null}
      </div>

      <div className="mt-4 glass-card p-4 border border-neutral-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Players</div>
            <div className="mt-1 text-sm font-extrabold text-neutral-900">Manage Players</div>
            <div className="text-xs text-neutral-500">
              Show/hide players across leaderboards & reports.
              {Number.isFinite(visiblePlayersCount) && Number.isFinite(totalPlayersCount) && totalPlayersCount
                ? (<span className="ml-2">Showing <span className="font-black">{visiblePlayersCount}</span> / <span className="font-black">{totalPlayersCount}</span></span>)
                : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className={"btn-primary " + (!isAdmin ? "opacity-50 cursor-not-allowed" : "")}
              onClick={() => isAdmin && openPlayersAdmin && openPlayersAdmin()}
              disabled={!isAdmin}
              title={!isAdmin ? "Sign in first" : "Choose which players are included for everyone"}
            >
              👥 Manage Players
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-neutral-500">
        Tip: League & Eclectic are public — Admin is only for captains.
      </div>
    </section>
  );
}

function PastEvents({ sharedGroups, loadShared, setView }) {

  // Deterministic hash -> number (stable "random" thumbs per course/event)
  function _hashToInt(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0);
  }

  function _formatDate(ms) {
    try {
      if (!Number.isFinite(ms)) return "";
      // force UTC so Safari doesn't shift a day
      return new Date(ms).toLocaleDateString("en-GB", { timeZone: "UTC", year:"numeric", month:"short", day:"2-digit" });
    } catch {
      return "";
    }
  }

  // "Random golf course image" without external hosting:
  // Generate a mini SVG "photo" card with gradient sky/grass + subtle fairway curves.
  function _thumbDataUri(seedText) {
    const seed = _hashToInt(seedText || "golf");
    const hueA = 95 + (seed % 40);            // greens
    const hueB = 190 + ((seed >> 5) % 40);    // blues
    const hueC = 35 + ((seed >> 9) % 25);     // warm highlights
    const hill = 18 + ((seed >> 12) % 14);

    const svg =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="hsl(${hueB} 55% 72%)"/>
      <stop offset="1" stop-color="hsl(${hueB} 45% 86%)"/>
    </linearGradient>
    <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="hsl(${hueA} 45% 34%)"/>
      <stop offset="1" stop-color="hsl(${hueA} 55% 22%)"/>
    </linearGradient>
    <radialGradient id="sun" cx="78%" cy="22%" r="55%">
      <stop offset="0" stop-color="hsla(${hueC} 95% 75% .55)"/>
      <stop offset=".55" stop-color="hsla(${hueC} 95% 75% .18)"/>
      <stop offset="1" stop-color="hsla(${hueC} 95% 75% 0)"/>
    </radialGradient>
    <filter id="grain" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="
        1 0 0 0 0
        0 1 0 0 0
        0 0 1 0 0
        0 0 0 .08 0"/>
    </filter>
  </defs>

  <rect width="640" height="360" fill="url(#sky)"/>
  <rect width="640" height="360" fill="url(#sun)"/>
  <path d="M0 ${170-hill} C 110 ${155-hill}, 240 ${190-hill}, 330 ${175-hill} C 450 ${155-hill}, 530 ${195-hill}, 640 ${180-hill} L 640 360 L 0 360 Z"
        fill="url(#grass)"/>
  <path d="M-40 360 C 110 ${280+hill}, 210 ${230+hill}, 340 ${240+hill} C 480 ${255+hill}, 540 ${310+hill}, 700 360 L 700 420 L -40 420 Z"
        fill="hsla(${hueA} 55% 46% .35)"/>
  <path d="M60 360 C 160 ${310+hill}, 250 ${245+hill}, 330 ${250+hill} C 430 ${258+hill}, 500 ${315+hill}, 610 360"
        stroke="hsla(${hueA} 70% 62% .45)" stroke-width="16" stroke-linecap="round" fill="none"/>
  <path d="M86 360 C 175 ${312+hill}, 255 ${260+hill}, 330 ${258+hill} C 420 ${265+hill}, 490 ${322+hill}, 585 360"
        stroke="hsla(${hueA} 65% 78% .25)" stroke-width="10" stroke-linecap="round" fill="none"/>
  <circle cx="520" cy="260" r="22" fill="hsla(0 0% 100% .22)"/>
  <circle cx="520" cy="260" r="10" fill="hsla(0 0% 100% .25)"/>
  <g opacity=".9">
    <rect x="118" y="146" width="3" height="86" rx="1.5" fill="hsla(0 0% 100% .65)"/>
    <path d="M121 148 L 165 158 L 121 170 Z" fill="hsla(${hueC} 95% 62% .9)"/>
  </g>
  <rect width="640" height="360" filter="url(#grain)" opacity=".55"/>
</svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  // Course photo overrides (you can expand this later by pulling URLs from Supabase)
  // Course photo URLs fetched from Supabase (keeps this HTML file small).
  const photoCacheRef = React.useRef(new Map());

  const [photoReady, setPhotoReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    async function loadAllPhotos() {
      const slugs = new Set();

      sharedGroups.forEach(group => {
        group.events.forEach(item => {
          const course = (item.courseName || item.name || "").replace(/\.csv$/i, "");
          const slug = _normSlugFromCourseName(course);
          if (slug) slugs.add(slug);
        });
      });

      for (const slug of slugs) {
        if (!photoCacheRef.current.has(slug)) {
          await _getPhotoUrlsForSlug(slug);
        }
      }

      if (!cancelled) setPhotoReady(true);
    }

    loadAllPhotos();
    return () => { cancelled = true; };
  }, [sharedGroups]);

 // slug -> [urls]
  const inflightRef = React.useRef(new Map());   // slug -> Promise

  function _normSlugFromCourseName(raw) {
    return (raw || "")
      .toLowerCase()
      .replace(/\b(19|20)\d{2}\b/g, "")                 // strip years
      .replace(/\b(golf\s*club|golf|club)\b/g, "")      // strip words
      .replace(/\bgc\b/g, "")                           // strip GC
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/(^-|-$)/g, "")
      .trim();
  }

  async function _getPhotoUrlsForSlug(slug) {
    const key = (slug || "").trim();
    if (!key) return null;

    const cache = photoCacheRef.current;
    if (cache.has(key)) return cache.get(key);

    const inflight = inflightRef.current;
    if (inflight.has(key)) return await inflight.get(key);

    const p = (async () => {
      try {
        if (!window.__supabase_client__) return null;
        const client = window.__supabase_client__;

        const { data, error } = await client
          .from("courses")
          .select("photo_urls")
          .eq("slug", key)
          .maybeSingle();

        if (error) return null;
        const urls = Array.isArray(data?.photo_urls) ? data.photo_urls : null;
        cache.set(key, urls);
        return urls;
      } catch {
        return null;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, p);
    return await p;
  }

  function _pickFromUrls(urls, seedText) {
    if (!urls || urls.length === 0) return null;
    const seed = _hashToInt(seedText || "golf");
    return urls[seed % urls.length];
  }  const [tick, setTick] = React.useState(0);
  function _bump() { setTick(t => (t + 1) % 1000000); }


  return (
    <section className="rounded-2xl p-3 md:p-4 bg-white border border-squab-200 shadow-sm">
      <Breadcrumbs items={[{ label: "Analyse Game" }]} />

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-squab-900">Analyse Game</h2>
      </div>

      {sharedGroups.length === 0 && (
        <div className="text-sm text-neutral-600 p-2">No shared CSVs yet.</div>
      )}

      <div className="text-xs text-neutral-500 mb-3">
        Pick an event by course image (name + date). No more boring filenames.
      </div>

      {sharedGroups.map((group) => (
        <div key={group.year} className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-black tracking-widest uppercase text-neutral-500">
              {group.year}
            </div>
            <div className="text-[11px] text-neutral-400">
              {group.events.length} event{group.events.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="event-grid">
            {group.events.map((item) => {
              const course = (item.courseName || item.name || "").replace(/\.csv$/i, "");
              const date = _formatDate(item.dateMs);
              const seed = (course || "") + "|" + String(item.dateMs || "") + "|" + String(item.path || "");
              let thumb = _thumbDataUri(seed);

              // Try course photos from Supabase (non-blocking): derive slug from course string and fetch photo_urls.
              const slugGuess = _normSlugFromCourseName(course);
              console.log("COURSE:", course, "=> SLUG IT SEARCHES:", slugGuess);
              const cached = photoCacheRef.current.get(slugGuess);
              const picked = _pickFromUrls(cached, seed);
              if (picked) {
                thumb = picked;
              } else if (slugGuess && !inflightRef.current.has(slugGuess) && !photoCacheRef.current.has(slugGuess)) {
                // Fire-and-forget; when loaded, bump state to refresh cards.
                _getPhotoUrlsForSlug(slugGuess).then(() => _bump());
              }

              return (
                <button
                  key={item.path}
                  className="event-card"
                  onClick={async () => {
                    await loadShared(item);
                    setView("event");
                  }}
                  title={(date ? (date + " — ") : "") + course}
                >
                  <div className="event-thumb" style={{ backgroundImage: `url("${thumb}")` }} />
                  <div className="event-overlay">
                    <div className="event-title">{course || "Event"}</div>
                    <div className="event-meta">
                      <span className="pill-mini">{date || "Date unknown"}</span>
                      <span className="pill-mini subtle">{(item.format || "").toUpperCase() || "ROUND"}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}



function PlayerScorecardView({ computed, courseTees, setView }) {
  const [selectedPlayer, setSelectedPlayer] = useState("");

  useEffect(() => {
    if (!selectedPlayer && computed && computed.length) setSelectedPlayer(computed[0].name);
  }, [computed, selectedPlayer]);

  const holes = useMemo(() => detectEventHoleCount(computed), [computed]);

  if (!computed || !computed.length) {
    return (
      <section className="content-card p-4 md:p-6">
        <SoloNav
        setView={setView}
        title="Player Scorecard"
        left={<EventNav setView={setView} hasEvent={!!(computed && computed.length)} />}
      />
        <p className="text-neutral-600">Load an event to see player scorecards.</p>
      </section>
    );
  }

  const names = computed.map((p) => p.name);
  const player = computed.find((p) => p.name === selectedPlayer) || computed[0];
  const tee = chooseTeeForPlayer(player, courseTees);

  const gross = Array.isArray(player.grossPerHole) ? player.grossPerHole : Array(18).fill(NaN);
  const imputed = Array.isArray(player.imputedMask) ? player.imputedMask : Array(18).fill(false);
  const pts = Array.isArray(player.perHole) ? player.perHole : Array(18).fill(NaN);

  const pars = (tee && Array.isArray(tee.pars) && tee.pars.length === 18) ? tee.pars : Array(18).fill("—");
  const yards = (tee && Array.isArray(tee.yards) && tee.yards.length === 18) ? tee.yards : Array(18).fill("—");
  const si = (tee && Array.isArray(tee.si) && tee.si.length === 18) ? tee.si : Array(18).fill("—");

  const grossTotal = gross.reduce((s, v) => (Number.isFinite(v) ? s + v : s), 0);
  const ptsTotal = pts.reduce((s, v) => (Number.isFinite(Number(v)) ? s + Number(v) : s), 0);

  return (
    <section className="content-card p-4 md:p-6">
      <SoloNav
        setView={setView}
        title="Player Scorecard"
        left={<EventNav setView={setView} hasEvent={!!(computed && computed.length)} />}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="text-xs text-neutral-600">Player</div>
          <select
            className="rounded-2xl border border-squab-200 px-3 py-2 bg-white text-sm min-w-[220px]"
            value={player.name}
            onChange={(e) => setSelectedPlayer(e.target.value)}
          >
            {names.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <div className="text-[11px] text-neutral-500 mt-1">
            Tee: <span className="font-semibold">{player.teeLabel || (tee ? tee.teeName : "—")}</span>
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          <div className="px-3 py-2 rounded-2xl bg-white border border-squab-200">
            <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Gross</div>
            <div className="text-lg font-extrabold tabular-nums">{grossTotal || "—"}</div>
          </div>
          <div className="px-3 py-2 rounded-2xl bg-white border border-squab-200">
            <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Stableford</div>
            <div className="text-lg font-extrabold tabular-nums">{ptsTotal || "—"}</div>
          </div>
        </div>
      </div>

      {!tee ? (
        <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
          No matching tee layout found for this player. Yards/SI may be blank.
        </div>
      ) : null}

      <div className="overflow-auto table-wrap">
        <table className="min-w-full text-xs md:text-sm table-zebra">
          <thead>
            <tr className="border-b border-squab-200 bg-squab-50 text-left">
              <th>Hole</th>
              <th className="text-right px-3">Par</th>
              <th className="text-right px-3">Yards</th>
              <th className="text-right px-3">SI</th>
              <th className="text-right px-3 border-l border-squab-200 pl-4">Gross</th>
              <th className="text-right px-3">Pts</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: holes }, (_, i) => (
              <tr key={i} className="border-b">
                <td>{i + 1}</td>
                <td className="text-right px-3 tabular-nums">{pars[i] ?? "—"}</td>
                <td className="text-right px-3 tabular-nums">{yards[i] ?? "—"}</td>
                <td className="text-right px-3 tabular-nums">{si[i] ?? "—"}</td>
                <td className="text-right px-3 tabular-nums border-l border-squab-200 pl-4 font-extrabold">
                  {(() => {
                    const gVal = gross[i];
                    const imp = !!imputed[i];
                    if (imp && Number.isFinite(gVal)) {
                      return (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-900">
                          <span className="tabular-nums">{gVal}</span>
                          <span className="text-[10px] font-black uppercase tracking-wide">NDB</span>
                        </span>
                      );
                    }
                    return Number.isFinite(gVal) ? gVal : "—";
                  })()}
                </td>
                <td className="text-right px-3 tabular-nums font-semibold">
                  {Number.isFinite(Number(pts[i])) ? Number(pts[i]) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

   // --- EVENT SCREEN (WITH CALCULATOR) ---
   function EventScreen({ computed, setView, courseSlope, setCourseSlope, courseRating, setCourseRating, startHcapMode, setStartHcapMode, nextHcapMode, setNextHcapMode, oddsMaxRounds, setOddsMaxRounds, seasonRoundsFiltered, seasonRoundsAll, seasonModelAll, oddsExcludeMap, oddsExcludedNames, setExcludeFromOdds }) {
          

          const [showModelInternals, setShowModelInternals] = useState(false);

          // ---- Next Event Winner Odds (Deterministic Monte Carlo, Stableford points) ----
          const winnerOdds = useMemo(() => {
            const isExcludedName = (nm) => {
              const k = normalizeName(String(nm || ""));
              return !!(k && oddsExcludeMap && oddsExcludeMap[k]);
            };
            const currentRows = (Array.isArray(computed) ? computed : []).filter(r => r && r.name && !isExcludedName(r.name));
            // season history is derived below (prefer seasonModelAll; fall back to seasonRounds*)
            // NOTE: odds use full season history (seasonRoundsAll) to avoid tiny sample sizes; filters only affect on-screen leaderboard.
            // League roster = anyone who has appeared in season rounds, plus anyone in the current round
            const byKeyCurrent = new Map();
            currentRows.forEach(r => {
              const k = normalizeName(String(r.name||""));
              if (k) byKeyCurrent.set(k, r);
            });
            const leagueKeys = new Set();

// Flatten season history into per-player history rows
const seasonPlayerRows = [];
const roundStats = []; // per-round field averages (for course/difficulty normalization)

const _pushPts = (obj) => {
  // stableford points (try common keys; fall back to summing per-hole points)
  let pts = Number(obj?.pts ?? obj?.points ?? obj?.stableford ?? obj?.sf ?? obj?.totalPoints ?? obj?.netPoints);
  if (!Number.isFinite(pts) && Array.isArray(obj?.perHole)) {
    try { pts = obj.perHole.reduce((a,b)=>a + (Number(b)||0), 0); } catch (e) { /* ignore */ }
  }
  return pts;
};

// Prefer seasonModelAll (same dataset Player Progress is using). Fall back to raw season rounds if needed.
if (seasonModelAll && Array.isArray(seasonModelAll.players) && seasonModelAll.players.length) {
  // Build a per-round file bucket so we can compute round and group averages
  const byFile = new Map(); // fileKey -> { pts: [], byGroup: Map(groupKey -> pts[]) , dateMs }
  const entries = []; // flat { k, name, pts, hi, dateMs, gender, teeLabel, groupKey, file }

  for (const p of (seasonModelAll.players || [])) {
    const nm = String(p?.name || "").trim();
    const k = normalizeName(nm);
    if (!k) continue;
    if (isExcludedName(nm)) continue;

    const series = Array.isArray(p?.series) ? p.series : [];
    for (const s of series) {
      const pts = _pushPts(s);
      if (!Number.isFinite(pts)) continue;

      const dateMs = Number.isFinite(Number(s?.dateMs)) ? Number(s.dateMs) : null;
      const file = String(s?.file ?? "");
      const teeLabel = String(s?.teeLabel ?? s?.tee ?? s?.tee_name ?? s?.teeName ?? "").toLowerCase().trim();
      const genderRaw = String(s?.gender ?? s?.sex ?? p?.gender ?? p?.sex ?? "").toUpperCase();
      const gender = (genderRaw === "F" || genderRaw === "FEMALE" || genderRaw === "W" || genderRaw === "WOMEN") ? "F" : "M";
      const groupKey = teeLabel || gender;

      const hi = Number(s?.hi ?? s?.startExact ?? s?.index ?? s?.handicap ?? s?.exact ?? p?.hi ?? p?.startExact);

      entries.push({ k, name: nm, pts, hi, dateMs, gender, teeLabel, groupKey, file });
      leagueKeys.add(k);

      if (file) {
        if (!byFile.has(file)) byFile.set(file, { pts: [], byGroup: new Map(), dateMs });
        const b = byFile.get(file);
        b.pts.push(pts);
        if (Number.isFinite(dateMs) && !Number.isFinite(Number(b.dateMs))) b.dateMs = dateMs;
        if (!b.byGroup.has(groupKey)) b.byGroup.set(groupKey, []);
        b.byGroup.get(groupKey).push(pts);
      }
    }
  }

  // Compute per-round averages
  const roundAvgByFile = new Map();
  const groupAvgByFileGroup = new Map(); // file|groupKey -> avg
  for (const [file, b] of byFile.entries()) {
    const ra = b.pts.length ? (b.pts.reduce((a,c)=>a+c,0)/b.pts.length) : 36;
    roundAvgByFile.set(file, ra);
    roundStats.push({ dateMs: Number.isFinite(Number(b.dateMs)) ? Number(b.dateMs) : null, roundAvg: ra, n: b.pts.length, file });

    for (const [gk, arr] of b.byGroup.entries()) {
      const ga = arr.length ? (arr.reduce((a,c)=>a+c,0)/arr.length) : ra;
      groupAvgByFileGroup.set(file + "|" + gk, ga);
    }
  }

  // Attach round/group averages and push into seasonPlayerRows
  for (const e of entries) {
    const ra = e.file ? (roundAvgByFile.get(e.file) ?? 36) : 36;
    const ga = e.file ? (groupAvgByFileGroup.get(e.file + "|" + e.groupKey) ?? ra) : ra;
    seasonPlayerRows.push({ ...e, roundAvg: ra, groupAvg: ga });
  }

} else {
  // Fallback: derive from raw season rounds array
  const seasonArr = Array.isArray(seasonRoundsAll) ? seasonRoundsAll : (Array.isArray(seasonRoundsFiltered) ? seasonRoundsFiltered : []);
  seasonArr.forEach(sr => {
    const parsed = sr && sr.parsed ? sr.parsed : sr; // tolerate already-parsed shapes
    const players = (parsed && Array.isArray(parsed.players)) ? parsed.players : [];
    const dateMs = Number.isFinite(sr?.dateMs) ? sr.dateMs : (Number.isFinite(parsed?.dateMs) ? parsed.dateMs : null);
    const file = String(sr?.file ?? parsed?.file ?? "");

    const ptsList = players.map(p => _pushPts(p)).filter(Number.isFinite);
    const roundAvg = ptsList.length ? (ptsList.reduce((a,b)=>a+b,0) / ptsList.length) : 36;

    const groupSums = new Map();
    const groupCounts = new Map();
    for (const pp of players) {
      const gPts = _pushPts(pp);
      if (!Number.isFinite(gPts)) continue;
      const teeLabel = String(pp?.teeLabel ?? pp?.tee ?? pp?.tee_name ?? pp?.teeName ?? "").toLowerCase().trim();
      const genderRaw = String(pp?.gender ?? pp?.sex ?? "").toUpperCase();
      const gender = (genderRaw === "F" || genderRaw === "FEMALE" || genderRaw === "W" || genderRaw === "WOMEN") ? "F" : "M";
      const groupKey = teeLabel || gender;
      groupSums.set(groupKey, (groupSums.get(groupKey) || 0) + gPts);
      groupCounts.set(groupKey, (groupCounts.get(groupKey) || 0) + 1);
    }
    const groupAvgByKey = new Map();
    for (const [k, sum] of groupSums.entries()) {
      const c = groupCounts.get(k) || 1;
      groupAvgByKey.set(k, sum / c);
    }

    if (Number.isFinite(dateMs)) roundStats.push({ dateMs, roundAvg, n: ptsList.length, file });

    players.forEach(p => {
      const nm = String(p?.name || p?.player || p?.playerName || "").trim();
      const k = normalizeName(nm);
      if (!k) return;
      if (isExcludedName(nm)) return;

      const pts = _pushPts(p);
      const hi = Number(p?.startExact ?? p?.index ?? p?.hi ?? p?.handicap ?? p?.exact ?? p?.hiExact);

      const teeLabel = String(p?.teeLabel ?? p?.tee ?? p?.tee_name ?? p?.teeName ?? "").toLowerCase().trim();
      const genderRaw = String(p?.gender ?? p?.sex ?? "").toUpperCase();
      const gender = (genderRaw === "F" || genderRaw === "FEMALE" || genderRaw === "W" || genderRaw === "WOMEN") ? "F" : "M";
      const groupKey = teeLabel || gender;
      const groupAvg = groupAvgByKey.get(groupKey) ?? roundAvg;

      seasonPlayerRows.push({ k, name: nm, pts, hi, dateMs, roundAvg, gender, teeLabel, groupKey, groupAvg, file });
      leagueKeys.add(k);
    });
  });
}

// Ensure current-round players are included even if season is empty
byKeyCurrent.forEach((_, k) => leagueKeys.add(k));

// Build per-player lookup for history
const histByKey = new Map();
for (const r of seasonPlayerRows) {
  if (!histByKey.has(r.k)) histByKey.set(r.k, []);
  histByKey.get(r.k).push(r);
}
// sort each history chronologically
for (const arr of histByKey.values()) {
  arr.sort((a,b) => {
    const da = Number.isFinite(a.dateMs) ? a.dateMs : -Infinity;
    const db = Number.isFinite(b.dateMs) ? b.dateMs : -Infinity;
    return da - db;
  });
}

// ---- League baseline (captures "course/day difficulty") ----
const _rounds = roundStats
  .filter(r => Number.isFinite(r?.dateMs) && Number.isFinite(r?.roundAvg))
  .sort((a,b)=>a.dateMs-b.dateMs)
  .slice(-20);

// exponentially weighted mean/variance for round average points
const baseDecay = 0.9;
let bW = 0, bS = 0;
for (let i=0;i<_rounds.length;i++){
  const age = (_rounds.length-1)-i;
  const w = Math.pow(baseDecay, age);
  bW += w;
  bS += w * _rounds[i].roundAvg;
}
const leagueBaseMu = (bW>0 ? (bS/bW) : 36);

let bVarW = 0, bVarS = 0;
for (let i=0;i<_rounds.length;i++){
  const age = (_rounds.length-1)-i;
  const w = Math.pow(baseDecay, age);
  bVarW += w;
  bVarS += w * Math.pow(_rounds[i].roundAvg - leagueBaseMu, 2);
}
// baseline sigma: round-to-round swing in field scoring; keep it in a sensible band
const leagueBaseSigma = Math.max(0.8, Math.min(4.0, (bVarW>0 ? Math.sqrt(bVarS/bVarW) : 1.6)));

// League-wide relationship between Handicap Index (HI) and Stableford performance vs field.
// We learn this from season history so we can shrink player-specific estimates toward something sane.
let leagueHiSlope = 0.75; // default: ~0.75 Stableford pts per 1 HI (relative to field)
try {
  let nLS = 0;
  let meanX = 0, meanY = 0;
  // First pass: means
  for (let i=0;i<seasonPlayerRows.length;i++){
    const r = seasonPlayerRows[i];
    const x = Number(r.hi);
    const y = Number(r.pts) - Number(r.roundAvg);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    nLS += 1;
    meanX += x;
    meanY += y;
  }
  if (nLS >= 20) {
    meanX /= nLS; meanY /= nLS;
    let sxx = 0, sxy = 0;
    for (let i=0;i<seasonPlayerRows.length;i++){
      const r = seasonPlayerRows[i];
      const x = Number(r.hi);
      const y = Number(r.pts) - Number(r.roundAvg);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const dx = x - meanX;
      const dy = y - meanY;
      sxx += dx*dx;
      sxy += dx*dy;
    }
    if (sxx > 1e-6) {
      leagueHiSlope = sxy / sxx;
      // cap to a sensible range: higher HI should generally increase points
      leagueHiSlope = Math.max(0.0, Math.min(2.0, leagueHiSlope));
    }
  }
} catch {}


// ---- Build per-player model rows ----
const rows = Array.from(leagueKeys).map(k => {
  const cur = byKeyCurrent.get(k);
  const hist = histByKey.get(k) || [];

  const name = cur ? String(cur.name || "") : (hist.length ? String(hist[hist.length-1].name || "") : "");

  // residual history = player points minus that round's field average (normalizes for easy/hard rounds)
  const resHist = hist
    .map(h => {
      const pts = Number(h.pts);
      const ra = Number(h.groupAvg ?? h.roundAvg);
      if (!Number.isFinite(pts) || !Number.isFinite(ra)) return null;
      return { res: (pts - ra), pts, ra, dateMs: h.dateMs, hi: h.hi, groupKey: h.groupKey, gender: h.gender, teeLabel: h.teeLabel };
    })
    .filter(Boolean);

  const _oddsMaxN = Math.max(3, Math.min(12, Number(oddsMaxRounds) || 12));
  const lastN = resHist.slice(-_oddsMaxN); // chronological already

  // Exponentially weighted mean of residuals (recent form matters more)
  const decay = 0.85;
  let wsum = 0, rsum = 0;
  for (let i=0;i<lastN.length;i++){
    const age = (lastN.length-1)-i;
    const w = Math.pow(decay, age);
    wsum += w;
    rsum += w * lastN[i].res;
  }
  const rawResMu = wsum>0 ? (rsum/wsum) : 0;

  // Small-sample shrinkage toward 0 (league-average) so newcomers don't get silly odds
  const n = lastN.length;
  const shrink = n / (n + 6); // 0..1
  const resMu = rawResMu * shrink;

  // Weighted residual sigma (with a gentle prior)
  let vW = 0, vS = 0;
  for (let i=0;i<lastN.length;i++){
    const age = (lastN.length-1)-i;
    const w = Math.pow(decay, age);
    vW += w;
    vS += w * Math.pow(lastN[i].res - rawResMu, 2);
  }
  const rawResSigma = (vW>0 ? Math.sqrt(vS/vW) : 3.8);
  const resSigma = Math.max(1.2, Math.min(7.5, (rawResSigma*(0.6+0.4*shrink)) + (1-shrink)*3.0));

  // Trend (points per round) from weighted linear regression on residuals
  let formTrend = 0;
  if (n >= 3) {
    let sw=0, sx=0, sy=0, sxx=0, sxy=0;
    for (let i=0;i<n;i++){
      const age = (n-1)-i;
      const w = Math.pow(decay, age);
      const x = i;           // 0..n-1 (older -> smaller i)
      const y = lastN[i].res;
      sw += w; sx += w*x; sy += w*y; sxx += w*x*x; sxy += w*x*y;
    }
    const denom = (sw*sxx - sx*sx);
    if (Math.abs(denom) > 1e-9) {
      formTrend = (sw*sxy - sx*sy)/denom; // residual points per round
      // clamp trend to avoid silly extrapolation
      formTrend = Math.max(-2.5, Math.min(2.5, formTrend));
    }
  }

  // start handicap: prefer current row's startExact, else last known from history
  const lastHist = hist.length ? hist[hist.length-1] : null;
  const startExactRaw = cur ? Number(cur.startExact ?? cur.index ?? cur.hi ?? 0)
    : Number(lastHist?.hi ?? 0);
  const prevStartExact = clamp(startExactRaw, 0, 36);

  // next handicap: if played current round, use that computed nextExactNum; otherwise no change
  const nextExactRaw = cur ? Number(cur.nextExactNum ?? cur.nextExact ?? cur.nextExactRaw ?? cur.nextExactDisplay ?? prevStartExact)
    : prevStartExact;
  const nextExactNum = clamp(nextExactRaw, 0, 36);

  // For NEXT-round forecasting:
  // - In No change mode, we tee off on the current index (prevStartExact).
  // - In WHS Diff / Legacy Formula, we tee off on the computed NEXT handicap.
  // For NEXT-round forecasting, choose which HI we tee off on.
// UI values in this app have historically been: "same" (No Change), "den" (Legacy), "whs" (WHS diff)
// but we also tolerate "nochange" for older builds.
const _mode = String(nextHcapMode || "").toLowerCase();
const noChange = (_mode === "same" || _mode === "nochange" || _mode === "no-change" || _mode === "no_change");
const startExact = noChange ? prevStartExact : nextExactNum;

// --- Player-specific HI→Stableford sensitivity (learned from season history) ---
// We learn how this player's Stableford residual (pts - roundAvg) changes with HI.
// Then we predict the residual at the HI they'll tee off on next round.
// This captures "big cut after a spike score → less likely to spike again".
let hiMean = prevStartExact;
let hiSlope = leagueHiSlope; // shrink toward league estimate by default
try {
  let wH=0, xS=0, yS=0;
  for (let i=0;i<lastN.length;i++){
    const age = (lastN.length-1)-i;
    const w = Math.pow(decay, age);
    const x = Number(lastN[i].hi);
    const y = Number(lastN[i].res);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    wH += w;
    xS += w * x;
    yS += w * y;
  }
  if (wH > 0) {
    const mx = xS / wH;
    const my = yS / wH;
    hiMean = mx;

    let sxx=0, sxy=0, nPairs=0;
    for (let i=0;i<lastN.length;i++){
      const age = (lastN.length-1)-i;
      const w = Math.pow(decay, age);
      const x = Number(lastN[i].hi);
      const y = Number(lastN[i].res);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const dx = x - mx;
      const dy = y - my;
      sxx += w * dx*dx;
      sxy += w * dx*dy;
      nPairs += 1;
    }

    // Ridge to avoid blowing up with tiny HI variance (many players don't change HI much over 6 rounds)
    const ridge = 1.25; // acts like a prior HI variance
    const rawSlope = (sxx > 1e-6) ? (sxy / (sxx + ridge)) : leagueHiSlope;

    // Shrink toward league slope for small samples
    const shrinkSlope = nPairs / (nPairs + 4); // 0..1
    hiSlope = (rawSlope * shrinkSlope) + (leagueHiSlope * (1 - shrinkSlope));

    // cap to sane range (positive relationship)
    hiSlope = Math.max(0.0, Math.min(2.0, hiSlope));
  }
} catch {}

// Predict residual at the HI we tee off on next round.
const resAtStartHI = resMu + hiSlope * (startExact - hiMean);

// Expected points: league baseline + predicted residual at start HI, clamped.
const expPts = clamp(leagueBaseMu + resAtStartHI, 18, 56);

  const deltaHI = nextExactNum - startExact;

  // Model params for display
  const formMu = expPts - 36;
  // total uncertainty combines "day difficulty" + player volatility
  const totalSigma = Math.sqrt((leagueBaseSigma*leagueBaseSigma) + (resSigma*resSigma));
  const formSigma = Math.max(1.5, Math.min(9.0, totalSigma));

  return {
    name,
    startExact,
    nextExactNum,
    deltaHI,
    expPts,
    formMu,
    formSigma,
    formTrend,
    // components used by the simulator
    modelBaseMu: leagueBaseMu,
    modelBaseSigma: leagueBaseSigma,
                leagueHiSlope,
    modelResMu: resAtStartHI,
    modelResSigma: resSigma,
    roundsUsed: n
  };
}).filter(r => r && r.name);



            // Deterministic PRNG (seeded from current filtered data + next handicap mode)
            const _seedStr = JSON.stringify({
              mode: nextHcapMode,
              rows: rows.map(r => ({
                n: String(r.name||""),
                mu: Number(r.formMu||0),
                tr: Number(r.formTrend||0),
                sg: Number(r.formSigma||0),
                ex: Number(r.expPts||36),
                st: Number(r.startExact||0),
                nx: Number(r.nextExactNum||r.startExact||0),
              }))
            });

            const xmur3 = (str) => {
              let h = 1779033703 ^ str.length;
              for (let i = 0; i < str.length; i++) {
                h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
                h = (h << 13) | (h >>> 19);
              }
              return () => {
                h = Math.imul(h ^ (h >>> 16), 2246822507);
                h = Math.imul(h ^ (h >>> 13), 3266489909);
                h ^= h >>> 16;
                return h >>> 0;
              };
            };

            const mulberry32 = (a) => () => {
              let t = a += 0x6D2B79F5;
              t = Math.imul(t ^ (t >>> 15), t | 1);
              t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
              return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };

            const seed = xmur3(_seedStr)();
            const rand = mulberry32(seed);

            // helper: normal random (Box–Muller) using seeded RNG
            const randn = () => {
              let u = 0, v = 0;
              while (u === 0) u = rand();
              while (v === 0) v = rand();
              return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
            };

            const sims = 8000;
            const win = new Array(rows.length).fill(0);
            const top3 = new Array(rows.length).fill(0);
            const top4 = new Array(rows.length).fill(0);

            const baseMu = (rows[0] && Number.isFinite(Number(rows[0].modelBaseMu))) ? Number(rows[0].modelBaseMu) : 36;
const baseSigma = (rows[0] && Number.isFinite(Number(rows[0].modelBaseSigma))) ? Number(rows[0].modelBaseSigma) : 1.6;

// Precompute per-player mean components + individual sigma
const addMu = rows.map(r => {
  // modelResMu is already the predicted residual at the player's start HI
  const rm = Number.isFinite(Number(r.modelResMu)) ? Number(r.modelResMu) : 0;
  return rm;
});
const indSig = rows.map(r => {
  const s = Number.isFinite(Number(r.modelResSigma)) ? Number(r.modelResSigma) : 4.0;
  return Math.max(1.0, Math.min(8.0, s));
});
for (let s = 0; s < sims; s++){
              // simulate points for each player
              // Shared "day difficulty" draw (correlates all players a bit)
              const dayBase = baseMu + randn()*baseSigma;

              const simPts = rows.map((r,i) => {
                const p = dayBase + addMu[i] + randn()*indSig[i];
                // clamp to plausible stableford range
                return Math.max(0, Math.min(60, p));
              });

              // rank by points desc; deterministic tie-breaker from seeded RNG
              const order = simPts.map((p,i)=>({i,p, t:rand()}))
                .sort((a,b)=> (b.p - a.p) || (a.t - b.t));

              if (order.length){
                win[order[0].i]++;
                for (let k=0;k<Math.min(3,order.length);k++) top3[order[k].i]++;
                for (let k=0;k<Math.min(4,order.length);k++) top4[order[k].i]++;
              }
            }

            const out = rows.map((r,i)=>{
              const w = (win[i]/sims)*100;
              const t3 = (top3[i]/sims)*100;
              const t4 = (top4[i]/sims)*100;
              const muAdj = Number.isFinite(Number(r.formMu)) ? Number(r.formMu) : 0;
              const tr = Number.isFinite(Number(r.formTrend)) ? Number(r.formTrend) : 0;
              const sigma = Number.isFinite(Number(r.formSigma)) ? Number(r.formSigma) : 4.0;
              const tag = sigma <= 2.2 ? "Steady" : sigma <= 3.6 ? "Normal" : "Volatile";
              const trendTag = tr >= 0.25 ? "↑" : tr <= -0.25 ? "↓" : "→";
              const startHI = (Number.isFinite(Number(r.startExact)) ? Number(r.startExact) : 0);
              const nextRaw = (Number.isFinite(Number(r.nextExactNum)) ? Number(r.nextExactNum) : startHI);
              const nextHI = Math.max(0, Math.min(36, nextRaw));
              const deltaHI = nextHI - startHI;
              return {
                name: r.name,
                startHI,
                deltaHI,
                nextHI,
                winPct: w,
                top3Pct: t3,
                top4Pct: t4,
                expPts: (Number.isFinite(Number(r.expPts)) ? Number(r.expPts) : Math.max(18, Math.min(56, baseMu + addMu[i]))),
                muAdj,
                trend: tr,
                trendTag,
                sigma,
                tag,
                nextDisplay: (r.nextDisplay ?? (Number.isFinite(nextHI) ? nextHI.toFixed(1) : "—")),
                nextDisplayNum: nextHI,
                roundsUsed: Number.isFinite(Number(r.oddsRoundsUsed)) ? Number(r.oddsRoundsUsed) : (Number.isFinite(Number(r.formN)) ? Number(r.formN) : 0),
                similarRounds: Number.isFinite(Number(r.oddsSimilarRounds)) ? Number(r.oddsSimilarRounds) : 0,
                usedSimilar: !!r.oddsUsedSimilar
              };
            });

            // Two useful orderings:
            // 1) by win% (classic favourite list)
            const rowsByWin = [...out].sort((a,b)=>b.winPct-a.winPct);
            // 2) by Top-4% (contender list)
            const rowsByTop4 = [...out].sort((a,b)=>b.top4Pct-a.top4Pct);

            const p = rowsByTop4.map(r => r.top4Pct/100);
            const c4 = (p[0]||0) + (p[1]||0) + (p[2]||0) + (p[3]||0);
            const gap = (p[3]||0) - (p[4]||0);

            const confidence = (c4 >= 2.35 && gap >= 0.06) ? "High"
              : (c4 >= 2.10 && gap >= 0.03) ? "Medium"
              : "Low";


            // ---- DEBUG HOOK: inspect model + inputs in browser console ----
            try {
              const groups = Array.from(
                new Set(seasonPlayerRows.map(r => String(r.groupKey || "").toLowerCase()).filter(Boolean))
              ).sort();

              // keep existing debug payload if already set elsewhere
              const prev = (typeof window !== "undefined" && window.__ODDS_DEBUG && typeof window.__ODDS_DEBUG === "object")
                ? window.__ODDS_DEBUG
                : {};

              window.__ODDS_DEBUG = {
                ...prev,
                ts: Date.now(),
                seasonRoundsCount: (Array.isArray(roundStats) ? roundStats.length : 0),
                seasonRoundDates: (() => { try { const ds = (Array.isArray(roundStats)?roundStats:[]).map(r=>Number(r?.dateMs)).filter(Number.isFinite).map(ms=>new Date(ms).toISOString().slice(0,10)); return Array.from(new Set(ds)).sort(); } catch(e){ return []; } })(),
                seasonPlayerRowsCount: seasonPlayerRows.length,

                leagueBaseMu,
                leagueBaseSigma,
                leagueHiSlope,
                leagueWithinSigma: (rows && rows.length)
                  ? Math.sqrt(rows.reduce((a,r)=>a + Math.pow(Number(r.formSigma||0),2), 0) / Math.max(1, rows.length))
                  : null,
                groups,
                // raw per-player per-round rows (unfiltered season history)
                sample: seasonPlayerRows.slice(-120).map(r => ({
                  name: r.name,
                  pts: r.pts,
                  roundAvg: r.roundAvg,
                  roundStd: null,
                  teeLabel: r.teeLabel,
                  dateMs: r.dateMs,
                  gender: r.gender,
                  groupKey: r.groupKey,
                  groupAvg: r.groupAvg,
                  hi: r.hi,
                })),
                // model output snapshot (what the odds table should be showing)
                model: {
                  sims,
                  confidence,
                  c4,
                  gap,
                  rows: rowsByWin.slice(0, 60),
                  top4: rowsByTop4.slice(0, 4),
                }
              };
            } catch (e) {
              try { window.__ODDS_DEBUG = { error: String(e) }; } catch {}
            }
            // ---- END DEBUG ----
            return {
              sims,
              rows: rowsByWin,
              top4: rowsByTop4.slice(0,4),
              confidence,
              c4,
              gap,
            };
          }, [computed, nextHcapMode, oddsMaxRounds, seasonRoundsAll, seasonRoundsFiltered, seasonModelAll]);
return (
            <section className="content-card p-4 md:p-6">
              <Breadcrumbs items={[{ label: "Round Leaderboard" }]} />
<EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
              
              <div className="mb-6 bg-neutral-50 rounded-2xl border border-neutral-200 overflow-hidden shadow-sm">
                 <div className="bg-neutral-100 p-3 border-b border-neutral-200 flex flex-wrap gap-2 justify-between items-center">
                    <div className="flex items-center gap-2"><span className="text-lg">⚙️</span><h3 className="font-bold text-neutral-800 text-xs uppercase tracking-wider">Handicap Calculator</h3></div>
                    <div className="flex gap-4 text-xs">
                        <div className="flex items-center gap-2 bg-white px-2 py-1 rounded border border-neutral-200 shadow-sm">
                            <label className="text-neutral-500 font-bold uppercase text-[10px]">Slope</label>
                            <input 
                                type="number" 
                                className="w-12 font-bold text-neutral-900 text-center outline-none bg-transparent" 
                                value={courseSlope || ""} 
                                placeholder="-"
                                onChange={e => setCourseSlope(Number(e.target.value))} 
                            />
                        </div>
                        <div className="flex items-center gap-2 bg-white px-2 py-1 rounded border border-neutral-200 shadow-sm">
                            <label className="text-neutral-500 font-bold uppercase text-[10px]">Rating</label>
                            <input 
                                type="number" 
                                className="w-12 font-bold text-neutral-900 text-center outline-none bg-transparent" 
                                value={courseRating || ""} 
                                placeholder="-"
                                onChange={e => setCourseRating(Number(e.target.value))} 
                            />
                        </div>
                    </div>
                 </div>

                 <div className="p-4 grid md:grid-cols-2 gap-8">
                      <div>
                          <span className="block font-bold text-neutral-700 mb-2 text-sm">1. Today's Handicap Mode</span>
                          <div className="flex gap-2">
                             <button onClick={() => setStartHcapMode("raw")} className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${startHcapMode==="raw" ? "bg-emerald-700 text-white border-emerald-800 shadow-inner" : "bg-white text-neutral-700 hover:bg-neutral-100 border-neutral-200"}`}>Original</button>
                             <button onClick={() => setStartHcapMode("calc")} className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${startHcapMode==="calc" ? "bg-emerald-700 text-white border-emerald-800 shadow-inner" : "bg-white text-neutral-700 hover:bg-neutral-100 border-neutral-200"}`}>Apply Slope</button>
                          </div>
                          <p className="text-[10px] text-neutral-400 mt-2">
                              {startHcapMode === 'calc' 
                                ? `Calculating: HI × (${courseSlope || 0} ÷ 113) + (${courseRating || 0} − Par) = Course Hcap (ref)` 
                                : "Using exact playing handicap from the CSV file."}
                          </p>
                      </div>
                      <div>
                          <span className="block font-bold text-neutral-700 mb-2 text-sm">2. Next Handicap Preview</span>
                          <div className="flex gap-2">
                             <button onClick={() => setNextHcapMode("den")} className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${nextHcapMode==="den" ? "bg-neutral-900 text-white border-neutral-900 shadow-inner" : "bg-white text-neutral-700 hover:bg-neutral-100 border-neutral-200"}`}>Legacy Formula</button>
                             <button onClick={() => setNextHcapMode("whs")} className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${nextHcapMode==="whs" ? "bg-neutral-900 text-white border-neutral-900 shadow-inner" : "bg-white text-neutral-700 hover:bg-neutral-100 border-neutral-200"}`}>WHS Diff</button>
                             <button onClick={() => setNextHcapMode("same")} className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${nextHcapMode==="same" ? "bg-neutral-900 text-white border-neutral-900 shadow-inner" : "bg-white text-neutral-700 hover:bg-neutral-100 border-neutral-200"}`}>No Change</button>
                          </div>
                          <p className="text-[10px] text-neutral-400 mt-2">
                              {nextHcapMode === 'den' ? "Applies Cuts & Buffers to Starting Index." 
                              : nextHcapMode === 'whs' ? "Calculates differential from score." 
                              : "Keeps handicap exactly the same."}
                          </p>
                      </div>
                 </div>
              </div>

              <div className="overflow-auto table-wrap">
                <table className="min-w-full text-sm table-zebra">
                  <thead className="bg-neutral-50">
                    <tr className="text-left text-xs uppercase tracking-wide text-neutral-500 font-bold border-b border-squab-200">
                      <th className="py-3 px-3">#</th>
                      <th className="py-3 px-3">Name</th>
                      <th className="py-3 px-3 text-center">Index</th>
                      <th className="py-3 px-3 bg-squab-50 text-squab-800 border-x border-squab-200 text-center w-24">Playing</th>
                      <th className="py-3 px-3 text-center">Pts</th>
                      <th className="py-3 px-3 text-center">Back9</th>
                      <th className="py-3 px-3 text-center">League</th>
                      <th className="py-3 px-3 bg-neutral-100 border-l border-neutral-200 text-neutral-700 text-right">{nextHcapMode === 'whs' ? "Diff" : "Next"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {computed.map((r, i) => (
                      <tr key={i} className={"hover:bg-neutral-50 transition-colors " + (r.isWinner ? "ring-2 ring-emerald-400/60 ring-inset bg-emerald-50/10" : "")}>
                        <td className="py-3 px-3 font-bold text-squab-600">{r.position}</td>
                        <td className="py-3 px-3 font-medium text-neutral-900">{r.name}</td>
                        <td className="py-3 px-3 text-center text-neutral-400 font-mono text-xs">{r.startExact}</td>
                        <td className="py-3 px-3 text-center font-bold bg-squab-50 text-squab-900 border-x border-squab-100 text-lg">{startHcapMode === 'calc' ? (r.playingHcapRef ?? r.playingHcap) : r.playingHcap}</td>
                        <td className="py-3 px-3 text-center font-bold text-neutral-800">{r.points}</td>
                        <td className="py-3 px-3 text-center text-neutral-500 text-xs">{r.back9}</td>
                        <td className="py-3 px-3 text-center font-bold text-emerald-600">{r.leaguePoints}</td>
                        <td className="py-3 px-3 text-right bg-neutral-50 border-l border-neutral-200 font-mono text-neutral-700 font-bold">{r.nextDisplay}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Next Society Stableford — Winner Odds */}
              <div className="mt-5 panel-core p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-neutral-500 font-bold">Next Society Stableford</div>
                    <div className="text-lg font-black text-neutral-900">Winner odds (next HI)</div>
                    <div className="text-xs text-neutral-500 mt-1">
                      Based on each player’s last up to <b>{oddsMaxRounds}</b> rounds in the current filters, using <b>points − 36</b> form + volatility.
                    </div>
                  </div>

                  {Array.isArray(oddsExcludedNames) && oddsExcludedNames.length ? (
                    <div className="mt-2 text-[11px] text-neutral-600">
                      Hidden from odds (tap to re-include):
                      <div className="mt-1 flex flex-wrap gap-2">
                        {oddsExcludedNames.slice(0, 80).map((nm) => (
                          <label key={nm} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-neutral-200 bg-white">
                            <input
                              type="checkbox"
                              className="h-3 w-3 accent-black"
                              checked={true}
                              onChange={(e) => setExcludeFromOdds(nm, false)}
                              title="Show this golfer in winner odds"
                            />
                            <span>{nm}</span>
                          </label>
                        ))}
                        {oddsExcludedNames.length > 80 ? (
                          <span className="text-neutral-400">(+{oddsExcludedNames.length - 80} more)</span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="flex items-center gap-3 text-xs text-neutral-500">
                    <div>
                      Sims: <span className="font-mono font-bold">{winnerOdds.sims}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-neutral-500">Rounds</span>
                      <select
                        className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs font-bold text-neutral-800"
                        value={oddsMaxRounds}
                        onChange={(e) => setOddsMaxRounds(Math.max(3, Math.min(12, Number(e.target.value) || 12)))}
                        title="How many recent rounds to use in the winner odds model"
                      >
                        {[3,4,5,6,7,8,9,10,11,12].map(n => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-neutral-500">Model internals</span>
                      <button
                        onClick={() => setShowModelInternals(v => !v)}
                        className={`pill-mini ${showModelInternals ? "success" : ""}`}
                        title="Show Start HI and ΔHI used by the model"
                      >
                        {showModelInternals ? "On" : "Off"}
                      </button>
                    </div>
                  </div>
                </div>

                
                {/* Top-4 prediction (only show as "pick" when confidence is decent) */}
                <div className="mt-3 grid md:grid-cols-3 gap-3">
                  <div className="md:col-span-2 p-3 rounded-2xl border border-neutral-200 bg-white/80">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs uppercase tracking-wider text-neutral-500 font-black">Top-4 prediction</div>
                      <span className={`pill-mini ${
                        winnerOdds.confidence === "High"
                          ? "subtle"
                          : winnerOdds.confidence === "Medium"
                            ? "bg-amber-50 border-amber-200 text-amber-900"
                            : "bg-neutral-100 border-neutral-200 text-neutral-700"
                      }`}>
                        Confidence: <b>{winnerOdds.confidence}</b>
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {(winnerOdds.top4 || []).map((p) => (
                        <span key={p.name} className="pill-mini subtle">
                          {p.name} · <span className="font-mono">{p.top4Pct.toFixed(1)}%</span>
                        </span>
                      ))}
                    </div>

                    <div className="mt-2 text-xs text-neutral-500">
                      If confidence is <b>Low</b>, treat this as a contenders list — society golf is noisy and the 4th spot isn’t clearly separated.
                    </div>
                  </div>

                  <div className="p-3 rounded-2xl border border-neutral-200 bg-white/70">
                    <div className="text-xs uppercase tracking-wider text-neutral-500 font-black">Model confidence</div>
                    <div className="mt-1 text-sm text-neutral-700">
                      Top-4 concentration: <span className="font-mono font-black">{(winnerOdds.c4 || 0).toFixed(2)}</span> / 4
                    </div>
                    <div className="mt-1 text-sm text-neutral-700">
                      #4 vs #5 gap: <span className="font-mono font-black">{((winnerOdds.gap || 0) * 100).toFixed(1)}%</span>
                    </div>
                    <div className="mt-2 text-xs text-neutral-500">
                      Higher concentration + a clear gap means we can “call” the Top-4 with more confidence.
                    </div>
                  </div>
                </div>

<div className="mt-3 table-wrap">
                  <table className="w-full table-zebra">
                    <thead>
                      <tr>
                        <th className="py-2 px-3 text-left">#</th>
                        <th className="py-2 px-3 text-left">Player</th>
                        <th className="py-2 px-3 text-center" title="Hide this golfer from winner odds">Hide</th>
                        <th className="py-2 px-3 text-right">Win%</th>
                        <th className="py-2 px-3 text-right">Top 3%</th>
                        <th className="py-2 px-3 text-right">Top 4%</th>
                        <th className="py-2 px-3 text-right">Expected Pts</th>
                        <th className="py-2 px-3 text-right">Rounds (±4)</th>
                        <th className="py-2 px-3 text-right">Volatility</th>
                        {showModelInternals && <th className="py-2 px-3 text-right">Start HI</th>}
                        {showModelInternals && <th className="py-2 px-3 text-right">ΔHI</th>}
                        <th className="py-2 px-3 text-right">Next HI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(winnerOdds.rows || []).slice(0, 12).map((r, i) => (
                        <tr key={r.name}>
                          <td className="py-2 px-3 text-neutral-500 font-mono text-xs">{i+1}</td>
                          <td className="py-2 px-3 font-bold text-neutral-900">{r.name}</td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-black"
                              checked={!!(oddsExcludeMap && oddsExcludeMap[normalizeName(r.name)])}
                              onChange={(e) => setExcludeFromOdds(r.name, !!e.target.checked)}
                              title="Hide this golfer from winner odds"
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-black text-neutral-900">{r.winPct.toFixed(1)}%</td>
                          <td className="py-2 px-3 text-right font-bold text-neutral-700">{r.top3Pct.toFixed(1)}%</td>
                          <td className="py-2 px-3 text-right font-bold text-neutral-700">{r.top4Pct.toFixed(1)}%</td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-neutral-800">{r.expPts.toFixed(1)}</td>
                          <td className="py-2 px-3 text-right font-mono text-neutral-700">{r.usedSimilar ? r.similarRounds : `${r.similarRounds} (fb)`}</td>
                          <td className="py-2 px-3 text-right">
                            <span className={`pill-mini ${r.tag==="Steady" ? "subtle" : ""}`}>{r.tag} · σ {r.sigma.toFixed(1)}</span>
                          </td>
                          {showModelInternals && <td className="py-2 px-3 text-right font-mono text-neutral-700">{Number.isFinite(Number(r.startHI)) ? Number(r.startHI).toFixed(1) : "—"}</td>}
                          {showModelInternals && <td className="py-2 px-3 text-right font-mono text-neutral-700">{Number.isFinite(Number(r.deltaHI)) ? (Number(r.deltaHI) >= 0 ? "+" : "") + Number(r.deltaHI).toFixed(1) : "—"}</td>}
                          <td className="py-2 px-3 text-right font-mono text-neutral-700">{r.nextDisplay ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 text-sm text-neutral-700">
                  <b>How to use this:</b> if your <span className="font-mono">Expected Pts</span> is close to the leaders but your volatility is high, the fastest win is usually <b>cutting one wipe/double+</b>.
                </div>
              </div>

            </section>
          );
      }

      function Ratings({ computed, courseTees, setView }) {
        const ratingLabel = (avg) => avg >= 3 ? "Excellent" : avg >= 2.5 ? "Good" : avg >= 2 ? "Solid" : avg >= 1.5 ? "Needs Work" : "Struggle";
        const badgeClass = (avg) => avg >= 3 ? "bg-emerald-100 text-emerald-800" : avg >= 2.5 ? "bg-emerald-50 text-emerald-700" : avg >= 2 ? "bg-neutral-100 text-neutral-800" : avg >= 1.5 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";
        const holes = React.useMemo(() => detectEventHoleCount(computed), [computed]);
        const eventParAverages = (perHole, pars) => {
          const sums = { 3: { s: 0, c: 0 }, 4: { s: 0, c: 0 }, 5: { s: 0, c: 0 } };
          
for (let i = 0; i < holes; i++) {
            const par = pars[i];
            if (!par || !sums[par]) continue;
            const pts = _safeNum(perHole[i], NaN);
            if (!Number.isFinite(pts)) continue;
            sums[par].s += pts;
            sums[par].c++;
          }
          const avg = (p) => (sums[p].c ? sums[p].s / sums[p].c : 0);
          return { p3: avg(3), p4: avg(4), p5: avg(5) };
        };
        const ratings = useMemo(() => {
          return computed.map((r) => {
              const tee = chooseTeeForPlayer(r, courseTees);
              if (!tee) return { name: r.name, p3: 0, p4: 0, p5: 0 };
              const av = eventParAverages(r.perHole || [], tee.pars);
              return { name: r.name, p3: to1(av.p3), p4: to1(av.p4), p5: to1(av.p5), total: to1(av.p3 + av.p4 + av.p5) };
            }).sort((a, b) => b.total - a.total);
        }, [computed, courseTees]);

        return (
          <section className="content-card p-3 md:p-5">
            <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
            <h2 className="section-title mb-3">Player Ratings</h2>
            <div className="overflow-auto table-wrap">
              <table className="min-w-full text-sm table-zebra">
                <thead><tr className="border-b border-squab-200 text-left"><th>Name</th><th>Par-3 Avg</th><th>Rating</th><th>Par-4 Avg</th><th>Rating</th><th>Par-5 Avg</th><th>Rating</th></tr></thead>
                <tbody>
                  {ratings.map((r) => (
                    <tr key={r.name} className="border-b border-squab-200">
                      <td className="font-medium">{r.name}</td>
                      <td>{r.p3.toFixed(1)}</td><td><span className={`px-2 py-0.5 rounded-lg text-xs ${badgeClass(r.p3)}`}>{ratingLabel(r.p3)}</span></td>
                      <td>{r.p4.toFixed(1)}</td><td><span className={`px-2 py-0.5 rounded-lg text-xs ${badgeClass(r.p4)}`}>{ratingLabel(r.p4)}</span></td>
                      <td>{r.p5.toFixed(1)}</td><td><span className={`px-2 py-0.5 rounded-lg text-xs ${badgeClass(r.p5)}`}>{ratingLabel(r.p5)}</span></td>
                    </tr>
                  ))}
                  {ratings.length === 0 && <tr><td colSpan={7} className="py-3 text-neutral-600">Load an event to see ratings.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        );
      }

      function Standings({ season, setView, seasonsDef, seasonYear, setSeasonYear }) {
        const list = Object.values(season).filter((r) => !isTeamLike(r.name)).sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
        return (
          <section className="content-card p-3 md:p-5 hm-stage">
            <SoloNav setView={setView} right={<SeasonPicker seasonsDef={seasonsDef} seasonYear={seasonYear} setSeasonYear={setSeasonYear} leagueTitle={LEAGUE_TITLE} />} />
            <h2 className="section-title mb-3">League</h2>
            <div className="overflow-auto table-wrap">
              <table className="min-w-full text-sm table-zebra">
                <thead><tr className="border-b border-squab-200 text-left"><th>Rank</th><th>Name</th><th>Events</th><th>Total</th><th>Best Event</th><th>Best Hole</th><th>Eclectic</th></tr></thead>
                <tbody className="[&_tr:nth-child(even)]:bg-squab-50/50">
                  {list.map((r, i) => (
                    <tr key={r.name} className={"border-b border-squab-200 " + (i === 0 ? "bg-emerald-50" : i < 3 ? "bg-squab-50" : "")}>
                      <td className="font-semibold">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</td>
                      <td>{r.name}</td><td>{r.events}</td><td>{r.totalPoints}</td><td>{r.bestEventPoints}</td><td>{r.bestHolePoints}</td><td>{r.eclecticTotal}</td>
                    </tr>
                  ))}
                  {list.length === 0 && <tr><td colSpan="7" className="py-3 text-neutral-600">No season data yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        );
      }

      function Eclectic({ season, setView, seasonsDef, seasonYear, setSeasonYear }) {
        const list = Object.values(season).filter((r) => !isTeamLike(r.name)).sort((a, b) => (b.eclecticTotal || 0) - (a.eclecticTotal || 0));
        const colorForPts = (p) => { if(p >= 4) return "bg-purple-100 text-purple-700 font-bold"; if(p === 3) return "bg-emerald-100 text-emerald-800 font-semibold"; if(p === 2) return "text-neutral-800"; if(p === 1) return "bg-orange-50 text-orange-800"; if(p === 0) return "bg-red-50 text-red-300"; return ""; }
        return (
          <section className="content-card p-3 md:p-5 hm-stage">
            <SoloNav setView={setView} right={<SeasonPicker seasonsDef={seasonsDef} seasonYear={seasonYear} setSeasonYear={setSeasonYear} leagueTitle={LEAGUE_TITLE} />} />
            <h2 className="section-title mb-3">Eclectic</h2>
            <div className="overflow-auto table-wrap">
              <table className="min-w-full text-xs md:text-sm table-zebra">
                <thead><tr className="border-b border-squab-200 text-left"><th>Rank</th><th>Name</th><th>Eclectic Total</th>{Array.from({ length: 18 }, (_, i) => (<th key={i}>H{i + 1}</th>))}</tr></thead>
                <tbody className="[&_tr:nth-child(even)]:bg-squab-50/50">
                  {list.map((r, i) => (
                    <tr key={r.name} className={"border-b border-squab-200 " + (i === 0 ? "bg-emerald-50" : i < 3 ? "bg-squab-50" : "")}>
                      <td className="font-semibold">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</td>
                      <td>{r.name}</td><td>{r.eclecticTotal}</td>
                      {(r.bestPerHole || Array(18).fill(0)).map((v, ix) => (<td key={ix} className={`text-center ${colorForPts(v)}`}>{v}</td>))}
                    </tr>
                  ))}
                  {list.length === 0 && <tr><td colSpan={21} className="py-3 text-neutral-600">No eclectic data yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        );
      }

      function BanterStats({ computed, setView }) {
        if (!computed.length) {
          return (
            <section className="rounded-2xl p-4 bg-white border border-squab-200 shadow-sm">
              <Breadcrumbs items={[
                { label: "Game", onClick: () => setView("event"), title: "Round Leaderboard" },
                { label: "Fun & Banter" }
              ]} />
              <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
              <p className="text-neutral-600">Load an event to see analysis.</p>
            </section>
          );
        }
        const holes = React.useMemo(() => detectEventHoleCount(computed), [computed]);
        const closerStart = Math.max(0, holes - 4);
        const bounceBackList = computed.map(p => { const pts = (p.perHole || []).slice(0, holes).map(x => Number(x)||0); let opportunities = 0; let bounces = 0; for(let i=0; i<holes-1; i++) { if(pts[i] <= 1) { opportunities++; if(pts[i+1] >= 2) bounces++; } } return { name: p.name, ratio: opportunities ? (bounces/opportunities)*100 : 0, bounces, opportunities }; }).sort((a,b) => b.ratio - a.ratio);
        const consistencyList = computed.map(p => { const pts = (p.perHole || []).slice(0, holes).map(x => Number(x)||0); const mean = pts.reduce((a,b)=>a+b,0)/holes; const variance = pts.reduce((a,b) => a + Math.pow(b-mean, 2), 0)/holes; const stdDev = Math.sqrt(variance); return { name: p.name, stdDev }; }).sort((a,b) => a.stdDev - b.stdDev);
        const clutchList = computed.map(p => { const pts = (p.perHole || []).slice(closerStart, holes).reduce((a,b)=>a+(Number(b)||0), 0); return { name: p.name, pts }; }).sort((a,b) => b.pts - a.pts);
        const shouldaList = computed.map(p => { const ptsArr = (p.perHole || []).slice(0, holes).map(x => Number(x)||0); const wipes = ptsArr.filter(x => x === 0).length; const potential = p.points + wipes; return { name: p.name, actual: p.points, potential, diff: wipes }; }).sort((a,b) => b.diff - a.diff);
        return (
          <section className="content-card p-0 space-y-0">
            <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
            <div className="panel-head"><h2 className="text-xl font-bold text-squab-900">Banter & Analysis</h2><p className="text-sm text-neutral-500">The mental game, the chokes, and the excuses.</p></div>
            <div className="grid md:grid-cols-2 gap-6">
                <div className="border border-squab-200 rounded-2xl overflow-hidden flex flex-col">
                    <div className="bg-blue-50 p-3 border-b border-blue-100"><h3 className="font-bold text-blue-900 text-sm uppercase">🧠 The "Bounce Back" King</h3><p className="text-xs text-blue-700">Resilience: Scoring 2+ pts immediately after a bad hole (0-1 pts).</p></div>
                    <div className="overflow-auto max-h-[300px]"><table className="w-full text-xs text-left"><thead className="bg-white sticky top-0"><tr className="border-b border-neutral-100 text-neutral-500"><th className="p-2">Name</th><th className="p-2">Success Rate</th></tr></thead>
                          <tbody>{bounceBackList.map((x,i) => (<tr key={x.name} className="border-b border-neutral-50 hover:bg-neutral-50"><td className="p-2 font-medium">{i===0?"👑 ":""}{x.name}</td><td className="p-2"><div className="flex items-center gap-2"><span className="font-bold">{x.ratio.toFixed(0)}%</span><span className="text-neutral-400">({x.bounces}/{x.opportunities})</span></div></td></tr>))}</tbody></table></div></div>
                <div className="border border-squab-200 rounded-2xl overflow-hidden flex flex-col">
                    <div className="bg-purple-50 p-3 border-b border-purple-100"><h3 className="font-bold text-purple-900 text-sm uppercase">🎢 Rollercoaster vs Steady Eddie</h3><p className="text-xs text-purple-700">Based on standard deviation. Low = Consistent. High = Wild.</p></div>
                    <div className="overflow-auto max-h-[300px]"><table className="w-full text-xs text-left"><thead className="bg-white sticky top-0"><tr className="border-b border-neutral-100 text-neutral-500"><th className="p-2">Name</th><th className="p-2">Type</th><th className="p-2">Dev</th></tr></thead>
                          <tbody>{consistencyList.map((x,i) => (<tr key={x.name} className="border-b border-neutral-50 hover:bg-neutral-50"><td className="p-2 font-medium">{x.name}</td><td className="p-2">{i < 3 ? <span className="text-emerald-600 font-bold">Robot 🤖</span> : i > consistencyList.length - 4 ? <span className="text-orange-600 font-bold">Chaos 🎢</span> : <span className="text-neutral-400">-</span>}</td><td className="p-2 font-mono">{x.stdDev.toFixed(2)}</td></tr>))}</tbody></table></div></div>
                <div className="border border-squab-200 rounded-2xl overflow-hidden flex flex-col">
                    <div className="bg-orange-50 p-3 border-b border-orange-100"><h3 className="font-bold text-orange-900 text-sm uppercase">🔥 The Closer (Holes {closerStart+1}-{holes})</h3><p className="text-xs text-orange-700">Total stableford points scored on the final 4 holes.</p></div>
                    <div className="overflow-auto max-h-[300px]"><table className="w-full text-xs text-left"><thead className="bg-white sticky top-0"><tr className="border-b border-neutral-100 text-neutral-500"><th className="p-2">Name</th><th className="p-2">Finish Pts</th></tr></thead>
                          <tbody>{clutchList.map((x,i) => (<tr key={x.name} className="border-b border-neutral-50 hover:bg-neutral-50"><td className="p-2 font-medium">{i===0?"🥇 ":""}{x.name}</td><td className="p-2 font-bold text-orange-800">{x.pts}</td></tr>))}</tbody></table></div></div>
                <div className="border border-squab-200 rounded-2xl overflow-hidden flex flex-col">
                    <div className="bg-emerald-50 p-3 border-b border-emerald-100"><h3 className="font-bold text-emerald-900 text-sm uppercase">🥺 The "Shoulda Woulda" Index</h3><p className="text-xs text-emerald-700">"If I just played for bogey..." (Recalculated assuming 0pt holes were 1pt).</p></div>
                    <div className="overflow-auto max-h-[300px]"><table className="w-full text-xs text-left"><thead className="bg-white sticky top-0"><tr className="border-b border-neutral-100 text-neutral-500"><th className="p-2">Name</th><th className="p-2">Cost</th><th className="p-2">Potential</th></tr></thead>
                          <tbody>{shouldaList.map((x,i) => (<tr key={x.name} className="border-b border-neutral-50 hover:bg-neutral-50"><td className="p-2 font-medium">{x.name}</td><td className="p-2 text-red-600 font-bold">-{x.diff} pts</td><td className="p-2 text-neutral-400">{x.potential}</td></tr>))}</tbody></table></div></div>
            </div>
          </section>
        );
      }

        

/* Hole analysis removed per request */

        
function Graphs({ computed, setView, courseTees }) {
  const holes = React.useMemo(() => detectEventHoleCount(computed), [computed]);
  const [selectedPlayer, setSelectedPlayer] = React.useState("");
  const [scoringMode, setScoringMode] = React.useState("stableford"); // "stableford" | "gross"
  const [mode, setMode] = React.useState("field"); // "field" | "handicap"

  React.useEffect(() => {
    if (computed.length && !selectedPlayer) {
      setSelectedPlayer(computed[0].name);
    }
  }, [computed, selectedPlayer]);

  if (!computed.length) {
    return (
      <section className="rounded-2xl p-4 bg-white border border-squab-200 shadow-sm">
        <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
        <p className="text-neutral-600">Load an event to see graphs.</p>
      </section>
    );
  }

  const player = computed.find((p) => p.name === selectedPlayer) || computed[0];
  const playingHcap = Math.round(player.startExact ?? player.handicap ?? 0);
  const playerGroup = rangeForHcap(playingHcap);

  // --- HELPER: Get Data for a Player (Gross data helper (CSV only)) ---
  const getRowData = (p) => {
    if (scoringMode === "stableford") {
      // Stableford: 0 is valid (wipe)
      return (p.perHole || []).map((x) => {
        const n = Number(x);
        return Number.isFinite(n) ? n : 0;
      });
    }

    // STRICT gross: use CSV gross strokes only (no handicap/Stableford-derived filling).
    const raw = Array.isArray(p.grossPerHole) ? p.grossPerHole : [];
    return Array.from({ length: 18 }, (_, i) => {
      const n = Number(raw[i]);
      return (Number.isFinite(n) && n > 0) ? n : NaN;
    });
  };

  // 1) Player values
  const playerVals = getRowData(player);

  // 2) Averages (apply SAME logic to everyone so field avg also includes NDB, not 0)
  const fieldSum = Array(18).fill(0);
  const fieldCnt = Array(18).fill(0);
  const groupSum = Array(18).fill(0);
  const groupCnt = Array(18).fill(0);

  computed.forEach((p) => {
    const vals = getRowData(p);
    const hcap = Math.round(p.startExact ?? p.handicap ?? 0);
    const isGroup = rangeForHcap(hcap) === playerGroup;

    vals.forEach((v, h) => {
      if (v > 0) {
        fieldSum[h] += v;
        fieldCnt[h] += 1;
        if (isGroup) {
          groupSum[h] += v;
          groupCnt[h] += 1;
        }
      }
    });
  });

  const fieldAvg = fieldSum.map((sum, i) => (fieldCnt[i] ? sum / fieldCnt[i] : 0));
  const groupAvg = groupSum.map((sum, i) => (groupCnt[i] ? sum / groupCnt[i] : fieldAvg[i]));
  const refData = mode === "field" ? fieldAvg : groupAvg;

  // 3) Dynamic scaling
  const maxDataVal = Math.max(...playerVals, ...refData, scoringMode === "gross" ? 6 : 4);
  const maxY = Math.max(4, Math.ceil(maxDataVal + 1));

  // Chart dimensions
  const height = 280;
  const width = 800;
  const margin = { top: 20, right: 20, bottom: 40, left: 40 };
  const chartH = height - margin.top - margin.bottom;
  const colW = (width - margin.left - margin.right) / 18;
  const barW = colW * 0.35;
  const gap = colW * 0.1;
  const scaleY = (val) => chartH - (val / maxY) * chartH;

  // Color logic
  const getBarClass = (val, ref) => {
    if (scoringMode === "gross") {
      // Lower is better (Green)
      if (val > 0 && val < ref - 0.5) return "fill-emerald-500 hover:fill-emerald-600";
      if (val > ref + 0.5) return "fill-rose-500 hover:fill-rose-600";
      return "fill-neutral-400 hover:fill-neutral-500";
    } else {
      // Higher is better (Green)
      if (val > ref + 0.5) return "fill-emerald-500 hover:fill-emerald-600";
      if (val < ref - 0.5) return "fill-rose-500 hover:fill-rose-600";
      return "fill-neutral-400 hover:fill-neutral-500";
    }
  };

  return (
    <section className="content-card p-4 md:p-6">
      <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-lg font-semibold text-squab-900">Hole-by-Hole Comparison</h2>
          <div className="text-xs text-neutral-500">
            {scoringMode === "gross"
              ? "Strokes per hole (lower is better). Missing gross shown as blank."
              : "Points per hole (higher is better)."}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap gap-3 justify-center w-full">
          <div className="flex bg-neutral-100 rounded-lg p-1 border border-neutral-200">
            <button
              onClick={() => setScoringMode("stableford")}
              className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${scoringMode === "stableford" ? "bg-white shadow-sm text-squab-900" : "text-neutral-500"}`}
            >
              Pts
            </button>
            <button
              onClick={() => setScoringMode("gross")}
              className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${scoringMode === "gross" ? "bg-white shadow-sm text-squab-900" : "text-neutral-500"}`}
            >
              Gross
            </button>
          </div>

          <select
            className="rounded-2xl border border-squab-200 px-3 py-1.5 text-xs bg-white"
            value={selectedPlayer}
            onChange={(e) => setSelectedPlayer(e.target.value)}
          >
            {computed.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            className="rounded-2xl border border-squab-200 px-3 py-1.5 text-xs bg-white"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="field">vs Field</option>
            <option value="handicap">vs {playerGroup} Grp</option>
          </select>
        </div>
      </div>

      <div className="w-full overflow-x-auto pb-2">
        <div className="min-w-[600px]">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto font-sans">
            {Array.from({ length: maxY + 1 }).map((_, i) => {
              if (maxY > 10 && i % 2 !== 0) return null;
              const y = scaleY(i) + margin.top;
              return (
                <g key={i}>
                  <line
                    x1={margin.left}
                    y1={y}
                    x2={width - margin.right}
                    y2={y}
                    stroke="#e5e7eb"
                    strokeDasharray={i === 0 ? "" : "4 4"}
                  />
                  <text x={margin.left - 8} y={y + 4} textAnchor="end" className="text-[10px] fill-neutral-400">
                    {i}
                  </text>
                </g>
              );
            })}

            {Array.from({ length: holes }).map((_, i) => {
              const pVal = playerVals[i] ?? 0;
              const rVal = refData[i] ?? 0;

              const xBase = margin.left + i * colW + colW / 2;
              const xPlayer = xBase - barW - gap / 2;
              const xRef = xBase + gap / 2;

              const yPlayer = scaleY(pVal) + margin.top;
              const hPlayer = chartH - (yPlayer - margin.top);

              const yRef = scaleY(rVal) + margin.top;
              const hRef = chartH - (yRef - margin.top);

              const barClass = getBarClass(pVal, rVal);

              return (
                <g key={i}>
                  <text x={xBase} y={height - 5} textAnchor="middle" className="text-[10px] font-semibold fill-neutral-600">
                    {i + 1}
                  </text>

                  <rect
                    x={xPlayer}
                    y={yPlayer}
                    width={barW}
                    height={Math.max(0, hPlayer)}
                    className={`transition-colors ${barClass}`}
                    rx={2}
                  >
                    <title>{`Hole ${i + 1}: ${pVal} (${scoringMode})`}</title>
                  </rect>

                  <text x={xPlayer + barW / 2} y={yPlayer - 4} textAnchor="middle" className="text-[9px] font-bold fill-neutral-600">
                    {pVal > 0 ? (Number.isInteger(pVal) ? pVal : pVal.toFixed(1)) : ""}
                  </text>

                  <rect x={xRef} y={yRef} width={barW} height={Math.max(0, hRef)} className="fill-neutral-200" rx={2}>
                    <title>{`Avg: ${Number.isFinite(rVal) ? rVal.toFixed(2) : "—"}`}</title>
                  </rect>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </section>
  );
}

function TeamReplayRoom({ computed, courseTees, courseSlope, courseRating, startHcapMode, setView }) {
  const players = useMemo(() => (computed || []).map(p => p.name), [computed]);
const [t1p1, setT1p1] = useState("");
  const [t1p2, setT1p2] = useState("");
  const [t2p1, setT2p1] = useState("");
  const [t2p2, setT2p2] = useState("");

  const team1Name = "Team 1";
  const team2Name = "Team 2";

  const [hole, setHole] = useState(0); // completed holes (0..holes)
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1200); // ms per hole (includes flip delay)
  const holes = useMemo(() => detectEventHoleCount(computed), [computed]);
  const lastHole = holes;
  const [diff, setDiff] = useState(0); // + Team 1 up, - Team 2 up
  const [rows, setRows] = useState([]); // rendered replay rows
  const [banner, setBanner] = useState("");
  const [closed, setClosed] = useState(false);

  // Flip animation states
  const [flippingHole, setFlippingHole] = useState(null); // next hole number being animated (1..holes)
  const [flipT1, setFlipT1] = useState(null);
  const [flipT2, setFlipT2] = useState(null);

  const getPlayer = (name) => (computed || []).find(p => p.name === name);

  const pointsForPlayerHole = (playerName, holeIndex0) => {
    const pl = getPlayer(playerName);
    if (!pl) return { pts: 0, method: "noPlayer" };

    // Prefer Best Ball points when present (Squabbit optional row)
    const bbPts = Number(pl?.bestBallPerHole?.[holeIndex0]);
    if (Number.isFinite(bbPts)) return { pts: bbPts, method: "bestBall" };

    // Fallback: Stableford points from the main per-hole card
    const stPts = Number(pl?.perHole?.[holeIndex0]);
    if (Number.isFinite(stPts)) return { pts: stPts, method: "stableford" };

    return { pts: 0, method: "missingPoints" };
  };

  const bestBallForHole = (names, holeIndex0) => {
    const a = pointsForPlayerHole(names[0], holeIndex0);
    const b = pointsForPlayerHole(names[1], holeIndex0);
    const pts = Math.max(Number(a.pts) || 0, Number(b.pts) || 0);
    return { pts, a, b };
  };

  const uniqueTeamsOK = useMemo(() => {
    const chosen = [t1p1, t1p2, t2p1, t2p2].filter(Boolean);
    return chosen.length === 4 && new Set(chosen).size === 4;
  }, [t1p1, t1p2, t2p1, t2p2]);

  const anyMissingBestBall = useMemo(() => {
    const chosen = [t1p1, t1p2, t2p1, t2p2].filter(Boolean);
    if (chosen.length !== 4) return false;
    // if any selected player doesn't have bestBallPerHole data, flag it
    for (const n of chosen) {
      const pl = getPlayer(n);
      const bb = pl?.bestBallPerHole;
      if (!Array.isArray(bb) || bb.length < 18) return true;
    }
    return false;
  }, [t1p1, t1p2, t2p1, t2p2, computed]);

  const reset = () => {
    setHole(0);
    setDiff(0);
    setRows([]);
    setBanner("");
    setClosed(false);
    setFlippingHole(null);
    setFlipT1(null);
    setFlipT2(null);
    setIsPlaying(false);
  };

  const recomputeBanner = (nextDiff, completed) => {
    const remaining = holes - completed;
    const lead = Math.abs(nextDiff);
    const leader = nextDiff === 0 ? "" : (nextDiff > 0 ? team1Name : team2Name);

    if (lead > remaining && lead > 0) {
      return { text: `Match Closed — ${leader} wins`, closed: true };
    }
    if (lead === remaining && lead > 0) {
      return { text: `Dormie — ${leader}`, closed: false };
    }
    return { text: "", closed: false };
  };

  const doNextHole = () => {
    if (!uniqueTeamsOK) return;
    if (closed) return;
    if (hole >= holes) return;

    const nextHole = hole + 1;
    const holeIndex0 = nextHole - 1;

    const t1 = bestBallForHole([t1p1, t1p2], holeIndex0);
    const t2 = bestBallForHole([t2p1, t2p2], holeIndex0);

    // 1) Compute points for flip display
    const team1Pts = t1.pts;
    const team2Pts = t2.pts;

    setFlippingHole(nextHole);
    setFlipT1(team1Pts);
    setFlipT2(team2Pts);

    // 2) After short flip delay, commit match updates
    window.setTimeout(() => {
      let delta = 0;
      let res = "Halved";
      if (team1Pts > team2Pts) { delta = 1; res = `$Team 1 wins`; }
      else if (team2Pts > team1Pts) { delta = -1; res = `$Team 2 wins`; }

      const nextDiff = diff + delta;
      const nextCompleted = nextHole;

      const row = {
        hole: nextHole,
        delta,
        diffVal: nextDiff,
        t1: team1Pts,
        t2: team2Pts,
        res,
        match: (() => {
          if (nextDiff === 0) return "All Square";
          return `${Math.abs(nextDiff)} Up (${nextDiff > 0 ? team1Name : team2Name})`;
        })(),
        detail: {
          mode: "Best Ball if available, else Stableford",
          t1Players: [
            { name: t1p1, ...t1.a },
            { name: t1p2, ...t1.b },
          ],
          t2Players: [
            { name: t2p1, ...t2.a },
            { name: t2p2, ...t2.b },
          ],
        }
      };

      setRows(prev => [...prev, row]);
      setDiff(nextDiff);
      setHole(nextCompleted);

      const b = recomputeBanner(nextDiff, nextCompleted);
      setBanner(b.text);
      setClosed(b.closed);

      // clear flip marker after commit so UI is ready for next
      setFlippingHole(null);
    }, 450);
  };

  // Playback loop: schedule next step when playing
  useEffect(() => {
    if (!isPlaying) return;

    if (closed || hole >= holes) {
      setIsPlaying(false);
      return;
    }

    const id = window.setTimeout(() => doNextHole(), speed);
    return () => window.clearTimeout(id);
  }, [isPlaying, speed, hole, closed, uniqueTeamsOK, t1p1, t1p2, t2p1, t2p2, team1Name, team2Name, computed, diff]);

  if (!computed.length) {
    return (
      <section className="rounded-2xl p-4 bg-white border border-squab-200 shadow-sm">
        <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
        <p className="text-neutral-600">Load an event CSV to watch the team matchplay replay.</p>
      </section>
    );
  }

  const matchLabel = (() => {
    if (diff === 0) return "All Square";
    return `${Math.abs(diff)} Up (${diff > 0 ? team1Name : team2Name})`;
  })();

  return (
    <section className="content-card p-4 md:p-6">
      <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />

      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-squab-100 pb-4 mb-4">
        <div>
          <h2 className="text-xl font-bold text-squab-900">🤼 Team Matchplay Live Replay</h2>
          <p className="text-sm text-neutral-500">2v2 Better-Ball Stableford — uses the <span className="font-semibold">Best Ball</span> row from the Squabbit CSV.</p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <button
            className={"btn border " + (isPlaying ? "bg-emerald-600 text-white border-emerald-700" : "bg-white border-squab-200")}
            onClick={() => {
              if (!uniqueTeamsOK) { toast("Pick 4 different players first."); return; }
              setIsPlaying(v => !v);
            }}
          >
            {isPlaying ? "Pause" : (hole === 0 ? "Start" : "Resume")}
          </button>

          <button className="btn border border-squab-200 bg-white" onClick={doNextHole} disabled={!uniqueTeamsOK || closed || hole >= holes}>
            Step
          </button>

          <button className="btn border border-squab-200 bg-white" onClick={reset}>
            Reset
          </button>

          <div className="flex items-center gap-2 ml-2">
            <span className="text-xs text-neutral-500">Speed</span>
            <input
              type="range"
              min="450"
              max="2200"
              step="50"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      {anyMissingBestBall && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Heads up: one or more selected players don’t have a Best Ball row in this CSV — this will revert to Stableford points on any holes where Best Ball is missing.
        </div>
      )}

{/* Momentum visuals */}

<div className="tm-viz-card mb-4">
  {(() => {
    const pts = (rows || []).map(r => ({ h: r.hole, d: r.diffVal ?? 0, res: r.res, match: r.match }));
    const lastHole = pts.length ? pts[pts.length - 1].h : 0;
    const currentHole = Math.min(holes, Math.max(1, (typeof flippingHole === "number" && flippingHole > 0) ? flippingHole : (lastHole || 1)));
    const currentPt = pts.find(p => p.h === currentHole) || { h: currentHole, d: 0, res: "Halved", match: "All Square" };

    const stateText =
      currentPt.d === 0 ? "All Square" :
      currentPt.d > 0 ? `${Math.abs(currentPt.d)} Up (Team 1)` :
      `${Math.abs(currentPt.d)} Up (Team 2)`;

    const resultText = currentPt.res ? currentPt.res : "—";

    // Ladder rungs (cap based on max swing, but keep it compact)
    const maxAbs = Math.max(2, ...pts.map(p => Math.abs(p.d)));
    const cap = Math.min(6, Math.max(3, maxAbs));
    const rungs = [];
    for (let v = cap; v >= -cap; v--) {
      const label =
        v === 0 ? "AS" :
        v > 0 ? `${v} UP` :
        `${Math.abs(v)} DN`;
      const sub =
        v === 0 ? "All Square" :
        v > 0 ? "Team 1 leading" :
        "Team 2 leading";
      rungs.push({ v, label, sub });
    }

    return (
      <div className="tm-sky">
        <div className="tm-ladder">
          <div className="tm-ladder-title">Match Position</div>
          {rungs.map((r, i) => (
            <div key={i} className={"tm-rung " + (r.v === currentPt.d ? "current" : "")}>
              <div>
                <div className="label">{r.label}</div>
                <div className="sub">{r.sub}</div>
              </div>
              <span className="pip" />
            </div>
          ))}
        </div>

        <div className="tm-broadcast">
          <div className="tm-broadcast-top">
            <div className="tm-bigstate">
              <div>
                <div className="hole">Hole {currentHole}</div>
                <div className="state">{stateText}</div>
                <div className="result">Result: {resultText}</div>
              </div>
            </div>

            <div className="text-xs text-neutral-500">
              {matchLabel} · Holes completed: {hole}/{holes} {closed ? "· Match Closed" : ""}
            </div>
          </div>

          <div className="tm-barwrap">
            <div className="tm-bars" aria-label="Match position bar graph by hole">
              {Array.from({ length: holes }).map((_, i) => {
                const h = i + 1;
                const r = (rows || []).find(x => x.hole === h);
                const d = r ? (r.diffVal ?? 0) : 0;
                const mag = Math.min(cap, Math.abs(d));
                const pct = cap ? (mag / cap) * 50 : 0; // half height above/below midline
                const isUp = d > 0;
                const isDown = d < 0;
                const cls = isUp ? "up" : isDown ? "down" : "as";
                const isCurrent = currentHole === h;

                const style = isUp
                  ? { height: `${pct}%`, bottom: "50%" }
                  : isDown
                    ? { height: `${pct}%`, bottom: `${50 - pct}%` }
                    : { height: "2%", bottom: "49%" };

                return (
                  <div
                    key={h}
                    className={`tm-barcell ${isCurrent ? "current" : ""}`}
                    title={r ? `Hole ${h}: ${r.res} · ${r.match}` : `Hole ${h}: not played yet`}
                  >
                    <div className="tm-midline" />
                    <div className={`tm-bar ${cls}`} style={style} />
                  </div>
                );
              })}
            </div>

            <div className="tm-tape-num" aria-hidden="true">
              {Array.from({ length: holes }).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          </div>

<div className="mt-4 rounded-2xl border border-squab-200 bg-white/85 backdrop-blur px-4 py-3 shadow-sm">
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <div className="text-[11px] font-black uppercase tracking-widest text-neutral-400">Pick the players</div>
      <div className="text-sm font-semibold text-neutral-800">
        Choose <span className="font-black">2 players</span> for <span className="font-black">Team 1</span> and <span className="font-black">Team 2</span> to replay the match
      </div>
      <div className="text-xs text-neutral-500 mt-1">The match replay needs all 4 players selected.</div>
    </div>
    <span className="chip special">Required</span>
  </div>

  <div className="mt-3"><div className="grid md:grid-cols-2 gap-4 mb-0">
        <div className="rounded-2xl border border-squab-200 p-3 bg-neutral-50">
          <div className="text-xs text-neutral-500 font-bold uppercase mb-2">Team 1</div>
<div className="grid grid-cols-2 gap-2">
            <select className="rounded-2xl border border-squab-200 px-3 py-2 bg-white ring-2 ring-emerald-200 focus:ring-emerald-400" value={t1p1} onChange={(e) => setT1p1(e.target.value)}>
              <option value="">Player 1</option>
              {players.map((p) => (<option key={"t1p1-"+p} value={p}>{p}</option>))}
            </select>
            <select className="rounded-2xl border border-squab-200 px-3 py-2 bg-white ring-2 ring-emerald-200 focus:ring-emerald-400" value={t1p2} onChange={(e) => setT1p2(e.target.value)}>
              <option value="">Player 2</option>
              {players.map((p) => (<option key={"t1p2-"+p} value={p}>{p}</option>))}
            </select>
          </div>
        </div>

        <div className="rounded-2xl border border-squab-200 p-3 bg-neutral-50">
          <div className="text-xs text-neutral-500 font-bold uppercase mb-2">Team 2</div>
<div className="grid grid-cols-2 gap-2">
            <select className="rounded-2xl border border-squab-200 px-3 py-2 bg-white ring-2 ring-emerald-200 focus:ring-emerald-400" value={t2p1} onChange={(e) => setT2p1(e.target.value)}>
              <option value="">Player 1</option>
              {players.map((p) => (<option key={"t2p1-"+p} value={p}>{p}</option>))}
            </select>
            <select className="rounded-2xl border border-squab-200 px-3 py-2 bg-white ring-2 ring-emerald-200 focus:ring-emerald-400" value={t2p2} onChange={(e) => setT2p2(e.target.value)}>
              <option value="">Player 2</option>
              {players.map((p) => (<option key={"t2p2-"+p} value={p}>{p}</option>))}
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-squab-200 p-4 bg-white mb-0 ring-2 ring-emerald-200 focus:ring-emerald-400">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-xs text-neutral-500 font-bold uppercase">Match</div>
            <div className="text-2xl font-black text-squab-900">{matchLabel}</div>
            <div className="text-xs text-neutral-500 mt-1">Holes completed: {hole}/{holes}</div>
          </div>

          {banner && (
            <div className={"px-4 py-2 rounded-2xl border text-sm font-bold " + (closed ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-amber-50 border-amber-300 text-amber-800")}>
              {banner}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="rounded-2xl border border-squab-200 bg-neutral-50 p-3">
            <div className="text-xs text-neutral-500 font-bold uppercase mb-1">{team1Name.toUpperCase()}</div>
            <div className={"flip " + (flippingHole ? "flip-active" : "")}>
              <div className="flip-inner">
                <div className="flip-front text-4xl font-black text-squab-900">{flipT1 == null ? "—" : flipT1}</div>
                <div className="flip-back text-4xl font-black text-squab-900">{flipT1 == null ? "—" : flipT1}</div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-squab-200 bg-neutral-50 p-3">
            <div className="text-xs text-neutral-500 font-bold uppercase mb-1">{team2Name.toUpperCase()}</div>
            <div className={"flip " + (flippingHole ? "flip-active" : "")}>
              <div className="flip-inner">
                <div className="flip-front text-4xl font-black text-squab-900">{flipT2 == null ? "—" : flipT2}</div>
                <div className="flip-back text-4xl font-black text-squab-900">{flipT2 == null ? "—" : flipT2}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="text-xs text-neutral-500 mt-3">
          {flippingHole ? `Hole ${flippingHole}: points flip... then match updates.` : "Waiting for next hole..."}
        </div>
      </div>

            </div>
          </div>

<div className="tm-story">
            <div className="kicker">What just happened</div>
            <div className="line">Hole {currentHole}: {resultText}</div>
            <div className="line2">Match moves to <b>{stateText}</b></div>
          </div>
        </div>
      </div>
    );
  })()}
      </div>

      <div className="rounded-2xl border border-squab-200 overflow-hidden">
        <div className="px-4 py-2 bg-neutral-50 border-b border-squab-200 text-xs font-bold uppercase text-neutral-500">
          Hole-by-hole — Better-ball Stableford → Matchplay hole result
        </div>
        <div className="overflow-auto table-wrap">
          <table className="min-w-full text-sm table-zebra">
            <thead className="bg-white sticky top-0">
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-500 font-bold border-b border-neutral-100">
                <th className="py-2 px-3">Hole</th>
                <th className="py-2 px-3">Team 1 (best)</th>
                <th className="py-2 px-3">Team 2 (best)</th>
                <th className="py-2 px-3">Result</th>
                <th className="py-2 px-3">Match</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <React.Fragment key={"row-"+r.hole}>
                  <tr className="hover:bg-neutral-50">
                    <td className="py-2 px-3"><span className="tm-holebadge">{r.hole}</span></td>
                    <td className="py-2 px-3"><span className="tm-scorepill">{r.t1}</span></td>
                    <td className="py-2 px-3"><span className="tm-scorepill">{r.t2}</span></td>
                    <td className="py-2 px-3"><span className="tm-resultpill">{r.res}</span></td>
                    <td className="py-2 px-3"><span className="tm-matchpill">{r.match}</span></td>
                  </tr>
                  <tr className="bg-neutral-50/60">
                    <td className="py-2 px-3 text-xs text-neutral-500" colSpan={5}>
                      <div className="flex flex-col md:flex-row md:gap-6 gap-2">
                        <div className="flex-1">
                          <div className="text-[10px] uppercase font-bold text-neutral-400 mb-1">Team 1 details</div>
                          <div className="grid grid-cols-2 gap-2">
                            {r.detail.t1Players.map((p, idx) => (
                              <div key={"t1d-"+r.hole+"-"+idx} className="rounded-2xl border border-neutral-200 bg-white px-2 py-1">
                                <div className="font-semibold text-neutral-800 text-xs">{p.name}</div>
                                <div className="text-[11px] text-neutral-600">Pts: <span className="font-bold">{p.pts}</span> <span className="text-neutral-400">({p.method === "bestBall" ? "Best Ball" : p.method === "missingBestBall" ? "Missing Best Ball" : p.method})</span></div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex-1">
                          <div className="text-[10px] uppercase font-bold text-neutral-400 mb-1">Team 2 details</div>
                          <div className="grid grid-cols-2 gap-2">
                            {r.detail.t2Players.map((p, idx) => (
                              <div key={"t2d-"+r.hole+"-"+idx} className="rounded-2xl border border-neutral-200 bg-white px-2 py-1">
                                <div className="font-semibold text-neutral-800 text-xs">{p.name}</div>
                                <div className="text-[11px] text-neutral-600">Pts: <span className="font-bold">{p.pts}</span> <span className="text-neutral-400">({p.method === "bestBall" ? "Best Ball" : p.method === "missingBestBall" ? "Missing Best Ball" : p.method})</span></div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                  <tr className="tm-spacer"><td colSpan={5}></td></tr>
                </React.Fragment>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 px-3 text-sm text-neutral-600">
                    Pick teams, then press Start.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}


// ==============================
// UX helpers (cards + charts)
// ==============================
function UX_mean(arr) {
  const xs = (arr || []).map(Number).filter(Number.isFinite);
  if (!xs.length) return NaN;
  return xs.reduce((a,b)=>a+b,0) / xs.length;
}
function UX_std(arr) {
  const xs = (arr || []).map(Number).filter(Number.isFinite);
  if (xs.length < 2) return NaN;
  const mu = UX_mean(xs);
  let ss = 0;
  for (const v of xs) ss += (v-mu)*(v-mu);
  return Math.sqrt(ss / (xs.length - 1));
}
function UX_fmt(n, dp=1) {
  return Number.isFinite(n) ? Number(n).toFixed(dp) : "—";
}
function UX_holesForSeriesItem(r) {
  const hp = Number(r?.holesPlayed);
  if (Number.isFinite(hp) && hp > 0) return (hp <= 9 ? 9 : 18);
  const ph = Array.isArray(r?.perHole) ? r.perHole : [];
  const hasBack = ph.slice(9, 18).some(v => Number.isFinite(Number(v)));
  return hasBack ? 18 : 9;
}

function UX_ChipBar({ value, onChange, options }) {
  return (
    <div className="flex flex-col sm:flex-row flex-wrap gap-3 justify-center w-full">
      {options.map((opt) => {
        const active = String(opt.value) === String(value);
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={
              "px-3 py-1.5 rounded-full text-sm font-black border transition " +
              (active
                ? "bg-neutral-900 text-white border-neutral-900"
                : "bg-white text-neutral-800 border-neutral-200 hover:border-neutral-400")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function UX_MetricCard({ label, value, sub, right, tone="light" }) {
  const base = "rounded-2xl border p-4 md:p-5 shadow-sm";
  const skin =
    tone === "dark"
      ? "bg-neutral-900 border-white/10 text-white"
      : "bg-white border-neutral-200 text-neutral-900";
  return (
    <div className={`${base} ${skin}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={"text-[11px] uppercase tracking-widest font-black " + (tone==="dark" ? "text-neutral-300" : "text-neutral-500")}>
            {label}
          </div>
          <div className="mt-1 text-3xl md:text-4xl font-black tabular-nums leading-none">
            {value}
          </div>
          {sub ? (
            <div className={"mt-2 text-sm " + (tone==="dark" ? "text-neutral-300" : "text-neutral-600")}>
              {sub}
            </div>
          ) : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
    </div>
  );
}


function UX_ScopePill({ kind, label }) {
  const k = String(kind || "").toUpperCase();
  const base = "inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-[11px] font-black tracking-wide";
  const skin = (k === "LATEST")
    ? "bg-sky-50 text-sky-800 border-sky-200"
    : "bg-neutral-50 text-neutral-800 border-neutral-200";
  const title = (k === "LATEST") ? "LATEST ROUND" : "WINDOW";
  return (
    <span className={base + " " + skin} title={k === "LATEST" ? "Uses the most recent round" : "Uses the selected game window"}>
      <span>{title}</span>
      {label ? <span className="font-semibold tracking-normal opacity-80">{label}</span> : null}
    </span>
  );
}

function UX_Sparkline({ values, width=90, height=28 }) {
  const xs = (values || []).map(Number).filter(Number.isFinite);
  if (xs.length < 2) return <div className="text-xs text-neutral-500">—</div>;

  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const dx = (width - 2) / (xs.length - 1);
  const y = (v) => {
    if (max === min) return height/2;
    const t = (v - min) / (max - min);
    return (height - 2) - t * (height - 4);
  };

  const pts = xs.map((v,i)=>`${1 + i*dx},${y(v)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.9" />
    </svg>
  );
}

function UX_LineChart({ a, b, labels, height=180 }) {
  const A = (a||[]).map(Number);
  const B = (b||[]).map(Number);
  const n = Math.max(A.length, B.length, 0);
  if (n < 2) return <div className="text-sm text-neutral-600">Not enough games to chart yet.</div>;

  const vals = [...A, ...B].filter(Number.isFinite);
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 1;

  const W = 680, H = height, pad = 34;
  const dx = (W - 2*pad) / (n - 1);
  const y = (v) => {
    if (!Number.isFinite(v)) return NaN;
    if (max === min) return H/2;
    const t = (v - min) / (max - min);
    return (H - pad) - t * (H - 2*pad);
  };

  const pathFor = (arr) => {
    let d = "";
    for (let i=0;i<n;i++){
      const v = Number(arr[i]);
      if (!Number.isFinite(v)) continue;
      const X = pad + i*dx;
      const Y = y(v);
      if (!Number.isFinite(Y)) continue;
      d += (d ? " L " : "M ") + X + " " + Y;
    }
    return d || "";
  };

  const dA = pathFor(A);
  const dB = pathFor(B);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[680px]">
{/* horizontal guides */}
{(() => {
  if (max === min) {
    const Y = H / 2;
    const v = Math.round(min * 10) / 10;
    return (
      <g key="yt-flat">
        <line x1={pad} y1={Y} x2={W-pad} y2={Y} stroke="rgba(0,0,0,0.10)" />
        <text x={pad-8} y={Y+4} textAnchor="end" fontSize="10" fill="rgba(0,0,0,0.45)">{String(v)}</text>
      </g>
    );
  }
  const ticks = 4;
  return Array.from({ length: ticks + 1 }).map((_, i) => {
    const v = min + (max - min) * (i / ticks);
    const Y = y(v);
    const vv = Math.round(v * 10) / 10;
    return (
      <g key={"yt"+i}>
        <line x1={pad} y1={Y} x2={W-pad} y2={Y} stroke="rgba(0,0,0,0.08)" />
        <text x={pad-8} y={Y+4} textAnchor="end" fontSize="10" fill="rgba(0,0,0,0.45)">{String(vv)}</text>
      </g>
    );
  });
})()}

        <line x1={pad} y1={H-pad} x2={W-pad} y2={H-pad} stroke="rgba(0,0,0,0.18)" />
        <line x1={pad} y1={pad} x2={pad} y2={H-pad} stroke="rgba(0,0,0,0.18)" />
        {dB ? <path d={dB} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="3" /> : null}
        {dA ? <path d={dA} fill="none" stroke="currentColor" strokeWidth="4" /> : null}

        {Array.from({length:n}).map((_,i)=>{
          const X = pad + i*dx;
          const vA = A[i], vB = B[i];
          const yA = y(vA), yB = y(vB);
          return (
            <g key={i}>
              {Number.isFinite(yB) ? <circle cx={X} cy={yB} r="4" fill="rgba(0,0,0,0.25)" /> : null}
              {Number.isFinite(yA) ? <circle cx={X} cy={yA} r="5" fill="currentColor" /> : null}
              {labels?.[i] ? (
                <text x={X} y={H-10} textAnchor="middle" fontSize="10" fill="rgba(0,0,0,0.5)">
                  {labels[i]}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function UX_HeatmapStrip({ values, holes, title, subtitle, scopePill, mode = "points", imputed, pars }) {
  const xs = (values || []).map(v => Number.isFinite(Number(v)) ? Number(v) : NaN).slice(0, holes);
  const finite = xs.filter(Number.isFinite);
  const min = finite.length ? Math.min(...finite) : NaN;
  const max = finite.length ? Math.max(...finite) : NaN;

  // For gross mode, use strokes vs PAR if pars provided.
  const parsX = (Array.isArray(pars) ? pars : []).map(v => Number(v));

  const chip = (cls, label) => (
    <span className={"px-2 py-1 rounded-full border border-neutral-200 " + cls}>{label}</span>
  );

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-widest font-black text-neutral-500">{title}</div>
          {subtitle ? <div className="text-xs text-neutral-600 mt-1">{subtitle}</div> : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          {scopePill ? scopePill : null}
          <div className="text-xs text-neutral-500">Holes: {holes}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
        <span className="font-black text-neutral-800">Legend:</span>
        {mode === "gross" ? (
          <>
            {chip("bg-purple-100 text-purple-700 font-bold", "Eagle+ (≤ -2)")}
            {chip("bg-emerald-100 text-emerald-800 font-semibold", "Birdie (-1)")}
            {chip("bg-white text-neutral-800", "Par (0)")}
            {chip("bg-orange-50 text-orange-800", "Bogey (+1)")}
            {chip("bg-red-50 text-red-700 font-semibold", "Double+ (≥ +2)")}
          </>
        ) : (
          <>
            {chip("bg-red-50 text-red-700 font-semibold", "0 wipe")}
            {chip("bg-orange-50 text-orange-800", "1 bogey point")}
            {chip("bg-white text-neutral-800", "2 par point")}
            {chip("bg-emerald-100 text-emerald-800 font-semibold", "3 birdie")}
            {chip("bg-purple-100 text-purple-700 font-bold", "4+ eagle+")}
          </>
        )}
        <span className="px-2 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-800 font-bold">NDB adjusted</span>
      </div>

      <div className="mt-4 heatmap-grid gap-2" style={{ "--cols": String(holes), "--colsMobile": String(Math.min(holes, 9)) }}>
        {Array.from({length: holes}).map((_, i) => {
          const v = xs[i];
          const good = Number.isFinite(v);

          let toneClass = "bg-neutral-50 text-neutral-400";
          let style = undefined;

          if (good) {
            if (mode === "gross") {
              const par = Number(parsX[i]);
              if (Number.isFinite(par)) {
                const d = v - par; // strokes over par
                if (d <= -2) toneClass = "bg-purple-100 text-purple-700 font-bold";
                else if (d === -1) toneClass = "bg-emerald-100 text-emerald-800 font-semibold";
                else if (d === 0) toneClass = "bg-white text-neutral-900";
                else if (d === 1) toneClass = "bg-orange-50 text-orange-800";
                else toneClass = "bg-red-50 text-red-700 font-semibold";
              } else {
                // Fallback: shade by min/max (lower strokes = better)
                let t = 0.5;
                if (Number.isFinite(min) && Number.isFinite(max) && max !== min) {
                  t = (max - v) / (max - min);
                }
                t = Math.max(0.15, Math.min(1, t));
                style = { background: `rgba(16,185,129,${t})` };
                toneClass = "text-neutral-900";
              }
            } else {
              // Points mode: match Eclectic colour coding (discrete buckets)
              if (v >= 4) toneClass = "bg-purple-100 text-purple-700 font-bold";
              else if (v === 3) toneClass = "bg-emerald-100 text-emerald-800 font-semibold";
              else if (v === 2) toneClass = "bg-white text-neutral-900";
              else if (v === 1) toneClass = "bg-orange-50 text-orange-800";
              else toneClass = "bg-red-50 text-red-700 font-semibold";
            }
          }

          return (
            <div
              key={i}
              className={"rounded-lg border border-neutral-200 p-2 text-center " + toneClass}
              style={style}
            >
              <div className="text-[10px] font-black opacity-80">#{i+1}</div>
              <div className="text-sm font-black tabular-nums">{good ? v : "—"}</div>
              {Array.isArray(imputed) && imputed[i] ? (
                <div className="mt-1 text-[9px] font-bold text-amber-800 bg-amber-100 border border-amber-200 rounded px-1 inline-block">NDB</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UX_KeyMoments({ pts, holes }) {
  const arr = (pts || []).slice(0, holes).map(v => Number.isFinite(Number(v)) ? Number(v) : NaN);
  const good = arr.map(v => Number.isFinite(v) ? v : 0);

  let damageHole = 1, damagePts = good[0] ?? 0;
  for (let i=0;i<holes;i++){
    if (good[i] < damagePts) { damagePts = good[i]; damageHole = i+1; }
  }

  let bestStart = 1, bestSum = -Infinity;
  for (let i=0;i<=holes-3;i++){
    const s = good[i] + good[i+1] + good[i+2];
    if (s > bestSum) { bestSum = s; bestStart = i+1; }
  }

  let turnHole = 2, turnDelta = -Infinity;
  for (let i=1;i<holes;i++){
    const d = good[i] - good[i-1];
    if (d > turnDelta) { turnDelta = d; turnHole = i+1; }
  }

  const Card = ({ label, value, detail }) => (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="text-[11px] uppercase tracking-widest font-black text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
      <div className="mt-2 text-sm text-neutral-600">{detail}</div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card
        label="Bounce-back"
        value={`Hole ${turnHole}`}
        detail={`Best improvement vs previous hole: ${turnDelta >= 0 ? "+" : ""}${UX_fmt(turnDelta, 0)} pts`}
      />
      <Card
        label="Hot stretch"
        value={`Holes ${bestStart}–${bestStart+2}`}
        detail={`Best 3-hole run: ${UX_fmt(bestSum, 0)} pts total`}
      />
      <Card
        label="Biggest leak (worst hole)"
        value={`Hole ${damageHole}`}
        detail={`Worst hole for points: ${UX_fmt(damagePts, 0)} pts`}
      />
    </div>
  );
}

function PlayerProgressView({
  seasonModel,
  scoringMode,
  setScoringMode,
  grossCompare,
  setGrossCompare,
  seasonFiles,
  reportNextHcapMode,
  setReportNextHcapMode,
  seasonPlayer,
  setSeasonPlayer,
  seasonYear,
  setSeasonYear,
  seasonLimit,
  setSeasonLimit,
  seasonYears,
  seasonLoading,
  seasonProgress,
  seasonError,
  runSeasonAnalysis,
  setView,
}) {
  const [cohortMode, setCohortMode] = React.useState(() => {
    try {
      const v =
        (window.__dslUiState && window.__dslUiState.cohortMode) ||
        localStorage.getItem("dsl_cohortMode") ||
        "field";
      return (v === "field" || v === "band") ? v : "field";
    } catch (e) {
      return "field";
    }
  });
  React.useEffect(() => {
    try{
      window.__dslUiState = window.__dslUiState || {};
      window.__dslUiState.cohortMode = cohortMode;
      try{ localStorage.setItem("dsl_cohortMode", cohortMode); }catch(e){}
      window.__dslUiState.seasonYear = seasonYear;
      window.__dslUiState.seasonLimit = seasonLimit;
    }catch(e){}
  }, [cohortMode, seasonYear, seasonLimit]);
 
  // progressCompare is derived from the scoring lens (not from math).
// "field" | "band"
  const [showExplain, setShowExplain] = React.useState(false);
  const [edgeTab, setEdgeTab] = React.useState("all"); // all | par | si | yd
  const [ppBarsMode, setPpBarsMode] = React.useState(() => {
    try { return localStorage.getItem("dsl_lens") || "pointsField"; } catch(e){ return "pointsField"; }
  }); // pointsField | strokesField | strokesPar

  const [trendMetric, setTrendMetric] = React.useState(() => {
    try { return localStorage.getItem("dsl_trendMetric") || "overall"; } catch(e){ return "overall"; }
  }); // overall | p3 | p4 | p5
  React.useEffect(() => {
    try { localStorage.setItem("dsl_trendMetric", String(trendMetric || "overall")); } catch(e){}
  }, [trendMetric]);
  const progressCompare = (ppBarsMode === "strokesPar") ? "par" : "field"; // "field" | "par"
  // Lens (single source of truth):
  // pointsField => Stableford Points vs Field
  // strokesField => Gross Strokes vs Field
  // strokesPar   => Gross Strokes vs Par
  React.useEffect(() => {
    if (ppBarsMode === "pointsField") {
      if (scoringMode !== "stableford") setScoringMode("stableford");
    } else {
      if (scoringMode !== "gross") setScoringMode("gross");
    }
    // Strokes vs Par is absolute; cohort comparisons don't apply
    if (ppBarsMode === "strokesPar" && cohortMode !== "field") setCohortMode("field");
  }, [ppBarsMode]);

  // --- Lens dropdown (single control, still coloured) ---
  const LENS_OPTIONS = React.useMemo(() => ([
    {
      key: "pointsField_field",
      label: "Stableford Points — vs Field",
      pp: "pointsField",
      cohort: "field",
      rgb: "124,58,237",
      hint: "Stableford points ranked across everyone (overall view).",
    },
    {
      key: "pointsField_band",
      label: "Stableford Points — vs Handicap band",
      pp: "pointsField",
      cohort: "band",
      rgb: "124,58,237",
      hint: "Stableford points vs players with similar handicaps (fairer comparison).",
    },
    {
      key: "strokesField_field",
      label: "Score (Strokes) — vs Field",
      pp: "strokesField",
      cohort: "field",
      rgb: "37,99,235",
      hint: "Gross strokes compared across everyone (lower is better).",
    },
    {
      key: "strokesField_band",
      label: "Score (Strokes) — vs Handicap band",
      pp: "strokesField",
      cohort: "band",
      rgb: "37,99,235",
      hint: "Gross strokes vs similar handicaps (lower is better).",
    },
    {
      key: "strokesPar",
      label: "Score (Strokes) — vs Par",
      pp: "strokesPar",
      cohort: "field",
      rgb: "249,115,22",
      hint: "Absolute score relative to par (no field/band comparison).",
    },
  ]), []);

  const lensSelected = React.useMemo(() => {
    const found = LENS_OPTIONS.find(o => o.pp === ppBarsMode && o.cohort === cohortMode);
    if (found) return found;
    // safety: strokesPar always uses field
    if (ppBarsMode === "strokesPar") return LENS_OPTIONS.find(o => o.key === "strokesPar") || LENS_OPTIONS[0];
    // fallback
    return LENS_OPTIONS[0];
  }, [LENS_OPTIONS, ppBarsMode, cohortMode]);

  const lensKey = lensSelected?.key || "pointsField_field";
  const lensDotStyle = React.useMemo(() => ({ background: `rgba(${lensSelected?.rgb || "124,58,237"}, 1)` }), [lensSelected]);

  // Persist lens so Overview / Insights / Plan share the same selection
  React.useEffect(() => {
    try { localStorage.setItem("dsl_lens", ppBarsMode); } catch(e) {}
    try { window.dispatchEvent(new Event("dsl_lens_change")); } catch(e) {}
  }, [ppBarsMode]);

  // Keep Player Progress in sync with the global Lens selector (Performance Mirror)
  React.useEffect(() => {
    const sync = () => {
      try {
        const v = localStorage.getItem("dsl_lens") || "pointsField";
        if (v === "pointsField" || v === "strokesField" || v === "strokesPar") {
          setPpBarsMode(prev => (prev === v ? prev : v));
        }
      } catch(e) {}
    };
    window.addEventListener("dsl_lens_change", sync);
    window.addEventListener("storage", sync);
return () => {
      window.removeEventListener("dsl_lens_change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);


  const [edgeCount, setEdgeCount] = React.useState(8);
  const [deepDiveOpen, setDeepDiveOpen] = React.useState(false);

  // V2: charts open in a bottom-sheet overlay; lock body scroll while open
  React.useEffect(() => {
    try {
      if (!deepDiveOpen) return;
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    } catch (e) {}
  }, [deepDiveOpen]);

  // -------------------------
  // Local safe helpers
  // -------------------------
  const _num = (x, d=NaN) => PR_num(x, d);
  const _mean = (arr) => {
    const xs = (arr||[]).map(Number).filter(Number.isFinite);
    return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : NaN;
  };
  const _std = (arr) => {
    const xs = (arr||[]).map(Number).filter(Number.isFinite);
    if (xs.length < 2) return NaN;
    const mu = _mean(xs);
    let ss = 0;
    for (const v of xs) {
      const d = v - mu;
      ss += d * d;
    }
    return Math.sqrt(ss / (xs.length - 1));
  };
  
const _median = (arr) => {
  const xs = (arr || []).map(Number).filter(Number.isFinite).slice().sort((a,b)=>a-b);
  if (!xs.length) return NaN;
  const mid = Math.floor(xs.length / 2);
  return (xs.length % 2) ? xs[mid] : (xs[mid-1] + xs[mid]) / 2;
};

const _normKey = (x) => String(x ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const _fmt = (n, d=1) => PR_fmt(n, d);
  const _pct = (n, d=0) => Number.isFinite(n) ? `${_fmt(n*100, d)}%` : "—";
  const _pctPP = (n) => _pct(n, 0);
  const goodDelta = PR_goodDelta;

  const cur = React.useMemo(() => {
    const ps = seasonModel?.players || [];
    return ps.find(p => p.name === seasonPlayer) || ps[0] || null;
  }, [seasonModel, seasonPlayer]);

  // Problem holes: computed from the current player's windowed series (safe, WHS-consistent)
  const seriesForPH = React.useMemo(() => (cur && Array.isArray(cur.series) ? cur.series : []), [cur]);
  const problemHolePack = React.useMemo(() => {
    try { return PR_buildProblemHolePack(seriesForPH); }
    catch (e) { return { ok: false, reason: "error" }; }
  }, [seriesForPH]);


  // Name display: consistent typography, but first name gets the headline size
  const _nameParts = String(cur?.name || "").trim().split(/\s+/).filter(Boolean);
  const firstName = _nameParts[0] || "";
  const restName = _nameParts.slice(1).join(" ");


const allPlayers = seasonModel?.players || [];
const field = seasonModel?.field || {};

// =========================================================
// Multi-course (low sample) benchmark: PEER GROUP field
// - Keeps high-handicap rounds from distorting "field" for better players (and vice versa)
// - Peer group is determined by rangeForHcap(), which already drives some report visuals.
// =========================================================
// (benchmarking helpers defined earlier)

const benchField = React.useMemo(() => {
  if (benchMode === "allField") return field || {};
  const myGrp = rangeForHcap(_hcapOf(cur));
  const peers = (allPlayers || []).filter(p => rangeForHcap(_hcapOf(p)) === myGrp);
  return {
    byPar: _sumAggMaps(peers, "byPar"),
    bySI: _sumAggMaps(peers, "bySI"),
    byYards: _sumAggMaps(peers, "byYards"),
    byParGross: _sumAggMaps(peers, "byParGross"),
    bySIGross: _sumAggMaps(peers, "bySIGross"),
    byYardsGross: _sumAggMaps(peers, "byYardsGross"),
  };
}, [benchMode, field, allPlayers, cur]);

  const isGross = scoringMode === "gross";
  const rawPar = React.useMemo(
    () => PR_buildRawRows({
      scoringMode,
      dim: "Par",
      mapObj: isGross ? cur?.byParGross : cur?.byPar,
      fieldObj: isGross ? benchField?.byParGross : benchField?.byPar,
    }),
    [cur, field, scoringMode]
  );

  const rawSI = React.useMemo(
    () => PR_buildRawRows({
      scoringMode,
      dim: "SI",
      mapObj: isGross ? cur?.bySIGross : cur?.bySI,
      fieldObj: isGross ? benchField?.bySIGross : benchField?.bySI,
      limit: 6,
    }),
    [cur, field, scoringMode]
  );

  const rawYd = React.useMemo(
    () => {
      const meY = isGross ? cur?.byYardsGross : (cur?.byYards || cur?.byParYards);
      const fldY = isGross ? benchField?.byYardsGross : (field?.byYards || field?.byParYards);
      return PR_buildRawRows({
        scoringMode,
        dim: "Yd",
        mapObj: meY,
        fieldObj: fldY,
        limit: 8,
      });
    },
    [cur, field, scoringMode]
  );

// -------------------------
// Par Leaderboards (so players can see who’s best on Par 3/4/5)
// -------------------------
const [parLeadMode, setParLeadMode] = React.useState("stableford"); // stableford | gross
const [parLeadersCollapsed, setParLeadersCollapsed] = React.useState(true);
const _ptsPH = (agg) => (agg && agg.holes ? (Number(agg.pts)/Number(agg.holes)) : NaN);
const _sopPH = (agg) => (agg && agg.holes ? (Number(agg.val)/Number(agg.holes)) : NaN); // strokes-over-par per hole
const _isRealPlayer = (p) => p && p.name && !(typeof isTeamLike === "function" && isTeamLike(p.name));

const parLeaders = React.useMemo(() => {
  const pool = (Array.isArray(allPlayers) ? allPlayers : []).filter(_isRealPlayer);

  const build = (parLabel) => {
    const rows = pool.map(p => {
      if (parLeadMode === "gross") {
        const a = p?.byParGross?.[parLabel];
        const holes = (a && Number.isFinite(Number(a.holes))) ? Number(a.holes) : NaN;
        const v = _sopPH(a); // strokes-over-par per hole (lower is better)
        return { name: p.name, v, holes };
      } else {
        const a = p?.byPar?.[parLabel];
        const holes = (a && Number.isFinite(Number(a.holes))) ? Number(a.holes) : NaN;
        const v = _ptsPH(a); // points per hole (higher is better)
        return { name: p.name, v, holes };
      }
    }).filter(r => Number.isFinite(r.v));

    rows.sort((a,b) => parLeadMode === "gross" ? (a.v - b.v) : (b.v - a.v));
    return rows.slice(0, 20);
  };

  const buildAll = () => {
    const labels = ["Par 3","Par 4","Par 5"];
    const rows = pool.map(p => {
      if (parLeadMode === "gross") {
        let holes = 0;
        let val = 0;
        labels.forEach(lbl => {
          const a = p?.byParGross?.[lbl];
          const h = (a && Number.isFinite(Number(a.holes))) ? Number(a.holes) : 0;
          const v = (a && Number.isFinite(Number(a.val))) ? Number(a.val) : 0;
          holes += h;
          val += v;
        });
        const v = holes ? (val / holes) : NaN; // strokes-over-par per hole (lower is better)
        return { name: p.name, v, holes };
      } else {
        let holes = 0;
        let pts = 0;
        labels.forEach(lbl => {
          const a = p?.byPar?.[lbl];
          const h = (a && Number.isFinite(Number(a.holes))) ? Number(a.holes) : 0;
          const s = (a && Number.isFinite(Number(a.pts))) ? Number(a.pts) : 0;
          holes += h;
          pts += s;
        });
        const v = holes ? (pts / holes) : NaN; // points per hole (higher is better)
        return { name: p.name, v, holes };
      }
    }).filter(r => Number.isFinite(r.v));

    rows.sort((a,b) => parLeadMode === "gross" ? (a.v - b.v) : (b.v - a.v));
    return rows.slice(0, 20);
  };

  return {
    all: buildAll(),
    p3: build("Par 3"),
    p4: build("Par 4"),
    p5: build("Par 5")
  };
}, [allPlayers, parLeadMode]);

  // -------------------------
  // Cohort selection (Field vs Handicap Band)
  // -------------------------
  const cohort = React.useMemo(() => {
    if (!cur) return { label: "Field", players: allPlayers, fieldAgg: field };
    if (cohortMode === "field") return { label: "Field", players: allPlayers, fieldAgg: field };

    // Handicap band cohort: players with similar avg handicap (bandwidth adapts to handicap level)
    const series = Array.isArray(cur.series) ? cur.series : [];
    const avgH = _mean(series.map(s => _num(s.hcap, NaN)));
    const bw = Number.isFinite(avgH) ? (avgH >= 18 ? 6 : (avgH >= 10 ? 4 : 3)) : 4;

    const picks = allPlayers.filter(p => {
      if (!p || p.name === cur.name) return false;
      const s = Array.isArray(p.series) ? p.series : [];
      const a = _mean(s.map(x => _num(x.hcap, NaN)));
      return Number.isFinite(avgH) && Number.isFinite(a) && Math.abs(a - avgH) <= bw;
    });

    // If not enough, fall back to whole field (but still label the intent)
    if (picks.length < 3) return { label: `Field (band too small)`, players: allPlayers, fieldAgg: field };

    // Build an "aggregate-like" field object for the cohort by averaging per-hole rates using each player's already-aggregated season totals.
    // We only need enough for the widgets: totals, totalsGross, byPar, byParGross, bySI, bySIGross, byYards, byYardsGross.
    const makeAggLike = () => ({ holes: 0, pts: 0, wipes: 0 });
    const addAggLike = (A, pAgg) => {
      if (!A || !pAgg) return;
      const h = _num(pAgg.holes, 0);
      if (!h) return;
      A.holes += h;
      // stableford
      if (Number.isFinite(_num(pAgg.pts, NaN))) A.pts += _num(pAgg.pts, 0);
      if (Number.isFinite(_num(pAgg.wipes, NaN))) A.wipes += _num(pAgg.wipes, 0);
    };
    const makeAggGrossLike = () => ({ holes: 0, val: 0, bogeyPlus: 0, parOrBetter: 0, birdieOrBetter: 0, doublePlus: 0, eaglePlus: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0, triplesPlus: 0 });
    const addAggGrossLike = (A, g) => {
      if (!A || !g) return;
      const h = _num(g.holes, 0);
      if (!h) return;
      A.holes += h;
      A.val += _num(g.val, 0);
      // rollups (kept roughly comparable)
      ["bogeyPlus","parOrBetter","birdieOrBetter","doublePlus","eaglePlus","birdies","pars","bogeys","doubles","triplesPlus"].forEach(k=>{ A[k] += _num(g[k],0); });
    };

    const cohortField = {
      totals: makeAggLike(),
      totalsGross: makeAggGrossLike(),
      byPar: { "Par 3": makeAggLike(), "Par 4": makeAggLike(), "Par 5": makeAggLike(), "Unknown": makeAggLike() },
      byParGross: { "Par 3": makeAggGrossLike(), "Par 4": makeAggGrossLike(), "Par 5": makeAggGrossLike(), "Unknown": makeAggGrossLike() },
      bySI: { "1–6": makeAggLike(), "7–12": makeAggLike(), "13–18": makeAggLike(), "Unknown": makeAggLike() },
      bySIGross: { "1–6": makeAggGrossLike(), "7–12": makeAggGrossLike(), "13–18": makeAggGrossLike(), "Unknown": makeAggGrossLike() },
      byYards: {},
      byYardsGross: {},
    };

    // Helper for yardage bands object maps
    const addObjAgg = (dst, src, isGross) => {
      if (!src) return;
      Object.keys(src).forEach(k => {
        dst[k] ||= (isGross ? makeAggGrossLike() : makeAggLike());
        if (isGross) addAggGrossLike(dst[k], src[k]);
        else addAggLike(dst[k], src[k]);
      });
    };

    picks.forEach(p => {
      addAggLike(cohortField.totals, p.totals);
      addAggGrossLike(cohortField.totalsGross, p.totalsGross);
      ["Par 3","Par 4","Par 5","Unknown"].forEach(k=>{
        addAggLike(cohortField.byPar[k], p.byPar?.[k]);
        addAggGrossLike(cohortField.byParGross[k], p.byParGross?.[k]);
      });
      ["1–6","7–12","13–18","Unknown"].forEach(k=>{
        addAggLike(cohortField.bySI[k], p.bySI?.[k]);
        addAggGrossLike(cohortField.bySIGross[k], p.bySIGross?.[k]);
      });
      addObjAgg(cohortField.byYards, p.byYards, false);
      addObjAgg(cohortField.byYardsGross, p.byYardsGross, true);
    });

    return { label: `Handicap band (±${bw})`, players: picks, fieldAgg: cohortField };
  }, [cur, cohortMode, allPlayers, field]);

  const compField = cohort.fieldAgg || field;

  // ------------------------------------------------------------
  // Export the exact Overview benchmark outputs for the Season Report.
  // The report must NEVER recalculate peers/bands/filters; it reuses this.
  // ------------------------------------------------------------
  React.useEffect(() => {
    try {
      const mode = (String(cohortMode || "field") === "field") ? "field" : "band";
      const peers = Array.isArray(cohort?.players) ? cohort.players : [];

      // Compute transparent band label (range) and peer avg-hcap min/max.
      const seriesCur = Array.isArray(cur?.series) ? cur.series : [];
      const avgH = _mean(seriesCur.map(s => _num(s?.hcap, NaN)));
      const bw = Number.isFinite(avgH) ? (avgH >= 18 ? 6 : (avgH >= 10 ? 4 : 3)) : 4;

      let peerBandLabel = "Field";
      if (mode === "band") {
        if (Number.isFinite(avgH)) {
          const lo = avgH - bw;
          const hi = avgH + bw;
          peerBandLabel = `Handicap band (${lo.toFixed(1)}–${hi.toFixed(1)})`;
        } else {
          peerBandLabel = `Handicap band (±${bw})`;
        }
      } else {
        peerBandLabel = "Field";
      }
      if (/Field \(band too small\)/.test(String(cohort?.label || ""))) {
        // Preserve the existing UI's intent label when it falls back.
        peerBandLabel = "Field (band too small)";
      }

      let mn = Infinity, mx = -Infinity;
      for (const p of peers) {
        const s = Array.isArray(p?.series) ? p.series : [];
        const a = _mean(s.map(x => _num(x?.hcap, NaN)));
        if (Number.isFinite(a)) { mn = Math.min(mn, a); mx = Math.max(mx, a); }
      }

      window.__dslOverviewReport = {
        // identity
        playerName: String(cur?.name || ""),
        // current filters
        yearLabel: seasonYear,
        seasonLimit,
        scoringMode,
        lensMode: (localStorage.getItem("dsl_lens") || "pointsField"),
        // comparator state
        comparatorMode: (ppBarsMode === "strokesPar" ? "par" : mode),
        cohortLabel: (ppBarsMode === "strokesPar" ? "Par baseline" : String(cohort?.label || peerBandLabel)),
        peerBand: (ppBarsMode === "strokesPar" ? "Par baseline" : peerBandLabel),
        peerPlayersN: (ppBarsMode === "strokesPar" ? 0 : peers.length),
        peerMin: (ppBarsMode === "strokesPar" ? NaN : (mn !== Infinity ? mn : NaN)),
        peerMax: (ppBarsMode === "strokesPar" ? NaN : (mx !== -Infinity ? mx : NaN)),
        // Peer context (shown in Score vs Par for course-difficulty calibration)
        peerContextBand: peerBandLabel,
        peerContextPlayersN: peers.length,
        peerContextMin: (mn !== Infinity ? mn : NaN),
        peerContextMax: (mx !== -Infinity ? mx : NaN),
        // the exact aggregates the Overview uses for comparisons
        playerAgg: cur,
        peerAgg: (ppBarsMode === "strokesPar" ? null : compField),
        peerContextAgg: compField,
      };
      try { window.dispatchEvent(new Event("dsl_overview_report_change")); } catch(_e) {}

    } catch (e) {
      // Never break the UI.
    }
  }, [cur, cohort, compField, cohortMode, seasonYear, seasonLimit, scoringMode, ppBarsMode]);

  const avgPtsPH = (agg) => {
    const h = _num(agg?.holes, 0);
    const s = _num(agg?.pts, NaN);
    return h ? (s / h) : NaN;
  };
  const wipeRate = (agg) => {
    const h = _num(agg?.holes, 0);
    const w = _num(agg?.wipes, NaN);
    return h ? (w / h) : NaN;
  };
  const avgOverParPH = (agg) => {
    const h = _num(agg?.holes, 0);
    const v = _num(agg?.val, NaN);
    return h ? (v / h) : NaN;
  };

  // Overall (headline) — ROUND-WEIGHTED so it matches the Player Report everywhere
  const _seriesSortedPP = (p) => {
    const s = Array.isArray(p?.series) ? p.series.slice() : [];
    s.sort((a,b)=> (Number(a.dateMs)||Number(a.idx)||0) - (Number(b.dateMs)||Number(b.idx)||0));
    return s;
  };
  const _gamesOverall = (() => {
    const s = _seriesSortedPP(cur);
    const g = (Number.isFinite(_num(cur?.games, NaN)) ? Number(cur.games) : s.length);
    return (g && g > 0) ? g : s.length;
  })();
  const _useLatestOverall = (_gamesOverall === 1);

  const _roundMetric = (p) => {
    const s = _seriesSortedPP(p);
    if (!s.length) return NaN;
    const vals = (scoringMode === "gross")
      ? s.map(x => {
          const g = _num(x.gross, NaN);
          const parT = _num(x.parTotal, NaN);
          return (Number.isFinite(g) && Number.isFinite(parT)) ? (g - parT) : NaN; // strokes-over-par per round
        }).filter(Number.isFinite)
      : s.map(x => _num(x.pts, NaN)).filter(Number.isFinite);
    if (!vals.length) return NaN;
    return _useLatestOverall ? vals[vals.length-1] : _mean(vals);
  };

  const playerPR = _roundMetric(cur);
  const cohortPR = (() => {
    const ps = (cohort?.players || []).filter(p => p && cur && p.name !== cur.name);
    const vals = ps.map(p => _roundMetric(p)).filter(Number.isFinite);
    return vals.length ? (vals.reduce((a,b)=>a+b,0) / vals.length) : NaN;
  })();

  const overallGoodRd   = goodDelta(scoringMode, playerPR, cohortPR);

  // WHS-style normalisation: per-hole truth uses actual holes played in the active window (not assumed 18)
  const _gamesForHPR = (() => {
    const g = Number(cur?.games);
    if (Number.isFinite(g) && g > 0) return g;
    const s = Array.isArray(cur?.series) ? cur.series.length : 0;
    return s || 0;
  })();
  const _totalHolesForHPR = (() => {
    const src = (cur?.byParGross || cur?.byPar || {});
    return Object.values(src).reduce((a, r) => a + PR_num(r?.holes || r?.n || r?.count || 0, 0), 0);
  })();
  const _holesPerRoundForHPR = (_gamesForHPR > 0 && _totalHolesForHPR > 0) ? (_totalHolesForHPR / _gamesForHPR) : 18;

  const overallGoodPH   = Number.isFinite(overallGoodRd) ? (overallGoodRd / _holesPerRoundForHPR) : NaN;

  // -------------------------
  // Form / Consistency / Percentile
  // -------------------------
  const series = Array.isArray(cur?.series) ? cur.series.slice() : [];

  // number of rounds in the active sample (used for per-round scaling)
  const games = (Number.isFinite(cur?.games) ? Number(cur.games) : series.length) || 0;

  series.sort((a,b)=> {
    const ax = (Number.isFinite(a?.dateMs) && Number(a.dateMs)>0) ? Number(a.dateMs) : Number(a?.idx||0);
    const bx = (Number.isFinite(b?.dateMs) && Number(b.dateMs)>0) ? Number(b.dateMs) : Number(b?.idx||0);
    return ax - bx;
  });

  // --- UX Trend Chart (impact) ---
  const _isAllLimitPP = (String(seasonLimit || "").toLowerCase() === "all");
  const _limitNPP = _isAllLimitPP ? 0 : Number(seasonLimit);
  const _windowPP = (_limitNPP && _limitNPP > 0) ? series.slice(-_limitNPP) : series.slice();

  
  const _roundMetricPP = (s, metricKey) => {
    if (!s) return NaN;

    const key = String(metricKey || "overall");

    // Pull per-hole par layout for this round (needed for par-type splits)
    const ps = _tryGetParsSI(s);
    const pars = Array.isArray(ps?.pArr) ? ps.pArr : (Array.isArray(s?.parsPerHole) ? s.parsPerHole.map(Number) : (Array.isArray(s?.parPerHole) ? s.parPerHole.map(Number) : null));

    const wantPar = (key === "p3") ? 3 : (key === "p4") ? 4 : (key === "p5") ? 5 : null;

    if (wantPar && Array.isArray(pars) && pars.length) {
      if (scoringMode === "gross") {
        const gh = Array.isArray(s?.grossPerHole) ? s.grossPerHole : null;
        if (!Array.isArray(gh) || !gh.length) return NaN;
        let sumG = 0, sumP = 0, ok = 0;
        for (let i=0;i<Math.min(gh.length, pars.length);i++){
          if (Number(pars[i]) !== wantPar) continue;
          const g = _num(gh[i], NaN);
          if (!Number.isFinite(g)) continue;
          sumG += g;
          sumP += Number(pars[i]) || 0;
          ok += 1;
        }
        return ok ? (sumG - sumP) : NaN; // strokes-over-par on selected par type
      } else {
        const ph = Array.isArray(s?.perHole) ? s.perHole : (Array.isArray(s?.ptsPerHole) ? s.ptsPerHole : (Array.isArray(s?.pointsPerHole) ? s.pointsPerHole : null));
        if (!Array.isArray(ph) || !ph.length) return NaN;
        let sum = 0, ok = 0;
        for (let i=0;i<Math.min(ph.length, pars.length);i++){
          if (Number(pars[i]) !== wantPar) continue;
          const v = _num(ph[i], NaN);
          if (!Number.isFinite(v)) continue;
          sum += v;
          ok += 1;
        }
        return ok ? sum : NaN; // total Stableford points on selected par type
      }
    }

    // Default: overall per-round metric
    if (scoringMode === "gross") {
      const g = _num(s.gross, NaN);
      const parT = _num(s.parTotal, NaN);
      return (Number.isFinite(g) && Number.isFinite(parT)) ? (g - parT) : NaN; // strokes-over-par
    }
    return _num(s.pts, NaN);
  };

  const _yPlayerPP = _windowPP.map(r => _roundMetricPP(r, trendMetric));
  const _xLabelsPP = _windowPP.map((r, i) => {
    if (Number.isFinite(Number(r?.dateMs)) && Number(r.dateMs) > 0) {
      const d = new Date(Number(r.dateMs));
      return `${d.getDate()}/${d.getMonth()+1}`;
    }
    return `G${(Number(r?.idx)||i)+1}`;
  });

  const _trendNamePP = (trendMetric === "p3") ? "Par 3" : (trendMetric === "p4") ? "Par 4" : (trendMetric === "p5") ? "Par 5" : "Overall";
  const _trendDescPP = (() => {
    const base = (_trendNamePP === "Overall") ? "" : `${_trendNamePP} only — `;
    if (ppBarsMode === "pointsField") return base + "Stableford points per round compared to the field average. Higher is better.";
    if (ppBarsMode === "strokesField") return base + "Score per round compared to the field average. Lower is better.";
    return base + "Strokes over par per round. Lower is better.";
  })();

  // Field/cohort average per round (excluding current player)
  const _yFieldPP = (() => {
    const ps = Array.isArray(cohort?.players) ? cohort.players : (Array.isArray(seasonModel?.players) ? seasonModel.players : []);
    const peers = ps.filter(p => p && p.name !== cur?.name);
    return _windowPP.map((r) => {
      const key = r?.file;
      if (!key) return NaN;
      const vals = [];
      for (const p of peers) {
        const s = __filterSeries(p?.series);
        const match = s.find(x => x?.file === key);
        const v = _roundMetricPP(match, trendMetric);
        if (Number.isFinite(v)) vals.push(v);
      }
      return vals.length ? _mean(vals) : NaN;
    });
  })()
  
  const _yParPP = _windowPP.map((r) => {
    if (scoringMode === "gross") return 0;
    const key = String(trendMetric || "overall");
    if (key === "overall") return 36;

    const ps = _tryGetParsSI(r);
    const pars = Array.isArray(ps?.pArr) ? ps.pArr : (Array.isArray(r?.parsPerHole) ? r.parsPerHole.map(Number) : (Array.isArray(r?.parPerHole) ? r.parPerHole.map(Number) : null));
    const wantPar = (key === "p3") ? 3 : (key === "p4") ? 4 : (key === "p5") ? 5 : null;
    if (!wantPar || !Array.isArray(pars) || !pars.length) return NaN;

    let n = 0;
    for (let i=0;i<pars.length;i++) if (Number(pars[i]) === wantPar) n += 1;
    return n ? (2 * n) : NaN; // 2pts/hole baseline
  });


;


  const lastN = _windowPP.slice(); // use selected window (seasonLimit)
  const lastMetric = lastN.map(r => _roundMetricPP(r, trendMetric)).filter(Number.isFinite);
  const lastAvg = _mean(lastMetric);

  const vol = (scoringMode === "gross") ? _std(series.map(s => _num(s.gross, NaN) - _num(s.parTotal, NaN))) : _std(series.map(s => _num(s.pts, NaN)));

  const vel = (() => {
    const vals = (scoringMode === "gross")
      ? series.map(s => _num(s.gross, NaN) - _num(s.parTotal, NaN))
      : series.map(s => _num(s.pts, NaN));
    const sl = _slope(vals.filter(Number.isFinite));
    if (!Number.isFinite(sl)) return NaN;
    return (scoringMode === "gross") ? (-sl) : sl;
  })();

  const volFieldRaw = (scoringMode === "gross") ? _num(field?.metrics?.volGross, NaN) : _num(field?.metrics?.volPts, NaN);
  const velFieldRaw = (scoringMode === "gross") ? _num(field?.metrics?.grossVelocity, NaN) : _num(field?.metrics?.velocity, NaN);

  // Field baseline fallbacks (when field.metrics isn't present): compute averages across all players.
  const _fieldVolFallback = (() => {
    const ps = Array.isArray(seasonModel?.players) ? seasonModel.players : [];
    const vals = ps.map(p => {
      const s = Array.isArray(p?.series) ? p.series.slice() : [];
      if (!s.length) return NaN;
      s.sort((a,b)=> {
        const ax = (Number.isFinite(a?.dateMs) && Number(a.dateMs)>0) ? Number(a.dateMs) : Number(a?.idx||0);
        const bx = (Number.isFinite(b?.dateMs) && Number(b.dateMs)>0) ? Number(b.dateMs) : Number(b?.idx||0);
        return ax - bx;
      });
      const metric = (scoringMode === "gross")
        ? s.map(r => _num(r.gross, NaN) - _num(r.parTotal, NaN))
        : s.map(r => _num(r.pts, NaN));
      return _std(metric.filter(Number.isFinite));
    }).filter(Number.isFinite);
    return vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length) : NaN;
  })();

  const _fieldVelFallback = (() => {
    const ps = Array.isArray(seasonModel?.players) ? seasonModel.players : [];
    const vals = ps.map(p => {
      const s = Array.isArray(p?.series) ? p.series.slice() : [];
      if (!s.length) return NaN;
      s.sort((a,b)=> {
        const ax = (Number.isFinite(a?.dateMs) && Number(a.dateMs)>0) ? Number(a.dateMs) : Number(a?.idx||0);
        const bx = (Number.isFinite(b?.dateMs) && Number(b.dateMs)>0) ? Number(b.dateMs) : Number(b?.idx||0);
        return ax - bx;
      });
      const metric = (scoringMode === "gross")
        ? s.map(r => _num(r.gross, NaN) - _num(r.parTotal, NaN))
        : s.map(r => _num(r.pts, NaN));
      const sl = _slope(metric.filter(Number.isFinite));
      if (!Number.isFinite(sl)) return NaN;
      return (scoringMode === "gross") ? (-sl) : sl;
    }).filter(Number.isFinite);
    return vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length) : NaN;
  })();

  const volField = Number.isFinite(volFieldRaw) ? volFieldRaw : _fieldVolFallback;
  const velField = Number.isFinite(velFieldRaw) ? velFieldRaw : _fieldVelFallback;

  const _windowSeriesPP = React.useMemo(() => {
    const s = _seriesSortedPP(cur);
    const isAll = String(seasonLimit || "").toLowerCase() === "all";
    const n = isAll ? 0 : Number(seasonLimit);
    return (n && n > 0) ? s.slice(-n) : s;
  }, [cur, seasonLimit]);
  // --- Outcome mix (moved from Play) ---
  const outcomeMixPP = React.useMemo(() => {
    try { return PR_bucketOutcomeMix({ scoringMode, windowSeries: _windowSeriesPP }); }
    catch(e){ return { birdiePlusRate: NaN, parRate: NaN, bogeyRate: NaN, badRate: NaN }; }
  }, [scoringMode, _windowSeriesPP]);

  // Field comparator for outcome mix (always full field, window-matched)
  const fieldWindowSeriesPP = React.useMemo(() => {
    const arr = (allPlayers || []).flatMap(p => (Array.isArray(p?.series) ? p.series : [])).filter(Boolean);
    // sort by date if present (stable fallback)
    arr.sort((a,b) => (Number(a?.dateMs)||Number(a?.idx)||0) - (Number(b?.dateMs)||Number(b?.idx)||0));
    const isAll = String(seasonLimit || "").toLowerCase() === "all";
    const n = isAll ? 0 : Number(seasonLimit);
    return (n && n > 0) ? arr.slice(-n) : arr;
  }, [allPlayers, seasonLimit]);

  const fieldOutcomeMixPP = React.useMemo(() => {
    try { return PR_bucketOutcomeMix({ scoringMode, windowSeries: fieldWindowSeriesPP }); }
    catch(e){ return { birdiePlusRate: NaN, parRate: NaN, bogeyRate: NaN, badRate: NaN }; }
  }, [scoringMode, fieldWindowSeriesPP]);


  // -------------------------
  // Player Archetype (no shot history needed)
  // -------------------------
  const archetypePP = React.useMemo(() => {
    const isGross = (scoringMode === "gross");
    const siMe   = isGross ? (cur?.bySIGross || {}) : (cur?.bySI || {});
    const siFld  = isGross ? (compField?.bySIGross || {}) : (compField?.bySI || {});
    const parMe  = isGross ? (cur?.byParGross || {}) : (cur?.byPar || {});
    const parFld = isGross ? (compField?.byParGross || {}) : (compField?.byPar || {});

    const perf = (agg) => {
      if (!agg) return NaN;
      return isGross ? (-avgOverParPH(agg)) : (avgPtsPH(agg)); // higher is better in both cases
    };

    const pickKey = (obj, candidates) => {
      for (const k of candidates) if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return k;
      return candidates[0];
    };

    const kHard = pickKey(siMe, ["1–6","1-6","1–6 ","SI 1–6","SI 1-6"]);
    const kEasy = pickKey(siMe, ["13–18","13-18","13–18 ","SI 13–18","SI 13-18"]);

    const meHard = perf(siMe?.[kHard]);
    const meEasy = perf(siMe?.[kEasy]);
    const fdHard = perf(siFld?.[kHard]);
    const fdEasy = perf(siFld?.[kEasy]);

    const meP3 = perf(parMe?.[pickKey(parMe, ["Par 3","P3","par3","3"])]);
    const meP4 = perf(parMe?.[pickKey(parMe, ["Par 4","P4","par4","4"])]);
    const meP5 = perf(parMe?.[pickKey(parMe, ["Par 5","P5","par5","5"])]);
    const fdP3 = perf(parFld?.[pickKey(parFld, ["Par 3","P3","par3","3"])]);
    const fdP4 = perf(parFld?.[pickKey(parFld, ["Par 4","P4","par4","4"])]);
    const fdP5 = perf(parFld?.[pickKey(parFld, ["Par 5","P5","par5","5"])]);

    const thr = isGross ? 0.08 : 0.12; // per-hole swing that feels meaningful
    const dHard = (Number.isFinite(meHard) && Number.isFinite(fdHard)) ? (meHard - fdHard) : NaN;
    const dEasy = (Number.isFinite(meEasy) && Number.isFinite(fdEasy)) ? (meEasy - fdEasy) : NaN;
    const dP3 = (Number.isFinite(meP3) && Number.isFinite(fdP3)) ? (meP3 - fdP3) : NaN;
    const dP5 = (Number.isFinite(meP5) && Number.isFinite(fdP5)) ? (meP5 - fdP5) : NaN;

    const score = (x) => {
      if (!Number.isFinite(x)) return 0;
      return Math.max(0, Math.min(3, Math.abs(x) / thr));
    };

    const candidates = [];

    // Waster: bleeds on easy holes (and often doesn't show the same leak on hard holes)
    if (Number.isFinite(dEasy) && dEasy < -thr) {
      const extra = Number.isFinite(dHard) ? Math.max(0, (dHard - dEasy) / thr) : 0;
      candidates.push({
        key: "waster",
        name: "The Waster",
        icon: "🧩",
        why: "Easy holes (SI 13–18) are costing you more than the field. That usually means giving away points with short-game mistakes or poor ‘safe-miss’ decisions.",
        tip: "Default to centre-green targets on SI 13–18 and protect par first. Birdies come from boring golf.",
        s: score(dEasy) + 0.5*extra,
      });
    }

    // Survivor: strong on hard holes, weak on easy holes
    if (Number.isFinite(dHard) && Number.isFinite(dEasy) && dHard > thr && dEasy < -thr) {
      candidates.push({
        key: "survivor",
        name: "The Survivor",
        icon: "🛡️",
        why: "You hang in there on the toughest holes, but you leak points on the ‘scoring’ holes.",
        tip: "Treat easy holes as ‘no big number’ holes: aim fat, avoid short-side, two-putt and move on.",
        s: score(dHard) + score(dEasy),
      });
    }

    // Par 3 victim
    if (Number.isFinite(dP3) && dP3 < -thr) {
      candidates.push({
        key: "p3",
        name: "The Par 3 Victim",
        icon: "🎯",
        why: "You lose more than the field on par 3s — usually start-line / club selection / commitment.",
        tip: "On par 3s: pick a bigger target (middle), choose the longer club if between, and commit to one start line.",
        s: score(dP3),
      });
    }

    // Par 5 butcher
    if (Number.isFinite(dP5) && dP5 < -thr) {
      candidates.push({
        key: "p5",
        name: "The Par 5 Butcher",
        icon: "🚀",
        why: "Par 5s should be your scoring holes, but they’re costing you more than the field — often from hero shots or poor wedge numbers.",
        tip: "Make par 5s a 3-shot plan: safe tee ball → lay up to a favourite wedge → fat green.",
        s: score(dP5),
      });
    }

    // Steady bogey player: low volatility + low birdie-plus
    const birdMe = Number.isFinite(outcomeMixPP?.birdiePlusRate) ? outcomeMixPP.birdiePlusRate : NaN;
    const birdFd = Number.isFinite(fieldOutcomeMixPP?.birdiePlusRate) ? fieldOutcomeMixPP.birdiePlusRate : NaN;
    const volMe  = Number.isFinite(vol) ? vol : NaN;
    const volFd  = Number.isFinite(volField) ? volField : NaN;
    if (Number.isFinite(volMe) && Number.isFinite(volFd) && volMe <= volFd * 0.8) {
      const birdGap = (Number.isFinite(birdMe) && Number.isFinite(birdFd)) ? (birdMe - birdFd) : NaN;
      candidates.push({
        key: "steady",
        name: "The Steady Bogey Player",
        icon: "🧱",
        why: "Your scoring is consistent (low volatility). That’s a strength — but you may not be creating enough birdie chances to move the needle.",
        tip: "Keep the safety, add upside: pick 1–2 holes per round to be aggressive (only when the miss is safe).",
        s: 0.8 + (Number.isFinite(birdGap) && birdGap < 0 ? score(birdGap) : 0),
      });
    }

    if (!candidates.length) {
      return {
        name: "No clear archetype yet",
        icon: "🧭",
        why: "Not enough data to confidently label a pattern. Get a few more rounds in and this will sharpen up.",
        tip: "For now: reduce doubles on SI 1–6 and protect par on SI 13–18.",
      };
    }

    candidates.sort((a,b)=> (b.s||0) - (a.s||0));
    const best = candidates[0];
    return best;
  }, [scoringMode, cur, compField, vol, volField, outcomeMixPP, fieldOutcomeMixPP]);

// -------------------------
// Comfort Zone Yardage (vs expected) + Round Pattern (Golf DNA)
// Uses only: per-hole scores/points, pars, SI, yards, playing handicap
// -------------------------
const _getYardsArr = (r) => {
  const y =
    (r && (r.yardsPerHole || r.ydsPerHole || r.yardsArr || r.yards || r.holeYards || r.yardages || r.yardage)) ||
    null;
  return Array.isArray(y) ? y.map((v) => _safeNum(v, NaN)) : null;
};

const _getGrossArr = (r) => {
  const g =
    (r && (r.grossPerHole || r.grossHoles || r.holeGross || r.scoresPerHole || r.scores || r.grossArr)) ||
    null;
  return Array.isArray(g) ? g.map((v) => _safeNum(v, NaN)) : null;
};

const _getPtsArr = (r) => {
  const p =
    (r && (r.perHole || r.perHolePts || r.pointsPerHole || r.ptsPerHole || r.stablefordPerHole || r.stablefordHoles)) ||
    null;
  return Array.isArray(p) ? p.map((v) => _safeNum(v, NaN)) : null;
};

// Per-hole performance delta vs expectation:
//  - Stableford: pts - 2 (net par baseline)
//  - Gross: gross - (par + strokesReceived)  (net par baseline in strokes)
const _holeDeltaVsExpected = (round, holeIdx) => {
  const ps = _tryGetParsSI(round);
  const pars = Array.isArray(ps?.pArr) ? ps.pArr : null;
  const si = Array.isArray(ps?.sArr) ? ps.sArr : null;

  if (scoringMode === "gross") {
    const g = _getGrossArr(round);
    if (!g || !pars || !si) return NaN;

    const gross = _safeNum(g[holeIdx], NaN);
    const par = _safeNum(pars[holeIdx], NaN);
    const s = _safeNum(si[holeIdx], NaN);
    if (!Number.isFinite(gross) || !Number.isFinite(par) || !Number.isFinite(s)) return NaN;

    const playingHcap = Math.round(_safeNum(round?.hcap ?? round?.playingHcap ?? round?.startExact ?? round?.handicap ?? cur?.playingHcap ?? cur?.startExact ?? cur?.handicap ?? NaN, NaN));
    const sr = WHS_strokesReceivedOnHole(playingHcap, s);
    const expected = par + sr;
    return gross - expected; // + = worse than expected
  }

  const pts = _getPtsArr(round);
  if (!pts) return NaN;
  const v = _safeNum(pts[holeIdx], NaN);
  if (!Number.isFinite(v)) return NaN;
  return v - 2; // + = better than expected
};

const _fmtDelta = (x) => {
  if (!Number.isFinite(x)) return "—";
  if (scoringMode === "gross") {
    // strokes over expected (lower better)
    if (Math.abs(x) < 0.05) return "0.0";
    return (x > 0 ? "+" : "") + _fmt(x, 1);
  }
  // points vs expected (higher better)
  if (Math.abs(x) < 0.05) return "0.0";
  return (x > 0 ? "+" : "") + _fmt(x, 1);
};



  // -------------------------
  // FIX THIS (single main improvement lever)
  // Uses only per-hole scores/points + pars + SI + yards + playing handicap
  // -------------------------
  const fixThisPP = React.useMemo(() => {
    const rounds = Array.isArray(_windowSeriesPP) ? _windowSeriesPP : [];
    if (!rounds.length) {
      return {
        status: "none",
        title: "NOTHING OBVIOUS TO FIX",
        headline: "No real weaknesses identified.",
        gain: NaN,
        unit: (scoringMode === "gross" ? "strokes/round" : "pts/round"),
        detail: "Add a few more rounds and this will get sharper.",
      };
    }

    const isGross = (scoringMode === "gross");
    const unit = isGross ? "strokes/round" : "pts/round";

    // Gather per-area totals: we treat "leak" as positive (bad)
    const areas = {
      easy: { key: "easy", label: "Stop leaking on easy holes (SI 13–18)", sumLeak: 0, holes: 0, rounds: 0 },
      hard: { key: "hard", label: "Reduce big numbers on hard holes (SI 1–6)", sumLeak: 0, holes: 0, rounds: 0 },
      p3:   { key: "p3",   label: "Par 3s are costing you", sumLeak: 0, holes: 0, rounds: 0 },
      p5:   { key: "p5",   label: "You’re not scoring on par 5s", sumLeak: 0, holes: 0, rounds: 0 },
      longP4:{key:"longP4",label:"Long par 4s (411y+) hurt you", sumLeak: 0, holes: 0, rounds: 0 },
    };

    const add = (a, delta) => {
      if (!Number.isFinite(delta)) return;
      // In gross: +delta = worse. In stableford: -delta = worse (since delta = pts-2)
      const leak = isGross ? delta : (-delta);
      a.sumLeak += leak;
      a.holes += 1;
    };

    rounds.forEach((r) => {
      const ps = _tryGetParsSI(r);
      const pars = Array.isArray(ps?.pArr) ? ps.pArr : [];
      const sis  = Array.isArray(ps?.sArr) ? ps.sArr : [];
      const yards = _getYardsArr(r) || [];
      const holes = Math.max(pars.length, sis.length, yards.length, 18);

      let touched = { easy:false, hard:false, p3:false, p5:false, longP4:false };

      for (let i=0;i<holes;i++){
        const par = _safeNum(pars[i], NaN);
        const si  = _safeNum(sis[i], NaN);
        const y   = _safeNum(yards[i], NaN);

        const delta = _holeDeltaVsExpected(r, i); // gross: strokes over expected; stableford: pts-2
        if (!Number.isFinite(delta)) continue;

        if (Number.isFinite(si) && si >= 13 && si <= 18) { add(areas.easy, delta); touched.easy = true; }
        if (Number.isFinite(si) && si >= 1  && si <= 6)  { add(areas.hard, delta); touched.hard = true; }

        if (Number.isFinite(par) && par === 3) { add(areas.p3, delta); touched.p3 = true; }
        if (Number.isFinite(par) && par === 5) { add(areas.p5, delta); touched.p5 = true; }
        if (Number.isFinite(par) && par === 4 && Number.isFinite(y) && y >= 411) { add(areas.longP4, delta); touched.longP4 = true; }
      }

      // Round-counts help us estimate "holes per round" for that area
      Object.keys(touched).forEach(k => { if (touched[k]) areas[k].rounds += 1; });
    });

    const toGain = (a) => {
      if (!a || !a.holes) return { gain: NaN, avgLeakPH: NaN, holesPerRound: NaN };
      const avgLeakPH = a.sumLeak / a.holes; // positive = bad
      const holesPerRound = a.rounds ? (a.holes / a.rounds) : NaN;
      const gain = Number.isFinite(holesPerRound) ? (avgLeakPH * holesPerRound) : NaN; // per round
      return { gain, avgLeakPH, holesPerRound };
    };

    const scored = Object.values(areas).map(a => {
      const t = toGain(a);
      return { ...a, ...t };
    });

    // Confidence gates to avoid noise
    const MIN_HOLES = 18;     // at least ~1 full round worth in that bucket across window
    const MIN_GAIN  = isGross ? 0.7 : 1.4; // pts scale is ~2x strokes-ish; keep it meaningful

    const viable = scored
      .filter(a => Number.isFinite(a.gain) && a.holes >= MIN_HOLES && a.gain >= MIN_GAIN)
      .sort((x,y) => (y.gain||0) - (x.gain||0));

    if (!viable.length) {
      return {
        status: "none",
        title: "NOTHING OBVIOUS TO FIX",
        headline: "No real weaknesses identified.",
        gain: NaN,
        unit,
        detail: "You’re pretty balanced in this window. Biggest gains come from general consistency (fewer doubles).",
      };
    }

    const best = viable[0];

    // Round gain display (conservative, rounded)
    const round05 = (v) => {
      if (!Number.isFinite(v)) return NaN;
      const clamped = Math.max(0.5, Math.min(3.5, v));
      return Math.round(clamped * 2) / 2;
    };

    const gainShow = round05(best.gain);

    // Copy: one-liner + practical nudge
    const copy = {
      easy: "These are advantage holes. Play boring golf: fat target, avoid short-side, bank par first.",
      hard: "Cut doubles. Choose safer lines and accept bogey—protect against the big number.",
      p3:   "Centre-green targets and committed swings. If between clubs, take the longer one.",
      p5:   "Make it a 3-shot plan: safe tee ball → lay up to a favourite wedge → fat green.",
      longP4:"Prioritise position over power. Take trouble out of play and keep the next shot simple.",
    };

    const headline =
      `${best.label} \u2192 gain ~${Number.isFinite(gainShow) ? gainShow.toFixed(1) : "—"} ${unit}`;

    return {
      status: "fix",
      title: "FIX THIS",
      headline,
      gain: gainShow,
      unit,
      detail: copy[best.key] || "Focus here for the quickest gains.",
      key: best.key,
      sample: { holes: best.holes, rounds: best.rounds }
    };
  }, [scoringMode, _windowSeriesPP, cur]);


const comfortZonePP = React.useMemo(() => {
  const rounds = Array.isArray(_windowSeriesPP) ? _windowSeriesPP : [];
  const buckets = {
    all: [
      { k: "short", label: "Short", sum: 0, n: 0 },
      { k: "mid", label: "Mid", sum: 0, n: 0 },
      { k: "long", label: "Long", sum: 0, n: 0 },
    ],
    p3: [
      { k: "short", label: "<150y", sum: 0, n: 0 },
      { k: "mid", label: "150–175y", sum: 0, n: 0 },
      { k: "long", label: "176y+", sum: 0, n: 0 },
    ],
    p4: [
      { k: "short", label: "<360y", sum: 0, n: 0 },
      { k: "mid", label: "360–410y", sum: 0, n: 0 },
      { k: "long", label: "411y+", sum: 0, n: 0 },
    ],
    p5: [
      { k: "short", label: "<500y", sum: 0, n: 0 },
      { k: "mid", label: "500–540y", sum: 0, n: 0 },
      { k: "long", label: "541y+", sum: 0, n: 0 },
    ],
  };

  const pickBucket = (par, y) => {
    if (!Number.isFinite(y) || !Number.isFinite(par)) return null;
    if (par === 3) {
      if (y < 150) return "short";
      if (y <= 175) return "mid";
      return "long";
    }
    if (par === 4) {
      if (y < 360) return "short";
      if (y <= 410) return "mid";
      return "long";
    }
    if (par === 5) {
      if (y < 500) return "short";
      if (y <= 540) return "mid";
      return "long";
    }
    // fallback for unexpected pars: coarse buckets
    if (y < 170) return "short";
    if (y <= 400) return "mid";
    return "long";
  };

  for (const r of rounds) {
    const ps = _tryGetParsSI(r);
    const pars = Array.isArray(ps?.pArr) ? ps.pArr : null;
    const yards = _getYardsArr(r);
    if (!pars || !yards) continue;

    const holesN = Math.min(pars.length, yards.length, 18);
    for (let i = 0; i < holesN; i++) {
      const par = _safeNum(pars[i], NaN);
      const y = _safeNum(yards[i], NaN);
      const b = pickBucket(par, y);
      if (!b) continue;

      const d = _holeDeltaVsExpected(r, i);
      if (!Number.isFinite(d)) continue;

      // all-par bucket
      const allRow = buckets.all.find((x) => x.k === b);
      if (allRow) { allRow.sum += d; allRow.n += 1; }

      // per-par bucket
      const key = (par === 3) ? "p3" : (par === 4) ? "p4" : (par === 5) ? "p5" : null;
      if (!key) continue;
      const row = buckets[key].find((x) => x.k === b);
      if (row) { row.sum += d; row.n += 1; }
    }
  }

  const out = {};
  Object.keys(buckets).forEach((k) => {
    out[k] = buckets[k].map((b) => ({
      ...b,
      avg: b.n ? (b.sum / b.n) : NaN,
    }));
  });

  // headline helper
  const makeHeadline = (rows, parLabel) => {
    const rs = (rows || []).filter((x) => Number.isFinite(x.avg) && (x.n || 0) >= 6);
    if (!rs.length) return "Not enough hole data in this window yet.";
    // In gross, higher avg is worse; in stableford, lower avg is worse.
    const worst = rs.slice().sort((a,b) => {
      if (scoringMode === "gross") return (b.avg - a.avg);
      return (a.avg - b.avg);
    })[0];
    const threshold = (scoringMode === "gross") ? 0.4 : -0.4; // meaningful per-hole swing
    const bad = (scoringMode === "gross") ? (worst.avg >= threshold) : (worst.avg <= threshold);
    if (!bad) return `No obvious drop-off by yardage (${parLabel}).`;
    const desc = scoringMode === "gross"
      ? `You struggle most on ${parLabel} in the ${worst.label} bucket (${_fmtDelta(worst.avg)} strokes vs expected per hole).`
      : `You struggle most on ${parLabel} in the ${worst.label} bucket (${_fmtDelta(worst.avg)} pts vs expected per hole).`;
    return desc;
  };

  out.headlines = {
    all: makeHeadline(out.all, "all pars"),
    p3: makeHeadline(out.p3, "Par 3s"),
    p4: makeHeadline(out.p4, "Par 4s"),
    p5: makeHeadline(out.p5, "Par 5s"),
  };

  return out;
}, [_windowSeriesPP, scoringMode, cur]);

const golfDNAPP = React.useMemo(() => {
  const rounds = Array.isArray(_windowSeriesPP) ? _windowSeriesPP : [];
  if (!rounds.length) return { label: "—", why: "No rounds in this window.", holes: [], phase: null, holeAvg: [] };

  // Phase split: 1-6, 7-12, 13-18 (supports 9-hole by using available holes)
  const phaseSums = [0,0,0];
  const phaseNs = [0,0,0];

  const holeSum = Array.from({length: 18}).map(()=>0);
  const holeN = Array.from({length: 18}).map(()=>0);

  for (const r of rounds) {
    // infer hole count from pars/perHole
    const ps = _tryGetParsSI(r);
    const pars = Array.isArray(ps?.pArr) ? ps.pArr : null;
    const pts = _getPtsArr(r);
    const gross = _getGrossArr(r);
    const nH = Math.min(18,
      Array.isArray(pars) ? pars.length : 18,
      Array.isArray(pts) ? pts.length : 18,
      Array.isArray(gross) ? gross.length : 18
    );

    for (let i=0;i<nH;i++){
      const d = _holeDeltaVsExpected(r, i);
      if (!Number.isFinite(d)) continue;

      // hole fingerprint
      holeSum[i] += d;
      holeN[i] += 1;

      // phase
      const ph = (i < 6) ? 0 : (i < 12) ? 1 : 2;
      phaseSums[ph] += d;
      phaseNs[ph] += 1;
    }
  }

  const phaseAvg = phaseSums.map((s,i)=> phaseNs[i] ? (s/phaseNs[i]) : NaN);
  const holeAvg = holeSum.map((s,i)=> holeN[i] ? (s/holeN[i]) : NaN);

  const span = (() => {
    const xs = phaseAvg.filter(Number.isFinite);
    if (xs.length < 2) return NaN;
    return Math.max(...xs) - Math.min(...xs);
  })();

  const thr = (scoringMode === "gross") ? 0.35 : 0.35; // per-hole meaningful phase swing
  let label = "Steady Engine";
  let why = "Your scoring pattern is fairly even across the round.";

  if (Number.isFinite(span) && span >= thr) {
    // Determine which phase is best/worst (remember: gross lower is better, stable higher is better)
    const scorePhase = (v) => scoringMode === "gross" ? -v : v; // higher is better
    const scored = phaseAvg.map((v,i)=> ({i, v, s: scorePhase(v)})).filter(x=>Number.isFinite(x.v));
    scored.sort((a,b)=> b.s - a.s);
    const best = scored[0];
    const worst = scored[scored.length-1];

    if (best.i===0 && worst.i===2) {
      label = "Fast Starter";
      why = "You tend to score best early, then drift later. A tighter routine on holes 13–18 usually pays off.";
    } else if (best.i===2 && worst.i===0) {
      label = "Slow Cooker";
      why = "You often start slow and finish strong. A sharper warm-up and first-tee plan could unlock quick wins.";
    } else if (worst.i===1) {
      label = "Mid‑Round Wobble";
      why = "Holes 7–12 are your soft spot. That’s often focus/tempo or one bad stretch compounding.";
    } else if (worst.i===2) {
      label = "Late Collapse";
      why = "Your last 6 holes cost you most. Keep it boring late: big targets, avoid short-side, protect par.";
    } else {
      label = "Rollercoaster";
      why = "Your best and worst phases are far apart. The goal is fewer big swings: commit to safer targets and one tempo.";
    }
  }

  // top strength/leak holes (based on long-term avg delta)
  const byHole = holeAvg.map((v,i)=> ({hole:i+1, v, n: holeN[i]||0}))
    .filter(x=>Number.isFinite(x.v) && x.n>=3);

  const scoreHole = (v) => scoringMode === "gross" ? -v : v;
  const strengths = byHole.slice().sort((a,b)=> scoreHole(b.v) - scoreHole(a.v)).slice(0,3);
  const leaks = byHole.slice().sort((a,b)=> scoreHole(a.v) - scoreHole(b.v)).slice(0,3);

  return { label, why, phaseAvg, holeAvg, strengths, leaks };
}, [_windowSeriesPP, scoringMode, cur]);

const [comfortTab, setComfortTab] = useState("all");
const [dnaMode, setDnaMode] = useState("phase"); // 'phase' | 'holes'


  const _meanFinite = (arr) => {
    const xs = (arr || []).map(Number).filter(Number.isFinite);
    return xs.length ? xs.reduce((a,b)=>a+b,0) / xs.length : NaN;
  };

  const _avgPts = _meanFinite(_windowSeriesPP.map(r => _num(r?.pts, _num(r?.points, NaN))));
  const _avgGross = _meanFinite(_windowSeriesPP.map(r => _num(r?.gross, NaN)));

  const _frontAvgPts = _meanFinite(_windowSeriesPP.map(r => _num(r?.frontPts, NaN)));
  const _backAvgPts  = _meanFinite(_windowSeriesPP.map(r => _num(r?.backPts, NaN)));

  const _frontBackLine = (() => {
    // Prefer explicit per-round front/back points if present; otherwise fall back to perHole.
    let f = _frontAvgPts, b = _backAvgPts;
    if (!Number.isFinite(f) || !Number.isFinite(b)) {
      const fArr = [];
      const bArr = [];
      for (const r of _windowSeriesPP) {
        const ph = Array.isArray(r?.perHole) ? r.perHole : null;
        if (!ph) continue;
        const fv = ph.slice(0,9).reduce((a,x)=>a+_num(x,0),0);
        const bv = ph.slice(9,18).reduce((a,x)=>a+_num(x,0),0);
        if (Number.isFinite(fv)) fArr.push(fv);
        if (Number.isFinite(bv)) bArr.push(bv);
      }
      f = _meanFinite(fArr);
      b = _meanFinite(bArr);
    }
    if (!Number.isFinite(f) || !Number.isFinite(b)) return "No clear front/back split.";
    if (Math.abs(f-b) < 0.5) return "Front and back 9 are basically even.";
    return (f > b) ? "You score stronger on the front 9." : "You score stronger on the back 9.";
  })();

  const _overallPPHMeta = (() => {
    let sum = 0;
    let n = 0;
    for (const r of (_windowSeriesPP || [])) {
      const ph = Array.isArray(r?.perHole) ? r.perHole : null;
      if (!ph) continue;
      for (const x of ph) {
        const v = _num(x, NaN);
        if (Number.isFinite(v)) { sum += v; n += 1; }
      }
    }
    return { pph: n ? (sum / n) : NaN, n };
  })();

  const _overallPPH = _overallPPHMeta.pph;

  const _rangeAvgTotal = (a, b) => {
    const totals = [];
    for (const r of (_windowSeriesPP || [])) {
      const ph = Array.isArray(r?.perHole) ? r.perHole : null;
      if (!ph || ph.length < b) continue;
      let s = 0;
      let ok = false;
      for (let i = a; i < b; i++) {
        const v = _num(ph[i], NaN);
        if (Number.isFinite(v)) { s += v; ok = true; } else { /* treat missing as 0 */ }
      }
      if (ok) totals.push(s);
    }
    return totals.length ? (totals.reduce((x,y)=>x+y,0) / totals.length) : NaN;
  };

  const _rangeNHoles = (a, b) => {
    // Count how many hole-values are considered in _rangeAvgTotal (missing treated as 0).
    let rounds = 0;
    for (const r of (_windowSeriesPP || [])) {
      const ph = Array.isArray(r?.perHole) ? r.perHole : null;
      if (!ph || ph.length < b) continue;
      // Require at least one finite value in the range to count the round (mirrors _rangeAvgTotal).
      let ok = false;
      for (let i = a; i < b; i++) {
        const v = _num(ph[i], NaN);
        if (Number.isFinite(v)) { ok = true; break; }
      }
      if (ok) rounds += 1;
    }
    return rounds * (b - a);
  };


  const _first3AvgPts = _rangeAvgTotal(0, 3);       // holes 1-3
  const _last3AvgPts  = _rangeAvgTotal(15, 18);     // holes 16-18

  const _first3NHoles = _rangeNHoles(0, 3);
  const _last3NHoles  = _rangeNHoles(15, 18);

  const _fastStart = (() => {
    if (!Number.isFinite(_first3AvgPts) || !Number.isFinite(_overallPPH)) return null;
    const pph = _first3AvgPts / 3;
    const delta = pph - _overallPPH;
    return { pph, delta, is: delta >= 0.15 };
  })();

  const _clutchFinish = (() => {
    if (!Number.isFinite(_last3AvgPts) || !Number.isFinite(_overallPPH)) return null;
    const pph = _last3AvgPts / 3;
    const delta = pph - _overallPPH;
    return { pph, delta, is: delta >= 0.15 };
  })();

  // -------------------------
  // After a bad hole (Resilience)
  // Trigger: a hole where gross is >= (par + strokesRec + 2) i.e. net double bogey or worse.
  // Metric: how the *next hole* performs vs the player's normal baseline.
  //  - Points: avg(next hole pts) - avg(all hole pts)
  //  - Strokes: avg(next hole (gross - expectedNetPar)) - avg(all hole (gross - expectedNetPar))
  // NOTE: uses only CSV data already available in series: perHole (Stableford), grossPerHole (WHS-filled), parsArr, siArr, hcap.
  const _afterBadHole = (() => {
    try {
      const rounds = Array.isArray(_windowSeriesPP) ? _windowSeriesPP : [];
      if (!rounds.length) return null;

      const allPts = [];
      const allDeltaStr = [];
      const nextPts = [];
      const nextDeltaStr = [];
      let triggers = 0;

      for (const r of rounds) {
        const ph = Array.isArray(r?.perHole) ? r.perHole.slice(0, 18) : null;
        const gph = Array.isArray(r?.grossPerHole) ? r.grossPerHole.slice(0, 18) : null;
        const pars = Array.isArray(r?.parsArr) ? r.parsArr.slice(0, 18) : (Array.isArray(r?.parsPerHole) ? r.parsPerHole.slice(0, 18) : null);
        const si = Array.isArray(r?.siArr) ? r.siArr.slice(0, 18) : (Array.isArray(r?.siPerHole) ? r.siPerHole.slice(0, 18) : null);
        const hcap = _num(r?.hcap, NaN);
        if (!ph || !gph || !pars || !si) continue;

        const strokesRecAt = (siVal) => {
          if (!Number.isFinite(hcap) || !Number.isFinite(siVal)) return 0;
          const fullRounds = Math.floor(hcap / 18);
          const remainder = hcap % 18;
          return fullRounds + (remainder >= siVal ? 1 : 0);
        };

        // Baselines (all played holes)
        for (let i = 0; i < 18; i++) {
          const pts = _safeNum(ph[i], NaN);
          const g = _safeNum(gph[i], NaN);
          const par = _safeNum(pars[i], NaN);
          const siVal = _safeNum(si[i], NaN);
          const played = Number.isFinite(pts) || Number.isFinite(g);
          if (!played) continue;
          if (Number.isFinite(pts)) allPts.push(pts);
          if (Number.isFinite(g) && Number.isFinite(par)) {
            const exp = par + strokesRecAt(siVal);
            allDeltaStr.push(g - exp);
          }
        }

        // Triggers + next-hole outcomes
        for (let i = 0; i < 17; i++) {
          const g = _safeNum(gph[i], NaN);
          const par = _safeNum(pars[i], NaN);
          const siVal = _safeNum(si[i], NaN);
          if (!Number.isFinite(g) || !Number.isFinite(par)) continue;
          const exp = par + strokesRecAt(siVal);
          const delta = g - exp;
          if (!(delta >= 2)) continue; // net double bogey or worse

          // Ensure next hole is played
          const ptsN = _safeNum(ph[i + 1], NaN);
          const gN = _safeNum(gph[i + 1], NaN);
          const parN = _safeNum(pars[i + 1], NaN);
          const siN = _safeNum(si[i + 1], NaN);
          const playedNext = Number.isFinite(ptsN) || Number.isFinite(gN);
          if (!playedNext) continue;

          triggers += 1;
          if (Number.isFinite(ptsN)) nextPts.push(ptsN);
          if (Number.isFinite(gN) && Number.isFinite(parN)) {
            const expN = parN + strokesRecAt(siN);
            nextDeltaStr.push(gN - expN);
          }
        }
      }

      const basePPH = allPts.length ? _meanFinite(allPts) : NaN;
      const baseDelta = allDeltaStr.length ? _meanFinite(allDeltaStr) : NaN;
      const nPts = nextPts.length;
      const nStr = nextDeltaStr.length;

      // Require a minimum sample so this doesn't shout noise.
      const n = Math.max(nPts, nStr, triggers);
      if (!n || n < 4) return null;

      const nextPPH = nPts ? _meanFinite(nextPts) : NaN;
      const nextDelta = nStr ? _meanFinite(nextDeltaStr) : NaN;

      const resiliencePts = (Number.isFinite(nextPPH) && Number.isFinite(basePPH)) ? (nextPPH - basePPH) : NaN;
      const resilienceStr = (Number.isFinite(nextDelta) && Number.isFinite(baseDelta)) ? (nextDelta - baseDelta) : NaN;

      const label = (() => {
        // Use points if available; otherwise strokes (lower is better).
        if (Number.isFinite(resiliencePts)) {
          if (resiliencePts <= -0.10) return "Ice cold";
          if (resiliencePts <= -0.03) return "Resilient";
          if (resiliencePts >= 0.10) return "Spiraler";
          if (resiliencePts >= 0.03) return "Wobbly";
          return "Neutral";
        }
        if (Number.isFinite(resilienceStr)) {
          if (resilienceStr <= -0.10) return "Ice cold";
          if (resilienceStr <= -0.03) return "Resilient";
          if (resilienceStr >= 0.10) return "Spiraler";
          if (resilienceStr >= 0.03) return "Wobbly";
          return "Neutral";
        }
        return "Neutral";
      })();

      const summary = (() => {
        // Message aligned with how golfers talk.
        const usePts = Number.isFinite(resiliencePts);
        const x = usePts ? resiliencePts : resilienceStr;
        if (!Number.isFinite(x)) return "Not enough data.";
        if (x >= 0.10) return "You tend to carry mistakes forward. Reset routine needed.";
        if (x >= 0.03) return "A small dip after mistakes — quick reset helps.";
        if (x <= -0.10) return "You bounce back strongly — that’s a scoring superpower.";
        if (x <= -0.03) return "You recover well after mistakes.";
        return "You’re steady after mistakes.";
      })();

      return {
        triggers,
        nPts,
        nStr,
        resiliencePts,
        resilienceStr,
        label,
        summary,
      };
    } catch (e) {
      return null;
    }
  })();


const _courseFit = React.useMemo(() => {
  try {
    const targetCourse = problemHolePack?.courseName ? String(problemHolePack.courseName) : "";
    const targetTee = problemHolePack?.teeName ? String(problemHolePack.teeName) : "";
    if (!targetCourse) return { ok: false, reason: "no_course" };

    const getRoundCourse = (r) => r?.courseName ?? r?.course ?? r?.course_name ?? r?.courseLabel ?? r?.course_label ?? "";
    const getRoundTee = (r) => r?.teeName ?? r?.tee ?? r?.tee_label ?? r?.teeLabel ?? r?.tee_color ?? "";
    const getRoundPts = (r) => PR_num(r?.points ?? r?.stableford ?? r?.stablefordTotal ?? r?.totalPoints ?? r?.pts, NaN);
    const getRoundHI = (r) => PR_num(r?.startExact ?? r?.start_exact ?? r?.handicapIndex ?? r?.handicap_index ?? r?.hi ?? r?.HI ?? r?.index ?? r?.INDEX, NaN);

    const deltas = [];
    for (const p of (allPlayers || [])) {
      if (!_isRealPlayer(p)) continue;
      const series = Array.isArray(p.series) ? p.series : [];
      if (!series.length) continue;

      const onCourse = series.filter(r => {
        const c = _normKey(getRoundCourse(r));
        const t = _normKey(getRoundTee(r));
        if (!c) return false;
        const courseOk = c === _normKey(targetCourse);
        if (!courseOk) return false;
        if (targetTee) return t === _normKey(targetTee);
        return true;
      });

      if (!onCourse.length) continue;

      const ptsCourse = _mean(onCourse.map(getRoundPts));
      if (!Number.isFinite(ptsCourse)) continue;

      const other = series.filter(r => {
        const c = _normKey(getRoundCourse(r));
        if (!c) return false;
        const courseOk = c === _normKey(targetCourse);
        if (!courseOk) return true;
        if (!targetTee) return false;
        const t = _normKey(getRoundTee(r));
        return t !== _normKey(targetTee);
      });

      // baseline: prefer "other courses" if enough data, else fall back to all series
      const baselinePool = (other.length >= 3) ? other : series;
      const ptsBase = _mean(baselinePool.map(getRoundPts));
      if (!Number.isFinite(ptsBase)) continue;

      const delta = ptsCourse - ptsBase;
      const hi = _median(onCourse.map(getRoundHI));
      if (!Number.isFinite(hi)) continue;

      deltas.push({ name: p.name, hi, delta, n: onCourse.length });
    }

    if (!deltas.length) return { ok: false, reason: "no_data", targetCourse, targetTee };

    const bands = {
      low: deltas.filter(x => x.hi <= 7),
      mid: deltas.filter(x => x.hi >= 8 && x.hi <= 15),
      high: deltas.filter(x => x.hi >= 16),
    };

    const statOf = (arr) => ({
      players: arr.length,
      rounds: arr.reduce((a,b)=>a + (Number(b.n)||0), 0),
      avgDelta: _mean(arr.map(x => x.delta)),
    });

    const stats = {
      low: statOf(bands.low),
      mid: statOf(bands.mid),
      high: statOf(bands.high),
    };

    const ordered = Object.entries(stats).filter(([,v]) => Number.isFinite(v.avgDelta)).sort((a,b)=>b[1].avgDelta - a[1].avgDelta);
    if (!ordered.length) return { ok: false, reason: "no_valid", targetCourse, targetTee };

    const best = ordered[0];
    const worst = ordered[ordered.length - 1];
    const gap = Number(best[1].avgDelta) - Number(worst[1].avgDelta);

    let favours = "neutral";
    if (Number(best[1].avgDelta) >= 0.75 && gap >= 0.75) favours = best[0]; // low/mid/high

    const totalPlayers = deltas.length;
    const totalRounds = deltas.reduce((a,b)=>a + (Number(b.n)||0), 0);
    const confidence =
      (totalPlayers >= 8 && totalRounds >= 20) ? "high" :
      (totalPlayers >= 5 && totalRounds >= 10) ? "medium" : "low";

    return { ok: true, targetCourse, targetTee, favours, confidence, stats, totalPlayers, totalRounds };
  } catch (e) {
    return { ok: false, reason: "error" };
  }
}, [allPlayers, problemHolePack?.courseName, problemHolePack?.teeName]);
  const _proTrendLabel = (() => {
    if (!Number.isFinite(vel)) return "Not enough data";
    if (scoringMode === "gross") {
      // vel in gross mode is already inverted above (higher = better)
      if (vel > 0.05) return "Getting better";
      if (vel < -0.05) return "Getting worse";
      return "Flat";
    }
    if (vel > 0.05) return "Getting better";
    if (vel < -0.05) return "Getting worse";
    return "Flat";
  })();

  const _proConsistencyLabel = (() => {
    if (!Number.isFinite(vol) || !Number.isFinite(volField)) return "Not enough data";
    const better = vol < volField;
    return better ? "More consistent" : "Less consistent";
  })();

  const _fmtSignedNum = (x, d=1, invert=false) => {
    const v = Number(x);
    if (!Number.isFinite(v)) return "—";
    let w = invert ? -v : v;
    if (Math.abs(w) < 1e-6) w = 0; // avoid "-0"
    const s = (w > 0) ? "+" : "";
    return s + PR_fmt(w, d);
  };

  // Rank based on average score in the active window (Stableford: higher is better; Gross: lower is better)
  const _rankInWindow = (modeKey) => {
    const ps = (Array.isArray(allPlayers) ? allPlayers : []).filter(p => p && p.name && p.name !== cur?.name && !(typeof isTeamLike === "function" && isTeamLike(p.name)));
    const selfSeries = _windowSeriesPP;

    const selfVal = (modeKey === "gross")
      ? _meanFinite(selfSeries.map(r => _num(r?.gross, NaN)))
      : _meanFinite(selfSeries.map(r => _num(r?.pts, _num(r?.points, NaN))));

    const peerVals = ps.map(p => {
      const ws = (() => {
        const s = _seriesSortedPP(p);
        const isAll = String(seasonLimit || "").toLowerCase() === "all";
        const n = isAll ? 0 : Number(seasonLimit);
        return (n && n > 0) ? s.slice(-n) : s;
      })();
      const v = (modeKey === "gross")
        ? _meanFinite(ws.map(r => _num(r?.gross, NaN)))
        : _meanFinite(ws.map(r => _num(r?.pts, _num(r?.points, NaN))));
      return { name: p.name, v };
    }).filter(r => Number.isFinite(r.v));

    const all = [{ name: cur?.name || "You", v: selfVal }, ...peerVals].filter(r => Number.isFinite(r.v));

    const sortFn = (a,b) => (modeKey === "gross") ? (a.v - b.v) : (b.v - a.v);
    all.sort(sortFn);

    const pos = all.findIndex(r => String(r.name) === String(cur?.name || "You")) + 1;
    const total = all.length || 0;

    // Field avg (exclude self)
    const fieldAvg = peerVals.length ? (peerVals.reduce((s,r)=>s+r.v,0)/peerVals.length) : NaN;
    const delta = (Number.isFinite(selfVal) && Number.isFinite(fieldAvg))
      ? ((modeKey === "gross") ? (selfVal - fieldAvg) : (selfVal - fieldAvg))
      : NaN;

    return { pos: pos || NaN, total, selfVal, fieldAvg, delta };
  };

  const stableRank = React.useMemo(() => _rankInWindow("stableford"), [cur, allPlayers, seasonLimit, seasonYear]);
  const grossRank  = React.useMemo(() => _rankInWindow("gross"), [cur, allPlayers, seasonLimit, seasonYear]);

  // Handicap preview (No change / Den / WHS)
  const _tryGetParsSIPP = (r) => {
    // Reuse the broad parser from the shared WHS helper so PlayerProgressView matches PlayerReportView behaviour.
    return _tryGetParsSI(r);
  };

  const _whsDiffForRoundPP = (r) => {
    const gh = Array.isArray(r?.imputedGrossPerHole) ? r.imputedGrossPerHole.map(Number)
      : (Array.isArray(r?.grossPerHole) ? r.grossPerHole.map(Number)
      : null);
    if (!gh || !gh.length) return NaN;

    const { pArr, sArr } = _tryGetParsSIPP(r);
    if (!pArr || !sArr || pArr.length < 9 || sArr.length < 9) return NaN;

    const sl = Number(r?.slope || r?.slopeRating || r?.courseSlope || r?.teeSlope || 0);
    const cr = Number(r?.rating || r?.courseRating || r?.teeRating || 0);
    const parTotal = Number.isFinite(Number(r?.parTotal)) ? Number(r?.parTotal) : pArr.reduce((a,b)=>a+(Number(b)||0),0);
    const hi = Number(r?.startExact ?? r?.index ?? r?.handicapIndex ?? r?.hi ?? cur?.startExact ?? cur?.hcap ?? NaN);
    if (!Number.isFinite(sl) || sl <= 0 || !Number.isFinite(cr) || !Number.isFinite(parTotal) || parTotal<=0 || !Number.isFinite(hi)) return NaN;

    const teeLayout = { pars: pArr, si: sArr };
    const ags = WHS_adjustedGrossFromHoleScores(gh, teeLayout, hi, sl, cr);
    if (!Number.isFinite(ags)) return NaN;
    return WHS_scoreDifferential(ags, sl, cr, 0);
  };

  const _whsNextHIFromSeriesPP = (series) => {
    const s = Array.isArray(series) ? series.slice() : [];
    s.sort((a,b)=> (Number(a?.dateMs)||Number(a?.idx)||0) - (Number(b?.dateMs)||Number(b?.idx)||0));
    const diffs = s.map(_whsDiffForRoundPP).filter(Number.isFinite);
    if (diffs.length < 3) return NaN;
    return WHS_handicapIndexFromDiffs(diffs.slice(-20));
  };

  const whsNextHI_raw = React.useMemo(() => _whsNextHIFromSeriesPP(_windowSeriesPP), [_windowSeriesPP]);
  const whsNextHI = Number.isFinite(whsNextHI_raw) ? clamp(whsNextHI_raw, 0, 36) : whsNextHI_raw;

  const _latestRoundPP = React.useMemo(() => {
    const s = _windowSeriesPP.slice().sort((a,b)=> (Number(a?.dateMs)||Number(a?.idx)||0) - (Number(b?.dateMs)||Number(b?.idx)||0));
    return s.length ? s[s.length - 1] : null;
  }, [_windowSeriesPP]);

  const denIsWinner = React.useMemo(() => {
    if (typeof _latestRoundPP?.isWinner === "boolean") return _latestRoundPP.isWinner;
    try {
      const key = _latestRoundPP?.file || null;
      if (!key) return false;
      const contenders = [];
      for (const p of (Array.isArray(allPlayers) ? allPlayers : [])) {
        if (!p || !(p.name) || (typeof isTeamLike === "function" && isTeamLike(p.name))) continue;
        const s = _seriesSortedPP(p);
        const rr = s.find(x => x && x.file === key);
        if (!rr) continue;
        const pts = _num(rr?.pts, _num(rr?.points, NaN));
        const ph = Array.isArray(rr?.perHole) ? rr.perHole : [];
        if (!Number.isFinite(pts)) continue;
        contenders.push({ name: p.name, points: pts, perHole: ph });
      }
      if (!contenders.length) return false;
      contenders.sort((a,b) => (b.points - a.points) || compareByCountback(a,b));
      const topPts = contenders[0].points;
      const topGroup = contenders.filter(x => x.points === topPts);
      let best = topGroup.length ? [topGroup[0]] : [];
      for (let k = 1; k < topGroup.length; k++) {
        const cmp = compareByCountback(topGroup[k], best[0]);
        if (cmp > 0) best = [topGroup[k]];
        else if (cmp === 0) best.push(topGroup[k]);
      }
      const winnerSet = new Set(best.map(b => String(b.name||"").trim()));
      return winnerSet.has(String(cur?.name||"").trim());
    } catch {
      return false;
    }
  }, [_latestRoundPP, allPlayers, cur]);

  const denStartExact = _num(_latestRoundPP?.startExact, _num(cur?.startExact, _num(cur?.hcap, NaN)));
  const denPts = _num(_latestRoundPP?.pts, _num(_latestRoundPP?.points, NaN));
  const denGender = String(_latestRoundPP?.gender || cur?.gender || "M");
  const denNext = (Number.isFinite(denStartExact) && Number.isFinite(denPts))
    ? computeNewExactHandicap(denStartExact, denGender, denPts, _num(_latestRoundPP?.back9, 0), denIsWinner).nextExact
    : NaN;

      const hcapCard = _num(cur?.hcap, _num(cur?.startExact, _num(cur?.handicapExact, _num(cur?.handicapIndex, _num(cur?.index, _num(cur?.hi, _num(denStartExact, NaN)))))));

  const calcHcap = (reportNextHcapMode === "same")
    ? (Number.isFinite(hcapCard) ? hcapCard : NaN)
    : (reportNextHcapMode === "den")
      ? denNext
      : (reportNextHcapMode === "whs")
        ? whsNextHI
        : NaN;


  const _toneFromVsField = (delta, higherIsBetter, thresh) => {
    if (!Number.isFinite(delta)) return "text-neutral-500";
    const t = Number.isFinite(thresh) ? thresh : 0.10;
    if (Math.abs(delta) <= t) return "text-neutral-500";
    const better = higherIsBetter ? (delta > 0) : (delta < 0);
    return better ? "text-emerald-700" : "text-rose-700";
  };
  const _statusFromVsField = (delta, higherIsBetter, thresh) => {
    if (!Number.isFinite(delta)) return "";
    const t = Number.isFinite(thresh) ? thresh : 0.10;
    if (Math.abs(delta) <= t) return "avg vs field";
    const better = higherIsBetter ? (delta > 0) : (delta < 0);
    return better ? "good vs field" : "bad vs field";
  };
  const _sig = (x, d=1) => (Number.isFinite(x) ? ((x>=0?"+":"") + _fmt(x, d)) : "—");
  // sparkline of last 12 rounds
  const sparkPts = (() => {
    const tail = series.slice(-12);
    const vals = tail.map(s => scoringMode === "gross" ? (_num(s.gross, NaN) - _num(s.parTotal, NaN)) : _num(s.pts, NaN)).filter(Number.isFinite);
    if (!vals.length) return "";
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const den = (mx - mn) || 1;
    const pts = vals.map((v,i)=> {
      const x = (vals.length === 1) ? 100 : (i * (200/(vals.length-1)));
      const y = 34 - ((v - mn)/den) * 28;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return pts;
  })();

  // percentile vs cohort (simple)
  const percentile = React.useMemo(() => {
    const me = lastAvg;
    if (!Number.isFinite(me)) return NaN;
    const basePeers = (cohortMode === "field" ? allPlayers : cohort.players).filter(p => p && p.name !== cur.name);
    const peers = basePeers.map(p => {
      const s = __filterSeries(p?.series);
      const keys = _windowPP.map(r => r?.file).filter(Boolean);
      const vals = keys.map(key => {
        const match = s.find(x => x?.file === key);
        const v = scoringMode === "gross"
          ? (_num(match?.gross, NaN) - _num(match?.parTotal, NaN))
          : _num(match?.pts, NaN);
        return Number.isFinite(v) ? v : NaN;
      }).filter(Number.isFinite);
      const m = _mean(vals);
      return Number.isFinite(m) ? m : null;
    }).filter(v=>v!=null);
    if (!peers.length) return NaN;

    // For gross, lower is better; for stableford, higher is better.
    const betterCount = peers.filter(v => scoringMode === "gross" ? (me <= v) : (me >= v)).length;
    return betterCount / peers.length;
  }, [lastAvg, cohortMode, allPlayers, cohort.players, scoringMode]);

  const avgHcap = _mean(series.map(s=>_num(s.hcap, NaN)));

  // -------------------------
  // Build "impact rows" for Par / SI / Yardage (simple, fast, visual)
  // -------------------------
  const buildRows = (dim, meObj, fldObj, isGross, limit=8) => {
    const rows = [];
    // Derive how many rounds are represented so "impact /rd" is actually per-round, not over the whole sample.
    // Prefer the series length (sample rounds). Fallback: infer from total holes across this dimension (assume 18-hole rounds).
    const roundsCount = (() => {
      const n = Array.isArray(series) ? series.length : Number(series);
      if (Number.isFinite(n) && n > 0) return n;
      const totalH = Object.values(meObj || {}).reduce((a, r) => a + _num(r?.holes, 0), 0);
      if (totalH > 0) return totalH / 18;
      return 0;
    })();

    const keys = Object.keys(meObj || {});
    keys.forEach(k => {
      const meAgg = meObj?.[k];
      const fldAgg = fldObj?.[k];
      const holes = _num(meAgg?.holes,0);
      if (!holes) return;

      const mePH = isGross ? avgOverParPH(meAgg) : avgPtsPH(meAgg);
      const fldPH = isGross ? avgOverParPH(fldAgg) : avgPtsPH(fldAgg);
      const dGood = goodDelta(isGross ? "gross" : "stableford", mePH, fldPH); // per hole
      const safeRounds = (roundsCount > 0) ? roundsCount : 1;
      const holesPerRound = (safeRounds > 0) ? (holes / safeRounds) : 0;
      const impactRd = dGood * holesPerRound; // per-round contribution in this bucket
      rows.push({ key:k, label:`${dim} ${k}`, holes, mePH, fldPH, dGood, impactRd });
    });

    // Sort by absolute impact (biggest movers first), then keep top 'limit'
    rows.sort((a,b)=> Math.abs(b.impactRd) - Math.abs(a.impactRd));
    return rows;
  };

  const barsIsGross = ppBarsMode !== "pointsField";
  const barsCompare = (ppBarsMode === "strokesPar") ? "par" : "field"; // field | par

  const makeParBaseline = (meObj) => {
    const out = {};
    Object.keys(meObj || {}).forEach(k => {
      const h = _num(meObj?.[k]?.holes, 0);
      if (h) out[k] = { holes: h, val: 0 };
    });
    return out;
  };

  const parMeObj = barsIsGross ? (cur?.byParGross || {}) : (cur?.byPar || {});
  const parFdObj = (barsCompare === "par")
    ? makeParBaseline(parMeObj)
    : (barsIsGross ? (compField?.byParGross || {}) : (compField?.byPar || {}));
  const parRows = buildRows("Par", parMeObj, parFdObj, barsIsGross, 6);

  const siMeObj = barsIsGross ? (cur?.bySIGross || {}) : (cur?.bySI || {});
  const siFdObj = (barsCompare === "par")
    ? makeParBaseline(siMeObj)
    : (barsIsGross ? (compField?.bySIGross || {}) : (compField?.bySI || {}));
  const siRows  = buildRows("SI", siMeObj, siFdObj, barsIsGross, 6);

  const ydMeObj = barsIsGross ? (cur?.byYardsGross || {}) : (cur?.byYards || {});
  const ydFdObj = (barsCompare === "par")
    ? makeParBaseline(ydMeObj)
    : (barsIsGross ? (compField?.byYardsGross || {}) : (compField?.byYards || {}));
  const ydRows  = buildRows("Yds", ydMeObj, ydFdObj, barsIsGross, 8);

const allRows = [...parRows, ...siRows, ...ydRows].filter(r => Number.isFinite(r?.impactRd));
  const leaks = allRows.filter(r => Number.isFinite(r?.impactRd) && r.impactRd < 0).slice().sort((a,b)=>a.impactRd-b.impactRd).slice(0,3);
  const wins  = allRows.filter(r => Number.isFinite(r?.impactRd) && r.impactRd > 0).slice().sort((a,b)=>b.impactRd-a.impactRd).slice(0,3);

  // -------------------------
  // UI bits
  // -------------------------
  const StatPill = ({ label, val, sub, tone }) => (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="text-[10px] font-black tracking-widest uppercase text-neutral-400">{label}</div>
      <div className={"mt-2 text-3xl font-black tabular-nums " + (tone || "text-neutral-900")}>{val}</div>
      {sub && <div className="text-sm text-neutral-600 mt-1">{sub}</div>}
    </div>
  );

  const RowBar = ({ row }) => {
    const d = Number(row?.dGood);
    const impact = Number(row?.impactRd);
    const good = Number.isFinite(d) && d > 0;
    const bad = Number.isFinite(d) && d < 0;
    const tone = good ? "text-emerald-700" : (bad ? "text-rose-700" : "text-neutral-700");
    const barFrac = Math.max(-1, Math.min(1, Number.isFinite(impact) ? impact/2.5 : 0)); // soft scale
    const barL = barFrac >= 0 ? 50 : 50 + barFrac*50;
    const barW = Math.abs(barFrac)*50;

    const [anim, setAnim] = React.useState(false);
    React.useEffect(() => {
      const t = setTimeout(() => setAnim(true), 20);
      return () => clearTimeout(t);
    }, []);
    const barL2 = anim ? barL : 50;
    const barW2 = anim ? barW : 0;

    return (
      <div className="flex items-center gap-3 py-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate font-extrabold text-neutral-900">{row.label}</div>
            <div className={`text-xs font-black tabular-nums ${tone}`}>
              {Number.isFinite(impact) ? ((impact>=0?"+":"") + _fmt(impact, 2)) : "—"}
              <span className="text-neutral-400 font-semibold"> /rd</span>
            </div>
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            {row.holes} holes · {ppBarsMode==="pointsField" ? `${_fmt(row.mePH,2)} vs ${_fmt(row.fldPH,2)} pts/hole` : (ppBarsMode==="strokesPar" ? `${_fmt(row.mePH,2)} over/par (vs par)` : `${_fmt(row.mePH,2)} vs ${_fmt(row.fldPH,2)} over/par`)}
          </div>

          <div className="mt-2 flex-1 relative h-8 bg-neutral-100 rounded-lg overflow-hidden shadow-inner border border-neutral-200/50">
            {/* Center Marker */}
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-neutral-300 z-10 opacity-50" />
            {/* Value Bar */}
            <div
              className={"bar-anim absolute top-0 bottom-0 transition-all duration-500 ease-out " + (
                good ? "bg-gradient-to-r from-emerald-400 to-emerald-500" :
                (bad ? "bg-gradient-to-l from-rose-400 to-rose-500" : "bg-neutral-300")
              )}
              style={{ left: `${barL2}%`, width: `${barW2}%` }}
            />
          </div>
        </div>
      </div>
    );
  };

  // V2: Impact Waterfall (visual storyline)
  const ImpactWaterfall = ({ rows, title="Impact Waterfall" }) => {
    const rs = Array.isArray(rows) ? rows.filter(r => Number.isFinite(Number(r?.impactRd))) : [];
    const movers = rs.slice().sort((a,b)=>Math.abs(b.impactRd)-Math.abs(a.impactRd)).slice(0, 8);
    const steps = [{ label: "Baseline", v: 0 }];
    movers.forEach(r => steps.push({ label: r.label, v: Number(r.impactRd) }));
    steps.push({ label: "Now", v: 0 });

    // Build cumulative, but be honest: these buckets overlap across lenses
    let cum = 0;
    const pts = steps.map((s, i) => {
      if (i === 0) return { ...s, start: 0, end: 0, cum: 0, kind: "base" };
      if (i === steps.length - 1) return { ...s, start: 0, end: cum, cum, kind: "end" };
      const start = cum;
      cum += s.v;
      return { ...s, start, end: cum, cum, kind: "step" };
    });

    const maxAbs = Math.max(1, ...pts.map(p => Math.max(Math.abs(p.start), Math.abs(p.end))));
    const W = 720, H = 140;
    const padX = 36, padY = 18;
    const innerW = W - padX*2;
    const innerH = H - padY*2;
    const n = pts.length;
    const dx = innerW / Math.max(1, n-1);
    const y0 = padY + innerH/2;
    const y = (v) => y0 - (v/maxAbs) * (innerH/2);

    return (
      <div className="rounded-2xl border border-neutral-200 bg-gradient-to-b from-white to-neutral-50 p-4" data-reveal>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-black tracking-widest uppercase text-neutral-400">{title}</div>
            <div className="text-sm text-neutral-600 mt-1">
              A quick visual of your biggest movers. Buckets overlap across lenses, so treat this as a <span className="font-semibold">story of momentum</span>, not an exact add‑up.
            </div>
          </div>
          <span className="chip border-neutral-200 bg-white text-neutral-700">Top {movers.length} movers</span>
        </div>

        <div className="mt-3 overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[680px]">
            <line x1={padX} y1={y0} x2={W-padX} y2={y0} stroke="rgba(0,0,0,0.15)" strokeWidth="1"/>
            {pts.map((p, i) => {
              const x = padX + i*dx;
              const yStart = y(p.start);
              const yEnd = y(p.end);
              const up = p.end >= p.start;
              const h = Math.abs(yEnd - yStart);
              const barW = 18;
              const yTop = up ? yEnd : yStart;
              const fill = (p.kind==="base" || p.kind==="end") ? "rgba(59,130,246,0.35)" : (p.v >= 0 ? "rgba(16,185,129,0.55)" : "rgba(244,63,94,0.55)");
              return (
                <g key={i}>
                  {i>0 && (
                    <line x1={padX+(i-1)*dx} y1={y(pts[i-1].end)} x2={x} y2={yStart} stroke="rgba(0,0,0,0.25)" strokeWidth="1.25"/>
                  )}
                  <rect x={x - barW/2} y={yTop} width={barW} height={Math.max(2, h)} rx="4" fill={fill}/>
                  <circle cx={x} cy={yEnd} r="2.5" fill="rgba(0,0,0,0.35)"/>
                  <text x={x} y={H-6} textAnchor="middle" fontSize="10" fill="rgba(0,0,0,0.65)">
                    {p.label.length>12 ? (p.label.slice(0,11)+"...") : p.label}
                  </text>
                </g>
              );
            })}
            <text x={W-padX} y={14} textAnchor="end" fontSize="11" fill="rgba(0,0,0,0.55)">
              Overall trend: {pts.length ? ((pts[pts.length-1].end>=0?"+":"") + _fmt(pts[pts.length-1].end, 2) + " /rd") : "—"}
            </text>
          </svg>
        </div>
      </div>
    );
  };

  // V2: Bottom-sheet charts overlay (modern, feels like an app)
  const ChartsSheet = ({ open, onClose, scoringMode, rawPar, rawSI, rawYd, roundCount }) => {
    const [metric, setMetric] = React.useState("round");
    React.useEffect(() => { if (open) setMetric("round"); }, [open]);
    React.useEffect(() => {
      if (!open) return;
      const onKey = (e) => { if (e && e.key === "Escape") onClose && onClose(); };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);
    if (!open) return null;

    return (
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm sheet-backdrop" onClick={onClose} />
        <div className="absolute inset-x-0 bottom-0 max-h-[92vh] rounded-t-3xl bg-white border border-neutral-200 shadow-2xl overflow-hidden sheet-panel">
          <div className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-neutral-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Deep Dive</div>
                <div className="text-xl font-black text-neutral-900">Buckets that move your score</div>
                <div className="text-xs text-neutral-600 mt-1">Tap outside to close · Esc works too</div>
              </div>
              <button className="chip border-neutral-200 bg-white text-neutral-700 hover:opacity-90" onClick={onClose}>Close</button>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[11px] text-neutral-500">
                {roundCount ? `${roundCount} round${roundCount===1?"":"s"} in sample` : "Sample size varies"}
              </div>
            </div>
          </div>

          <div className="p-4 overflow-y-auto space-y-4">
            <DeltaBucketChart title="By Par Type (Vs Comparator)" rows={rawPar} scoringMode={scoringMode} comparisonMode="field" deepDiveMetric={metric} roundCount={roundCount} />
            <DeltaBucketChart title="By Difficulty (Vs Comparator)" rows={rawSI} scoringMode={scoringMode} comparisonMode="field" deepDiveMetric={metric} roundCount={roundCount} />
            <DeltaBucketChart title="By Yardage (Vs Comparator)" rows={rawYd} scoringMode={scoringMode} comparisonMode="field" deepDiveMetric={metric} roundCount={roundCount} />
          </div>
        </div>
      </div>
    );
  };

  const edgeSuggestion = (row) => {
    const lbl = String(row?.label || "").toLowerCase();
    const isGross = scoringMode === "gross";
    // Keep it short and actionable (range-safe if bucket naming differs)
    if (lbl.includes("par 3")) return isGross ? "Hit more greens: pick the fattest target, club up, and accept 20–30ft putts." : "Par 3 plan: center-green targets + 2-putt discipline. Track GIR and 3-putts.";
    if (lbl.includes("par 4")) return "Par 4s: prioritise tee shot position. If you're blocked, take the punch-out and save bogey.";
    if (lbl.includes("par 5")) return "Par 5s: pick a ‘wedge number’ layup. Only go for it when the miss is safe.";
    if (lbl.includes("si 1") || lbl.includes("si 1–") || lbl.includes("si 1-")) return "Hard holes: bogey is a win. Aim for fat-side greens, avoid short‑siding, and take your medicine.";
    if (lbl.includes("si 13") || lbl.includes("si 13–") || lbl.includes("si 13-")) return "Easier holes: turn wedges into birdie looks. 10-min ‘must get up-and-down’ pressure reps.";
    if (lbl.includes("351") || lbl.includes("420") || lbl.includes("300-350")) return "Long approach buckets: stop chasing pins. Green‑middle, avoid the ‘hero’ 5‑iron.";
    if (lbl.includes("<150") || lbl.includes("150")) return "Short game bucket: dial wedge distances (3 swings) + 20 chips to a landing spot.";
    return "Pick one simple constraint: (1) aim middle, (2) avoid doubles, (3) finish every practice with 10 pressure reps.";
  };

const confidenceFor = (row) => {
  const h = _num(row?.holes, 0);
  if (h >= 80) return { label: "High", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  if (h >= 40) return { label: "Medium", cls: "border-amber-200 bg-amber-50 text-amber-900" };
  return { label: "Low", cls: "border-neutral-200 bg-neutral-50 text-neutral-700" };
};

const coachLine = (row) => {
  if (!row) return "Play a few more rounds to get a reliable signal.";
  // short, punchy one-liner
  const t = String(row.label || "");
  if (t.startsWith("Par")) return "Par buckets: build a simple game-plan and eliminate the big numbers.";
  if (t.startsWith("SI"))  return "Stroke index buckets: respect the hard holes and cash in on the easy ones.";
  if (t.startsWith("Yds")) return "Distance buckets: dial one stock shot per band and commit to it.";
  return "Keep it simple: one clear target + one clear swing thought.";
};

  const allEdgeRows = (allRows || []).slice().sort((a,b)=>Math.abs(b.impactRd)-Math.abs(a.impactRd));
  const worstRow = (allRows || []).slice().sort((a,b)=>a.impactRd-b.impactRd)[0] || null;

  // -------------------------
  // Empty state / loading
  // -------------------------
  if (seasonLoading) {
    const done = seasonProgress?.done || 0;
    const total = seasonProgress?.total || 0;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return (
      <section className="glass-card pm-scope p-4 md:p-6">
      <div className="pm-accent-rail" aria-hidden="true"></div>
        <div className="flex items-center justify-between gap-3">
          <Breadcrumbs items={[{ label: "How Well Am I Playing" }]} />
          
        </div>

        <div className="mt-4 rounded-3xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-black text-amber-900">Loading Previous Games...</div>
              <div className="text-sm text-amber-900/80 mt-1">
                We’re loading your previous games and building same-course / same-tee comparisons to spot patterns.
                This can take a moment — especially the first time.
              </div>
            </div>
            <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900 tabular-nums">
              {pct}%
            </span>
          </div>

          <div className="mt-3 h-2 w-full rounded-full bg-amber-100 overflow-hidden">
            <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
          </div>

          <div className="mt-2 text-xs text-amber-900/80 tabular-nums">
            Progress: {done}/{total}
          </div>
        </div>
      </section>
    );
  }

  if (seasonError) {
    return (
      <section className="glass-card p-4 md:p-6 hm-stage">
        <div className="flex items-center justify-between gap-3">
          <Breadcrumbs items={[{ label: "Overview" }]} />
        
      <ImproveTopNav active="progress" setView={setView} />
        </div>
<div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{seasonError}</div>
        <button className="btn-primary mt-3" onClick={runSeasonAnalysis}>Try again</button>
      </section>
    );
  }

  // If we haven't built the model at all, offer to run analysis.
  if (!seasonModel) {
    return (
      <section className="glass-card p-4 md:p-6">
        <div className="flex items-center justify-between gap-3">
          <Breadcrumbs items={[{ label: "Overview" }]} />
          <ImproveTopNav active="progress" setView={setView} />
        </div>
        <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="font-black text-neutral-900">Season analysis</div>
          <div className="text-sm text-neutral-600 mt-1">Load all season CSVs and we’ll build a proper player breakdown.</div>
          <button className="btn-primary mt-3" onClick={runSeasonAnalysis}>Run season analysis</button>
        </div>
      </section>
    );
  }

  // Model exists, but the current filters (e.g. Year) produce zero games.
  // Don't bounce the user back to "Run season analysis" — show a friendly empty state.
  if (!allPlayers.length) {
    const yr = (seasonYear && String(seasonYear).toLowerCase() !== "all") ? String(seasonYear) : "this selection";
    return (
      <section className="glass-card p-4 md:p-6">
        <div className="flex items-center justify-between gap-3">
          <Breadcrumbs items={[{ label: "Overview" }]} />
          <ImproveTopNav active="progress" setView={setView} />
        </div>
        <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="font-black text-neutral-900">No games yet</div>
          <div className="text-sm text-neutral-600 mt-1">
            There aren’t any games loaded for {yr}. Your League/Eclectic can still show standings (if you’ve added events),
            but Performance analysis needs at least one round.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => setSeasonYear && setSeasonYear("All")}>Show all years</button>
            <button className="btn-secondary" onClick={() => setView("home")}>Back to Home</button>
            <button className="btn-primary" onClick={runSeasonAnalysis}>Re-scan season files</button>
          </div>
        </div>
      </section>
    );
  }

  if (!cur) return <div className="p-6 text-sm text-neutral-500">Select a player.</div>;

  return (
    <section className="glass-card p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
          <Breadcrumbs items={[{ label: "Overview" }]} />
          <ImproveTopNav active="progress" setView={setView} />
        </div>
          <SeasonSelectionBar
            seasonModel={seasonModel}
            seasonPlayer={seasonPlayer}
            setSeasonPlayer={setSeasonPlayer}
            seasonYear={seasonYear}
            setSeasonYear={setSeasonYear}
            seasonLimit={seasonLimit}
            setSeasonLimit={setSeasonLimit}
            seasonYears={seasonYears}
            scoringMode={scoringMode}
            setScoringMode={setScoringMode}
          />

      {/* Top controls */}
      <div className="mt-4 hm-stage">
        <div className="glass-card p-4 md:p-6">
        <div className="flex flex-col gap-4">
          {/* Player identity */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
                <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Performance Mirror</div>
                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto justify-start sm:justify-end">    <button className="btn-primary" onClick={() => {
            try{
              const model = seasonModel;
              const lens = (localStorage.getItem("dsl_lens") || "pointsField");
              // Comparator for the Season Report is controlled inside the report overlay (Field vs Handicap band).
              // Default to handicap band unless a prior report run stored a preference.
              const uiCohort = (window.__dslUiState && window.__dslUiState.cohortMode) ? window.__dslUiState.cohortMode : null;
// Default comparator: follow the Overview "Score vs Field" comparator if available, else remember last report choice, else band.
const comparator = uiCohort ? (uiCohort === "field" ? "field" : "band")
  : ((window.__dslSeasonReportParams && window.__dslSeasonReportParams.comparatorMode)
      ? window.__dslSeasonReportParams.comparatorMode
      : "band");
              window.__dslSeasonReportParams = { model: seasonModel, playerName: seasonPlayer, yearLabel: seasonYear, seasonLimit: seasonLimit, scoringMode, lensMode: lens, comparatorMode: comparator };
              const r = PR_generateSeasonReportHTML({
                model: seasonModel,
                playerName: seasonPlayer,
                yearLabel: seasonYear,
                seasonLimit: seasonLimit,
                scoringMode,
                lensMode: lens,
                comparatorMode: comparator
              });
              if (!r || !r.ok) { alert(r?.error || "Could not generate report."); return; }
              PR_showInlineSeasonReport(r.htmlFragment || r.html);
              }catch(e){
              console.error(e);
              alert("Could not generate report.");
            }
          }} title="Open the season report">Generate Report</button>    <button className="btn-secondary" onClick={() => {      try {        const det = document.getElementById("pp-problem-holes-details");        if (det) det.open = true;        const el = document.getElementById("pp-problem-holes");        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });      } catch(e) {}    }} title="Jump to problem holes">Problem Holes</button>  </div></div>
            <div className="mt-1 break-words leading-tight">
              <span className="text-4xl md:text-5xl font-black tracking-tight text-neutral-900">{firstName}</span>
              {restName ? (<span className="ml-2 text-2xl md:text-3xl font-black tracking-tight text-neutral-800">{restName}</span>) : null}
            </div>
            <div className="mt-1 text-sm text-neutral-600">
              Comparator:{" "}
              <span className="font-extrabold text-neutral-900">
                {cohortMode === "band" ? "Handicap band" : "Field"}
              </span>
              <span className="mx-2 text-neutral-300">·</span>
              Mode:{" "}
              <span className="font-extrabold text-neutral-900">
                {scoringMode === "gross" ? "Gross" : "Stableford"}
              </span>
            </div>
          </div>

          
          {/* Problem Holes (anchor section) */}
          <div id="pp-problem-holes" className="w-full">
            <details id="pp-problem-holes-details" className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
              <summary className="cursor-pointer select-none">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Problem holes</div>
                    <div className="mt-1 text-lg md:text-xl font-black text-neutral-900">
                      Where you leak points on the same setup
                    </div>
                    <div className="mt-1 text-sm text-neutral-600">
                      Uses your most-played Course + Tee within the current window.
                    </div>
                  </div>
                  <div className="text-xs font-black text-neutral-500 mt-1">▼</div>
                </div>
              </summary>

              <div className="mt-4">
                { (problemHolePack && problemHolePack.ok) ? (
                  <>
                    <div className="text-sm text-neutral-700">
                      Using: <span className="font-black text-neutral-900">{problemHolePack.courseName || "—"}</span>
                      {problemHolePack.teeName ? (<span className="text-neutral-600"> · {problemHolePack.teeName}</span>) : null}
                      <span className="text-neutral-500"> · {problemHolePack.rounds || 0} rounds</span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {((problemHolePack.flagged && problemHolePack.flagged.length) ? problemHolePack.flagged : (problemHolePack.rows || [])).slice(0, 6).map((r) => (
                        <span
                          key={"phchip"+r.hole}
                          className={"inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black " + ((Number(r.vsOverall) <= -0.5) ? "border-rose-200 bg-rose-50 text-rose-700" : "border-neutral-200 bg-neutral-50 text-neutral-700")}
                        >
                          Hole {r.hole}: {_fmt(r.avg, 2)} pts
                        </span>
                      ))}
                    </div>

                    <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-200">
                      <table className="w-full text-sm">
                        <thead className="bg-neutral-50">
                          <tr className="text-left">
                            <th className="px-4 py-3 font-black text-neutral-600">HOLE</th>
                            <th className="px-4 py-3 font-black text-neutral-600">AVG PTS</th>
                            <th className="px-4 py-3 font-black text-neutral-600">VS YOUR OVERALL</th>
                            <th className="px-4 py-3 font-black text-neutral-600">SAMPLES</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(problemHolePack.rows || []).slice(0, 10).map((r) => (
                            <tr key={"phr"+r.hole} className="border-t border-neutral-200">
                              <td className="px-4 py-3 font-black text-neutral-900">{r.hole}</td>
                              <td className="px-4 py-3 text-neutral-900">{_fmt(r.avg, 2)}</td>
                              <td className={"px-4 py-3 font-black " + ((Number(r.vsOverall) <= -0.5) ? "text-rose-700" : "text-neutral-700")}>
                                {Number.isFinite(Number(r.vsOverall)) ? ((r.vsOverall>=0?"+":"") + _fmt(r.vsOverall, 2)) : "—"}
                              </td>
                              <td className="px-4 py-3 text-neutral-700">{r.n || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-neutral-700">
                    Not enough repeated rounds on the same Course + Tee in the current window to identify problem holes.
                  </div>
                )}
              </div>
            </details>
          </div>


          {/* Filters (stacked) */}
          <div className="w-full">
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500 mb-1">PLAYER</div>
                  <div className="select-wrap">
                    <select
                      className="select-premium"
                      value={seasonPlayer}
                      onChange={(e) => setSeasonPlayer(e.target.value)}
                    >
                      {(allPlayers || []).map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <svg className="select-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500 mb-1">YEAR</div>
                  <div className="select-wrap">
                    <select
                      className="select-premium"
                      value={seasonYear}
                      onChange={(e) => setSeasonYear(e.target.value)}
                    >
                      <option value="All">All</option>
                      {(["All"].concat(seasonYears || [])).map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                    <svg className="select-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500 mb-1">MOST RECENT GAMES</div>
                  <div className="select-wrap">
                    <select
                      className="select-premium"
                      value={seasonLimit}
                      onChange={(e) => setSeasonLimit(e.target.value)}
                    >
                      <option value="All">All</option>
                      {["1", "5", "10", "15", "20", "30"].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <svg className="select-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500 mb-1">VIEW MODE</div>
                  <div className="select-wrap">
                    <span className="select-dot" style={lensDotStyle} aria-hidden="true"></span>
                    <select
                      className="select-premium"
                      style={{ paddingLeft: "2.25rem" }}
                      value={lensKey}
                      onChange={(e) => {
                        const v = e.target.value;
                        const opt = LENS_OPTIONS.find(o => o.key === v) || LENS_OPTIONS[0];
                        setPpBarsMode(opt.pp);
                        setCohortMode(opt.cohort);
                      }}
                      aria-label="Leaderboard view mode"
                    >
                      {LENS_OPTIONS.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <svg className="select-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">{lensSelected?.hint || ""}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div className="flex flex-wrap items-center gap-2">
</div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {/* Lens (single source of truth) */}
            

            
            {/* (Lens buttons replaced by the VIEW MODE dropdown next to Most Recent Games) */}


            <div className="mode-context-row">
              <div className="mode-context-text">
                {(ppBarsMode === "pointsField" && cohortMode === "field") ? (
                  <>Stableford points compared to the field average. <b>Higher is better.</b></>
                ) : (ppBarsMode === "pointsField" && cohortMode === "band") ? (
                  <>Stableford points compared to golfers in the same handicap band. <b>Higher is better.</b></>
                ) : (ppBarsMode === "strokesField" && cohortMode === "field") ? (
                  <>Gross score compared to the field average. <b>Lower is better.</b></>
                ) : (ppBarsMode === "strokesField" && cohortMode === "band") ? (
                  <>Gross score compared to golfers in the same handicap band. <b>Lower is better.</b></>
                ) : (
                  <>Gross score relative to par (absolute). <b>Lower is better.</b></>
                )}
              </div>

              <div className="text-xs font-semibold text-neutral-400 px-2">
                {ppBarsMode === "strokesPar" ? (
                  <>Comparator: Par</>
                ) : (
                  <>Comparator: {cohortMode === "band" ? "Handicap band" : "Field"}</>
                )}
              </div>
            </div>
</div>

        </div>
        </div>

        {/* PRO OVERVIEW */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4 pro-overview-grid pro-overview-stage">
          <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm lg:col-span-1 report-handicap-preview">
            <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Report handicap preview</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="toggle-group" role="tablist" aria-label="Handicap preview mode">
                <button className={"toggle-btn " + (reportNextHcapMode==="den" ? "active" : "")} onClick={() => setReportNextHcapMode("den")} role="tab" aria-selected={reportNextHcapMode==="den"}>Legacy</button>
                <button className={"toggle-btn " + (reportNextHcapMode==="whs" ? "active" : "")} onClick={() => setReportNextHcapMode("whs")} role="tab" aria-selected={reportNextHcapMode==="whs"}>WHS</button>
                <button className={"toggle-btn " + (reportNextHcapMode==="same" ? "active" : "")} onClick={() => setReportNextHcapMode("same")} role="tab" aria-selected={reportNextHcapMode==="same"}>No change</button>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-3xl font-black text-neutral-900 tabular-nums">{Number.isFinite(calcHcap) ? PR_fmt(calcHcap,1) : "—"}</div>
              <div className="text-sm text-neutral-600 mt-1">
                Calculated Hcap <span className="text-neutral-400">vs</span> Card {Number.isFinite(hcapCard) ? PR_fmt(hcapCard,1) : "—"}
              </div>
              <div className="text-xs text-neutral-500 mt-1">
                Avg handicap <span className="font-semibold text-neutral-700">{Number.isFinite(avgHcap) ? PR_fmt(avgHcap,1) : "—"}</span>
              </div>
              <details className="mt-3 rounded-2xl border border-neutral-200 bg-neutral-50/60 px-3 py-2">
  <summary className="no-marker flex cursor-pointer select-none items-center gap-2 text-xs font-semibold text-neutral-700" aria-label="How to read this" title="How to read this">
    <span aria-hidden="true" className="text-base">💡</span>
    <span className="sr-only">How to read this</span>
</summary>

  <div className="mt-2 text-xs text-neutral-500 space-y-2">

  <div>
    <span className="font-semibold text-neutral-700">What this is showing:</span>{" "}
    a preview of the handicap number this report would use{" "}
    <span className="font-semibold text-neutral-700">if you updated it from the rounds you selected</span>.
    It&apos;s an explanation layer only — all scoring and Insights maths stay exactly the same.
  </div>

  {reportNextHcapMode === "den" && (
    <div>
      <span className="font-semibold text-neutral-700">League handicap</span>{" "}
      is a society system designed so more members have a fair shot at winning.
      This preview uses your <span className="font-semibold text-neutral-700">latest selected round</span>{" "}
      and your <span className="font-semibold text-neutral-700">Stableford points</span>:
      score <span className="font-semibold text-neutral-700">35+ points</span> and your handicap tightens;
      score <span className="font-semibold text-neutral-700">31 or fewer</span> and it loosens.
      The size of the change depends on your current handicap band, and winners get an extra small cut.
      The result is kept within sensible bounds (and capped for playing handicap: 28 for men, 36 for women).
    </div>
  )}

  {reportNextHcapMode === "whs" && (
    <div>
      <span className="font-semibold text-neutral-700">WHS handicap index</span>{" "}
      is the standard system based on <span className="font-semibold text-neutral-700">score differentials</span>.
      In this file, each selected round is turned into a differential by:
      (1) taking your hole-by-hole gross scores,
      (2) applying the WHS per-hole cap (net double bogey) to get an adjusted gross score,
      then (3) converting that to a differential using{" "}
      <span className="font-semibold text-neutral-700">(Adjusted Gross − Course Rating) × 113 ÷ Slope</span>{" "}
      (PCC assumed 0 here).
      Your next WHS index is then the average of the lowest differentials from your most recent up to 20 rounds
      (with the standard “fewer than 20 scores” rules), rounded to 1 decimal.
      This needs slope/rating + pars/SI + hole scores to be present.
    </div>
  )}

  {reportNextHcapMode === "same" && (
    <div>
      <span className="font-semibold text-neutral-700">No change</span>{" "}
      means: use the handicap already on the player record / card, with no recalculation from the selected rounds.
    </div>
  )}

  <div>
    <span className="font-semibold text-neutral-700">Card</span>{" "}
    is the handicap number recorded for the round (the one used to compute your points on the day).
    <span className="font-semibold text-neutral-700"> Avg handicap</span>{" "}
    is simply the average of the handicap values across the rounds you&apos;ve selected.
  
  </div>
  </div>
</details>
            </div>
          </div>

          <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <div className="text-xs font-black tracking-widest uppercase text-neutral-500">Rounds analysed</div>
                <div className="mt-2 text-2xl font-black text-neutral-900 tabular-nums">{games || 0}</div>
                <div className="mt-2 text-sm text-neutral-600">Avg Points / Avg Strokes</div>
                <div className="text-lg font-extrabold text-neutral-900 tabular-nums">
                  {Number.isFinite(_avgPts) ? `${PR_fmt(_avgPts,1)} pts` : "—"} <span className="text-neutral-300">/</span> {Number.isFinite(_avgGross) ? `${PR_fmt(_avgGross,1)} str` : "—"}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <div className="text-xs font-black tracking-widest uppercase text-neutral-500">Performance & Rank</div>
                <div className="mt-2">
                  <div className="text-sm text-neutral-600">Stableford Rank</div>
                  <div className="text-lg font-extrabold text-neutral-900 tabular-nums">
                    {Number.isFinite(stableRank?.pos) && stableRank?.total ? `${stableRank.pos} of ${stableRank.total}` : "—"}
                    <span className={"ml-2 " + _toneFromVsField(stableRank?.delta, true, 0.2)}>
                      ({_fmtSignedNum(stableRank?.delta,1)} pts vs field)
                    </span>
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">Percentile ({String(seasonLimit||"").toLowerCase()==="all" ? "all selected rounds" : `last ${seasonLimit} rounds`} avg): {Number.isFinite(percentile) ? _pct(percentile,0) : "—"}</div>
                </div>
                <div className="mt-2">
                  <div className="text-sm text-neutral-600">Gross Rank</div>
                  <div className="text-lg font-extrabold text-neutral-900 tabular-nums">
                    {Number.isFinite(grossRank?.pos) && grossRank?.total ? `${grossRank.pos} of ${grossRank.total}` : "—"}
                    <span className={"ml-2 " + _toneFromVsField(grossRank?.delta, false, 0.5)}>
                      ({_fmtSignedNum(grossRank?.delta,1,true)} str vs field)
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <div className="text-xs font-black tracking-widest uppercase text-neutral-500">What’s happening</div>
                <div className="mt-2 text-sm text-neutral-600">Improving or worse?</div>
                <div className={"text-lg font-extrabold " + ( _proTrendLabel==="Getting better" ? "text-emerald-700" : _proTrendLabel==="Getting worse" ? "text-rose-700" : "text-neutral-900")}>
                  {_proTrendLabel}
                </div>

                <div className="mt-3 text-sm text-neutral-600">Consistency</div>
                <div className="text-lg font-extrabold text-neutral-900">
                  {_proConsistencyLabel} <span className="text-sm font-bold text-neutral-500"> (σ {Number.isFinite(vol) ? PR_fmt(vol,1) : "—"} vs {Number.isFinite(volField) ? PR_fmt(volField,1) : "—"})</span>
                </div>

                <div className="mt-3 text-sm text-neutral-600">Better early or late</div>
                <div className="text-sm font-extrabold text-neutral-900">{_frontBackLine}</div>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <div className="text-xs font-black tracking-widest uppercase text-neutral-500">Start & Finish</div>

                <div className="mt-2 text-sm text-neutral-600">
                  Fast starter (holes 1–3{_first3NHoles ? `, n=${_first3NHoles} holes` : ""})
                </div>
                <div className="text-lg font-extrabold text-neutral-900 tabular-nums">
                  {_fastStart ? (_fastStart.is ? "Yes" : "No") : "—"}
                  <span className="ml-2 text-sm font-bold text-neutral-500">
                    ({_fastStart ? PR_fmt(_fastStart.pph,2) : "—"} pts/h, {_fastStart ? _fmtSignedNum(_fastStart.delta,2) : "—"} vs avg {Number.isFinite(_overallPPH) ? PR_fmt(_overallPPH,2) : "—"})
                  </span>
                </div>

                <div className="mt-3 text-sm text-neutral-600">
                  Clutch finisher (holes 16–18{_last3NHoles ? `, n=${_last3NHoles} holes` : ""})
                </div>
                <div className="text-lg font-extrabold text-neutral-900 tabular-nums">
                  {_clutchFinish ? (_clutchFinish.is ? "Yes" : "No") : "—"}
                  <span className="ml-2 text-sm font-bold text-neutral-500">
                    ({_clutchFinish ? PR_fmt(_clutchFinish.pph,2) : "—"} pts/h, {_clutchFinish ? _fmtSignedNum(_clutchFinish.delta,2) : "—"} vs avg {Number.isFinite(_overallPPH) ? PR_fmt(_overallPPH,2) : "—"})
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-black tracking-widest uppercase text-neutral-500">After a bad hole</div>
                  <div className="text-[11px] font-black text-neutral-500">{_afterBadHole ? _afterBadHole.label : "—"}</div>
                </div>

                <div className="mt-2 text-sm text-neutral-600">When you make a double bogey or worse, what happens next?</div>

                <div className="mt-2 text-lg font-extrabold text-neutral-900 tabular-nums">
                  Resilience score (next hole vs your average)
                </div>

                <div className="mt-1 text-lg font-extrabold text-neutral-900 tabular-nums">
                  {(_afterBadHole && Number.isFinite(_afterBadHole.resiliencePts)) ? (
                    <>
                      {_fmtSignedNum(_afterBadHole.resiliencePts, 2)} pts
                      <span className="text-neutral-300"> / </span>
                      {(_afterBadHole && Number.isFinite(_afterBadHole.resilienceStr))
                        ? `${_fmtSignedNum(_afterBadHole.resilienceStr, 2, true)} str`
                        : "—"}
                    </>
                  ) : (_afterBadHole && Number.isFinite(_afterBadHole.resilienceStr)) ? (
                    <>
                      — <span className="text-neutral-300">/</span> {_fmtSignedNum(_afterBadHole.resilienceStr, 2, true)} str
                    </>
                  ) : (
                    "—"
                  )}
                </div>

                <div className="mt-2 text-sm font-extrabold text-neutral-900">
                  {_afterBadHole ? _afterBadHole.summary : "Not enough data."}
                </div>

                <div className="mt-1 text-[11px] text-neutral-500">
                  {_afterBadHole ? `Based on ${Math.max(_afterBadHole.triggers||0, _afterBadHole.nPts||0, _afterBadHole.nStr||0)} follow-ups after double+ holes.` : ""}
                </div>
              </div>



<div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
  <div className="text-xs font-black tracking-widest uppercase text-neutral-500">Course fit</div>
  <div className="mt-2 text-sm text-neutral-600">
    {(_courseFit && _courseFit.ok) ? (
      <>
        Using: <span className="font-black text-neutral-900">{_courseFit.targetCourse}</span>
        {_courseFit.targetTee ? (<span className="text-neutral-600"> · {_courseFit.targetTee}</span>) : null}
        <span className="text-neutral-500"> · {_courseFit.totalRounds} rounds</span>
      </>
    ) : (
      <>Not enough data</>
    )}
  </div>

  <div className="mt-2 text-lg font-extrabold text-neutral-900">
    {(_courseFit && _courseFit.ok) ? (
      <>
        Favours:{" "}
        <span className="tabular-nums">
          {_courseFit.favours === "low" ? "Low handicappers"
            : _courseFit.favours === "mid" ? "Mid handicappers"
            : _courseFit.favours === "high" ? "High handicappers"
            : "Neutral"}
        </span>
        <span className="ml-2 text-xs font-bold text-neutral-500">
          ({String(_courseFit.confidence || "low").toUpperCase()} confidence)
        </span>
      </>
    ) : "—"}
  </div>

  {(_courseFit && _courseFit.ok) ? (
    <div className="mt-3 text-xs text-neutral-600 space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span>Low (≤7)</span>
        <span className="font-mono tabular-nums">
          {_fmtSignedNum(_courseFit.stats?.low?.avgDelta,2)} pts ({_courseFit.stats?.low?.players || 0}p)
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>Mid (8–15)</span>
        <span className="font-mono tabular-nums">
          {_fmtSignedNum(_courseFit.stats?.mid?.avgDelta,2)} pts ({_courseFit.stats?.mid?.players || 0}p)
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>High (≥16)</span>
        <span className="font-mono tabular-nums">
          {_fmtSignedNum(_courseFit.stats?.high?.avgDelta,2)} pts ({_courseFit.stats?.high?.players || 0}p)
        </span>
      </div>
      <div className="pt-1 text-[11px] text-neutral-500">
        Deltas are vs each player’s own baseline (all selected rounds).
      </div>
    </div>
  ) : null}
</div>
            </div>
          </div>
        </div>

        {/* PAR LEADERS */}
        <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Par leaders</div>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-700">
                  🏆 Leaders
                </span>
              </div>

              <div className="text-lg font-extrabold text-neutral-900">
                Who dominates Par 3s, Par 4s, and Par 5s
              </div>

              <div className="text-sm text-neutral-600 mt-1">
                {parLeadMode==="gross"
                  ? "Gross mode: fewer strokes on each hole type = better scoring."
                  : "Stableford mode: more points on each hole type = better scoring."}
              </div>

              {parLeadersCollapsed ? (
                <div className="mt-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">
                      Quick podium
                    </div>
                    <div className="text-[11px] font-black text-neutral-500">
                      {parLeadMode==="gross" ? "lower wins" : "higher wins"}
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
                    {[
                      { k: "all", label: "All holes", ico: "🏆", desc: "Best overall scoring across the course" },
                      { k: "p3",  label: "Par 3",    ico: "🎯", desc: "Short holes — accuracy & distance control" },
                      { k: "p4",  label: "Par 4",    ico: "⚙️", desc: "The backbone — tee shot + approach quality" },
                      { k: "p5",  label: "Par 5",    ico: "🚀", desc: "Scoring chances — smart aggression pays" },
                    ].map(it => {
                      const top = (parLeaders?.[it.k] && parLeaders[it.k][0]) ? parLeaders[it.k][0] : null;
                      const v = top ? top.v : NaN;
                      const unit = (parLeadMode==="gross") ? "sop/ho" : "pts/ho";

                      return (
                        <div key={it.k} className="rounded-2xl border border-neutral-200 bg-white p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-lg leading-none">{it.ico}</span>
                                <div className="font-extrabold text-neutral-900 truncate">{it.label}</div>
                              </div>
                              <div className="text-xs text-neutral-500 mt-0.5">{it.desc}</div>
                            </div>

                            <div className="text-right">
                              {top ? (
                                <>
                                  <div className="text-[11px] font-black text-neutral-500 uppercase tracking-wide">Leader</div>
                                  <div className="font-black text-neutral-900">{top.name}</div>
                                  <div className="text-xs text-neutral-500 tabular-nums">
                                    {Number.isFinite(v) ? `${fmtSignedSmart(v, 2)} ${unit}` : "—"}
                                  </div>
                                </>
                              ) : (
                                <div className="text-xs text-neutral-500">No data</div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-2 text-xs text-neutral-500">
                    Tap <b>View leaders</b> to see full boards and sample sizes.
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                className={"chip special " + (parLeadersCollapsed ? "ring-2 ring-emerald-200 shadow-sm" : "")}
                onClick={() => setParLeadersCollapsed(v => !v)}
              >
                {parLeadersCollapsed ? "View leaders ▾" : "Hide leaders ▴"}
              </button>

              <button
                className={"px-3 py-1.5 rounded-xl text-sm font-extrabold border " + (parLeadMode==="stableford" ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-700 border-neutral-200")}
                onClick={() => setParLeadMode("stableford")}
              >
                Stableford
              </button>

              <button
                className={"px-3 py-1.5 rounded-xl text-sm font-extrabold border " + (parLeadMode==="gross" ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-700 border-neutral-200")}
                onClick={() => setParLeadMode("gross")}
              >
                Gross
              </button>
            </div>
          </div>

          {!parLeadersCollapsed && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              {[
                { key: "all", title: "All holes", ico: "🏆" },
                { key: "p3",  title: "Par 3",    ico: "🎯" },
                { key: "p4",  title: "Par 4",    ico: "⚙️" },
                { key: "p5",  title: "Par 5",    ico: "🚀" },
              ].map(col => (
                <div key={col.key} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-extrabold text-neutral-900">
                      <span className="mr-1">{col.ico}</span>{col.title}
                    </div>
                    <div className="text-[11px] font-black text-neutral-500 uppercase tracking-wide">
                      {parLeadMode==="gross" ? "lower wins" : "higher wins"}
                    </div>
                  </div>

                  <div className="mt-2 space-y-1">
                    {(parLeaders[col.key] || []).map((r, i) => {
                      const medal = i===0 ? "🥇" : i===1 ? "🥈" : i===2 ? "🥉" : `${i+1}.`;
                      return (
                        <div key={r.name} className="flex items-center justify-between text-sm">
                          <div className="min-w-0 flex items-center gap-2">
                            <span className="text-neutral-500 tabular-nums font-black w-7 text-center">
                              {medal}
                            </span>
                            <span className="font-semibold text-neutral-900 truncate">{r.name}</span>
                          </div>

                          <div className="flex items-baseline justify-end gap-2">
                            <span className="font-black tabular-nums text-neutral-900">
                              {parLeadMode==="gross" ? PR_fmt(r.v,2) : PR_fmt(r.v,2)}
                            </span>
                            {Number.isFinite(r.holes) && (
                              <span className="text-[10px] font-black tabular-nums text-neutral-400">
                                n={Math.round(r.holes)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {(!parLeaders[col.key] || parLeaders[col.key].length===0) && (
                      <div className="text-sm text-neutral-500">No data yet.</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
{/* ===== Trend chart (impact) ===== */}
      <div className="mt-6 rounded-3xl border border-neutral-200 bg-white p-4 md:p-5 shadow-sm" data-reveal>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-widest font-black text-neutral-500">Trend over time</div>
            <div className="text-sm text-neutral-700 mt-1">{_trendDescPP}</div>
          </div>
          <div className="flex items-center gap-3">
            
          
          <UX_ChipBar
            value={trendMetric}
            onChange={(v) => setTrendMetric(String(v))}
            options={[
              { label: "Overall", value: "overall" },
              { label: "Par 3", value: "p3" },
              { label: "Par 4", value: "p4" },
              { label: "Par 5", value: "p5" },
            ]}
          />
<UX_ChipBar
            value={seasonLimit}
            onChange={(v) => setSeasonLimit(String(v))}
            options={[
              { label: "1", value: "1" },
              { label: "5", value: "5" },
              { label: "10", value: "10" },
              { label: "20", value: "20" },
              { label: "30", value: "30" },
              { label: "All", value: "All" },
            ]}
          />
          </div>
        </div>
        <div className="text-neutral-900">
          <UX_LineChart a={_yPlayerPP} b={progressCompare==="par" ? _yParPP : _yFieldPP} labels={_xLabelsPP} />
          <div className="mt-2 text-xs text-neutral-500">
            {progressCompare==="par"
              ? (scoringMode==="gross"
                  ? "Vs Par: 0 = level par (negative is under par)."
                  : "Vs Par: 36 points is ‘par’ for 18 holes (2 pts/hole).")
              : (scoringMode==="gross"
                  ? "Gross line uses strokes-over-par per round (lower is better)."
                  : "Stableford line uses total points per round (higher is better).")}
          </div>
        </div>
      </div>



{/* ===== FIX THIS (main improvement) ===== */}
<div className="mt-6 rounded-3xl border border-neutral-200 bg-white p-4 lg:p-5 shadow-sm" data-reveal>
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-widest font-black text-neutral-500">
        {fixThisPP?.status === "fix" ? "🛠️ FIX THIS" : "🛠️ NOTHING OBVIOUS TO FIX"}
      </div>
      <div className="mt-1 text-lg lg:text-xl font-black text-neutral-900">
        {fixThisPP?.headline || "—"}
      </div>
      <div className="mt-2 text-sm text-neutral-700">
        {fixThisPP?.detail || "—"}
      </div>
    </div>

    <div className="shrink-0 text-right">
      <div className="text-[10px] uppercase tracking-widest font-black text-neutral-400">Confidence</div>
      <div className="mt-1 inline-flex flex-wrap justify-end gap-2">
        <span className="chip">n={Number.isFinite(fixThisPP?.sample?.holes) ? Math.round(fixThisPP.sample.holes) : 0}</span>
        <span className="chip">r={Number.isFinite(fixThisPP?.sample?.rounds) ? Math.round(fixThisPP.sample.rounds) : 0}</span>
      </div>
    </div>
  </div>
</div>

{/* ===== Player archetype ===== */}
<div className="mt-6 rounded-3xl border border-neutral-200 bg-white p-4 lg:p-5 shadow-sm" data-reveal>
  {/* On small screens, stack the 'Based on' chips under the content so the copy doesn't collapse into a skinny column */}
  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-widest font-black text-neutral-500">Player archetype</div>
      <div className="mt-1 text-xl lg:text-2xl font-black text-neutral-900 flex items-center gap-2">
        <span className="text-2xl">{archetypePP?.icon || "🧭"}</span>
        {/* Allow the name to wrap on small screens, but keep truncation on larger layouts */}
        <span className="block lg:truncate break-words">{archetypePP?.name || "—"}</span>
      </div>
      <div className="mt-2 text-sm text-neutral-600">
        {archetypePP?.why || "—"}
      </div>
      <div className="mt-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
        <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500">How to flip it</div>
        <div className="mt-1 text-sm text-neutral-700">{archetypePP?.tip || "—"}</div>
      </div>
    </div>
    <div className="w-full lg:w-auto lg:shrink-0 lg:text-right">
      <div className="text-[10px] uppercase tracking-widest font-black text-neutral-400">Based on</div>
      <div className="mt-1 inline-flex flex-wrap gap-2 lg:justify-end">
        <span className="chip">SI bands</span>
        <span className="chip">Par types</span>
        <span className="chip">Trend window</span>
      </div>
    </div>
  </div>
</div>



{/* ===== Comfort Zone Yardage ===== */}
<div className="mt-6 rounded-3xl border border-neutral-200 bg-white p-4 lg:p-5 shadow-sm" data-reveal>
  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-widest font-black text-neutral-500">Comfort zone yardage</div>
      <div className="mt-1 text-sm text-neutral-600">
        Performance by distance buckets using only hole yardage (vs expected in this window).
      </div>
    </div>

    <div className="flex items-center gap-2">
      <UX_ChipBar
        value={comfortTab}
        onChange={(v) => setComfortTab(String(v))}
        options={[
          { label: "All", value: "all" },
          { label: "Par 3", value: "p3" },
          { label: "Par 4", value: "p4" },
          { label: "Par 5", value: "p5" },
        ]}
      />
    </div>
  </div>

  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
    {(comfortZonePP?.[comfortTab] || []).map((row) => {
      const avg = row?.avg;
      const good = Number.isFinite(avg)
        ? (scoringMode === "gross" ? (avg <= 0) : (avg >= 0))
        : false;
      const cls = good ? "border-emerald-200 bg-emerald-50/40" : "border-rose-200 bg-rose-50/40";
      return (
        <div key={row.k} className={`rounded-2xl border ${cls} p-4`}>
          <div className="text-sm font-black text-neutral-900">{row.label}</div>
          <div className="mt-1 text-2xl font-black tabular-nums">
            {_fmtDelta(avg)}
            <span className="text-xs font-black text-neutral-400 ml-2">
              {scoringMode === "gross" ? "strokes/hole" : "pts/hole"}
            </span>
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            n={Number.isFinite(row.n) ? Math.round(row.n) : 0} holes
          </div>
        </div>
      );
    })}
  </div>

  <div className="mt-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
    <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500">Takeaway</div>
    <div className="mt-1 text-sm text-neutral-700">
      {comfortZonePP?.headlines?.[comfortTab] || "—"}
    </div>
  </div>
</div>

{/* ===== Golf DNA (Round Pattern Template) ===== */}
<div className="mt-6 rounded-3xl border border-neutral-200 bg-white p-4 lg:p-5 shadow-sm" data-reveal>
  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-widest font-black text-neutral-500">Golf DNA</div>
      <div className="mt-1 text-xl lg:text-2xl font-black text-neutral-900">
        {golfDNAPP?.label || "—"}
      </div>
      <div className="mt-1 text-sm text-neutral-600">
        {golfDNAPP?.why || "—"}
      </div>
    </div>

    <div className="flex items-center gap-2">
      <UX_ChipBar
        value={dnaMode}
        onChange={(v) => setDnaMode(String(v))}
        options={[
          { label: "Phases", value: "phase" },
          { label: "Holes 1–18", value: "holes" },
        ]}
      />
    </div>
  </div>

  {dnaMode === "phase" ? (
    <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
      {[
        { label: "Holes 1–6", v: golfDNAPP?.phaseAvg?.[0] },
        { label: "Holes 7–12", v: golfDNAPP?.phaseAvg?.[1] },
        { label: "Holes 13–18", v: golfDNAPP?.phaseAvg?.[2] },
      ].map((r) => {
        const v = r.v;
        const good = Number.isFinite(v)
          ? (scoringMode === "gross" ? (v <= 0) : (v >= 0))
          : false;
        const cls = good ? "border-emerald-200 bg-emerald-50/40" : "border-rose-200 bg-rose-50/40";
        return (
          <div key={r.label} className={`rounded-2xl border ${cls} p-4`}>
            <div className="text-sm font-black text-neutral-900">{r.label}</div>
            <div className="mt-1 text-2xl font-black tabular-nums">
              {_fmtDelta(v)}
              <span className="text-xs font-black text-neutral-400 ml-2">
                {scoringMode === "gross" ? "strokes/hole" : "pts/hole"}
              </span>
            </div>
            <div className="mt-1 text-xs text-neutral-500">Vs expected (window)</div>
          </div>
        );
      })}
    </div>
  ) : (
    <div className="mt-4">
      <div className="text-xs font-black uppercase tracking-widest text-neutral-500 mb-2">Hole fingerprint</div>
      <div className="grid grid-cols-9 gap-1">
        {Array.from({ length: 18 }).map((_, i) => {
          const v = golfDNAPP?.holeAvg?.[i];
          const ok = Number.isFinite(v);
          const good = ok ? (scoringMode === "gross" ? (v <= 0) : (v >= 0)) : false;
          const cls = !ok
            ? "bg-neutral-100 border-neutral-200"
            : good
              ? "bg-emerald-100 border-emerald-200"
              : "bg-rose-100 border-rose-200";
          return (
            <div key={i} className={`rounded-md border ${cls} py-2 text-center`}>
              <div className="text-[10px] font-black text-neutral-600">{i + 1}</div>
              <div className="text-[10px] font-black tabular-nums text-neutral-900">{_fmtDelta(v)}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
          <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500">Repeat strengths</div>
          <div className="mt-1 text-sm text-neutral-700">
            {(golfDNAPP?.strengths || []).length
              ? (golfDNAPP.strengths.map(h => `#${h.hole}`).join(", ") + " (where you most often beat expectation)")
              : "Not enough data yet."}
          </div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
          <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500">Repeat leaks</div>
          <div className="mt-1 text-sm text-neutral-700">
            {(golfDNAPP?.leaks || []).length
              ? (golfDNAPP.leaks.map(h => `#${h.hole}`).join(", ") + " (where you most often miss expectation)")
              : "Not enough data yet."}
          </div>
        </div>
      </div>
    </div>
  )}
</div>

{/* Edge Map (single source of truth) */}
      
{/* Executive Summary (clear + loud) */}
<div className="mt-6 rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm" data-reveal>
  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
    <div className="min-w-0">
      <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Player progress</div>
      <div className="mt-1 text-2xl md:text-3xl font-black tracking-tight text-neutral-900">
        {Number.isFinite(overallGoodRd)
          ? (overallGoodRd >= 0
              ? `Ahead of ${cohort.label} by +${_fmt(overallGoodRd,1)}${scoringMode==="gross" ? " strokes/rd" : " pts/rd"}`
              : `Behind ${cohort.label} by ${_fmt(Math.abs(overallGoodRd),1)}${scoringMode==="gross" ? " strokes/rd" : " pts/rd"}`
            )
          : "—"}
      </div>
      <div className="mt-1 text-sm text-neutral-600">
        A quick read of <b>where your score is coming from</b>: one place you consistently outperform the comparison (<b>Best edge</b>) and one place that consistently costs you the most (<b>Biggest leak</b>).
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        {(() => {
          const best = wins?.[0] || null;
          const worst = leaks?.[0] || null;
          const cb = confidenceFor(best);
          const cw = confidenceFor(worst);
          return (
            <>
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[10px] font-black tracking-widest uppercase text-neutral-anchored text-neutral-500">Best edge</div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700">
                    🏅 Gain vs {cohort.label}
                  </span>
                </div>

                <div className="mt-1 text-xs text-neutral-500">
                  The bucket where you help your score the most compared to the field (your strongest advantage).
                </div>

                <div className="mt-2 text-lg font-black text-neutral-900 truncate">{best ? best.label : "—"}</div>

                <div className="mt-1 text-sm text-neutral-700">
                  {best && Number.isFinite(best.impactRd) ? (
                    scoringMode==="gross"
                      ? <>About <b>{_fmt(Math.abs(best.impactRd),1)}</b> <b>shots saved</b> per round vs {cohort.label}.</>
                      : <>About <b>{_fmt(Math.abs(best.impactRd),1)}</b> <b>points gained</b> per round vs {cohort.label}.</>
                  ) : "—"}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`chip ${cb.cls}`}>Confidence: {cb.label}</span>
                  <span className="chip">Per round</span>
                  <span className="chip">Vs field</span>
                </div>

                <div className="mt-1 text-[11px] text-neutral-500">
                  <b>High</b> = lots of holes/rounds and a stable pattern. <b>Low</b> = limited evidence (treat as a hint).
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Biggest leak</div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-black text-rose-700">
                    🧯 Cost vs {cohort.label}
                  </span>
                </div>

                <div className="mt-1 text-xs text-neutral-500">
                  The bucket that hurts your scoring the most compared to the field (where big numbers tend to come from).
                </div>

                <div className="mt-2 text-lg font-black text-neutral-900 truncate">{worst ? worst.label : "—"}</div>

                <div className="mt-1 text-sm text-neutral-700">
                  {worst && Number.isFinite(worst.impactRd) ? (
                    scoringMode==="gross"
                      ? <>About <b>{_fmt(Math.abs(worst.impactRd),1)}</b> <b>extra shots</b> per round vs {cohort.label}.</>
                      : <>About <b>{_fmt(Math.abs(worst.impactRd),1)}</b> <b>points lost</b> per round vs {cohort.label}.</>
                  ) : "—"}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`chip ${cw.cls}`}>Confidence: {cw.label}</span>
                  <span className="chip">Per round</span>
                  <span className="chip">Vs field</span>
                </div>

                <div className="mt-1 text-[11px] text-neutral-500">
                  <b>High</b> = shows up repeatedly. <b>Medium</b> = pretty consistent. <b>Low</b> = could be noise — needs more rounds.
                </div>
              </div>
            </>
          );
        })()}

        {/* Card protection (moved from Play) */}
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Wipe / Double+ rate</div>
            <span className="inline-flex items-center gap-1 rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-black text-white">
              🛡️ Card protection
            </span>
          </div>

          {(() => {
            const holes = Number(outcomeMixPP?.holes);
            const badRate = Number(outcomeMixPP?.badRate);
            const bogeyRate = Number(outcomeMixPP?.bogeyRate);
            const parRate = Number(outcomeMixPP?.parRate);
            const birdiePlusRate = Number(outcomeMixPP?.birdiePlusRate);

            const fldBadRate = Number(fieldOutcomeMixPP?.badRate);
            const fldBogeyRate = Number(fieldOutcomeMixPP?.bogeyRate);
            const fldParRate = Number(fieldOutcomeMixPP?.parRate);
            const fldBirdiePlusRate = Number(fieldOutcomeMixPP?.birdiePlusRate);

            const badPer18 = Number.isFinite(badRate) ? badRate * 18 : NaN;
            const fldBadPer18 = Number.isFinite(fldBadRate) ? fldBadRate * 18 : NaN;

            return (
              <>
                <div className="mt-2 flex items-baseline justify-between">
                  <div className="text-2xl font-black text-neutral-900">{_pctPP(badRate)}</div>
                  <div className="text-sm font-black text-neutral-700">{Number.isFinite(badPer18) ? (_fmt(badPer18, 1) + " per 18") : "—"}</div>
                </div>

                <div className="mt-1 text-[11px] text-neutral-600">
                  Field: {_pctPP(fldBadRate)} · {Number.isFinite(fldBadPer18) ? (_fmt(fldBadPer18, 1) + " /18") : "—"}
                </div>

                <div className="mt-2 text-xs text-neutral-600">
                  Goal: <b>0.2 per 18</b> (<b>1%</b>) over the next <b>5 rounds</b> — basically remove one disaster hole.
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-white border border-neutral-200 p-2">
                    <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Bogey rate</div>
                    <div className="mt-0.5 flex items-baseline justify-between">
                      <div className="text-sm font-black">{_pctPP(bogeyRate)}</div>
                      <div className="text-[11px] text-neutral-600">Field: {_pctPP(fldBogeyRate)}</div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-white border border-neutral-200 p-2">
                    <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Par rate</div>
                    <div className="mt-0.5 flex items-baseline justify-between">
                      <div className="text-sm font-black">{_pctPP(parRate)}</div>
                      <div className="text-[11px] text-neutral-600">Field: {_pctPP(fldParRate)}</div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-white border border-neutral-200 p-2">
                    <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Birdie+ rate</div>
                    <div className="mt-0.5 flex items-baseline justify-between">
                      <div className="text-sm font-black">{_pctPP(birdiePlusRate)}</div>
                      <div className="text-[11px] text-neutral-600">Field: {_pctPP(fldBirdiePlusRate)}</div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-white border border-neutral-200 p-2">
                    <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Rounds analysed</div>
                    <div className="mt-0.5 text-sm font-black">{holes ? (PR_fmt(holes/18, 1)) : "—"}</div>
                    <div className="text-[11px] text-neutral-600">same window</div>
                  </div>
                </div>

                <div className="mt-2 text-xs text-neutral-600">
                  This isn’t about chasing birdies — it’s about protecting the card. Cut one wipe/double+ and your scoring moves immediately.
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Quick rank: clear wins vs leaks */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Top gains</div>
                <div className="mt-1 text-xs text-neutral-500">Your best contributors <b>per round</b> vs the field. (Stableford = points gained, Score = shots saved.)</div>
          <div className="mt-2 space-y-2">
            {(wins?.length ? wins.slice(0,5) : [null]).map((r,i)=>(
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="min-w-0 text-sm font-semibold text-neutral-800 truncate">{r ? r.label : "—"}</div>
                <div className={"text-sm tabular-nums font-black " + ((r && Number.isFinite(r.impactRd) && r.impactRd < 0) ? "text-rose-600" : "text-emerald-700")}>
                  {r && Number.isFinite(r.impactRd) ? `${formatSigned(r.impactRd,1)}/rd` : "—"}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Top leaks</div>
                <div className="mt-1 text-xs text-neutral-500">Your biggest costs <b>per round</b> vs the field. (Stableford = points lost, Score = extra shots.)</div>
          <div className="mt-2 space-y-2">
            {(leaks?.length ? leaks.slice(0,5) : [null]).map((r,i)=>(
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="min-w-0 text-sm font-semibold text-neutral-800 truncate">{r ? r.label : "—"}</div>
                <div className={"text-sm tabular-nums font-black " + ((r && Number.isFinite(r.impactRd) && r.impactRd > 0) ? "text-emerald-700" : "text-rose-700")}>
                  {r && Number.isFinite(r.impactRd) ? `${formatSigned(r.impactRd,1)}/rd` : "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filters + details list */}
      
      


      <div className="mt-4 flex flex-wrap items-center gap-2">
        
        <button className={`chip hover:opacity-90 ${edgeTab==="all" ? "bg-neutral-900 text-white border-neutral-900" : ""}`} onClick={() => { setEdgeTab("all"); setEdgeCount(8); }}>All</button>
        <button className={`chip hover:opacity-90 ${edgeTab==="par" ? "bg-neutral-900 text-white border-neutral-900" : ""}`} onClick={() => { setEdgeTab("par"); setEdgeCount(8); }}>Par</button>
        <button className={`chip hover:opacity-90 ${edgeTab==="si"  ? "bg-neutral-900 text-white border-neutral-900" : ""}`} onClick={() => { setEdgeTab("si");  setEdgeCount(8); }}>SI</button>
        <button className={`chip hover:opacity-90 ${edgeTab==="yd"  ? "bg-neutral-900 text-white border-neutral-900" : ""}`} onClick={() => { setEdgeTab("yd");  setEdgeCount(8); }}>Yardage</button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-neutral-500">Sorted by how many <b>{scoringMode==="gross" ? "shots" : "points"}</b> you <b>gain or lose per round</b> vs {ppBarsMode==="strokesPar" ? "par" : cohort.label}.</span>
        </div>
      </div>

      {(() => {
        const base = edgeTab==="par" ? parRows : (edgeTab==="si" ? siRows : (edgeTab==="yd" ? ydRows : allRows));
        const list = (base || []).slice().sort((a,b)=>Math.abs(b.impactRd)-Math.abs(a.impactRd));
        const shown = list.slice(0, edgeCount);
        return (
          <div className="mt-3">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {(shown.length ? shown : [{label:"—", impactRd:NaN, holes:0, mePH:NaN, fldPH:NaN, dGood:NaN}]).map((r,i)=>(
                <div key={i} className="rounded-2xl border border-neutral-100 bg-white/70 p-2">
                  <RowBar row={r} />
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between">
              <div className="text-xs text-neutral-500">
                Showing {Math.min(edgeCount, list.length || 0)} of {list.length || 0} buckets.
              </div>
              {list.length > edgeCount ? (
                <button className="chip hover:opacity-90" onClick={() => setEdgeCount(c => c + 6)}>Show more</button>
              ) : (list.length > 8 ? (
                <button className="chip hover:opacity-90" onClick={() => setEdgeCount(8)}>Show less</button>
              ) : null)}
            </div>
            <div className="mt-4">
              <ImpactWaterfall rows={list} title="Momentum snapshot" />
            </div>

          </div>
        );
      })()}
    </div>
  </div>
</div>


    </div>

    </section>
  );
}


// ===========================
// Plan/Do helpers (no GIR/club data required)
// ===========================
function PR_findRowByLabel(rows, label){
  const L = String(label || "").trim();
  return (rows || []).find(r => String(r.label || "").trim() === L) || null;
}

// Given a focus label like "Par 4", "SI 1–6", or "210–239", return KPI info.
function PR_kpiFromFocusLabel({ label, scoringMode, rawPar, rawSI, rawYd }){
  const isGross = String(scoringMode) === "gross";

  const row =
    PR_findRowByLabel(rawPar, label) ||
    PR_findRowByLabel(rawSI, label) ||
    PR_findRowByLabel(rawYd, label);

  if (!row) {
    return {
      label,
      kpi: "KPI",
      mePH: NaN,
      fldPH: NaN,
      targetPH: NaN,
      direction: isGross ? "down" : "up",
      unit: isGross ? "strokes / hole (vs peer field)" : "pts / hole (vs peer field)"
    };
  }

  const mePH = Number(row.playerAvg);
  const fldPH = Number(row.fieldAvg);

  // Target = close half the gap to field over next few rounds (realistic & motivational).
  const targetPH = (Number.isFinite(mePH) && Number.isFinite(fldPH))
    ? (mePH + 0.5 * (fldPH - mePH))
    : NaN;

  const direction = isGross ? "down" : "up";
  const unit = isGross ? "strokes / hole (vs peer field)" : "pts / hole (vs peer field)";

  // Make KPI name human
  const kpi = (() => {
    if (String(label).startsWith("SI ")) return "Avg on toughest holes";
    if (String(label).startsWith("Par ")) return "Avg by par type";
    if (String(label).match(/^\d+/)) return "Avg in this yard band";
    return "Avg for this bucket";
  })();

  return { label, kpi, mePH, fldPH, targetPH, direction, unit };
}

function PR_bucketOutcomeMix({ scoringMode, windowSeries }){
  const isGross = String(scoringMode) === "gross";
  const rounds = (windowSeries || []).slice();

  let holes = 0;
  let birdiePlus = 0;
  let pars = 0;
  let bogeys = 0;
  let bad = 0; // wipes (pts=0) or double+ (>=2 over par)

  for (const r of rounds){
    const phPts = Array.isArray(r?.perHole) ? r.perHole : null;
    const gh = Array.isArray(r?.grossPerHole) ? r.grossPerHole : null;
    const parsArr = Array.isArray(r?.parsArr) ? r.parsArr
      : Array.isArray(r?.parsPerHole) ? r.parsPerHole
      : Array.isArray(r?.pars) ? r.pars
      : null;

    for (let i=0;i<18;i++){
      if (!isGross){
        const v = Number(phPts?.[i]);
        if (!Number.isFinite(v)) continue;
        holes++;
        if (v >= 3) birdiePlus++;
        else if (v === 2) pars++;
        else if (v === 1) bogeys++;
        else bad++; // 0 = wipe
      } else {
        const g = Number(gh?.[i]);
        const p = Number(parsArr?.[i]);
        if (!Number.isFinite(g) || !Number.isFinite(p)) continue;
        holes++;
        const d = g - p; // strokes over par
        if (d <= -1) birdiePlus++;
        else if (d === 0) pars++;
        else if (d === 1) bogeys++;
        else bad++; // 2+ = double+
      }
    }
  }

  const rate = (n) => (holes ? n / holes : NaN);
  return {
    holes,
    birdiePlusRate: rate(birdiePlus),
    parRate: rate(pars),
    bogeyRate: rate(bogeys),
    badRate: rate(bad),
  };
}


// Compute exact damage severity: average strokes above bogey on double+ holes
function PR_damageSeverity(series){
  if(!Array.isArray(series) || !series.length) return NaN;
  let sum = 0, n = 0;
  for(const h of series){
    if(!Number.isFinite(h?.par) || !Number.isFinite(h?.strokes)) continue;
    const overPar = h.strokes - h.par;
    if(overPar >= 2){ // double bogey or worse
      sum += (overPar - 1); // strokes above bogey
      n++;
    }
  }
  return n ? (sum / n) : NaN;
}



// =========================
// Season Report Export (HTML)
// - Generates a printable, numbers-backed report for the selected player/year.
// - Uses the same peer-benchmark logic as Player Report (handicap-band baseline).
// =========================

function PR_sumNumeric(a, b){
  const out = Array.isArray(a) ? a.slice() : (a && typeof a === "object" ? { ...a } : {});
  if (!b || typeof b !== "object") return out;
  Object.keys(b).forEach(k => {
    const va = Number(out[k]);
    const vb = Number(b[k]);
    if (Number.isFinite(vb)) out[k] = (Number.isFinite(va) ? va : 0) + vb;
  });
  return out;
}

function PR_sumAggObjects(players, prop, makeFn){
  const out = (typeof makeFn === "function") ? makeFn() : {};
  (players || []).forEach(p => {
    const src = p?.[prop];
    if (!src || typeof src !== "object") return;
    // sum any numeric keys we see
    Object.keys(src).forEach(k => {
      const vb = Number(src[k]);
      if (!Number.isFinite(vb)) return;
      const va = Number(out[k]);
      out[k] = (Number.isFinite(va) ? va : 0) + vb;
    });
  });
  return out;
}


function PR_sumAggMap(players, prop, makeAggFn){
  const out = {};
  (players || []).forEach(p => {
    const m = p?.[prop] || {};
    Object.keys(m).forEach(k => {
      const agg = m[k];
      if (!agg || typeof agg !== "object") return;
      if (!out[k]) out[k] = (typeof makeAggFn === "function") ? makeAggFn() : {};
      out[k] = PR_sumNumeric(out[k], agg);
    });
  });
  return out;
}


function PR_safeSlug(s){
  try{
    return String(s||"")
      .toLowerCase()
      .trim()
      .replace(/['"]/g,"")
      .replace(/[^a-z0-9]+/g,"-")
      .replace(/-+/g,"-")
      .replace(/(^-|-$)/g,"")
      .slice(0,80) || "report";
  }catch(e){
    return "report";
  }
}

function PR_escapeHtml(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function PR_renderTableBare(rows, scoringMode, comparatorMode){
  const isGross = String(scoringMode)==="gross";
  const safe = (v)=> Number.isFinite(v) ? v.toFixed(2) : "—";
  const safeInt = (v)=> Number.isFinite(v) ? String(Math.round(v)) : "—";

const __mode = String(comparatorMode||"band");
// Par-baseline mode: render absolute over-par tables (no peer/delta columns).
if (__mode === "par") {
  const rows2 = (rows||[]).map(r=>{
    const label = PR_escapeHtml(r?.label ?? r?.key ?? "");
    const holes = Number.isFinite(r?.holes) ? Math.round(r.holes) : NaN;
    const me = Number.isFinite(r?.me) ? r.me : (Number.isFinite(r?.playerAvg) ? r.playerAvg : NaN);
    return { label, holes, me };
  });
  // severity classes: closer to 0 is better
  const clsOfAbs = (v)=>{
    if(!Number.isFinite(v)) return "PRneutral";
    if(v <= 0.75) return "PRgood";
    if(v <= 1.25) return "PRneutral";
    return "PRbad";
  };
  const safeAbs = (v)=> Number.isFinite(v) ? v.toFixed(2) : "—";
  const safeH = (v)=> Number.isFinite(v) ? String(v) : "—";
  return `
    <div class="PRtableWrap">
      <div class="PRlegend">
        <span class="PRpill PRgoodPill">Good (closer to par)</span>
        <span class="PRpill PRbadPill">Leak (far from par)</span>
        <span class="PRpill PRneutralPill">Neutral</span>
        <span class="PRmuted" style="margin-left:8px;">Values shown are your <b>avg strokes over par per hole</b> in each bucket.</span>
      </div>
      <table class="PRtable">
        <thead>
          <tr>
            <th class="left">Bucket</th>
            <th>Holes</th>
            <th>You (avg over par)</th>
          </tr>
        </thead>
        <tbody>
          ${rows2.map(r=>{
            const cls = clsOfAbs(r.me);
            return `
              <tr class="PRrow ${cls}">
                <td class="left"><span class="PRbucket">${r.label}</span></td>
                <td>${safeH(r.holes)}</td>
                <td><b>${safeAbs(r.me)}</b></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}


  // Positive delta always means "better"
  const deltaOf = (r)=>{
    const me = Number.isFinite(r?.me) ? r.me : (Number.isFinite(r?.playerAvg) ? r.playerAvg : NaN);
    const peer = Number.isFinite(r?.peer) ? r.peer : (Number.isFinite(r?.fieldAvg) ? r.fieldAvg : NaN);
    if(!Number.isFinite(me) || !Number.isFinite(peer)) return NaN;
    return isGross ? (peer - me) : (me - peer);
  };
  const meOf = (r)=> Number.isFinite(r?.me) ? r.me : r?.playerAvg;
  const peerOf = (r)=> Number.isFinite(r?.peer) ? r.peer : r?.fieldAvg;

  const fmtDelta = (v)=>{
    if(!Number.isFinite(v)) return "—";
    return (v>=0?"+":"") + v.toFixed(Math.abs(v)<0.01 && v!==0 ? 3 : 2);
  };
  const clsOf = (d)=>{
    if(!Number.isFinite(d)) return "neu";
    if(d > 0.0005) return "good";
    if(d < -0.0005) return "bad";
    return "neu";
  };
  const arrowOf = (d)=>{
    if(!Number.isFinite(d)) return "";
    if(d > 0.0005) return "▲";
    if(d < -0.0005) return "▼";
    return "•";
  };

  const out = `
    <div class="PRlegend">
      <span class="PRlegItem good"><span class="PRlegDot"></span>Good (gain)</span>
      <span class="PRlegItem bad"><span class="PRlegDot"></span>Bad (leak)</span>
      <span class="PRlegItem neu"><span class="PRlegDot"></span>Neutral</span>
      <span class="PRlegNote">Delta is always oriented so <b>positive = better</b> (gross: fewer strokes; stableford: more points).</span>
    </div>

    <table class="PRtbl">
      <colgroup><col class="c1"/><col class="c2"/><col class="c3"/><col class="c4"/><col class="c5"/></colgroup>
      <thead>
        <tr>
          <th>Bucket</th><th>Holes</th><th>You (avg)</th><th>Peer (avg)</th><th>Delta</th>
        </tr>
      </thead>
      <tbody>
        ${(rows||[]).map(r=>{
          const d = Number.isFinite(r?.delta) ? Number(r.delta) : deltaOf(r);
          const cls = clsOf(d);
          const label = PR_escapeHtml(r?.label ?? r?.key ?? "");
          const holes = safeInt(r?.holes);
          const me = safe(meOf(r));
          const peer = safe(peerOf(r));
          const delta = fmtDelta(d);
          const arrow = arrowOf(d);
          return `
            <tr class="PRrow ${cls}">
              <td class="left"><span class="PRbucket">${label}</span></td>
              <td>${holes}</td>
              <td>${me}</td>
              <td>${peer}</td>
              <td class="PRdelta">
                <span class="PRdeltaBadge ${cls}"><span class="PRarr">${arrow}</span>${delta}</span>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
  return out;
}

function PR_renderTable(title, rows, scoringMode){
  const isGross = String(scoringMode) === "gross";
  const unit = isGross ? "strokes / hole" : "pts / hole";
  const th = (t) => `<th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">${t}</th>`;
  const td = (t, right=false) => `<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;${right?'text-align:right;':''}font-size:14px;color:#111827;">${t}</td>`;
  const fmt = (x) => {
    const n = Number(x);
    if (!Number.isFinite(n)) return "—";
    return isGross ? n.toFixed(2) : n.toFixed(2);
  };
  const fmtS = (x) => {
    const n = Number(x);
    if (!Number.isFinite(n)) return "—";
    const s = n > 0 ? "+" : "";
    return s + n.toFixed(Math.abs(n) < 0.01 && n !== 0 ? 3 : 2);
  };

  const body = (rows || []).map(r => {
    const me = Number(r?.playerAvg);
    const fld = Number(r?.fieldAvg);
    const delta = (isGross ? (fld - me) : (me - fld)); // positive = good
    return `<tr>
      ${td(PR_escapeHtml(r?.label || "—"))}
      ${td(String(PR_num(r?.holes,0)), true)}
      ${td(fmt(me), true)}
      ${td(fmt(fld), true)}
      ${td(fmtS(delta), true)}
    </tr>`;
  }).join("");

  return `
  <div style="margin-top:14px;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
    <div style="padding:12px 14px;background:#fafafa;border-bottom:1px solid #e5e7eb;">
      <div style="font-weight:800;color:#111827;">${PR_escapeHtml(title)}</div>
      <div style="margin-top:2px;font-size:12px;color:#6b7280;">Averages are per hole. Delta is “good” when positive (better than peer baseline). Unit: ${unit}.</div>
    </div>
    <table class="tbl"><colgroup><col class="c1"/><col class="c2"/><col class="c3"/><col class="c4"/><col class="c5"/></colgroup>
      <thead>
        <tr>
          ${th("Bucket")}
          ${th("Holes")}
          ${th("You")}
          ${th("Peer")}
          ${th("Delta")}
        </tr>
      </thead>
      <tbody>${body || `<tr><td colspan="5" style="padding:10px;color:#6b7280;">No data</td></tr>`}</tbody>
    </table>
  </div>`;
}

function PR_peerBandLabelFromHcap(h){
  const bands=[{min:0,max:9.9},{min:10,max:14.9},{min:15,max:19.9},{min:20,max:24.9},{min:25,max:29.9},{min:30,max:99}];
  const b=bands.find(b=>h>=b.min && h<=b.max) || bands[bands.length-1];
  return `${b.min}–${b.max}`;
}

// =========================
// Inline Season Report UI (no popup)
// =========================
function PR_showInlineSeasonReport(htmlFragment){
  try{
    let wrap = document.getElementById("PR_seasonReportOverlay");
    if(!wrap){
      wrap = document.createElement("div");
      wrap.id = "PR_seasonReportOverlay";
      wrap.style.position = "fixed";
      wrap.style.inset = "0";
      wrap.style.zIndex = "999999";
      wrap.style.background = "rgba(2,6,23,.65)";
      wrap.style.display = "none";
      wrap.innerHTML = `
        <div id="PR_seasonReportPanel" style="position:absolute; inset:18px; background:#fff; border-radius:14px; overflow:auto; box-shadow:0 20px 60px rgba(0,0,0,.35);">
          <div style="position:sticky; top:0; background:#fff; border-bottom:1px solid #e5e7eb; padding:12px 14px; display:flex; align-items:center; gap:10px; z-index:2;">
            <div style="font-weight:900; color:#0f172a;">Season Report</div>
            <div style="flex:1"></div>
            <button id="PR_closeSeasonReport" style="border:1px solid #e5e7eb; background:#fff; border-radius:10px; padding:8px 10px; font-weight:800; cursor:pointer;">Close</button>
          </div>
          <div id="PR_seasonReportBody" style="padding:16px 18px;"></div>
        </div>
      `;
      document.body.appendChild(wrap);
      wrap.addEventListener("click", (e)=>{ if(e.target===wrap) PR_hideInlineSeasonReport(); });
      wrap.querySelector("#PR_closeSeasonReport").addEventListener("click", PR_hideInlineSeasonReport);
    }
    wrap.querySelector("#PR_seasonReportBody").innerHTML = htmlFragment;
    PR_wireSeasonReportControls();
    wrap.style.display = "block";
    document.body.style.overflow = "hidden";
  }catch(e){
    console.error(e);
    alert("Could not display report.");
  }
}
function PR_hideInlineSeasonReport(){
  const wrap = document.getElementById("PR_seasonReportOverlay");
  if(wrap) wrap.style.display = "none";
  document.body.style.overflow = "";
}

function PR_wireSeasonReportControls(){
  try{
    const body = document.getElementById("PR_seasonReportBody");
    if(!body) return;

    // Cohort toggle (Field vs Handicap band)
    const btns = Array.from(body.querySelectorAll("[data-pr-report-cohort]"));
    btns.forEach(btn => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-pr-report-cohort") || "band";
        PR_regenSeasonReport(mode);
      });
    });
  }catch(e){
    console.error(e);
  }
}

function PR_regenSeasonReport(mode){
  try{
    const p = window.__dslSeasonReportParams;
    if(!p || !p.model) return;
    const comparatorMode = (String(mode)==="field") ? "field" : "band";
    window.__dslSeasonReportParams = { ...p, comparatorMode };

    const r = PR_generateSeasonReportHTML({
      model: p.model,
      playerName: p.playerName,
      yearLabel: p.yearLabel,
      seasonLimit: p.seasonLimit,
      scoringMode: p.scoringMode,
      lensMode: p.lensMode,
      comparatorMode
    });
    if(!r || !r.ok) { alert(r?.error || "Could not generate report."); return; }
    PR_showInlineSeasonReport(r.htmlFragment || r.html);
  }catch(e){
    console.error(e);
    alert("Could not update report.");
  }
}


function PR_generateSeasonReportHTML({ model, playerName, yearLabel, seasonLimit, scoringMode, lensMode, comparatorMode }){
  var peerBand = "—"; // ensure defined for template safety
  var peerMin = NaN, peerMax = NaN, peerPlayersN = 0;

  const players = Array.isArray(model?.players) ? model.players : [];
  let cur = players.find(p => String(p?.name||"") === String(playerName||"")) || players[0] || null;
  if (!cur) return { ok:false, error:"No player selected." };

  // ------------------------------------------------------------
  // IMPORTANT: Use the Overview-computed benchmark outputs when available.
  // This keeps the report identical to the Overview (single source of truth).
  // ------------------------------------------------------------
  const __snap = (window && window.__dslOverviewReport) ? window.__dslOverviewReport : null;
  const __useSnap = !!(__snap
    && String(__snap.playerName||"") === String(playerName||"")
    && String(__snap.yearLabel||"") === String(yearLabel||"")
    && String(__snap.seasonLimit||"") === String(seasonLimit||"")
    && String(__snap.scoringMode||"") === String(scoringMode||""));

  const __effComparatorMode = __useSnap
    ? ((String(__snap.comparatorMode||"band") === "par") ? "par" : (String(__snap.comparatorMode||"band") === "field" ? "field" : "band"))
    : ((String(comparatorMode||"band") === "par") ? "par" : (String(comparatorMode||"band") === "field" ? "field" : "band"));

  // Peer aggregate baseline (field or band) — pulled from Overview when possible.
  let __peerAgg = null;
  if (__useSnap) {
    peerBand = String(__snap.peerBand || __snap.cohortLabel || "—");
    peerMin = Number.isFinite(Number(__snap.peerMin)) ? Number(__snap.peerMin) : NaN;
    peerMax = Number.isFinite(Number(__snap.peerMax)) ? Number(__snap.peerMax) : NaN;
    peerPlayersN = Number.isFinite(Number(__snap.peerPlayersN)) ? Number(__snap.peerPlayersN) : 0;
    if (__snap.playerAgg) cur = __snap.playerAgg;
    __peerAgg = __snap.peerAgg || null;
  }

  
  // ------------------------------------------------------------
  // Par baseline comparator (no peers): build a zero baseline that matches the player's bucket denominators.
  // This avoids any recalculation and keeps the report comparable to par when Overview lens is "strokesPar".
  // ------------------------------------------------------------
  function __makeParBaselineFromPlayer(playerAgg){
    const z = (holes) => ({ holes: Number.isFinite(Number(holes)) ? Number(holes) : 0, val: 0 });
    const out = {
      totalsGross: z(playerAgg?.totalsGross?.holes),
      byParGross: {},
      bySIGross: {},
      byYardsGross: {}
    };
    ["Par 3","Par 4","Par 5","Unknown"].forEach(k => { out.byParGross[k] = z(playerAgg?.byParGross?.[k]?.holes); });
    ["1–6","7–12","13–18","Unknown"].forEach(k => { out.bySIGross[k] = z(playerAgg?.bySIGross?.[k]?.holes); });
    // For yards bands, mirror keys from playerAgg so tables stay aligned.
    const y = playerAgg?.byYardsGross || {};
    Object.keys(y || {}).forEach(k => { out.byYardsGross[k] = z(y?.[k]?.holes); });
    return out;
  }

  if (__effComparatorMode === "par") {
    peerBand = "Par baseline";
    peerPlayersN = 0;
    peerMin = NaN; peerMax = NaN;
    __peerAgg = __makeParBaselineFromPlayer(cur);
  }

// Apply the same YEAR / MOST RECENT GAMES windowing as the Overview.
  function __filterSeries(seriesArr){
    let out = Array.isArray(seriesArr) ? seriesArr.slice() : [];
    const yearSel = String(yearLabel || "All");
    const limitSel = String(seasonLimit || "All");

    const dateOf = (r) => {
      const d = r?.date || r?.eventDate || r?.roundDate || r?.ts || r?.when || r?.playedAt || "";
      const dd = new Date(d);
      if (!isNaN(dd)) return dd.getTime();
      const m = String(d).match(/(20\d{2})/);
      if (m) return new Date(m[1] + "-01-01").getTime();
      return 0;
    };

    // Year filter
    if (yearSel && yearSel !== "All"){
      const norm = (x) => {
        const t = String(x ?? "").trim();
        const m = t.match(/^(\d{4})-(\d{2})$/);
        if (m) {
          const start = m[1];
          const end = String(Number(start.slice(0,2) + m[2]));
          return `${start}-${end}`;
        }
        return t;
      };
      const sid = norm(yearSel);
      out = out.filter(r => {
        const s = (r && (r.seasonId ?? r.season_id)) ?? "";
        return norm(s) === sid;
      });
    }

    // Sort oldest -> newest, then take most recent N if requested
    out.sort((a,b) => dateOf(a) - dateOf(b));
    if (limitSel && limitSel !== "All"){
      const n = parseInt(limitSel, 10);
      if (!isNaN(n) && n > 0 && out.length > n){
        out = out.slice(-n);
      }
    }
    return out;
  }


  
// Peer group baseline — if we didn't get a snapshot, fall back to the existing report logic.
  let peers = players.filter(p => p && String(p?.name||"") !== String(cur?.name||""));
  if (!__peerAgg) {
    const mode = (String(comparatorMode||"band") === "field") ? "field" : "band";
    try{
      if (mode === "field"){
        peerBand = "Field";
      } else {
        const series = __filterSeries(cur?.series);
        const avgH = _mean(series.map(s => _num(s?.hcap, NaN)));
        const bw = Number.isFinite(avgH) ? (avgH >= 18 ? 6 : (avgH >= 10 ? 4 : 3)) : 4;

        const picks = players.filter(p => {
          if (!p || String(p?.name||"") === String(cur?.name||"")) return false;
          const s = __filterSeries(p?.series);
          const a = _mean(s.map(x => _num(x?.hcap, NaN)));
          return Number.isFinite(avgH) && Number.isFinite(a) && Math.abs(a - avgH) <= bw;
        });

        if (picks.length < 3){
          peers = players.filter(p => p && String(p?.name||"") !== String(cur?.name||""));
          peerBand = "Field (band too small)";
        } else {
          peers = picks.slice();
          const lo = avgH - bw, hi = avgH + bw;
          peerBand = `Handicap band (${lo.toFixed(1)}–${hi.toFixed(1)})`;
        }
      }

      // Actual min/max handicap within peer cohort (for transparency)
      let mn = Infinity, mx = -Infinity;
      for (const p of peers){
        const s = __filterSeries(p?.series);
        const a = _mean(s.map(x => _num(x?.hcap, NaN)));
        if (Number.isFinite(a)){ mn = Math.min(mn, a); mx = Math.max(mx, a); }
      }
      if (mn !== Infinity){ peerMin = mn; peerMax = mx; }
      peerPlayersN = peers.length;
    }catch(e){
      // Keep safe defaults.
    }
  }

const isGross = String(scoringMode) === "gross";
  const meTotals = isGross ? (cur?.totalsGross || _makeAggGross()) : (cur?.totals || _makeAgg());
  const peerTotals = __peerAgg
    ? (isGross ? (__peerAgg?.totalsGross || _makeAggGross()) : (__peerAgg?.totals || _makeAgg()))
    : (isGross ? PR_sumAggObjects(peers, "totalsGross", _makeAggGross) : PR_sumAggObjects(peers, "totals", _makeAgg));

  const mePH = isGross ? PR_avgGross(meTotals) : PR_avgPts(meTotals);
  const peerPH = isGross ? PR_avgGross(peerTotals) : PR_avgPts(peerTotals);
  const goodDeltaPH = isGross ? (peerPH - mePH) : (mePH - peerPH); // positive = good
  const youAvgPH = mePH;
  const peerAvgPH = peerPH;

  const rounds = PR_num(cur?.rounds, NaN);
  const holes = PR_num(meTotals?.holes, NaN);

  // Core KPI buckets (same as the report cards)
  const bySI = PR_buildRawRows({
    scoringMode,
    dim:"SI",
    mapObj: isGross ? cur?.bySIGross : cur?.bySI,
    fieldObj: __peerAgg
      ? (isGross ? (__peerAgg?.bySIGross || {}) : (__peerAgg?.bySI || {}))
      : (isGross ? PR_sumAggMap(peers, "bySIGross", _makeAggGross) : PR_sumAggMap(peers, "bySI", _makeAgg)),
    limit: 6,
  });

  const byPar = PR_buildRawRows({
    scoringMode,
    dim:"Par",
    mapObj: isGross ? cur?.byParGross : cur?.byPar,
    fieldObj: __peerAgg
      ? (isGross ? (__peerAgg?.byParGross || {}) : (__peerAgg?.byPar || {}))
      : (isGross ? PR_sumAggMap(peers, "byParGross", _makeAggGross) : PR_sumAggMap(peers, "byPar", _makeAgg)),
    limit: 6,
  });

  const byYd = PR_buildRawRows({
    scoringMode,
    dim:"Yards",
    mapObj: isGross ? cur?.byYardsGross : cur?.byYards,
    fieldObj: __peerAgg
      ? (isGross ? (__peerAgg?.byYardsGross || {}) : (__peerAgg?.byYards || {}))
      : (isGross ? PR_sumAggMap(peers, "byYardsGross", _makeAggGross) : PR_sumAggMap(peers, "byYards", _makeAgg)),
    limit: 10,
  });

  // Outcome mix (birdie+/par/bogey/bad)
  const windowSeries = Array.isArray(cur?.roundSeries) ? cur.roundSeries : (__filterSeries(cur?.series));
  const mix = PR_bucketOutcomeMix({ scoringMode, windowSeries });
// Peer outcome mix derived from aggregated peer totals (fact-based)
const holesMe = PR_num(meTotals?.holes, 0) || 0;
const holesPeer = PR_num(peerTotals?.holes, 0) || 0;
// Report outcome mix derived from aggregated totals (prefers canonical aggregate counts; falls back to windowSeries mix)
const mixRpt = (() => {
  const safeNum = (v, d=NaN) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  try {
    const mk = (birdies, pars, bogeys, bad) => ({
      birdiePlusRate: holesMe ? (safeNum(birdies, NaN) / holesMe) : NaN,
      parRate: holesMe ? (safeNum(pars, NaN) / holesMe) : NaN,
      bogeyRate: holesMe ? (safeNum(bogeys, NaN) / holesMe) : NaN,
      badRate: holesMe ? (safeNum(bad, NaN) / holesMe) : NaN,
    });

    let out;
    if (String(scoringMode) === "gross") {
      out = mk(meTotals?.birdies, meTotals?.pars, meTotals?.bogeys, (safeNum(meTotals?.doubles,0) + safeNum(meTotals?.triplesPlus,0)));
    } else {
      // Stableford: "bad" = wipes (0 pts) if available
      out = mk(meTotals?.birdies, meTotals?.pars, meTotals?.bogeys, meTotals?.wipes);
    }

    // Fallback to series-derived mix if aggregate counters are missing
    const fallback = mix || {};
    if (!Number.isFinite(out.birdiePlusRate) && Number.isFinite(fallback.birdiePlusRate)) out.birdiePlusRate = fallback.birdiePlusRate;
    if (!Number.isFinite(out.parRate) && Number.isFinite(fallback.parRate)) out.parRate = fallback.parRate;
    if (!Number.isFinite(out.bogeyRate) && Number.isFinite(fallback.bogeyRate)) out.bogeyRate = fallback.bogeyRate;
    if (!Number.isFinite(out.badRate) && Number.isFinite(fallback.badRate)) out.badRate = fallback.badRate;
    return out;
  } catch (e) {}
  return mix;
})();
let peerMixRpt = { birdiePlusRate: NaN, parRate: NaN, bogeyRate: NaN, badRate: NaN };
try{
  // Primary: derive peer mix from aggregated peer totals (fast + consistent when counters exist)
  if(String(scoringMode)==="gross"){
    peerMixRpt = {
      birdiePlusRate: holesPeer? (PR_num(peerTotals?.birdies,0)/holesPeer) : NaN,
      parRate: holesPeer? (PR_num(peerTotals?.pars,0)/holesPeer) : NaN,
      bogeyRate: holesPeer? (PR_num(peerTotals?.bogeys,0)/holesPeer) : NaN,
      badRate: holesPeer? ((PR_num(peerTotals?.doubles,0)+PR_num(peerTotals?.triplesPlus,0))/holesPeer) : NaN
    };
  } else {
    // Stableford: treat "bad" as wipes (0 points) if wipes exists; else NaN
    peerMixRpt = {
      birdiePlusRate: holesPeer? (PR_num(peerTotals?.birdies,0)/holesPeer) : NaN,
      parRate: holesPeer? (PR_num(peerTotals?.pars,0)/holesPeer) : NaN,
      bogeyRate: holesPeer? (PR_num(peerTotals?.bogeys,0)/holesPeer) : NaN,
      badRate: holesPeer? (PR_num(peerTotals?.wipes, NaN)/holesPeer) : NaN
    };
  }

  // Fallback: if aggregate counters are missing/zeroed, compute from the actual peer round-series window
  // (This fixes cases where peerTotals has holes but birdies/pars/bogeys weren't populated in the aggregator.)
  const peerSeriesCombined = (Array.isArray(peers) ? peers : [])
    .flatMap(p => Array.isArray(p?.roundSeries) ? p.roundSeries : (__filterSeries(p?.series)));
  const peerMixFallback = PR_bucketOutcomeMix({ scoringMode, windowSeries: peerSeriesCombined }) || {};

  const isMissingOrZeroed = (rate, aggCount) =>
    !Number.isFinite(rate) || (rate===0 && holesPeer>0 && PR_num(aggCount,0)===0);

  if (isMissingOrZeroed(peerMixRpt.birdiePlusRate, peerTotals?.birdies) && Number.isFinite(peerMixFallback.birdiePlusRate)) {
    peerMixRpt.birdiePlusRate = peerMixFallback.birdiePlusRate;
  }
  if (isMissingOrZeroed(peerMixRpt.parRate, peerTotals?.pars) && Number.isFinite(peerMixFallback.parRate)) {
    peerMixRpt.parRate = peerMixFallback.parRate;
  }
  if (isMissingOrZeroed(peerMixRpt.bogeyRate, peerTotals?.bogeys) && Number.isFinite(peerMixFallback.bogeyRate)) {
    peerMixRpt.bogeyRate = peerMixFallback.bogeyRate;
  }
  // "bad" counter differs by mode
  const badCount = (String(scoringMode)==="gross")
    ? (PR_num(peerTotals?.doubles,0)+PR_num(peerTotals?.triplesPlus,0))
    : PR_num(peerTotals?.wipes,0);

  if (isMissingOrZeroed(peerMixRpt.badRate, badCount) && Number.isFinite(peerMixFallback.badRate)) {
    peerMixRpt.badRate = peerMixFallback.badRate;
  }

}catch(e){}


  const dmgRate = PR_num(mixRpt?.badRate, NaN);
  const peerDmgRate = PR_num(peerMixRpt?.badRate, NaN);
  const bogeyRate = PR_num(mixRpt?.bogeyRate, NaN);
  const peerBogeyRate = PR_num(peerMixRpt?.bogeyRate, NaN);


  const unitPH = isGross ? "strokes / hole (over par)" : "pts / hole";
  const unitDelta = isGross ? "strokes per hole (you take fewer strokes than peers when positive)" : "points per hole vs peer (higher is better)";

  // Narrative helpers
  const fmt = (x,dp=2)=>{ const n=Number(x); return Number.isFinite(n)?n.toFixed(dp):"—"; };
  const fmtS = (x)=>{ const n=Number(x); if(!Number.isFinite(n)) return "—"; const s=n>0?"+":""; return s+n.toFixed(Math.abs(n)<0.01&&n!==0?3:2); };

  // Identify top 3 leaks (worst deltas) by magnitude, from SI/Par/Yards
  function worstFrom(rows, topN=3){
    const list = (rows||[]).map(r=>{
      const me=Number(r.playerAvg), fld=Number(r.fieldAvg);
      const good = isGross ? (fld - me) : (me - fld); // positive good
      const bad = -good; // positive bad
      return { label:r.label, holes:r.holes, me:r.playerAvg, fld:r.fieldAvg, bad };
    }).filter(x=>Number.isFinite(x.bad) && PR_num(x.holes,0)>=12); // more stable for multi-course
    list.sort((a,b)=>b.bad-a.bad);
    return list.slice(0, topN);
  }
  const worst = [...worstFrom(bySI,2), ...worstFrom(byPar,2), ...worstFrom(byYd,3)]
    .sort((a,b)=>b.bad-a.bad).slice(0,3);

  const h1 = `Season Report — ${PR_escapeHtml(cur?.name || playerName || "Player")}`;
  const subtitle = `${PR_escapeHtml(yearLabel || "All years")} • ${isGross ? "Gross" : "Stableford"} • Peer-benchmarked`;
  // Final event (latest round in selected window)
  let finalEventName = "Season Finale";
  let finalEventDate = "";
  try{
    const s = Array.isArray(windowSeries) ? windowSeries : [];
    const last = s.length ? s[s.length-1] : null;
    if(last){
      finalEventName = String(last?.eventName || last?.event || last?.competition || last?.name || last?.course || "Season Finale");
      const dRaw = last?.date || last?.roundDate || last?.playedAt || last?.played_on || last?.ts || "";
      const d = new Date(dRaw);
      finalEventDate = (!dRaw) ? "" : (isNaN(d.getTime()) ? String(dRaw) : d.toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric"}));
    }
  }catch(e){}

// Identify best/worst buckets across all evidence tables (largest positive/negative delta)
const _deltaOfRow = (r)=>{
  const me = Number.isFinite(r?.me) ? r.me : (Number.isFinite(r?.playerAvg) ? r.playerAvg : NaN);
  const peer = Number.isFinite(r?.peer) ? r.peer : (Number.isFinite(r?.fieldAvg) ? r.fieldAvg : NaN);
  if(!Number.isFinite(me) || !Number.isFinite(peer)) return NaN;
  return isGross ? (peer - me) : (me - peer); // positive = good
};

const _meVal = (r)=> Number.isFinite(r?.me) ? r.me : (Number.isFinite(r?.playerAvg) ? r.playerAvg : NaN);
const _peerVal = (r)=> Number.isFinite(r?.peer) ? r.peer : (Number.isFinite(r?.fieldAvg) ? r.fieldAvg : NaN);

const allItems = [].concat(bySI||[], byPar||[], byYd||[]);
const withDelta = allItems
  .map(r=> ({...r, delta: Number.isFinite(r?.delta) ? r.delta : _deltaOfRow(r)}))
  .filter(r=>Number.isFinite(r.delta));

let bestItem = null;
let worstItem = null;

if (__effComparatorMode === "par") {
  // In Par mode, "strength" = lowest over-par; "leak" = highest over-par.
  const absRows = allItems
    .map(r=> ({...r, meAbs: _meVal(r)}))
    .filter(r=>Number.isFinite(r.meAbs));
  bestItem = absRows.slice().sort((a,b)=>a.meAbs-b.meAbs)[0] || null;
  worstItem = absRows.slice().sort((a,b)=>b.meAbs-a.meAbs)[0] || null;
} else {
  // Comparator modes: use oriented delta (positive = better).
  bestItem = withDelta.slice().sort((a,b)=>b.delta-a.delta)[0] || null;
  worstItem = withDelta.slice().sort((a,b)=>a.delta-b.delta)[0] || null;
}




  const htmlFragment = `
  <style>
    .PRr{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a}
    .PRh1{font-size:22px;font-weight:950;margin:0 0 6px}
    .PRsub{color:#475569;font-size:13px;margin:0 0 14px}
    .PRbox{border:1px solid #e5e7eb;border-radius:14px;padding:12px 14px;background:#fff}
    .PRgrid{display:grid;grid-template-columns:repeat(12,1fr);gap:12px}
    .PRsec{margin-top:14px}
    .PRsecTitle{font-weight:950;margin:0 0 8px;font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:#0f172a}
    .PRk{font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:.06em}
    .PRv{font-size:18px;font-weight:950;margin-top:4px}
    .PRp{margin:8px 0;color:#0f172a;line-height:1.35}
    .PRmuted{color:#475569}
    .PRtbl{width:100%;border-collapse:collapse;table-layout:fixed;font-variant-numeric:tabular-nums}
    .PRtbl col.c1{width:40%}
    .PRtbl col.c2,.PRtbl col.c3,.PRtbl col.c4,.PRtbl col.c5{width:15%}
    .PRtbl th,.PRtbl td{padding:8px 10px;border-bottom:1px solid #e5e7eb}
    /* --- Table "good vs bad" clarity --- */
    .PRtbl tbody tr.PRrow.good td{background:rgba(16,185,129,0.06)}
    .PRtbl tbody tr.PRrow.bad td{background:rgba(244,63,94,0.06)}
    .PRtbl tbody tr.PRrow.neu td{background:transparent}
    .PRtbl tbody tr.PRrow td:first-child{font-weight:900}
    .PRtbl tbody tr.PRrow:hover td{filter:brightness(0.99)}
    .PRdeltaBadge{display:inline-flex;align-items:center;gap:6px;justify-content:flex-end;padding:4px 8px;border-radius:9999px;border:1px solid #e5e7eb;font-weight:950}
    .PRdeltaBadge.good{border-color:rgba(16,185,129,0.35);background:rgba(16,185,129,0.10);color:#065f46}
    .PRdeltaBadge.bad{border-color:rgba(244,63,94,0.35);background:rgba(244,63,94,0.10);color:#9f1239}
    .PRdeltaBadge.neu{border-color:rgba(100,116,139,0.25);background:rgba(148,163,184,0.12);color:#334155}
    .PRarr{font-size:10px;opacity:0.9}
    .PRlegend{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 10px}
    .PRlegItem{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:9999px;border:1px solid #e5e7eb;font-size:11px;font-weight:900;color:#0f172a}
    .PRlegItem.good{border-color:rgba(16,185,129,0.30);background:rgba(16,185,129,0.08);color:#065f46}
    .PRlegItem.bad{border-color:rgba(244,63,94,0.30);background:rgba(244,63,94,0.08);color:#9f1239}
    .PRlegItem.neu{border-color:rgba(100,116,139,0.22);background:rgba(148,163,184,0.10);color:#334155}
    .PRlegDot{width:9px;height:9px;border-radius:9999px;background:currentColor;opacity:0.8}
    .PRlegNote{color:#475569;font-size:11px;font-weight:700}

    .PRtbl th:first-child,.PRtbl td:first-child{text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .PRtbl th:not(:first-child),.PRtbl td:not(:first-child){text-align:right}
    .PRnote{font-size:12px;color:#475569;margin-top:10px}
    .PRpill{display:inline-block;border:1px solid #e5e7eb;border-radius:999px;padding:3px 8px;font-size:12px;color:#0f172a;background:#fff}
  </style>

  <div class="PRr">
    <div class="PRh1">Season Report: ${PR_escapeHtml(playerName||"")}</div>
    <div class="PRsub">
      Benchmark: <b>${PR_escapeHtml(peerBand||"—")}</b>
      · <b>${PR_num(rounds,0)}</b> rounds
      · <b>${PR_num(holes,0)}</b> holes analysed
      <span class="PRpill" style="margin-left:8px;">${(String(scoringMode)==="gross" ? "Gross strokes" : "Stableford points")} vs ${(__effComparatorMode==="par" ? "Par baseline" : (__effComparatorMode==="field" ? "Field" : "Handicap band"))}</span>
      ${__effComparatorMode==="par" ? "" : `<span class="PRpill" style="margin-left:8px;">Peers: <b>${peerPlayersN}</b>${Number.isFinite(peerMin)&&Number.isFinite(peerMax)?` · Avg hcap range <b>${peerMin.toFixed(1)}–${peerMax.toFixed(1)}</b>`:""}</span>`}
    </div>

    <div class="PRbox PRsec">
      <div class="PRsecTitle">1. The Season Headline</div>
      <p class="PRp">
  ${__effComparatorMode==="par" ? `
    <b>Scoring vs Par:</b>
    You average <b>${Number.isFinite(youAvgPH)?youAvgPH.toFixed(2):"—"}</b> strokes over par per hole (≈ <b>${Number.isFinite(youAvgPH)?(youAvgPH*18).toFixed(1):"—"}</b> over par per 18 holes).
  ` : `
    <b>Net Performance vs Peers:</b>
    ${Number.isFinite(goodDeltaPH)
        ? (isGross
            ? (goodDeltaPH>=0
                ? `You average <b>${goodDeltaPH.toFixed(2)}</b> fewer strokes per hole than your peer group (≈ <b>${(goodDeltaPH*18).toFixed(1)}</b> fewer strokes per 18 holes).`
                : `You average <b>${Math.abs(goodDeltaPH).toFixed(2)}</b> more strokes per hole than your peer group (≈ <b>${(Math.abs(goodDeltaPH)*18).toFixed(1)}</b> more strokes per 18 holes).`
              )
            : (goodDeltaPH>=0
                ? `You score <b>${goodDeltaPH.toFixed(2)}</b> more Stableford points per hole than your peer group (≈ <b>${(goodDeltaPH*18).toFixed(1)}</b> more points per 18 holes).`
                : `You score <b>${Math.abs(goodDeltaPH).toFixed(2)}</b> fewer Stableford points per hole than your peer group (≈ <b>${(Math.abs(goodDeltaPH)*18).toFixed(1)}</b> fewer points per 18 holes).`
              )
          )
        : "—"
      }
  `}
</p>
      <p class="PRp">
  <b>Scoring Average:</b>
  ${__effComparatorMode==="par" ? `
    Your scoring average is <b>${Number.isFinite(youAvgPH)?youAvgPH.toFixed(2):"—"}</b> strokes over par per hole.
  ` : `
    ${isGross
      ? `Your scoring average is <b>${Number.isFinite(youAvgPH)?youAvgPH.toFixed(2):"—"}</b> strokes over par per hole, compared to a peer average of <b>${Number.isFinite(peerAvgPH)?peerAvgPH.toFixed(2):"—"}</b> over par.`
      : `Your scoring average is <b>${Number.isFinite(youAvgPH)?youAvgPH.toFixed(2):"—"}</b> Stableford points per hole (≈ <b>${Number.isFinite(youAvgPH)?(youAvgPH*18).toFixed(1):"—"}</b> points per 18 holes), compared to a peer average of <b>${Number.isFinite(peerAvgPH)?peerAvgPH.toFixed(2):"—"}</b> points per hole.`
    }
  `}
</p>
      <p class="PRp">
  <b>Scoring Profile:</b>
  ${__effComparatorMode==="par" ? `
    Birdie+ rate <b>${Number.isFinite(mixRpt?.birdiePlusRate)?(mixRpt.birdiePlusRate*100).toFixed(1)+"%":"—"}</b> ·
    Damage (Double+) <b>${Number.isFinite(mixRpt?.badRate)?(mixRpt.badRate*100).toFixed(1)+"%":"—"}</b>.
    <span class="PRmuted">Damage usually provides the biggest scoring lever in absolute terms.</span>
  ` : `
    Birdie+ rate <b>${Number.isFinite(mixRpt?.birdiePlusRate)?(mixRpt.birdiePlusRate*100).toFixed(1)+"%":"—"}</b> (Peers:
    <b>${Number.isFinite(peerMixRpt?.birdiePlusRate)?(peerMixRpt.birdiePlusRate*100).toFixed(1)+"%":"—"}</b>) ·
    Damage (Double+) <b>${Number.isFinite(mixRpt?.badRate)?(mixRpt.badRate*100).toFixed(1)+"%":"—"}</b> (Peers:
    <b>${Number.isFinite(peerMixRpt?.badRate)?(peerMixRpt.badRate*100).toFixed(1)+"%":"—"}</b>).
    ${Number.isFinite(mixRpt?.birdiePlusRate) && Number.isFinite(peerMixRpt?.birdiePlusRate) && Number.isFinite(mixRpt?.badRate) && Number.isFinite(peerMixRpt?.badRate)
      ? ((Math.abs((mixRpt.birdiePlusRate-peerMixRpt.birdiePlusRate)*100) < 2.0) && ((mixRpt.badRate-peerMixRpt.badRate)*100 !== 0)
          ? "<span class=\"PRmuted\">This indicates that your net performance vs peers is driven more by Damage (double+) frequency than by Birdie+ frequency.</span>"
          : " "
        )
      : " "
    }
  `}
</p>
      <div class="PRnote">All values are based on ${(String(scoringMode)==="gross" ? "gross strokes" : "Stableford points")}, benchmarked against the selected comparator (${(__effComparatorMode==="par" ? "Par baseline" : (__effComparatorMode==="field" ? "Field" : "Handicap band"))}).</div>
    </div>

    <div class="PRbox PRsec">
      <div class="PRsecTitle">2. Performance Insights</div>
      <p class="PRp">
        <b>Primary Strength:</b>
        ${__effComparatorMode==="par" ? `
          Your best scoring is in <b>${PR_escapeHtml((bestItem?.label||bestItem?.key||"—"))}</b>, where you average <b>${Number.isFinite(_meVal(bestItem))?_meVal(bestItem).toFixed(2):"—"}</b> strokes over par per hole.
        ` : `
          Your biggest advantage is in <b>${PR_escapeHtml((bestItem?.label||bestItem?.key||"—"))}</b>, where you gain <b>${Number.isFinite(bestItem?.delta)?bestItem.delta.toFixed(2):"—"}</b> strokes per hole over peers.
        `}
      </p>
      <p class="PRp">
        <b>The Focus Leak:</b>
        ${__effComparatorMode==="par" ? `
          Your worst scoring is in <b>${PR_escapeHtml((worstItem?.label||worstItem?.key||"—"))}</b>, where you average <b>${Number.isFinite(_meVal(worstItem))?_meVal(worstItem).toFixed(2):"—"}</b> strokes over par per hole.
        ` : `
          Your primary area for improvement is <b>${PR_escapeHtml((worstItem?.label||worstItem?.key||"—"))}</b>, costing <b>${Number.isFinite(worstItem?.delta)?worstItem.delta.toFixed(2):"—"}</b> strokes per hole compared to your handicap cohort.
        `}
      </p>
      <p class="PRp">
  <b>Biggest Stroke Lever:</b>
  ${__effComparatorMode==="par" ? `
    Damage (double+) occurs <b>${Number.isFinite(mixRpt?.badRate)?(mixRpt.badRate*100).toFixed(1)+"%":"—"}</b> of the time. Cutting big numbers is usually the fastest way to lower your over‑par scoring.
  ` : `
    ${(()=>{
      if(!Number.isFinite(mixRpt?.badRate) || !Number.isFinite(peerMixRpt?.badRate)) return "—";
      const youBad = mixRpt.badRate, peerBad = peerMixRpt.badRate;
      const diffPct = (peerBad - youBad)*100; // positive = good
      const moreLess = diffPct>=0 ? "less often" : "more often";
      const absPct = Math.abs(diffPct);
      const youPct = (youBad*100).toFixed(1), peerPct=(peerBad*100).toFixed(1);
      const holesPer18 = (absPct/100)*18;
      const holesWord = diffPct>=0 ? "fewer" : "more";
      const strokesWord = diffPct>=0 ? "saved" : "lost";
      return `Damage (double+) occurs <b>${absPct.toFixed(1)}% ${moreLess}</b> than peers (${youPct}% vs ${peerPct}%), equivalent to ~<b>${holesPer18.toFixed(1)}</b> ${holesWord} damage holes per 18 (strokes typically ${strokesWord} are meaningful).`;
    })()}
  `}
</p>
    </div>

    <div class="PRbox PRsec">
      <div class="PRsecTitle">3. The Evidence Locker</div>
      <div class="PRmuted" style="font-size:13px;margin-bottom:10px;">Raw peer-benchmarked tables used for the insights above.</div>

      <div style="margin-top:10px;font-weight:900;">By Stroke Index</div>
      ${PR_renderTableBare(bySI, scoringMode, __effComparatorMode)}

      <div style="margin-top:14px;font-weight:900;">By Par Type</div>
      ${PR_renderTableBare(byPar, scoringMode, __effComparatorMode)}

      <div style="margin-top:14px;font-weight:900;">By Yardage</div>
      ${PR_renderTableBare(byYd, scoringMode, __effComparatorMode)}
    </div>
  </div>
  `;

  return { ok:true, htmlFragment, html: htmlFragment, filename: `SeasonReport_${PR_safeSlug(playerName||'player')}.html` };

}

function PR_downloadHtmlFile(filename, html){
  try{
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "SeasonReport.html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
  }catch(e){
    try{ console.error(e); }catch(_){}
    alert("Could not generate report.");
  }
}


function PlayerReportView({ seasonModel, reportNextHcapMode, setReportNextHcapMode, scoringMode, setScoringMode, seasonPlayer, setSeasonPlayer, seasonYear, setSeasonYear, seasonLimit, setSeasonLimit, seasonYears, setView, autoOpenQA, onAutoOpenQADone }) {
  // --- 1. Basic Hooks & State ---
  const [deepDiveView, setDeepDiveView] = React.useState(() => {
    try {
      const v = localStorage.getItem("dsl_lens") || "pointsField";
      if (v === "pointsField") return "ptsField";
      if (v === "strokesField" || v === "strokesPar") return v;
      return "ptsField";
    } catch(e) { return "ptsField"; }
  }); // "ptsField" | "strokesField" | "strokesPar"
  const deepDiveScoringMode = (deepDiveView === "ptsField") ? "stableford" : "gross";
  // Comparator mode (field / handicap band / par) should follow Overview (single source of truth).
  const __getOverviewComparator = () => {
    try{
      const snap = (window && window.__dslOverviewReport) ? window.__dslOverviewReport : null;
      const cm = snap ? String(snap.comparatorMode || "") : "";
      if (cm === "field" || cm === "band" || cm === "par") return cm;
      const ui = (window && window.__dslUiState) ? window.__dslUiState : null;
      const uiC = ui ? String(ui.cohortMode || "") : "";
      if (uiC === "field" || uiC === "band") return uiC;
    }catch(e){}
    return "field";
  };
  const [deepDiveComparatorMode, setDeepDiveComparatorMode] = React.useState(() => __getOverviewComparator());
  React.useEffect(() => {
    const syncComp = () => {
      const next = __getOverviewComparator();
      setDeepDiveComparatorMode(prev => (prev === next ? prev : next));
    };
    window.addEventListener("dsl_overview_report_change", syncComp);
    window.addEventListener("storage", syncComp);
    return () => {
      window.removeEventListener("dsl_overview_report_change", syncComp);
      window.removeEventListener("storage", syncComp);
    };
  }, []);
  const deepDiveComparisonMode = (deepDiveView === "strokesPar") ? "par" : deepDiveComparatorMode;

  // Keep report tabs (Overview / Insights / Plan) in sync with the global Lens selector
  React.useEffect(() => {
    const sync = () => {
      try {
        const v = localStorage.getItem("dsl_lens") || "pointsField";
        const mapped = (v === "pointsField") ? "ptsField" : v;
        if (mapped && (mapped === "ptsField" || mapped === "strokesField" || mapped === "strokesPar")) {
          setDeepDiveView(prev => (prev === mapped ? prev : mapped));
        }
      } catch(e) {}
    };
    window.addEventListener("dsl_lens_change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("dsl_lens_change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);


  // Lens alias for unified terminology across Overview / Insights / Plan
  // deepDiveView uses: "ptsField" | "strokesField" | "strokesPar"
  // UI elsewhere expects: "pointsField" | "strokesField" | "strokesPar"
  const ppBarsMode = (deepDiveView === "ptsField") ? "pointsField" : deepDiveView;
  const setPpBarsMode = (v) => setDeepDiveView(v === "pointsField" ? "ptsField" : v);


  // Report-only handicap preview mode (independent of leaderboard)

  const [deepDiveMetric, setDeepDiveMetric] = React.useState("round");
  const [controlsOpen, setControlsOpen] = React.useState(false);
  const [qaOpen, setQaOpen] = React.useState(false);

  // Deep-link scrolling
  React.useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.location && window.location.hash === "#practice") {
        setTimeout(() => {
          const el = document.getElementById("practice-ideas");
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
      }
    } catch (e) {}
  }, []);

  // --- 2. Data Preparation ---
  const model = seasonModel || {};
  const players = Array.isArray(model.players) ? model.players : [];
  const field = model.field || {};
  const current = players.find(p => (p?.name || "") === (seasonPlayer || "")) || players[0] || null;
  const peerPlayers = players.filter(p => p && p.name && !(typeof isTeamLike === "function" && isTeamLike(p.name)));
  const peerPlayersNoMe = React.useMemo(() => peerPlayers.filter(p => p && p.name && p.name !== (current?.name || "")), [peerPlayers, current?.name]);
  const peerN = peerPlayers.length || 0;
  const allPlayers = (peerPlayers.length ? peerPlayers : players).slice().sort((a,b)=>String(a?.name||"").localeCompare(String(b?.name||"")));
  
  
  // Peer-group benchmark field (reduces skew when high handicaps are in the field)
  const benchField = React.useMemo(() => {
    // If we don't have a current player, fall back to overall field
    if (!current) return field || {};
    const myGrp = (typeof rangeForHcap === "function") ? rangeForHcap(_hcapOf(current)) : "all";
    const peers = (allPlayers || []).filter(p => {
      try { return (typeof rangeForHcap === "function") ? rangeForHcap(_hcapOf(p)) === myGrp : true; }
      catch (e) { return false; }
    });
    // Fallback to overall field if peer slice is too small
    if (!peers.length) return field || {};
    const sumAggMaps = (pls, key) => {
      const out = {};
      (pls || []).forEach(p => {
        const mp = p?.[key] || {};
        Object.keys(mp).forEach(k => {
          const a = mp[k] || {};
          const holes = PR_num(a?.holes, PR_num(a?.h, 0));
          const val = PR_num(a?.val, PR_num(a?.sum, 0));
          if (!Number.isFinite(holes) || holes <= 0) return;
          if (!out[k]) out[k] = { holes: 0, val: 0 };
          out[k].holes += holes;
          out[k].val += (Number.isFinite(val) ? val : 0);
        });
      });
      return out;
    };
    return {
      byPar: sumAggMaps(peers, "byPar"),
      bySI: sumAggMaps(peers, "bySI"),
      byYards: sumAggMaps(peers, "byYards"),
      byParGross: sumAggMaps(peers, "byParGross"),
      bySIGross: sumAggMaps(peers, "bySIGross"),
      byYardsGross: sumAggMaps(peers, "byYardsGross"),
    };
  }, [current, field, allPlayers]);
const games = PR_num(current?.rounds, 0);
  const holes = 18;
  const titleBits = [];
  if (seasonYear && String(seasonYear).toLowerCase() !== "all") titleBits.push(String(seasonYear));
  if (seasonLimit && String(seasonLimit).toLowerCase() !== "all") titleBits.push(`Last ${seasonLimit}`);
  const scopeLabel = titleBits.length ? titleBits.join(" · ") : "All games";

  // --- 3. Helper Functions Definition ---
  // (Defined first so they can be used by calculated variables below)

  const _seriesSorted = (p) => {
    const s = Array.isArray(p?.series) ? p.series.slice() : [];
    s.sort((a,b)=> (Number(a.dateMs)||Number(a.idx)||0) - (Number(b.dateMs)||Number(b.idx)||0));
    return s;
  };

  const _latestOrAvg = (arr, useLatest) => {
    const a = Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : [];
    if (!a.length) return NaN;
    return useLatest ? a[a.length - 1] : (a.reduce((s,v)=>s+v,0) / a.length);
  };

  const _avgPtsPH = (agg) => (agg && agg.holes ? (Number(agg.pts) / Number(agg.holes)) : NaN);
  const _wipeRate = (agg) => (agg && agg.holes ? (Number(agg.wipes) / Number(agg.holes)) : NaN);
  const _blobsPR  = (agg) => {
    const wr = _wipeRate(agg);
    return Number.isFinite(wr) ? (wr * 18) : NaN;
  };

  const _stdev = (arr) => {
    const a = (arr||[]).filter(Number.isFinite);
    if (a.length < 3) return NaN;
    const mean = a.reduce((s,v)=>s+v,0)/a.length;
    const varr = a.reduce((s,v)=>s+Math.pow(v-mean,2),0)/(a.length-1);
    return Math.sqrt(varr);
  };

  const _volatilityFromSeries = (modeKey, p) => {
    const s = _seriesSorted(p);
    const vals = (modeKey==="gross") ? s.map(x=>PR_num(x.gross, NaN)) : s.map(x=>PR_num(x.pts, NaN));
    return _stdev(vals);
  };

  const _velocityFromSeries = (modeKey, p) => {
    const s = _seriesSorted(p);
    if (typeof _slope !== "function") return NaN; 
    const vals = (modeKey==="gross") ? s.map(x=>PR_num(x.gross, NaN)) : s.map(x=>PR_num(x.pts, NaN));
    const sl = _slope(vals);
    if (!Number.isFinite(sl)) return NaN;
    return modeKey==="gross" ? (-sl) : sl;
  };

  const _fieldVolatilityAvg = (modeKey) => {
    const vals = peerPlayersNoMe.map(p => _volatilityFromSeries(modeKey, p)).filter(Number.isFinite);
    return vals.length ? (vals.reduce((s,v)=>s+v,0)/vals.length) : NaN;
  };

  const _fieldVelocityAvg = (modeKey) => {
    const vals = peerPlayersNoMe.map(p => {
      const m = p?.metrics || {};
      if (modeKey === "gross") return PR_num(m.grossVelocity, NaN);
      return PR_num(m.velocity, NaN);
    }).filter(Number.isFinite);
    return vals.length ? (vals.reduce((s,v)=>s+v,0)/vals.length) : NaN;
  };

  const _fieldVelocityAvg2 = (modeKey) => {
    const vals = peerPlayersNoMe.map(p => _velocityFromSeries(modeKey, p)).filter(Number.isFinite);
    return vals.length ? (vals.reduce((s,v)=>s+v,0)/vals.length) : NaN;
  };

  const _rankPosition = (modeKey, useLatest) => {
    const list = peerPlayers.map(p => {
      const s = _seriesSorted(p);
      const last = s[s.length-1] || {};
      const value = (modeKey === "gross")
        ? (Number.isFinite(PR_num(last.gross, NaN)) ? PR_num(last.gross, NaN) : PR_num(p?.metrics?.avgGross, NaN))
        : (Number.isFinite(PR_num(last.pts, NaN)) ? PR_num(last.pts, NaN) : _latestOrAvg(p?.series?.map(x=>x.pts), useLatest));
      const avgValue = (modeKey === "gross")
        ? PR_num(p?.metrics?.avgGross, NaN)
        : _latestOrAvg(_seriesSorted(p).map(x=>x.pts), false);
      return { name: p?.name, v: useLatest ? value : avgValue };
    }).filter(x => Number.isFinite(x.v));

    const sorted = list.sort((a,b) => modeKey === "gross" ? (a.v - b.v) : (b.v - a.v));
    const sCur = _seriesSorted(current);
    const lastCur = sCur[sCur.length-1] || {};
    // const curV = ... (unused in return, simplified)
    const idx = sorted.findIndex(x => x.name === current?.name);
    const pos = idx >= 0 ? (idx + 1) : NaN;
    return { pos, total: sorted.length || peerN || 0 };
  };

  // --- 4. Calculated Variables (Order Critical: Define Dependencies First) ---

  // 4a. Playing Handicap Calculation
  const _playingHcap = (() => {
    const s = _seriesSorted(current);
    const last = s[s.length-1] || {};
    const v = PR_num(last.hcap, PR_num(current?.playingHcap, PR_num(current?.startExact, PR_num(current?.handicap, PR_num(current?.metrics?.avgHcap, NaN)))));
    return Number.isFinite(v) ? Math.round(v) : 0;
  })();

  // 4b. Front/Back Calculation
  const frontBack = (() => {
    const s = current?.series || [];
    const avg = (arr) => (arr.reduce((p, c) => p + c, 0) / arr.length);
    if (!s.length) return { front: NaN, back: NaN, diff: NaN };
    if (String(scoringMode) === "gross") {
      const f = s.map(x => PR_num(x.frontGross, NaN)).filter(Number.isFinite);
      const b = s.map(x => PR_num(x.backGross, NaN)).filter(Number.isFinite);
      if (!f.length || !b.length) return { front: NaN, back: NaN, diff: NaN };
      const fAvg = avg(f) / 9;
      const bAvg = avg(b) / 9;
      return { front: fAvg, back: bAvg, diff: fAvg - bAvg };
    } else {
      const f = s.map(x => PR_num(x.frontPts, NaN)).filter(Number.isFinite);
      const b = s.map(x => PR_num(x.backPts, NaN)).filter(Number.isFinite);
      if (!f.length || !b.length) return { front: NaN, back: NaN, diff: NaN };
      const fAvg = avg(f) / 9;
      const bAvg = avg(b) / 9;
      return { front: fAvg, back: bAvg, diff: fAvg - bAvg };
    }
  })();

  // 4c. Strength/Weakness Logic
  const _strengthWeakness = (modeKey) => {
    const sp = modeKey === "gross" ? "gross" : "stableford";

    const rPar = PR_buildRawRows({
      scoringMode: sp,
      dim: "Par",
      mapObj: sp === "gross" ? current?.byParGross : current?.byPar,
      fieldObj: sp === "gross" ? benchField?.byParGross : field?.byPar
    });

    const rSI = PR_buildRawRows({
      scoringMode: sp,
      dim: "SI",
      mapObj: sp === "gross" ? current?.bySIGross : current?.bySI,
      fieldObj: sp === "gross" ? benchField?.bySIGross : benchField?.bySI,
      limit: 6
    });

    const rYd = PR_buildRawRows({
      scoringMode: sp,
      dim: "Yd",
      mapObj: sp === "gross" ? current?.byYardsGross : current?.byYards,
      fieldObj: sp === "gross" ? benchField?.byYardsGross : benchField?.byYards,
      limit: 8
    });

    const all = [...rPar, ...rSI, ...rYd];

    const ext = PR_pickExtremes(sp, all, 2);

    const worstWeighted = [
      PR_pickWorstWeighted(sp, rPar),
      PR_pickWorstWeighted(sp, rSI),
      PR_pickWorstWeighted(sp, rYd)
    ].filter(Boolean).sort((a,b)=>a.perRound-b.perRound)[0] || null;

    const _weightRows = (rows) => {
      const rr = Array.isArray(rows) ? rows : [];
      const totalH = rr.reduce((a,r)=>a + (PR_num(r?.holes,0) || 0), 0) || 0;
      if (!totalH) return [];
      return rr.map(r=>{
        const d = PR_goodDelta(sp, r.playerAvg, r.fieldAvg);
        const holes = PR_num(r?.holes,0);
        if (!Number.isFinite(d) || !holes) return null;
        const exposure = (holes / totalH) * 18;
        return { ...r, delta: d, perRound: d * exposure };
      }).filter(Boolean).filter(r => (r.holes||0) >= 4 && Number.isFinite(r.perRound));
    };

    const weightedAll = [..._weightRows(rPar), ..._weightRows(rSI), ..._weightRows(rYd)];
    const strengthsRound = weightedAll.slice().sort((a,b)=>b.perRound-a.perRound).slice(0,2);
    const leaksRound = weightedAll.slice().sort((a,b)=>a.perRound-b.perRound).slice(0,2);
    const hurting = weightedAll.filter(x => x.perRound < 0).sort((a,b)=>a.perRound-b.perRound); // Worst first

    return { strengths: ext.strengths || [], leaks: ext.leaks || [], strengthsRound, leaksRound, worstWeighted, hurting };
  };

  // 4d. Summary Facts (Relies on _playingHcap, frontBack, etc.)
  const _summaryFacts = (modeKey) => {
    const useLatest = (games === 1);
    const rank = _rankPosition(modeKey, useLatest);

    if (modeKey === "stableford") {
      const sCur = _seriesSorted(current);
      const ptsNow = useLatest ? PR_num((sCur[sCur.length-1]||{}).pts, NaN) : _latestOrAvg(sCur.map(x=>x.pts), false);
      const ptsField = useLatest
        ? _latestOrAvg(peerPlayersNoMe.map(p => (_seriesSorted(p).slice(-1)[0]||{}).pts), true)
        : _latestOrAvg(peerPlayersNoMe.map(p => _latestOrAvg(_seriesSorted(p).map(x=>x.pts), false)), false);

      const delta36 = Number.isFinite(ptsNow) ? (ptsNow - 36) : NaN;
      const playingToHcp = Number.isFinite(delta36) ? (_playingHcap - delta36) : NaN;

      const blobsYou = _blobsPR(current?.totals);
      const blobsField = (() => {
        const vals = peerPlayersNoMe.map(p => _blobsPR(p?.totals)).filter(Number.isFinite);
        return vals.length ? (vals.reduce((s,v)=>s+v,0) / vals.length) : NaN;
      })();
      const blobsDelta = (Number.isFinite(blobsYou) && Number.isFinite(blobsField)) ? (blobsYou - blobsField) : NaN;

      const p3 = _avgPtsPH(current?.byPar?.["Par 3"]); const f3 = _avgPtsPH(field?.byPar?.["Par 3"]);
      const p4 = _avgPtsPH(current?.byPar?.["Par 4"]); const f4 = _avgPtsPH(field?.byPar?.["Par 4"]);
      const p5 = _avgPtsPH(current?.byPar?.["Par 5"]); const f5 = _avgPtsPH(field?.byPar?.["Par 5"]);

      const fb = PR_num(current?.metrics?.fb, NaN); 
      const vel = _velocityFromSeries("stableford", current);
      const velField = Number.isFinite(_fieldVelocityAvg("stableford")) ? _fieldVelocityAvg("stableford") : _fieldVelocityAvg2("stableford");
      const vol = _volatilityFromSeries("stableford", current);
      const volField = _fieldVolatilityAvg("stableford");

      const sw = _strengthWeakness("stableford");

      return { ptsNow, ptsField, rank, delta36, playingToHcp, blobsYou, blobsField, blobsDelta, p3, f3, p4, f4, p5, f5, fb, vel, velField, vol, volField, sw };
    }

    // gross
    const gPH = PR_avgGross(current?.totalsGross);
    const gPR = Number.isFinite(gPH) ? (gPH * 18) : NaN;
    const gPRf = (() => {
      const vals = peerPlayersNoMe.map(p => {
        const ph = PR_avgGross(p?.totalsGross);
        return Number.isFinite(ph) ? (ph * 18) : NaN;
      }).filter(Number.isFinite);
      return vals.length ? (vals.reduce((s,v)=>s+v,0)/vals.length) : NaN;
    })();

    const netPH = PR_avgGross(current?.totalsNet);
    const netPR = Number.isFinite(netPH) ? (netPH * 18) : NaN;
    const playingToHcp = Number.isFinite(netPR) ? (_playingHcap + netPR) : NaN;

    const p3 = PR_avgGross(current?.byParGross?.["Par 3"]); const f3 = PR_avgGross(benchField?.byParGross?.["Par 3"]);
    const p4 = PR_avgGross(current?.byParGross?.["Par 4"]); const f4 = PR_avgGross(benchField?.byParGross?.["Par 4"]);
    const p5 = PR_avgGross(current?.byParGross?.["Par 5"]); const f5 = PR_avgGross(benchField?.byParGross?.["Par 5"]);

    const vel = _velocityFromSeries("gross", current);
    const velField = Number.isFinite(_fieldVelocityAvg("gross")) ? _fieldVelocityAvg("gross") : _fieldVelocityAvg2("gross");
    const vol = _volatilityFromSeries("gross", current);
    const volField = _fieldVolatilityAvg("gross");

    const sw = _strengthWeakness("gross");

    // Recalc Front/Back simple diff just for stats
    const fbDiff = frontBack.diff;

    return { gPR, gPRf, rank, netPR, playingToHcp, p3, f3, p4, f4, p5, f5, fb: fbDiff, vel, velField, vol, volField, sw };
  };

  // Execute Facts
  const stableFacts = _summaryFacts("stableford");
  const grossFacts  = _summaryFacts("gross");

  let overallVsFieldPerRound = NaN;
  {
    const factsOverall = (scoringMode === "gross") ? grossFacts : stableFacts;
    overallVsFieldPerRound = (scoringMode === "gross")
      ? (Number.isFinite(factsOverall?.gPRf) && Number.isFinite(factsOverall?.gPR) ? (factsOverall.gPRf - factsOverall.gPR) : NaN)
      : (Number.isFinite(factsOverall?.ptsNow) && Number.isFinite(factsOverall?.ptsField) ? (factsOverall.ptsNow - factsOverall.ptsField) : NaN);
  }

  // --- Render Helpers (for SI hints) ---
  const _siBandHolesByCourse = (player, bandKey, max=3) => {
    const series = Array.isArray(player?.series) ? player.series : [];
    const norm = String(bandKey || "").replace("–","-").trim();
    const parts = norm.split("-");
    const lo = Number(parts[0]);
    const hi = Number(parts[1]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
    const groups = {};
    series.forEach(s => {
      const course = (s?.courseName || "").toString().trim();
      const tee = (s?.teeName || "").toString().trim();
      const gen = (s?.teeGender || "").toString().trim();
      if (!course && !tee) return;
      const k = `${course}||${tee}||${gen}`;
      (groups[k] ||= []).push(s);
    });
    const rows = Object.values(groups).map(arr => {
      const n = arr.length || 0;
      if (n < 2) return null;
      const siArr = arr.find(x => Array.isArray(x?.siArr) && x.siArr.length >= 18)?.siArr;
      if (!siArr) return null;
      const holes = [];
      for (let i = 0; i < 18; i++) {
        const si = PR_num(siArr[i], NaN);
        if (Number.isFinite(si) && si >= lo && si <= hi) holes.push(i + 1);
      }
      if (!holes.length) return null;
      const sample = arr[0] || {};
      return { rounds: n, courseName: sample.courseName || "", teeName: sample.teeName || "", holes };
    }).filter(Boolean).sort((a, b) => (b.rounds || 0) - (a.rounds || 0));
    return rows.slice(0, Math.max(1, Number(max)||3));
  };

  const _extractRangeKey = (s) => {
    const t = String(s || "").replace("–","-");
    const m1 = t.match(/(\d+)\s*-\s*(\d+)/);
    if (m1) return `${m1[1]}-${m1[2]}`;
    const m2 = t.match(/(\d+)\s*\+/);
    if (m2) return `${m2[1]}+`;
    return "";
  };

  const _yardageBandHolesByCourse = (player, bandKey, max=3) => {
    const series = Array.isArray(player?.series) ? player.series : [];
    const norm = String(bandKey || "").replace("–","-").trim();
    let lo = NaN, hi = NaN;
    if (/\+$/.test(norm)) { lo = Number(norm.replace("+","")); hi = Infinity; }
    else { const parts = norm.split("-"); lo = Number(parts[0]); hi = Number(parts[1]); }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
    const groups = {};
    series.forEach(s => {
      const course = (s?.courseName || "").toString().trim();
      const tee = (s?.teeName || "").toString().trim();
      const gen = (s?.teeGender || "").toString().trim();
      if (!course && !tee) return;
      const k = `${course}||${tee}||${gen}`;
      (groups[k] ||= []).push(s);
    });
    const rows = Object.values(groups).map(arr => {
      const n = arr.length || 0;
      if (n < 2) return null;
      const sample = arr.find(x => Array.isArray(x?.yardsArr) && x.yardsArr.length >= 18) || arr[0] || {};
      const yardsArr = Array.isArray(sample?.yardsArr) ? sample.yardsArr : null;
      if (!yardsArr || yardsArr.length < 18) return null;
      const holes = [];
      for (let i = 0; i < 18; i++) {
        const y = Number(yardsArr[i]);
        if (!Number.isFinite(y)) continue;
        if (y >= lo && (hi === Infinity ? true : y <= hi)) holes.push(i + 1);
      }
      if (!holes.length) return null;
      return { rounds: n, courseName: sample.courseName || "", teeName: sample.teeName || "", holes };
    }).filter(Boolean).sort((a, b) => (b.rounds || 0) - (a.rounds || 0));
    return rows.slice(0, Math.max(1, Number(max)||3));
  };

  const _renderSiHoleHint = (row, player) => {
    if (!row || !player) return null;
    const label = (row.label || "").toString().trim();
    let list = [];
    if (/^SI\s/i.test(label)) {
      const bandKey = (row.key || "").toString();
      list = _siBandHolesByCourse(player, bandKey, 2);
    } else {
      const maybeBand = _extractRangeKey(row.key || "") || _extractRangeKey(label);
      const isYardRow = /^Yardage\b/i.test(label) || /^Yards\b/i.test(label) || (!!maybeBand && !/^SI\s/i.test(label));
      if (isYardRow && maybeBand) list = _yardageBandHolesByCourse(player, maybeBand, 2);
    }
    if (!list.length) return null;
    return (
      <div className="mt-0.5 space-y-0.5">
        {list.map((g, j) => (
          <div key={j} className="text-[11px] text-neutral-500">
            {(g.courseName ? g.courseName : "Course")}{g.teeName ? ` · ${g.teeName}` : ""} ({g.rounds || 0} rds): holes {Array.isArray(g.holes) ? g.holes.join(", ") : ""}
          </div>
        ))}
      </div>
    );
  };

  const _normKeyPR = (s) => String(s || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const _bestCourseTeeGroup = (series) => {
    const groups = new Map();
    for (const r of (series || [])) {
      const courseKey = _normKeyPR(r?.courseName || r?.course || r?.courseLabel || r?.course_name || r?.venue || r?.venueName || r?.club || r?.clubName || r?.location);
      const teeKey = _normKeyPR(r?.teeName || r?.tee || r?.teeMatched || r?.teeLabel || r?.teeColour || r?.teeColor || r?.tees || r?.tee_name);
      const genderKey = _normKeyPR(r?.teeGender || r?.gender || r?.teeSex);
      if (!courseKey || !teeKey) continue;
      const key = `${courseKey}|${teeKey}|${genderKey}`;
      const cur = groups.get(key) || { key, courseName: (r?.courseName || "").toString(), teeName: (r?.teeName || r?.teeMatched || r?.teeLabel || "").toString(), teeGender: (r?.teeGender || "").toString(), rounds: [] };
      cur.rounds.push(r);
      groups.set(key, cur);
    }
    const arr = Array.from(groups.values());
    arr.sort((a, b) => (b.rounds.length || 0) - (a.rounds.length || 0));
    return { best: arr[0] || null, groups: arr };
  };

  // --- 5. Final Data Assembly & QA Data ---
  const _seriesPR = _seriesSorted(current);
  const _latestPR = _seriesPR.length ? _seriesPR[_seriesPR.length - 1] : null;
  const _courseLabelPR = _latestPR ? [(_latestPR.courseName||""), (_latestPR.teeName||"")].filter(Boolean).join(" — ") : "";
  const _holesPR = _latestPR ? UX_holesForSeriesItem(_latestPR) : 18;
  const _parsPR = (_latestPR && (Array.isArray(_latestPR.parsArr) ? _latestPR.parsArr : (Array.isArray(_latestPR.pars) ? _latestPR.pars : null))) || new Array(18).fill(NaN);
  const _ptsLatestPR = (_latestPR?.perHole || []).slice(0, _holesPR).map(v => Number.isFinite(Number(v)) ? Number(v) : NaN);
  const _grossLatestPR = (_latestPR?.grossPerHole || []).slice(0, _holesPR).map(v => Number.isFinite(Number(v)) ? Number(v) : NaN);
  const _imputedLatestPR = (_latestPR?.imputedMask || []).slice(0, _holesPR).map(v => !!v);
  const _heatPtsPR = (scoringMode === "gross") ? _grossLatestPR : _ptsLatestPR;
  const _heatImputedPR = (scoringMode === "gross") ? _imputedLatestPR : null;

  const trendSlope = scoringMode === "gross" ? PR_num(current?.metrics?.grossVelocity, NaN) : PR_num(current?.metrics?.velocity, NaN);
  const volatility = scoringMode === "gross" ? PR_num(current?.metrics?.volGross, NaN) : PR_num(current?.metrics?.volPts, NaN);
  const fieldVolatility = scoringMode === "gross" ? PR_num(field?.metrics?.volGross, NaN) : PR_num(field?.metrics?.volPts, NaN);
  const fieldVelocity = scoringMode === "gross" ? PR_num(field?.metrics?.grossVelocity, NaN) : PR_num(field?.metrics?.velocity, NaN);

  // Problem Hole Logic
  const problemHolePack = React.useMemo(() => {
    const s = _seriesSorted(current);
    const { best, groups } = _bestCourseTeeGroup(s);
    if (!best || (best.rounds.length || 0) < 2) return { ok: false, reason: "need_2_rounds", groups };
    const sums = Array(18).fill(0);
    const ns = Array(18).fill(0);
    for (const r of best.rounds) {
      const ph = Array.isArray(r?.perHole) ? r.perHole : null;
      if (!ph) continue;
      for (let i = 0; i < holes; i++) {
        const v = Number(ph[i]);
        if (Number.isFinite(v)) { sums[i] += v; ns[i] += 1; }
      }
    }
    const avgs = sums.map((s, i) => (ns[i] ? s / ns[i] : NaN));
    const overall = (() => { const vals = avgs.filter(Number.isFinite); return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN; })();
    const rows = avgs.map((a, i) => ({ hole: i + 1, avg: a, samples: ns[i], diff: Number.isFinite(a) && Number.isFinite(overall) ? a - overall : NaN })).filter((r) => Number.isFinite(r.avg) && r.samples > 0 && Number.isFinite(r.diff)).sort((a, b) => a.diff - b.diff);
    const threshold = -0.5;
    let flagged = rows.filter((r) => r.diff <= threshold);
    if (flagged.length < 3) flagged = rows.slice(0, Math.min(3, rows.length));
    flagged = flagged.slice(0, 6);
    const flaggedSet = new Set(flagged.map((r) => r.hole));
    return { ok: true, group: best, overall, rows, flagged, flaggedSet };
  }, [current, holes]);

  // Raw Rows
  const rawPar = PR_buildRawRows({ scoringMode, dim: "Par", mapObj: scoringMode === "gross" ? current?.byParGross : current?.byPar, fieldObj: scoringMode === "gross" ? benchField?.byParGross : field?.byPar });
  const rawSI  = PR_buildRawRows({ scoringMode, dim: "SI",  mapObj: scoringMode === "gross" ? current?.bySIGross : current?.bySI,   fieldObj: scoringMode === "gross" ? benchField?.bySIGross : benchField?.bySI, limit: 6 });
  const rawYd  = PR_buildRawRows({ scoringMode, dim: "Yd",  mapObj: scoringMode === "gross" ? current?.byYardsGross : current?.byYards, fieldObj: scoringMode === "gross" ? benchField?.byYardsGross : benchField?.byYards, limit: 12 });


  const parExt = PR_pickExtremes(scoringMode, rawPar, 1);
  const siExt  = PR_pickExtremes(scoringMode, rawSI, 1);
  const ydExt  = PR_pickExtremes(scoringMode, rawYd, 1);
  const strengths = [...parExt.strengths.map(x=>({...x, dim:"Par"})), ...siExt.strengths.map(x=>({...x, dim:"SI"})), ...ydExt.strengths.map(x=>({...x, dim:"Yard"}))].sort((a,b)=>b.delta-a.delta);
  const leaks     = [...parExt.leaks.map(x=>({...x, dim:"Par"})), ...siExt.leaks.map(x=>({...x, dim:"SI"})), ...ydExt.leaks.map(x=>({...x, dim:"Yard"}))].sort((a,b)=>a.delta-b.delta);
  const superPower = strengths[0] || { label: "—", delta: NaN };
  
  const parWorst = PR_pickWorstWeighted(scoringMode, rawPar, games);
  const siWorst  = PR_pickWorstWeighted(scoringMode, rawSI, games);
  const ydWorst  = PR_pickWorstWeighted(scoringMode, rawYd, games);
  const kryptonite = [
    parWorst && { ...parWorst, dim: "Par" },
    siWorst  && { ...siWorst,  dim: "SI"  },
    ydWorst  && { ...ydWorst,  dim: "Yard"}
  ].filter(Boolean).sort((a,b)=>a.perRound-b.perRound)[0] || { label: "—", delta: NaN, perRound: NaN };

  const coachTip = (() => {
    if (!kryptonite.label || kryptonite.label === "—") return "Keep collecting data to find your edge.";
    const vRound = Math.abs(Number.isFinite(kryptonite.perRound) ? kryptonite.perRound : kryptonite.delta);
    const u = scoringMode === "gross" ? "strokes" : "pts";
    if (kryptonite.dim === "Par") return `Your ${kryptonite.label} scoring is costing about ${PR_fmt(vRound,2)} ${u} per round. Aim more conservatively.`;
    return `Focus on ${kryptonite.label}. That bucket is costing about ${PR_fmt(vRound,2)} ${u} per round.`;
  })();

  const qaData = React.useMemo(() => {
    if (!current) return null;
    const avgPts = stableFacts?.ptsNow;
    const avgStr = current?.metrics?.avgGross; 
    const hcap = current?.metrics?.avgHcap;

    // WHS (true) from gross-per-hole if we have enough data on the round(s)
    const _tryGetParsSI = (r) => {
      const pars = r?.parsPerHole || r?.parPerHole || r?.parsArr || r?.pars || r?.parHoles || r?.par || null;
      const si   = r?.siPerHole   || r?.strokeIndexPerHole || r?.siArr || r?.si || r?.strokeIndex || null;
      const pArr = Array.isArray(pars) ? pars.map(Number) : null;
      const sArr = Array.isArray(si) ? si.map(Number) : null;
      return { pArr, sArr };
    };

    const _whsDiffForRound = (r) => {
      const gh = Array.isArray(r?.grossPerHole) ? r.grossPerHole.map(Number) : null;
      if (!gh || !gh.length) return NaN;

      const { pArr, sArr } = _tryGetParsSI(r);
      if (!pArr || !sArr || pArr.length < 9 || sArr.length < 9) return NaN;

      const sl = Number(r?.slope || r?.slopeRating || r?.courseSlope || r?.teeSlope || 0);
      const cr = Number(r?.rating || r?.courseRating || r?.teeRating || 0);
      const parTotal = Number.isFinite(Number(r?.parTotal)) ? Number(r?.parTotal) : pArr.reduce((a,b)=>a+(Number(b)||0),0);
      const hi = Number(r?.startExact ?? r?.index ?? r?.handicapIndex ?? r?.hi ?? NaN);
      if (!Number.isFinite(sl) || sl <= 0 || !Number.isFinite(cr) || !Number.isFinite(parTotal) || parTotal<=0 || !Number.isFinite(hi)) return NaN;

      const teeLayout = { pars: pArr, si: sArr };
      const ags = WHS_adjustedGrossFromHoleScores(gh, teeLayout, hi, sl, cr);
      if (!Number.isFinite(ags)) return NaN;
      return WHS_scoreDifferential(ags, sl, cr, 0);
    };

    const _whsNextHIFromSeries = (series) => {
      const s = Array.isArray(series) ? series.slice() : [];
      s.sort((a,b)=> (Number(a?.dateMs)||Number(a?.idx)||0) - (Number(b?.dateMs)||Number(b?.idx)||0));
      const diffs = s.map(_whsDiffForRound).filter(Number.isFinite);
      if (diffs.length < 3) return NaN;
      return WHS_handicapIndexFromDiffs(diffs.slice(-20));
    };

    const whsNextHI_raw = _whsNextHIFromSeries(current?.series)
    const whsNextHI = Number.isFinite(whsNextHI_raw) ? clamp(whsNextHI_raw, 0, 36) : whsNextHI_raw;

    // Den "next handicap" preview (based on the most recent round's points + that round's startExact).
    const _latestRound = (() => {
      const s = _seriesSorted(current);
      return s.length ? s[s.length - 1] : null;
    })();
    const denStartExact = PR_num(_latestRound?.startExact, PR_num(current?.startExact, PR_num(hcap, NaN)));
    const denPts = PR_num(_latestRound?.pts, PR_num(_latestRound?.points, NaN));
    const denGender = String(_latestRound?.gender || current?.gender || "M");

    // Den winner check for the most recent round in the active sample.
    // We decide the winner using the same rules as the Event leaderboard:
    // highest points, then countback on per-hole points.
    const denIsWinner = (() => {
      // Prefer winner flag computed from the round's full field at ingest time.
      if (typeof _latestRound?.isWinner === "boolean") return _latestRound.isWinner;
      // Fallback: recompute from peers if older data lacks isWinner.
      try {
        const key = _latestRound?.file || null;
        if (!key) return false;

        const contenders = [];
        for (const p of (Array.isArray(peerPlayers) ? peerPlayers : [])) {
          const s = _seriesSorted(p);
          const rr = s.find(x => x && x.file === key);
          if (!rr) continue;

          const pts = PR_num(rr?.pts, PR_num(rr?.points, NaN));
          const ph = Array.isArray(rr?.perHole) ? rr.perHole : [];
          if (!Number.isFinite(pts)) continue;

          contenders.push({ name: p?.name || "", points: pts, perHole: ph });
        }
        if (!contenders.length) return false;

        contenders.sort((a,b) => (b.points - a.points) || compareByCountback(a,b));

        const topPts = contenders[0].points;
        const topGroup = contenders.filter(x => x.points === topPts);
        let best = topGroup.length ? [topGroup[0]] : [];
        for (let k = 1; k < topGroup.length; k++) {
          const cmp = compareByCountback(topGroup[k], best[0]);
          if (cmp > 0) best = [topGroup[k]];
          else if (cmp === 0) best.push(topGroup[k]);
        }
        const winnerSet = new Set(best.map(b => String(b.name||"").trim()));
        return winnerSet.has(String(current?.name||"").trim());
      } catch {
        return false;
      }
    })();
const denNext = (Number.isFinite(denStartExact) && Number.isFinite(denPts))
      ? computeNewExactHandicap(denStartExact, denGender, denPts, PR_num(_latestRound?.back9, 0), denIsWinner).nextExact
      : NaN;

    // IMPORTANT: if a mode is selected but can't be computed, show "—" (NaN) rather than silently falling back.
    const calcHcap =
      (reportNextHcapMode === "same") ? (Number.isFinite(hcap) ? hcap : NaN)
      : (reportNextHcapMode === "den") ? denNext
      : (reportNextHcapMode === "whs") ? whsNextHI
      : NaN;
    const vsFieldS = (Number.isFinite(stableFacts?.ptsNow) && Number.isFinite(stableFacts?.ptsField)) ? (stableFacts.ptsNow - stableFacts.ptsField) : NaN;
    const vsFieldG = (Number.isFinite(grossFacts?.gPR) && Number.isFinite(grossFacts?.gPRf)) ? (grossFacts.gPRf - grossFacts.gPR) : NaN;

    const getBandDelta = (min, max) => {
  // Compute a true per-hole delta for a yardage band, excluding missing/invalid rows.
  // IMPORTANT: Selection is "bucket fully inside [min,max]" (not midpoint, not overlap),
  // so we don't accidentally pull in adjacent bands like "420+" when asking for "351–420".
  const parseRange = (k) => {
    const s = String(k ?? "")
      .trim()
      .replace(/[–—-]/g, "-"); // normalise all dash variants

    if (!s) return null;

    // <150
    if (s.startsWith("<")) {
      const n = parseInt(s.replace(/[^0-9]/g, ""), 10);
      if (!Number.isFinite(n)) return null;
      return { lo: 0, hi: n - 1 };
    }

    // 420+
    if (s.includes("+")) {
      const n = parseInt(s.replace(/[^0-9]/g, ""), 10);
      if (!Number.isFinite(n)) return null;
      return { lo: n, hi: Infinity };
    }

    // 150-175
    const m = s.match(/(\d+)\s*-\s*(\d+)/);
    if (m) {
      const lo = parseInt(m[1], 10);
      const hi = parseInt(m[2], 10);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
      return { lo, hi };
    }

    return null;
  };

  const relevant = (rawYd || []).filter(r => {
    const rr = parseRange(r?.key);
    if (!rr) return false;

    // Finite bucket: must be fully inside [min,max]
    if (rr.hi !== Infinity) return (rr.lo >= min && rr.hi <= max);

    // Plus bucket: include only if the request genuinely extends beyond the threshold
    // (prevents "420+" leaking into "351–420" when max === 420).
    return (rr.lo >= min && max > rr.lo);
  });

  let denomH = 0;
  let numer = 0;

  for (const r of relevant) {
    const holes = PR_num(r?.holes || 0, 0);
    if (holes <= 0) continue;

    const d = PR_goodDelta(scoringMode, r?.playerAvg, r?.fieldAvg); // per-hole delta (same basis as Deep Dive)
    if (!Number.isFinite(d)) continue; // never include invalid rows in denom

    denomH += holes;
    numer += d * holes;
  }

  return denomH > 0 ? (numer / denomH) : NaN;
};

const getSiDelta = (min, max) => {
  // Compute a true per-hole delta for an SI band, excluding missing/invalid rows.
  const parseRange = (k) => {
    const s = String(k ?? "")
      .trim()
      .replace(/[–—-]/g, "-");

    if (!s) return null;

    const m = s.match(/(\d+)\s*-\s*(\d+)/);
    if (m) {
      const lo = parseInt(m[1], 10);
      const hi = parseInt(m[2], 10);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
      return { lo, hi };
    }

    const n = parseInt(s.replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(n)) return { lo: n, hi: n };

    return null;
  };

  const relevant = (rawSI || []).filter(r => {
    const rr = parseRange(r?.key);
    if (!rr) return false;
    return (rr.lo >= min && rr.hi <= max);
  });

  let denomH = 0;
  let numer = 0;

  for (const r of relevant) {
    const holes = PR_num(r?.holes || 0, 0);
    if (holes <= 0) continue;

    const d = PR_goodDelta(scoringMode, r?.playerAvg, r?.fieldAvg);
    if (!Number.isFinite(d)) continue;

    denomH += holes;
    numer += d * holes;
  }

  return denomH > 0 ? (numer / denomH) : NaN;
};

    return {
        rounds: games,
        rankS: stableFacts?.rank,
        rankG: grossFacts?.rank,
        vsFieldS, vsFieldG,
        avgPts, avgStr, hcap, calcHcap,
        trendS: stableFacts?.vel, trendG: grossFacts?.vel,
        volS: stableFacts?.vol, volSf: stableFacts?.volField,
        volG: grossFacts?.vol, volGf: grossFacts?.volField,
        fb: stableFacts?.fb,
        par3: PR_goodDelta(scoringMode, (scoringMode==="gross"?grossFacts?.p3:stableFacts?.p3), (scoringMode==="gross"?grossFacts?.f3:stableFacts?.f3)),
        par4: PR_goodDelta(scoringMode, (scoringMode==="gross"?grossFacts?.p4:stableFacts?.p4), (scoringMode==="gross"?grossFacts?.f4:stableFacts?.f4)),
        par5: PR_goodDelta(scoringMode, (scoringMode==="gross"?grossFacts?.p5:stableFacts?.p5), (scoringMode==="gross"?grossFacts?.f5:stableFacts?.f5)),
        yLT150: getBandDelta(0, 149),
        y150_200: getBandDelta(150, 200),
        y201_350: getBandDelta(201, 350),
        y351_420: getBandDelta(351, 420),
        yGT420: getBandDelta(421, 999),
        si1_6: getSiDelta(1, 6),
        si7_12: getSiDelta(7, 12),
        si13_18: getSiDelta(13, 18),
        worst3: (() => {
          // Drive plan priorities from the selected Lens (ppBarsMode):
          // - pointsField   => Stableford Points vs Field
          // - strokesField  => Gross Strokes vs Field
          // - strokesPar    => Gross Strokes vs Par
          if (ppBarsMode === "pointsField") return ((stableFacts?.sw?.hurting) || []).slice(0, 3);
          if (ppBarsMode === "strokesField") return ((grossFacts?.sw?.hurting) || []).slice(0, 3);

          // ppBarsMode === "strokesPar": focus on STROKES vs PAR (absolute), not vs field / not stableford.
          // NOTE: We intentionally do NOT reuse `buildRows` here because it is a block-scoped const declared later.
          // Build simple per-bucket impacts vs par directly: impactRd = - (avg over-par per hole) * holesPerRound.
          const roundsCount = (() => {
            const n = Array.isArray(current?.series) ? current.series.length : Number(games);
            if (Number.isFinite(n) && n > 0) return n;
            // fallback: infer from total holes across par buckets
            const totalH = Object.values(current?.byParGross || {}).reduce((a,r)=>a + _num(r?.holes,0), 0);
            return totalH ? (totalH / 18) : 1;
          })();

          const buildVsPar = (dim, meObj, limit=8) => {
            const rows = [];
            Object.keys(meObj || {}).forEach(k => {
              const meAgg = meObj?.[k];
              const holes = _num(meAgg?.holes, 0);
              if (!holes) return;
              const overParPH = avgOverParPH(meAgg); // + is worse than par
              const holesPerRound = holes / (roundsCount > 0 ? roundsCount : 1);
              const impactRd = -overParPH * holesPerRound; // negative = leak vs par
              rows.push({ key:k, label:`${dim} ${k}`, holes, impactRd });
            });
            rows.sort((a,b)=>a.impactRd - b.impactRd); // most negative first
            return rows.slice(0, limit);
          };

          const parRowsP = buildVsPar("Par",  (current?.byParGross || {}), 6);
          const siRowsP  = buildVsPar("SI",   (current?.bySIGross  || {}), 6);
          const ydRowsP  = buildVsPar("Yds",  (current?.byYardsGross || {}), 8);

          const all = [...parRowsP, ...siRowsP, ...ydRowsP].filter(r => Number.isFinite(r?.impactRd));
          return all.sort((a,b)=>a.impactRd-b.impactRd).slice(0,3).map(r => ({ label: r.label, perRound: r.impactRd }));
        })(),
    };
  }, [current, stableFacts, grossFacts, games, rawYd, rawSI, scoringMode, ppBarsMode, reportNextHcapMode]);
// Windowed rounds (respects SeasonSelectionBar seasonLimit)
const windowSeries = React.useMemo(() => {
  const s = _seriesSorted(current);
  const isAll = String(seasonLimit || "").toLowerCase() === "all";
  const n = isAll ? 0 : Number(seasonLimit);
  return (n && n > 0) ? s.slice(-n) : s;
}, [current, seasonLimit]);

const outcomeMix = React.useMemo(() => {
  return PR_bucketOutcomeMix({ scoringMode, windowSeries });
}, [scoringMode, windowSeries]);

// Field window (all rounds in season scope, for comparison)
const fieldWindowSeries = React.useMemo(() => {
  const arr = [];
  const ps = Array.isArray(allPlayers) ? allPlayers : [];
  for (const p of ps){
    const s = _seriesSorted(p);
    for (const r of s) arr.push(r);
  }
  arr.sort((a,b)=> (Number(a.dateMs)||Number(a.idx)||0) - (Number(b.dateMs)||Number(b.idx)||0));
  const isAll = String(seasonLimit || "").toLowerCase() === "all";
  const n = isAll ? 0 : Number(seasonLimit);
  return (n && n > 0) ? arr.slice(-n) : arr;
}, [allPlayers, seasonLimit]);

const fieldOutcomeMix = React.useMemo(() => {
  return PR_bucketOutcomeMix({ scoringMode, windowSeries: fieldWindowSeries });
}, [scoringMode, fieldWindowSeries]);

const planKPIs = React.useMemo(() => {
  const picks = (qaData && qaData.worst3 && qaData.worst3.length) ? qaData.worst3.slice(0,3) : [];
  return picks.map(w => PR_kpiFromFocusLabel({ label: w.label, scoringMode, rawPar, rawSI, rawYd }));
}, [qaData, scoringMode, rawPar, rawSI, rawYd]);




  const _fmtRank = (r) => (Number.isFinite(r?.pos) && r?.total ? `${r.pos} of ${r.total}` : "—");
  const _pill = (good) => good ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-rose-50 text-rose-800 border-rose-200";
  const _deltaClass = (x, invert=false) => {
    if (!Number.isFinite(x)) return "text-neutral-400";
    const v = invert ? -x : x;
    return v >= 0 ? "text-emerald-700" : "text-rose-700";
  };
  const _toneFromVsFieldPR = (diff, invert=false, threshold=0.01) => {
    if (!Number.isFinite(diff)) return "text-neutral-500";
    if (Math.abs(diff) < threshold) return "text-neutral-600";
    const good = invert ? diff < 0 : diff > 0;
    return good ? "text-emerald-700" : "text-rose-700";
  };
  const _sentenceFB = (fb, modeKey) => {
    if (!Number.isFinite(fb)) return "No clear front/back split (not enough data).";
    if (Math.abs(fb) < (modeKey==="gross" ? 0.4 : 0.4)) return "Front 9 and back 9 are basically even.";
    if (modeKey === "gross") return fb > 0 ? "You score stronger on the back 9." : "You score stronger on the front 9.";
    return fb < 0 ? "You score stronger on the back 9." : "You score stronger on the front 9.";
  };
  const _consistencyLine = (vol, volField, modeKey) => {
    if (!Number.isFinite(vol) || !Number.isFinite(volField)) return "Consistency: not enough data.";
    const better = vol < volField;
    const unit = modeKey==="gross" ? "strokes" : "points";
    return better ? `Consistency: tighter than the field (lower spread in ${unit}).` : `Consistency: looser than the field (more up‑and‑down in ${unit}).`;
  };
  const _improvingLine = (vel, velField, modeKey) => {
    if (!Number.isFinite(vel)) return "Improvement: not enough data to call a trend.";
    const betterThanField = Number.isFinite(velField) ? (vel > velField) : null;
    const dir = vel > 0.05 ? "improving" : vel < -0.05 ? "slipping" : "flat";
    if (betterThanField === null) return `Trend: ${dir}.`;
    return `Trend: ${dir} (vs field: ${betterThanField ? "faster" : "slower"}).`;
  };

  // --- Render (Empty State) ---
  if (!seasonModel || !players.length || !current) {
    return (
      <section className="glass-card pm-scope p-4 md:p-6">
      <div className="pm-accent-rail" aria-hidden="true"></div>
        <Breadcrumbs items={[{ label: "Plan" }]} />
        
      <ImproveTopNav active="report" setView={setView} />
          <SeasonSelectionBar
            seasonModel={seasonModel}
            seasonPlayer={seasonPlayer}
            setSeasonPlayer={setSeasonPlayer}
            seasonYear={seasonYear}
            setSeasonYear={setSeasonYear}
            seasonLimit={seasonLimit}
            setSeasonLimit={setSeasonLimit}
            seasonYears={seasonYears}
            scoringMode={scoringMode}
            setScoringMode={setScoringMode}
          />

<div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="font-black text-neutral-900">Player Report needs season analysis</div>
          <div className="text-sm text-neutral-600 mt-1">Run <span className="font-semibold">Player Progress</span> first.</div>
          <button className="btn-primary mt-3" onClick={() => setView("player_progress")}>Go to Player Progress</button>
        </div>
      </section>
    );
  }

  // --- Render (Main) ---
  return (
    <section className="glass-card p-4 md:p-6">
      <Breadcrumbs items={[{ label: "Player Progress", onClick: () => setView("player_progress") }, { label: "Player Report" }]} />
      <ImproveTopNav active="report" setView={setView} />
      <SeasonSelectionBar
        seasonModel={seasonModel}
        seasonPlayer={seasonPlayer}
        setSeasonPlayer={setSeasonPlayer}
        seasonYear={seasonYear}
        setSeasonYear={setSeasonYear}
        seasonLimit={seasonLimit}
        setSeasonLimit={setSeasonLimit}
        seasonYears={seasonYears}
        scoringMode={scoringMode}
        setScoringMode={setScoringMode}
      />

      <div className="mt-3 flex gap-2 flex-wrap">
        <button
          className="btn-primary"
          onClick={() => {
            try{
              const model = seasonModel;
              const lens = (localStorage.getItem("dsl_lens") || "pointsField");
              // Comparator for the Season Report is controlled inside the report overlay (Field vs Handicap band).
              // Default to handicap band unless a prior report run stored a preference.
              const uiCohort = (window.__dslUiState && window.__dslUiState.cohortMode) ? window.__dslUiState.cohortMode : null;
// Default comparator: follow the Overview "Score vs Field" comparator if available, else remember last report choice, else band.
const comparator = uiCohort ? (uiCohort === "field" ? "field" : "band")
  : ((window.__dslSeasonReportParams && window.__dslSeasonReportParams.comparatorMode)
      ? window.__dslSeasonReportParams.comparatorMode
      : "band");
              window.__dslSeasonReportParams = { model: seasonModel, playerName: seasonPlayer, yearLabel: seasonYear, seasonLimit: seasonLimit, scoringMode, lensMode: lens, comparatorMode: comparator };
              const r = PR_generateSeasonReportHTML({
                model: seasonModel,
                playerName: seasonPlayer,
                yearLabel: seasonYear,
                seasonLimit: seasonLimit,
                scoringMode,
                lensMode: lens,
                comparatorMode: comparator
              });
              if (!r || !r.ok) { alert(r?.error || "Could not generate report."); return; }
              PR_showInlineSeasonReport(r.htmlFragment || r.html);
              }catch(e){
              console.error(e);
              alert("Could not generate report.");
            }
          }}
          title="Open the season report"
        >
          Generate Season Report
        </button>
        </div>


      {/* Pro Plan (prescription) */}
      <div className="mt-4 rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm" id="player-report-top">
        <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Your plan for the next 2 weeks</div>
        <div className="mt-1 text-2xl md:text-3xl font-black text-neutral-900">
          Focus on the highest-impact leaks (then re-check after 3–5 rounds)
        </div>
        <div className="mt-2 text-sm text-neutral-600">
          This is a prescription, not a novel. Pick 1–2 focuses, do the drill, follow the on-course rule, then measure the result.
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
          {((qaData && qaData.worst3 && qaData.worst3.length) ? qaData.worst3 : [{ label: "—", perRound: NaN }]).map((w, i) => (
            <div key={i} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Focus #{i+1}</div>
                  <div className="mt-1 text-lg font-black text-neutral-900 truncate">{w.label || "—"}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Impact</div>
                  <div className="text-xl font-black tabular-nums text-rose-700">
                    {Number.isFinite(w.perRound) ? `-${Math.abs(w.perRound).toFixed(1)}` : "—"}
                    <span className="text-[11px] text-neutral-500 font-black ml-1">/rd</span>
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <div className="text-xs font-black tracking-widest uppercase text-neutral-500">Why it matters</div>
                <div className="text-sm text-neutral-800 mt-1">{PR_focusWhy(w.label)}</div>
              </div>

              <div className="mt-3">
                <div className="text-xs font-black tracking-widest uppercase text-neutral-500">Do this drill</div>
                <ul className="mt-1 text-sm text-neutral-800 list-disc pl-5 space-y-1">
                  <li>{PR_focusDrill1(w.label, edgeSuggestion)}</li>
                  <li>{PR_focusDrill2(w.label)}</li>
                </ul>
              </div>

              <div className="mt-3">
                <div className="text-xs font-black tracking-widest uppercase text-neutral-500">On-course rule</div>
                <div className="text-sm text-neutral-800 mt-1">{PR_focusRule(w.label)}</div>
              </div>
            </div>
          ))}
        </div>

        
<div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Measure it</div>
          
          <div className="mt-2 grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">KPIs tied to your top focuses</div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                {(planKPIs && planKPIs.length ? planKPIs : [{label:"—", kpi:"KPI", mePH:NaN, fldPH:NaN, targetPH:NaN, unit:""}]).map((k, idx) => {
                  const isGross = (scoringMode === "gross");
                  const me = Number(k.mePH);
                  const fld = Number(k.fldPH);
                  const tgt = Number(k.targetPH);

                  const has = Number.isFinite(me) && Number.isFinite(tgt);
                  const good = !has ? null : (isGross ? (me <= tgt) : (me >= tgt));

                  const meTxt  = Number.isFinite(me)  ? PR_fmt(me, 2)  : "—";
                  const fldTxt = Number.isFinite(fld) ? PR_fmt(fld, 2) : "—";
                  const tgtTxt = Number.isFinite(tgt) ? PR_fmt(tgt, 2) : "—";

                  return (
                    <div key={idx} className={"rounded-2xl border p-4 " + (good === null ? "border-neutral-200 bg-white" : (good ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"))}>
                      <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">KPI #{idx+1}</div>
                      <div className="mt-1 text-sm font-black text-neutral-900 truncate">{k.label || "—"}</div>
                      <div className="mt-2 text-[11px] text-neutral-700">{k.kpi || "Avg"}</div>

                      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-xl border border-neutral-200 bg-white p-2">
                          <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">You</div>
                          <div className="text-sm font-black text-neutral-900">{meTxt}</div>
                        </div>
                        <div className="rounded-xl border border-neutral-200 bg-white p-2">
                          <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Field</div>
                          <div className="text-sm font-black text-neutral-900">{fldTxt}</div>
                        </div>
                        <div className="rounded-xl border border-neutral-200 bg-white p-2">
                          <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Target</div>
                          <div className="text-sm font-black text-neutral-900">{tgtTxt}</div>
                        </div>
                      </div>

                      <div className="mt-2 text-[11px] text-neutral-600">
                        {scoringMode === "gross"
                          ? "Goal: bring this average DOWN (closer to par / field)."
                          : "Goal: bring this average UP (closer to field)."}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 text-xs text-neutral-600">
                Targets are deliberately realistic: they’re set to close <span className="font-black text-neutral-800">half the gap</span> to the field on each focus over the next <span className="font-black text-neutral-800">3–5 rounds</span>.
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white p-4">
              <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Score guardrails</div>
              <div className="mt-2 text-sm font-black text-neutral-900">
                {scoringMode === "gross" ? "Reduce doubles+" : "Reduce wipes (0 pts)"}
              </div>
              <div className="mt-2 rounded-xl border border-neutral-200 bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">KPIs</div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[10px] font-black tracking-widest uppercase text-indigo-800">How to read</span>
                </div>
                <div className="mt-2 text-xs text-neutral-700 leading-relaxed">
                  <ul className="list-disc pl-4 space-y-1">
                    <li><span className="font-black text-neutral-900">You</span> = rounds in your current filter.</li>
                    <li><span className="font-black text-neutral-900">Field</span> = everyone’s rounds in the same scope.</li>
                    <li><span className="font-black text-neutral-900">Goal</span> = a realistic next step (not perfection): move halfway toward the field, or remove one disaster hole.</li>
                  </ul>
                </div>
              </div>


              {(() => {
                const holes = Number(outcomeMix?.holes);
                const badRate = Number(outcomeMix?.badRate);
                const bogeyRate = Number(outcomeMix?.bogeyRate);
                const parRate = Number(outcomeMix?.parRate);
                const birdiePlusRate = Number(outcomeMix?.birdiePlusRate);

                const fldBadRate = Number(fieldOutcomeMix?.badRate);
                const fldBogeyRate = Number(fieldOutcomeMix?.bogeyRate);
                const fldParRate = Number(fieldOutcomeMix?.parRate);
                const fldBirdiePlusRate = Number(fieldOutcomeMix?.birdiePlusRate);

                const deltaPct = (me, fld) => {
                  if (!Number.isFinite(me) || !Number.isFinite(fld)) return "—";
                  const d = (me - fld) * 100;
                  const s = (d >= 0 ? "+" : "") + PR_fmt(d, 0) + "%";
                  return s;
                };

                const kpiTone = (me, fld, betterIs) => {
                  // betterIs: "down" means lower is better; "up" means higher is better
                  if (!Number.isFinite(me) || !Number.isFinite(fld)) return "text-neutral-900";
                  const better = (betterIs === "down") ? (me < fld) : (me > fld);
                  const worse  = (betterIs === "down") ? (me > fld) : (me < fld);
                  if (better) return "text-emerald-700";
                  if (worse)  return "text-rose-700";
                  return "text-neutral-900";
                };


                const targetTowardField = (me, fld, direction) => {
                  // direction: "down" means lower is better, "up" means higher is better
                  if (!Number.isFinite(me) || !Number.isFinite(fld)) return NaN;
                  // move halfway toward field in the right direction (never overshoot)
                  const half = me + 0.5 * (fld - me);
                  if (direction === "down") return Math.min(me, half);
                  return Math.max(me, half);
                };


                const pct = (r) => Number.isFinite(r) ? (PR_fmt(r*100, 0) + "%") : "—";
                const per18 = (r) => Number.isFinite(r) ? PR_fmt(r*18, 1) : "—";

                const badPer18 = Number.isFinite(badRate) ? badRate*18 : NaN;
                const targetBadPer18 = Number.isFinite(badPer18) ? Math.max(0, badPer18 - 1) : NaN;

                return (
                  <div className="mt-3 space-y-2">
                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                      <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Wipe / Double+ rate</div>
                      <div className="mt-1 flex items-baseline justify-between gap-3">
                        <div className={"text-lg font-black " + kpiTone(badRate,fldBadRate,"down")}>{pct(badRate)}</div>
                        <div className="text-xs text-neutral-600">{per18(badRate)} per 18</div>
                        <div className="text-[11px] font-black text-neutral-700">Field: {pct(fldBadRate)} · {per18(fldBadRate)} /18</div>
                      </div>
                      <div className="mt-1 text-xs text-neutral-700">
                        Goal: <span className="font-black text-neutral-900">{PR_fmt(targetBadPer18,1)}</span> per 18 (<span className="font-black text-neutral-900">{pct(Number.isFinite(targetBadPer18)? (targetBadPer18/18) : NaN)}</span>) over the <span className="font-black text-neutral-900">next 5 rounds</span> — basically remove <span className="font-black text-neutral-900">one</span> disaster hole.
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-neutral-200 bg-white p-3">
                        <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Bogey rate</div>
                        <div className={"mt-1 text-base font-black " + kpiTone(bogeyRate,fldBogeyRate,"down")}>{pct(bogeyRate)}<div className="mt-1 text-[11px] font-black text-neutral-700">Field: {pct(fldBogeyRate)} <span className="text-neutral-500">({deltaPct(bogeyRate,fldBogeyRate)})</span></div></div>
                      </div>
                      <div className="rounded-xl border border-neutral-200 bg-white p-3">
                        <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Par rate</div>
                        <div className={"mt-1 text-base font-black " + kpiTone(parRate,fldParRate,"up")}>{pct(parRate)}<div className="mt-1 text-[11px] font-black text-neutral-700">Field: {pct(fldParRate)} <span className="text-neutral-500">({deltaPct(parRate,fldParRate)})</span></div></div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-neutral-200 bg-white p-3">
                      <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Birdie+ rate</div>
                      <div className="mt-1 flex items-baseline justify-between gap-3">
                        <div className={"text-base font-black " + kpiTone(birdiePlusRate,fldBirdiePlusRate,"up")}>{pct(birdiePlusRate)}<div className="mt-1 text-[11px] font-black text-neutral-700">Field: {pct(fldBirdiePlusRate)} <span className="text-neutral-500">({deltaPct(birdiePlusRate,fldBirdiePlusRate)})</span></div></div>
                        <div className="text-xs text-neutral-600">{holes ? (PR_fmt(holes/18,1) + " rounds analysed") : "—"}</div>
                      </div>
                      <div className="mt-1 text-xs text-neutral-600">
                        This isn’t about chasing birdies — it’s about <span className="font-black text-neutral-800">protecting the card</span>. Cut one wipe/double+ and your scoring moves immediately.
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div></section>
  );
}
// =========================
// Golfer's Guide (Interactive)
// =========================


// --- In-depth Guide (embedded) ---
function buildDeepGuideHTML(leagueTitle){
  const BRAND = String(leagueTitle || "Den Society League").trim();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${BRAND} — Golfer’s Guide</title>

  <style>
    :root{
      --card: rgba(255,255,255,.86);
      --shadowA: 0 1px 2px rgba(15,23,42,.06);
      --shadowB: 0 18px 46px rgba(15,23,42,.14);
      --shadowC: 0 10px 26px rgba(15,23,42,.10);
      --radius: 22px;
    }

    *{box-sizing:border-box}
    html,body{height:100%}
    body{
      margin:0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
      color: #0f172a;
      background:
        radial-gradient(1000px 600px at 0% 0%, rgba(16,185,129,.18), transparent 55%),
        radial-gradient(900px 600px at 100% 0%, rgba(99,102,241,.18), transparent 55%),
        radial-gradient(900px 600px at 50% 100%, rgba(244,63,94,.10), transparent 55%),
        linear-gradient(180deg, #f8fafc, #eef2ff 55%, #f8fafc);
      background-attachment: fixed;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .wrap{max-width:1100px; margin:0 auto; padding:20px 16px 70px;}
    .topbar{
      position: sticky; top: 0; z-index: 50;
      padding-top: env(safe-area-inset-top);
      backdrop-filter: blur(12px);
      background: rgba(255,255,255,.72);
      border-bottom: 1px solid rgba(148,163,184,.18);
    }
    .topbar-inner{
      max-width:1100px; margin:0 auto; padding:14px 16px;
      display:flex; align-items:center; justify-content:space-between; gap:12px;
    }
    .brand{
      display:flex; align-items:center; gap:12px; min-width:0;
    }
    .logo{
      width:42px; height:42px; border-radius:14px;
      background: linear-gradient(180deg, rgba(34,197,94,.35), rgba(25,159,87,.18));
      border:1px solid rgba(16,185,129,.35);
      box-shadow: var(--shadowA);
      display:grid; place-items:center;
      flex: 0 0 auto;
    }
    .logo svg{width:24px; height:24px}
    .brand h1{
      margin:0; line-height:1.05;
      font-weight: 900;
      letter-spacing: -.03em;
      font-size: 16px;
      white-space: nowrap;
      overflow:hidden;
      text-overflow: ellipsis;
    }
    .brand p{
      margin:3px 0 0;
      font-size: 12px;
      color: rgba(100,116,139,1);
      white-space: nowrap;
      overflow:hidden;
      text-overflow: ellipsis;
    }

    .chips{display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end}
    .chip{
      display:inline-flex; align-items:center; gap:8px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid rgba(16,185,129,.30);
      background: rgba(240,253,244,.70);
      font-size: 12px;
      font-weight: 800;
      box-shadow: var(--shadowA);
      cursor: pointer;
      user-select:none;
    }
    .chip:hover{transform: translateY(-1px)}
    .btn{
      border:0;
      padding: 10px 14px;
      border-radius: 999px;
      font-weight: 900;
      cursor:pointer;
      box-shadow: var(--shadowA), var(--shadowC);
    }
    .btn.primary{
      background: linear-gradient(180deg, #22c55e, #199f57);
      color:white;
      border: 1px solid rgba(20,127,71,.55);
    }
    .btn.ghost{
      background: rgba(255,255,255,.82);
      border: 1px solid rgba(148,163,184,.22);
    }

    .grid{
      display:grid;
      grid-template-columns: 1fr;
      gap:14px;
    }
    @media (min-width: 920px){
      .grid{grid-template-columns: 1.2fr .8fr;}
    }

    .card{
      background: var(--card);
      border: 1px solid rgba(255,255,255,.6);
      border-radius: var(--radius);
      box-shadow: var(--shadowA), var(--shadowB);
      backdrop-filter: blur(12px);
      overflow:hidden;
    }
    .card.pad{padding:16px}
    @media (min-width: 720px){ .card.pad{padding:20px} }

    .hero{
      padding: 18px;
      background:
        radial-gradient(900px 300px at 0% 0%, rgba(16,185,129,.20), transparent 60%),
        radial-gradient(900px 300px at 100% 0%, rgba(99,102,241,.12), transparent 60%),
        linear-gradient(180deg, rgba(255,255,255,.8), rgba(255,255,255,.66));
      border-bottom: 1px solid rgba(148,163,184,.18);
    }
    .kicker{
      font-size: 10px;
      letter-spacing: .14em;
      text-transform: uppercase;
      color: rgba(100,116,139,1);
      font-weight: 900;
      display:flex; align-items:center; gap:10px;
    }
    .kicker .dot{
      width:10px; height:10px; border-radius:4px;
      background: rgba(99,102,241,.28);
      border: 1px solid rgba(99,102,241,.22);
    }
    .title{
      margin:10px 0 0;
      font-size: clamp(26px, 4.2vw, 44px);
      line-height: 1.05;
      font-weight: 950;
      letter-spacing: -.03em;
      color: #0b1220;
    }
    .subtitle{
      margin:10px 0 0;
      max-width: 70ch;
      font-size: 14px;
      color: rgba(71,85,105,1);
      line-height: 1.55;
    }
    .hero-actions{
      margin-top: 14px;
      display:flex; gap:10px; flex-wrap:wrap;
    }

    .statbar{
      display:grid;
      grid-template-columns: 1fr 1fr;
      gap:10px;
      padding: 14px 16px 16px;
      background: rgba(255,255,255,.58);
    }
    .stat{
      border-radius: 18px;
      border: 1px solid rgba(148,163,184,.18);
      background: rgba(248,250,252,.85);
      padding: 12px 12px;
    }
    .stat .lbl{
      font-size: 10px;
      letter-spacing: .14em;
      text-transform: uppercase;
      color: rgba(100,116,139,1);
      font-weight: 900;
    }
    .stat .val{
      margin-top:6px;
      font-size: 15px;
      font-weight: 950;
      letter-spacing: -.02em;
    }
    .stat .hint{
      margin-top:6px;
      font-size: 12px;
      color: rgba(100,116,139,1);
      line-height: 1.35;
    }

    .h2{
      margin:0;
      font-size: 14px;
      font-weight: 950;
      letter-spacing: -.01em;
      display:flex; align-items:center; gap:10px;
      flex-wrap: wrap;
    }
    .pill{
      display:inline-flex; align-items:center; gap:8px;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 900;
      border: 1px solid rgba(148,163,184,.20);
      background: rgba(2,6,23,.04);
      color: rgba(15,23,42,.80);
    }
    .p{
      margin:10px 0 0;
      font-size: 13px;
      line-height: 1.6;
      color: rgba(51,65,85,1);
    }

    .list{
      margin:10px 0 0; padding:0; list-style:none;
      display:grid; gap:10px;
    }
    .li{
      display:flex; gap:12px;
      padding: 12px 12px;
      border-radius: 18px;
      border: 1px solid rgba(148,163,184,.18);
      background: rgba(255,255,255,.70);
    }
    .ico{
      width:34px; height:34px;
      border-radius: 12px;
      display:grid; place-items:center;
      background: rgba(25,159,87,.10);
      border: 1px solid rgba(16,185,129,.22);
      flex: 0 0 auto;
      font-size: 16px;
    }
    .li b{display:block; font-size: 13px; font-weight: 950;}
    .li span{display:block; font-size: 12px; color: rgba(100,116,139,1); margin-top:4px; line-height:1.45;}

    .accordion{
      border-radius: 18px;
      border: 1px solid rgba(148,163,184,.18);
      overflow:hidden;
      background: rgba(255,255,255,.72);
    }
    details{ border-top: 1px solid rgba(148,163,184,.14); }
    details:first-child{border-top:0}
    summary{
      cursor:pointer;
      padding: 12px 14px;
      display:flex; align-items:center; justify-content:space-between; gap:10px;
      font-weight: 950;
      user-select:none;
    }
    summary::-webkit-details-marker{display:none}
    summary .meta{
      font-size: 11px;
      font-weight: 900;
      color: rgba(100,116,139,1);
      margin-top: 3px;
    }
    .sum-left{display:flex; align-items:flex-start; gap:10px}
    .caret{
      width: 28px; height: 28px;
      border-radius: 12px;
      display:grid; place-items:center;
      background: rgba(2,6,23,.04);
      border: 1px solid rgba(148,163,184,.18);
      flex: 0 0 auto;
    }
    .content{
      padding: 0 14px 14px;
      color: rgba(51,65,85,1);
      font-size: 13px;
      line-height: 1.6;
    }
    .content .mini{ margin-top: 10px; display:grid; gap:10px; }
    .callout{
      border-radius: 18px;
      border: 1px solid rgba(16,185,129,.25);
      background: rgba(240,253,244,.75);
      padding: 12px 12px;
    }
    .callout b{font-weight: 950}
    .callout p{margin:6px 0 0; font-size: 12px; color: rgba(71,85,105,1); line-height: 1.5;}
    .danger{
      border-color: rgba(244,63,94,.22);
      background: rgba(254,242,242,.70);
    }

    /* Badges */
    .badge{
      display:inline-flex;
      align-items:center;
      gap:8px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 950;
      letter-spacing: .01em;
      border: 1px solid rgba(148,163,184,.22);
      background: rgba(255,255,255,.82);
      color: rgba(15,23,42,.85);
      box-shadow: var(--shadowA);
      white-space: nowrap;
    }
    .badge .spark{opacity:.9}
    .badge.captain{
      border-color: rgba(99,102,241,.22);
      background: rgba(99,102,241,.10);
      color: rgba(55,48,163,1);
    }
    .badge.favourite{
      border-color: rgba(245,158,11,.26);
      background: rgba(245,158,11,.12);
      color: rgba(146,64,14,1);
    }
    .badge.hype{
      border-color: rgba(16,185,129,.26);
      background: rgba(16,185,129,.12);
      color: rgba(6,95,70,1);
    }

    .footer{
      margin-top: 16px;
      padding: 14px 16px;
      color: rgba(100,116,139,1);
      font-size: 12px;
      text-align:center;
    }

    /* Floating “Start here” */
    .fab{
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 999;
      display:flex; align-items:center; gap:10px;
      padding: 12px 14px;
      border-radius: 999px;
      background: rgba(17,24,39,.92);
      color:white;
      border: 1px solid rgba(255,255,255,.14);
      box-shadow: 0 16px 44px rgba(0,0,0,.22);
      backdrop-filter: blur(10px);
      cursor:pointer;
    }
    .fab:hover{transform: translateY(-1px)}

    .tagline{
      display:inline-flex; align-items:center; gap:8px;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid rgba(99,102,241,.22);
      background: rgba(99,102,241,.10);
      color: rgba(55,48,163,1);
      font-size: 12px;
      font-weight: 900;
      margin-left: 10px;
      white-space: nowrap;
    }
  </style>

<!-- iPhone: run as a standalone (full-screen) web app when launched from Home Screen -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${BRAND}">

<!-- PWA manifest + app icons -->
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">

</head>

<body>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        <div class="logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M6 13c2.2 3.6 8.2 3.6 10.4-1.4" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
            <circle cx="9" cy="9" r="1.7" fill="white"/>
            <circle cx="15" cy="9" r="1.7" fill="white"/>
          </svg>
        </div>
        <div style="min-width:0">
          <h1>${BRAND} — Golfer’s Guide</h1>
          <p>What it does • How to use it • How it actually drops your scores</p>
        </div>
      </div>

      <div class="chips" aria-label="Quick navigation">
        <button class="chip" data-jump="#what"><span aria-hidden="true">🧭</span>What is it?</button>
        <button class="chip" data-jump="#how"><span aria-hidden="true">⚡</span>Quick start</button>
        <button class="chip" data-jump="#improve-hub"><span aria-hidden="true">🧠</span>Improve tools</button>
        <button class="chip" data-jump="#views"><span aria-hidden="true">🧩</span>Menu map</button>
      </div>
    </div>
  </header>

  <main class="wrap">
    <section class="card">
      <div class="hero">
        <div class="kicker"><span class="dot" aria-hidden="true"></span>ONE-FILE LEAGUE + ANALYTICS <span class="tagline">“Sports broadcast” vibe</span></div>
        <h2 class="title">Turn your society golf into <br/>a scoreboard, a story... and a plan.</h2>
        <p class="subtitle">
          Load a <b>Squabbit event game</b> and the app builds leaderboards, scorecards, course insights, season standings,
          and the fun stuff (Replay, Teams, Banter, Casino, Trophies).
          It’s designed for golfers: <b>simple, punchy, and brutally useful.</b>
        </p>

        <div class="hero-actions">
          <button class="btn primary" data-jump="#how">Start in 60 seconds</button>
          <button class="btn ghost" data-jump="#improve-hub">How it helps you improve</button>
          <button class="btn ghost" data-jump="#views">What screens exist?</button>
        </div>
      </div>

      <div class="statbar" id="what">
        <div class="stat">
          <div class="lbl">What it replaces</div>
          <div class="val">Spreadsheets + vibes</div>
          <div class="hint">No more “I think I’m bad on par 3s” — it shows it.</div>
        </div>
        <div class="stat">
          <div class="lbl">What it creates</div>
          <div class="val">Decisions</div>
          <div class="hint">Where you win, where you leak, and what to do next.</div>
        </div>
      </div>
    </section>

    <div class="grid" style="margin-top:14px">
      <section class="card pad" id="how">
        <h3 class="h2">⚡ Quick start <span class="pill">Do this first</span></h3>
        <p class="p">
          Think of the app as two modes: <b>Game</b> (single round deep-dive) and <b>League</b> (season story).
        </p>

        <ol class="list">
          <li class="li">
            <div class="ico" aria-hidden="true">1</div>
            <div>
              <b>Enter Game Explorer</b>
              <span>Choose the course and date you want to explore — the app builds the round instantly.</span>
            </div>
          </li>
          <li class="li">
            <div class="ico" aria-hidden="true">2</div>
            <div>
              <b>Open the Menu</b>
              <span>Pick your view: leaderboards, scorecards, replay, teams, trophies, banter... the lot.</span>
            </div>
          </li>
          <li class="li">
            <div class="ico" aria-hidden="true">3</div>
            <div>
              <b>Add to League (optional)</b>
              <span>
                <span class="badge captain"><span class="spark">🧑‍✈️</span>This bit is for Admin/Captain/Captain</span>
                Stack rounds into a season for standings, progress trends, reports, trophies, and more.
              </span>
            </div>
          </li>
        </ol>

        <div class="callout" style="margin-top:12px">
          <b>The point:</b>
          <p>
            You don’t need “advanced analytics” to get better.
            You need <b>one clear leak</b>, a <b>simple target</b>, and a <b>re-check loop</b>.
          </p>
        </div>
      </section>

      <aside class="card pad">
        <h3 class="h2">📉 Improve fast <span class="pill">The loop</span></h3>
        <p class="p">
          The fastest improvement is boring: <b>find the leak → fix it → prove it</b>.
          The app’s improvement tools make that loop effortless.
        </p>

        <div class="accordion" style="margin-top:12px">
          <details open>
            <summary>
              <div class="sum-left">
                <div class="ico" aria-hidden="true" style="background:rgba(240,253,244,.9);border-color:rgba(16,185,129,.25)">🎯</div>
                <div>
                  Spot the leak
                  <div class="meta">Find where shots disappear</div>
                </div>
              </div>
              <div class="caret" aria-hidden="true">⌄</div>
            </summary>
            <div class="content">
              Use <b>Player Scorecard</b> to find blow-up holes, and <b>Course Stats</b> to see where the course bites.
              Then jump into <b>Player Progress</b> to confirm whether it’s a pattern or a one-off.
            </div>
          </details>

          <details>
            <summary>
              <div class="sum-left">
                <div class="ico" aria-hidden="true" style="background:rgba(99,102,241,.12);border-color:rgba(99,102,241,.22)">🧠</div>
                <div>
                  Choose the fix
                  <div class="meta">Practice + on-course decisions</div>
                </div>
              </div>
              <div class="caret" aria-hidden="true">⌄</div>
            </summary>
            <div class="content">
              Use <b>Insight</b> for fast answers.
              Then use <b>Play Do</b> to turn that into a simple plan you can actually follow.
              <div style="margin-top:10px">
                <b>Generate Report</b> creates a shareable performance summary using the report type you choose:
                <div style="margin-top:8px;line-height:1.45">
                  <b>Stableford Points vs Field</b> — competitive day view (you vs everyone).<br/>
                  <b>Stableford Points vs Handicap band</b> — fair comparison vs similar ability.<br/>
                  <b>Score vs Field</b> — raw strokes vs everyone.<br/>
                  <b>Score vs Handicap band</b> — strokes vs your peer group.<br/>
                  <b>Score vs Par</b> — where you gained or lost shots vs the course.
                </div>
              </div>
            </div>
          </details>

          <details>
            <summary>
              <div class="sum-left">
                <div class="ico" aria-hidden="true" style="background:rgba(244,63,94,.10);border-color:rgba(244,63,94,.22)">✅</div>
                <div>
                  Prove it
                  <div class="meta">No guessing, just trend</div>
                </div>
              </div>
              <div class="caret" aria-hidden="true">⌄</div>
            </summary>
            <div class="content">
              Commit to the top 1–2 fixes for <b>3–5 rounds</b>.
              Then re-check <b>Player Progress</b> on 5/10 games to see if volatility drops and form improves.
            </div>
          </details>
        </div>
      </aside>
    </div>

    <!-- Improvement hub (explicitly covers the 3 requested tools) -->
    <section class="card pad" id="improve-hub" style="margin-top:14px">
      <h3 class="h2">
        🧠 The improvement engine
        <span class="pill">Fast answers → plan → trend</span>
        <span class="badge hype"><span class="spark">📉</span>Score-dropping stuff</span>
      </h3>

      <p class="p">
        This is where the app stops being “nice stats” and becomes <b>what to do next</b>.
        Use it as a loop: <b>analyse → decide → repeat</b>.
      </p>

      <div class="accordion" style="margin-top:12px">

        <details open>
          <summary>
            <div class="sum-left">
              <div class="ico">📊</div>
              <div>
                Player Progress
                <span class="badge favourite" style="margin-left:10px"><span class="spark">🧭</span>Start here</span>
                <div class="meta">Overview • Insight • Play Do • Analyse 1/5/10/20/30/ALL games for trends &amp; volatility • Season</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>

          <div class="content">
            <b>What it is:</b> a trend view for a player over a chosen window — so you can separate <b>form</b> from <b>noise</b>.
            <div class="mini">
              <div class="callout">
                <b>How it works:</b>
                <p>
                  Pick a player → pick a window (1, 5, 10, 20, 30, ALL) → the app shows how results are moving
                  and how “swingy” they are (volatility).
                </p>
              </div>
              <div class="callout">
                <b>How to use it:</b>
                <p>
                  If your average is fine but volatility is high, you’re not “bad” — you’re leaking disasters.
                  That usually means smarter choices on 2–3 holes beat swing tweaks.
                </p>
              </div>
            </div>
          </div>
        </details>

        <details>
          <summary>
            <div class="sum-left">
              <div class="ico">💬</div>
              <div>
                Insight
                <span class="badge favourite" style="margin-left:10px"><span class="spark">🎯</span>Fast answers</span>
                <div class="meta">Fast answers: form, vs field, buckets, what to fix • Q&amp;A</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>

          <div class="content">
            <b>What it is:</b> the “tell me what to do” view — quick, plain-English guidance based on your results.
            <div class="mini">
              <div class="callout">
                <b>How it works:</b>
                <p>
                  It summarises your form, compares you <b>vs the field</b>, groups your scoring into <b>buckets</b>,
                  and highlights the top things to fix first.
                </p>
              </div>
              <div class="callout danger">
                <b>The best way to use it:</b>
                <p>
                  Take the top 1–2 recommendations and commit for 3–5 rounds.
                  Then check Player Progress again. If the trend moved, you keep it. If not, you change the plan.
                </p>
              </div>
            </div>
          </div>
        </details>

        <details>
          <summary>
            <div class="sum-left">
              <div class="ico">📝</div>
              <div>
                Play Do
                <span class="badge captain" style="margin-left:10px"><span class="spark">📋</span>Improvement plan</span>
                <div class="meta">— Improvement plan</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>

          <div class="content">
            <b>What it is:</b> a deeper report that pulls your season/round data into a clear plan.
            <div class="mini">
              <div class="callout">
                <b>How it works:</b>
                <p>
                  Pick a player → the report summarises strengths, weaknesses, and the biggest recurring scoring leaks,
                  then frames an improvement plan you can actually follow.
                </p>
              </div>
              <div class="callout">
                <b>How to use it:</b>
                <p>
                  Pick <b>one</b> focus. Not ten.
                  The best focus is usually the most repeatable leak: penalties, blow-up holes, par-3 scoring, or closing holes.
                </p>
              </div>
            </div>
          </div>
        </details>

      </div>

      <div class="callout" style="margin-top:12px">
        <b>The simple weekly routine:</b>
        <p>
          After each round: <b>Player Scorecard</b> (find where it went wrong).<br/>
          Every few rounds: <b>Player Progress</b> (trend + volatility).<br/>
          Monthly: <b>Insight</b> + <b>Play Do</b> (choose the next focus).
        </p>
      </div>
    </section>

    <!-- FULL MENU COVERAGE -->
    <section class="card pad" id="views" style="margin-top:14px">
      <h3 class="h2">
        🧩 What’s inside the app?
        <span class="pill">Every menu explained</span>
        <span class="badge hype" style="margin-left:6px"><span class="spark">✨</span>Built for the group chat</span>
      </h3>

      <p class="p">
        Here’s what each menu item is for — with a bias toward what golfers actually use.
      </p>

      <div class="accordion" style="margin-top:12px">

        <details open>
          <summary>
            <div class="sum-left">
              <div class="ico">⛳</div>
              <div>Game
                <div class="meta">The scoreboard</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>
          <div class="content">
            The main leaderboard for the round. The “open this first” screen.
          </div>
        </details>

        <details>
          <summary>
            <div class="sum-left">
              <div class="ico">📈</div>
              <div>Graphs
                <div class="meta">Trends and momentum</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>
          <div class="content">
            Visualise performance over holes/games — perfect for spotting comebacks and collapses.
          </div>
        </details>

        <details>
          <summary>
            <div class="sum-left">
              <div class="ico">🧾</div>
              <div>Player Scorecard
                <div class="meta">Hole-by-hole truth</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>
          <div class="content">
            Pick a player and see exactly where points were won or thrown away.
          </div>
        </details>

        <details>
          <summary>
            <div class="sum-left">
              <div class="ico">🗺️</div>
              <div>Course Stats
                <div class="meta">Which holes bite back</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>
          <div class="content">
            Course difficulty, scoring opportunities, and where strategy beats swing changes.
          </div>
        </details>

        <details>
          <summary>
            <div class="sum-left">
              <div class="ico">⭐</div>
              <div>Ratings
                <div class="meta">Performance, simplified</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>
          <div class="content">
            Breaks performance into clean ratings so you can tell what worked without drowning in numbers.
          </div>
        </details>

        <details>
          <summary>
            <div class="sum-left">
              <div class="ico">😂</div>
              <div>
                Banter <span class="badge favourite" style="margin-left:10px"><span class="spark">🔥</span>Captain’s favourite</span>
                <div class="meta">Stats with personality</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>
          <div class="content">
            Sharable talking points and properly-earned group-chat ammunition.
          </div>
        </details>

        <details>
          <summary>
            <div class="sum-left">
              <div class="ico">🎯</div>
              <div>Styles
                <div class="meta">How you score</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>
          <div class="content">
            Are you steady? Streaky? Back-nine merchant? Styles makes it obvious.
          </div>
        </details>

        <details>
          <summary>
            <div class="sum-left">
              <div class="ico">📖</div>
              <div>Story
                <div class="meta">The narrative version</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>
          <div class="content">
            Turns the day into a story: turning points, momentum swings, late charges.
          </div>
        </details>

        <details>
          <summary>
            <div class="sum-left">
              <div class="ico">📺</div>
              <div>
                Replay <span class="badge favourite" style="margin-left:10px"><span class="spark">🎥</span>Must-watch</span>
                <div class="meta">The broadcast replay</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>
          <div class="content">
            Re-live the round hole-by-hole like TV coverage. Lead changes, pressure moments, and receipts.
            <div class="mini">
              <div class="callout">
                <b>Replay tip:</b>
                <p>Open Replay straight after the round. It’s peak entertainment while the pain is fresh.</p>
              </div>
            </div>
          </div>
        </details>

        <details>
          <summary>
            <div class="sum-left">
              <div class="ico">🤼</div>
              <div>
                Teams <span class="badge favourite" style="margin-left:10px"><span class="spark">🧨</span>Spiciest screen</span>
                <div class="meta">Who carried who</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>
          <div class="content">
            Team results explained properly — who delivered, where matches were won/lost, and why the “weak link” rumours started.
          </div>
        </details>

        <details>
          <summary>
            <div class="sum-left">
              <div class="ico">🎰</div>
              <div>Casino
                <div class="meta">Side games, sorted</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>
          <div class="content">
            Side games and extras tracked cleanly so nobody “forgets” what they owe.
          </div>
        </details>

        <details>
          <summary>
            <div class="sum-left">
              <div class="ico">🏆</div>
              <div>Trophies
                <div class="meta">Permanent bragging rights</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>
          <div class="content">
            Achievements that stick — because golf needs a history of receipts.
          </div>
        </details>

        <details>
          <summary>
            <div class="sum-left">
              <div class="ico">🤝</div>
              <div>Partners
                <div class="meta">Best and worst combinations</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>
          <div class="content">
            See who you play best with — and who you should never be paired with again.
          </div>
        </details>

        <details>
          <summary>
            <div class="sum-left">
              <div class="ico">🥊</div>
              <div>Rivalry
                <div class="meta">Head-to-head receipts</div>
              </div>
            </div>
            <div class="caret">⌄</div>
          </summary>
          <div class="content">
            Compare two golfers properly. No selective memory. Just results.
          </div>
        </details>

      </div>
    </section>

    <div class="footer">
      Built for golf societies: easy inputs, clear outputs, maximum banter potential.<br/>
      Tip: send this guide to new members so everyone finds Replay + Teams + Improve tools quickly.
    </div>
  </main>

  <button class="fab" data-jump="#how" title="Start here">
    <span aria-hidden="true">🧭</span><span style="font-size:12px;font-weight:900;letter-spacing:.02em;">Start here</span>
  </button>

  <script>
    // Smooth jump buttons
    document.querySelectorAll("[data-jump]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const sel = btn.getAttribute("data-jump");
        const el = document.querySelector(sel);
        if(!el) return;
        el.scrollIntoView({behavior:"smooth", block:"start"});
      });
    });

    // Rotate caret on open/close
    const syncCarets = () => {
      document.querySelectorAll("details").forEach(d=>{
        const caret = d.querySelector(".caret");
        if(!caret) return;
        caret.style.transform = d.open ? "rotate(180deg)" : "rotate(0deg)";
        caret.style.transition = "transform 160ms ease";
      });
    };
    document.querySelectorAll("details").forEach(d=>{
      d.addEventListener("toggle", syncCarets);
    });
    syncCarets();
  <\/script>
</body>
</html>
`;
}
// --- End In-depth Guide ---
function GuideModePicker({ guideMode, setGuideMode }) {
  return (
    <div className="mb-5">
      <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Choose a mode</div>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          className={"guide-mode-card " + (guideMode === "simple" ? "active" : "")}
          onClick={() => setGuideMode("simple")}
          type="button"
        >
          <div className="gm-top">
            <div className="gm-title">Simple</div>
            <span className="gm-badge">Fast start</span>
          </div>
          <div className="gm-desc">
            The essentials: what each menu item does, and how to get value immediately.
          </div>
        </button>

        <button
          className={"guide-mode-card " + (guideMode === "deep" ? "active" : "")}
          onClick={() => setGuideMode("deep")}
          type="button"
        >
          <div className="gm-top">
            <div className="gm-title">In‑Depth</div>
            <span className="gm-badge">Full tour</span>
          </div>
          <div className="gm-desc">
            The full walkthrough (Improve tools, Replay & Teams) with the detailed guide embedded.
          </div>
        </button>
      </div>

      <div className="mt-2 text-xs text-neutral-500">
        You’re picking <span className="font-black">{guideMode === "simple" ? "Simple" : "In‑Depth"}</span> mode.
      </div>
    </div>
  );
}

function GuideView({ setView, leagueTitle }) {
  const [guideMode, setGuideMode] = React.useState(() => {
    try {
      return localStorage.getItem("denGuideMode") || "simple";
    } catch (e) {
      return "simple";
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem("denGuideMode", guideMode);
    } catch (e) {}
  }, [guideMode]);

  if (guideMode === "deep") {
    return (
      <section className="content-card p-4 md:p-6">
        <SoloNav setView={setView} title="Guide" />

      <GuideModePicker guideMode={guideMode} setGuideMode={setGuideMode} />
<div className="rounded-2xl border border-squab-200 bg-white shadow-sm overflow-hidden">
          <iframe
            title={`${leagueTitle} — In-depth guide`}
            className="w-full"
            style={{ height: "78vh" }}
            srcDoc={buildDeepGuideHTML(leagueTitle)}
          />
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Tip: If you’re on mobile, rotate to landscape for the “broadcast” feel on Replay & Teams.
        </p>
      </section>
    );
  }

  return (
<section className="content-card p-4 md:p-6">
      <SoloNav setView={setView} title="Guide" />
      <GuideModePicker guideMode={guideMode} setGuideMode={setGuideMode} />
<div className="mb-4">
        <h2 className="text-lg md:text-xl font-extrabold text-squab-900">What this app can do</h2>
        <p className="text-sm text-neutral-600">
          Explore any course and date in Game Explorer — and it builds leaderboards, player views, and reports automatically.
        </p>
      </div>

      {/* Quick cards */}
      <div className="grid lg:grid-cols-3 gap-4 mb-5">
        <div className="rounded-2xl border border-squab-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="chip">⚡</span>
            <h3 className="font-bold text-squab-900">Quick start</h3>
          </div>
          <ol className="list-decimal pl-5 text-sm text-neutral-700 space-y-1">
            <li><span className="font-semibold">Game Explorer</span> → choose a course + date to explore.</li>
            <li>Pick a view from <span className="font-semibold">☰ Menu</span>.</li>
            <li>(Optional) Further functions are available to the Admin/Captain.</li>
          </ol>
        </div>
<div className="rounded-2xl border border-squab-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="chip">🧭</span>
            <h3 className="font-bold text-squab-900">How to navigate</h3>
          </div>
          <ul className="list-disc pl-5 text-sm text-neutral-700 space-y-1">
            <li><span className="font-semibold">☰ Menu</span> = everything (game + season + fun stuff).</li>
            <li><span className="font-semibold">Home</span> returns to the main screen.</li>
            <li><span className="font-semibold">Guide</span> button (bottom-right) opens this page.</li>
                      <li><span className="font-semibold">Tip</span>: in this Guide, click view names to jump straight to that screen.</li>
</ul>
        </div>
      </div>

      {/* Full capability list */}
      <div className="rounded-2xl border border-squab-200 bg-white p-4 md:p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className="chip">🧩</span>
          <h3 className="font-extrabold text-squab-900">Everything it can do (by menu)</h3>
        </div>

        <div className="grid md:grid-cols-2 gap-4 text-sm text-neutral-700">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-neutral-500 mb-2">Round views</div>
            <ul className="space-y-1">
              <li>⛳ <span className="font-semibold">Game</span> — round leaderboard + key totals.</li>
              <li>🧾 <span className="font-semibold">Player Scorecard</span> — per-hole <span className="font-semibold">Gross</span>, Stableford, Yards, SI with player dropdown.</li>
              <li>📈 <span className="font-semibold">Graphs</span> — charts for scoring / trends.</li>
              <li>🗺️ <span className="font-semibold">Course Stats</span> — hole difficulty vs SI, par-type breakdowns.</li>
              <li>⭐ <span className="font-semibold">Ratings</span> — course/tee difficulty + performance splits.</li>
              <li>🧑‍🤝‍🧑 <span className="font-semibold">Head‑to‑Head</span> — compare players.</li>
              <li>🎨 <span className="font-semibold">Styles</span> — style / pattern analysis views.</li>
              <li>📖 <span className="font-semibold">Story</span> — narrative recap of the round.</li>
              <li>🎞️ <span className="font-semibold">Replay</span> — step through the round / highlights.</li>
              <li>👥 <span className="font-semibold">Team Replay</span> — team view / matchplay‑style replay.</li>
            </ul>
          </div>

          <div>
            <div className="text-xs font-black uppercase tracking-wide text-neutral-500 mb-2">Season + extras</div>
            <ul className="space-y-1">
              <li>🧠 <button type="button" className="link" onClick={() => { setView("player_progress"); window.scrollTo(0,0); }}><span className="font-semibold">Insights</span></button> — plain-English performance insights. Explains what’s helping or hurting your score and highlights the quickest scoring gains (uses the same data as Player Progress).</li>
              <li>🏆 <button type="button" className="link" onClick={() => { setView("player_progress"); window.scrollTo(0,0); }}><span className="font-semibold">Par Leaders</span></button> — league leaders by <strong>All Pars</strong>, <strong>Par 3</strong>, <strong>Par 4</strong>, and <strong>Par 5</strong>. Based on points/strokes per hole, with filters for Stableford or Gross.</li>

              <li>🏁 <button type="button" className="link"><span className="font-semibold" onClick={() => { setView("league"); window.scrollTo(0,0); }}>League</span></button> — season standings and points totals.</li>
              <li>🧩 <span className="font-semibold">Eclectic</span> — best score on each hole across the season.</li>
              <li>🗂️ <span className="font-semibold">Analyse Game</span> — pick a past game and deep‑dive.</li>
              <li>📊 <button type="button" className="link" onClick={() => { setView("player_progress"); window.scrollTo(0,0); }}><span className="font-semibold">Player Progress</span></button> — analyse 1/5/10/20/30/ALL games for trends, volatility, and vs field comparisons.</li>
              <li>📝 <span className="font-semibold">Player Report</span> — single-player report across 1/5/10/20/30/ALL games (spot patterns over time).</li>
              <li>💬 <span className="font-semibold">Banter</span> — fun / commentary view.</li>
              <li>🤝 <span className="font-semibold">Partners</span> — partner / duo views.</li>
              <li>🥊 <span className="font-semibold">Rivalry</span> — rivalry comparisons.</li>
              <li>🎰 <span className="font-semibold">Casino</span> — side games / gambling formats.</li>
              <li>🏆 <span className="font-semibold">Trophies</span> — trophies / achievements.</li>
            </ul>
          </div>
        </div>
</div>
    </section>
  
  );
}

function MirrorReadView({ setView }) {
  return (
    <section className="content-card p-4 md:p-6">
      <SoloNav
        setView={setView}
        left={
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn-secondary" onClick={() => setView("player_progress")}>← Back to Performance Mirror</button>
            <button className="btn-secondary" onClick={() => setView("home")}>Home</button>
          </div>
        }
        title="How to read"
      />

      <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Performance Mirror</div>
        <div className="text-2xl md:text-3xl font-black text-neutral-900 mt-1">What the numbers actually mean</div>
        <div className="text-sm text-neutral-600 mt-2">
          Choose your options, then generate a fast, readable summary.
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ===================== Player Progress ===================== */}
        <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Player Progress</div>
              <div className="text-lg font-extrabold text-neutral-900">Trends over time</div>
              <div className="text-sm text-neutral-600 mt-1">
                Uses your chosen window: <span className="font-semibold">1 / 5 / 10 / 20 / 30 / All</span> games.
              </div>
            </div>
            <button className="btn-secondary" onClick={() => setView("player_progress")}>Open</button>
          </div>

          <div className="mt-4 space-y-3 text-sm text-neutral-700">
            <div>
              <div className="font-bold text-neutral-900">Window (1/5/10/20/30/All)</div>
              <div>How many recent games are included. Smaller windows show “current form”, larger ones show “real trend”.</div>
            </div>

            <div>
              <div className="font-bold text-neutral-900">Scoring mode</div>
              <ul className="list-disc ml-5 space-y-1">
                <li><span className="font-semibold">Stableford</span>: higher is better.</li>
                <li><span className="font-semibold">Gross</span>: lower is better (strokes).</li>
              </ul>
            </div>

            <div>
              <div className="font-bold text-neutral-900">Last round</div>
              <div>Your most recent score in the selected mode (stableford points or gross strokes).</div>
            </div>

            <div>
              <div className="font-bold text-neutral-900">Form / Trend (↑ / ↓)</div>
              <div>
                A quick “direction of travel”. It compares your recent chunk (up to the last 5 games) against the previous chunk.
                For gross, down is good (fewer strokes) — the arrow already accounts for that.
              </div>
            </div>

            <div>
              <div className="font-bold text-neutral-900">Consistency (Std Dev)</div>
              <div>
                “How swingy are your rounds?” Lower = steadier. Higher = more up/down performances.
              </div>
            </div>

            <div>
              <div className="font-bold text-neutral-900">Vs Field / Vs Handicap band</div>
              <ul className="list-disc ml-5 space-y-1">
                <li><span className="font-semibold">Vs Field</span>: compares you to the average of everyone in the same events.</li>
                <li><span className="font-semibold">Vs Handicap band</span>: compares you to players with similar handicaps (more “fair”).</li>
              </ul>
              <div className="mt-1">Positive in stableford = good. Positive in gross = also shown as good (because it’s inverted for readability).</div>
            </div>

            <div>
              <div className="font-bold text-neutral-900">The trend chart</div>
              <div>
                Solid line = you. Faint line = field average. The horizontal guide lines give you a quick sense of scale.
              </div>
            </div>
          </div>
        </div>

        {/* ===================== Player Report ===================== */}
        <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Player Report</div>
              <div className="text-lg font-extrabold text-neutral-900">One player, explained</div>
              <div className="text-sm text-neutral-600 mt-1">
                A single‑player breakdown — either the latest round, or averages across a selected window.
              </div>
            </div>
            <button className="btn-secondary" onClick={() => setView("player_progress")}>Open</button>
          </div>

          <div className="mt-4 space-y-3 text-sm text-neutral-700">
            <div>
              <div className="font-bold text-neutral-900">Round vs Window</div>
              <div>
                If you’re looking at the latest round, you’ll see hole‑by‑hole. If you’re in “window” mode, you’ll see averages per hole across the selected games.
              </div>
            </div>

            <div>
              <div className="font-bold text-neutral-900">Hole Map</div>
              <div>
                Each box is a hole. The number is points. Darker usually means a better result. If you see NDB, that hole was adjusted (made up for completeness, WHS-style).
              </div>
            </div>

            <div>
              <div className="font-bold text-neutral-900">Round Highlights</div>
              <ul className="list-disc ml-5 space-y-1">
                <li><span className="font-semibold">Bounce-back</span>: best improvement from one hole to the next.</li>
                <li><span className="font-semibold">Hot stretch</span>: best 3‑hole run.</li>
                <li><span className="font-semibold">Biggest leak (worst hole)</span>: the hole that cost you the most points.</li>
              </ul>
            </div>

            <div>
              <div className="font-bold text-neutral-900">Graph</div>
              <div>
                Shows the score moving game‑to‑game (or hole‑to‑hole depending on the view). The faint horizontal lines are there so you can read the “up/down” properly.
              </div>
            </div>

            <div>
              <div className="font-bold text-neutral-900">Missing holes & WHS adjustment (NDB)</div>
              <div>
                If a hole is missing but the round exists, we fill it as <span className="font-semibold">Net Double Bogey</span> for completeness (WHS style) and mark it
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-black border border-amber-300 bg-amber-100 text-amber-900 ml-2">NDB</span>.
                That prevents “17 holes looking like an 18‑hole 78” and keeps averages fair.
              </div>
            </div>

            <div>
              <div className="font-bold text-neutral-900">9 holes vs 18 holes</div>
              <div>
                If nobody recorded holes 10–18, the app treats it as a 9‑hole round and only analyses the front 9. (So “finish” stats use holes 6–9 for 9‑holers.)
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-black text-neutral-900">Quick tips</div>
        <ul className="mt-2 text-sm text-neutral-700 list-disc ml-5 space-y-1">
          <li>If something looks “too good to be true”, check whether the round had missing holes before adjustment.</li>
          <li>Use small windows (5/10) for form, and larger windows (20/30/All) for genuine trend.</li>
          <li>“Vs Field” answers “how did I do compared to everyone today?” while “Vs Handicap band” answers “how did I do compared to my peers?”</li>
        </ul>
      </div>
    </section>
  );
}

function FullReportView({ seasonModel, seasonPlayer, seasonYear, seasonLimit, setView }) {
  const model = seasonModel || {};
  const players = Array.isArray(model.players) ? model.players : [];
  const field = model.field || {};
  const current = players.find(p => (p?.name || "") === (seasonPlayer || "")) || players[0] || null;

  if (!current) {
    return (
      <section className="content-card p-4 md:p-6">
        <Breadcrumbs items={[{ label: "Full Report" }]} />
        <p className="text-neutral-600">Run season analysis first, then pick a player.</p>
      </section>
    );
  }

  // --- Scope label ---
  const titleBits = [];
  if (seasonYear && String(seasonYear).toLowerCase() !== "all") titleBits.push(String(seasonYear));
  if (seasonLimit && String(seasonLimit).toLowerCase() !== "all") titleBits.push(`Last ${seasonLimit}`);
  const scopeLabel = titleBits.length ? titleBits.join(" · ") : "All games";

  // --- Round counts ---
  const nRounds = PR_num(current?.rounds, 0);
  const peerPlayers = players.filter(p => p && p.name && !(typeof isTeamLike === "function" && isTeamLike(p.name)));
  const peerPlayersNoMe = peerPlayers.filter(p => p && p.name && p.name !== (current?.name || ""));
  const peerN = peerPlayers.length || 0;

  // --- Stableford vs field (per hole + per round) ---
  // IMPORTANT: field baseline is computed the same way as Player Report (average of players, excluding current player)
  const _srSorted = (p) => {
    const s = Array.isArray(p?.series) ? p.series.slice() : [];
    s.sort((a,b)=> (Number(a?.dateMs)||Number(a?.idx)||0) - (Number(b?.dateMs)||Number(b?.idx)||0));
    return s;
  };
  const _latestOrAvgLocal = (arr, useLatest) => {
    const a = Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : [];
    if (!a.length) return NaN;
    return useLatest ? a[a.length - 1] : (a.reduce((s,v)=>s+v,0) / a.length);
  };
  const useLatestStable = (PR_num(current?.rounds, 0) === 1);

  const sCurStable = _srSorted(current);
  const ptsNowPR = useLatestStable
    ? PR_num((sCurStable.slice(-1)[0] || {}).pts, NaN)
    : _latestOrAvgLocal(sCurStable.map(x=>x.pts), false);

  const ptsFieldPR = useLatestStable
    ? _latestOrAvgLocal(peerPlayersNoMe.map(p => (_srSorted(p).slice(-1)[0] || {}).pts), true)
    : _latestOrAvgLocal(peerPlayersNoMe.map(p => _latestOrAvgLocal(_srSorted(p).map(x=>x.pts), false)), false);

  // WHS-style: convert per-round to per-hole using actual holes-per-round in the window (not hard-coded 18)
  const _totalHolesWindow_pts = (() => {
    const src = (current?.byParGross || current?.byPar || {});
    return Object.values(src).reduce((a, r) => a + PR_num(r?.holes || r?.n || r?.count || 0, 0), 0);
  })();
  const _holesPerRoundWindow_pts = (Number(games) > 0 && _totalHolesWindow_pts > 0) ? (_totalHolesWindow_pts / Number(games)) : 18;

  const pPtsPH = Number.isFinite(ptsNowPR) ? (ptsNowPR / _holesPerRoundWindow_pts) : NaN;
  const fPtsPH = Number.isFinite(ptsFieldPR) ? (ptsFieldPR / _holesPerRoundWindow_pts) : NaN;
  const ptsDeltaPR = (Number.isFinite(ptsNowPR) && Number.isFinite(ptsFieldPR)) ? (ptsNowPR - ptsFieldPR) : NaN;
  const ptsDeltaPH = Number.isFinite(ptsDeltaPR) ? (ptsDeltaPR / _holesPerRoundWindow_pts) : NaN;

  // --- Gross vs course (strokes over par) ---
  const series = Array.isArray(current?.series) ? current.series : [];
  const grossOverArr = series
    .map(x => {
      const g = PR_num(x?.gross, NaN);
      const par = PR_num(x?.parTotal, NaN);
      if (!Number.isFinite(g) || !Number.isFinite(par) || par <= 0) return NaN;
      return g - par;
    })
    .filter(Number.isFinite);

  const grossOverAvg = grossOverArr.length ? grossOverArr.reduce((a,b)=>a+b,0)/grossOverArr.length : NaN;

  // --- Trend & volatility (already computed in model) ---
  const ptsTrend = PR_num(current?.metrics?.velocity, NaN);      // +ve = improving points
  const ptsVol = PR_num(current?.metrics?.volPts, NaN);
  const grossTrend = PR_num(current?.metrics?.grossVelocity, NaN); // -ve = improving (lower gross)
  const grossVol = PR_num(current?.metrics?.volGross, NaN);

  // --- Performance Mirror summary (if present) ---
  const tpa = PR_num(current?.mirror?.tpa, NaN);
  const tpaTrend = PR_num(current?.mirror?.tpaTrend, NaN);
  const blobsPR = PR_num(current?.mirror?.blobsPerRound, NaN);
  const toHcpPct = PR_num(current?.mirror?.toHcpPct, NaN);

  const fmtSigned = (v, d=1) => !Number.isFinite(v) ? "—" : (v === 0 ? "0.0" : (v > 0 ? `+${PR_fmt(v,d)}` : `${PR_fmt(v,d)}`));
  const fmtSignedSmart = (v, dpDefault=2) => {
    const x = Number(v);
    if (!Number.isFinite(x)) return "—";
    const ax = Math.abs(x);
    const dp = (ax > 0 && ax < 0.01) ? 3 : dpDefault;
    const s = x > 0 ? "+" : "";
    return s + x.toFixed(dp);
  };
  const fmtMaybe = (v, d=1) => !Number.isFinite(v) ? "—" : PR_fmt(v,d);
  const goodClassPts = (v) => !Number.isFinite(v) ? "text-neutral-400" : (v > 0 ? "text-emerald-700" : (v < 0 ? "text-red-700" : "text-neutral-700"));
  const goodClassGross = (v) => !Number.isFinite(v) ? "text-neutral-400" : (v < 0 ? "text-emerald-700" : (v > 0 ? "text-red-700" : "text-neutral-700"));

  // --- Definitions (copy) ---
  const explainers = {
    stablefordVsField: "Stableford vs field tells you how many points you gain/lose compared to the average player in this society. It's your 'league pace'.",
    grossVsCourse: "Gross vs course tells you how you score against par (the course itself). This ignores handicap and shows pure scoring.",
    trend: "Trend is the direction your results are moving. Up in Stableford is good. Down in Gross is good.",
    volatility: "Volatility is how 'swingy' your rounds are. Low = steady. High = rollercoaster.",
    mirror: "Performance Mirror is the one-page story: how good you are right now, where you leak shots/points, and what to fix next."
  };

  return (
    <div className="min-h-screen p-4 sm:p-6 bg-neutral-50">
      <div className="app-shell space-y-4 pt-1">
        <section className="content-card p-4 md:p-6">
          <Breadcrumbs items={[
            { label: "Player Report", onClick: () => setView("player_progress") },
            { label: "Full Report" }
          ]} />

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Full report · {scopeLabel}</div>
              <div className="text-2xl font-extrabold text-neutral-900">{current?.name || "Player"}</div>
              <div className="text-sm text-neutral-500">Rounds analysed: <span className="font-semibold text-neutral-700">{nRounds}</span> · Field size: <span className="font-semibold text-neutral-700">{peerN}</span></div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <button className="chip" onClick={() => setView("player_progress")}>Performance Mirror</button>
              <button className="chip" onClick={() => setView("player_progress")}>Player Report</button>
              
            </div>
          </div>
        </section>

        {/* HERO SUMMARY */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 lg:col-span-2">
            <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide mb-2">Headline performance</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4">
                <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Stableford vs field</div>
                <div className={"mt-2 text-3xl font-extrabold " + goodClassPts(ptsDeltaPR)}>{fmtSigned(ptsDeltaPR,1)} <span className="text-sm font-bold text-neutral-500">pts / round</span></div>
                <div className="mt-2 text-sm text-neutral-600">{explainers.stablefordVsField}</div>
              </div>
              <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4">
                <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Gross vs course (par)</div>
                <div className={"mt-2 text-3xl font-extrabold " + goodClassGross(grossOverAvg)}>{!Number.isFinite(grossOverAvg) ? "—" : (grossOverAvg===0 ? "E" : (grossOverAvg>0?`+${PR_fmt(grossOverAvg,1)}`:`${PR_fmt(grossOverAvg,1)}`))} <span className="text-sm font-bold text-neutral-500">strokes</span></div>
                <div className="mt-2 text-sm text-neutral-600">{explainers.grossVsCourse}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide mb-2">Momentum</div>
            <div className="space-y-3">
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Stableford trend</div>
                <div className={"text-2xl font-extrabold " + goodClassPts(ptsTrend)}>{fmtSigned(ptsTrend,2)} <span className="text-xs font-bold text-neutral-500">pts / round / game</span></div>
                <div className="text-sm text-neutral-600 mt-1">{explainers.trend}</div>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Gross trend</div>
                <div className={"text-2xl font-extrabold " + (Number.isFinite(grossTrend) ? (grossTrend<0?"text-emerald-700":grossTrend>0?"text-red-700":"text-neutral-700") : "text-neutral-400")}>{fmtSigned(grossTrend,2)} <span className="text-xs font-bold text-neutral-500">strokes / round / game</span></div>
                <div className="text-sm text-neutral-600 mt-1">Down is good (fewer strokes).</div>
              </div>
            </div>
          </div>
        </section>

        {/* PERFORMANCE MIRROR EXPLAINED */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 md:p-6">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Performance Mirror explained</div>
              <div className="text-xl font-extrabold text-neutral-900">What the “Player Progress” page is telling you</div>
              <div className="text-sm text-neutral-600 mt-1">{explainers.mirror}</div>
            </div>
            <button className="btn-primary" onClick={() => setView("player_progress")}>Open Performance Mirror</button>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4 pro-overview-grid">
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">True Playing Ability</div>
              <div className="mt-2 text-3xl font-extrabold text-neutral-900">{Number.isFinite(tpa) ? PR_fmt(tpa,1) : "—"}</div>
              <div className="text-sm text-neutral-600 mt-2">One number that blends results + consistency. Higher = playing better right now.</div>
              <div className="text-sm text-neutral-600 mt-1">Trend: <span className={goodClassPts(tpaTrend)}>{fmtSigned(tpaTrend,2)}</span></div>
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Damage control</div>
              <div className="mt-2 text-3xl font-extrabold text-neutral-900">{Number.isFinite(blobsPR) ? PR_fmt(blobsPR,1) : "—"}</div>
              <div className="text-sm text-neutral-600 mt-2">Blobs per round (0-point holes). Fewer blobs = fewer disasters.</div>
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Holes played to handicap</div>
              <div className="mt-2 text-3xl font-extrabold text-neutral-900">{Number.isFinite(toHcpPct) ? `${PR_fmt(toHcpPct,0)}%` : "—"}</div>
              <div className="text-sm text-neutral-600 mt-2">How often you meet or beat your expected result on a hole.</div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="text-sm font-bold text-neutral-900">How to read “progress” (forward vs backwards)</div>
            <ul className="mt-2 text-sm text-neutral-700 list-disc ml-5 space-y-1">
              <li><span className="font-semibold">Forward</span> means: Stableford vs field is rising, gross vs par is falling, volatility is tightening.</li>
              <li><span className="font-semibold">Backwards</span> means: points vs field are slipping or gross vs par is drifting up — usually driven by a specific leak bucket.</li>
              <li>If trend is flat but volatility drops, that’s still a win — you’re becoming repeatable.</li>
            </ul>
          </div>
        </section>

        {/* PLAYER REPORT EXPLAINED */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 md:p-6">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Player Report explained</div>
              <div className="text-xl font-extrabold text-neutral-900">The detail: where you win and where you leak</div>
              <div className="text-sm text-neutral-600 mt-1">This section breaks your scoring down by Par, SI band, and Yardage band. You can compare vs the field (Stableford) or vs par (Gross).</div>
            </div>
            <button className="btn-primary" onClick={() => setView("player_progress")}>Open Player Report</button>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="text-sm font-extrabold text-neutral-900">Stableford (against the field)</div>
              <div className="text-sm text-neutral-700 mt-2">
                <div className="font-semibold">What you’re looking for:</div>
                <ul className="list-disc ml-5 mt-1 space-y-1">
                  <li><span className="font-semibold">Positive deltas</span> = you score more points than the field in that bucket.</li>
                  <li><span className="font-semibold">Per hole</span> shows small edges; <span className="font-semibold">per round</span> shows impact.</li>
                  <li>The “worst weighted leak” is your biggest, most fixable points drain over a full round.</li>
                </ul>
              </div>

              <div className="mt-3 rounded-xl bg-white border border-neutral-200 p-3">
                <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Your headline</div>
                <div className={"text-2xl font-extrabold " + goodClassPts(ptsDeltaPR)}>{fmtSigned(ptsDeltaPR,1)} pts / round</div>
                <div className="text-sm text-neutral-600 mt-1">That’s your league pace versus the average player today.</div>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="text-sm font-extrabold text-neutral-900">Gross (against the course)</div>
              <div className="text-sm text-neutral-700 mt-2">
                <div className="font-semibold">What you’re looking for:</div>
                <ul className="list-disc ml-5 mt-1 space-y-1">
                  <li><span className="font-semibold">Negative vs par</span> is excellent (under par). <span className="font-semibold">Positive</span> means over par.</li>
                  <li>Gross is unforgiving — it shows pure scoring quality independent of handicap.</li>
                  <li>Use it to track “real golf” improvement as your handicap changes.</li>
                </ul>
              </div>

              <div className="mt-3 rounded-xl bg-white border border-neutral-200 p-3">
                <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Your headline</div>
                <div className={"text-2xl font-extrabold " + goodClassGross(grossOverAvg)}>{!Number.isFinite(grossOverAvg) ? "—" : (grossOverAvg===0 ? "E" : (grossOverAvg>0?`+${PR_fmt(grossOverAvg,1)}`:`${PR_fmt(grossOverAvg,1)}`))} strokes vs par</div>
                <div className="text-sm text-neutral-600 mt-1">That’s how you play the course itself.</div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="text-sm font-bold text-neutral-900">Glossary (plain English)</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2 text-sm text-neutral-700">
              <div><span className="font-semibold">Per hole</span> — your average result on each hole inside a bucket.</div>
              <div><span className="font-semibold">Per round impact</span> — what that bucket costs/gains over 18 holes.</div>
              <div><span className="font-semibold">Weighted leak</span> — worst bucket after multiplying by how often it occurs.</div>
              <div><span className="font-semibold">Volatility</span> — how variable you are: {Number.isFinite(ptsVol) ? `${PR_fmt(ptsVol,2)} pts` : "—"} (Stableford), {Number.isFinite(grossVol) ? `${PR_fmt(grossVol,2)} strokes` : "—"} (Gross).</div>
            </div>
          </div>
        </section>

        {/* PUNCHY SUMMARY */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 md:p-6">
          <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Punchy summary</div>
          <div className="text-xl font-extrabold text-neutral-900 mt-1">So... how are you playing?</div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Against the field</div>
              <div className={"text-2xl font-extrabold " + goodClassPts(ptsDeltaPR)}>{fmtSigned(ptsDeltaPR,1)} pts/round</div>
              <div className="text-sm text-neutral-600 mt-1">This is your competitive edge (or gap).</div>
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Against the course</div>
              <div className={"text-2xl font-extrabold " + goodClassGross(grossOverAvg)}>{!Number.isFinite(grossOverAvg) ? "—" : (grossOverAvg===0 ? "E" : (grossOverAvg>0?`+${PR_fmt(grossOverAvg,1)}`:`${PR_fmt(grossOverAvg,1)}`))}</div>
              <div className="text-sm text-neutral-600 mt-1">Pure scoring quality vs par.</div>
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Consistency</div>
              <div className="text-2xl font-extrabold text-neutral-900">{Number.isFinite(ptsVol) ? PR_fmt(ptsVol,2) : "—"}</div>
              <div className="text-sm text-neutral-600 mt-1">Lower = steadier. {Number.isFinite(ptsVol) && ptsVol>2.5 ? "You’re a rollercoaster — fixing disasters beats chasing birdies." : "You’re steady — small gains add up."}</div>
            </div>
          </div>

          <div className="mt-4 flex gap-2 flex-wrap">
            <button className="btn-primary" onClick={() => setView("player_progress")}>Go to Performance Mirror</button>
            <button className="chip" onClick={() => setView("player_progress")}>Go to Player Report</button>
          </div>
        </section>
      </div>
    </div>
  );
}


function QAReportBuilder({
  seasonModel,
  reportNextHcapMode,
  setReportNextHcapMode,
  seasonYears,
  seasonPlayer,
  setSeasonPlayer,
  seasonYear,
  setSeasonYear,
  seasonLimit,
  setSeasonLimit,
  scoringMode,
  setScoringMode,
  setQaLaunch,
  runSeasonAnalysis,
  seasonLoading,
  seasonError,
  seasonProgress,
  setView,
}) {
  const players = React.useMemo(() => {
    const arr = (seasonModel?.players || []).map(p => p?.name).filter(Boolean);
    return Array.from(new Set(arr)).sort((a,b) => String(a).localeCompare(String(b)));
  }, [seasonModel]);

  const limits = React.useMemo(() => (["1","5","10","20","30","All"]), []);

  const [p, setP] = React.useState(seasonPlayer || "");
  const [y, setY] = React.useState(seasonYear || "All");
  const [l, setL] = React.useState(seasonLimit || "All");
  const [m, setM] = React.useState(scoringMode || "stableford");

  React.useEffect(() => {
    if (!p && players.length) setP(players[0]);
  }, [players, p]);

  const canRun = !!seasonModel && players.length;
  const controlsDisabled = !seasonModel || !players.length;

  const goRun = () => {
    if (typeof runSeasonAnalysis === "function") runSeasonAnalysis({ afterView: "qa_report" });
  };

  const submit = () => {
    if (!canRun) return;
    setSeasonPlayer(p);
    setSeasonYear(y);
    setSeasonLimit(l);
    setScoringMode(m);
    if (typeof setQaLaunch === "function") setQaLaunch(true);
    setView("player_progress");
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch(e) {}
  };

  return (
    <section className="glass-card p-4 md:p-6">
      <SoloNav
        setView={setView}
        left={
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn-secondary" onClick={() => setView("home")}>Home</button>
            <button className="btn-secondary" onClick={() => setView("player_progress")}>Player Report</button>
          </div>
        }
        title="Insights"
      />
      <ImproveTopNav active="summary" setView={setView} />
          <SeasonSelectionBar
            seasonModel={seasonModel}
            seasonPlayer={seasonPlayer}
            setSeasonPlayer={setSeasonPlayer}
            seasonYear={seasonYear}
            setSeasonYear={setSeasonYear}
            seasonLimit={seasonLimit}
            setSeasonLimit={setSeasonLimit}
            seasonYears={seasonYears}
            scoringMode={scoringMode}
            setScoringMode={setScoringMode}
          />


      <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Quick Improvement Summary</div>
        <div className="text-2xl md:text-3xl font-black text-neutral-900 mt-1">Player | Most Recent Games | Year | Stableford / Gross</div>
        <div className="text-sm text-neutral-600 mt-2">
          This uses the same dataset as Player Progress/Report, but turns it into a “question + answer” summary people can read fast.
        </div>

        {!seasonModel && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="font-black text-amber-900">Season analysis hasn’t been run yet</div>
            <div className="text-sm text-amber-900/80 mt-1">
              Click <span className="font-semibold">Run Player Progress</span> to load all rounds, then come back here.
            </div>
            <div className="mt-3 flex gap-2 flex-wrap">
              <button className="btn-primary" onClick={goRun} disabled={!!seasonLoading}>
                {seasonLoading ? "Loading..." : "Run Player Progress"}
              </button>
              <button className="btn-secondary" onClick={() => setView("home")}>Back</button>
            </div>
            {seasonError && (
              <div className="mt-3 text-sm text-rose-700">{String(seasonError)}</div>
        )}
          </div>
            )}

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-black tracking-widest uppercase text-neutral-400 mb-1">Player</div>
              <select className="w-full rounded-2xl border border-neutral-200 px-3 py-2.5 bg-white text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                value={p}
                onChange={(e) => setP(e.target.value)}
                disabled={controlsDisabled}
              >
                {controlsDisabled ? (<option value="">Run Player Progress to load players...</option>) : null}
                {players.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            <div>
              <div className="text-xs font-black tracking-widest uppercase text-neutral-400 mb-1">Year</div>
              <select className="w-full rounded-2xl border border-neutral-200 px-3 py-2.5 bg-white text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                value={y}
                disabled={controlsDisabled}
                onChange={(e) => setY(e.target.value)}
              >
                {(seasonYears && seasonYears.length ? seasonYears : ["All"]).map(yy => (
                  <option key={yy} value={yy}>{yy}</option>
                ))}
              </select>
            </div>

            <div>
              <div className="text-xs font-black tracking-widest uppercase text-neutral-400 mb-1">Most Recent Games</div>
              <select className="w-full rounded-2xl border border-neutral-200 px-3 py-2.5 bg-white text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                value={l}
                disabled={controlsDisabled}
                onChange={(e) => setL(e.target.value)}
              >
                {limits.map(v => <option key={v} value={v}>{v === "All" ? "All games" : `${v} games`}</option>)}
              </select>
            </div>

            <div>
              <div className="text-xs font-black tracking-widest uppercase text-neutral-400 mb-1">Scoring</div>
              <div className="inline-flex w-full rounded-2xl border border-neutral-200 bg-neutral-50 p-1">
                <button
                  className={(String(m)==="stableford") ? "flex-1 px-3 py-2 rounded-xl bg-white shadow-sm font-black text-neutral-900" : "flex-1 px-3 py-2 rounded-xl font-black text-neutral-500 hover:text-neutral-900"}
                  onClick={() => setM("stableford")}
                  type="button"
                  disabled={controlsDisabled}
                >
                  Stableford
                </button>
                <button
                  className={(String(m)==="gross") ? "flex-1 px-3 py-2 rounded-xl bg-white shadow-sm font-black text-neutral-900" : "flex-1 px-3 py-2 rounded-xl font-black text-neutral-500 hover:text-neutral-900"}
                  onClick={() => setM("gross")}
                  type="button"
                  disabled={controlsDisabled}
                >
                  Gross
                </button>
              </div>
            </div>
          </div>


        {seasonModel && (
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <button className="btn-primary" onClick={submit} disabled={!canRun}>Generate Improvement Summary</button>
            <button className="btn-secondary" onClick={() => setView("home")}>Cancel</button>
            {seasonLoading && (
              <span className="text-xs font-bold text-neutral-500">Loading: {seasonProgress ? `${seasonProgress}%` : "..."}</span>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 text-xs text-neutral-500">
        Tip: Pick <span className="font-semibold">10 games</span> for “recent form”, or <span className="font-semibold">All</span> for your true baseline.
      </div>
    </section>
  );
}

function PlayerInsightsView({
  seasonModel,
  seasonRoundsFiltered,
  scoringMode,
  setScoringMode,
  seasonPlayer,
  setSeasonPlayer,
  seasonYear,
  setSeasonYear,
  seasonLimit,
  setSeasonLimit,
  seasonYears,
  seasonLoading,
  seasonProgress,
  seasonError,
  runSeasonAnalysis,
  reportNextHcapMode,
  setReportNextHcapMode,
  onOpenImproveReport,
  setView,
}) {
  // Reuse the same computation style as PlayerProgress, but focus on ranked priorities.
  const _num = (x, d=NaN) => PR_num(x, d);
  const _mean = (arr) => {
    const xs = (arr||[]).map(Number).filter(Number.isFinite);
    return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : NaN;
  };
  const _fmt = (n, d=1) => PR_fmt(n, d);


  // Suggestion helper (used by some explanatory text). Keep it neutral; focus cards have their own advice engine.
  const edgeSuggestion = (row) => "Pick a safe target, commit to one simple constraint, and measure it over the next 3–5 rounds.";
  const cur = React.useMemo(() => {
    const ps = seasonModel?.players || [];
    return ps.find(p => p.name === seasonPlayer) || ps[0] || null;
  }, [seasonModel, seasonPlayer]);

  const field = seasonModel?.field || {};
  const series = Array.isArray(cur?.series) ? cur.series.slice() : [];
  const games = series.length || PR_num(cur?.rounds, 0);

  // --- Problem holes (only shown when the player has played the same course 2+ times in the current filter window) ---


  // --- Problem holes (same setup): your worst Stableford holes on your most-played Course + Tee ---
  const problemHolePack = React.useMemo(() => {
    try {
      return PR_buildProblemHolePack(series);
    } catch (e) {
      return { ok:false, reason:"error" };
    }
  }, [series]);


  const avgPtsPH = (agg) => (agg && agg.holes ? (Number(agg.pts) / Number(agg.holes)) : NaN);
  const avgOverParPH = (agg) => (agg && agg.holes ? (Number(agg.val) / Number(agg.holes)) : NaN);
  const goodDelta = PR_goodDelta;

  const buildRows = (dim, meObj, fldObj, isGross) => {
    const rows = [];
    const roundsCount = (games && games > 0) ? games : 1;
    Object.keys(meObj || {}).forEach(k => {
      const meAgg = meObj?.[k];
      const fldAgg = fldObj?.[k];
      const holes = _num(meAgg?.holes, 0);
      if (!holes) return;
      const mePH = isGross ? avgOverParPH(meAgg) : avgPtsPH(meAgg);
      const fldPH = isGross ? avgOverParPH(fldAgg) : avgPtsPH(fldAgg);
      const dGood = goodDelta(isGross ? "gross" : "stableford", mePH, fldPH); // per hole
      const holesPerRound = holes / roundsCount;
      const impactRd = dGood * holesPerRound;
      rows.push({ key:k, label:`${dim} ${k}`, holes, mePH, fldPH, dGood, impactRd });
    });
    rows.sort((a,b)=> Math.abs(b.impactRd) - Math.abs(a.impactRd));
    return rows;
  };

  // --- Lens: keep Insights consistent with Player Progress (single source of truth) ---
  const [ppBarsMode, setPpBarsMode] = React.useState(() => {
    try { return localStorage.getItem("dsl_lens") || "pointsField"; } catch (e) { return "pointsField"; }
  });
  React.useEffect(() => {
    const sync = () => {
      try {
        const v = localStorage.getItem("dsl_lens") || "pointsField";
        if (v === "pointsField" || v === "strokesField" || v === "strokesPar") {
          setPpBarsMode(prev => (prev === v ? prev : v));
        }
      } catch (e) {}
    };
    window.addEventListener("dsl_lens_change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("dsl_lens_change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const compField = field; // Insights summary uses the same comparator as Player Progress (field avg or par baseline)
  const barsIsGross = ppBarsMode !== "pointsField";
  const barsCompare = (ppBarsMode === "strokesPar") ? "par" : "field"; // field | par

  const makeParBaseline = (meObj) => {
    const out = {};
    Object.keys(meObj || {}).forEach(k => {
      const h = _num(meObj?.[k]?.holes, 0);
      if (h) out[k] = { holes: h, val: 0 };
    });
    return out;
  };

  const parMeObj = barsIsGross ? (cur?.byParGross || {}) : (cur?.byPar || {});
  const parFdObj = (barsCompare === "par")
    ? makeParBaseline(parMeObj)
    : (barsIsGross ? (compField?.byParGross || {}) : (compField?.byPar || {}));
  const parRows = buildRows("Par", parMeObj, parFdObj, barsIsGross);

  const siMeObj = barsIsGross ? (cur?.bySIGross || {}) : (cur?.bySI || {});
  const siFdObj = (barsCompare === "par")
    ? makeParBaseline(siMeObj)
    : (barsIsGross ? (compField?.bySIGross || {}) : (compField?.bySI || {}));
  const siRows  = buildRows("SI", siMeObj, siFdObj, barsIsGross);

  const ydMeObj = barsIsGross ? (cur?.byYardsGross || {}) : (cur?.byYards || {});
  const ydFdObj = (barsCompare === "par")
    ? makeParBaseline(ydMeObj)
    : (barsIsGross ? (compField?.byYardsGross || {}) : (compField?.byYards || {}));
  const ydRows  = buildRows("Yds", ydMeObj, ydFdObj, barsIsGross);

  const isGross = barsIsGross;
  const allRows = [...parRows, ...siRows, ...ydRows].filter(r => Number.isFinite(r?.impactRd));
  const priorities = allRows.slice().sort((a,b)=>a.impactRd-b.impactRd).slice(0,3);
  const strengths  = allRows.slice().sort((a,b)=>b.impactRd-a.impactRd).slice(0,3);

  const expectedGain = priorities.reduce((s,r)=> s + (Number.isFinite(r.impactRd) ? Math.max(0, -r.impactRd) : 0), 0);

  if (seasonLoading) {
    return (
      <section className="glass-card pm-scope p-4 md:p-6">
      <div className="pm-accent-rail" aria-hidden="true"></div>
        <Breadcrumbs items={[{ label: "Insights" }]} />
        <ImproveTopNav active="summary" setView={setView} />
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Loading season analysis... {seasonProgress ? `(${seasonProgress}%)` : ""}
        </div>
      </section>
    );
  }

  if (seasonError) {
    return (
      <section className="glass-card p-4 md:p-6">
        <Breadcrumbs items={[{ label: "Insights" }]} />
        <ImproveTopNav active="summary" setView={setView} />
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{String(seasonError)}</div>
      </section>
    );
  }

  if (!seasonModel || !cur) {
    return (
      <section className="glass-card p-4 md:p-6">
        <Breadcrumbs items={[{ label: "Insights" }]} />
        <ImproveTopNav active="summary" setView={setView} />
        <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="font-black text-neutral-900">Run season analysis first</div>
          <div className="text-sm text-neutral-600 mt-1">We need the full season model to generate ranked insights.</div>
          <button className="btn-primary mt-3" onClick={() => runSeasonAnalysis && runSeasonAnalysis({ afterView: "qa_report" })}>Run analysis</button>
        </div>
      </section>
    );
  }

  const Row = ({ r, idx, kind }) => {
    const impact = Number(r?.impactRd);
    const good = Number.isFinite(impact) ? impact >= 0 : null;
    const tone = good === null ? "text-neutral-400" : (good ? "text-emerald-700" : "text-rose-700");
    const unit = isGross ? "strokes" : "pts";
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black tracking-widest uppercase text-neutral-400">
              {kind} #{idx+1}
            </div>
            <div className="mt-1 text-lg font-black text-neutral-900 truncate">{r?.label || "—"}</div>
            <div className="mt-1 text-sm text-neutral-600">
              {Number.isFinite(r?.holes) ? `${Math.round(r.holes)} holes of evidence` : "—"}
            </div>
          </div>
          <div className={"text-right " + tone}>
            <div className="text-2xl font-black tabular-nums">{Number.isFinite(impact) ? (impact>=0?"+":"") + _fmt(impact,1) : "—"}</div>
            <div className="text-[11px] font-black tracking-widest uppercase opacity-70">/{unit}/rd</div>
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-neutral-100 bg-neutral-50 p-3 text-sm text-neutral-800">
          <div className="font-black text-neutral-900">What this is measuring</div>
          <div className="mt-1 text-neutral-700">
            {(() => {
              const label = String(r?.label || "");
              if (/^Yds/i.test(label)) return "This groups holes/shots where you started the scoring decision from this yardage band (typically tee shots or long approaches).";
              if (/^SI/i.test(label)) return "This groups holes by Stroke Index (difficulty ranking: 1 = hardest).";
              return "This groups performance for this category.";
            })()}
          </div>

          <div className="mt-2 font-black text-neutral-900">Why it matters</div>
          <div className="mt-1 text-neutral-700">
            {Number.isFinite(impact) ? (() => {
              const abs = _fmt(Math.abs(impact), 1);
              const comp = (typeof barsCompare !== "undefined" && barsCompare === "par") ? "par" : "the field";
              if (impact === 0) return `You're exactly neutral here versus ${comp}.`;

              // impactRd is already normalized so + is always "good"
              if (typeof barsCompare !== "undefined" && barsCompare === "par") {
                return impact >= 0
                  ? `This is saving you about ${abs} ${unit} per round versus ${comp}.`
                  : `This is costing you about ${abs} ${unit} per round versus ${comp}.`;
              }

              return impact >= 0
                ? `This is adding about ${abs} ${unit} per round versus ${comp}.`
                : `This is costing you about ${abs} ${unit} per round versus ${comp}.`;
            })() : "Not enough data to estimate impact yet."}
          </div>

          <div className="mt-2 text-xs text-neutral-500">
            The <span className="font-black">Final</span> tab turns this into a specific on-course plan.
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="glass-card p-4 md:p-6">
      <Breadcrumbs items={[{ label: "Insights" }]} />
      <ImproveTopNav active="summary" setView={setView} />
      <SeasonSelectionBar
        seasonModel={seasonModel}
        seasonPlayer={seasonPlayer}
        setSeasonPlayer={setSeasonPlayer}
        seasonYear={seasonYear}
        setSeasonYear={setSeasonYear}
        seasonLimit={seasonLimit}
        setSeasonLimit={setSeasonLimit}
        seasonYears={seasonYears}
        scoringMode={scoringMode}
        setScoringMode={setScoringMode}
      />

            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button className="chip special" onClick={() => onOpenImproveReport && onOpenImproveReport()}>
          How can I improve?
        </button>
      </div>

      {/* Headline */}
      <div className="mt-4 rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-black tracking-widest uppercase text-neutral-400">What matters most</div>
        <div className="mt-1 text-2xl md:text-3xl font-black text-neutral-900">
          Top 3 priorities · expected gain about +{_fmt(expectedGain,1)}/{isGross ? "strokes" : "pts"} per round
        </div>
        <div className="mt-2 text-sm text-neutral-600">
          Ranked by impact {barsCompare === "par" ? "vs par" : "vs field"} across Par / SI / Yardage buckets. Fix the top 1–2 for 3–5 rounds, then re-check.
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
        {(priorities.length ? priorities : [{label:"—"}]).map((r,i)=>(
          <Row key={"p"+i} r={r} idx={i} kind="Priority" />
        ))}

      {problemHolePack && problemHolePack.ok && (
        <div className="mt-4 lg:col-span-3 rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Problem holes</div>
              <div className="mt-1 text-lg md:text-xl font-black text-neutral-900">
                Where you leak points on the same setup
              </div>
              <div className="mt-1 text-sm text-neutral-600">
                Using your most-played combo: {problemHolePack.courseName}{problemHolePack.teeName ? ` · ${problemHolePack.teeName}` : ""} ({problemHolePack.rounds} rounds)
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(problemHolePack.flagged && problemHolePack.flagged.length ? problemHolePack.flagged : problemHolePack.rows).slice(0, 6).map((r) => (
              <span
                key={"phchip"+r.hole}
                className={"inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-black border " + ((Number(r.vsOverall) <= -0.5) ? "border-rose-200 bg-rose-50 text-rose-700" : "border-neutral-200 bg-neutral-50 text-neutral-700")}
              >
                Hole {r.hole}: {_fmt(r.avg, 2)} pts
              </span>
            ))}
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50">
                <tr className="text-left">
                  <th className="px-4 py-3 font-black text-neutral-600">HOLE</th>
                  <th className="px-4 py-3 font-black text-neutral-600">AVG PTS</th>
                  <th className="px-4 py-3 font-black text-neutral-600">VS YOUR OVERALL</th>
                  <th className="px-4 py-3 font-black text-neutral-600">SAMPLES</th>
                </tr>
              </thead>
              <tbody>
                {problemHolePack.rows.slice(0, 10).map((r) => (
                  <tr key={"phr"+r.hole} className="border-t border-neutral-200">
                    <td className="px-4 py-3 font-black text-neutral-900">{r.hole}</td>
                    <td className="px-4 py-3 text-neutral-900">{_fmt(r.avg, 2)}</td>
                    <td className={"px-4 py-3 font-black " + ((Number(r.vsOverall) <= -0.5) ? "text-rose-700" : "text-neutral-700")}>
                      {Number.isFinite(Number(r.vsOverall)) ? ((r.vsOverall>=0?"+":"") + _fmt(r.vsOverall, 2)) : "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{r.samples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-sm text-neutral-600">
            These holes are highlighted because they are consistently below your normal points-per-hole on this setup. With more rounds, this becomes even more reliable.
          </div>
        </div>
      )}

      </div>

      <div className="mt-4 rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Strengths</div>
        <div className="mt-1 text-lg font-black text-neutral-900">Keep these — don’t “fix” what isn’t broken</div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          {(strengths.length ? strengths : [{label:"—"}]).map((r,i)=>(
            <div key={"s"+i} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="text-[10px] font-black tracking-widest uppercase text-neutral-500">Strength #{i+1}</div>
              <div className="mt-1 font-black text-neutral-900 truncate">{r?.label || "—"}</div>
              <div className="mt-1 text-sm text-emerald-700 font-black tabular-nums">
                {Number.isFinite(r?.impactRd) ? `+${_fmt(r.impactRd,1)}/${isGross?"strokes":"pts"}/rd` : "—"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
        <button className="btn-primary" onClick={() => setView("player_progress")}>Next: Plan →</button>
        <button className="btn-secondary" onClick={() => setView("player_progress")}>← Back to Overview</button>
      </div>
    </section>
  );
}


function App(props) {
        const [view, setView] = useState("home");

const [tenantTick, setTenantTick] = useState(0);



// CSV import metadata (persist event_date to Supabase)
const [loadedEventDateMs, setLoadedEventDateMs] = useState(null);
const [loadedEventFileName, setLoadedEventFileName] = useState("");
// Restore last-resolved tenant (GitHub Pages refresh-safe)
try {
  if (typeof window !== "undefined" && typeof sessionStorage !== "undefined") {
    const sid = sessionStorage.getItem("dsl_active_society_id") || "";
    const sslug = sessionStorage.getItem("dsl_active_society_slug") || "";
    const sname = sessionStorage.getItem("dsl_active_society_name") || "";
    if (sid && !window.__activeSocietyId) window.__activeSocietyId = sid;
    if (sslug && !window.__activeSocietySlug) window.__activeSocietySlug = sslug;
    if (sname && !window.__activeSocietyName) window.__activeSocietyName = sname;
  }
} catch {}

// --- Public society bootstrap from URL ---
// If someone visits /<repo>/<society-slug>/..., resolve the society in Supabase and set globals.
// This makes League/Eclectic public without forcing a sign-in.
useEffect(() => {
  try {
    if (typeof window === "undefined") return;

    const slugFromUrl = String(_parseSocietySlugFromUrl() || "").trim();
    if (!slugFromUrl) return;

    // If we already have this tenant loaded, nothing to do.
    const currentSlug = String(window.__activeSocietySlug || "").trim();
    const currentId = String(window.__activeSocietyId || "").trim();
    if (currentSlug === slugFromUrl && currentId) return;

    (async () => {
      try {
        // Ensure we have a Supabase client (public anon key is fine for reading the societies table).
        const c =
          (typeof window !== "undefined" && window.__supabase_client__)
            ? window.__supabase_client__
            : createClient(SUPA_URL, SUPA_KEY, {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
              });
        if (typeof window !== "undefined") window.__supabase_client__ = c;

        // Fetch society by slug (take first match if duplicates exist, avoids PostgREST single() crash).
        const { data, error } = await c
          .from("societies_public")
          .select("id,name,slug")
          .eq("slug", slugFromUrl)
          .limit(1)
          .maybeSingle();

        if (error) throw error;

        if (data && data.id) {
          window.__activeSocietyId = data.id;
          window.__activeSocietySlug = data.slug || slugFromUrl;
          window.__activeSocietyName = data.name || data.slug || slugFromUrl;
          window.__activeSocietyRole = ""; // public by default

          // Persist so refreshes / routing changes don't lose the tenant.
          try {
            sessionStorage.setItem("dsl_active_society_id", data.id);
            sessionStorage.setItem("dsl_active_society_slug", data.slug || slugFromUrl);
            sessionStorage.setItem("dsl_active_society_name", data.name || "");
          } catch {}

          // Trigger a re-render so SOCIETY_ID/PREFIX recompute without a hard reload.
          setTenantTick((t) => t + 1);
        }
      } catch (e) {
        console.warn("Society bootstrap failed:", e);
      }
    })();
  } catch (e) {
    // ignore
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

// ---- Tenant runtime config (from AuthGate props, with safe fallback to globals) ----
const __p = props || {};
void tenantTick;
const ACTIVE = (() => {
  try {
    const id   = String(__p.activeSocietyId || (typeof window !== "undefined" ? window.__activeSocietyId : "") || "").trim();
    const slug = String(__p.activeSocietySlug || (typeof window !== "undefined" ? window.__activeSocietySlug : "") || "den-society").trim();
    const name = String(__p.activeSocietyName || (typeof window !== "undefined" ? window.__activeSocietyName : "") || "").trim();
    const role = String(__p.activeSocietyRole || (typeof window !== "undefined" ? window.__activeSocietyRole : "") || "").trim();
    return { id, slug, name, role };
  } catch {
    return { id: "", slug: "den-society", name: "", role: "" };
  }
})();

const SOCIETY_ID = ACTIVE.id;
const SOCIETY_SLUG = ACTIVE.slug || "den-society";


// Update back-compat module vars once tenant is known
LEAGUE_SLUG = SOCIETY_SLUG;
LEAGUE_TITLE = ACTIVE.name || SOCIETY_SLUG;
LEAGUE_HEADER_TITLE = LEAGUE_TITLE;

const IS_WINTER_LEAGUE = SOCIETY_SLUG === "winter-league";


// Storage: single bucket, per-society folders
const BUCKET = "den-events";
const PREFIX = SOCIETY_ID ? `societies/${SOCIETY_ID}/events` : "societies/UNKNOWN/events";

// Competition (used by seasons + standings). Keep your existing winter vs season split.
const COMPETITION = IS_WINTER_LEAGUE ? "winter" : "season";

// Optional: expose for debugging
// --- Global scoring-mode visual accent (UI only; no calculation changes) ---
        useEffect(() => {
          const apply = (lens) => {
            const v = (lens === "pointsField" || lens === "strokesField" || lens === "strokesPar") ? lens : "pointsField";
            const root = document.documentElement;
            if (!root || !root.style) return;

            let hex = "#7c3aed"; // purple
            let rgb = "124,58,237";
            if (v === "strokesField") { hex = "#2563eb"; rgb = "37,99,235"; }     // blue
            if (v === "strokesPar")   { hex = "#f97316"; rgb = "249,115,22"; }   // orange

            root.style.setProperty("--mode-accent", hex);
            root.style.setProperty("--mode-accent-rgb", rgb);
            root.style.setProperty("--mode-accent-soft", `rgba(${rgb}, 0.12)`);
            root.style.setProperty("--mode-accent-soft2", `rgba(${rgb}, 0.20)`);
          };

          const sync = () => {
            try { apply(localStorage.getItem("dsl_lens") || "pointsField"); }
            catch(e){ apply("pointsField"); }
          };

          sync();
          window.addEventListener("dsl_lens_change", sync);
          window.addEventListener("storage", sync);
          return () => {
            window.removeEventListener("dsl_lens_change", sync);
            window.removeEventListener("storage", sync);
          };
        }, []);


        const [selectedPlayer, setSelectedPlayer] = useState("");
        const [loginOpen, setLoginOpen] = useState(false);
        const [loginBusy, setLoginBusy] = useState(false);
const [user, setUser] = useState(null);
        const claimDoneRef = useRef(false);

        

// Supabase config
        const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
        const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const STANDINGS_TABLE = "standings";

// Storage prefix for CSVs inside bucket.
// Admin player visibility (hide / re-include players)
const ADMIN_PW_OK_LS_KEY = "den_admin_pw_ok_v1";
const ADMIN_PASSWORD = (typeof window !== "undefined" && window.DEN_ADMIN_PASSWORD)
  ? String(window.DEN_ADMIN_PASSWORD)
  : "Den Society League";
const VIS_LS_KEY = "den_hidden_players_v1";   // changed (optional but recommended)
const ADMIN_VIS_PATH = PREFIX ? `${PREFIX}/admin/player_visibility.json` : "admin/player_visibility.json";



        const [client, setClient] = useState(null);
        const [statusMsg, setStatusMsg] = useState("Connecting...");
        const [sharedGroups, setSharedGroups] = useState([]);
        
        const [seasonModel, setSeasonModel] = useState(null);
        const [seasonRounds, setSeasonRounds] = useState([]); // all scanned rounds (sorted oldest→newest)
        const [seasonYear, setSeasonYear] = useState("All");
        // League/Eclectic season selector (separate from Season Analysis filters)
        const [leagueSeasonYear, setLeagueSeasonYear] = useState("All");
const [activeSeasonId, setActiveSeasonId] = useState("");
const [seasonsDef, setSeasonsDef] = useState([]);
        const [seasonLimit, setSeasonLimit] = useState("All"); 
const [qaLaunch, setQaLaunch] = React.useState(false);

// Player Progress / Player Report / Q&A: independent "Next Handicap Preview" mode (UI only)
const [reportNextHcapMode, setReportNextHcapMode] = React.useState(() => {
  try { return localStorage.getItem("den_reportNextHcapMode_v1") || "whs"; } catch(e){ return "whs"; }
});
React.useEffect(() => {
  try { localStorage.setItem("den_reportNextHcapMode_v1", reportNextHcapMode); } catch(e){}
}, [reportNextHcapMode]);
// "All" or number as string (e.g. "5")

const [seasonModelAll, setSeasonModelAll] = useState(null); // unfiltered (for admin player list)
const [hiddenPlayerKeys, setHiddenPlayerKeys] = useState(() => {
  try {
    const raw = localStorage.getItem(VIS_LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch { return []; }
});
const hiddenKeySet = React.useMemo(() => new Set((hiddenPlayerKeys || []).filter(Boolean)), [hiddenPlayerKeys]);
const [playersAdminOpen, setPlayersAdminOpen] = useState(false);
const [adminPwOpen, setAdminPwOpen] = useState(false);
const [adminPwOk, setAdminPwOk] = useState(() => { try { return localStorage.getItem(ADMIN_PW_OK_LS_KEY) === "1"; } catch { return false; } });
const requestPlayersAdmin = React.useCallback(() => {
  if (!user) { toast("Sign in first"); return; }
  if (adminPwOk) setPlayersAdminOpen(true);
  else setAdminPwOpen(true);
}, [user, adminPwOk]);

const handleAdminPassword = React.useCallback((pw) => {
  const ok = String(pw || "") === ADMIN_PASSWORD;
  if (!ok) { toast("Wrong password"); return; }
  setAdminPwOk(true);
  try { localStorage.setItem(ADMIN_PW_OK_LS_KEY, "1"); } catch {}
  setAdminPwOpen(false);
  setPlayersAdminOpen(true);
  toast("Admin unlocked ✓");
}, []);

        // V2: scroll-reveal for anything with [data-reveal]
                useEffect(() => {
                  try {
                    const els = Array.from(document.querySelectorAll("[data-reveal]"));
                    if (!els.length) return;
                    const io = new IntersectionObserver((entries) => {
                      entries.forEach((e) => {
                        if (e.isIntersecting) {
                          e.target.classList.add("is-revealed");
                          io.unobserve(e.target);
                        }
                      });
                    }, { threshold: 0.12 });
                    els.forEach(el => {
                      el.classList.add("reveal");
                      io.observe(el);
                    });
                    return () => io.disconnect();
                  } catch (e) {}
                }, [view, seasonModel]);

        const seasonYears = React.useMemo(() => {
          const ys = (seasonsDef || []).map(s => String(s.season_id)).filter(Boolean);
          // newest first (as strings)
          return Array.from(new Set(ys)).sort((a,b)=> b.localeCompare(a));
        }, [seasonsDef]);

        function _filterSeasonRounds(roundsIn, yearSel, limitSel){
          let arr = Array.isArray(roundsIn) ? roundsIn.slice() : [];
          // ensure chronological
          arr.sort((a,b)=>{
            const da = Number.isFinite(Number(a?.dateMs)) ? Number(a.dateMs) : (Number.isFinite(Number(a?.parsed?.dateMs)) ? Number(a.parsed.dateMs) : (a?.date ? _coerceDateMs(a.date) : Number.POSITIVE_INFINITY));
            const db = Number.isFinite(Number(b?.dateMs)) ? Number(b.dateMs) : (Number.isFinite(Number(b?.parsed?.dateMs)) ? Number(b.parsed.dateMs) : (b?.date ? _coerceDateMs(b.date) : Number.POSITIVE_INFINITY));
            if (da !== db) return da - db;
            return String(a?.file||"").localeCompare(String(b?.file||""));
          });
          const _sidFor = (r) => {
            const sid = r?.seasonId;
            if (sid !== undefined && sid !== null && String(sid).trim() !== "") return String(sid);

            // Prefer mapping the round date into a season using the seasons table date ranges
            const ms = Number.isFinite(Number(r?.dateMs)) ? Number(r.dateMs)
              : (Number.isFinite(Number(r?.parsed?.dateMs)) ? Number(r.parsed.dateMs)
              : (r?.date ? _coerceDateMs(r.date) : NaN));
            if (Number.isFinite(ms)) {
              try {
                const mapped = seasonIdForDateMs(ms, seasonsDef);
                if (mapped !== null && mapped !== undefined && String(mapped).trim() !== "") return String(mapped);
              } catch (e) { /* ignore mapping errors */ }

              // Last-resort fallback: calendar year
              try { return String(new Date(ms).getFullYear()); } catch (e) { return ""; }
            }
            return "";
          };
          if (yearSel && yearSel !== "All") {
            arr = arr.filter(r => _sidFor(r) === String(yearSel));
          }
          if (limitSel && limitSel !== "All") {
            const n = Number(limitSel);
            if (Number.isFinite(n) && n > 0 && arr.length > n) {
              // keep MOST RECENT N games, but preserve chronological order
              arr = arr.slice(arr.length - n);
            }
          }
          return arr;
        }

        React.useEffect(() => {
  if (!seasonRounds || !seasonRounds.length) return;
  const filtered = _filterSeasonRounds(seasonRounds, seasonYear, seasonLimit);

  // Keep an unfiltered model for admin player management (merged names, diagnostics etc.)
  const modelAll = buildSeasonPlayerModel(filtered);
  setSeasonModelAll(modelAll);
  try { if (typeof window !== 'undefined') window.__seasonModelAll = modelAll; } catch(e) {}

  // Apply admin visibility filter by rebuilding the model with hidden keys excluded
  const model = buildSeasonPlayerModel(filtered, { hiddenKeys: hiddenKeySet });
  setSeasonModel(model);
  try { if (typeof window !== 'undefined') window.__seasonModel = model; } catch(e) {}
  try { if (typeof window !== 'undefined') window.__dslUiState = { seasonYear, seasonLimit }; } catch(e) {}

  if (model?.players?.length) {
    const ok = seasonPlayer && model.players.some(p => p.name === seasonPlayer);
    if (!ok) setSeasonPlayer(model.players[0].name);
  }
}, [seasonRounds, seasonYear, seasonLimit, hiddenPlayerKeys]);

        
        // Filtered season rounds (same selection driving the seasonModel)
        const seasonRoundsFiltered = React.useMemo(() => {
          return _filterSeasonRounds(Array.isArray(seasonRounds) ? seasonRounds : [], seasonYear, seasonLimit);
        }, [seasonRounds, seasonYear, seasonLimit]);

        // All rounds in the selected season (ignores seasonLimit)
        // Used by Winner Odds so the model can use the full in-season history.
        const seasonRoundsInSeasonAll = React.useMemo(() => {
          return _filterSeasonRounds(
            Array.isArray(seasonRounds) ? seasonRounds : [],
            seasonYear,
            "All" // IMPORTANT: no limit
          );
        }, [seasonRounds, seasonYear]);

// All rounds across all seasons (ignores seasonYear/seasonLimit) for Winner Odds.
// This lets the "Rounds" dropdown on the Event screen override season filtering just for odds.
const seasonRoundsAllForOdds = React.useMemo(() => {
  try { return Array.isArray(seasonRounds) ? seasonRounds.slice() : []; } catch { return []; }
}, [seasonRounds]);

// Winner Odds should respect admin-hidden players, but should NOT be constrained by season filters.
const seasonModelOddsAll = React.useMemo(() => {
  try { return buildSeasonPlayerModel(seasonRoundsAllForOdds, { hiddenKeys: hiddenKeySet }); }
  catch { try { return buildSeasonPlayerModel(seasonRoundsAllForOdds); } catch { return null; } }
}, [seasonRoundsAllForOdds, hiddenPlayerKeys]);


const [seasonLoading, setSeasonLoading] = useState(false);
        // Auto-load season rounds so Winner Odds can include all league players (from season rounds)
        React.useEffect(() => {
          try {
            if (view === "event" && (!Array.isArray(seasonRounds) || seasonRounds.length === 0) && !seasonLoading) {
              loadAllGamesAndBuildPlayerModel({ afterView: "event" });
            }
          } catch (e) { /* no-op */ }
        }, [view, seasonRounds, seasonLoading]);

        const [seasonProgress, setSeasonProgress] = useState({ done: 0, total: 0 });
        const [seasonError, setSeasonError] = useState("");
        const [seasonPlayer, setSeasonPlayer] = useState("");
        const [scoringMode, setScoringMode] = useState("stableford");
        const [grossCompare, setGrossCompare] = useState("par");

        const [seasonFiles, setSeasonFiles] = useState({ processed: [], skipped: [] });
// --- Season aggregation (App-scope, safe) ---
function _yardBand(y) {
  if (!Number.isFinite(y)) return "Unknown";
  if (y < 150) return "<150";
  if (y <= 200) return "150–200";
  if (y <= 350) return "201–350";
  if (y <= 420) return "351–420";
  return "420+";
}
function _siBand(si) {
  if (!Number.isFinite(si)) return "Unknown";
  if (si <= 6) return "1–6";
  if (si <= 12) return "7–12";
  return "13–18";
}
function _makeAgg() { return { holes: 0, pts: 0, wipes: 0, p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, p5: 0 }; }
function _addAgg(a, pts) {
  a.holes += 1;
  a.pts += pts;
  if (pts === 0) a.wipes += 1;
  const p = Math.max(0, Math.min(5, Math.round(Number(pts || 0))));
  if (p === 0) a.p0 += 1;
  else if (p === 1) a.p1 += 1;
  else if (p === 2) a.p2 += 1;
  else if (p === 3) a.p3 += 1;
  else if (p === 4) a.p4 += 1;
  else a.p5 += 1;
}

// Gross-mode aggregation (strokes over par; lower is better)
function _makeAggGross(){ return { holes: 0, val: 0, sumSq: 0, bogeyPlus: 0, parOrBetter: 0, birdieOrBetter: 0, doublePlus: 0, eaglePlus: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0, triplesPlus: 0 }; }

function _addAggGross(a, strokesOverPar) {
  const v = Number(strokesOverPar);
  if (!Number.isFinite(v)) return;
  a.holes += 1;
  a.val += v;
  a.sumSq += v * v;

  // rolled-up helpers
  if (v >= 1) a.bogeyPlus += 1;
  if (v <= 0) a.parOrBetter += 1;
  if (v <= -1) a.birdieOrBetter += 1;

  // explicit, non-overlapping buckets
  if (v <= -2) a.eaglePlus += 1;
  else if (v === -1) a.birdies += 1;
  else if (v === 0) a.pars += 1;
  else if (v === 1) a.bogeys += 1;
  else if (v === 2) a.doubles += 1;
  else if (v >= 3) a.triplesPlus += 1;
}
function _avgGross(a) {
  const h = Number(a?.holes || 0);
  return h ? (Number(a.val || 0) / h) : NaN;
}
function _safeNum(x, d = NaN) {
  // Treat null/undefined/blank as missing (do NOT coerce null->0)
  if (x == null) return d;
  if (typeof x === "string" && x.trim() === "") return d;
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}
function _chooseTeeForPlayerSeason(p, courseTees) {
  const labelRaw = (p.teeLabel || p.tee || p.tee_name || "").toString().trim();
  const label = labelRaw.toLowerCase();
  if (label && Array.isArray(courseTees)) {
    const exact = courseTees.find(t =>
      (t.teeName || t.name || t.label || "").toString().trim().toLowerCase() === label
    );
    if (exact) return exact;

    // partial match fallback (handles "white", "white tee", etc.)
    const partial = courseTees.find(t => {
      const n = (t.teeName || t.name || t.label || "").toString().trim().toLowerCase();
      return n && (n.includes(label) || label.includes(n));
    });
    if (partial) return partial;
  }
  return Array.isArray(courseTees) && courseTees.length ? courseTees[0] : null;
}
function buildSeasonPlayerModel(rounds, opts) {

  const holes = 18;

  // --- Extra Player Progress metrics (per-round series) ---
  function _extractDateMsFromPath(path) {
    const s = String(path || "");
    // 1) YYYY-MM-DD or YYYY_MM_DD
    let m = s.match(/(20\d{2})[-_\.](0?[1-9]|1[0-2])[-_\.](0?[1-9]|[12]\d|3[01])/);
    if (m) {
      const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      const ms = Date.UTC(y, mo - 1, d);
      return Number.isFinite(ms) ? ms : null;
    }
    // 2) DD-MM-YYYY or DD_MM_YYYY
    m = s.match(/(0?[1-9]|[12]\d|3[01])[-_\.](0?[1-9]|1[0-2])[-_\.](20\d{2})/);
    if (m) {
      const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
      const ms = Date.UTC(y, mo - 1, d);
      return Number.isFinite(ms) ? ms : null;
    }
    return null;
  }
  function _mean(arr) {
    const n = arr.length;
    if (!n) return NaN;
    let s = 0;
    for (const v of arr) s += Number(v);
    return s / n;
  }
  function _stddev(arr) {
    const n = arr.length;
    if (n < 2) return NaN;
    const mu = _mean(arr);
    let ss = 0;
    for (const v of arr) {
      const d = Number(v) - mu;
      ss += d * d;
    }
    return Math.sqrt(ss / (n - 1));
  }
  function _linRegSlope(xs, ys) {
    const n = Math.min(xs.length, ys.length);
    if (n < 2) return NaN;
    let sx=0, sy=0, sxx=0, sxy=0;
    for (let i=0;i<n;i++){
      const x = Number(xs[i]), y = Number(ys[i]);
      sx += x; sy += y; sxx += x*x; sxy += x*y;
    }
    const denom = (n * sxx - sx * sx);
    if (!denom) return NaN;
    return (n * sxy - sx * sy) / denom;
  }

// Map a raw player name to a stable key, using fuzzy matching to merge minor typos.
function keyForName(raw, byPlayer) {
  const norm = normalizeName(raw);
  if (!norm) return "";
  if (byPlayer[norm]) return norm;

  let bestKey = "";
  let bestScore = Infinity;
  for (const k of Object.keys(byPlayer)) {
    if (!isFuzzyMatch(norm, k)) continue;
    const d = levenshtein(norm, k);
    if (d < bestScore) { bestScore = d; bestKey = k; }
  }
  return bestKey || norm;
}

// tiny helper: keep arrays unique (stable for JSON / React state)
function _pushUnique(arr, val) {
  if (!arr) return;
  if (val == null) return;
  const s = String(val);
  if (!s) return;
  if (!arr.includes(s)) arr.push(s);
}

  const byPlayer = {};
  const field = {
    totals: _makeAgg(),
    totalsGross: _makeAggGross(),
    totalsNet: _makeAggGross(),
    byPar: { "Par 3": _makeAgg(), "Par 4": _makeAgg(), "Par 5": _makeAgg(), "Unknown": _makeAgg() },
    byParGross: { "Par 3": _makeAggGross(), "Par 4": _makeAggGross(), "Par 5": _makeAggGross(), "Unknown": _makeAggGross() },
        byParYards: { "Par 3": {}, "Par 4": {}, "Par 5": {}, "Unknown": {} },
        byParYardsGross: { "Par 3": {}, "Par 4": {}, "Par 5": {}, "Unknown": {} },
    byYards: {},
    byYardsGross: {},
    bySI: { "1–6": _makeAgg(), "7–12": _makeAgg(), "13–18": _makeAgg(), "Unknown": _makeAgg() },
    bySIGross: { "1–6": _makeAggGross(), "7–12": _makeAggGross(), "13–18": _makeAggGross(), "Unknown": _makeAggGross() },
  };

  const roundStats = {};

  let roundIdx = 0;

  const hiddenKeys = (opts && opts.hiddenKeys instanceof Set) ? opts.hiddenKeys : null;

  for (const r of rounds) {
    const fileKey = r.file || (`round_${roundIdx}`);
    const roundPtsTotals = [];
    const roundGrossTotals = [];
    const parsed = r.parsed || {};
    const dateMs = (Number.isFinite(parsed.dateMs) && Number(parsed.dateMs) > 0) ? Number(parsed.dateMs) : _extractDateMsFromPath(fileKey);
    const players = parsed.players || [];
    const courseTees = parsed.courseTees || [];

    // Determine winner(s) for this round (same logic as Event leaderboard: points then countback).
    // Used ONLY for Den preview in Progress/Report/Q&A (winner bonus cut).
    const winnerNameSet = (() => {
      try {
        const baseRows = (players || [])
          .filter(pp => !isTeamLike(pp?.name))
          .map((pp, idx2) => ({
            idx: idx2,
            name: String(pp?.name || "").trim(),
            points: Number(pp?.points ?? pp?.pts ?? NaN),
            back9: Number(pp?.back9 ?? 0),
            perHole: Array.isArray(pp?.perHole) ? pp.perHole.slice(0, 18) : []
          }))
          .filter(x => x.name && Number.isFinite(x.points));

        if (!baseRows.length) return new Set();

        // Sort by points desc, then countback.
        const sorted = baseRows.slice().sort((a, b) => (b.points - a.points) || compareByCountback(a, b));

        // Find best within top points group, using compareByCountback to handle ties.
        const topPts = sorted[0].points;
        const topGroup = sorted.filter(r0 => r0.points === topPts);
        let best = topGroup.length ? [topGroup[0]] : [];
        for (let k = 1; k < topGroup.length; k++) {
          const cmp = compareByCountback(topGroup[k], best[0]);
          if (cmp > 0) best = [topGroup[k]];
          else if (cmp === 0) best.push(topGroup[k]);
        }
        return new Set(best.map(b => String(b.name).trim()));
      } catch (e) {
        return new Set();
      }
    })();

    for (const p of players) {
      const name = (p.name || "");
              const key = keyForName(name, byPlayer);
              if (hiddenKeys && hiddenKeys.has(key)) continue;
      if (!name) continue;

      const tee = _chooseTeeForPlayerSeason(p, courseTees) || {
  pars: Array(18).fill(NaN),
  yards: Array(18).fill(NaN),
  si: Array(18).fill(NaN),
};
      const perHole = Array.isArray(p.perHole) ? p.perHole : Array(18).fill(0);
      const pars = Array.isArray(tee.pars) ? tee.pars : Array(18).fill(NaN);
      const yards = Array.isArray(tee.yards) ? tee.yards : Array(18).fill(NaN);
      const siArr = Array.isArray(tee.si) ? tee.si : Array(18).fill(NaN);

      const rec = (byPlayer[key] ||= {
        name: String(name).replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim(),
        rounds: 0,
                files: [],
        totals: _makeAgg(),
        totalsGross: _makeAggGross(),
        totalsNet: _makeAggGross(),
        byPar: { "Par 3": _makeAgg(), "Par 4": _makeAgg(), "Par 5": _makeAgg(), "Unknown": _makeAgg() },
        byParGross: { "Par 3": _makeAggGross(), "Par 4": _makeAggGross(), "Par 5": _makeAggGross(), "Unknown": _makeAggGross() },
    byParYards: { "Par 3": {}, "Par 4": {}, "Par 5": {}, "Unknown": {} },
    byParYardsGross: { "Par 3": {}, "Par 4": {}, "Par 5": {}, "Unknown": {} },
        byYards: {},
        byYardsGross: {},
        bySI: { "1–6": _makeAgg(), "7–12": _makeAgg(), "13–18": _makeAgg(), "Unknown": _makeAgg() },
        bySIGross: { "1–6": _makeAggGross(), "7–12": _makeAggGross(), "13–18": _makeAggGross(), "Unknown": _makeAggGross() },
        diag: {
          holesMissing: { par: 0, si: 0, yards: 0 },
          missingHoles: { par: [], si: [], yards: [] },
          teeLabelsSeen: [],
          teesMatched: [],
          issuesByFile: {} // { [file]: { teeLabel, teeMatched, par:[], si:[], yards:[] } }
        },
      });
      rec.rounds += 1;
              // prefer the cleanest/longest display name
              const cleaned = String(name).replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
              if (cleaned && (!rec.name || cleaned.length > rec.name.length)) rec.name = cleaned;

              if (r.file && !rec.files.includes(r.file)) rec.files.push(r.file);
              // --- diagnostics: tee + missing metadata coverage ---
              const teeLabelDiag = (p.teeLabel || p.tee || p.tee_name || "").toString().trim() || "(blank)";
              const teeMatchedDiag = (tee?.teeName || tee?.name || tee?.label || "(fallback/unknown)").toString().trim();
              _pushUnique(rec.diag.teeLabelsSeen, teeLabelDiag);
              _pushUnique(rec.diag.teesMatched, teeMatchedDiag);

              const fileDiagKey = r.file || "(unknown file)";
              if (!rec.diag.issuesByFile[fileDiagKey]) {
                rec.diag.issuesByFile[fileDiagKey] = { teeLabel: teeLabelDiag, teeMatched: teeMatchedDiag, par: [], si: [], yards: [] };
              }

              // --- per-round series metrics (Volatility / Velocity / Context / Front vs Back / Hcap vs Output) ---
              const _perHoleArr = Array.isArray(perHole) ? perHole : [];
              const ptsTotal = _perHoleArr.reduce((acc, v) => acc + _safeNum(v, 0), 0);
              const frontPts = _perHoleArr.slice(0, 9).reduce((acc, v) => acc + _safeNum(v, 0), 0);
              const backPts  = _perHoleArr.slice(9, 18).reduce((acc, v) => acc + _safeNum(v, 0), 0);
              const playingHcap = Math.round(_safeNum(p.playingHcap ?? p.startExact ?? p.handicap ?? p.hcap ?? NaN, NaN));
              const gphSeries = Array.isArray(p.grossPerHole) ? p.grossPerHole : null;
              // STRICT: do not fill missing gross holes (leave as NaN).
              // BUT: if a hole is genuinely unplayed (e.g., a 9-hole round), keep it as NaN so it doesn't pollute totals.
              const _playedMask = Array.from({ length: 18 }, (_, i) => {
                const pts = _safeNum(_perHoleArr[i], NaN);
                const g = gphSeries ? _safeNum(gphSeries[i], NaN) : NaN;
                return Number.isFinite(pts) || (Number.isFinite(g) && g > 0);
              });

              const _gphFilled = gphSeries
                ? gphSeries.map((g, i) => {
                    if (!_playedMask[i]) return NaN;

                    const par = Number(pars[i]);
                    const si = Number(siArr[i]);
                    let strokesRec = 0;
                    if (Number.isFinite(playingHcap) && Number.isFinite(si)) {
                      const fullRounds = Math.floor(playingHcap / 18);
                      const remainder = playingHcap % 18;
                      strokesRec = fullRounds + (remainder >= si ? 1 : 0);
                    }

                    // If gross is present, use it.
                    if (Number.isFinite(g) && g > 0) return g;

                    // WHS-style fill: if gross is missing for a played hole, use Net Double Bogey.
                    // NDB = Net Par + 2 (Net Par = Par + strokes received on this hole)
                    if (Number.isFinite(par)) return par + strokesRec + 2;
                    return NaN;
                  })
                : null;

              const _gphImputed = gphSeries
                ? gphSeries.map((g, i) => _playedMask[i] && !(Number.isFinite(g) && g > 0))
                : null;

              const holesPlayed = _playedMask.filter(Boolean).length;

              const grossTotal = _gphFilled ? (_gphFilled.some((v,i)=>_playedMask[i] && !Number.isFinite(v)) ? NaN : _gphFilled.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0)) : NaN;
              const frontGross = _gphFilled ? (_gphFilled.slice(0,9).some((v,i)=>_playedMask[i] && !Number.isFinite(v)) ? NaN : _gphFilled.slice(0,9).reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0)) : NaN;
              const backGross  = _gphFilled ? (_gphFilled.slice(9,18).some((v,idx)=>_playedMask[idx+9] && !Number.isFinite(v)) ? NaN : _gphFilled.slice(9,18).reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0)) : NaN;
              const parTotal = Array.isArray(pars) ? pars.reduce((acc, v, i) => acc + (_playedMask[i] ? _safeNum(v, 0) : 0), 0) : NaN;

              // --- Par-type aggregates (gross strokes-over-par per hole) ---
              if (_gphFilled && Array.isArray(pars)) {
                const agg = (rec._parTypeAgg ||= { 3: { over: 0, n: 0 }, 4: { over: 0, n: 0 }, 5: { over: 0, n: 0 } });
                for (let i = 0; i < holes; i++) {
                  const par = _safeNum(pars[i], NaN);
                  const g = _safeNum(_gphFilled[i], NaN);
                  if (!Number.isFinite(par) || !Number.isFinite(g)) continue;
                  if (par === 3 || par === 4 || par === 5) {
                    agg[par].over += (g - par);
                    agg[par].n += 1;
                  }
                }
              }
              (rec.series ||= []).push({
                file: fileKey,
                isWinner: winnerNameSet.has(String(name || "").trim()),
                idx: roundIdx,
                dateMs: dateMs,
                courseName: (parsed?.courseName || parsed?.internalCourseName || parsed?.course || "").toString(),
                teeName: (tee?.teeName || tee?.name || tee?.label || "").toString(),
                teeGender: (tee?.gender || p?.gender || "M").toString(),
                teeLabel: (p?.teeLabel || p?.tee || p?.tee_name || "").toString(),
                teeSlope: _safeNum(tee?.slope ?? tee?.Slope ?? tee?.slopeRating ?? parsed?.courseSlope ?? parsed?.slope ?? NaN,NaN),
                teeRating: _safeNum(tee?.rating ?? tee?.courseRating ?? parsed?.courseRating ?? parsed?.rating ?? NaN, NaN),
                slope: _safeNum(tee?.slope ?? tee?.slopeRating ?? parsed?.courseSlope ?? parsed?.slope ?? NaN, NaN),
                rating: _safeNum(tee?.rating ?? tee?.courseRating ?? parsed?.courseRating ?? parsed?.rating ?? NaN, NaN),
                parsPerHole: Array.isArray(tee?.pars) ? tee.pars.slice(0,18) : Array.isArray(tee?.par) ? tee.par.slice(0,18) : [],
                siPerHole: Array.isArray(tee?.si) ? tee.si.slice(0,18) : Array.isArray(tee?.SI) ? tee.SI.slice(0,18) : [],
                startExact: _safeNum(p.handicap ?? p.startExact ?? p.handicapIndex ?? p.hcap ?? p.hi ?? NaN, NaN),
                gender: (p?.gender || tee?.gender || "M").toString(),
                perHole: _perHoleArr.slice(0, 18),
                parsArr: pars.slice(0, 18),
                siArr: siArr.slice(0, 18),
                yardsArr: (Array.isArray(yards) ? yards.slice(0, 18) : []),
                pts: ptsTotal,
                frontPts,
                backPts,
                hcap: playingHcap,
                gross: grossTotal,
                grossPerHole: _gphFilled ? _gphFilled.slice(0, 18) : Array(18).fill(NaN),
                // For WHS consistency across pages, store the *filled* hole scores here too.
                imputedGrossPerHole: _gphFilled ? _gphFilled.slice(0, 18) : Array(18).fill(NaN),
                // Separate boolean mask of which holes were imputed.
                imputedMask: _gphImputed ? _gphImputed.slice(0, 18) : null,
                frontGross,
                backGross,
                parTotal,
                holesPlayed
              });
              roundPtsTotals.push(ptsTotal);
              if (Number.isFinite(grossTotal)) roundGrossTotals.push(grossTotal);

for (let i = 0; i < holes; i++) {
        const pts = _safeNum(perHole[i], NaN);
        const gph = Array.isArray(p.grossPerHole) ? p.grossPerHole : Array(18).fill(NaN);
        const gRawPre = _safeNum(gph[i], NaN);

        // If a hole has no points and no gross recorded, treat it as unplayed (e.g., 9-hole round) and ignore it.
        const holePlayed = Number.isFinite(pts) || (Number.isFinite(gRawPre) && gRawPre > 0);
        if (!holePlayed) continue;

        if (Number.isFinite(pts)) {
          _addAgg(rec.totals, pts);
          _addAgg(field.totals, pts);
        }

        const par = _safeNum(pars[i], NaN);

        // Compute strokes received on this hole (used for Net calculations only (gross is CSV-only))
        const playingHcap = _safeNum(p.playingHcap ?? p.startExact ?? p.handicap ?? p.hcap ?? NaN, NaN);
        const si = _safeNum(siArr[i], NaN);
        let strokesRec = 0;
        if (Number.isFinite(playingHcap) && Number.isFinite(si)) {
          const fullRounds = Math.floor(playingHcap / 18);
          const remainder = playingHcap % 18;
          strokesRec = fullRounds + (remainder >= si ? 1 : 0);
        }

        // Gross strokes-over-par: CSV gross only (missing stays blank).
        const gRaw = gRawPre;
        const gFilled = (Number.isFinite(gRaw) && gRaw > 0) ? gRaw : NaN;

        // STRICT: never derive gross from Stableford / handicap.
const gOverPar = (Number.isFinite(gFilled) && Number.isFinite(par)) ? (gFilled - par) : NaN;
        _addAggGross(rec.totalsGross, gOverPar);
        _addAggGross(field.totalsGross, gOverPar);

        // Net strokes-over-par (Stableford context): subtract strokes received on the hole
        const netOverPar = Number.isFinite(gOverPar) ? (gOverPar - strokesRec) : NaN;
        _addAggGross(rec.totalsNet, netOverPar);
        _addAggGross(field.totalsNet, netOverPar);

        const parKey = par === 3 ? "Par 3" : par === 4 ? "Par 4" : par === 5 ? "Par 5" : "Unknown";
        if (!Number.isFinite(par) || !(par === 3 || par === 4 || par === 5)) {
          rec.diag.holesMissing.par += 1;
          rec.diag.missingHoles.par.push(i + 1);
          rec.diag.issuesByFile[fileDiagKey].par.push(i + 1);
        }

        if (Number.isFinite(pts)) {
          _addAgg(rec.byPar[parKey], pts);
          _addAgg(field.byPar[parKey], pts);
        }
        (rec.byParGross[parKey] ||= _makeAggGross());
        (field.byParGross[parKey] ||= _makeAggGross());
        _addAggGross(rec.byParGross[parKey], gOverPar);
        _addAggGross(field.byParGross[parKey], gOverPar);
        const yKey = _yardBand(_safeNum(yards[i], NaN));
        const ydVal = _safeNum(yards[i], NaN);
        if (!Number.isFinite(ydVal)) {
          rec.diag.holesMissing.yards += 1;
          rec.diag.missingHoles.yards.push(i + 1);
          rec.diag.issuesByFile[fileDiagKey].yards.push(i + 1);
        }

        // --- Par × Yard band (lets us say things like "long Par 4s" with data) ---
        (rec.byParYards[parKey] ||= {});
        (field.byParYards[parKey] ||= {});
        (rec.byParYards[parKey][yKey] ||= _makeAgg());
        (field.byParYards[parKey][yKey] ||= _makeAgg());
        if (Number.isFinite(pts)) {
          _addAgg(rec.byParYards[parKey][yKey], pts);
          _addAgg(field.byParYards[parKey][yKey], pts);
        }
        (rec.byParYardsGross[parKey] ||= {});
        (field.byParYardsGross[parKey] ||= {});
        (rec.byParYardsGross[parKey][yKey] ||= _makeAggGross());
        (field.byParYardsGross[parKey][yKey] ||= _makeAggGross());
        _addAggGross(rec.byParYardsGross[parKey][yKey], gOverPar);
        _addAggGross(field.byParYardsGross[parKey][yKey], gOverPar);

        rec.byYards[yKey] ||= _makeAgg();
        field.byYards[yKey] ||= _makeAgg();
        if (Number.isFinite(pts)) {
          _addAgg(rec.byYards[yKey], pts);
          _addAgg(field.byYards[yKey], pts);
        }
        (rec.byYardsGross[yKey] ||= _makeAggGross());
        (field.byYardsGross[yKey] ||= _makeAggGross());
        _addAggGross(rec.byYardsGross[yKey], gOverPar);
        _addAggGross(field.byYardsGross[yKey], gOverPar);

        const sKey = _siBand(_safeNum(siArr[i], NaN));
        const siVal = _safeNum(siArr[i], NaN);
        if (!Number.isFinite(siVal)) {
          rec.diag.holesMissing.si += 1;
          rec.diag.missingHoles.si.push(i + 1);
          rec.diag.issuesByFile[fileDiagKey].si.push(i + 1);
        }

        rec.bySI[sKey] ||= _makeAgg();
        field.bySI[sKey] ||= _makeAgg();
        _addAgg(rec.bySI[sKey], pts);
        _addAgg(field.bySI[sKey], pts);
        (rec.bySIGross[sKey] ||= _makeAggGross());
        (field.bySIGross[sKey] ||= _makeAggGross());
        _addAggGross(rec.bySIGross[sKey], gOverPar);
        _addAggGross(field.bySIGross[sKey], gOverPar);
      }
    // --- per-round field stats for contextual scoring ---
    if (roundPtsTotals.length) {
      const mu = _mean(roundPtsTotals);
      const sd = _stddev(roundPtsTotals);
            const muG = roundGrossTotals.length ? _mean(roundGrossTotals) : NaN;
      const sdG = roundGrossTotals.length ? _stddev(roundGrossTotals) : NaN;
      roundStats[fileKey] = { mean: mu, sd: sd, meanGross: muG, sdGross: sdG, n: roundPtsTotals.length, dateMs: dateMs };
    } else {
      roundStats[fileKey] = { mean: NaN, sd: NaN, meanGross: NaN, sdGross: NaN, n: 0, dateMs: dateMs };
    }
    roundIdx += 1;
    }
  }

  // --- diagnostics cleanup (dedupe + sort) ---
  for (const k of Object.keys(byPlayer)) {
    const d = byPlayer[k]?.diag;
    if (!d) continue;
    const uniqSort = (arr) => Array.from(new Set(arr.map(Number).filter(n => Number.isFinite(n)))).sort((a,b)=>a-b);
    d.missingHoles.par = uniqSort(d.missingHoles.par);
    d.missingHoles.si = uniqSort(d.missingHoles.si);
    d.missingHoles.yards = uniqSort(d.missingHoles.yards);

    // ensure tee arrays are unique
    d.teeLabelsSeen = Array.from(new Set((d.teeLabelsSeen || []).map(String)));
    d.teesMatched  = Array.from(new Set((d.teesMatched  || []).map(String)));

    // per-file lists
    for (const f of Object.keys(d.issuesByFile || {})) {
      const ff = d.issuesByFile[f];
      ff.par = uniqSort(ff.par || []);
      ff.si = uniqSort(ff.si || []);
      ff.yards = uniqSort(ff.yards || []);
    }
  }

function avg(a) { return a.holes ? (a.pts / a.holes) : 0; }
  function wipeRate(a) { return a.holes ? (a.wipes / a.holes) : 0; }

  const players = Object.values(byPlayer).map((p) => {
    const out = { ...p, deltas: { totals: {}, byPar: {}, byYards: {}, bySI: {} }, metrics: {} };

    // --- derived metrics used by the Player Progress screen ---
    const series = Array.isArray(p.series) ? p.series.slice() : [];
    series.sort((a,b)=> {
      const ax = (Number.isFinite(a.dateMs) && Number(a.dateMs) > 0) ? Number(a.dateMs) : Number(a.idx||0);
      const bx = (Number.isFinite(b.dateMs) && Number(b.dateMs) > 0) ? Number(b.dateMs) : Number(b.idx||0);
      return ax - bx;
    });
const ptsArr = series.map(x=>Number(x.pts)).filter(Number.isFinite);
    const frontArr = series.map(x=>Number(x.frontPts)).filter(Number.isFinite);
    const backArr  = series.map(x=>Number(x.backPts)).filter(Number.isFinite);
    const hcapArr  = series.map(x=>Number(x.hcap)).filter(Number.isFinite);

    // Volatility Index (Stableford): stddev of round total points
    const volPts = _stddev(ptsArr);

    // Improvement Velocity: slope of points vs time/index (points per round)
    const xs = series.map((x,i)=> Number.isFinite(x.dateMs) ? (x.dateMs / 86400000) : i); // days since epoch or index
    const ys = series.map(x=>Number(x.pts));
    const velocity = _linRegSlope(xs, ys); // pts per day (if dated) else pts per round

    // Points trend (simple): last 3 avg minus first 3 avg
    const firstN = ptsArr.slice(0, 3);
    const lastN  = ptsArr.slice(-3);
    const trend3 = (firstN.length ? _mean(lastN) - _mean(firstN) : NaN);

    // Front vs Back bias: avg(back) - avg(front) (positive means better on back 9)
    const fb = (frontArr.length && backArr.length) ? (_mean(backArr) - _mean(frontArr)) : NaN;

    // Handicap vs Output: avg(points - 36) and avg playing hcap
    const avgDelta36 = ptsArr.length ? (_mean(ptsArr) - 36) : NaN;
    const avgHcap = hcapArr.length ? _mean(hcapArr) : NaN;

    // Contextual Scoring: average z-score vs field for that round
    let zSum = 0, zN = 0;
    for (const r of series) {
      const rs = roundStats[r.file] || null;
      if (!rs || !Number.isFinite(rs.mean) || !Number.isFinite(rs.sd) || rs.sd <= 0) continue;
      const z = (Number(r.pts) - rs.mean) / rs.sd;
      if (Number.isFinite(z)) { zSum += z; zN += 1; }
    }
    const ctxZ = zN ? (zSum / zN) : NaN;

    // Gross (strokes) metrics. Lower gross is better; we invert signs so "positive = good" where relevant.
    const grossArr = series.map(r => Number(r.gross)).filter(Number.isFinite);
    const volGross = grossArr.length >= 2 ? _stddev(grossArr) : NaN;

    // Trend for gross: first 3 avg - last 3 avg (positive means improving / scoring lower)
    const grossTrend3 = (grossArr.length >= 4)
      ? (_mean(grossArr.slice(0, Math.min(3, grossArr.length))) - _mean(grossArr.slice(Math.max(0, grossArr.length-3))))
      : NaN;

    // Velocity for gross: slope of gross over time, inverted so positive = improving (gross decreasing)
    let grossVelocity = NaN;
    if (grossArr.length >= 2) {
      // If we have dates, slope is strokes/day; otherwise strokes/round (index)
      const xs = series.map((r, i) => Number.isFinite(r.dateMs) ? (Number(r.dateMs) / 86400000) : i);
      const ys = series.map(r => Number(r.gross));
      const pairs = xs.map((x, i) => ({ x, y: ys[i] })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (pairs.length >= 2) {
        const slopeG = _linRegSlope(pairs.map(p => p.x), pairs.map(p => p.y));
        grossVelocity = Number.isFinite(slopeG) ? (-slopeG) : NaN;
      }
    }
// Context vs Field for gross: z-score where positive = better (lower gross than field mean)
    let zSumG = 0, zNG = 0;
    for (const r of series) {
      const rs = roundStats[r.file] || null;
      if (!rs || !Number.isFinite(rs.meanGross) || !Number.isFinite(rs.sdGross) || rs.sdGross <= 0) continue;
      const z = (rs.meanGross - Number(r.gross)) / rs.sdGross;
      if (Number.isFinite(z)) { zSumG += z; zNG += 1; }
    }
    const ctxZG = zNG ? (zSumG / zNG) : NaN;

    const avgGross = grossArr.length ? _mean(grossArr) : NaN;
    const minGross = grossArr.length ? Math.min(...grossArr) : NaN;

    const _pta = out._parTypeAgg || null;
    const par3SOPH = (_pta && _pta[3] && _pta[3].n) ? (_pta[3].over / _pta[3].n) : NaN;
    const par4SOPH = (_pta && _pta[4] && _pta[4].n) ? (_pta[4].over / _pta[4].n) : NaN;
    const par5SOPH = (_pta && _pta[5] && _pta[5].n) ? (_pta[5].over / _pta[5].n) : NaN;

    out.metrics = {
      rounds: series.length,
      volPts,
      velocity,
      trend3,
      fb,
      avgDelta36,
      avgHcap,
      ctxZ,
      volGross,
      grossVelocity,
      grossTrend3,
      ctxZG,
      avgGross,
      minGross,
      par3SOPH,
      par4SOPH,
      par5SOPH
    };

    out.deltas.totals = {
      avgPts: avg(p.totals) - avg(field.totals),
      wipeRate: wipeRate(p.totals) - wipeRate(field.totals),
    };

    for (const k of Object.keys(p.byPar)) {
      out.deltas.byPar[k] = { avgPts: avg(p.byPar[k]) - avg(field.byPar[k]), wipeRate: wipeRate(p.byPar[k]) - wipeRate(field.byPar[k]) };
    }

    for (const k of Object.keys(p.byYards)) {
      const f = field.byYards[k] || _makeAgg();
      out.deltas.byYards[k] = { avgPts: avg(p.byYards[k]) - avg(f), wipeRate: wipeRate(p.byYards[k]) - wipeRate(f) };
    }

    for (const k of Object.keys(p.bySI)) {
      const f = field.bySI[k] || _makeAgg();
      out.deltas.bySI[k] = { avgPts: avg(p.bySI[k]) - avg(f), wipeRate: wipeRate(p.bySI[k]) - wipeRate(f) };
    }

    return out;
  }).sort((a,b) => a.name.localeCompare(b.name));

  return { players, field };
}

// Extract a UTC date (ms) from the *header* section of a Squabbit CSV.
// Falls back to filename parsing elsewhere. Supports:
//  - "Game 1,Nov 12 2025" / "Nov 12, 2025" / "November 12 2025"
//  - "12 Nov 2025" / "12th November 2025"
//  - "2025-11-12" / "12-11-2025"

// Robust date coercion for UK/ISO strings -> UTC midnight ms.
// Safari's Date.parse can treat dd/mm as US or NaN, so we never rely on it for numeric dates.
function _coerceDateMs(v) {
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;

  const s = String(v ?? "").trim();
  if (!s) return NaN;

  // ISO yyyy-mm-dd (or yyyy/mm/dd or yyyy.mm.dd)
  let m = s.match(/\b(20\d{2})[-\/\.](0?[1-9]|1[0-2])[-\/\.](0?[1-9]|[12]\d|3[01])\b/);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // UK dd/mm/yyyy (or dd-mm-yyyy or dd.mm.yyyy)
  m = s.match(/\b(0?[1-9]|[12]\d|3[01])[-\/\.](0?[1-9]|1[0-2])[-\/\.](20\d{2})\b/);
  if (m) return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  // Fall back to native parse for month-name formats (e.g. "Nov 12 2025") and other oddities
  const msTry = Date.parse(s);
  if (Number.isFinite(msTry)) {
    const d = new Date(msTry);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  return NaN;
}

function _extractDateMsFromCsvText(csvText) {
  // Extract a playable date from the CSV contents (captain-friendly: no filename requirements).
  // Strategy:
  //   - Scan a reasonable chunk of text (not just the first few lines)
  //   - Prefer unambiguous ISO (YYYY-MM-DD)
  //   - Support UK numeric dates (DD/MM/YYYY or DD-MM-YYYY)
  //   - Support Month-name dates (e.g., "12 Oct 2025" or "Oct 12 2025")
  try {
    const text = String(csvText || "");
    if (!text) return null;

    // Limit scan size to keep it fast in-browser
    const scan = text.slice(0, 120000); // ~120KB
    const headLines = scan.split(/\r?\n/).slice(0, 250).join("\n");

    // Month map for name parsing
    const months = {
      jan:0, january:0, feb:1, february:1, mar:2, march:2, apr:3, april:3, may:4,
      jun:5, june:5, jul:6, july:6, aug:7, august:7, sep:8, sept:8, september:8,
      oct:9, october:9, nov:10, november:10, dec:11, december:11
    };
    const monKeys = Object.keys(months).sort((a,b)=>b.length-a.length).join("|");

    // Helper: validate and return UTC ms
    const utcMs = (y, m, d) => {
      const yy = Number(y), mm = Number(m), dd = Number(d);
      if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
      if (yy < 2000 || yy > 2100) return null;
      if (mm < 0 || mm > 11) return null;
      if (dd < 1 || dd > 31) return null;
      const ms = Date.UTC(yy, mm, dd);
      return Number.isFinite(ms) ? ms : null;
    };

    // 1) ISO date anywhere: 2025-10-12
    let m = scan.match(/\b(20\d{2})[-\/\.](0?[1-9]|1[0-2])[-\/\.](0?[1-9]|[12]\d|3[01])\b/);
    if (m) {
      const ms = utcMs(m[1], Number(m[2]) - 1, m[3]);
      if (ms !== null) return ms;
    }

    // 2) UK numeric date anywhere: 12/10/2025 or 12-10-2025
    // (Assume DD/MM/YYYY for this app; avoid US confusion)
    m = scan.match(/\b(0?[1-9]|[12]\d|3[01])[-\/\.](0?[1-9]|1[0-2])[-\/\.](20\d{2})\b/);
    if (m) {
      const ms = utcMs(m[3], Number(m[2]) - 1, m[1]);
      if (ms !== null) return ms;
    }

    // 3) Month-name first: Oct 12 2025 / October 12th, 2025
    const reMonthFirst = new RegExp(`(?:^|[^a-z])(${monKeys})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(20\\d{2})`, "i");
    m = headLines.match(reMonthFirst) || scan.match(reMonthFirst);
    if (m) {
      const mo = months[String(m[1]).toLowerCase()];
      const ms = utcMs(m[3], mo, m[2]);
      if (ms !== null) return ms;
    }

    // 4) Day first with month name: 12 Oct 2025 / 12th October 2025
    const reDayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monKeys})\\s+(20\\d{2})\\b`, "i");
    m = headLines.match(reDayFirst) || scan.match(reDayFirst);
    if (m) {
      const mo = months[String(m[2]).toLowerCase()];
      const ms = utcMs(m[3], mo, m[1]);
      if (ms !== null) return ms;
    }

    // 5) As a last resort: look for a "date" label in the first 250 lines like: Date,12/10/2025
    // This catches some Squabbit exports that put "Date" in a metadata row.
    const labelMatch = headLines.match(/(?:^|,)\s*(date|round\s*date|event\s*date|played\s*on)\s*[,;:]\s*("?)([^"\r\n,;]+)\2/i);
    if (labelMatch) {
      const raw = String(labelMatch[3] || "").trim();
      // Try ISO parse first
      let msTry = _coerceDateMs(raw);
      if (Number.isFinite(msTry)) {
        const d = new Date(msTry);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      }
      // Try UK numeric inside raw
      const mm2 = raw.match(/\b(0?[1-9]|[12]\d|3[01])[-\/\.](0?[1-9]|1[0-2])[-\/\.](20\d{2})\b/);
      if (mm2) {
        const ms = utcMs(mm2[3], Number(mm2[2]) - 1, mm2[1]);
        if (ms !== null) return ms;
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function loadAllGamesAndBuildPlayerModel(opts = {}) {
  if (!client) { alert("Supabase client not ready"); return; }

  setSeasonError("");
  setSeasonLoading(true);
  setSeasonProgress({ done: 0, total: 0 });
  setSeasonFiles({ processed: [], skipped: [] });

// --- Tee metadata from Supabase DB (yardage/par/SI) ---
const teesCache = {};
function pickKey(obj, patterns) {
  const keys = Object.keys(obj || {});
  for (const p of patterns) {
    const re = (p instanceof RegExp) ? p : new RegExp(p, "i");
    const k = keys.find(k => re.test(k));
    if (k) return k;
  }
  return null;
}
async function getTeesForCourseName(courseName) {
  const key = normalizeName(courseName || "");
  if (!key) return null;
  if (teesCache[key] !== undefined) return teesCache[key];

  try {
    let course = null;

    // exact, then fuzzy
    let q = await client.from("courses").select("id,name").eq("name", courseName).maybeSingle();
    if (!q.error && q.data) course = q.data;
    if (!course) {
      q = await client.from("courses").select("id,name").ilike("name", `%${courseName}%`).limit(1);
      if (!q.error && q.data && q.data.length) course = q.data[0];
    }
    if (!course?.id) { teesCache[key] = null; return null; }

    const teesRes = await client.from("tees").select("*").eq("course_id", course.id);
    if (teesRes.error || !teesRes.data?.length) { teesCache[key] = null; return null; }

    const teeIds = teesRes.data.map(t => t.id);
    const holesRes = await client.from("hole_data").select("*").in("tee_id", teeIds);
    if (holesRes.error || !holesRes.data?.length) { teesCache[key] = null; return null; }

    const holesAll = holesRes.data;

    // detect column names dynamically
    const sample = holesAll[0] || {};
    const holeKey = pickKey(sample, [/hole/i, /hole.*number/i, /number/i]);
    const parKey  = pickKey(sample, [/^par$/i, /par/i]);
    const siKey   = pickKey(sample, [/stroke.*index/i, /^si$/i, /handicap/i, /strokeindex/i]);
    const yKey    = pickKey(sample, [/yards?/i, /yardage/i, /distance/i, /length/i, /metre/i, /meter/i]);

    const formatted = teesRes.data.map(t => {
      const rows = holesAll.filter(h => h.tee_id === t.id);
      const pars = Array(18).fill(NaN);
      const si = Array(18).fill(NaN);
      const yards = Array(18).fill(NaN);

      rows.forEach(h => {
        const holeNo = Number(holeKey ? h[holeKey] : h.hole_number);
        const idx = (holeNo || 0) - 1;
        if (idx < 0 || idx >= 18) return;

        const parN = Number(parKey ? h[parKey] : h.par);
        const siN  = Number(siKey ? h[siKey] : h.stroke_index);
        const yN   = Number(yKey ? h[yKey] : h.yards);

        if (Number.isFinite(parN)) pars[idx] = parN;
        if (Number.isFinite(siN)) si[idx] = siN;
        if (Number.isFinite(yN)) yards[idx] = yN;
      });

      return {
        teeName: t.color || t.tee_name || t.teeName || t.name || "Tee",
        gender: (t.gender === "Women" || t.gender === "F" || t.gender === "Female") ? "F" : "M",
        // Pull slope/rating from the tees table (column names vary)
        slope: toNum(t.slope ?? t.slope_rating ?? t.slopeRating ?? t.slope_value ?? t.slope_val ?? t.sr),
        rating: toNum(t.rating ?? t.course_rating ?? t.courseRating ?? t.course_rating_value ?? t.cr),
        pars, si, yards,
      };
    });

    teesCache[key] = formatted;
    return formatted;
  } catch (e) {
    teesCache[key] = null;
    return null;
  }
}

// Supabase Storage list() is not recursive — walk folders.
  async function listAllCsv(prefix) {
    const stack = [prefix];
    const found = [];
    const seen = new Set();

    while (stack.length) {
      const p = stack.pop();
      if (seen.has(p)) continue;
      seen.add(p);

      const res = await client.storage.from(BUCKET).list(p, { limit: 1000, sortBy: { column: "name", order: "asc" } });
      if (res.error) continue;

      for (const item of (res.data || [])) {
        const name = item && item.name ? String(item.name) : "";
        if (!name || name.startsWith(".")) continue;

        const isFolder = !item.id && !item.metadata;
        if (isFolder) {
          stack.push(p ? (p + "/" + name) : name);
          continue;
        }
        if (name.toLowerCase().endsWith(".csv")) {
          const path = p ? (p + "/" + name) : name;
          found.push({ name, path });
        }
      }
    }
    return found;
  }

  const files = await listAllCsv(PREFIX);
  if (!files.length) {
    setSeasonLoading(false);
    setSeasonError('No CSV files found under prefix "' + PREFIX + '".');
    return;
  }

  setSeasonProgress({ done: 0, total: files.length });

  const rounds = [];
  const processed = [];
  const skipped = [];
  let done = 0;

  for (const f of files) {
    try {
      const dl = await client.storage.from(BUCKET).download(f.path);
      if (dl.error) {
        skipped.push({ file: f.path, reason: "download" });
      } else {
        const csvText = await dl.data.text();
        // Extract an in-CSV date (same method as the dropdown list)
        const extractedDateMs = _extractDateMsFromCsvText(csvText) || _extractDateMsFromPath(f.path) || null;
        let parsed = null;
        try { parsed = parseScorecardCSV(csvText); 
                const dbTees = await getTeesForCourseName(parsed.courseName || parsed.internalCourseName || "");
                if (dbTees && dbTees.length) parsed.courseTees = dbTees;
} catch (e) { parsed = null; }

        if (!parsed || !parsed.players || !parsed.players.length) {
          skipped.push({ file: f.path, reason: "parse/empty" });
        } else {
          if (!Number.isFinite(parsed.dateMs) && Number.isFinite(extractedDateMs)) parsed.dateMs = extractedDateMs;
          rounds.push({ file: f.path, parsed, dateMs: (Number.isFinite(parsed.dateMs) ? parsed.dateMs : extractedDateMs) });
          processed.push(f.path);
        }
      }
    } catch (e) {
      skipped.push({ file: f.path, reason: "error" });
    } finally {
      done += 1;
      setSeasonProgress({ done, total: files.length });
    }
  }

// Sort rounds by in-CSV date (oldest first). If a file has no detectable date, push it to the end.
rounds.sort((a, b) => {
  const da = Number.isFinite(Number(a?.dateMs)) ? Number(a.dateMs) : (Number.isFinite(Number(a?.parsed?.dateMs)) ? Number(a.parsed.dateMs) : (a?.date ? _coerceDateMs(a.date) : Number.POSITIVE_INFINITY));
  const db = Number.isFinite(Number(b?.dateMs)) ? Number(b.dateMs) : (Number.isFinite(Number(b?.parsed?.dateMs)) ? Number(b.parsed.dateMs) : (b?.date ? _coerceDateMs(b.date) : Number.POSITIVE_INFINITY));
  if (da !== db) return da - db;
  // tie-breaker: path name (stable)
  return String(a?.file || "").localeCompare(String(b?.file || ""));
});

// Keep the "processed" list in the same chronological order as the model
const processedOrdered = rounds.map(r => r.file);
setSeasonFiles({ processed: processedOrdered, skipped });

setSeasonRounds(rounds);

  // Build model for current filters immediately (also re-computed automatically when filters change)
  const filteredRounds = _filterSeasonRounds(rounds, seasonYear, seasonLimit);
  const model = buildSeasonPlayerModel(filteredRounds);
  setSeasonModel(model);
  try { if (typeof window !== 'undefined') window.__seasonModel = model; } catch(e) {}
  try { if (typeof window !== 'undefined') window.__dslUiState = { seasonYear, seasonLimit }; } catch(e) {}
  if (!seasonPlayer && model.players.length) setSeasonPlayer(model.players[0].name);

  setSeasonLoading(false);
  try {
    const afterView = (opts && typeof opts === "object" && opts.afterView) ? String(opts.afterView) : "player_progress";
    setView(afterView);
  } catch (e) {
    setView("player_progress");
  }
}


        const [courseList, setCourseList] = useState([]);
        const [players, setPlayers] = useState([]);
        const [season, setSeason] = useState({});
        const [eventName, setEventName] = useState(LEAGUE_TITLE);

        // Keep browser tab title in sync with league route
        useEffect(() => {
          try { document.title = LEAGUE_HEADER_TITLE; } catch(e) {}
        }, [LEAGUE_HEADER_TITLE]);
        const [courseTees, setCourseTees] = useState([]);
        const [courseName, setCourseName] = useState("");
        const [currentFile, setCurrentFile] = useState(null);
        const fileInputRef = useRef(null);

        // Calculator State - Initialize to 0 so it's obvious when it changes
        const [courseSlope, setCourseSlope] = useState(0); 
        const [courseRating, setCourseRating] = useState(0);
        // Auto-sync slope/rating to the tee that the field is actually playing.
        // Rule: resolve each player's tee via chooseTeeForPlayer(), then pick the most common tee.
        useEffect(() => {
          try {
            if (!Array.isArray(players) || players.length === 0) return;
            if (!Array.isArray(courseTees) || courseTees.length === 0) return;

            // Only tees with real slope/rating
            const teesWithSR = courseTees.filter(t => Number(t.slope) > 0 && Number(t.rating) > 0);
            if (!teesWithSR.length) return;

            const counts = new Map(); // key -> { tee, n }
            for (const p of players) {
              const tee = chooseTeeForPlayer(p, courseTees);
              if (!tee || !(Number(tee.slope) > 0) || !(Number(tee.rating) > 0)) continue;
              const key = `${(tee.teeName||"").toLowerCase()}|${(tee.gender||"M").toUpperCase()}`;
              const cur = counts.get(key) || { tee, n: 0 };
              cur.n += 1;
              counts.set(key, cur);
            }
            if (!counts.size) return;

            // Pick most common tee in the field
            let best = null;
            for (const v of counts.values()) {
              if (!best || v.n > best.n) best = v;
            }
            if (!best) return;

            // Update only if different, so manual edits don't get spammed.
            const nextSlope = Number(best.tee.slope) || 0;
            const nextRating = Number(best.tee.rating) || 0;
            if (nextSlope && nextRating) {
              if (Number(courseSlope) !== nextSlope) setCourseSlope(nextSlope);
              if (Number(courseRating) !== nextRating) setCourseRating(nextRating);
            }
          } catch (e) {
            // no-op
          }
        }, [players, courseTees]);

        const [startHcapMode, setStartHcapMode] = useState("raw");
        const [nextHcapMode, setNextHcapMode] = useState("den");

        const [oddsMaxRounds, setOddsMaxRounds] = useState(12);

        // Per-society: keep inactive golfers in leagues/history but hide them from Winner Odds.
        // Map key = normalizeName(name) => true
        const [oddsExcludeMap, setOddsExcludeMap] = useState({});
        const [oddsExcludedNames, setOddsExcludedNames] = useState([]);

        useEffect(() => {
          let cancelled = false;
          async function boot() {
            try {
              // Tenant-aware boot: when SOCIETY_ID changes, this effect re-runs.
              // Clear tenant-scoped state up front to avoid cross-society "mixed CSV" races.
              try {
                setSharedGroups([]);
                setSeasonRounds([]);
                setSeasonFiles({ processed: [], skipped: [] });
                setSeasonError("");
                setSeasonsDef([]);
              } catch (e) { /* ignore */ }
              if (!SOCIETY_ID) { setStatusMsg("Waiting for society..."); return; }

              // Prefer the Supabase client created by AuthGate (keeps the magic-link session).
              // Fallback: create our own client if running standalone.
              const c =
                (props && props.supabase)
                  ? props.supabase
                  : (typeof window !== "undefined" && window.__supabase_client__)
                      ? window.__supabase_client__
                      : createClient(SUPA_URL, SUPA_KEY, {
                      auth: {
                        persistSession: true,
                        autoRefreshToken: true,
                        detectSessionInUrl: true,
                      },
                    });


              if (typeof window !== "undefined") window.__supabase_client__ = c;
              if (cancelled) return;

              setClient(c);
              const claimMemberships = async (session) => {
                const u = session?.user ?? null;
                if (!u) { claimDoneRef.current = false; return; }
                if (claimDoneRef.current) return;
                claimDoneRef.current = true;
                try {
                  await c.rpc("claim_memberships_from_email");
                } catch (e) {
                  // Non-fatal: user may not be allowlisted.
                }
              };

              c.auth.getSession().then(async ({ data: { session } }) => {
                setUser(session?.user ?? null);
                await claimMemberships(session);
              });

              c.auth.onAuthStateChange(async (_event, session) => {
                setUser(session?.user ?? null);
                await claimMemberships(session);
              });


              const probe = await c.from(STANDINGS_TABLE).select("name").limit(1);
              if (probe.error) { setStatusMsg("Error: " + probe.error.message); } 
              else {
                setStatusMsg("Connected");
                await refreshShared(c);
                await fetchSeasons(c);
                await fetchSeason(c);
                await fetchOddsExclusions(c);
                await fetchAvailableCourses(c);
                await fetchPlayerVisibility(c);
              }
            } catch (err) { if (!cancelled) setStatusMsg("Error: " + (err?.message || err)); }
          }
          boot();
          return () => { cancelled = true; };
        }, [SOCIETY_ID]);

        // Refetch standings when the selected league season changes
        useEffect(() => {
          if (!client) return;
          fetchSeason(client);
        }, [client, leagueSeasonYear]);

        async function handleLogin(email, password) {
  // If called without creds (e.g., button click), open modal
  if (!email || !password) { setLoginOpen(true); return; }
  setLoginBusy(true);
  try {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    toast("Logged in");
    setLoginOpen(false);
  } finally {
    setLoginBusy(false);
  }
}
        
        async function handleSwitchSociety() {
          // Keep the Supabase session, but clear any persisted "active society" selection
          // and navigate back to the app root so the society picker / slug bootstrap can run cleanly.
          try {
            if (typeof window !== "undefined") {
              // Clear in-memory globals used by App/AuthGate variants
              window.__activeSocietyId = "";
              window.__activeSocietySlug = "";
              window.__activeSocietyName = "";
              window.__activeSocietyRole = "";
            }
          } catch (e) {}

          try {
            // Clear persisted selections (support both older and newer keys)
            sessionStorage.removeItem("dsl_active_society_id");
            sessionStorage.removeItem("dsl_active_society_slug");
            sessionStorage.removeItem("dsl_active_society_name");

            localStorage.removeItem("den_active_society_id_v1");
            localStorage.removeItem("dsl_active_society_id");
            localStorage.removeItem("dsl_active_society_slug");
            localStorage.removeItem("dsl_active_society_name");
          } catch (e) {}

          // IMPORTANT: don't reload the current /<society-slug>/ URL, because slug bootstrapping
          // will immediately select the same society again.
          try {
            const base = (import.meta && import.meta.env && import.meta.env.BASE_URL) ? String(import.meta.env.BASE_URL) : "/golf/";
            window.location.href = base.endsWith("/") ? base : (base + "/");
          } catch (e) {
            try { window.location.href = "/golf/"; } catch (e2) {}
          }
        }


        async function handleLogout() {
          try { await client.auth.signOut(); } catch (e) {}
          setUser(null);
          try { window.location.reload(); } catch (e) { alert("Logged out"); }
        }

async function fetchPlayerVisibility(c) {
  try {
    c = c || client;
    if (!c) return;

    // Avoid noisy 400s when the file doesn't exist yet:
    // list first, then download only if present.
    const folder = `${PREFIX}/admin`;
    const listing = await c.storage.from(BUCKET).list(folder, { search: "player_visibility.json", limit: 1 });
    if (!listing || listing.error || !Array.isArray(listing.data) || listing.data.length === 0) return;

    const dl = await c.storage.from(BUCKET).download(ADMIN_VIS_PATH);
    if (dl && dl.data) {
      const txt = await dl.data.text();
      const j = JSON.parse(txt);
      const keys = Array.isArray(j?.hiddenKeys) ? j.hiddenKeys : (Array.isArray(j?.hidden) ? j.hidden : []);
      if (Array.isArray(keys)) {
        const cleaned = keys.map(x => String(x||"").trim()).filter(Boolean);
        setHiddenPlayerKeys(Array.from(new Set(cleaned)));
        try { localStorage.setItem(VIS_LS_KEY, JSON.stringify(Array.from(new Set(cleaned)))); } catch {}
      }
    }
  } catch (e) {
    // ignore missing file / parse errors
  }
}

async function savePlayerVisibility(nextHiddenKeys) {
  const cleaned = Array.from(new Set((Array.isArray(nextHiddenKeys) ? nextHiddenKeys : []).map(x => String(x||"").trim()).filter(Boolean)));
  setHiddenPlayerKeys(cleaned);
  try { localStorage.setItem(VIS_LS_KEY, JSON.stringify(cleaned)); } catch {}
  if (!client) return;
  if (!user) { toast("Saved locally (sign in to publish to everyone)"); return; }

  try {
    const payload = JSON.stringify({
      hiddenKeys: cleaned,
      updatedAt: new Date().toISOString(),
      updatedBy: user?.email || ""
    }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const up = await client.storage.from(BUCKET).upload(ADMIN_VIS_PATH, blob, { upsert: true, contentType: "application/json" });
    if (up && up.error) toast("Save failed: " + up.error.message);
    else toast("Player filter saved ✓");
  } catch (e) {
    toast("Save failed: " + (e?.message || e));
  }
}
        async function fetchAvailableCourses(c) {
           c = c || client; if(!c) return;
           const { data, error } = await c.from('courses').select('id, name').order('name');
           if(!error && data) setCourseList(data);
        }

        async function autoDetectAndLoadCourse(filename) {
            if (!courseList.length || !filename) return false;

            // Normalise filename -> tokens (exact word match, not substring match).
            const cleanFile = String(filename)
              .toLowerCase()
              .replace(/\.csv$/i, "")
              .replace(/[_\-]/g, " ")
              .replace(/[^a-z0-9\s]/g, " ")
              .replace(/\s+/g, " ")
              .trim();

            // Words we never want to use for matching.
            const noiseWords = new Set([
              "golf","club","course","society","gc","the","and","of","at","&",
              "resort","links","hotel","country","park","estate"
            ]);

            const fileTokens = cleanFile
              .split(/\s+/)
              .map(w => w.trim())
              .filter(w => w && w.length > 2 && !noiseWords.has(w));

            const fileTokenSet = new Set(fileTokens);

            let bestMatch = null;
            let bestScore = -1;     // higher is better
            let bestDistance = 1e9; // lower is better (tie-break)

            for (const course of courseList) {
              const dbNameClean = String(course.name || "")
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, " ")
                .replace(/\s+/g, " ")
                .trim();

              const dbTokens = dbNameClean
                .split(/\s+/)
                .map(w => w.trim())
                .filter(w => w && w.length > 2 && !noiseWords.has(w));

              if (!dbTokens.length) continue;

              // Exact token matches only (prevents "westerham" matching "west").
              let matches = 0;
              let matchedChars = 0;
              for (const t of dbTokens) {
                if (fileTokenSet.has(t)) {
                  matches++;
                  matchedChars += t.length;
                }
              }

              // Score prioritises: more exact matches, then more specificity (chars), then similarity distance.
              const score = matches * 100 + matchedChars;

              // If we got zero exact matches, allow a cautious fuzzy fallback.
              // This helps with minor typos, but avoids confusing "West Kent" with "Westerham".
              const d = (matches > 0)
                ? levenshtein(normalizeName(cleanFile), normalizeName(dbNameClean))
                : (isFuzzyMatch(cleanFile, dbNameClean) ? levenshtein(normalizeName(cleanFile), normalizeName(dbNameClean)) : 1e9);

              const qualifies = (matches > 0) || (d < 6); // fuzzy threshold (tight on purpose)

              if (!qualifies) continue;

              if (score > bestScore || (score === bestScore && d < bestDistance)) {
                bestScore = score;
                bestDistance = d;
                bestMatch = course;
              }
            }

            if (bestMatch) {
              toast(`Auto-detected: ${bestMatch.name}`);
              await loadCourseFromDB(bestMatch.id);
              return true;
            }
            return false;
        }

        async function loadCourseFromDB(courseId) {
            if(!client || !courseId) return;
            const courseRes = await client.from('courses').select('name').eq('id', courseId).single();
            if(courseRes.data) setCourseName(courseRes.data.name);
            const teesRes = await client.from('tees').select('*').eq('course_id', courseId);
            if(teesRes.error || !teesRes.data.length) {
              toast("No tee data found for this course.");
              return;
            }
            const dbTees = teesRes.data;
            const teeIds = dbTees.map(t => t.id);
            const holesRes = await client.from('hole_data').select('*').in('tee_id', teeIds);
            if(holesRes.error) { toast("Error loading hole data."); return; }
            const allHoles = holesRes.data;
            // Slope/Rating are now resolved from the tee actually being played (see auto-sync effect)
            // Initialise to 0 here so the auto-sync can fill correctly.
            setCourseSlope(0);
            setCourseRating(0);

            const formattedTees = dbTees.map(t => {
              const holes = allHoles.filter(h => h.tee_id === t.id).sort((a,b) => a.hole_number - b.hole_number);
              const pars = Array(18).fill(0);
              const si = Array(18).fill(0);
              const yards = Array(18).fill(0);
              holes.forEach(h => {
                  const idx = h.hole_number - 1;
                  if(idx >= 0 && idx < 18) {
                    pars[idx] = h.par;
                    si[idx] = h.stroke_index;
                    yards[idx] = h.yards;
                  }
              });
              return { 
                  teeName: t.color, 
                  gender: (t.gender === 'Women' || t.gender === 'F' || t.gender === 'Female') ? 'F' : 'M', 
                  slope: Number(t.slope) || 0,
                  rating: Number(t.rating) || 0,
                  pars, si, yards 
              };
            });
            setCourseTees(formattedTees);
        }

        function groupEventsByYear(files) {
  const groups = {};
  for (const f of (files || [])) {
    const ms = Number(f?.dateMs);
    const y = Number.isFinite(ms) && ms > 0 ? new Date(ms).getUTCFullYear() : null;
    const m = String(f?.name || "").match(/(20\d{2})/);
    const year = y ? String(y) : (m ? m[1] : "Unknown");
    (groups[year] ||= []).push({ ...f, dateMs: Number.isFinite(ms) ? ms : null });
  }

  const yearKeys = Object.keys(groups).sort((a, b) => {
    const na = Number(a), nb = Number(b);
    const aNum = Number.isFinite(na) ? na : Infinity; // Unknown goes last
    const bNum = Number.isFinite(nb) ? nb : Infinity;
    return aNum - bNum; // oldest year first
  });

  return yearKeys.map((y) => {
    const evs = (groups[y] || []).slice().sort((a, b) => {
      const ax = Number(a?.dateMs);
      const bx = Number(b?.dateMs);
      const aMs = (Number.isFinite(ax) && ax > 0) ? ax : Infinity;
      const bMs = (Number.isFinite(bx) && bx > 0) ? bx : Infinity;
      if (aMs !== bMs) return aMs - bMs; // oldest first
      return String(a?.name || "").localeCompare(String(b?.name || ""));
    });
    return { year: y, events: evs };
  });
}



function seasonIdForDateMs(ms, seasonsArr) {
  try {
    const n = Number(ms);
    const d = new Date(_coerceDateMs(ms));
    if (!Number.isFinite(d.getTime())) return null;
    const iso = d.toISOString().slice(0,10);
    for (const s of (seasonsArr || [])) {
      const a = String(s.start_date || s.startDate || "").slice(0,10);
      const b = String(s.end_date || s.endDate || "").slice(0,10);
      if (a && b && iso >= a && iso < b) return String(s.season_id);
    }
    return null;
  } catch { return null; }
}

async function fetchSeasons(c) {
  c = c || client; if (!c) return;
  const r = await c.from('seasons').select('competition,season_id,label,start_date,end_date,is_active').eq('competition', COMPETITION).eq('society_id', SOCIETY_ID).eq('society_id', SOCIETY_ID).order('start_date', { ascending: false });
  if (r.error) { toast('Seasons load failed: ' + r.error.message); return; }
  const arr = Array.isArray(r.data) ? r.data : [];
  setSeasonsDef(arr);
  try { if (typeof window !== 'undefined') window.__dslSeasonsDef = arr; } catch(e) {}
  const active = arr.find(x => x.is_active) || arr[0];
  const activeId = active ? String(active.season_id) : '';
  setActiveSeasonId(activeId);
  // If user hasn't chosen, default to active
  setLeagueSeasonYear(prev => {
    const p = String(prev || '');
    if (!p || p.toLowerCase() === 'all') return activeId || 'All';
    return p;
  });
}

async function refreshShared(c) {
          c = c || client; if (!c) return;
          const r = await c.storage.from(BUCKET).list(PREFIX, { limit: 1000, sortBy: { column: "name", order: "asc" } });
          if (r.error) { toast("Storage error: " + r.error.message); return; }

          // Build file list
          const files = (r.data || [])
            .filter((x) => x?.name && !x.name.startsWith(".") && /\.csv$/i.test(x.name))
            .map((x) => ({ 
              name: x.name.replace(/\.csv$/i, ""), 
              file: x.name, 
              path: `${PREFIX}/${x.name}`,
              dateMs: null
            }));

          // IMPORTANT: Dates live inside the CSV content (e.g. "Game 1,Nov 12 2025").
          // So we cheaply download each file and extract a date from the header section.
          // (If you ever want to optimise, we can do a server-side manifest table instead.)
          for (const f of files) {
            try {
              const dl = await c.storage.from(BUCKET).download(f.path);
              if (dl.error) continue;
              const text = await dl.data.text();

              // Date: extracted from in-CSV header or filename
              f.dateMs = _extractDateMsFromCsvText(text) || _extractDateMsFromPath(f.file) || null;

              // Season mapping (date-range based; uses public.seasons ranges for this competition)
              f.seasonId = f.dateMs ? (seasonIdForDateMs(f.dateMs, seasonsDef) || null) : null;

              // Course: the CSV already contains it — parse just once here so the picker can show a nice name.
              try {
                const parsed = parseScorecardCSV(text);
                f.courseName = parsed?.courseName || parsed?.internalCourseName || "";
                // Optional: if your parser exposes format, surface it too (safe fallback).
                f.format = parsed?.format || parsed?.gameFormat || parsed?.formatName || "";
              } catch (e) {
                // Ignore parsing failures here — the actual load step still validates.
                f.courseName = f.courseName || "";
                f.format = f.format || "";
              }
            } catch (e) { /* ignore */ }
          }

          setSharedGroups(groupEventsByYear(files));
        }
        async function loadShared(item) {
          if (!client) { alert("Supabase client not ready"); return; }
          const r = await client.storage.from(BUCKET).download(item.path);
          if (r.error) { alert("Download failed: " + r.error.message); return; }
          const text = await r.data.text();
          let parsed;
          try { parsed = parseScorecardCSV(text); } catch (err) { alert(err?.message || "Failed to parse CSV."); return; }
          setPlayers(parsed.players || []);
          setSelectedPlayer(parsed.players[0]?.name || "");
          setEventName(item.name);
          setCurrentFile(null);

          // Capture event date + filename even when loading from Storage (so Add-to-Season can persist to Supabase)
          try {
            const ms =
              Number.isFinite(parsed?.dateMs)
                ? parsed.dateMs
                : (_extractDateMsFromCsvText(text) || _extractDateMsFromPath(item.path) || null);
            setLoadedEventDateMs(Number.isFinite(ms) ? ms : null);
          } catch { setLoadedEventDateMs(null); }
          setLoadedEventFileName(item?.name || String(item?.path || "").split("/").pop() || "");
          
          const dbCourseFound = await autoDetectAndLoadCourse(parsed.courseName || item.file);
          if (!dbCourseFound) {
             setCourseTees(parsed.courseTees || []);
             setCourseName(parsed.courseName || "");
          }
          
          setView("event");
          toast("Event loaded");
        }


        async function fetchSeason(c) {
          c = c || client; if (!c) return;
          let q = c.from(STANDINGS_TABLE).select("*").eq("competition", COMPETITION).eq("society_id", SOCIETY_ID);
          if (leagueSeasonYear && String(leagueSeasonYear).toLowerCase() !== "all") q = q.eq("season_id", String(leagueSeasonYear));
          const r = await q;
          if (r.error) { setStatusMsg("Error: " + r.error.message); return; }
          const map = {};
          for (const rec of r.data || []) {
            if (isTeamLike(rec.name)) continue;
            let bph = [];
            if (Array.isArray(rec.best_per_hole)) bph = rec.best_per_hole;
            else if (typeof rec.best_per_hole === "string") { try { bph = JSON.parse(rec.best_per_hole); } catch {} }
            map[rec.name] = { name: rec.name, totalPoints: rec.total_points || 0, events: rec.events || 0, bestEventPoints: rec.best_event_points ?? 0, bestHolePoints: rec.best_hole_points ?? 0, eclecticTotal: rec.eclectic_total ?? 0, bestPerHole: (bph || []).map((n) => Number(n) || 0), };
          }
          setSeason(map);
        }

        async function fetchOddsExclusions(c) {
          c = c || client; if (!c) return;
          try {
            const r = await c
              .from(STANDINGS_TABLE)
              .select("name,exclude_from_odds")
              .eq("competition", COMPETITION)
              .eq("society_id", SOCIETY_ID)
              .neq("name", "");
            if (r.error) return;
            const m = {};
            const names = [];
            for (const rec of (r.data || [])) {
              const nm = String(rec?.name || "").trim();
              if (!nm) continue;
              const k = normalizeName(nm);
              if (!k) continue;
              if (rec?.exclude_from_odds) { m[k] = true; names.push(nm); }
            }
            setOddsExcludeMap(m);
            setOddsExcludedNames(names);
          } catch (e) {
            // ignore
          }
        }

        async function setExcludeFromOdds(name, exclude) {
          const nm = String(name || "").trim();
          if (!nm) return;
          const k = normalizeName(nm);
          if (!k) return;
          // Optimistic UI: remove immediately
          setOddsExcludeMap((prev) => ({ ...(prev || {}), [k]: !!exclude }));
          try {
            const up = await client
              .from(STANDINGS_TABLE)
              .update({ exclude_from_odds: !!exclude })
              .eq("competition", COMPETITION)
              .eq("society_id", SOCIETY_ID)
              .eq("name", nm);
            if (up?.error) {
              toast("Could not update odds visibility: " + up.error.message);
            }
          } catch (e) {
            toast("Could not update odds visibility");
          } finally {
            try { await fetchOddsExclusions(client); } catch {}
          }
        }

        function importLocalCSV(text, filename, fileObj) {
          let parsed;
          try { parsed = parseScorecardCSV(text); } catch (err) { alert(err?.message || "Failed to parse CSV."); return; }
          setPlayers(parsed.players || []);
          setSelectedPlayer(parsed.players[0]?.name || "");
          setEventName((filename || "").replace(/\.[^.]+$/, ""));
          
          // Capture event date from CSV for persistence
          setLoadedEventDateMs(
            Number.isFinite(parsed?.dateMs)
              ? parsed.dateMs
              : (_extractDateMsFromCsvText(text) || null)
          );
          setLoadedEventFileName(filename || "");
if(fileObj) setCurrentFile(fileObj);
          
          autoDetectAndLoadCourse(parsed.courseName || filename).then(found => {
             if (!found) {
                setCourseTees(parsed.courseTees || []);
                setCourseName(parsed.courseName || "");
             }
          });
          setView("event");
        }
        function compareByCountback(a, b) {
          const pa = a.perHole || []; const pb = b.perHole || [];
          const sum = (arr, s, e) => arr.slice(s, e).reduce((x, y) => x + (Number(y) || 0), 0);
          const aB9 = sum(pa, 9, 18), bB9 = sum(pb, 9, 18);
          if (aB9 !== bB9) return bB9 - aB9;
          const aL6 = sum(pa, 12, 18), bL6 = sum(pb, 12, 18);
          if (aL6 !== bL6) return bL6 - aL6;
          const aL3 = sum(pa, 15, 18), bL3 = sum(pb, 15, 18);
          if (aL3 !== bL3) return bL3 - aL3;
          return 0;
}
        const computed = useMemo(() => {
          if (!players.length) return [];
          const rows = players.map((p, i) => {
             // Starting handicap from Squabbit (REAL, used for points/league)
             const startExactRaw = Number(p.handicap);
             const startExact = Number.isFinite(startExactRaw) ? startExactRaw : 0;

             // REAL playing handicap used throughout the app (do NOT change with slope here)
             const playingHcap = Math.round(startExact);

             // VISUAL ONLY "what-if" COURSE handicap (UK WHS-style), never used for strokes/points
             // Course Handicap ≈ HI * (Slope/113) + (Course Rating - Par), then rounded at the end.
             let playingHcapRef = null;
             if (startHcapMode === 'calc') {
                 const slope = Number(courseSlope) || 113;
                 const rating = Number(courseRating) || 0;

                 let par = 72;
                 try {
                   const tee = chooseTeeForPlayer({ gender: p.gender, teeLabel: p.teeLabel }, courseTees);
                   if (tee && Array.isArray(tee.pars) && tee.pars.length) {
                     const s = tee.pars.reduce((acc, v) => acc + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
                     if (s > 0) par = s;
                   }
                 } catch {}

                 const exact = startExact * (slope / 113) + (rating - par);
                 playingHcapRef = Math.round(exact);
             }
return {
                idx: i,
                name: p.name,
                gender: p.gender,
                teeLabel: p.teeLabel,
                startExact,
                playingHcap,
                playingHcapRef,
                points: p.points,
                back9: p.back9,
                perHole: p.perHole,
                grossPerHole: p.grossPerHole,
                imputedGrossPerHole: p.imputedGrossPerHole,
                imputedMask: p.imputedMask,
                bestBallPerHole: p.bestBallPerHole // FIX INTEGRATED HERE
             };
          });
          const base = [...rows].sort((a, b) => b.points - a.points || compareByCountback(a, b));

// Group ties using BOTH total points AND countback buckets (back 9, last 6, last 3).
// This means countback breaks ties for league positions/points.
// Only if all buckets match do players remain joint.
const _cbKey = (r) => {
  const ph = Array.isArray(r?.perHole) ? r.perHole : [];
  const sum = (s, e) => ph.slice(s, e).reduce((x, y) => x + (Number(y) || 0), 0);
  const b9 = sum(9, 18);
  const l6 = sum(12, 18);
  const l3 = sum(15, 18);
  return `${Number(r?.points) || 0}|${b9}|${l6}|${l3}`;
};

const groups = [];
let _cur = [];
let _prevKey = null;
for (const r of base) {
  const k = _cbKey(r);
  if (_prevKey === null || k === _prevKey) {
    _cur.push(r.idx);
  } else {
    groups.push(_cur);
    _cur = [r.idx];
  }
  _prevKey = k;
}
if (_cur.length) groups.push(_cur);
          const topGroup = groups[0]?.map((i) => rows.find((r) => r.idx === i)) || [];
          let best = topGroup.length ? [topGroup[0]] : [];
          for (let k = 1; k < topGroup.length; k++) {
            const cmp = compareByCountback(topGroup[k], best[0]);
            if (cmp > 0) best = [topGroup[k]];
            else if (cmp === 0) best.push(topGroup[k]);
          }
          const winnerIdxSet = new Set(best.map((r) => r.idx));
          let pos = 1; const out = [];
          for (let gi = 0; gi < groups.length; gi++) {
            const g = groups[gi];
            const start = pos;
            const ptsValue = POINTS_TABLE[start - 1] || 0;
            for (const i of g) {
              const r = rows.find((x) => x.idx === i);
              const isWinner = winnerIdxSet.has(i) && gi === 0;
              
              // Next Handicap Logic
              let nextDisplay = "-";
              let nextExactNum = Number(r.startExact);

              if (nextHcapMode === 'den') {
                 const hc = computeNewExactHandicap(r.startExact, r.gender, r.points, r.back9, isWinner);
                 nextExactNum = clamp(Number(hc.nextExact), 0, 36);
                 nextDisplay = Number.isFinite(nextExactNum) ? nextExactNum.toFixed(1) : "—";
              } else if (nextHcapMode === 'whs') {
                 // WHS-compliant preview: compute this round's Score Differential (from gross hole scores with NDB caps),
                 // then compute the resulting Handicap Index using the available differential history in seasonRounds (+ this round).
                 let tee = null;
                 let useSlope = Number(courseSlope) || 113;
                 let useRating = Number(courseRating) || 0;
                 try {
                   tee = chooseTeeForPlayer(r, courseTees);
                   if (tee && Number(tee.slope) > 0) useSlope = Number(tee.slope);
                   if (tee && Number(tee.rating) > 0) useRating = Number(tee.rating);
                 } catch {}

                 // Build tee layout shape expected by WHS util
                 const teeLayout = tee ? { pars: (tee.pars || tee.par || tee.Pars || []), si: (tee.si || tee.SI || tee.strokeIndex || []) } : { pars: [], si: [] };

                 const ags = WHS_adjustedGrossFromHoleScores((r.imputedGrossPerHole || r.grossPerHole), teeLayout, r.startExact, useSlope, useRating);
                 let diffThis = WHS_scoreDifferential(ags, useSlope, useRating, 0);

                 // Pull differential history for this player from seasonRounds (excluding this file if already present)
                 const hist = [];
                 try {
                   const exFile = r.file || null;
                   for (const rr of (Array.isArray(seasonRounds) ? seasonRounds : [])) {
                     if (!rr || !rr.parsed) continue;
                     if (exFile && rr.file === exFile) continue;
                     const parsed = rr.parsed;
                     const ps = Array.isArray(parsed.players) ? parsed.players : [];
                     // Match players using the same normalisation used elsewhere in the app
                     const targetKey = normalizeName(String(r.name || ""));
                     const pl = ps.find(x => normalizeName(String(x?.name || "")) === targetKey);
                     if (!pl) continue;

                     // tee for that round
                     let t2 = null;
                     let sl2 = Number(parsed.courseSlope) || Number(courseSlope) || 113;
                     let rt2 = Number(parsed.courseRating) || Number(courseRating) || 0;
                     const tees2 = parsed.courseTees || courseTees || [];
                     try {
                       t2 = chooseTeeForPlayer(pl, tees2);
                       if (t2 && Number(t2.slope) > 0) sl2 = Number(t2.slope);
                       if (t2 && Number(t2.rating) > 0) rt2 = Number(t2.rating);
                     } catch {}

                     const tl2 = t2 ? { pars: (t2.pars || t2.par || []), si: (t2.si || t2.SI || []) } : { pars: [], si: [] };
                     const hi2 = Number(pl.startExact ?? pl.hi ?? pl.handicap);
                     const holes2 = (pl.grossPerHole || pl.imputedGrossPerHole);
                     if (!Array.isArray(holes2) || holes2.length === 0) continue;
                     const ags2 = WHS_adjustedGrossFromHoleScores(holes2, tl2, hi2, sl2, rt2);
                     const d2 = WHS_scoreDifferential(ags2, sl2, rt2, 0);
                     if (Number.isFinite(d2)) hist.push({ d: d2, t: (Number(rr.dateMs) || 0) });
                   }
                 } catch {}

                   // (Requires hole-by-hole gross scores; imputedGrossPerHole is accepted if present.)
// Add this round's diff at "now"
                 if (Number.isFinite(diffThis)) hist.push({ d: diffThis, t: Number(Date.now()) });

                 // Most recent 20 by time
                 hist.sort((a,b)=>a.t-b.t);
                 const last20 = hist.slice(-20).map(x=>x.d);

                 const nextHI = WHS_handicapIndexFromDiffs(last20);

                 // Display: next HI (what the round would do to their index), rounded to 1dp.
                 // If not enough history (n<3), show differential instead (still WHS-correct).
                 nextExactNum = Number.isFinite(nextHI) ? clamp(Number(nextHI), 0, 36) : clamp(Number(r.startExact), 0, 36);

                 // Display: next HI (what the round would do to their index), rounded to 1dp.
                 // If not enough history (n<3), show differential instead (still WHS-correct).
                 nextDisplay = Number.isFinite(nextHI) ? nextHI.toFixed(1) : (Number.isFinite(diffThis) ? diffThis.toFixed(1) : "—");
              } else {
                 nextExactNum = clamp(Number(r.startExact), 0, 36);
                 nextDisplay = Number.isFinite(nextExactNum) ? nextExactNum.toFixed(1) : "—";
              }

              

              // --- // --- Winner odds (next HI) form stats (Stableford points vs 36) ---
              // Build a per-player Stableford history (including this round) so the model works in ALL next-HI modes.
              let formN = 0;         // rounds USED for odds model
              let oddsSimilarRounds = 0; // rounds available within ±4 HI
              let oddsRoundsUsed = 0;    // rounds actually used (similar if enough else fallback)
              let oddsUsedSimilar = false;
              let formMu = 0;         // mean of (pts-36), shrunk toward 0 for small samples
              let formSigma = 4.0;    // volatility in points
              let formTrend = 0;      // slope of (pts-36) per round index
              let expPts = 36;

              try {
                const ptsHistLocal = [];
                // 1) prior rounds from seasonRounds (points + handicap at the time)
                for (const rr of (Array.isArray(seasonRounds) ? seasonRounds : [])) {
                  if (!rr || !rr.parsed) continue;
                  const parsed = rr.parsed;
                  const ps = Array.isArray(parsed.players) ? parsed.players : [];
                  // Match players using the same normalisation used elsewhere in the app
                  const targetKey = normalizeName(String(r.name || ""));
                  const pl = ps.find(x => normalizeName(String(x?.name || "")) === targetKey);
                  if (!pl) continue;

                  let pts2 = Number(pl.points);
                  if (!Number.isFinite(pts2) && Array.isArray(pl.perHole)) {
                    try { pts2 = pl.perHole.reduce((a,b)=>a + (Number(b)||0), 0); } catch { pts2 = NaN; }
                  }

                  // starting handicap for that round (best-effort)
                  let h2 = Number(pl.startExact);
                  if (!Number.isFinite(h2)) h2 = Number(pl.handicap);
                  if (!Number.isFinite(h2)) h2 = Number(pl.hcap);
                  if (!Number.isFinite(h2)) h2 = Number(pl.HI);
                  if (!Number.isFinite(h2)) h2 = Number(pl.hi);

                  if (Number.isFinite(pts2)) ptsHistLocal.push({ p: pts2, t: (Number(rr.dateMs) || 0), h: h2 });
                }

                // 2) add THIS round (the one we're forecasting "next" from) as the most recent datapoint
                if (Number.isFinite(Number(r.points))) ptsHistLocal.push({ p: Number(r.points), t: Number(Date.now()), h: Number(r.startExact) });

                ptsHistLocal.sort((a,b)=>a.t-b.t);

                // Build last up to 12 rounds, then prefer those within ±4 HI of the *next* handicap
                const lastAll = ptsHistLocal.slice(-Math.max(3, Math.min(12, Number(oddsMaxRounds) || 12)));

                const targetHI = (Number.isFinite(Number(nextExactNum)) ? Number(nextExactNum) : Number(r.startExact));
                const similar = lastAll.filter(x => Number.isFinite(Number(x.h)) && Math.abs(Number(x.h) - targetHI) <= 4);

                oddsSimilarRounds = similar.length;

                // Use similar-handicap rounds if we have enough signal; otherwise fall back to all rounds
                const useArr = (similar.length >= 3) ? similar : lastAll;
                oddsUsedSimilar = (similar.length >= 3);

                const lastPts = useArr.map(x => Number(x.p)).filter(Number.isFinite);
                oddsRoundsUsed = lastPts.length;

                formN = lastPts.length;

                if (formN >= 2) {
                  // Recency weighting (newer rounds count more). Half-life ~6 rounds.
                  const hl = 6;
                  const ws = lastPts.map((_,i)=>Math.pow(0.5, (formN-1-i)/hl));
                  const wSum = ws.reduce((a,b)=>a+b,0) || 1;

                  // Effective sample size for shrinkage
                  const w2 = ws.reduce((a,w)=>a+w*w,0) || 1;
                  const nEff = Math.max(1, (wSum*wSum)/w2);

                  // Work in "points above/below 36"
                  const adj = lastPts.map(p=>p-36);

                  // Weighted mean and variance
                  const muRaw = adj.reduce((a,v,i)=>a + v*ws[i], 0) / wSum;
                  const varW = adj.reduce((a,v,i)=>a + ws[i]*Math.pow(v-muRaw,2), 0) / wSum;

                  // Shrink toward 0 for small samples (prevents silly 45+ expected points off 1 hot round)
                  const tau = 6; // prior strength (in "effective rounds")
                  const shrink = nEff / (nEff + tau);

                  formMu = muRaw * shrink;

                  // Volatility: base from weighted variance, inflated a bit when sample is small
                  const sigmaRaw = Math.sqrt(Math.max(1.0, varW)); // floor 1.0 point
                  formSigma = Math.min(8.0, sigmaRaw * (1 + 1/Math.sqrt(nEff)));

                  // Trend (weighted slope)
                  try {
                    const xs = lastPts.map((_,i)=>i);
                    const xBar = xs.reduce((a,v,i)=>a + v*ws[i], 0) / wSum;
                    const yBar = adj.reduce((a,v,i)=>a + v*ws[i], 0) / wSum; // equals muRaw
                    const cov = adj.reduce((a,y,i)=>a + ws[i]*(xs[i]-xBar)*(y-yBar), 0);
                    const varX = xs.reduce((a,x,i)=>a + ws[i]*Math.pow(x-xBar,2), 0);
                    const slope = (varX > 1e-9) ? (cov / varX) : 0;
                    formTrend = (Number.isFinite(slope) ? slope : 0) * shrink;
                  } catch { formTrend = 0; }

                  // Base expected points (before handicap change/trend projection)
                  expPts = 36 + formMu;
                } else if (formN === 1) {
                  // One datapoint: heavily shrink to avoid overconfidence
                  const muRaw = (lastPts[0] - 36);
                  formMu = muRaw * 0.15;
                  formSigma = 6.0;
                  formTrend = 0;
                  expPts = 36 + formMu;
                } else {
                  // No history: neutral
                  formMu = 0;
                  formSigma = 6.0;
                  formTrend = 0;
                  expPts = 36;
                }
              } catch {
                formN = 0;
                formMu = 0;
                formSigma = 6.0;
                formTrend = 0;
                expPts = 36;
              }

              // Adjust expected points for next handicap change + a one-round trend projection.
              // If next handicap gets lower (harder), expected points drop roughly by that delta (and vice versa).
              try {
                const deltaH = (Number.isFinite(Number(nextExactNum)) && Number.isFinite(Number(r.startExact)))
                  ? (Number(nextExactNum) - Number(r.startExact)) : 0;

                // Trend projection for "next round": cap to keep it sane
                const trendAdj = Number.isFinite(formTrend) ? Math.max(-2, Math.min(2, formTrend * 0.75)) : 0;

                // Clamp to plausible Stableford range and also avoid showing absurdly high expectations off thin history
                expPts = Math.max(20, Math.min(50, Number(expPts) + deltaH + trendAdj));
              } catch {}



              out.push({ ...r, position: start, leaguePoints: ptsValue, isWinner, nextDisplay, nextExactNum, formN, oddsRoundsUsed, oddsSimilarRounds, oddsUsedSimilar, formMu, formTrend, formSigma, expPts });
            }
            pos += g.length;
          }
          return out.sort((a, b) => a.position - b.position);
        }, [players, courseTees, courseSlope, courseRating, startHcapMode, nextHcapMode, seasonRounds, oddsMaxRounds]);

        
async function ensureSeasonExists(client) {
  const existing = await client
    .from('seasons')
    .select('season_id')
    .eq('society_id', SOCIETY_ID)
    .eq('competition', COMPETITION)
    .order('start_date', { ascending: false })
    .limit(1);

  if (existing.data && existing.data.length) {
    return existing.data[0].season_id;
  }

  // create a default season
  const year = new Date().getFullYear();
  const season_id = String(year);
  const start_date = `${year}-01-01`;
  const end_date = `${year+1}-01-01`;

  const { error } = await client.from('seasons').insert({
    society_id: SOCIETY_ID,
    competition: COMPETITION,
    season_id,
    label: season_id,
    start_date,
    end_date,
    is_active: true
  });

  if (error) throw error;
  return season_id;
}

async function addEventToSeason() {
          if (!computed.length) { toast("Load an event first"); return; }
          if (!user) { alert("Please log in as admin first."); return; }
          
          // 1. UPLOAD FILE IF EXISTS
          if (currentFile) {
              toast("Uploading file...");
              const fileName = currentFile.name;
              const path = `${PREFIX}/${fileName}`;
              const { error: uploadError } = await client.storage
                .from(BUCKET)
                .upload(path, currentFile, { upsert: true });

              if (uploadError) {
                alert("File upload failed: " + uploadError.message);
              } else {
                toast("File uploaded successfully.");
              }
          }

          // 2. UPDATE SEASON STATS
          const next = { ...season };
          for (const r of computed) {
            if (isTeamLike(r.name)) continue;
            const prev = next[r.name] || {
              name: r.name, totalPoints: 0, events: 0, bestPerHole: Array(18).fill(0), eclecticTotal: 0, bestEventPoints: 0, bestHolePoints: 0,
            };
            const eventPerHole = (r.perHole || []).map((v) => Math.max(0, Math.min(6, Number(v) || 0)));
            const bestPerHole = prev.bestPerHole.map((v, i) => Math.max(v, eventPerHole[i]));
            const eclecticTotal = bestPerHole.reduce((s, v) => s + v, 0);
            const bestEvent = Math.max(prev.bestEventPoints || 0, r.points || 0);
            const bestHole = Math.max(prev.bestHolePoints || 0, Math.max(...eventPerHole));
            next[r.name] = {
              name: r.name, totalPoints: (prev.totalPoints || 0) + (r.leaguePoints || 0), events: (prev.events || 0) + 1,
              bestEventPoints: bestEvent, bestHolePoints: bestHole, eclecticTotal, bestPerHole,
            };
          }
          setSeason(next);
          if (client) {
            const vals = Object.values(next).filter((r) => !isTeamLike(r.name));
            let targetSeasonId = (leagueSeasonYear && String(leagueSeasonYear).toLowerCase() !== "all")
              ? String(leagueSeasonYear)
              : (seasonsDef.find((x) => x && x.is_active)?.season_id || "");

            if (!targetSeasonId) {
              targetSeasonId = await ensureSeasonExists(client);
            }
            

            // Persist event metadata (event_date) so historical CSVs stay in the correct season after reload
            try {
              const ms = Number.isFinite(loadedEventDateMs) ? loadedEventDateMs : null;
              const fileName = (currentFile && currentFile.name) ? currentFile.name : (loadedEventFileName || "");
              if (ms && fileName) {
                const event_date = new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD
                const storage_path = `${PREFIX}/${fileName}`;
                const evRes = await client.from("events").upsert(
                  [{
                    society_id: SOCIETY_ID,
                    competition: COMPETITION,
                    season_id: targetSeasonId,
                    event_name: (fileName || "").replace(/\.[^.]+$/, ""),
                    storage_bucket: BUCKET,
                    storage_path,
                    event_date,
                  }],
                  { onConflict: "society_id,competition,season_id,storage_path" }
                );
                if (evRes?.error) {
                  console.error("events upsert failed", evRes.error);
                  toast("Events insert failed: " + evRes.error.message);
                }
              } else if (!ms) {
                console.warn("No event_date detected for this CSV; events table not updated.");
              } else if (!fileName) {
                console.warn("No file name available; events table not updated.");
              }
            } catch (e) {
              console.error("Failed to save event metadata to events table:", e);
            }

const rows = vals.map((r) => ({
              society_id: SOCIETY_ID,
              season_id: targetSeasonId,
              competition: COMPETITION,
              name: r.name, total_points: r.totalPoints, events: r.events,
              best_event_points: r.bestEventPoints, best_hole_points: r.bestHolePoints,
              eclectic_total: r.eclecticTotal, best_per_hole: r.bestPerHole,
            }));
            const res = await client.from(STANDINGS_TABLE).upsert(rows, { onConflict: "society_id,season_id,competition,name" });
if (res.error) toast("Error: " + res.error.message);
            else toast("Season updated ✓");
            
            // 3. REFRESH LIST
            await refreshShared(client);
          }
        }

        async function removeEventFromSeason() {
          const targetSeasonId = (leagueSeasonYear && String(leagueSeasonYear).toLowerCase() !== "all")
              ? String(leagueSeasonYear)
              : (seasonsDef.find((x) => x && x.is_active)?.season_id || "");
          if (!targetSeasonId) { toast("Select a season first"); return; }

          if (!computed.length) { toast("Load an event first"); return; }
          if (!window.confirm("Remove this event from the season standings?")) return;
          const next = { ...season };
          const oldSeason = season;
          for (const r of computed) {
            const prev = next[r.name];
            if (!prev) continue;
            const newTotal = prev.totalPoints - r.leaguePoints;
            const newEvents = Math.max(0, prev.events - 1);
            if (newTotal <= 0 && newEvents === 0) delete next[r.name];
            else next[r.name] = { ...prev, totalPoints: newTotal, events: newEvents };
          }
          setSeason(next);
          if (client) {
            const vals = Object.values(next).filter((r) => !isTeamLike(r.name));
            const targetSeasonId = (leagueSeasonYear && String(leagueSeasonYear).toLowerCase() !== "all")
              ? String(leagueSeasonYear)
              : (seasonsDef.find((x) => x && x.is_active)?.season_id || "");
            if (!targetSeasonId) { toast("Select a season first"); return; }
            const rows = vals.map((r) => ({
              society_id: SOCIETY_ID,
              season_id: targetSeasonId,
              competition: COMPETITION,
              name: r.name, total_points: r.totalPoints, events: r.events,
              best_event_points: r.bestEventPoints, best_hole_points: r.bestHolePoints,
              eclectic_total: r.eclecticTotal, best_per_hole: r.bestPerHole,
            }));
            const res = await client.from(STANDINGS_TABLE).upsert(rows, { onConflict: "society_id,season_id,competition,name" });
if (res.error) toast("Error: " + res.error.message);
            else toast("Event removed from season ✓");
          }
        }

        async function clearSeason() {
          if (!client) { toast("No client"); return; }
          if (!user) { alert("Please log in as admin first."); return; }

          const targetSeasonId = (leagueSeasonYear && String(leagueSeasonYear).toLowerCase() !== "all")
              ? String(leagueSeasonYear)
              : (seasonsDef.find((x) => x && x.is_active)?.season_id || "");

          if (!targetSeasonId) { toast("Select a season first"); return; }

          if (!window.confirm("⚠ This will delete ALL standings rows, event records, and CSV files for the selected season. Continue?")) return;

          // 1) Find all event files for this season (manifest table)
          const evList = await client
            .from("events")
            .select("storage_path, storage_bucket")
            .eq("society_id", SOCIETY_ID)
            .eq("competition", COMPETITION)
            .eq("season_id", targetSeasonId);

          if (evList?.error) {
            toast("Error loading events: " + evList.error.message);
            return;
          }

          const events = Array.isArray(evList?.data) ? evList.data : [];
          const paths = events
            .map((e) => String(e?.storage_path || "").trim())
            .filter(Boolean);

          // 2) Delete files from storage first (avoid orphaning DB if storage delete fails)
          if (paths.length > 0) {
            const bucket = String(events.find((e) => e?.storage_bucket)?.storage_bucket || BUCKET || "").trim() || BUCKET;
            const rm = await client.storage.from(bucket).remove(paths);
            if (rm?.error) {
              toast("Storage delete failed: " + rm.error.message);
              return;
            }
          }

          // 3) Delete event records for this season
          if (events.length > 0) {
            const delEv = await client
              .from("events")
              .delete()
              .eq("society_id", SOCIETY_ID)
              .eq("competition", COMPETITION)
              .eq("season_id", targetSeasonId);

            if (delEv?.error) {
              toast("Error deleting event records: " + delEv.error.message);
              return;
            }
          }

          // 4) Delete standings rows for this season
          const res = await client
            .from(STANDINGS_TABLE)
            .delete()
            .eq("competition", COMPETITION)
            .eq("society_id", SOCIETY_ID)
            .eq("season_id", targetSeasonId)
            .neq("name", "");

          if (res.error) {
            toast("Error: " + res.error.message);
            return;
          }

          setSeason({});
          toast(`Season cleared (${paths.length} file${paths.length === 1 ? "" : "s"} removed)`);

          // Refresh dropdown + table
          await fetchSeasons(client);
          await fetchSeason(client);
          await refreshShared(client);
        }


        
        // Admin roster source-of-truth:
        // Use the League leaderboard (season standings) FIRST, then add any names discovered from scanned rounds / loaded event.
        // This means the Admin filter always has a player list even before scanning/importing games.
        const adminPlayerRoster = React.useMemo(() => {
          const map = new Map(); // key -> display name
          const pushName = (nm) => {
            const name = String(nm || "").trim();
            if (!name) return;
            try { if (typeof isTeamLike === "function" && isTeamLike(name)) return; } catch {}
            const key = normalizeName(name);
            if (!key) return;
            if (!map.has(key)) map.set(key, name);
          };

          try { Object.values(season || {}).forEach(r => pushName(r?.name)); } catch {}
          try { (seasonModelAll?.players || []).forEach(p => pushName(p?.name)); } catch {}
          try { (computed || []).forEach(r => pushName(r?.name)); } catch {}

          const names = Array.from(map.values()).sort((a,b)=>a.localeCompare(b));
          return names.map(name => ({ name }));
        }, [season, seasonModelAll, computed]);

        // Apply admin player visibility filter to League standings + all derived views
        const seasonFiltered = React.useMemo(() => {
          try {
            if (!hiddenKeySet || hiddenKeySet.size === 0) return season;
            const out = {};
            Object.entries(season || {}).forEach(([k, v]) => {
              const name = (v && v.name) ? String(v.name) : String(k || "");
              const key = normalizeName(name);
              if (key && hiddenKeySet.has(key)) return;
              out[k] = v;
            });
            return out;
          } catch (e) { return season; }
        }, [season, hiddenKeySet]);

        const computedFiltered = React.useMemo(() => {
          try {
            if (!hiddenKeySet || hiddenKeySet.size === 0) return computed;
            return (computed || []).filter(r => {
              const name = (r && r.name) ? String(r.name) : "";
              const key = normalizeName(name);
              return !(key && hiddenKeySet.has(key));
            });
          } catch (e) { return computed; }
        }, [computed, hiddenKeySet]);

        const playersFiltered = React.useMemo(() => {
          try {
            if (!hiddenKeySet || hiddenKeySet.size === 0) return players;
            return (players || []).filter(p => {
              const name = (p && p.name) ? String(p.name) : "";
              const key = normalizeName(name);
              return !(key && hiddenKeySet.has(key));
            });
          } catch (e) { return players; }
        }, [players, hiddenKeySet]);

        // Global "super admin" (optional). This is separate from per-society memberships.
        // If the signed-in user's email is in SUPER_ADMIN_EMAILS, they get full capabilities in the UI.
        const isSuperAdmin = React.useMemo(() => {
          const email = (user?.email || "").toLowerCase();
          if (!email) return false;
          return (SUPER_ADMIN_EMAILS || []).map((e) => String(e).toLowerCase()).includes(email);
        }, [user?.email]);

	return (
          <div className="min-h-screen p-4 sm:p-6 bg-neutral-50">
            <div className="app-shell space-y-4 pt-1">
              <Header leagueHeaderTitle={LEAGUE_HEADER_TITLE} eventName={eventName} statusMsg={statusMsg} courseName={courseName} view={view} setView={setView} />
              <LoginModal open={loginOpen} busy={loginBusy} onClose={() => setLoginOpen(false)} onSubmit={handleLogin} />
              <AdminPasswordModal open={adminPwOpen} onClose={() => setAdminPwOpen(false)} onSubmit={handleAdminPassword} />
              <PlayerVisibilitySheet open={playersAdminOpen} onClose={() => setPlayersAdminOpen(false)} isAdmin={!!user} players={adminPlayerRoster} hiddenKeys={hiddenPlayerKeys} onSave={savePlayerVisibility} />
              <BottomStatusBar statusMsg={statusMsg} courseName={courseName} />
              <button
                className="fixed right-3 bottom-3 z-[9999] w-11 h-11 rounded-full bg-neutral-900 text-white flex items-center justify-center shadow-xl border border-white/10 hover:-translate-y-[1px] transition"
                onClick={() => setView("guide")}
                title="Guide"
                aria-label="Guide"
              >
                🧭
              </button>
{view === "home" && (
                <Home runSeasonAnalysis={loadAllGamesAndBuildPlayerModel} setView={setView} fileInputRef={fileInputRef} importLocalCSV={importLocalCSV} computed={computedFiltered} addEventToSeason={addEventToSeason} removeEventFromSeason={removeEventFromSeason} clearSeason={clearSeason} user={user} activeRole={ACTIVE.role} isSuperAdmin={isSuperAdmin} handleLogin={handleLogin} handleLogout={handleLogout}
            handleSwitchSociety={handleSwitchSociety} openPlayersAdmin={requestPlayersAdmin} visiblePlayersCount={(seasonModel?.players||[]).length} totalPlayersCount={(adminPlayerRoster||[]).length} />
              )}


{view === "admin" && (
  <AdminView
    setView={setView}
    fileInputRef={fileInputRef}
    importLocalCSV={importLocalCSV}
    computed={computedFiltered}
    addEventToSeason={addEventToSeason}
    removeEventFromSeason={removeEventFromSeason}
    clearSeason={clearSeason}
    seasonsDef={seasonsDef}
    leagueSeasonYear={leagueSeasonYear}
    setLeagueSeasonYear={setLeagueSeasonYear}
    activeSocietyId={String(ACTIVE?.id || "")}
    activeSocietySlug={String(ACTIVE?.slug || "")}
    user={user}
    activeRole={ACTIVE.role}
    isSuperAdmin={isSuperAdmin}
    handleLogin={handleLogin}
    handleLogout={handleLogout}
            handleSwitchSociety={handleSwitchSociety}
    openPlayersAdmin={requestPlayersAdmin}
    visiblePlayersCount={(seasonModel?.players||[]).length}
    totalPlayersCount={(adminPlayerRoster||[]).length}
  />
)}
{view === "player_progress" && (
  <PlayerProgressView
    seasonModel={seasonModel}
                  seasonFiles={seasonFiles}
    reportNextHcapMode={reportNextHcapMode}
    setReportNextHcapMode={setReportNextHcapMode}
    seasonPlayer={seasonPlayer}
    setSeasonPlayer={setSeasonPlayer}
    seasonYear={seasonYear}
    setSeasonYear={setSeasonYear}
    seasonLimit={seasonLimit}
    setSeasonLimit={setSeasonLimit}
    seasonYears={seasonYears}
    seasonLoading={seasonLoading}
    seasonProgress={seasonProgress}
    seasonError={seasonError}
    runSeasonAnalysis={loadAllGamesAndBuildPlayerModel}
    setView={setView}
    scoringMode={scoringMode}
    setScoringMode={setScoringMode}
    grossCompare={grossCompare}
    setGrossCompare={setGrossCompare}
  />
)}
{view === "past" && <PastEvents sharedGroups={sharedGroups} loadShared={loadShared} setView={setView} />}
              {view === "event" && <EventScreen computed={computedFiltered} setView={setView} courseSlope={courseSlope} setCourseSlope={setCourseSlope} courseRating={courseRating} setCourseRating={setCourseRating} startHcapMode={startHcapMode} setStartHcapMode={setStartHcapMode} nextHcapMode={nextHcapMode} setNextHcapMode={setNextHcapMode} oddsMaxRounds={oddsMaxRounds} setOddsMaxRounds={setOddsMaxRounds} seasonRoundsFiltered={seasonRoundsFiltered} seasonRoundsAll={seasonRoundsAllForOdds} seasonModelAll={seasonModelOddsAll} oddsExcludeMap={oddsExcludeMap} oddsExcludedNames={oddsExcludedNames} setExcludeFromOdds={setExcludeFromOdds} />}
              {view === "banter" && <BanterStats computed={computedFiltered} setView={setView} />}
              {view === "guide" && <GuideView setView={setView} leagueTitle={LEAGUE_TITLE} />}
              {view === "mirror_read" && <MirrorReadView setView={setView} />}

{view === "ratings" && <Ratings computed={computedFiltered} courseTees={courseTees} setView={setView} />}
              {view === "standings" && (
  <Standings season={seasonFiltered} setView={setView} seasonsDef={seasonsDef} seasonYear={leagueSeasonYear} setSeasonYear={setLeagueSeasonYear} />
)}
              {view === "eclectic" && (
  <Eclectic season={seasonFiltered} setView={setView} seasonsDef={seasonsDef} seasonYear={leagueSeasonYear} setSeasonYear={setLeagueSeasonYear} />
)}
              {view === "graphs" && <Graphs computed={computedFiltered} courseTees={courseTees} setView={setView} />}

              {view === "scorecard" && <PlayerScorecardView computed={computedFiltered} courseTees={courseTees} setView={setView} />}
              {view === "course_stats" && <CourseStats computed={computedFiltered} courseTees={courseTees} setView={setView} />}
              {view === "headtohead" && <HeadToHead computed={computedFiltered} setView={setView} courseTees={courseTees} />}
              {view === "style" && <StyleAnalysis computed={computedFiltered} setView={setView} />}
              {view === "story" && <StoryOfTheRound computed={computedFiltered} setView={setView} />}
              {view === "replay" && <ReplayRoom computed={computedFiltered} setView={setView} />}
                          {view === "team_replay" && <TeamReplayRoom computed={computedFiltered} courseTees={courseTees} courseSlope={courseSlope} courseRating={courseRating} startHcapMode={startHcapMode} setView={setView} />}
{view === "casino" && <TheCasino computed={computedFiltered} courseTees={courseTees} setView={setView} />}
              {view === "trophies" && <TrophyRoom computed={computedFiltered} courseTees={courseTees} setView={setView} />}
              {view === "partner" && <PartnerPicker computed={computedFiltered} setView={setView} />}
            </div>
          </div>
        );
      }

// =========================
// ADDED BLOCK: Casino / Teams / Trophies / Story / Replay utilities
// Source: PlayerReport_STORYDECK_v9_GROSS_PAR_FROM_OLD
// =========================

function CourseStats({ computed, courseTees, setView }) {
  const holes = React.useMemo(() => detectEventHoleCount(computed), [computed]);
          if (!computed.length) {
            return (
              <section className="content-card p-4 md:p-6">
                <Breadcrumbs items={[{ label: "Game", onClick: () => setView("event"), title: "Round Leaderboard" }, { label: "Course Stats" }]} />
<EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
                <p className="text-neutral-600">Load an event to see course stats.</p>
              </section>
            );
          }

          // 1. Calculate Average Points per Hole
          const stats = Array.from({ length: holes }).map((_, i) => ({
            hole: i + 1,
            totalPts: 0,
            count: 0,
            zeros: 0, // How many people wiped the hole
            threesPlus: 0, // How many got 3+ points
          }));

          computed.forEach((p) => {
            (p.perHole || []).slice(0, holes).forEach((pt, i) => {
              const val = Number(pt) || 0;
              stats[i].totalPts += val;
              stats[i].count++;
              if (val === 0) stats[i].zeros++;
              if (val >= 3) stats[i].threesPlus++;
            });
          });

          // 2. Attach Course Data (Par/SI) - Use first available tee or "Men"
          const refTee =
            courseTees.find((t) => t.gender === "M") || courseTees[0] || {};
          const pars = refTee.pars || Array(18).fill(0);
          const sis = refTee.si || Array(18).fill(0);

          const finalStats = stats.map((s, i) => {
            const avg = s.count ? s.totalPts / s.count : 0;
            return {
              ...s,
              par: pars[i],
              si: sis[i],
              avg,
            };
          });

          // 3. Determine "Played Rank" (1 = Hardest = Lowest Avg Points)
          const sortedByDifficulty = [...finalStats].sort((a, b) => a.avg - b.avg);
          
          const difficultyRankMap = {};
          sortedByDifficulty.forEach((s, idx) => {
            difficultyRankMap[s.hole] = idx + 1; // 1 is hardest
          });

          // Merge rank back in
          const tableData = finalStats.map((s) => ({
            ...s,
            playedRank: difficultyRankMap[s.hole],
            diff: (difficultyRankMap[s.hole] - s.si), // Negative means played harder than SI
          }));

          // Heatmap color for average
          const getAvgColor = (avg) => {
            if (avg >= 2.2) return "bg-emerald-100 text-emerald-800"; // Easy
            if (avg >= 1.8) return "bg-neutral-50 text-neutral-800"; // Normal
            if (avg >= 1.4) return "bg-orange-50 text-orange-800"; // Hard
            return "bg-red-50 text-red-800 font-bold"; // Very Hard
          };

          return (
            <section className="content-card p-4 md:p-6">
              <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />

              <h2 className="text-lg font-semibold text-squab-900 mb-1">
                Course Difficulty Analysis
              </h2>
              <p className="text-xs text-neutral-500 mb-4">
                Comparing scorecard Stroke Index (SI) vs actual field performance.
              </p>

              {/* HIGHLIGHTS */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <div className="p-3 border border-red-200 bg-red-50 rounded-2xl">
                  <div className="text-[10px] uppercase tracking-wide text-red-700 font-bold">Hardest Hole</div>
                  <div className="text-xl font-bold text-red-900 mt-1">
                    Hole {sortedByDifficulty[0].hole}
                  </div>
                  <div className="text-xs text-red-800">
                    Avg: {sortedByDifficulty[0].avg.toFixed(2)} pts
                  </div>
                </div>

                <div className="p-3 border border-emerald-200 bg-emerald-50 rounded-2xl">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-bold">Easiest Hole</div>
                  <div className="text-xl font-bold text-emerald-900 mt-1">
                    Hole {sortedByDifficulty[sortedByDifficulty.length - 1].hole}
                  </div>
                  <div className="text-xs text-emerald-800">
                      Avg: {sortedByDifficulty[sortedByDifficulty.length - 1].avg.toFixed(2)} pts
                  </div>
                </div>
                
                <div className="p-3 border border-squab-200 bg-white rounded-2xl">
                   <div className="text-[10px] uppercase tracking-wide text-neutral-600 font-bold">Most Wipes</div>
                   <div className="text-lg font-bold text-neutral-900 mt-1">
                     Hole {tableData.sort((a,b) => b.zeros - a.zeros)[0].hole}
                   </div>
                   <div className="text-xs text-neutral-500">
                     {tableData.sort((a,b) => b.zeros - a.zeros)[0].zeros} players
                   </div>
                </div>

                  <div className="p-3 border border-squab-200 bg-white rounded-2xl">
                   <div className="text-[10px] uppercase tracking-wide text-neutral-600 font-bold">Most 3+ Pts</div>
                   <div className="text-lg font-bold text-neutral-900 mt-1">
                     Hole {tableData.sort((a,b) => b.threesPlus - a.threesPlus)[0].hole}
                   </div>
                   <div className="text-xs text-neutral-500">
                     {tableData.sort((a,b) => b.threesPlus - a.threesPlus)[0].threesPlus} players
                   </div>
                </div>
              </div>

              <div className="overflow-auto table-wrap">
                <table className="min-w-full text-xs md:text-sm text-center">
                  <thead>
                    <tr className="border-b border-squab-200 bg-squab-50 text-neutral-700">
                      <th className="py-2 px-2 text-left">Hole</th>
                      <th className="py-2 px-2">Par</th>
                      <th className="py-2 px-2">Card SI</th>
                      <th className="py-2 px-2 bg-neutral-100 border-l border-neutral-200">Field Avg Pts</th>
                      <th className="py-2 px-2 bg-neutral-100 border-r border-neutral-200">Played Rank</th>
                      <th className="py-2 px-2">Diff</th>
                      <th className="py-2 px-2 text-red-600">Wipes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...tableData].sort((a,b)=>((Number(a.playedRank)||999)-(Number(b.playedRank)||999))).map((row) => (
                      <tr key={row.hole} className="border-b border-squab-100 hover:bg-squab-50">
                        <td className="py-2 px-2 text-left font-bold">{row.hole}</td>
                        <td className="py-2 px-2">{row.par || "-"}</td>
                        <td className="py-2 px-2">{row.si || "-"}</td>
                        <td className={`py-2 px-2 font-mono font-medium border-l border-neutral-200 ${getAvgColor(row.avg)}`}>
                          {row.avg.toFixed(2)}
                        </td>
                        <td className="py-2 px-2 font-bold bg-neutral-50 border-r border-neutral-200">
                          {row.playedRank}
                        </td>
                        <td className="py-2 px-2 text-xs text-neutral-500">
                          {Math.abs(row.diff) >= 4 ? (
                              <span className={row.diff < 0 ? "text-red-600 font-bold" : "text-emerald-600 font-bold"}>
                                {row.diff < 0 ? "Harder" : "Easier"}
                              </span>
                          ) : (
                            <span className="text-neutral-300">—</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-neutral-400">
                          {row.zeros > 0 ? <span className="text-neutral-800">{row.zeros}</span> : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        }

function HeadToHead({ computed, setView, courseTees }) {
          const [playerA, setPlayerA] = useState("");
          const [playerB, setPlayerB] = useState("");

          useEffect(() => {
            if (computed.length >= 2 && !playerA && !playerB) {
              setPlayerA(computed[0].name);
              setPlayerB(computed[1]?.name || computed[0].name); 
            }
          }, [computed, playerA, playerB]);

          if (computed.length < 2 || !playerA || !playerB) {
            return (
              <section className="rounded-2xl p-4 bg-white border border-squab-200 shadow-sm">
                <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
                <p className="text-neutral-600">Need at least 2 distinct players loaded.</p>
              </section>
            );
          }

          const pA = computed.find((p) => p.name === playerA) || computed[0];
          const pB = computed.find((p) => p.name === playerB) || computed[1];

          const ptsA = (pA.perHole || []).map((x) => Number(x) || 0);
          const ptsB = (pB.perHole || []).map((x) => Number(x) || 0);

          // --- COURSE DATA & PAR 3 FIX ---
          const teeA = chooseTeeForPlayer(pA, courseTees);
          const teeB = chooseTeeForPlayer(pB, courseTees);
          const parsA = teeA?.pars || Array(18).fill(0);
          const parsB = teeB?.pars || Array(18).fill(0);

          const sumPar3Points = (pointsArray, parsArray) => {
            return pointsArray.reduce((sum, pts, i) => {
                return parsArray[i] === 3 ? sum + (pts || 0) : sum;
            }, 0);
          }
          
          const par3A = sumPar3Points(ptsA, parsA);
          const par3B = sumPar3Points(ptsB, parsB);

          // --- STATS CALC ---
          const sum = (arr) => arr.reduce((a, b) => a + b, 0);
          const totalA = sum(ptsA);
          const totalB = sum(ptsB);
          
          const frontA = sum(ptsA.slice(0, 9));
          const frontB = sum(ptsB.slice(0, 9));
          const backA = sum(ptsA.slice(9));
          const backB = sum(ptsB.slice(9));

          let holesWonA = 0, holesWonB = 0, holesHalved = 0, currentDiff = 0;
          const cumulativeDiff = [];

          ptsA.forEach((a, i) => {
            const b = ptsB[i];
            
            // Count holes won/halved for the scoreboard
            if (a > b) holesWonA++;
            else if (b > a) holesWonB++;
            else holesHalved++;

            // MATCHPLAY LOGIC:
            // If A wins, add 1. If B wins, subtract 1. If tie, add 0.
            const holeResult = (a > b) ? 1 : (b > a ? -1 : 0);
            
            currentDiff += holeResult;
            cumulativeDiff.push(currentDiff);
          });

          const diff = totalA - totalB;
          const winner = diff > 0 ? pA.name : diff < 0 ? pB.name : "Draw";
          const winColor = diff > 0 ? "text-emerald-600" : diff < 0 ? "text-blue-600" : "text-neutral-600";

          // Chart
          const height = 150; // Made shorter
          const width = 600;
          const margin = { top: 15, bottom: 25, left: 30, right: 15 };
          const maxLead = Math.max(...cumulativeDiff.map(Math.abs), 5);
          const chartY = (val) => {
            const pct = (val + maxLead) / (maxLead * 2);
            return height - margin.bottom - (pct * (height - margin.top - margin.bottom));
          }
          const chartX = (i) => margin.left + (i * ((width - margin.left - margin.right) / 17));
          const linePoints = cumulativeDiff.map((d, i) => `${chartX(i)},${chartY(d)}`).join(" ");
          const zeroLineY = chartY(0);

          return (
            <section className="rounded-2xl p-4 bg-white border border-squab-200 shadow-sm">
              <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />

              {/* COMPACT HEADER */}
              <div className="flex flex-wrap items-end justify-between gap-4 mb-4 border-b border-squab-100 pb-4">
                <div className="flex-1 min-w-[200px]">
                      <label className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block mb-1">Player A</label>
                      <div className="flex items-center gap-2">
                          <select 
                             className="w-full p-2 rounded-lg border border-squab-200 bg-white text-sm font-semibold focus:ring-2 focus:ring-emerald-500 outline-none"
                            value={playerA} 
                            onChange={e => setPlayerA(e.target.value)}
                          >
                             {computed.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                          </select>
                          <div className="text-xl font-bold text-emerald-700 w-12 text-center">{totalA}</div>
                      </div>
                </div>

                <div className="hidden md:flex flex-col items-center px-2 pb-2">
                      <span className="text-xs font-bold text-neutral-300">VS</span>
                      <span className={`text-sm font-bold ${winColor} whitespace-nowrap`}>
                          {diff === 0 ? "TIED" : `${winner} +${Math.abs(diff)}`}
                      </span>
                </div>

                <div className="flex-1 min-w-[200px]">
                      <label className="text-[10px] font-bold text-blue-600 uppercase tracking-wider block mb-1 text-right md:text-left">Player B</label>
                      <div className="flex items-center gap-2 flex-row-reverse md:flex-row">
                          <select 
                             className="w-full p-2 rounded-lg border border-squab-200 bg-white text-sm font-semibold focus:ring-2 focus:ring-blue-500 outline-none"
                            value={playerB} 
                            onChange={e => setPlayerB(e.target.value)}
                          >
                             {computed.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                          </select>
                          <div className="text-xl font-bold text-blue-700 w-12 text-center">{totalB}</div>
                      </div>
                </div>
              </div>
              
              {/* Mobile Result Text */}
              <div className="md:hidden text-center mb-4 -mt-2">
                 <span className={`text-sm font-bold ${winColor}`}>
                    {diff === 0 ? "TIED" : `${winner} +${Math.abs(diff)}`}
                 </span>
              </div>

              {/* GRAPH - Shorter now */}
              <div className="mb-6 relative h-[150px] w-full bg-squab-50/50 rounded-2xl border border-squab-100">
                 <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full block">
                     <line x1={margin.left} y1={zeroLineY} x2={width-margin.right} y2={zeroLineY} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="4 4" />
                     <polyline points={linePoints} fill="none" stroke="#4b5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                     {cumulativeDiff.map((d, i) => (
                         <circle key={i} cx={chartX(i)} cy={chartY(d)} r="3" className={d > 0 ? "fill-emerald-500" : d < 0 ? "fill-blue-500" : "fill-neutral-400"} stroke="white" strokeWidth="1.5" />
                     ))}
                     <text x={margin.left} y={height-5} className="text-[9px] fill-neutral-400" textAnchor="middle">1</text>
                     <text x={width/2} y={height-5} className="text-[9px] fill-neutral-400" textAnchor="middle">9</text>
                     <text x={width-margin.right} y={height-5} className="text-[9px] fill-neutral-400" textAnchor="middle">18</text>
                 </svg>
                 <div className="absolute top-1 left-2 text-[9px] font-bold text-emerald-600/50 pointer-events-none">A Leads</div>
                 <div className="absolute bottom-6 left-2 text-[9px] font-bold text-blue-600/50 pointer-events-none">B Leads</div>
              </div>

              {/* STATS GRID */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="bg-neutral-50 rounded-2xl p-3 border border-neutral-100">
                     <div className="flex justify-between items-center text-xs mb-2 font-semibold text-neutral-500">
                       <span>Match Play</span>
                       <span>{holesHalved} halved</span>
                     </div>
                     <div className="w-full bg-white h-2.5 rounded-full overflow-hidden flex shadow-sm">
                        <div style={{ width: `${(holesWonA/18)*100}%` }} className="bg-emerald-400"></div>
                        <div style={{ width: `${(holesHalved/18)*100}%` }} className="bg-neutral-200"></div>
                        <div style={{ width: `${(holesWonB/18)*100}%` }} className="bg-blue-400"></div>
                     </div>
                     <div className="flex justify-between text-[10px] mt-1 font-medium">
                        <span className="text-emerald-700">{holesWonA} won</span>
                        <span className="text-blue-700">{holesWonB} won</span>
                     </div>
                 </div>

                 <div className="bg-white rounded-2xl border border-neutral-100 overflow-hidden">
                     <table className="w-full text-xs">
                       <thead>
                          <tr className="bg-neutral-50 border-b border-neutral-100 text-neutral-500 uppercase">
                              <th className="py-1.5 w-1/3 text-center text-emerald-700">{pA.name.split(' ')[0]}</th>
                              <th className="py-1.5 w-1/3 text-center">Sector</th>
                              <th className="py-1.5 w-1/3 text-center text-blue-700">{pB.name.split(' ')[0]}</th>
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-neutral-50">
                          {[
                              { l: "Front 9", a: frontA, b: frontB },
                              { l: "Back 9", a: backA, b: backB },
                              { l: "Par 3s", a: par3A, b: par3B },
                           ].map((row, i) => (
                             <tr key={i}>
                                 <td className={`py-1.5 text-center font-bold ${row.a > row.b ? 'text-emerald-600 bg-emerald-50/30' : 'text-neutral-600'}`}>{row.a}</td>
                                 <td className="py-1.5 text-center text-neutral-400 font-medium">{row.l}</td>
                                 <td className={`py-1.5 text-center font-bold ${row.b > row.a ? 'text-blue-600 bg-blue-50/30' : 'text-neutral-600'}`}>{row.b}</td>
                             </tr>
                           ))}
                       </tbody>
                     </table>
                 </div>
              </div>
            </section>
          );
        }

function StyleAnalysis({ computed, setView }) {
          if (!computed.length) {
            return (
              <section className="rounded-2xl p-4 bg-white border border-squab-200 shadow-sm">
                <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
                <p className="text-neutral-600">Load an event to see style analysis.</p>
              </section>
            );
          }

          const holes = useMemo(() => detectEventHoleCount(computed), [computed]);

          // Calculate coordinates for every player
          const data = computed.map((p) => {
            const pts = (Array.isArray(p.perHole) ? p.perHole : []).slice(0, holes).map((x) => _safeNum(x, NaN));
            const wipes = pts.filter((x) => Number.isFinite(x) && x === 0).length; // Chaos
            const fireworks = pts.filter((x) => Number.isFinite(x) && x >= 3).length; // Fireworks (Net Birdie+)
            return { name: p.name, wipes, fireworks, total: p.points };
          });

          // Chart Dimensions
          const height = 400;
          const width = 600;
          const margin = { top: 40, right: 40, bottom: 50, left: 50 };
          const graphW = width - margin.left - margin.right;
          const graphH = height - margin.top - margin.bottom;

          // Scales (Dynamic based on field, with some padding)
          const maxWipes = Math.max(...data.map((d) => d.wipes), 5) + 1;
          const maxFire = Math.max(...data.map((d) => d.fireworks), 4) + 1;

          const getX = (w) => (w / maxWipes) * graphW;
          const getY = (f) => graphH - (f / maxFire) * graphH;

          // Archetype Labels positions
          const midX = graphW / 2;
          const midY = graphH / 2;

          return (
            <section className="content-card p-4 md:p-6">
              <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />

              <div className="mb-6">
                <h2 className="text-xl font-bold text-squab-900">Play Style Matrix</h2>
                <p className="text-sm text-neutral-500">
                  Mapping players by Aggression (3+ pts) vs. Errors (0 pts).
                </p>
              </div>

              <div className="w-full overflow-x-auto">
                <div className="min-w-[600px] relative">
                  <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto bg-neutral-50 rounded-2xl border border-neutral-100">
                    {/* Grid Lines */}
                    {Array.from({ length: maxWipes + 1 }).map((_, i) => (
                      <line
                        key={`x-${i}`}
                        x1={margin.left + getX(i)}
                        y1={margin.top}
                        x2={margin.left + getX(i)}
                        y2={height - margin.bottom}
                        stroke="#e5e5e5"
                        strokeWidth="1"
                      />
                    ))}
                    {Array.from({ length: maxFire + 1 }).map((_, i) => (
                      <line
                        key={`y-${i}`}
                        x1={margin.left}
                        y1={margin.top + getY(i)}
                        x2={width - margin.right}
                        y2={margin.top + getY(i)}
                        stroke="#e5e5e5"
                        strokeWidth="1"
                      />
                    ))}

                    {/* Quadrant Background Labels */}
                    <text x={margin.left + graphW * 0.15} y={margin.top + graphH * 0.15} className="text-sm font-bold fill-emerald-100 uppercase tracking-widest select-none">The Gunslinger</text>
                    <text x={margin.left + graphW * 0.85} y={margin.top + graphH * 0.15} className="text-sm font-bold fill-red-100 uppercase tracking-widest text-right select-none" textAnchor="end">The Tourist</text>
                    <text x={margin.left + graphW * 0.15} y={margin.top + graphH * 0.9} className="text-sm font-bold fill-emerald-100 uppercase tracking-widest select-none">The Shark</text>
                    <text x={margin.left + graphW * 0.85} y={margin.top + graphH * 0.9} className="text-sm font-bold fill-neutral-200 uppercase tracking-widest text-right select-none" textAnchor="end">The Grinder</text>

                    {/* Axes Labels */}
                    <text
                      x={width / 2}
                      y={height - 10}
                      textAnchor="middle"
                      className="text-xs font-bold fill-neutral-500 uppercase tracking-widest"
                    >
                      Chaos Factor (Wipes / 0 pts) →
                    </text>
                    <text
                      transform={`rotate(-90 ${15} ${height / 2})`}
                      x={15}
                      y={height / 2}
                      textAnchor="middle"
                      className="text-xs font-bold fill-neutral-500 uppercase tracking-widest"
                    >
                      Fireworks (3+ pts holes) →
                    </text>

                    {/* Data Points */}
                    <g transform={`translate(${margin.left}, ${margin.top})`}>
                      {data.map((p) => {
                        const cx = getX(p.wipes);
                        const cy = getY(p.fireworks);
                        
                        const isHighFire = p.fireworks >= maxFire / 2;
                        const isHighWipe = p.wipes >= maxWipes / 2;
                        
                        let fill = "#a3a3a3"; // default
                        if (!isHighWipe && isHighFire) fill = "#10b981"; // Shark (Emerald)
                        if (isHighWipe && isHighFire) fill = "#a855f7"; // Gunslinger (Purple)
                        if (!isHighWipe && !isHighFire) fill = "#3b82f6"; // Grinder (Blue)
                        if (isHighWipe && !isHighFire) fill = "#f97316"; // Tourist (Orange)

                        return (
                          <g key={p.name} className="group cursor-pointer">
                            <circle
                              cx={cx}
                              cy={cy}
                              r={6}
                              fill={fill}
                              stroke="white"
                              strokeWidth="2"
                              className="transition-all duration-300 group-hover:r-8"
                            />
                            <text
                              x={cx}
                              y={cy - 10}
                              textAnchor="middle"
                              className="text-[10px] font-bold fill-neutral-700 opacity-0 group-hover:opacity-100 transition-opacity bg-white"
                              style={{ textShadow: "0px 0px 4px white" }}
                            >
                              {p.name} ({p.total}pts)
                            </text>
                             { (p.fireworks === Math.max(...data.map(d=>d.fireworks)) || p.wipes === Math.max(...data.map(d=>d.wipes))) && (
                               <text x={cx} y={cy+15} textAnchor="middle" className="text-[9px] fill-neutral-400 font-medium pointer-events-none">{p.name.split(' ')[0]}</text>
                             )}
                          </g>
                        );
                      })}
                    </g>
                  </svg>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                  <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-100">
                      <div className="text-xs font-bold text-emerald-800 uppercase">The Shark</div>
                      <div className="text-[10px] text-emerald-600">High Fireworks, Low Wipes. The zone you want to be in.</div>
                  </div>
                  <div className="p-3 bg-purple-50 rounded-2xl border border-purple-100">
                      <div className="text-xs font-bold text-purple-800 uppercase">The Gunslinger</div>
                      <div className="text-[10px] text-purple-600">High Fireworks, High Wipes. Volatile, exciting, dangerous.</div>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-2xl border border-blue-100">
                      <div className="text-xs font-bold text-blue-800 uppercase">The Grinder</div>
                      <div className="text-[10px] text-blue-600">Low Fireworks, Low Wipes. Boring golf, often places in the money.</div>
                  </div>
                  <div className="p-3 bg-orange-50 rounded-2xl border border-orange-100">
                      <div className="text-xs font-bold text-orange-800 uppercase">The Tourist</div>
                      <div className="text-[10px] text-orange-600">Low Fireworks, High Wipes. Just here for the banter.</div>
                  </div>
              </div>
            </section>
          );
        }

function StoryOfTheRound({ computed, setView }) {
          if (!computed.length) {
            return (
              <section className="rounded-2xl p-4 bg-white border border-squab-200 shadow-sm">
                <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
                <p className="text-neutral-600">Load an event to see the story.</p>
              </section>
            );
          }

          const holes = useMemo(() => detectEventHoleCount(computed), [computed]);

          // --- 1. PERFECT ROUND CALCULATION ---
          const perfectRound = Array.from({ length: holes }).map((_, i) => {
            let bestPts = -1;
            let contributors = [];
            
            computed.forEach(p => {
              const pt = _safeNum(p.perHole[i], NaN);
              if (!Number.isFinite(pt)) return;
              if (pt > bestPts) {
                bestPts = pt;
                contributors = [p.name.split(' ')[0]]; // First name only
              } else if (pt === bestPts) {
                contributors.push(p.name.split(' ')[0]);
              }
            });
            return { hole: i + 1, bestPts, contributors };
          });

          const perfectTotal = perfectRound.reduce((a, b) => a + b.bestPts, 0);

          // --- 2. RACE CHART DATA (Top 5 Players) ---
          const top5 = computed.slice(0, 5); // Take top 5 finishers
          const raceData = top5.map((p, idx) => {
            let running = 0;
            const points = (Array.isArray(p.perHole) ? p.perHole : []).slice(0, holes).map(h => {
              running += (_safeNum(h, 0) || 0);
              return running;
            });
            // Assign distinct colors
            const colors = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899"];
            return { name: p.name, points, color: colors[idx % colors.length] };
          });

          // Chart Dimensions
          const height = 300;
          const width = 800;
          const margin = { top: 20, right: 80, bottom: 30, left: 30 };
          const graphW = width - margin.left - margin.right;
          const graphH = height - margin.top - margin.bottom;

          // Scales
          const maxTotalRaw = Math.max(...raceData.map(d => (d.points[holes - 1] ?? 0)));
          const maxTotal = Math.max(1, maxTotalRaw);
          const denom = Math.max(1, holes - 1);
          const getX = (holeIdx) => (holeIdx / denom) * graphW; // 0 to holes-1
          const getY = (pts) => graphH - (pts / maxTotal) * graphH;

          return (
            <section className="rounded-2xl p-4 md:p-6 bg-white border border-squab-200 shadow-sm space-y-8">
              <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />

              {/* SECTION 1: THE RACE CHART */}
              <div>
                <h2 className="text-xl font-bold text-squab-900 mb-1">The Race for the Title</h2>
                <p className="text-sm text-neutral-500 mb-4">Cumulative progress of the Top 5 finishers. See where the lead changed.</p>
                
                <div className="w-full overflow-x-auto">
                  <div className="min-w-[600px] relative">
                    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto bg-white rounded-2xl border border-squab-100">
                      {/* Grid Lines Y */}
                      {[0, 0.25, 0.5, 0.75, 1].map(pct => {
                        const val = Math.round(maxTotal * pct);
                        const y = getY(val) + margin.top;
                        return (
                          <g key={pct}>
                            <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke="#f3f4f6" />
                            <text x={margin.left - 5} y={y + 3} textAnchor="end" className="text-[10px] fill-neutral-400">{val}</text>
                          </g>
                        );
                      })}
                      
                      {/* X Axis Labels */}
                      {Array.from({length: holes}).map((_, i) => (
                        <text key={i} x={margin.left + getX(i)} y={height - 10} textAnchor="middle" className="text-[10px] fill-neutral-400">{i+1}</text>
                      ))}

                      {/* Lines */}
                      {raceData.map((player, i) => {
                        const pathD = player.points.map((pt, idx) => 
                          `${idx === 0 ? 'M' : 'L'} ${margin.left + getX(idx)} ${margin.top + getY(pt)}`
                        ).join(" ");

                        return (
                          <g key={player.name}>
                            <path d={pathD} fill="none" stroke={player.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="opacity-90 hover:opacity-100 hover:stroke-[4]" />
                            {/* End Label */}
                            <text 
                              x={margin.left + getX(holes - 1) + 5} 
                              y={margin.top + getY(player.points[holes - 1] ?? 0) + 3} 
                              className="text-[10px] font-bold" 
                              fill={player.color}
                            >
                              {player.name.split(' ')[0]}
                            </text>
                          </g>
                        )
                      })}
                    </svg>
                  </div>
                </div>
              </div>

              <div className="border-t border-squab-100"></div>

              {/* SECTION 2: THE PERFECT ROUND */}
              <div>
                <div className="flex justify-between items-end mb-4">
                    <div>
                      <h2 className="text-xl font-bold text-squab-900 mb-1">The "Perfect" Round</h2>
                      <p className="text-sm text-neutral-500">Best score recorded on every hole combined.</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-neutral-500 uppercase tracking-wide">Potential Total</div>
                      <div className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-teal-600">
                        {perfectTotal} pts
                      </div>
                    </div>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-6 md:grid-cols-9 gap-2">
                  {perfectRound.map((h) => (
                    <div key={h.hole} className={`p-2 rounded-lg border flex flex-col items-center justify-between h-20 ${h.bestPts >= 4 ? 'bg-purple-50 border-purple-200' : 'bg-white border-squab-100'}`}>
                        <div className="text-[10px] text-neutral-400 font-bold">Hole {h.hole}</div>
                        <div className={`text-xl font-bold ${h.bestPts >= 4 ? 'text-purple-600' : 'text-emerald-600'}`}>
                          {h.bestPts} <span className="text-[10px] text-neutral-400 font-normal">pts</span>
                        </div>
                        <div className="text-[9px] text-neutral-600 truncate w-full text-center" title={h.contributors.join(', ')}>
                          {h.contributors.length > 1 ? `${h.contributors.length} players` : h.contributors[0]}
                        </div>
                    </div>
                  ))}
                </div>
              </div>

            </section>
          );
        }

function TheCasino({ computed, courseTees, setView }) {
          if (!computed.length) {
            return (
              <section className="rounded-2xl p-4 bg-white border border-squab-200 shadow-sm">
                <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
                <p className="text-neutral-600">Load an event to open the casino.</p>
              </section>
            );
          }

          const holes = useMemo(() => detectEventHoleCount(computed), [computed]);
          const lastHole = holes;

          // 1. CALCULATE SKINS (Net Stableford Skins)
          const skins = []; // Array of { hole, points, winner }
          
          for (let i = 0; i < holes; i++) {
            let maxPts = -1;
            let winners = [];
            
            computed.forEach(p => {
              const pt = _safeNum(p.perHole[i], NaN);
              if (!Number.isFinite(pt)) return;
              if (pt > maxPts) {
                maxPts = pt;
                winners = [p.name];
              } else if (pt === maxPts) {
                winners.push(p.name);
              }
            });

            if (winners.length === 1 && maxPts > 0) {
              skins.push({ hole: i + 1, points: maxPts, winner: winners[0] });
            }
          }

          // 2. CALCULATE 2s CLUB (Gross Score of 2)
          const twos = []; // Array of { name, hole }

          computed.forEach(p => {
             const tee = chooseTeeForPlayer(p, courseTees);
             if(!tee) return;
             const pars = tee.pars || [];
             const siArr = tee.si || [];
             const playingHcap = Math.round(p.startExact ?? p.handicap ?? 0);

             p.perHole.forEach((pts, i) => {
                const ptVal = Number(pts) || 0;
                // Calculate Strokes Received
                const si = siArr[i] || 0;
                let strokes = 0;
                if(si > 0 && playingHcap > 0) {
                   const full = Math.floor(playingHcap / 18);
                   const rem = playingHcap % 18;
                   strokes = full + (rem >= si ? 1 : 0);
                }
                
                // Gross = Par + Strokes + 2 - Points
                const par = pars[i];
                if(par) {
                   const gross = par + strokes + 2 - ptVal;
                   if(gross === 2) {
                      twos.push({ name: p.name, hole: i + 1 });
                   }
                }
             });
          });

          // Group Skins by Player
          const skinWinners = {};
          skins.forEach(s => {
             if(!skinWinners[s.winner]) skinWinners[s.winner] = [];
             skinWinners[s.winner].push(s);
          });

          return (
            <section className="content-card p-4 md:p-6">
              <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
              
              <div className="mb-8 text-center">
                <h2 className="text-3xl font-black text-squab-900 uppercase tracking-widest drop-shadow-sm">🎰 The Casino</h2>
                <p className="text-sm text-neutral-500 mt-1">Net Skins & The 2s Club</p>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                  
                  {/* NET SKINS COLUMN */}
                  <div>
                      <div className="flex items-center justify-between border-b border-squab-100 pb-2 mb-4">
                         <h3 className="font-bold text-xl text-squab-900">💰 Net Skins</h3>
                         <span className="text-xs bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-1 rounded">Unique High Score Wins</span>
                      </div>
                      
                      {Object.keys(skinWinners).length === 0 ? (
                         <div className="text-center py-8 text-neutral-400 italic">No skins won. Everyone tied!</div>
                      ) : (
                         <div className="space-y-3">
                            {Object.entries(skinWinners).sort((a,b) => b[1].length - a[1].length).map(([name, wins]) => (
                               <div key={name} className="bg-emerald-50 rounded-2xl p-3 flex justify-between items-center border border-emerald-100">
                                   <div className="flex items-center gap-3">
                                      <div className="bg-white border border-emerald-200 text-emerald-800 font-bold w-8 h-8 rounded-full flex items-center justify-center shadow-sm">
                                         {wins.length}
                                      </div>
                                      <span className="font-semibold text-emerald-900">{name}</span>
                                   </div>
                                   <div className="flex gap-1 flex-wrap justify-end">
                                      {wins.map(w => (
                                        <span key={w.hole} className="text-xs bg-white border border-emerald-200 px-2 py-1 rounded text-emerald-800 font-mono">
                                           H{w.hole} ({w.points}pts)
                                        </span>
                                      ))}
                                   </div>
                               </div>
                            ))}
                         </div>
                      )}
                  </div>

                  {/* 2s CLUB COLUMN */}
                  <div>
                      <div className="flex items-center justify-between border-b border-squab-100 pb-2 mb-4">
                         <h3 className="font-bold text-xl text-squab-900">✌️ The 2s Club</h3>
                         <span className="text-xs bg-purple-100 text-purple-800 border border-purple-200 px-2 py-1 rounded">Gross Score of 2</span>
                      </div>

                      {twos.length === 0 ? (
                         <div className="text-center py-8 text-neutral-400 italic">No 2s recorded today.</div>
                      ) : (
                         <div className="grid grid-cols-2 gap-2">
                            {twos.map((t, idx) => (
                               <div key={idx} className="bg-purple-50 p-3 rounded-2xl border border-purple-100 flex justify-between items-center shadow-sm">
                                   <span className="font-semibold text-purple-900 text-sm">{t.name}</span>
                                   <span className="font-bold text-purple-600 font-mono">Hole {t.hole}</span>
                               </div>
                            ))}
                         </div>
                      )}
                      
                      {twos.length > 0 && (
                         <div className="mt-4 p-3 bg-neutral-50 rounded-lg text-center border border-neutral-100">
                            <div className="text-xs text-neutral-500 uppercase tracking-widest">Total Pot Shares</div>
                            <div className="text-2xl font-bold text-squab-900">{twos.length}</div>
                         </div>
                      )}
                  </div>

              </div>
            </section>
          );
        }

function TrophyRoom({ computed, courseTees, setView }) {
          if (!computed.length) {
            return (
              <section className="rounded-2xl p-4 bg-white border border-squab-200 shadow-sm">
                <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
                <p className="text-neutral-600">Load an event to award trophies.</p>
              </section>
            );
          }

          const holes = useMemo(() => detectEventHoleCount(computed), [computed]);
          const lastHole = holes;

          // Helper to find SI 1 hole index
          const refTee = courseTees.find(t => t.gender === 'M') || courseTees[0] || {};
          const siArr = refTee.si || [];
          const hardHoleIdx = siArr.findIndex(s => s === 1);

          // Calculate Badges
          const trophies = computed.map(p => {
            const ptsAll = (Array.isArray(p.perHole) ? p.perHole : []).map(x => _safeNum(x, NaN));
            const pts = ptsAll.slice(0, holes).map(v => (Number.isFinite(v) ? v : 0));
            const badges = [];

            // 1. CLEAN SHEET (No Wipes)
            if (!pts.includes(0)) {
              badges.push({ icon: "🛡️", title: "Clean Sheet", desc: "Zero wipes (0 pts) all round." });
            }

            // 2. THE BANDIT (4+ points)
            if (pts.some(x => x >= 4)) {
              badges.push({ icon: "🦅", title: "The Bandit", desc: "Scored a Net Eagle (4+ pts)." });
            }

            // 3. HOT STREAK (3 consecutive holes of 3+ points)
            let maxStreak = 0;
            let currentStreak = 0;
            pts.forEach(p => {
              if(p >= 3) currentStreak++;
              else {
                maxStreak = Math.max(maxStreak, currentStreak);
                currentStreak = 0;
              }
            });
            maxStreak = Math.max(maxStreak, currentStreak);
            if(maxStreak >= 3) {
              badges.push({ icon: "🔥", title: "He's on Fire", desc: "3+ points on 3 consecutive holes." });
            }

            // 4. SLOW STARTER (Front < 12, Back > 17)
            const f9 = pts.slice(0,9).reduce((a,b)=>a+b,0);
            const b9 = pts.slice(9).reduce((a,b)=>a+b,0);
            if(f9 < 12 && b9 >= 17) {
              badges.push({ icon: "🐢", title: "Slow Starter", desc: "Woke up on the Back 9." });
            }

            // 5. THE SNIPER (Survived SI 1)
            if(hardHoleIdx !== -1 && pts[hardHoleIdx] >= 2) {
               badges.push({ icon: "🎯", title: "The Sniper", desc: "Conquered the Stroke Index 1 hole." });
            }

            // 6. THE BIG FINISH (3+ on the finishing hole)
            if(pts[lastHole - 1] >= 3) {
              badges.push({ icon: "💣", title: "Clutch Finish", desc: "Big points on the finishing hole." });
            }

            return { name: p.name, badges };
          }).filter(p => p.badges.length > 0).sort((a,b) => b.badges.length - a.badges.length);

          return (
            <section className="content-card p-4 md:p-6">
              <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
              
              <div className="mb-6 text-center">
                <h2 className="text-2xl font-bold text-squab-900">🏆 The Trophy Room</h2>
                <p className="text-sm text-neutral-500">Honoring the heroes, the bandits, and the survivors.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {trophies.map((t) => (
                  <div key={t.name} className="border border-squab-100 rounded-2xl p-4 bg-neutral-50 hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-center mb-3 border-b border-neutral-200 pb-2">
                        <h3 className="font-bold text-neutral-800">{t.name}</h3>
                        <span className="text-xs font-semibold bg-squab-100 text-squab-800 px-2 py-0.5 rounded-full">{t.badges.length} Award{t.badges.length!==1?'s':''}</span>
                      </div>
                      <div className="space-y-2">
                        {t.badges.map((b, i) => (
                          <div key={i} className="flex items-start gap-3 bg-white p-2 rounded-lg border border-neutral-100">
                             <div className="text-2xl">{b.icon}</div>
                             <div>
                               <div className="text-xs font-bold text-neutral-900">{b.title}</div>
                               <div className="text-[10px] text-neutral-500 leading-tight">{b.desc}</div>
                             </div>
                          </div>
                        ))}
                      </div>
                  </div>
                ))}
                
                {trophies.length === 0 && (
                   <div className="col-span-full text-center py-10 text-neutral-400 italic">
                     No distinct achievements earned this round. Tough crowd.
                   </div>
                )}
              </div>
            </section>
          );
        }

function PartnerPicker({ computed, setView }) {
          const [me, setMe] = useState("");

          useEffect(() => {
            if (computed.length && !me) setMe(computed[0].name);
          }, [computed, me]);

          if (!computed.length) {
            return (
              <section className="rounded-2xl p-4 bg-white border border-squab-200 shadow-sm">
                <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
                <p className="text-neutral-600">Load an event to find your partner.</p>
              </section>
            );
          }

          const holes = useMemo(() => detectEventHoleCount(computed), [computed]);

          const myData = computed.find((p) => p.name === me) || computed[0];
          const myPts = myData.perHole.map((x) => Number(x) || 0);

          // Calculate compatibility with everyone else
          const partners = computed
            .filter((p) => p.name !== me)
            .map((p) => {
              const theirPts = p.perHole.map((x) => Number(x) || 0);
              let betterBall = 0;
              let coveredWipes = 0;
              let hamAndEgg = 0; // Times I failed and they scored big, or vice versa

              for (let i = 0; i < holes; i++) {
                const m = myPts[i];
                const t = theirPts[i];
                betterBall += Math.max(m, t);

                if (m === 0 && t >= 2) coveredWipes++; // They saved your wipe
                if ((m < 2 && t >= 3) || (t < 2 && m >= 3)) hamAndEgg++; // Big variation
              }

              const synergy = betterBall - myData.points; // How many points they added to your score

              return {
                name: p.name,
                total: betterBall,
                synergy,
                coveredWipes,
                points: p.points, // Their individual score
              };
            })
            .sort((a, b) => b.total - a.total);

          const bestPartner = partners[0];

          return (
            <section className="content-card p-4 md:p-6">
              <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />

              <div className="mb-6 border-b border-squab-100 pb-6">
                <h2 className="text-xl font-bold text-squab-900 mb-2">
                  🤝 The Partner Simulator
                </h2>
                <p className="text-sm text-neutral-500 mb-4">
                  Who complements your game? We calculated the "Better Ball" score for
                  every possible partnership.
                </p>

                <div className="flex flex-col sm:flex-row items-center gap-4 bg-squab-50 p-4 rounded-2xl border border-squab-100">
                  <div className="flex flex-col w-full sm:w-auto">
                    <label className="text-[10px] uppercase font-bold text-squab-600 mb-1">
                      Select Player
                    </label>
                    <select
                      className="p-2 rounded-lg border border-squab-200 bg-white font-semibold text-squab-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={me}
                      onChange={(e) => {
                           const val = e.target.value;
                           setMe(val);
                           // UMAMI TRACKING
                           if(window.umami) window.umami.track("Check Partner", { player: val });
                      }}
                    >
                      {computed.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="hidden sm:block text-2xl text-squab-300">→</div>

                  <div className="flex-1 w-full">
                    <div className="text-xs text-squab-600 font-bold uppercase mb-1">
                      Best Match
                    </div>
                    {bestPartner ? (
                      <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-squab-200 shadow-sm">
                        <div>
                          <div className="font-bold text-lg text-emerald-700">
                            {bestPartner.name}
                          </div>
                          <div className="text-[10px] text-neutral-500">
                            Saved you on {bestPartner.coveredWipes} holes
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-black text-squab-600">
                            {bestPartner.total}
                          </div>
                          <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-wide">
                            Combined Pts
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-neutral-400">Not enough players</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-neutral-200">
                <table className="w-full text-sm text-left">
                  <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500">
                    <tr>
                      <th className="p-3 font-semibold">Partner</th>
                      <th className="p-3 font-semibold">Their Score</th>
                      <th className="p-3 font-semibold text-center">Synergy</th>
                      <th className="p-3 font-semibold text-right">Team Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {partners.slice(0, 10).map((p, i) => (
                      <tr key={p.name} className="hover:bg-neutral-50 transition-colors">
                        <td className="p-3 font-medium text-neutral-800">
                          {i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : ""}
                          {p.name}
                        </td>
                        <td className="p-3 text-neutral-500">{p.points}</td>
                        <td className="p-3 text-center">
                          <span className="inline-block px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-md">
                            +{p.synergy} pts
                          </span>
                        </td>
                        <td className="p-3 text-right font-bold text-lg text-squab-700">
                          {p.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="bg-neutral-50 p-2 text-center text-[10px] text-neutral-400">
                  Showing Top 10 potential partners
                </div>
              </div>
            </section>
          );
        }

function ReplayRoom({ computed, setView }) {
          const [hole, setHole] = useState(0); // 0 = Start, 1-holes
          const [isPlaying, setIsPlaying] = useState(false);
          const [speed, setSpeed] = useState(800); // ms per hole

          const holes = useMemo(() => detectEventHoleCount(computed), [computed]);

          // 1. Prepare Cumulative Data
          // We need a snapshot of the leaderboard at every hole
          const timeline = useMemo(() => {
            if (!computed.length) return [];
            
            // Create snapshots (Start + holes)
            const snapshots = [];
            
            // Snapshot 0 (Start)
            snapshots.push(computed.map(p => ({ 
              name: p.name, 
              total: 0, 
              lastHolePts: 0,
              color: "#e5e7eb" // gray
            })));

            // Snapshots 1-holes
            for (let h = 0; h < holes; h++) {
              const prev = snapshots[h]; // Get previous totals
              
              const current = prev.map(p => {
                // Find player's points for this specific hole
                const playerOrig = computed.find(c => c.name === p.name);
                const holePts = Number(playerOrig.perHole[h]) || 0;
                const newTotal = p.total + holePts;
                
                // Color logic based on how good the hole was
                let color = "#94a3b8"; // neutral
                if (holePts >= 3) color = "#10b981"; // Emerald (Great)
                if (holePts === 0) color = "#ef4444"; // Red (Wipe)
                
                return {
                  name: p.name,
                  total: newTotal,
                  lastHolePts: holePts,
                  color
                };
              });
              
              // Sort this snapshot by total score DESC
              current.sort((a, b) => b.total - a.total);
              snapshots.push(current);
            }
            
            return snapshots;
          }, [computed]);

          // 2. Animation Loop
          useEffect(() => {
            let interval = null;
            if (isPlaying && hole < holes) {
              interval = setInterval(() => {
                setHole(h => {
                  if (h >= holes) {
                    setIsPlaying(false);
                    return holes;
                  }
                  return h + 1;
                });
              }, speed);
            } else if (hole === holes) {
              setIsPlaying(false);
            }
            return () => clearInterval(interval);
          }, [isPlaying, hole, speed]);

          if (!computed.length) {
            return (
              <section className="rounded-2xl p-4 bg-white border border-squab-200 shadow-sm">
                <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />
                <p className="text-neutral-600">Load an event to watch the replay.</p>
              </section>
            );
          }

          const currentStandings = timeline[hole] || [];
          // Only show top 10 to keep animation smooth and viewable
          const viewableData = currentStandings.slice(0, 10);
          const maxScore = Math.max(...currentStandings.map(s => s.total), 10); // Dynamic Scale

          return (
            <section className="rounded-2xl p-4 md:p-6 bg-white border border-squab-200 shadow-sm transition-all">
              <EventNav setView={setView} hasEvent={!!(computed && computed.length)} />

              <div className="flex flex-col md:flex-row items-center justify-between mb-6 border-b border-squab-100 pb-4 gap-4">
                <div>
                  <h2 className="text-xl font-bold text-squab-900">📺 The Replay Room</h2>
                  <p className="text-sm text-neutral-500">Watch the round unfold hole-by-hole.</p>
                </div>

                <div className="flex items-center gap-2 bg-neutral-50 p-2 rounded-2xl border border-neutral-200">
                  <button 
                    onClick={() => { setHole(0); setIsPlaying(true); }}
                    className="w-10 h-10 flex items-center justify-center rounded-lg bg-white text-neutral-700 border border-neutral-300 font-bold hover:bg-neutral-50 transition-colors"
                    title="Restart & Play"
                  >
                    ↻
                  </button>
                  <button 
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="w-24 h-10 flex items-center justify-center rounded-lg bg-neutral-900 text-white font-bold hover:bg-neutral-800 transition-colors shadow-sm"
                  >
                    {isPlaying ? "PAUSE" : hole === holes ? "DONE" : "PLAY ▶"}
                  </button>
                  
                  <div className="flex flex-col px-2">
                      <label className="text-[9px] font-bold text-neutral-600 uppercase">Speed</label>
                      <input 
                        type="range" min="100" max="1500" step="100" 
                        className="w-20 accent-neutral-900 h-1.5 bg-neutral-200 rounded-lg appearance-none cursor-pointer"
                        value={1600 - speed} // Invert so right is faster
                        onChange={(e) => setSpeed(1600 - Number(e.target.value))}
                      />
                  </div>
                </div>
              </div>

              <div className="relative">
                {/* Progress Bar */}
                <div className="flex justify-between items-end mb-2 px-1">
                   <div className="text-4xl font-black text-neutral-900">
                     {hole === 0 ? "START" : `HOLE ${hole}`}
                   </div>
                   {hole > 0 && hole < holes && (
                     <div className="animate-pulse text-xs font-bold text-emerald-600 uppercase tracking-widest">
                       ● Live Updates
                     </div>
                   )}
                </div>
                <div className="w-full bg-neutral-100 h-2 rounded-full mb-6 overflow-hidden">
                   <div 
                     className="bg-neutral-900 h-full transition-all duration-300 ease-linear" 
                     style={{ width: `${(hole / holes) * 100}%` }}
                   ></div>
                </div>

                {/* The Race Chart */}
                <div className="space-y-2 min-h-[400px]">
                  {viewableData.map((p, idx) => (
                    <div 
                      key={p.name} 
                      className="relative flex items-center gap-3 transition-all duration-500 ease-in-out"
                      style={{ 
                        transform: `translateY(${0}px)`, // React renders lists in order, layout shift handles the swap visually
                      }}
                    >
                      <div className="w-6 text-right text-xs font-bold text-neutral-400 font-mono">
                        {idx + 1}
                      </div>
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                           <span className="text-xs font-bold text-squab-900 truncate w-32">{p.name}</span>
                           {hole > 0 && p.lastHolePts >= 3 && <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1 rounded animate-bounce">🔥 3pts</span>}
                           {hole > 0 && p.lastHolePts === 0 && <span className="text-[9px] bg-red-100 text-red-700 px-1 rounded">❌ Wipe</span>}
                        </div>
                        
                        <div className="relative h-8 bg-neutral-50 rounded-r-lg w-full">
                           <div 
                             className="h-full rounded-r-lg flex items-center justify-end px-2 text-white text-xs font-bold shadow-sm transition-all duration-700 ease-out"
                             style={{ 
                               width: `${Math.max((p.total / maxScore) * 100, 2)}%`,
                               backgroundColor: hole === 0 ? '#cbd5e1' : p.color 
                             }}
                           >
                             {p.total}
                           </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                {hole === holes && (
                   <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm z-10 rounded-2xl">
                      <div className="bg-white border-2 border-emerald-500 p-8 rounded-2xl shadow-2xl text-center transform scale-110">
                         <div className="text-6xl mb-2">🏆</div>
                         <div className="text-sm font-bold text-neutral-400 uppercase tracking-widest">Winner</div>
                         <div className="text-3xl font-black text-squab-900">{viewableData[0]?.name}</div>
                         <div className="text-xl font-bold text-squab-600">{viewableData[0]?.total} Points</div>
                         <button onClick={() => { setHole(0); setIsPlaying(true); }} className="mt-4 text-xs underline text-neutral-500 hover:text-squab-600">Replay</button>
                      </div>
                   </div>
                )}
              </div>
            </section>
          );
        }

function _clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }

function _signedFmt(x, d=2){
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return `${n>=0?"+":""}${fmt(n,d)}`;
}

function _barFill(delta, maxAbs){
  const m = Number(maxAbs);
  const v = _clamp(Number(delta)||0, -m, m);
  const w = (Math.abs(v)/m) * 50;
  const left = v >= 0 ? 50 : (50 - w);
  const width = w;
  const cls = v >= 0 ? "bg-emerald-400/70" : "bg-rose-400/70";
  return { left, width, cls, v };
}

function HorizontalDeltaRow({
  label,
  valueText,
  delta,
  deltaText,
  maxAbs=1,
  subText=null,
  badgeText=null
}){
  const st = _barFill(delta, maxAbs);
  return (
    <div className="grid grid-cols-[170px_1fr_150px] gap-3 items-center py-1">
      <div className="min-w-0">
        <div className="text-xs font-semibold text-neutral-900 truncate">{label}</div>
        {subText ? <div className="text-[11px] text-neutral-500 truncate">{subText}</div> : null}
      </div>
      <div className="h-3 rounded-full bg-neutral-100 border border-neutral-200 relative overflow-hidden">
        <div className="absolute left-1/2 top-0 bottom-0 w-[2px] bg-neutral-300" />
        <div className={`absolute top-0 bottom-0 ${st.cls}`} style={{ left: `${st.left}%`, width: `${st.width}%` }} />
      </div>
      <div className="text-right min-w-0">
        <div className="text-xs font-mono text-neutral-700">{valueText || "—"}</div>
        <div className="text-[11px] text-neutral-500">
          {deltaText != null ? deltaText : _signedFmt(delta,2)}{badgeText ? ` · ${badgeText}` : ""}
        </div>
      </div>
    </div>
  );
}

function ImpactRow({ label, impactPerRound, maxAbs=3, lowSample=false, unit="pts/round" }){
  const d = Number(impactPerRound);
  const st = _barFill(d, maxAbs);
  const txt = Number.isFinite(d) ? `${d>=0?"+":""}${fmt(d,1)} ${unit}` : "—";
  return (
    <div className="grid grid-cols-[220px_1fr_110px] gap-3 items-center py-1">
      <div className="min-w-0">
        <div className="text-xs font-semibold text-neutral-900 truncate">{label}{lowSample ? " (low sample)" : ""}</div>
      </div>
      <div className="h-3 rounded-full bg-neutral-100 border border-neutral-200 relative overflow-hidden">
        <div className="absolute left-1/2 top-0 bottom-0 w-[2px] bg-neutral-300" />
        <div className={`absolute top-0 bottom-0 ${st.cls}`} style={{ left: `${st.left}%`, width: `${st.width}%` }} />
      </div>
      <div className="text-right text-xs font-mono text-neutral-700">{txt}</div>
    </div>
  );
}

function _linregSlope(xs, ys){
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  let sx=0, sy=0, sxx=0, sxy=0;
  for (let i=0;i<n;i++){
    const x = Number(xs[i]), y = Number(ys[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x; sy += y; sxx += x*x; sxy += x*y;
  }
  const denom = (n*sxx - sx*sx);
  if (Math.abs(denom) < 1e-9) return NaN;
  return (n*sxy - sx*sy) / denom;
}

function _fmt(n, dp=2){ const x=_num(n, NaN); return Number.isFinite(x) ? x.toFixed(dp) : "—"; }


// Global helper: build a "par baseline" object (same keys/holes, zero value) for strokes-vs-par comparisons.
var makeParBaseline = function(meObj){
  var out = {};



  Object.keys(meObj || {}).forEach(function(k){
    var h = _num(meObj && meObj[k] ? meObj[k].holes : 0, 0);
    if (h) out[k] = { holes: h, val: 0 };
  });
  return out;
};


function formatSigned(n, dp = 2){
  const x = (n === null || n === undefined || n === "" ? NaN : Number(n));
  if (!Number.isFinite(x)) return "—";
  const decimals = Number.isFinite(dp) ? Math.max(0, Math.min(6, dp)) : 2;

  let s;
  try{
    s = new Intl.NumberFormat(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(x);
  }catch{
    s = x.toFixed(decimals);
  }
  return x > 0 ? `+${s}` : s;
}



function _signalLabel(holes){
    const h = _num(holes, 0);
    if (h <= 0) return null;
    if (h < 18) return "Low sample";
    if (h < 54) return "Developing";
    if (h < 90) return "Good";
    return "Strong";
  }

function _tinyDelta(d){
    const x = _num(d, NaN);
    if (!Number.isFinite(x)) return false;
    const tol = scoringMode === "gross" ? 0.03 : 0.03; // per-hole units
    return Math.abs(x) < tol;
  }

function _line(key, goodText, badText, neutralText){
    const n = _num(key, NaN);
    if (!Number.isFinite(n)) return neutralText || "—";
    if (Math.abs(n) < 0.02) return neutralText || "Pretty neutral.";
    return n > 0 ? goodText : badText;
  }


export default App;
