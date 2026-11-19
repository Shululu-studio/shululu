// server.ts
import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

// src/utils/transcriptionParser.ts
function normalizeVocalRole(raw) {
  if (typeof raw !== "string") return void 0;
  const lower = raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!lower) return void 0;
  if (lower === "lead" || lower === "leadvocal" || lower === "leadvocalist" || lower === "main") {
    return "lead";
  }
  if (lower === "backing" || lower === "backingvocal" || lower === "backingvocalist" || lower === "background" || lower === "bgv" || lower === "echo" || lower === "harmony") {
    return "backing";
  }
  if (lower === "choir" || lower === "ensemble" || lower === "group" || lower === "crowd") {
    return "choir";
  }
  if (lower === "adlib" || lower === "adlibs" || lower === "riff" || lower === "run") {
    return "adlib";
  }
  return void 0;
}
function stripOuterParentheses(text) {
  let out = (text || "").trim();
  while (out.startsWith("(") && out.endsWith(")") && out.length >= 2) {
    let depth = 0;
    let closesAtEnd = true;
    for (let i = 0; i < out.length; i++) {
      if (out[i] === "(") depth++;
      else if (out[i] === ")") depth--;
      if (depth === 0 && i < out.length - 1) {
        closesAtEnd = false;
        break;
      }
    }
    if (!closesAtEnd || depth !== 0) break;
    out = out.slice(1, -1).trim();
  }
  return out;
}
function formatLyricForVocalRole(text, _role) {
  const trimmed = (text || "").trim();
  if (!trimmed) return "";
  return stripOuterParentheses(trimmed);
}
function inferVocalRoleFromText(text, explicitRole) {
  const normalized = normalizeVocalRole(explicitRole);
  if (normalized) return normalized;
  const trimmed = (text || "").trim();
  if (trimmed.startsWith("(") && trimmed.endsWith(")") && stripOuterParentheses(trimmed).length > 0) {
    return "backing";
  }
  return "lead";
}
function countVocalWords(text) {
  const cleaned = stripOuterParentheses((text || "").trim()).replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ").trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}
function normalizeMultilingualToken(token) {
  return (token || "").normalize("NFKC").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/œ/gi, "oe").replace(/æ/gi, "ae").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
function normalizeFuzzyToken(token) {
  return normalizeMultilingualToken(token);
}
function tokenizeNormalizedWords(text) {
  return stripOuterParentheses((text || "").trim()).replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ").split(/\s+/).map(normalizeFuzzyToken).filter(Boolean);
}
function boundedLevenshtein(a, b, maxDist = 2) {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  const dp = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) dp[j] = j;
  for (let i = 1; i <= la; i++) {
    let prev = dp[0];
    dp[0] = i;
    let rowMin = dp[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const temp = dp[j];
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      if (dp[j] < rowMin) rowMin = dp[j];
      prev = temp;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return dp[lb];
}
function fuzzyWordMatch(wordA, wordB) {
  const a = normalizeFuzzyToken(wordA);
  const b = normalizeFuzzyToken(wordB);
  if (!a || !b) return false;
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  if (minLen < 3) return false;
  if (minLen >= 4 && (a.startsWith(b) || b.startsWith(a)) && minLen / maxLen >= 0.72) {
    return true;
  }
  if (minLen >= 4 && maxLen >= 5) {
    const d = boundedLevenshtein(a, b, 2);
    if (d <= 1) return true;
    if (minLen >= 5 && d <= 2 && d / maxLen <= 0.28) return true;
  }
  return false;
}
function tokensPrefixMatch(shortTokens, longTokens) {
  if (shortTokens.length === 0 || shortTokens.length >= longTokens.length) {
    return { matched: false, allExact: false };
  }
  let allExact = true;
  let directOk = true;
  for (let i = 0; i < shortTokens.length; i++) {
    if (shortTokens[i] !== longTokens[i]) {
      allExact = false;
      if (!fuzzyWordMatch(shortTokens[i], longTokens[i])) {
        directOk = false;
        break;
      }
    }
  }
  if (directOk) {
    return { matched: true, allExact };
  }
  if (shortTokens.length >= 2) {
    const joined = shortTokens.join("");
    if (fuzzyWordMatch(joined, longTokens[0])) {
      return { matched: true, allExact: false };
    }
  }
  return { matched: false, allExact: false };
}
function tokensSuffixMatch(shortTokens, longTokens) {
  if (shortTokens.length === 0 || shortTokens.length >= longTokens.length) return false;
  const offset = longTokens.length - shortTokens.length;
  for (let i = 0; i < shortTokens.length; i++) {
    if (!fuzzyWordMatch(shortTokens[i], longTokens[offset + i])) {
      return false;
    }
  }
  return true;
}
function stretchMergedWords(base, mergedStart, mergedEnd) {
  if (!Array.isArray(base.words) || base.words.length === 0) {
    return base;
  }
  const n = base.words.length;
  const updated = base.words.map((w) => ({ ...w }));
  updated[0].start = Number(Math.min(updated[0].start, mergedStart).toFixed(3));
  updated[n - 1].end = Number(Math.max(updated[n - 1].end, mergedEnd).toFixed(3));
  for (let i = 0; i < n; i++) {
    const minS = i > 0 ? updated[i - 1].start + 0.025 : mergedStart;
    const maxS = Math.max(minS, mergedEnd - (n - i) * 0.025);
    const s = Number(Math.max(minS, Math.min(maxS, updated[i].start)).toFixed(3));
    const maxE = i < n - 1 ? Math.max(s + 0.025, updated[i + 1].start) : mergedEnd;
    const e = Number(Math.max(s + 0.025, Math.min(mergedEnd, maxE, updated[i].end)).toFixed(3));
    updated[i].start = s;
    updated[i].end = i === n - 1 ? Number(Math.max(e, mergedEnd).toFixed(3)) : e;
  }
  return { ...base, words: updated };
}
function mergeSplitPhraseDuplicates(segments) {
  if (segments.length <= 1) return segments;
  const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const cur of sorted) {
    if (merged.length === 0) {
      merged.push(cur);
      continue;
    }
    const prev = merged[merged.length - 1];
    const prevRole = inferVocalRoleFromText(prev.text, prev.vocalRole);
    const curRole = inferVocalRoleFromText(cur.text, cur.vocalRole);
    if (prevRole !== curRole) {
      merged.push(cur);
      continue;
    }
    const prevTokens = tokenizeNormalizedWords(prev.text);
    const curTokens = tokenizeNormalizedWords(cur.text);
    if (prevTokens.length === 0 || curTokens.length === 0) {
      merged.push(cur);
      continue;
    }
    const gap = cur.start - prev.end;
    const prevDur = Math.max(0.05, prev.end - prev.start);
    const curDur = Math.max(0.05, cur.end - cur.start);
    const overlaps = cur.start < prev.end + 0.12;
    if (overlaps && prevTokens.length === curTokens.length && prevTokens.every((t, idx) => fuzzyWordMatch(t, curTokens[idx]))) {
      const target = curTokens.join("").length >= prevTokens.join("").length ? cur : prev;
      const newStart = Math.min(prev.start, cur.start);
      const newEnd = Math.max(prev.end, cur.end);
      merged[merged.length - 1] = stretchMergedWords(
        { ...target, start: newStart, end: newEnd },
        newStart,
        newEnd
      );
      continue;
    }
    if (prevTokens.length < curTokens.length && prevTokens.length <= 3) {
      const prefix = tokensPrefixMatch(prevTokens, curTokens);
      const isOverlappingHalfWordStem = overlaps && prevTokens.length === 1 && prevTokens[0].length >= 4 && prevDur <= 1.2 && curTokens[0].startsWith(prevTokens[0]);
      if (prefix.matched || isOverlappingHalfWordStem) {
        const isFuzzyFragmentSplit = !prefix.allExact && prevDur <= 2.2 && gap <= 0.75;
        const isTightBriefSplit = prevDur <= 1.35 && gap <= 0.45;
        if (overlaps || isFuzzyFragmentSplit || isTightBriefSplit) {
          const newStart = Math.min(prev.start, cur.start);
          const newEnd = Math.max(prev.end, cur.end);
          merged[merged.length - 1] = stretchMergedWords(
            { ...cur, start: newStart, end: newEnd },
            newStart,
            newEnd
          );
          continue;
        }
      }
    }
    if (curTokens.length < prevTokens.length && curTokens.length <= 2 && gap <= 0.45 && (overlaps || curDur <= 1.35) && tokensSuffixMatch(curTokens, prevTokens)) {
      const newStart = Math.min(prev.start, cur.start);
      const newEnd = Math.max(prev.end, cur.end);
      merged[merged.length - 1] = stretchMergedWords(
        { ...prev, start: newStart, end: newEnd },
        newStart,
        newEnd
      );
      continue;
    }
    if (overlaps && prevTokens.length >= 2 && curTokens.length >= 2 && prevTokens.length + curTokens.length <= 10) {
      const prevRaw = prev.text.trim().split(/\s+/).filter(Boolean);
      const curRaw = cur.text.trim().split(/\s+/).filter(Boolean);
      let bridgeLen = 0;
      const maxCheck = Math.min(2, prevTokens.length - 1, curTokens.length - 1);
      for (let k = maxCheck; k >= 1; k--) {
        let allMatch = true;
        for (let idx = 0; idx < k; idx++) {
          if (!fuzzyWordMatch(prevTokens[prevTokens.length - k + idx], curTokens[idx])) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          bridgeLen = k;
          break;
        }
      }
      if (bridgeLen > 0) {
        const joinedText = [...prevRaw.slice(0, prevRaw.length - bridgeLen), ...curRaw].join(" ");
        const newStart = Math.min(prev.start, cur.start);
        const newEnd = Math.max(prev.end, cur.end);
        const mergedWords = Array.isArray(prev.words) && Array.isArray(cur.words) ? [...prev.words.slice(0, prev.words.length - bridgeLen), ...cur.words] : void 0;
        merged[merged.length - 1] = stretchMergedWords(
          {
            ...prev,
            text: joinedText,
            start: newStart,
            end: newEnd,
            words: mergedWords
          },
          newStart,
          newEnd
        );
        continue;
      }
    }
    merged.push(cur);
  }
  return merged;
}
function filterVocalSegmentsForCleanPresentation(segments) {
  if (segments.length <= 1) return segments;
  const meta = segments.map((seg) => ({
    role: inferVocalRoleFromText(seg.text, seg.vocalRole),
    wordCount: countVocalWords(seg.text),
    dur: Math.max(0.05, seg.end - seg.start)
  }));
  const dropIndices = /* @__PURE__ */ new Set();
  const promoteBackingIndices = /* @__PURE__ */ new Set();
  for (let i = 0; i < segments.length; i++) {
    const cur = segments[i];
    const curMeta = meta[i];
    if (curMeta.role !== "lead" && curMeta.role !== "adlib") continue;
    if (curMeta.wordCount === 0 || curMeta.wordCount > 2) continue;
    for (let j = 0; j < segments.length; j++) {
      if (i === j) continue;
      const other = segments[j];
      const otherMeta = meta[j];
      const overlap = Math.min(cur.end, other.end) - Math.max(cur.start, other.start);
      const nested = cur.start >= other.start - 0.08 && cur.end <= other.end + 0.08;
      if (overlap < 0.12 && !nested) continue;
      let interruptsHost = false;
      if (otherMeta.role === "backing" || otherMeta.role === "choir") {
        interruptsHost = otherMeta.wordCount >= 3 || otherMeta.wordCount > curMeta.wordCount || other.start <= cur.start - 0.12 && otherMeta.dur >= curMeta.dur * 1.15;
      } else if (curMeta.role === "adlib" && otherMeta.role === "lead") {
        interruptsHost = otherMeta.wordCount >= 3 || otherMeta.wordCount >= 2 && (otherMeta.wordCount > curMeta.wordCount || other.start <= cur.start);
      }
      if (interruptsHost) {
        dropIndices.add(i);
        if (otherMeta.role === "backing") {
          promoteBackingIndices.add(j);
        }
        break;
      }
    }
  }
  const keptPrimary = segments.map((seg, idx) => {
    if (dropIndices.has(idx)) return null;
    if (promoteBackingIndices.has(idx)) {
      return { ...seg, vocalRole: "choir" };
    }
    return seg;
  }).filter((seg) => seg !== null);
  const withoutBackingEchoes = keptPrimary.filter((seg, idx) => {
    const role = inferVocalRoleFromText(seg.text, seg.vocalRole);
    if (role !== "backing") return true;
    const hasMainOverlap = keptPrimary.some((other, oIdx) => {
      if (oIdx === idx) return false;
      const oRole = inferVocalRoleFromText(other.text, other.vocalRole);
      if (oRole !== "lead" && oRole !== "choir") return false;
      const overlap = Math.min(seg.end, other.end) - Math.max(seg.start, other.start);
      return overlap >= 0.1;
    });
    return !hasMainOverlap;
  });
  return mergeSplitPhraseDuplicates(withoutBackingEchoes);
}
var WORSHIP_VOCAB_REPAIRS = [
  [/\b(?:jireh|jirah|jyrah|gyrah|jiroh|jire|jireah)\b/gi, "Jireh"],
  [/\b(?:jehovah|jehova|jahovah|jehowah)\b/gi, "Jehovah"],
  [/\b(?:yahweh|yahway|yahwe|yahwah|yaweh|yawah)\b/gi, "Yahweh"],
  [/\b(?:hallelujah|h?allelu[iy]ah?|haleluj[ao]h?|h?alleluj?ah?|hallalujah)\b/gi, "Hallelujah"],
  [/\b(?:hosanna|hosana|hozanna|hosanah)\b/gi, "Hosanna"],
  [/\b(?:elohim|elohiem|eloheem|elohym)\b/gi, "Elohim"],
  [/\b(?:adonai|adonay|adonayh|adonaiy)\b/gi, "Adonai"]
];
function repairWorshipVocabulary(text) {
  let out = text;
  for (const [pattern, replacement] of WORSHIP_VOCAB_REPAIRS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
function parseFlexibleTimestamp(value, maxDurationHint) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/[\[\]()]/g, "");
  if (!trimmed) return null;
  if (/^\d+(?:[.,]\d+)?$/.test(trimmed)) {
    const n = Number(trimmed.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const hms = trimmed.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[.,:](\d{1,3}))?$/);
  if (hms) {
    const hours = hms[1] ? parseInt(hms[1], 10) : 0;
    const mins = parseInt(hms[2], 10);
    const secs = parseInt(hms[3], 10);
    const frac = hms[4] ? parseInt(hms[4], 10) / Math.pow(10, hms[4].length) : 0;
    if (hms[1] && !hms[4] && mins < 60 && hours < 60) {
      const asHours = hours * 3600 + mins * 60 + secs;
      const limit = Number.isFinite(maxDurationHint) && (maxDurationHint ?? 0) > 0 ? maxDurationHint : 3600;
      if (asHours > limit * 1.05 && limit < 3600) {
        return Number((hours * 60 + mins + secs / 100).toFixed(3));
      }
    }
    if (secs < 60 && mins < 600) {
      return Number((hours * 3600 + mins * 60 + secs + frac).toFixed(3));
    }
  }
  return null;
}
function resolveSegmentTiming(seg, fallbackStart, fallbackEnd, maxDuration) {
  const safeMax = Number.isFinite(maxDuration) && maxDuration > 0.5 ? maxDuration : 30;
  const clockStart = parseFlexibleTimestamp(seg.startTime, safeMax);
  const clockEnd = parseFlexibleTimestamp(seg.endTime, safeMax);
  const numStart = parseFlexibleTimestamp(seg.start, safeMax);
  const numEnd = parseFlexibleTimestamp(seg.end, safeMax);
  const chosenStart = clockStart ?? numStart;
  const chosenEnd = clockEnd ?? numEnd;
  const hasExplicitTiming = chosenStart !== null && chosenEnd !== null;
  const start = Number(
    Math.max(0, Math.min(safeMax - 0.35, chosenStart ?? fallbackStart)).toFixed(2)
  );
  const rawEnd = chosenEnd ?? Math.max(start + 1.2, fallbackEnd);
  const end = Number(
    Math.max(start + 0.35, Math.min(safeMax, rawEnd)).toFixed(2)
  );
  return { start, end, hasExplicitTiming };
}
function stripMarkdownJson(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "{}";
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}
function safeParseJson(raw) {
  try {
    return JSON.parse(stripMarkdownJson(raw));
  } catch {
    return null;
  }
}
function detectSectionFromMarker(marker) {
  const lower = marker.trim().toLowerCase();
  if (lower.includes("pre-chorus") || lower.includes("pre chorus")) return "pre-chorus";
  if (lower.includes("post-chorus") || lower.includes("post chorus")) return "chorus";
  if (lower.includes("chorus") || lower.includes("hook") || lower.includes("refrain")) return "chorus";
  if (lower.includes("bridge")) return "bridge";
  if (lower.includes("intro")) return "intro";
  if (lower.includes("outro") || lower.includes("ending") || lower.includes("fade out")) return "outro";
  if (lower.includes("verse")) return "verse";
  return null;
}
var PAREN_DIRECTION_RE = /\(\s*(?:intro|outro|ending|pre[-\s]?chorus|post[-\s]?chorus|chorus|verse|hook|refrain|bridge|instrumental(?:\s+break)?|(?:guitar|piano|synth|drum|bass|sax|violin|organ)?\s*solo|break|breakdown|interlude|build(?:\s*-?\s*up)?|drop|fade\s*(?:in|out)|end|music|beat|spoken(?:\s+word)?|whispered|applause|silence|choir|vocals?)(?:\s*[-#\d][^)]*)?\s*\)/gi;
var LEADING_SECTION_COLON_RE = /^(?:intro|outro|ending|pre[-\s]?chorus|post[-\s]?chorus|chorus|verse|hook|refrain|bridge|instrumental|solo|style|prompt|title|lyrics|vocals|mood|genre|tempo|bpm)(?:\s*\d+)?\s*:\s*/i;
var STANDALONE_DIRECTION_RE = /^(?:intro|outro|ending|pre[-\s]?chorus|post[-\s]?chorus|instrumental(?:\s+break)?|(?:guitar|piano|synth|drum|bass|sax|violin|organ)\s+solo|fade\s*(?:in|out)|spoken\s+word|applause|silence)(?:\s+\d+)?$/i;
var STANDALONE_NUMBERED_SECTION_RE = /^(?:verse|chorus|bridge|hook|refrain)\s*\d+$/i;
function cleanLyricSegmentText(rawText) {
  let detectedSection = null;
  let working = (rawText || "").trim();
  if (!working) return { text: "", detectedSection: null };
  if (/^\[\s*instrumental\s*\]$/i.test(working)) {
    return { text: "[instrumental]", detectedSection: null };
  }
  working = working.replace(/\[([^\]]*)\]/g, (_full, inner) => {
    const sec = detectSectionFromMarker(inner);
    if (sec) detectedSection = sec;
    return " ";
  });
  working = working.replace(PAREN_DIRECTION_RE, (full) => {
    const sec = detectSectionFromMarker(full.slice(1, -1));
    if (sec) detectedSection = sec;
    return " ";
  });
  working = working.replace(/\s+/g, " ").trim();
  const colonMatch = working.match(LEADING_SECTION_COLON_RE);
  if (colonMatch) {
    const sec = detectSectionFromMarker(colonMatch[0]);
    if (sec) detectedSection = sec;
    working = working.slice(colonMatch[0].length).trim();
    if (/^(?:style|prompt|tempo|bpm|genre|mood)\s*:/i.test(colonMatch[0])) {
      return { text: "", detectedSection };
    }
  }
  if (working.includes("(") && working.includes(")")) {
    const withoutParens = working.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    if (withoutParens.length > 0) {
      working = withoutParens.replace(/\s+([,.;!?])/g, "$1").trim();
    }
  }
  if (!working || STANDALONE_DIRECTION_RE.test(working) || STANDALONE_NUMBERED_SECTION_RE.test(working)) {
    const sec = detectSectionFromMarker(working);
    if (sec) detectedSection = sec;
    return { text: "", detectedSection };
  }
  return { text: repairWorshipVocabulary(working), detectedSection };
}
function recoverSegmentsFromPartialJson(raw) {
  const cleaned = stripMarkdownJson(raw);
  const segKeyIdx = cleaned.search(/"segments"\s*:\s*\[/);
  if (segKeyIdx === -1) return [];
  const arrStart = cleaned.indexOf("[", segKeyIdx);
  if (arrStart === -1) return [];
  const out = [];
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escaped = false;
  for (let i = arrStart + 1; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const candidate = cleaned.slice(objStart, i + 1);
        objStart = -1;
        try {
          const parsed = JSON.parse(candidate);
          if (typeof parsed.text === "string" && parsed.text.trim().length > 0) {
            const { text: cleanText, detectedSection } = cleanLyricSegmentText(parsed.text);
            if (!cleanText) continue;
            const role = inferVocalRoleFromText(cleanText, parsed.vocalRole);
            const formattedText = role === "backing" ? formatLyricForVocalRole(cleanText, "backing") : cleanText;
            const s = parseFlexibleTimestamp(parsed.startTime) ?? parseFlexibleTimestamp(parsed.start) ?? out.length * 2.5;
            const e = parseFlexibleTimestamp(parsed.endTime) ?? parseFlexibleTimestamp(parsed.end) ?? s + 2.2;
            const safeEnd = Math.max(s + 0.35, e);
            const uncertainWords = Array.isArray(parsed.uncertainWords) ? parsed.uncertainWords.filter((w) => typeof w === "string") : void 0;
            const alignedWords = alignWordsToCleanText(
              formattedText,
              parsed.words,
              s,
              safeEnd,
              uncertainWords
            );
            const conf = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? parsed.confidence : void 0;
            const isUncertain = Boolean(parsed.uncertain) || conf !== void 0 && conf < 0.72 || Boolean(alignedWords?.some((w) => w.uncertain));
            out.push({
              lineIndex: out.length,
              text: formattedText,
              section: typeof parsed.section === "string" && parsed.section.trim() ? parsed.section : detectedSection || "verse",
              vocalRole: role,
              start: s,
              end: safeEnd,
              ...conf !== void 0 ? { confidence: conf } : {},
              ...isUncertain ? { uncertain: true } : {},
              ...uncertainWords && uncertainWords.length > 0 ? { uncertainWords } : {},
              ...alignedWords && alignedWords.length > 0 ? { words: alignedWords } : {}
            });
          }
        } catch {
        }
      }
    } else if (ch === "]" && depth === 0) {
      break;
    }
  }
  return out;
}
function normalizeAudioMimeType(mimeType, fileName) {
  const lower = (mimeType || "").toLowerCase().split(";")[0].trim();
  if (lower === "audio/mpeg" || lower === "audio/mp3" || lower === "audio/mpeg3") {
    return "audio/mp3";
  }
  if (lower === "audio/x-wav" || lower === "audio/wave" || lower === "audio/wav") {
    return "audio/wav";
  }
  if (lower === "audio/x-m4a" || lower === "audio/m4a" || lower === "audio/mp4") {
    return "audio/mp4";
  }
  if (lower === "audio/aac" || lower === "audio/ogg" || lower === "audio/flac" || lower === "audio/webm") {
    return lower;
  }
  const ext = (fileName || "").toLowerCase().split(".").pop() || "";
  if (ext === "mp3") return "audio/mp3";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a" || ext === "mp4") return "audio/mp4";
  if (ext === "aac") return "audio/aac";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "flac") return "audio/flac";
  if (ext === "webm") return "audio/webm";
  return "audio/wav";
}
function isNoVocalsTranscript(raw) {
  const cleaned = (raw || "").trim();
  if (!cleaned) return true;
  if (/^no[_\s-]*vocals?\.?$/i.test(cleaned)) return true;
  if (cleaned.length < 140 && /\b(no vocals|no singing|purely instrumental|instrumental only|no spoken words|no speech detected)\b/i.test(
    cleaned
  )) {
    return true;
  }
  return false;
}
function parseTranscriptToSegments(rawTranscript, totalDuration) {
  if (!rawTranscript || isNoVocalsTranscript(rawTranscript)) return [];
  const safeDur = Number.isFinite(totalDuration) && totalDuration > 0.5 ? totalDuration : 30;
  const rows = rawTranscript.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  let currentSection = "verse";
  const collected = [];
  for (const row of rows) {
    let explicitTime = null;
    let body = row;
    const lrcMatch = row.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (lrcMatch) {
      const mins = parseInt(lrcMatch[1], 10);
      const secs = parseInt(lrcMatch[2], 10);
      const frac = lrcMatch[3] ? parseInt(lrcMatch[3], 10) / Math.pow(10, lrcMatch[3].length) : 0;
      explicitTime = mins * 60 + secs + frac;
      body = (lrcMatch[4] || "").trim();
    }
    const { text: cleanText, detectedSection } = cleanLyricSegmentText(body);
    if (detectedSection) {
      currentSection = detectedSection;
    }
    if (!cleanText) {
      continue;
    }
    collected.push({ text: cleanText, section: currentSection, explicitTime });
  }
  if (collected.length === 0) return [];
  const hasExplicit = collected.filter((c) => c.explicitTime !== null).length >= Math.max(1, Math.floor(collected.length / 2));
  if (hasExplicit) {
    return collected.map((item, idx) => {
      const start = item.explicitTime ?? idx / collected.length * safeDur;
      const nextTime = collected[idx + 1]?.explicitTime;
      const end = nextTime !== null && nextTime !== void 0 ? Math.max(start + 0.35, Math.min(safeDur, nextTime - 0.05)) : Math.min(safeDur, start + Math.max(1.2, (safeDur - start) / Math.max(1, collected.length - idx)));
      return {
        lineIndex: idx,
        text: item.text,
        section: item.section,
        start: Number(Math.max(0, start).toFixed(2)),
        end: Number(Math.max(start + 0.35, end).toFixed(2))
      };
    });
  }
  const slot = safeDur / collected.length;
  return collected.map((item, idx) => {
    const start = Number((idx * slot).toFixed(2));
    const end = Number(Math.min(safeDur, (idx + 1) * slot - Math.min(0.08, slot * 0.1)).toFixed(2));
    return {
      lineIndex: idx,
      text: item.text,
      section: item.section,
      start,
      end: Math.max(Number((start + 0.35).toFixed(2)), end)
    };
  });
}
function alignWordsToCleanText(cleanText, rawWords, lineStart, lineEnd, uncertainWords) {
  const cleanTokens = cleanText.trim().split(/\s+/).filter(Boolean);
  if (cleanTokens.length === 0 || !Array.isArray(rawWords) || rawWords.length === 0) {
    return void 0;
  }
  const uncertainLookup = new Set(
    (uncertainWords ?? []).map((w) => normalizeMultilingualToken(w)).filter(Boolean)
  );
  const safeStart = Number.isFinite(lineStart) ? Math.max(0, lineStart) : 0;
  const safeEnd = Number.isFinite(lineEnd) ? Math.max(safeStart + 0.15, lineEnd) : safeStart + 1;
  const expanded = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  for (const rw of rawWords) {
    if (!rw || typeof rw.text !== "string") continue;
    const rawStr = rw.text.trim();
    if (!rawStr) continue;
    const opensParen = (rawStr.match(/\(/g) || []).length;
    const closesParen = (rawStr.match(/\)/g) || []).length;
    const opensBracket = (rawStr.match(/\[/g) || []).length;
    const closesBracket = (rawStr.match(/\]/g) || []).length;
    if (parenDepth > 0 || bracketDepth > 0 || rawStr.startsWith("(") || rawStr.startsWith("[")) {
      parenDepth = Math.max(0, parenDepth + opensParen - closesParen);
      bracketDepth = Math.max(0, bracketDepth + opensBracket - closesBracket);
      if (rawStr.startsWith("(") || rawStr.startsWith("[") || parenDepth > 0 || bracketDepth > 0 || rawStr.endsWith(")") || rawStr.endsWith("]")) {
        continue;
      }
    }
    const cleanedWord = stripOuterParentheses(cleanLyricSegmentText(rawStr).text);
    if (!cleanedWord) continue;
    const ws = parseFlexibleTimestamp(rw.startTime, safeEnd + 60) ?? parseFlexibleTimestamp(rw.start, safeEnd + 60);
    const we = parseFlexibleTimestamp(rw.endTime, safeEnd + 60) ?? parseFlexibleTimestamp(rw.end, safeEnd + 60);
    if (ws === null && we === null) continue;
    const wStart = ws ?? Math.max(safeStart, we - 0.25);
    const wEnd = we ?? Math.min(safeEnd, wStart + 0.25);
    const wConf = typeof rw.confidence === "number" && Number.isFinite(rw.confidence) ? rw.confidence : void 0;
    const wUncertain = Boolean(rw.uncertain) || wConf !== void 0 && wConf < 0.72;
    const subTokens = cleanedWord.split(/\s+/).filter(Boolean);
    if (subTokens.length === 1) {
      expanded.push({
        text: subTokens[0],
        start: wStart,
        end: Math.max(wStart + 0.03, wEnd),
        ...wConf !== void 0 ? { confidence: wConf } : {},
        ...wUncertain ? { uncertain: true } : {}
      });
    } else {
      const span = Math.max(0.06 * subTokens.length, wEnd - wStart);
      const step = span / subTokens.length;
      for (let k = 0; k < subTokens.length; k++) {
        expanded.push({
          text: subTokens[k],
          start: wStart + k * step,
          end: wStart + (k + 1) * step,
          ...wConf !== void 0 ? { confidence: wConf } : {},
          ...wUncertain ? { uncertain: true } : {}
        });
      }
    }
  }
  if (expanded.length !== cleanTokens.length && expanded.length > 0 && cleanTokens.length > 0) {
    const norm = (s) => normalizeMultilingualToken(s);
    const reconciled = [];
    let ei = 0;
    let failed = false;
    for (let ci = 0; ci < cleanTokens.length; ci++) {
      if (ei >= expanded.length) {
        failed = true;
        break;
      }
      const targetNorm = norm(cleanTokens[ci]);
      const cur = expanded[ei];
      if (norm(cur.text) === targetNorm || cleanTokens.length === expanded.length) {
        reconciled.push(cur);
        ei++;
      } else if (ei + 1 < expanded.length && norm(cur.text + expanded[ei + 1].text) === targetNorm) {
        const nextW = expanded[ei + 1];
        reconciled.push({
          text: cleanTokens[ci],
          start: cur.start,
          end: Math.max(cur.end, nextW.end),
          ...cur.confidence !== void 0 || nextW.confidence !== void 0 ? { confidence: Math.min(cur.confidence ?? 1, nextW.confidence ?? 1) } : {},
          ...cur.uncertain || nextW.uncertain ? { uncertain: true } : {}
        });
        ei += 2;
      } else if (Math.abs(expanded.length - cleanTokens.length) <= 1) {
        reconciled.push(cur);
        ei++;
      } else {
        failed = true;
        break;
      }
    }
    if (!failed && reconciled.length === cleanTokens.length) {
      expanded.splice(0, expanded.length, ...reconciled);
    }
  }
  if (expanded.length !== cleanTokens.length) {
    return void 0;
  }
  const minWordDur = Math.min(0.04, (safeEnd - safeStart) / cleanTokens.length * 0.5);
  const aligned = [];
  for (let i = 0; i < cleanTokens.length; i++) {
    const rawW = expanded[i];
    const prevStart = i > 0 ? aligned[i - 1].start + minWordDur : safeStart;
    const maxAllowedStart = safeEnd - (cleanTokens.length - i) * minWordDur;
    const wStart = Math.max(safeStart, prevStart, Math.min(maxAllowedStart, rawW.start));
    const nextCap = i < cleanTokens.length - 1 ? Math.max(wStart + minWordDur, expanded[i + 1].start) : safeEnd;
    const wEnd = Math.max(wStart + minWordDur, Math.min(safeEnd, nextCap, Math.max(wStart + minWordDur, rawW.end)));
    const tokenKey = normalizeMultilingualToken(cleanTokens[i]);
    const markedUncertain = rawW.uncertain || tokenKey.length > 0 && uncertainLookup.has(tokenKey);
    aligned.push({
      text: cleanTokens[i],
      start: Number(wStart.toFixed(3)),
      end: Number(wEnd.toFixed(3)),
      ...rawW.confidence !== void 0 ? { confidence: rawW.confidence } : {},
      ...markedUncertain ? { uncertain: true } : {}
    });
  }
  const coveredSpan = aligned[aligned.length - 1].end - aligned[0].start;
  const lineSpan = safeEnd - safeStart;
  if (cleanTokens.length >= 3 && lineSpan > 0.8 && coveredSpan < lineSpan * 0.25) {
    return void 0;
  }
  return aligned;
}

// server.ts
function formatClockTime(seconds) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  return `${String(mins).padStart(2, "0")}:${rem.toFixed(2).padStart(5, "0")}`;
}
var LANGUAGE_DIRECTIVES = {
  auto: "MULTILINGUAL AUTO-DETECTION & CODE-SWITCHING: Vocals may be sung in Swahili (Kiswahili), Shona (ChiShona), English, French (Fran\xE7ais), Lingala, Yoruba, isiZulu, isiXhosa, isiNdebele, Luganda, Chichewa, Portuguese, Spanish, Arabic, Amharic, Hindi, Korean, Japanese, Chinese, or a MIX of languages in the same song or verse. Transcribe EVERY phrase verbatim in the exact language and standard script/orthography sung (e.g. French accents \xE9/\xE8/\xEA/\xE0/\xE7 & elisions like l'amour/c'est; Swahili words like Ametenda amani, Haleluya, Mungu, Nakushukuru; Shona words like Ndinotenda, Mutsvene, Mwari, Ishe, Ngakudzweni, Zvakanaka). NEVER translate lyrics into English and NEVER replace non-English words with English sound-alikes.",
  sw: 'PRIMARY LANGUAGE \u2014 SWAHILI (KISWAHILI): Transcribe verbatim in authentic standard Kiswahili orthography (e.g. "Bwana Yesu", "Ametenda amani", "Haleluya", "Nakushukuru", "Umeinuliwa", "Mungu mwema", "Milele na milele"), preserving full agglutinative Bantu prefixes (a-me-tenda, ni-na-ku-shukuru, u-me-inuliwa) cleanly as whole words without breaking prefixes apart. If any verse switches into English, Shona, Lingala, or French, preserve those exact sung words without translating.',
  sn: 'PRIMARY LANGUAGE \u2014 SHONA (CHISHONA): Transcribe verbatim in authentic standard ChiShona orthography (e.g. "Ndinotenda", "Mutsvene", "Mwari", "Ishe Jesu", "Ngakudzweni", "Zvakanaka", "Chokwadi", "Huya Mweya", "Mbiri kuna Mwari"). Preserve Shona prenasalized/digraph consonants (mb, nd, ng, nh, mh, sv, zv, tsv, dzv, pf, bh, vh, dh, ch, sh) accurately \u2014 NEVER alter Shona words into English or Swahili look-alikes. Preserve any English/Swahili/French code-switching verbatim.',
  en: "PRIMARY LANGUAGE \u2014 ENGLISH: Transcribe verbatim in natural English orthography (preserving contractions like You're, I'll, Don't). If the song mixes in non-English phrases (e.g. Swahili, Shona, French, Hebrew/Aramaic worship names), keep those original phrases verbatim without translating.",
  fr: "PRIMARY LANGUAGE \u2014 FRENCH (FRAN\xC7AIS): Transcribe verbatim in standard French orthography with proper diacritics (\xE9, \xE8, \xEA, \xEB, \xE0, \xE2, \xE7, \xEE, \xEF, \xF4, \xF9, \xFB, \u0153) and authentic elisions/apostrophes (l'amour, c'est, j'ai, d'or, qu'il, s'il, n'est, aujourd'hui). Preserve any English or African-language code-switching verbatim without translating.",
  ln: 'PRIMARY LANGUAGE \u2014 LINGALA: Transcribe verbatim in authentic Lingala orthography (e.g. "Nzambe", "Nkolo Yesu", "Matondo", "Kembo", "Bolingo", "Lokumu") and preserve any French/Swahili/English code-switching verbatim.',
  yo: 'PRIMARY LANGUAGE \u2014 YORUBA: Transcribe verbatim in Yoruba orthography (preserving e/\u1EB9, o/\u1ECD, s/\u1E63 and tonal marks when clear, e.g. "Oluwa", "Baba", "Oba", "Ese", "Kabiyesi") alongside any English code-switching.',
  zu: "PRIMARY LANGUAGE \u2014 ISIZULU: Transcribe verbatim in standard isiZulu orthography (preserving clicks c/q/x and clusters hl/dl/kh/ph/th/ngc/nkc) without translating.",
  xh: "PRIMARY LANGUAGE \u2014 ISIXHOSA: Transcribe verbatim in standard isiXhosa orthography (preserving clicks c/q/x and clusters xh/gx/nx/bh/dl/hl) without translating.",
  nd: "PRIMARY LANGUAGE \u2014 ISINDEBELE: Transcribe verbatim in standard isiNdebele orthography alongside any Shona/English phrases without translating.",
  lg: 'PRIMARY LANGUAGE \u2014 LUGANDA: Transcribe verbatim in standard Luganda orthography (e.g. "Mukama", "Katonda", "Webale", "Yesu") without translating.',
  ny: 'PRIMARY LANGUAGE \u2014 CHICHEWA: Transcribe verbatim in standard Chichewa orthography (e.g. "Mulungu", "Ambuye", "Zikomo", "Yesu") without translating.',
  pt: "PRIMARY LANGUAGE \u2014 PORTUGUESE: Transcribe verbatim in Portuguese with proper diacritics (\xE3, \xF5, \xE7, \xE1, \xE9, \xED, \xF3, \xFA, \xE2, \xEA, \xF4).",
  es: "PRIMARY LANGUAGE \u2014 SPANISH: Transcribe verbatim in Spanish with proper diacritics and punctuation (\xF1, \xE1, \xE9, \xED, \xF3, \xFA, \xFC).",
  ar: "PRIMARY LANGUAGE \u2014 ARABIC (\u0627\u0644\u0639\u0631\u0628\u064A\u0629): Transcribe verbatim in natural Arabic script (\u0627\u0644\u0639\u0631\u0628\u064A\u0629), never romanizing unless English words are explicitly sung.",
  am: "PRIMARY LANGUAGE \u2014 AMHARIC (\u12A0\u121B\u122D\u129B): Transcribe verbatim in native Ge'ez/Amharic Fidel script (\u12A0\u121B\u122D\u129B), never romanizing unless English is sung.",
  hi: "PRIMARY LANGUAGE \u2014 HINDI (\u0939\u093F\u0928\u094D\u0926\u0940): Transcribe verbatim in standard Devanagari Hindi script (\u0939\u093F\u0928\u094D\u0926\u0940) or Hinglish only where English words are actually sung.",
  ko: "PRIMARY LANGUAGE \u2014 KOREAN (\uD55C\uAD6D\uC5B4): Transcribe verbatim in standard Hangul script (\uD55C\uAD6D\uC5B4), preserving any sung English phrases verbatim.",
  ja: "PRIMARY LANGUAGE \u2014 JAPANESE (\u65E5\u672C\u8A9E): Transcribe verbatim in natural Japanese script (Kanji/Hiragana/Katakana), preserving any sung English phrases verbatim.",
  zh: "PRIMARY LANGUAGE \u2014 CHINESE (\u4E2D\u6587): Transcribe verbatim in natural Chinese characters (\u4E2D\u6587), preserving any sung English phrases verbatim."
};
function buildLanguageDirective(language) {
  const code = typeof language === "string" ? language.trim().toLowerCase() : "auto";
  return LANGUAGE_DIRECTIVES[code] || LANGUAGE_DIRECTIVES.auto;
}
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
function isQuotaOrRateLimitError(err) {
  const raw = err instanceof Error ? err.message : String(err || "");
  return raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED") || /quota|rate.?limit/i.test(raw);
}
function isAbortOrTimeoutError(err) {
  if (typeof err === "object" && err !== null && err.name === "AbortError") {
    return true;
  }
  const raw = err instanceof Error ? err.message : String(err || "");
  return /aborted|abort|timed out|timeout|ETIMEDOUT/i.test(raw);
}
function formatGeminiError(err) {
  const raw = err instanceof Error ? err.message : String(err || "Request failed");
  if (isQuotaOrRateLimitError(err)) {
    return "Transcription quota limit reached. Try again shortly, or paste/import lyrics manually.";
  }
  if (isAbortOrTimeoutError(err)) {
    return "Transcription request timed out on this audio segment. Retrying or using manual paste is available.";
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error?.message) {
      return parsed.error.message.split("\n")[0];
    }
  } catch {
  }
  return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw;
}
var PORT = Number(process.env.PORT) || 3e3;
var LIBRARY_MANIFEST = {
  catalogVersion: "2026.11.1",
  checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
  packs: [
    {
      id: "pack_worship_typography",
      title: "Sanctuary & Acoustic Editorial Pack",
      category: "typography-collections",
      version: "1.2.0",
      description: "Refined serif and humanist typography pairings calibrated for worship, gospel, and acoustic live sessions.",
      itemCount: 3,
      updatedAt: "2026-11-01",
      sizeLabel: "14 KB"
    },
    {
      id: "pack_kinetic_transitions",
      title: "Broadcast Kinetic Transitions",
      category: "animation-presets",
      version: "1.4.0",
      description: "Smooth line crossfades, word-by-word reveals, and stage karaoke cue presets.",
      itemCount: 3,
      updatedAt: "2026-11-05",
      sizeLabel: "11 KB"
    },
    {
      id: "pack_stage_gradients",
      title: "Stage Lighting & Gradient Backdrops",
      category: "background-templates",
      version: "1.1.0",
      description: "High-contrast obsidian, tungsten amber, and deep slate background templates with tuned scrims.",
      itemCount: 3,
      updatedAt: "2026-10-28",
      sizeLabel: "9 KB"
    },
    {
      id: "pack_pro_editing_styles",
      title: "Production Editing Presets",
      category: "editing-presets",
      version: "1.3.0",
      description: "Complete typography + auto-effect + legibility bundles ready for 16:9, 9:16, and 1:1 release.",
      itemCount: 3,
      updatedAt: "2026-11-09",
      sizeLabel: "12 KB"
    }
  ]
};
var LIBRARY_PACKS = {
  pack_worship_typography: {
    id: "pack_worship_typography",
    version: "1.2.0",
    category: "typography-collections",
    title: "Sanctuary & Acoustic Editorial Pack",
    presets: [
      {
        id: "pre_cathedral_serif",
        name: "Cathedral Serif",
        subtitle: "Cormorant Garamond \xB7 Warm Ivory \xB7 Soft Drop Shadow",
        typography: {
          fontFamily: "Cormorant Garamond",
          fontSize: 68,
          fontWeight: 600,
          color: "#FAF7F0",
          highlightColor: "#F59E0B",
          letterSpacing: 1,
          lineSpacing: 1.32,
          shadowBlur: 20,
          outlineWidth: 0
        }
      },
      {
        id: "pre_gospel_classic",
        name: "Gospel Heritage",
        subtitle: "Playfair Display \xB7 Crisp White \xB7 Gold Highlight",
        typography: {
          fontFamily: "Playfair Display",
          fontSize: 62,
          fontWeight: 600,
          color: "#FFFFFF",
          highlightColor: "#FBBF24",
          letterSpacing: 0.4,
          lineSpacing: 1.3,
          shadowBlur: 18
        }
      },
      {
        id: "pre_hymnal_cinzel",
        name: "Sanctuary Inscription",
        subtitle: "Cinzel \xB7 Measured Tracking \xB7 Subtle Scrim",
        typography: {
          fontFamily: "Cinzel",
          fontSize: 54,
          fontWeight: 600,
          color: "#F8FAFC",
          highlightColor: "#F59E0B",
          letterSpacing: 2.2,
          lineSpacing: 1.38
        }
      }
    ]
  },
  pack_kinetic_transitions: {
    id: "pack_kinetic_transitions",
    version: "1.4.0",
    category: "animation-presets",
    title: "Broadcast Kinetic Transitions",
    presets: [
      {
        id: "pre_worship_flow",
        name: "Worship Serene Flow",
        subtitle: "Auto-assigns smooth fades on verses & karaoke on choruses",
        autoEffectStyle: "worship-serene",
        effect: "line-crossfade"
      },
      {
        id: "pre_contemporary_lift",
        name: "Contemporary Lift",
        subtitle: "Upward slide settle paired with word-by-word choruses",
        autoEffectStyle: "contemporary-clean",
        effect: "slide-up"
      },
      {
        id: "pre_stage_karaoke",
        name: "Stage Karaoke Precision",
        subtitle: "High-visibility word fill synced to vocal syllables",
        autoEffectStyle: "dynamic-stage",
        effect: "karaoke"
      }
    ]
  },
  pack_stage_gradients: {
    id: "pack_stage_gradients",
    version: "1.1.0",
    category: "background-templates",
    title: "Stage Lighting & Gradient Backdrops",
    presets: [
      {
        id: "pre_bg_tungsten",
        name: "Tungsten Stage Mist",
        subtitle: "Dark charcoal stage spotlight backdrop",
        background: {
          type: "template",
          templateId: "stage-amber",
          dimOverlay: 0.25,
          blur: 0,
          scale: 1
        }
      },
      {
        id: "pre_bg_twilight",
        name: "Midnight Coastal Dusk",
        subtitle: "Deep indigo twilight over calm horizon",
        background: {
          type: "template",
          templateId: "midnight-velvet",
          dimOverlay: 0.2,
          blur: 0,
          scale: 1
        }
      },
      {
        id: "pre_bg_amber_grad",
        name: "Warm Obsidian Gradient",
        subtitle: "Soft espresso-to-charcoal directional gradient",
        background: {
          type: "gradient",
          gradientFrom: "#12100E",
          gradientTo: "#2E2319",
          gradientAngle: 150,
          dimOverlay: 0.12,
          blur: 0
        }
      }
    ]
  },
  pack_pro_editing_styles: {
    id: "pack_pro_editing_styles",
    version: "1.3.0",
    category: "editing-presets",
    title: "Production Editing Presets",
    presets: [
      {
        id: "pre_edit_lyric_single",
        name: "Contemporary Single Release",
        subtitle: "Plus Jakarta Sans \xB7 Progressive Wipe \xB7 Midnight Horizon",
        autoEffectStyle: "contemporary-clean",
        typography: {
          fontFamily: "Plus Jakarta Sans",
          fontSize: 60,
          fontWeight: 700,
          color: "#F8FAFC",
          highlightColor: "#38BDF8",
          letterSpacing: -0.5,
          backgroundOpacity: 0
        },
        background: {
          type: "template",
          templateId: "midnight-velvet",
          dimOverlay: 0.24
        }
      },
      {
        id: "pre_edit_lower_third",
        name: "Broadcast Lower-Third Caption",
        subtitle: "IBM Plex Sans \xB7 Backing Box \xB7 High Legibility",
        autoEffectStyle: "minimal-editorial",
        typography: {
          fontFamily: "IBM Plex Sans",
          fontSize: 48,
          fontWeight: 600,
          color: "#FFFFFF",
          highlightColor: "#60A5FA",
          positionX: 0.5,
          positionY: 0.8,
          backgroundColor: "#0B0D10",
          backgroundOpacity: 0.72,
          backgroundPadding: 18
        }
      },
      {
        id: "pre_edit_bold_stage",
        name: "Arena Stage Bold",
        subtitle: "Oswald \xB7 Crisp Outline \xB7 High Contrast Karaoke",
        autoEffectStyle: "dynamic-stage",
        typography: {
          fontFamily: "Oswald",
          fontSize: 74,
          fontWeight: 600,
          color: "#FFFFFF",
          highlightColor: "#F59E0B",
          letterSpacing: 1.5,
          outlineWidth: 2,
          outlineColor: "#090A0C",
          backgroundOpacity: 0,
          positionY: 0.5
        }
      }
    ]
  }
};
async function startServer() {
  const app = express();
  app.use(express.json({ limit: "48mb" }));
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/library/manifest", (_req, res) => {
    res.json(LIBRARY_MANIFEST);
  });
  app.get("/api/library/pack/:packId", (req, res) => {
    const pack = LIBRARY_PACKS[req.params.packId];
    if (!pack) {
      return res.status(404).json({ error: "Library pack not found" });
    }
    return res.json(pack);
  });
  const modelCooldownUntil = /* @__PURE__ */ new Map();
  function isModelReady(modelId) {
    const until = modelCooldownUntil.get(modelId) ?? 0;
    return Date.now() >= until;
  }
  function markModelFailure(modelId, err) {
    if (isQuotaOrRateLimitError(err)) {
      modelCooldownUntil.set(modelId, Date.now() + 2e4);
    }
  }
  function createAttemptSignal(timeoutMs, isClientClosed, onClientCloseRegister) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`Model call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const unregister = onClientCloseRegister(() => {
      controller.abort(new Error("Client disconnected"));
    });
    if (isClientClosed()) {
      controller.abort(new Error("Client disconnected"));
    }
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
        unregister();
      }
    };
  }
  app.post("/api/sync-lyrics", async (req, res) => {
    req.setTimeout(5 * 6e4);
    res.setTimeout(5 * 6e4);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
      return res.status(200).json({
        available: false,
        errorCode: "MISSING_API_KEY",
        reason: "Server vocal alignment key is not configured; using local acoustic alignment."
      });
    }
    let clientClosed = false;
    const closeListeners = /* @__PURE__ */ new Set();
    res.on("close", () => {
      if (!res.writableFinished) {
        clientClosed = true;
        closeListeners.forEach((cb) => cb());
      }
    });
    const onClientClose = (cb) => {
      closeListeners.add(cb);
      return () => closeListeners.delete(cb);
    };
    try {
      const { audioBase64, mimeType, duration, lines, isWindowedClip, clipStartSec, language } = req.body;
      if (!audioBase64 || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({
          available: false,
          reason: "Missing audio payload or lyric lines."
        });
      }
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          timeout: 12e4,
          headers: {
            "User-Agent": "aistudio-build"
          }
        }
      });
      const normalizedMime = normalizeAudioMimeType(mimeType);
      const safeDuration = Number.isFinite(duration) && (duration ?? 0) > 0 ? duration : 30;
      const totalClock = formatClockTime(safeDuration);
      const lineList = lines.map((l) => `${l.index}: ${l.text}`).join("\n");
      const languageDirective = buildLanguageDirective(language);
      const clipOffsetLabel = isWindowedClip && Number.isFinite(clipStartSec) ? ` (clip starting at track position ${formatClockTime(clipStartSec)})` : "";
      const syncSystemInstruction = isWindowedClip ? `You are a precision multilingual vocal-to-lyric forced alignment engine. You are given a specific audio clip from a longer track and candidate numbered lyric lines (which may be in Swahili, Shona, English, French, or any world/mixed language, and may include Lead, Backing, Choir, or Ad-lib cues). Align ONLY the numbered candidate lines that are actually sung inside THIS audio clip using clip-relative timestamps from 00:00.00 to the clip end. Anchor startTime at the very first audible consonant, breath pickup, or vowel onset, and hold endTime through the COMPLETE vocal decay of held notes and sustained vowels (Eeeeeh, Ooooooh, Ahhhhh)\u2014NEVER end early while the singer is still sustaining a note.
${languageDirective}` : `You are a precision multilingual vocal-to-lyric forced alignment engine for sung worship and studio music in any language (including Swahili, Shona, English, French, African, European, Arabic, Asian, and mixed-language songs, up to 10 minutes). Align every provided line index (0-based) to exact hundredth-of-a-second clock timestamps (MM:SS.cc and decimal seconds). Anchor startTime right at the very first audible consonant, breath pickup, or vowel onset, and hold endTime until the singer completely finishes pronouncing the final syllable or sustained vowel note (Eeeeeh, Ooooooh, Ahhhhh)\u2014NEVER cut off early while singing continues. Allow simultaneous overlapping lead and backing/choir lines to share overlapping timestamps when sung together.
${languageDirective}`;
      const promptText = isWindowedClip ? `Clip duration: ${safeDuration.toFixed(2)} seconds (${totalClock})${clipOffsetLabel}.
${languageDirective}
Listen carefully to every sung vocal line, consonant, backing echo, and sustained vowel inside THIS clip from 00:00.00 to ${totalClock}.
Some candidate lines below may occur before or after this clip window \u2014 align ONLY the candidate line indices you actually hear sung in THIS clip, using timestamps relative to the start of THIS clip (0.00 to ${safeDuration.toFixed(2)}). Omit lines not sung in this clip.
If a backing vocal line overlaps a lead vocal line, give each line its own true start and end times even when they overlap.
Provide BOTH:
- "startTime" and "endTime" in "MM:SS.cc" format relative to clip start (e.g. "00:14.28")
- "start" and "end" in decimal seconds relative to clip start (0.00 to ${safeDuration.toFixed(2)})
Also provide accurate word-level start/end times in clip-relative seconds, holding each word until the singer finishes pronouncing or sustaining it, and keep each word's "text" faithful to the candidate line spelling/script.
Only set "vocalsDetected" to false if this clip has zero sung lyrics matching any candidate line.

Candidate lyric lines (keep exact 0-based lineIndex):
${lineList}` : `Audio duration: ${safeDuration.toFixed(2)} seconds (${totalClock}).
${languageDirective}
Listen carefully to lead vocals, backing vocals, choir harmonies, ad-libs, and sustained vowel notes ("Eeeeeh", "Ooooooh", "Ahhhhh", "Mmmmm") across the entire duration from 00:00 to ${totalClock}.
Align EVERY numbered lyric line below (${lines.length} lines, indices 0 to ${lines.length - 1}) to the exact instant the first sound of that line begins AND hold endTime until the complete vocal pronunciation or held vowel fades out (never cut off held notes early). Preserve overlapping timestamps when lead and backing/choir vocals overlap.
Provide BOTH:
- "startTime" and "endTime" in "MM:SS.cc" format (e.g. "00:14.28", hundredths of a second)
- "start" and "end" in decimal seconds (e.g. 14.28)
Also provide word-level start/end times in seconds matching each candidate line's words/script, keeping each word active throughout its full sung duration.
Only set "vocalsDetected" to false if the audio has zero vocals matching these lyrics.

Lyric lines (0-based index):
${lineList}`;
      const candidates = ["gemini-4-hydrogen", "gemini-3.1-flash-lite"].filter(isModelReady);
      const modelOrder = candidates.length > 0 ? candidates : ["gemini-4-hydrogen", "gemini-3.1-flash-lite"];
      let responseText = "";
      let lastErrorMsg = null;
      let sawQuotaError = false;
      for (const modelId of modelOrder) {
        if (clientClosed) break;
        const attempt = createAttemptSignal(85e3, () => clientClosed, onClientClose);
        try {
          const response = await ai.models.generateContent({
            model: modelId,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: normalizedMime,
                    data: audioBase64
                  }
                },
                { text: promptText }
              ]
            },
            config: {
              abortSignal: attempt.signal,
              systemInstruction: syncSystemInstruction,
              thinkingConfig: {
                thinkingLevel: modelId === "gemini-4-hydrogen" ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL
              },
              maxOutputTokens: 16384,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  vocalsDetected: { type: Type.BOOLEAN },
                  notes: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  },
                  segments: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        lineIndex: { type: Type.INTEGER },
                        startTime: { type: Type.STRING },
                        endTime: { type: Type.STRING },
                        start: { type: Type.NUMBER },
                        end: { type: Type.NUMBER },
                        words: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              text: { type: Type.STRING },
                              start: { type: Type.NUMBER },
                              end: { type: Type.NUMBER }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          });
          responseText = response.text ?? "{}";
          lastErrorMsg = null;
          sawQuotaError = false;
          break;
        } catch (err) {
          if (clientClosed) break;
          markModelFailure(modelId, err);
          if (isQuotaOrRateLimitError(err)) sawQuotaError = true;
          lastErrorMsg = formatGeminiError(err);
          console.warn(`[sync-lyrics] ${modelId} alignment fallback:`, lastErrorMsg);
        } finally {
          attempt.cleanup();
        }
      }
      if (clientClosed) return;
      if (lastErrorMsg !== null) {
        console.warn("[sync-lyrics] All alignment models failed:", lastErrorMsg);
        return res.status(200).json({
          available: false,
          errorCode: sawQuotaError ? "QUOTA_EXHAUSTED" : "MODEL_ERROR",
          reason: `Online alignment unavailable (${lastErrorMsg}); falling back to local acoustic analysis.`
        });
      }
      const parsed = safeParseJson(responseText) ?? {};
      const rawSegs = Array.isArray(parsed.segments) ? parsed.segments : [];
      const cleanSegments = rawSegs.filter((s) => typeof s.lineIndex === "number").map((s) => {
        const idx = s.lineIndex;
        const fallbackStart = idx / Math.max(1, lines.length) * safeDuration;
        const { start, end } = resolveSegmentTiming(
          s,
          fallbackStart,
          fallbackStart + 2,
          safeDuration
        );
        const cleanWords = Array.isArray(s.words) ? s.words.filter((w) => typeof w.text === "string" && w.text.trim().length > 0).map((w) => {
          const ws = parseFlexibleTimestamp(w.start) ?? start;
          const we = parseFlexibleTimestamp(w.end) ?? Math.min(end, ws + 0.35);
          return {
            text: w.text.trim(),
            start: Number(Math.max(start, Math.min(end - 0.04, ws)).toFixed(3)),
            end: Number(Math.max(start + 0.04, Math.min(end, we)).toFixed(3))
          };
        }) : void 0;
        return {
          lineIndex: idx,
          start,
          end,
          ...cleanWords && cleanWords.length > 0 ? { words: cleanWords } : {}
        };
      });
      return res.json({
        available: true,
        vocalsDetected: Boolean(parsed.vocalsDetected),
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        segments: cleanSegments
      });
    } catch (err) {
      const message = formatGeminiError(err);
      console.warn("[sync-lyrics] Gemini alignment error:", message);
      return res.status(200).json({
        available: false,
        reason: `Online alignment unavailable (${message}); falling back to local acoustic analysis.`
      });
    }
  });
  app.post("/api/transcribe-lyrics", async (req, res) => {
    req.setTimeout(5 * 6e4);
    res.setTimeout(5 * 6e4);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
      return res.status(200).json({
        available: false,
        errorCode: "MISSING_API_KEY",
        reason: "Auto Transcribe requires GEMINI_API_KEY in Settings > Secrets, or paste/import lyrics manually."
      });
    }
    let clientClosed = false;
    const closeListeners = /* @__PURE__ */ new Set();
    res.on("close", () => {
      if (!res.writableFinished) {
        clientClosed = true;
        closeListeners.forEach((cb) => cb());
      }
    });
    const onClientClose = (cb) => {
      closeListeners.add(cb);
      return () => closeListeners.delete(cb);
    };
    try {
      const { audioBase64, mimeType, duration, language } = req.body;
      const languageDirective = buildLanguageDirective(language);
      if (!audioBase64) {
        return res.status(400).json({
          available: false,
          reason: "Missing audio payload."
        });
      }
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          timeout: 12e4,
          headers: {
            "User-Agent": "aistudio-build"
          }
        }
      });
      const normalizedMime = normalizeAudioMimeType(mimeType);
      const audioPart = {
        inlineData: {
          mimeType: normalizedMime,
          data: audioBase64
        }
      };
      const safeDuration = Number.isFinite(duration) && (duration ?? 0) > 0 ? duration : 30;
      const isPromptEcho = (text) => /^(listen carefully|audio duration:|transcribed lyrics:|no_vocals\b|total duration:|you are an expert)/i.test(
        text.trim()
      );
      const totalClock = formatClockTime(safeDuration);
      const singlePassSystemInstruction = `You are a precision multilingual verbatim vocal transcriber, vocal-role separator, and word-level lyric aligner specializing in Swahili, Shona, English, French, Gospel/African & contemporary worship, and world studio music.
LANGUAGE & ORTHOGRAPHY RULE:
${languageDirective}
CRITICAL ACCURACY RULES:
1. Preserve Gospel & worship names accurately: Jireh, Jehovah, Yahweh, Hallelujah (or Swahili "Haleluya" when sung as Haleluya), Hosanna, Elohim, Adonai \u2014 NEVER substitute unrelated sound-alike English words for Swahili, Shona, French, or other non-English vocals.
2. NEVER skip short pickup words in ANY language ("I", "you", "the", "a", "and", "na", "wa", "ya", "kwa", "ne", "ku", "et", "le", "la", "de", "un"), repeated choruses, or sustained vowel vocalizations ("Eeeeeh", "Ooooooh", "Ahhhhh", "Mmmmm", "Woooh").
3. IGNORE BRIEF 1\u20132 WORD LEADER INTERJECTIONS OVER BACKING/CHOIR VOCALS: When backing vocals or the choir are singing a phrase and the lead singer cuts in with a short 1- or 2-word interjection, hype call, or spoken filler (e.g. "Come on", "Sing", "Yes Lord", "Amen", "Yeah", "Haya", "Piga makofi", "Allez", "Chantez"), DO NOT write or emit that 1\u20132 word interjection\u2014keep ONLY the backing/choir sung lyrics.
4. NO SECONDARY SMALL BACKING ECHO LINES UNDERNEATH: Do NOT emit separate "backing" vocal echo segments underneath main lead or choir lyrics (e.g. do not output an extra backing line "(Jireh)" / "Jireh" below "Your Jireh"). Only output primary sung phrases with vocalRole "lead" or "choir". When choir/backing carries the main sung verse or chorus on their own, tag that main phrase as "choir" (or "lead") so it displays cleanly.
5. NEVER SPLIT OR DUPLICATE PARTIAL WORDS / FALSE STARTS BEFORE A SENTENCE: When a singer articulates or sustains the opening word of a phrase (especially Swahili/Shona/Bantu agglutinative words like "Ametenda amani", "Nakushukuru", "Umeinuliwa", "Ndinotenda", "Ngakudzweni"), NEVER output a broken half-word or near-duplicate cue right before the full sentence (e.g. NEVER emit "amtenda" as one segment and then "ametenda amani" as a second segment). Output ONE complete, clean segment "Ametenda amani" spanning the entire vocal onset through its full release.
6. NEVER silently discard low-confidence or quiet main words\u2014transcribe your best phonetic reading in the sung language and mark confidence (< 0.72) plus uncertain: true / uncertainWords.
7. SENTENCE & PHRASE BOUNDARY INTEGRITY: Group words ONLY by complete sung sentences, natural musical clauses, or vocal breaths (ideally 3 to 9 words so each cue fits in 1\u20132 lines on screen). NEVER split a spoken/sung clause mid-sentence or move the last word(s) of one sung sentence into the start of the next segment, and NEVER pull the opening word of the next sentence onto the end of the previous segment. Every word in "words" must belong strictly to the phrase actually sung between [start, end].
8. FULL PRONUNCIATION HOLD: Anchor start at the first audible consonant/vowel onset and hold segment "end"/"endTime" and the final word's "end" +0.15s\u20130.25s AFTER the singer finishes pronouncing the trailing syllable, final consonant, or sustained vowel note (NEVER cut off mid-word).
9. NEVER put parentheses (...) or square brackets [...] anywhere inside "text" (no "(Jireh)", no inline "(yeah)", no "[Intro]", no "[Chorus]")\u2014put section labels only in "section" and vocal role in "vocalRole". Return valid JSON matching the schema.`;
      const isLongSong = safeDuration > 240;
      const longSongInstructions = isLongSong ? `
CRITICAL WARNING FOR LONG SONGS (${safeDuration.toFixed(1)}s / ${totalClock}): This is an extended live worship / song track with extended vamps, choir swells, and repeated choruses up to ${totalClock}. DO NOT stop early. Continue transcribing every main lead phrase, main choir line, and sustained vowel all the way until ${totalClock} (still omitting 1\u20132 word leader interjections over choir/backing vocals and omitting secondary backing echoes underneath main lines).` : "";
      const singlePassPrompt = `Total audio duration: ${safeDuration.toFixed(2)} seconds (${totalClock}).
${languageDirective}
Listen phonetically across the entire audio clip from 00:00.00 to ${totalClock}.
Transcribe audible main lead lyrics, main choir sections, repeated phrases, Gospel/worship names (Jireh, Jehovah, Yahweh, Hallelujah/Haleluya, Hosanna, Elohim, Adonai), and sustained vocalizations ("Eeeeeh", "Ooooooh", "Ahhhhh", "Mmmmm") in the authentic language(s) sung (preserving French accents & apostrophes, Swahili, Shona, English, etc.).
DO NOT translate lyrics to English or distort Swahili/Shona/French words into English words.
DO NOT split a single sung word or sentence into a clipped fragment followed by the full sentence (e.g. NEVER emit "amtenda" separately before "ametenda amani" \u2014 keep ONLY one complete cue "ametenda amani" covering the whole start-to-finish duration).
DO NOT transcribe brief 1\u20132 word lead interjections or hype calls when the leader cuts into backing/choir singing (e.g. "Come on", "Sing", "Amen", "Yes Lord", "Yeah", "Haya", "Allez")\u2014keep the main choir/backing phrase instead.
DO NOT emit separate lower/secondary backing-vocal echo lines underneath main lyrics; keep primary sung lyrics cleanly in "lead" or "choir".
NEVER omit quiet main words\u2014include them and set "confidence" below 0.7 and "uncertain": true (and list unclear words in "uncertainWords").
Keep each segment aligned to a complete sung clause/breath (1\u20132 readable lines max); NEVER push trailing words from one sung sentence into the next segment.
For each segment provide:
- "text": actual sung words cleanly in the authentic language/script with ZERO parentheses (...) or brackets [...]
- "section": one of "intro", "verse", "pre-chorus", "chorus", "bridge", "outro"
- "vocalRole": primarily "lead" or "choir"
- "confidence": number 0.0 to 1.0 reflecting transcription certainty
- "uncertain": boolean (true if any word in this line is unclear/quiet/ambiguous)
- "uncertainWords": array of specific unclear words in "text" (empty array if clear)
- "startTime": exact start clock time "MM:SS.cc" at first audible vocal onset
- "endTime": exact end clock time "MM:SS.cc" ~0.2s AFTER complete decay of final consonant or held note
- "start": numeric start in seconds (0.00 to ${safeDuration.toFixed(2)})
- "end": numeric end in seconds (holding ~0.2s past complete vocal pronunciation release, up to ${safeDuration.toFixed(2)})
- "words": array matching "text" tokens in exact order, each { "text": string, "start": number, "end": number, "confidence": number, "uncertain": boolean }
Only set "vocalsDetected" to false with empty "segments" if the entire recording is purely instrumental.${longSongInstructions}`;
      const singlePassModels = ["gemini-4-hydrogen", "gemini-3.1-flash-lite"].filter(isModelReady);
      const modelOrder = singlePassModels.length > 0 ? singlePassModels : ["gemini-4-hydrogen", "gemini-3.1-flash-lite"];
      let segments = [];
      let timingSource = "aligned";
      let confirmedInstrumental = false;
      let blockedReason = null;
      let lastErrMsg = null;
      let sawQuotaError = false;
      let sawTimeoutError = false;
      const segmentSchemaProperties = {
        text: { type: Type.STRING },
        section: { type: Type.STRING },
        vocalRole: { type: Type.STRING },
        confidence: { type: Type.NUMBER },
        uncertain: { type: Type.BOOLEAN },
        uncertainWords: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        },
        startTime: { type: Type.STRING },
        endTime: { type: Type.STRING },
        start: { type: Type.NUMBER },
        end: { type: Type.NUMBER },
        words: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              start: { type: Type.NUMBER },
              end: { type: Type.NUMBER },
              confidence: { type: Type.NUMBER },
              uncertain: { type: Type.BOOLEAN }
            }
          }
        }
      };
      const runSinglePassAttempt = async (modelId) => {
        const attempt = createAttemptSignal(8e4, () => clientClosed, onClientClose);
        try {
          const response = await ai.models.generateContent({
            model: modelId,
            contents: {
              parts: [audioPart, { text: singlePassPrompt }]
            },
            config: {
              abortSignal: attempt.signal,
              systemInstruction: singlePassSystemInstruction,
              thinkingConfig: {
                thinkingLevel: modelId === "gemini-4-hydrogen" ? ThinkingLevel.MEDIUM : ThinkingLevel.MINIMAL
              },
              maxOutputTokens: 16384,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  vocalsDetected: { type: Type.BOOLEAN },
                  segments: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: segmentSchemaProperties
                    }
                  }
                }
              }
            }
          });
          const finishReason = String(response.candidates?.[0]?.finishReason || "");
          const rawJson = (response.text ?? "").trim();
          if (!rawJson && (finishReason === "RECITATION" || finishReason === "SAFETY")) {
            blockedReason = finishReason === "RECITATION" ? "Audio transcription was blocked by content recitation policy for this commercial track. Paste or import lyrics manually, then click Sync." : "Audio transcription was blocked by safety policy on this recording. Paste or import lyrics manually.";
            return false;
          }
          const parsed = safeParseJson(rawJson);
          let candidateSegs = Array.isArray(parsed?.segments) ? parsed.segments : [];
          if (candidateSegs.length === 0 && rawJson) {
            candidateSegs = recoverSegmentsFromPartialJson(rawJson);
          }
          segments = candidateSegs.map((s) => {
            if (typeof s.text !== "string") return null;
            const { text: cleanedText, detectedSection } = cleanLyricSegmentText(s.text);
            if (!cleanedText || isPromptEcho(cleanedText) || isNoVocalsTranscript(cleanedText)) {
              return null;
            }
            const role = inferVocalRoleFromText(cleanedText, s.vocalRole);
            const formattedText = formatLyricForVocalRole(cleanedText, role);
            return {
              ...s,
              text: formattedText,
              vocalRole: role,
              section: typeof s.section === "string" && s.section.trim() ? s.section : detectedSection || "verse"
            };
          }).filter((s) => s !== null);
          if (segments.length > 0) {
            lastErrMsg = null;
            blockedReason = null;
            sawQuotaError = false;
            sawTimeoutError = false;
            timingSource = "aligned";
            return true;
          }
          if (parsed?.vocalsDetected === false && rawJson.length > 0) {
            confirmedInstrumental = true;
            lastErrMsg = null;
            return true;
          }
          return false;
        } finally {
          attempt.cleanup();
        }
      };
      for (const modelId of modelOrder) {
        if (clientClosed) break;
        try {
          const done = await runSinglePassAttempt(modelId);
          if (done) break;
        } catch (err) {
          if (clientClosed) break;
          markModelFailure(modelId, err);
          if (isQuotaOrRateLimitError(err)) sawQuotaError = true;
          if (isAbortOrTimeoutError(err)) sawTimeoutError = true;
          lastErrMsg = formatGeminiError(err);
          console.warn(`[transcribe-lyrics] Single-pass (${modelId}) fallback:`, lastErrMsg);
        }
      }
      if (segments.length > 0 && safeDuration > 300) {
        const lastSeg = segments[segments.length - 1];
        const lastEnd = Number(lastSeg.end ?? 0);
        if (lastEnd < safeDuration - 120 && !clientClosed) {
          const continuePrompt = `The previous transcription ended at ${formatClockTime(lastEnd)} (${lastEnd.toFixed(1)}s), but this is an extended live worship song of duration ${safeDuration.toFixed(2)}s (${totalClock}, like 9-minute Jireh). Continue transcribing EVERY remaining sung word, chorus, vamp, spontaneous worship, and vocalization from ${formatClockTime(lastEnd)} to ${totalClock} verbatim in chronological order. Return valid JSON matching the same schema with segments starting after ${lastEnd}.`;
          for (const modelId of modelOrder) {
            if (clientClosed) break;
            const attempt = createAttemptSignal(6e4, () => clientClosed, onClientClose);
            try {
              const contRes = await ai.models.generateContent({
                model: modelId,
                contents: {
                  parts: [audioPart, { text: continuePrompt }]
                },
                config: {
                  abortSignal: attempt.signal,
                  systemInstruction: singlePassSystemInstruction,
                  maxOutputTokens: 16384,
                  responseMimeType: "application/json",
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      vocalsDetected: { type: Type.BOOLEAN },
                      segments: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: segmentSchemaProperties
                        }
                      }
                    }
                  }
                }
              });
              const contJson = (contRes.text ?? "").trim();
              const contParsed = safeParseJson(contJson);
              const contRawSegs = Array.isArray(contParsed?.segments) ? contParsed.segments : [];
              const cleanContSegs = contRawSegs.map((s) => {
                if (typeof s.text !== "string") return null;
                const { text: cleanedText, detectedSection } = cleanLyricSegmentText(s.text);
                if (!cleanedText || isPromptEcho(cleanedText) || isNoVocalsTranscript(cleanedText)) {
                  return null;
                }
                const role = inferVocalRoleFromText(cleanedText, s.vocalRole);
                const formattedText = formatLyricForVocalRole(cleanedText, role);
                return {
                  ...s,
                  text: formattedText,
                  vocalRole: role,
                  section: typeof s.section === "string" && s.section.trim() ? s.section : detectedSection || "chorus"
                };
              }).filter((s) => s !== null);
              if (cleanContSegs.length > 0) {
                segments = [...segments, ...cleanContSegs];
                break;
              }
            } catch (err) {
              console.warn("[transcribe-lyrics] Continuation pass error:", err);
            } finally {
              attempt.cleanup();
            }
          }
        }
      }
      let rawText = "";
      if (segments.length === 0 && !confirmedInstrumental && !clientClosed && !sawQuotaError) {
        const rescuePrompt = `Listen to the entire ${safeDuration.toFixed(1)}s (${totalClock}) audio recording. ${languageDirective} Transcribe main sung words in the exact language(s) sung (Swahili, Shona, English, French, or any world/mixed language \u2014 never translate), Gospel/worship names (Jireh, Jehovah, Yahweh, Hallelujah/Haleluya, Hosanna, Elohim, Adonai), sustained vowels ("Eeeeeh", "Ooooooh", "Ahhhhh", "Mmmmm"), and repeated choruses in chronological order using LRC timestamps like [00:14.28] Lyric line text. Break lines strictly at natural spoken/sung sentence boundaries (1\u20132 short lines per cue, never moving words across sentences, and NEVER emitting a broken/misspelled prefix word like "amtenda" right before "ametenda amani"). Do NOT write brief 1\u20132 word lead interjections ("Come on", "Sing", "Amen", "Yeah", "Haya", "Allez") when the leader cuts in over backing/choir vocals, and do NOT emit separate lower backing-vocal echoes underneath main lyrics. NEVER include parentheses (...) or brackets [...] anywhere in lyric text. Do NOT output [Intro], [Verse], [Chorus], or [Instrumental] lines as lyrics. Reply NO_VOCALS only if the track is purely instrumental.`;
        const plainTranscribePrompt = `${languageDirective} Transcribe main sung lyrics verbatim in the exact sung language(s) and script (Swahili, Shona, English, French, etc. \u2014 never translate), preserving worship names (Jireh, Jehovah, Yahweh, Hallelujah/Haleluya, Hosanna, Elohim, Adonai) and sustained vowels ("Eeeeeh", "Ooooooh", "Ahhhhh") line-by-line in chronological order, breaking ONLY at natural sentence boundaries with ZERO parentheses or brackets anywhere. NEVER split one sung word or phrase into a duplicate fragment + full sentence (e.g. never emit "amtenda" separately before "ametenda amani"). Do NOT write brief 1\u20132 word lead interjections over backing/choir singing and do NOT write secondary backing echo lines underneath main lyrics. Reply NO_VOCALS only if purely instrumental.`;
        const rescueModels = ["gemini-3.5-transcribe", "gemini-4-hydrogen", "gemini-3.1-flash-lite"].filter(isModelReady);
        const rescueOrder = rescueModels.length > 0 ? rescueModels : ["gemini-3.5-transcribe", "gemini-4-hydrogen", "gemini-3.1-flash-lite"];
        for (const modelId of rescueOrder) {
          if (clientClosed) break;
          const attempt = createAttemptSignal(6e4, () => clientClosed, onClientClose);
          try {
            const isSpecializedTranscribe = modelId === "gemini-3.5-transcribe";
            const textRes = await ai.models.generateContent({
              model: modelId,
              contents: {
                parts: [
                  audioPart,
                  { text: isSpecializedTranscribe ? plainTranscribePrompt : rescuePrompt }
                ]
              },
              config: isSpecializedTranscribe ? {
                abortSignal: attempt.signal,
                maxOutputTokens: 8192
              } : {
                abortSignal: attempt.signal,
                thinkingConfig: {
                  thinkingLevel: modelId === "gemini-4-hydrogen" ? ThinkingLevel.MEDIUM : ThinkingLevel.MINIMAL
                },
                maxOutputTokens: 8192
              }
            });
            const finishReason = String(textRes.candidates?.[0]?.finishReason || "");
            const candidateText = (textRes.text ?? "").trim();
            if (!candidateText && finishReason === "RECITATION") {
              blockedReason = "Audio transcription was blocked by content recitation policy for this commercial track. Paste or import lyrics manually, then click Sync.";
              continue;
            }
            if (isNoVocalsTranscript(candidateText)) {
              confirmedInstrumental = true;
              lastErrMsg = null;
              break;
            }
            const parsedLines = parseTranscriptToSegments(candidateText, safeDuration).filter(
              (s) => !isPromptEcho(s.text)
            );
            if (parsedLines.length > 0) {
              rawText = candidateText;
              segments = parsedLines;
              const hasLrcTags = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(candidateText);
              timingSource = hasLrcTags ? "aligned" : "estimated";
              lastErrMsg = null;
              blockedReason = null;
              sawQuotaError = false;
              sawTimeoutError = false;
              break;
            }
          } catch (err) {
            if (clientClosed) break;
            markModelFailure(modelId, err);
            if (isQuotaOrRateLimitError(err)) sawQuotaError = true;
            if (isAbortOrTimeoutError(err)) sawTimeoutError = true;
            lastErrMsg = formatGeminiError(err);
            console.warn(`[transcribe-lyrics] Rescue (${modelId}) fallback:`, lastErrMsg);
          } finally {
            attempt.cleanup();
          }
        }
      }
      if (clientClosed) return;
      if (segments.length > 0) {
        const normalizedSegments = segments.map((seg, idx) => {
          const { text: cleanedText, detectedSection } = cleanLyricSegmentText(
            String(seg.text ?? "")
          );
          if (!cleanedText) return null;
          const role = inferVocalRoleFromText(cleanedText, seg.vocalRole);
          const formattedText = formatLyricForVocalRole(cleanedText, role);
          const fallbackSlot = safeDuration / segments.length;
          const fallbackStart = idx * fallbackSlot;
          const fallbackEnd = fallbackStart + Math.max(1.2, fallbackSlot - 0.1);
          const { start, end } = resolveSegmentTiming(
            seg,
            fallbackStart,
            fallbackEnd,
            safeDuration
          );
          const uncertainWords = Array.isArray(seg.uncertainWords) ? seg.uncertainWords.filter((w) => typeof w === "string") : void 0;
          const alignedWords = alignWordsToCleanText(
            formattedText,
            seg.words,
            start,
            end,
            uncertainWords
          );
          const conf = typeof seg.confidence === "number" && Number.isFinite(seg.confidence) ? Number(Math.max(0, Math.min(1, seg.confidence)).toFixed(2)) : void 0;
          const isUncertain = Boolean(seg.uncertain) || conf !== void 0 && conf < 0.72 || Boolean(alignedWords?.some((w) => w.uncertain));
          return {
            lineIndex: idx,
            text: formattedText,
            section: typeof seg.section === "string" && seg.section.trim() ? seg.section.trim() : detectedSection || "verse",
            vocalRole: role,
            start,
            end,
            ...conf !== void 0 ? { confidence: conf } : {},
            ...isUncertain ? { uncertain: true } : {},
            ...uncertainWords && uncertainWords.length > 0 ? { uncertainWords } : {},
            ...alignedWords && alignedWords.length > 0 ? { words: alignedWords } : {}
          };
        }).filter((seg) => seg !== null);
        const cleanSegments = filterVocalSegmentsForCleanPresentation(normalizedSegments).sort((a, b) => a.start - b.start).map((seg, idx) => ({ ...seg, lineIndex: idx }));
        return res.json({
          available: true,
          vocalsDetected: true,
          timingSource,
          rawText: rawText || cleanSegments.map((s) => s.text).join("\n"),
          segments: cleanSegments
        });
      }
      if (blockedReason) {
        return res.status(200).json({
          available: false,
          errorCode: "POLICY_BLOCKED",
          reason: blockedReason
        });
      }
      if (lastErrMsg && !confirmedInstrumental) {
        console.warn("[transcribe-lyrics] Transcription unavailable:", lastErrMsg);
        return res.status(200).json({
          available: false,
          errorCode: sawQuotaError ? "QUOTA_EXHAUSTED" : sawTimeoutError ? "TIMEOUT" : "MODEL_ERROR",
          reason: lastErrMsg
        });
      }
      return res.json({
        available: true,
        vocalsDetected: false,
        timingSource: "aligned",
        rawText: "",
        segments: []
      });
    } catch (err) {
      if (clientClosed) return;
      const message = formatGeminiError(err);
      console.warn("[transcribe-lyrics] Unexpected error:", message);
      return res.status(200).json({
        available: false,
        errorCode: isQuotaOrRateLimitError(err) ? "QUOTA_EXHAUSTED" : "MODEL_ERROR",
        reason: message
      });
    }
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found" });
  });
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Shululu Studio listening on http://0.0.0.0:${PORT}`);
  });
  server.requestTimeout = 10 * 6e4;
  server.headersTimeout = 10 * 6e4 + 5e3;
  server.keepAliveTimeout = 65e3;
}
startServer();
