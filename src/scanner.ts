import { parser as markdownParser } from "@lezer/markdown";
import {
  hasCJKRelatedContent,
  isPunctuation,
  isWhitespace,
  isWhitespaceOrPunctuation,
} from "./cjk";

export type EmphasisKind =
  | "em"
  | "strong"
  | "strong-em"
  | "highlight"
  | "strike";

export type DelimiterMarker = "*" | "=" | "~";

export interface EmphasisMatch {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  delimiterLength: number;
  marker: DelimiterMarker;
  kind: EmphasisKind;
  cjkRelated: boolean;
}

export interface TextMask {
  from: number;
  to: number;
}

interface ScanPass {
  expression: RegExp;
  delimiterLength: number;
  marker: DelimiterMarker;
  kind: EmphasisKind;
}

/**
 * Order matters: longer asterisk runs must win before shorter ones.
 * Highlight and strikethrough use their own marker characters so they never
 * compete with emphasis, but they still run after it so nested markup stays
 * untouched.
 */
const SCAN_PASSES: ScanPass[] = [
  { expression: /\*\*\*(.+?)\*\*\*/g, delimiterLength: 3, marker: "*", kind: "strong-em" },
  { expression: /\*\*(.+?)\*\*/g, delimiterLength: 2, marker: "*", kind: "strong" },
  { expression: /\*([^*\n]+)\*/g, delimiterLength: 1, marker: "*", kind: "em" },
  { expression: /==(.+?)==/g, delimiterLength: 2, marker: "=", kind: "highlight" },
  { expression: /~~(.+?)~~/g, delimiterLength: 2, marker: "~", kind: "strike" },
];

function overlaps(a: TextMask, b: TextMask): boolean {
  return a.from < b.to && b.from < a.to;
}

function isMarkerAt(text: string, index: number, marker: DelimiterMarker): boolean {
  return index >= 0 && index < text.length && text[index] === marker;
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  let cursor = index - 1;
  while (cursor >= 0 && text[cursor] === "\\") {
    backslashes++;
    cursor--;
  }
  return backslashes % 2 === 1;
}

function backtickRunEnd(text: string, start: number): number {
  let end = start;
  while (end < text.length && text[end] === "`") end++;
  return end;
}

/** End of the first backtick run after `start` whose length matches exactly. */
function closingBacktickRunEnd(text: string, start: number, length: number): number {
  let cursor = start;
  while (cursor < text.length) {
    const runStart = text.indexOf("`", cursor);
    if (runStart === -1) return -1;
    const runEnd = backtickRunEnd(text, runStart);
    if (runEnd - runStart === length) return runEnd;
    cursor = runEnd;
  }
  return -1;
}

/**
 * Inline code and `$$` math masks, found in source order.
 *
 * One pass, because each syntax can contain the other's delimiters: in
 * `` `$$` `` the dollars are code, in `$$ `$$` ` the backticks are math.
 * Whichever opens first owns its delimiters, which two independent scans got
 * wrong. A code span also has to close on a backtick run of exactly the same
 * length, as CommonMark requires.
 */
export function findMasks(text: string): TextMask[] {
  const masks: TextMask[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "`") {
      if (isEscaped(text, i)) {
        i++;
        continue;
      }
      const runEnd = backtickRunEnd(text, i);
      const close = closingBacktickRunEnd(text, runEnd, runEnd - i);
      if (close === -1) {
        i = runEnd;
        continue;
      }
      masks.push({ from: i, to: close });
      i = close;
      continue;
    }
    if (text[i] === "$" && text[i + 1] === "$") {
      if (isEscaped(text, i)) {
        i++;
        continue;
      }
      let close = text.indexOf("$$", i + 2);
      while (close !== -1 && isEscaped(text, close)) {
        close = text.indexOf("$$", close + 2);
      }
      if (close === -1) {
        i += 2;
        continue;
      }
      masks.push({ from: i, to: close + 2 });
      i = close + 2;
      continue;
    }
    i++;
  }
  return masks;
}

function isMasked(position: number, masks: TextMask[]): boolean {
  return masks.some((mask) => mask.from <= position && position < mask.to);
}

function isValidCandidate(
  text: string,
  from: number,
  to: number,
  contentFrom: number,
  contentTo: number,
  pass: ScanPass,
): EmphasisMatch | null {
  if (contentFrom >= contentTo) return null;
  const content = text.slice(contentFrom, contentTo);
  if (contentFrom >= contentTo) return null;
  if (/^\s/u.test(content) || /\s$/u.test(content)) return null;

  const cjkRelated = hasCJKRelatedContent(content);
  if (!cjkRelated) return null;

  const after = text.codePointAt(to);
  const relaxedClosingBoundary = cjkRelated && !isWhitespaceOrPunctuation(after);

  // A CJK-aware match accepts a non-space/non-punctuation character after a
  // punctuation-ending span. Otherwise retain the normal CommonMark boundary.
  if (!relaxedClosingBoundary && after !== undefined && !isWhitespaceOrPunctuation(after)) {
    return null;
  }

  const before = text.codePointAt(contentTo - 1);
  if (before === undefined || isWhitespace(before)) return null;

  return {
    from,
    to,
    contentFrom,
    contentTo,
    delimiterLength: pass.delimiterLength,
    marker: pass.marker,
    kind: pass.kind,
    cjkRelated,
  };
}

/**
 * Replace every character inside a mask with a placeholder that cannot act as a
 * delimiter. Indices are preserved, so a match found in the masked text can be
 * mapped straight back onto the real line.
 *
 * Masked spans only need to be hidden from the delimiter pattern: emphasis may
 * legitimately contain inline code (`**see `npm test` for details。**继续`), and
 * splitting the line at every mask would lose such a span entirely.
 */
function maskDelimiters(text: string, masks: readonly TextMask[]): string {
  if (masks.length === 0) return text;
  const characters = text.split("");
  for (const mask of masks) {
    const end = Math.min(text.length, mask.to);
    for (let i = Math.max(0, mask.from); i < end; i++) {
      characters[i] = "\u0000";
    }
  }
  return characters.join("");
}

/**
 * Scan one line for one delimiter type. Delimiters inside masks were replaced
 * with placeholders beforehand, so they can never open or close a span, while
 * masked content in the middle of a span is harmless.
 *
 * Lookbehind is avoided on purpose: iOS before 16.4 does not support it, and
 * Obsidian ships on mobile, so the boundary checks are done by index instead.
 */
function scanWithRegex(
  text: string,
  scannable: string,
  pass: ScanPass,
  consumed: TextMask[],
  barriers: readonly TextMask[] = [],
): EmphasisMatch[] {
  const matches: EmphasisMatch[] = [];
  const expression = pass.expression;
  expression.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(scannable)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    const range = { from, to };
    if (barriers.some((barrier) => overlaps(barrier, range))) {
      // Syntax such as a URL, an HTML tag or a link title cannot be crossed by
      // one emphasis span; the delimiters on either side belong to different
      // contexts.
      expression.lastIndex = from + 1;
      continue;
    }
    if (consumed.some((item) => overlaps(item, range))) {
      // This match reuses a delimiter that is already part of another span.
      // Resume after the opener so a later span on the same line can still be
      // found; otherwise `**甲** *乙。*续` loses the italic repair entirely.
      expression.lastIndex = from + 1;
      continue;
    }

    // Part of a longer run of the same marker, e.g. the inner `**` of `***`.
    if (isMarkerAt(text, from - 1, pass.marker) || isMarkerAt(text, to, pass.marker)) {
      continue;
    }

    const contentFrom = from + pass.delimiterLength;
    const contentTo = to - pass.delimiterLength;

    // A backslash-escaped marker is literal text, not a delimiter.
    if (isEscaped(text, from)) {
      expression.lastIndex = from + 1;
      continue;
    }
    if (isEscaped(text, contentTo)) {
      // Only a single-marker span recovers: `*中\*文。*续`. Runs such as
      // `**字\**文**` have different CommonMark semantics, so they keep the
      // conservative "no match" behaviour.
      if (pass.delimiterLength !== 1) {
        expression.lastIndex = from + 1;
        continue;
      }
      // Search the masked text so a delimiter inside inline code or math can
      // never close the span, and check escaping against the original.
      const closerStart = findNextDelimiter(scannable, pass.marker, 1, to);
      if (closerStart === -1 || isEscaped(text, closerStart)) {
        expression.lastIndex = from + 1;
        continue;
      }
      const extended = { from, to: closerStart + 1 };
      if (
        barriers.some((barrier) => overlaps(barrier, extended)) ||
        consumed.some((item) => overlaps(item, extended))
      ) {
        expression.lastIndex = from + 1;
        continue;
      }
      const escapedCandidate = isValidCandidate(
        text,
        from,
        extended.to,
        contentFrom,
        closerStart,
        pass,
      );
      if (escapedCandidate && canOpenEmphasis(text, from, pass.delimiterLength)) {
        matches.push(escapedCandidate);
        consumed.push(extended);
        expression.lastIndex = extended.to;
      } else {
        expression.lastIndex = from + 1;
      }
      continue;
    }

    const candidate = isValidCandidate(text, from, to, contentFrom, contentTo, pass);
    if (!candidate) {
      // The closer the pattern picked may be a false one: a space before it, a
      // run that cannot close, ... Resuming one character after the opener lets
      // the next delimiter be tried instead of dropping the rest of the line.
      expression.lastIndex = from + 1;
      continue;
    }

    matches.push(candidate);
    consumed.push(range);
  }
  return matches;
}

/** Start of the next unescaped marker run of exactly `length`. */
function findNextDelimiter(
  text: string,
  marker: DelimiterMarker,
  length: number,
  fromIndex: number,
): number {
  let index = fromIndex;
  while (index < text.length) {
    if (text[index] !== marker) {
      index++;
      continue;
    }
    const runStart = index;
    let runEnd = runStart;
    while (runEnd < text.length && text[runEnd] === marker) runEnd++;
    if (runEnd - runStart === length) return runStart;
    index = runEnd;
  }
  return -1;
}

export type InlineTokenKind = "code" | "inline" | "display";

export interface InlineToken extends TextMask {
  kind: InlineTokenKind;
}

/** Merge overlapping or touching ranges and sort them. */
function mergeRanges(ranges: readonly TextMask[]): TextMask[] {
  const sorted = ranges
    .filter((range) => range.to > range.from)
    .sort((a, b) => a.from - b.from);
  const merged: TextMask[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) {
      last.to = Math.max(last.to, range.to);
    } else {
      merged.push({ from: range.from, to: range.to });
    }
  }
  return merged;
}

interface GapScan {
  tokens: InlineToken[];
  /** First backtick run that has no closer of the same width inside the gap. */
  unclosedCode: { from: number; width: number } | null;
}

/**
 * Tokenize one gap between barriers. The gap is the only reachable text: no
 * opener, closer or escape may look outside it.
 */
function scanGap(text: string, start: number, end: number): GapScan {
  const escaped = (position: number): boolean => {
    let slashes = 0;
    let cursor = position - 1;
    while (cursor >= start && text[cursor] === "\\") {
      slashes++;
      cursor--;
    }
    return slashes % 2 === 1;
  };

  const tokens: InlineToken[] = [];
  let unclosedCode: { from: number; width: number } | null = null;
  let index = start;
  while (index < end) {
    const character = text[index];
    if (character !== "`" && character !== "$") {
      index++;
      continue;
    }
    if (escaped(index)) {
      index++;
      continue;
    }

    if (character === "`") {
      let runEnd = index;
      while (runEnd < end && text[runEnd] === "`") runEnd++;
      const width = runEnd - index;
      let cursor = runEnd;
      let close = -1;
      while (cursor < end) {
        if (text[cursor] !== "`") {
          cursor++;
          continue;
        }
        let candidateEnd = cursor;
        while (candidateEnd < end && text[candidateEnd] === "`") candidateEnd++;
        if (candidateEnd - cursor === width) {
          close = candidateEnd;
          break;
        }
        cursor = candidateEnd;
      }
      if (close === -1) {
        // The first failed run is the one that could pair with a later line;
        // everything after it on this line is pending code content.
        if (!unclosedCode) unclosedCode = { from: index, width };
        index = runEnd;
        continue;
      }
      tokens.push({ from: index, to: close, kind: "code" });
      index = close;
      continue;
    }

    const display =
      index + 1 < end && text[index + 1] === "$" && !escaped(index + 1);
    const width = display ? 2 : 1;
    const bodyStart = index + width;
    let cursor = bodyStart;
    let close = -1;
    if (display) {
      while (cursor + 1 < end) {
        if (
          text[cursor] === "$" &&
          !escaped(cursor) &&
          text[cursor + 1] === "$" &&
          !escaped(cursor + 1)
        ) {
          close = cursor + 2;
          break;
        }
        cursor++;
      }
    } else {
      while (cursor < end) {
        if (text[cursor] === "$" && !escaped(cursor)) {
          close = cursor + 1;
          break;
        }
        cursor++;
      }
    }
    if (close === -1) {
      // Failed owner: consume the opener only; never retry its second dollar.
      index = bodyStart;
      continue;
    }
    tokens.push({ from: index, to: close, kind: display ? "display" : "inline" });
    index = close;
  }
  return { tokens, unclosedCode };
}

/**
 * Inline code and math tokens for one line, in source order.
 *
 * Barriers (URL, HTML tag, link title, entity, wikilink) split the line into
 * independent gaps; a delimiter can neither open nor close across them. Inside
 * a gap, `$$` opens display math, `$` opens inline math, and backtick runs pair
 * by exact width. Escaped delimiters are literal, a failed opener consumes only
 * itself, and an unclosed span falls back to text. Ownership follows scan
 * order, so `$$a$$$x$` closes display with `$$` and then opens inline with the
 * remaining `$`.
 */
export function tokenizePreviewLine(
  text: string,
  barriers: readonly TextMask[] = [],
): InlineToken[] {
  return tokenizePreviewLineDetailed(text, barriers).tokens;
}

/**
 * Same tokenizer, plus the first backtick run that stays open. Only the last
 * gap can continue on the next line: a barrier is opaque in both directions.
 */
function tokenizePreviewLineDetailed(
  text: string,
  barriers: readonly TextMask[] = [],
): GapScan {
  const gaps: TextMask[] = [];
  let cursor = 0;
  for (const barrier of mergeRanges(barriers)) {
    const from = Math.max(0, Math.min(text.length, barrier.from));
    const to = Math.max(0, Math.min(text.length, barrier.to));
    if (from > cursor) gaps.push({ from: cursor, to: from });
    cursor = Math.max(cursor, to);
  }
  if (cursor < text.length) gaps.push({ from: cursor, to: text.length });

  const tokens: InlineToken[] = [];
  let unclosedCode: GapScan["unclosedCode"] = null;
  for (const gap of gaps) {
    const scan = scanGap(text, gap.from, gap.to);
    for (const token of scan.tokens) tokens.push(token);
    if (gap.to === text.length && scan.unclosedCode) unclosedCode = scan.unclosedCode;
  }
  return { tokens, unclosedCode };
}

/** Clamp barriers into the half-open window [from, to), relative to `from`. */
function clipBarriers(
  barriers: readonly TextMask[],
  from: number,
  to: number,
): TextMask[] {
  const clipped: TextMask[] = [];
  for (const barrier of barriers) {
    const start = Math.max(barrier.from, from);
    const end = Math.min(barrier.to, to);
    if (end > start) clipped.push({ from: start - from, to: end - from });
  }
  return clipped;
}

export interface WikiBarrierContext {
  /**
   * True when the backtick run at `column` has a confirmed exact-width closer
   * later in the same Markdown block. A candidate after such a run is code
   * content, not a link.
   */
  hasCodeCloser: (column: number, width: number) => boolean;
}

/**
 * Wiki links that may act as barriers on one line.
 *
 * A wiki link is recognised by a regex, so its brackets have to be checked
 * against the code and math tokens the line tokenizer found. A match whose
 * opening `[` or closing `]` falls inside a token, or inside a supplied
 * barrier, is that token's content. Tokens that open inside the match and run
 * past its closer were invented by the link's own delimiters and are ignored.
 * Interior tokens are allowed, so a link may contain inline code.
 *
 * With a context, an earlier backtick run that is confirmed to close later in
 * the block owns the candidate, so the apparent link is code content.
 */
export function findWikiBarriers(
  text: string,
  barriers: readonly TextMask[] = [],
  context?: WikiBarrierContext,
): TextMask[] {
  const pattern = /!?\[\[[^\]\n]+\]\]/g;
  const candidates: TextMask[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    candidates.push({ from: match.index, to: match.index + match[0].length });
  }
  if (candidates.length === 0) return [];

  const tokens = tokenizePreviewLine(text, barriers);
  const firstBacktick = text.indexOf("`");
  const merged = mergeRanges(barriers);
  const insideBarrier = (index: number): boolean =>
    merged.some((barrier) => barrier.from <= index && index < barrier.to);

  const kept: TextMask[] = [];
  const confirmed: TextMask[] = [];
  for (const candidate of candidates) {
    // `![[x]]` starts at the bang; the bracket itself is one character later.
    const opening = text[candidate.from] === "!" ? candidate.from + 1 : candidate.from;
    const closing = candidate.to - 1;
    const relevant = tokens.filter((token) => {
      if (token.from >= candidate.to || candidate.from >= token.to) return false;
      return !(candidate.from < token.from && token.to > candidate.to);
    });
    const insideToken = (index: number): boolean =>
      relevant.some((token) => token.from <= index && index < token.to);
    if (insideToken(opening) || insideToken(closing)) continue;
    if (insideBarrier(opening) || insideBarrier(closing)) continue;
    if (context && firstBacktick !== -1 && firstBacktick < candidate.from) {
      // Earlier candidates are link text, not code: their own backticks must
      // not be mistaken for the opener that owns this candidate.
      const prefixBarriers = clipBarriers(
        [...barriers, ...confirmed],
        0,
        candidate.from,
      );
      const prefix = tokenizePreviewLineDetailed(text.slice(0, candidate.from), prefixBarriers);
      if (
        prefix.unclosedCode &&
        context.hasCodeCloser(prefix.unclosedCode.from, prefix.unclosedCode.width)
      ) {
        continue;
      }
    }
    kept.push(candidate);
    confirmed.push(candidate);
  }
  return kept;
}

export function subtractRanges(
  range: TextMask,
  barriers: readonly TextMask[],
): TextMask[] {
  let segments: TextMask[] = [range];
  for (const barrier of mergeRanges(barriers)) {
    const next: TextMask[] = [];
    for (const segment of segments) {
      if (barrier.to <= segment.from || barrier.from >= segment.to) {
        next.push(segment);
        continue;
      }
      if (barrier.from > segment.from) {
        next.push({ from: segment.from, to: barrier.from });
      }
      if (barrier.to < segment.to) {
        next.push({ from: barrier.to, to: segment.to });
      }
    }
    segments = next;
  }
  return segments.filter((segment) => segment.to > segment.from);
}

function scanEmphasis(
  text: string,
  masks: readonly TextMask[],
  barriers: readonly TextMask[],
): EmphasisMatch[] {
  const scannable = maskDelimiters(text, masks);
  const consumed: TextMask[] = [];
  const matches: EmphasisMatch[] = [];
  for (const pass of SCAN_PASSES) {
    for (const match of scanWithRegex(text, scannable, pass, consumed, barriers)) {
      matches.push(match);
    }
  }
  return matches.sort((a, b) => a.from - b.from);
}

/**
 * Legacy scanner used by the source-rewrite command: its own masks decide what
 * is code or math.
 */
export function scanLine(text: string): {
  matches: EmphasisMatch[];
  masks: TextMask[];
} {
  const masks = findMasks(text);
  return { masks, matches: scanEmphasis(text, masks, []) };
}

/**
 * Preview scanner: the tokenizer owns code and math, and barriers are syntax an
 * emphasis span must never cross.
 */
export function scanPreviewLine(
  text: string,
  barriers: readonly TextMask[] = [],
  codeRanges: readonly TextMask[] = [],
): { tokens: InlineToken[]; matches: EmphasisMatch[] } {
  const normalized = mergeRanges(barriers);
  const code = mergeRanges(codeRanges);
  // Code ranges come from the literal-aware classifier, so they are masked
  // before the line tokenizer runs; a closing backtick or `$` inside them can
  // neither pair forward nor swallow the prose that follows.
  const scannable = maskDelimiters(text, code);
  const own = tokenizePreviewLine(scannable, normalized);
  const tokens: InlineToken[] = [
    ...own,
    ...code.map((range) => ({ from: range.from, to: range.to, kind: "code" as const })),
  ].sort((a, b) => a.from - b.from);
  return { tokens, matches: scanEmphasis(text, tokens, normalized) };
}

/**
 * Read the code point that ends at `index`. `codePointAt(index - 1)` alone
 * returns the trailing surrogate of a surrogate pair.
 */
function codePointBefore(text: string, index: number): number | undefined {
  if (index <= 0) return undefined;
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.codePointAt(index - 2);
  }
  return text.codePointAt(index - 1);
}

export function trailingPunctuationLength(text: string, from: number, to: number): number {
  let cursor = to;
  while (cursor > from) {
    const code = codePointBefore(text, cursor);
    if (code === undefined || !isPunctuation(code)) break;
    // Underscores, asterisks, equals signs and tildes are emphasis delimiters,
    // not prose punctuation. Moving one of them across the outer marker would
    // break a nested span, so the walk stops there.
    if (code === 0x5f || code === 0x2a || code === 0x3d || code === 0x7e) break;
    cursor -= code > 0xffff ? 2 : 1;
  }
  return to - cursor;
}

export interface SourceFix {
  from: number;
  to: number;
  replacement: string;
}

/** Opening character for each closing character the punctuation walker may meet. */
const CLOSING_TO_OPENING: Record<string, string> = {
  "”": "“",
  "’": "‘",
  "）": "（",
  "】": "【",
  "」": "「",
  "』": "『",
  "》": "《",
  "〉": "〈",
  "〕": "〔",
  "〗": "〖",
  "»": "«",
  "〙": "〘",
  ")": "(",
  "]": "[",
  "}": "{",
  "］": "［",
  "｝": "｛",
};

function overlapsAnyMask(masks: TextMask[], from: number, to: number): boolean {
  return masks.some((mask) => overlaps(mask, { from, to }));
}

/**
 * A closing bracket or quote in the trailing run belongs to a pair opened
 * inside the span, so moving only the closer would break that pair.
 */
function containsOpenedPair(content: string, trailing: string): boolean {
  for (const character of trailing) {
    const opening = CLOSING_TO_OPENING[character];
    if (opening !== undefined && content.includes(opening)) return true;
  }
  return false;
}

function canOpenEmphasis(text: string, start: number, length: number): boolean {
  const after = text.codePointAt(start + length);
  if (after === undefined || isWhitespace(after)) return false;
  if (!isPunctuation(after)) return true;
  const before = codePointBefore(text, start);
  return before === undefined || isWhitespace(before) || isPunctuation(before);
}

function canCloseEmphasis(text: string, start: number, length: number): boolean {
  const before = codePointBefore(text, start);
  if (before === undefined || isWhitespace(before)) return false;
  if (!isPunctuation(before)) return true;
  const after = text.codePointAt(start + length);
  return after === undefined || isWhitespace(after) || isPunctuation(after);
}

export function findSourceFixes(text: string): SourceFix[] {
  // The rewrite only touches plain prose. Links, embeds, HTML, math and tables
  // all carry syntax a punctuation move can break (a link destination, an
  // attribute value, a comment), so the whole line is skipped. Inline code and
  // `$$` spans are masked first, so their content does not trip the check.
  const gate = maskDelimiters(text, findMasks(text));
  if (/[\][<!$&|%]/.test(gate)) return [];

  const { matches, masks } = scanLine(text);
  const fixes: SourceFix[] = [];
  for (const match of matches) {
    if (isMasked(match.from, masks)) continue;
    const after = text.codePointAt(match.to);
    if (after === undefined || isWhitespaceOrPunctuation(after)) continue;

    const punctLength = trailingPunctuationLength(text, match.contentFrom, match.contentTo);
    if (punctLength === 0) continue;

    const punctuationFrom = match.contentTo - punctLength;
    const punctuation = text.slice(punctuationFrom, match.contentTo);
    const contentWithoutPunctuation = text.slice(match.contentFrom, punctuationFrom);

    // Punctuation that reaches into inline code is code content: moving it
    // would rewrite what the code span contains.
    if (overlapsAnyMask(masks, punctuationFrom, match.contentTo)) continue;
    if (contentWithoutPunctuation.length === 0) continue;
    // A body made only of markers is malformed; rewriting it would join the
    // delimiter runs into literal stars.
    if (/^[*_~=\s]*$/.test(contentWithoutPunctuation)) continue;
    // Moving the closer past a marker run would merge delimiters and change
    // what is emphasised, as in `**字*。**`.
    if (contentWithoutPunctuation.endsWith(match.marker)) continue;
    // Moving the closer past a nested underscore delimiter would change which
    // marker owns the inner span; leave such lines alone.
    if (contentWithoutPunctuation.includes("_")) continue;
    if (containsOpenedPair(contentWithoutPunctuation, punctuation)) continue;

    const delimiter = text.slice(match.from, match.contentFrom);
    const replacement = `${delimiter}${contentWithoutPunctuation}${delimiter}${punctuation}`;

    // Emphasis has to satisfy CommonMark's flanking rules on both sides after
    // the rewrite. Moving punctuation out of a span that starts with an opening
    // quote leaves the delimiter unable to open, so skip instead of producing
    // text that still renders as literal markers.
    if (match.marker === "*") {
      const rewritten =
        text.slice(0, match.from) + replacement + text.slice(match.to);
      const closerStart = match.from + delimiter.length + contentWithoutPunctuation.length;
      if (
        !canOpenEmphasis(rewritten, match.from, delimiter.length) ||
        !canCloseEmphasis(rewritten, closerStart, delimiter.length)
      ) {
        continue;
      }
    }

    fixes.push({
      from: match.from,
      to: match.to,
      replacement,
    });
  }
  return fixes;
}

export interface ParserEmphasis extends TextMask {
  kind?: EmphasisKind;
}

export interface OverflowMatch {
  /** Absolute end of the marked span. */
  to: number;
  delimiterLength: number;
  kind?: EmphasisKind;
}

/**
 * Parser emphasis that reaches past an intended closing delimiter.
 *
 * Two shapes matter. A run that starts before the closer and ends after it is
 * overflow and is reset from the closer onwards. A run that starts at or just
 * after the closer is the parser opening a new span on the delimiter the
 * author used to close; that tail is reset too, unless whitespace separates the
 * two spans. Runs of another kind are separate constructs and stay styled.
 */
export function findExcessParserRanges(
  matches: readonly OverflowMatch[],
  parserRanges: readonly ParserEmphasis[],
  lineText: string,
  lineFrom: number,
  lineTo: number,
): TextMask[] {
  const excess: TextMask[] = [];
  for (const match of matches) {
    for (const range of parserRanges) {
      // Any parser run that reaches past the closer is overflow only when it
      // is the same kind of emphasis. A run of another kind is a separate
      // construct, e.g. bold nested in italic.
      if (range.kind !== undefined && match.kind !== undefined && range.kind !== match.kind) {
        continue;
      }
      if (range.to <= match.to) continue;
      const to = Math.min(range.to, lineTo);
      if (to <= match.to) continue;

      if (range.from < match.to) {
        excess.push({ from: match.to, to });
        continue;
      }

      // Started at or after the closer: only treat it as overflow when it
      // begins inside the closing marker run itself. For a single marker only
      // the closer position qualifies; the next character starts a new span.
      const boundaryLimit =
        match.delimiterLength === 1 ? match.to : match.to + match.delimiterLength;
      if (range.from > boundaryLimit) continue;
      const gap = lineText.slice(match.to - lineFrom, range.from - lineFrom);
      if (/\s/.test(gap)) continue;
      if (range.from < to) excess.push({ from: range.from, to });
    }
  }
  return excess;
}

/** Offsets of each line start, plus one past the end of the document. */
function lineStartsFor(lines: readonly string[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  starts.push(offset);
  return starts;
}

function lineIndexAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = Math.max(0, starts.length - 2);
  while (low < high) {
    const middle = (low + high) >> 1;
    if (starts[middle + 1] <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Mark every line touched by the half-open range [from, to). */
function markLines(
  literal: boolean[],
  starts: readonly number[],
  from: number,
  to: number,
): void {
  if (to <= from) return;
  const first = lineIndexAt(starts, from);
  for (let index = first; index < literal.length && starts[index] < to; index++) {
    literal[index] = true;
  }
}

/** YAML frontmatter: `---` on line one, a closing delimiter without a limit. */
function findFrontmatterEnd(lines: readonly string[]): number {
  if (lines.length === 0) return -1;
  if (!/^(?:\uFEFF)?---[ \t]*$/.test(lines[0].replace(/\r$/, ""))) return -1;  const limit = lines.length;
  for (let index = 1; index < limit; index++) {
    const line = lines[index].replace(/\r$/, "");
    // The closing delimiter must start at column zero; an indented `---` is a
    // block-scalar value. Trailing spaces and tabs are allowed.
    if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) return index;
  }
  return -1;
}

/**
 * Mark the lines whose content is literal text: fenced code, indented code,
 * HTML blocks and multi-line inline code. Emphasis markers on those lines are
 * content, so neither the rewrite command nor the Live Preview decorations may
 * touch them.
 *
 * Block structure comes from `@lezer/markdown`, the parser behind CodeMirror's
 * Markdown mode, so a fence inside a list item or blockquote follows the same
 * container rules as the editor instead of a hand-written approximation.
 * Frontmatter and `$$` math are Obsidian constructs the parser does not know,
 * so they are layered on top.
 */
function stripMathMarkers(line: string): string {
  let value = line.trim();
  for (;;) {
    const next = value
      .replace(/^(?:>\s*)+/, "")
      .replace(/^(?:[-+*]|\d{1,9}[.)])\s+/, "")
      .trim();
    if (next === value) return value;
    value = next;
  }
}

/**
 * Display-math boundary rules. Callers container-strip the line first; these
 * predicates are the only place the open/close shape is decided, so the
 * classifier and the preview tracker cannot disagree.
 */
function opensDisplayMath(candidate: string, standalone: boolean): boolean {
  return standalone
    ? candidate === "$$"
    : candidate.startsWith("$$") && candidate.indexOf("$$", 2) === -1;
}

function closesDisplayMath(candidate: string, standalone: boolean): boolean {
  return standalone ? candidate === "$$" : candidate.trimEnd().endsWith("$$");
}

function mathRegions(
  lines: readonly string[],
  starts: readonly number[],
  standalone: boolean,
  skip: readonly boolean[] = [],
): { open: boolean[]; ends: number[] } {
  const open = new Array<boolean>(lines.length + 1).fill(false);
  const ends = new Array<number>(lines.length).fill(-1);
  let start = -1;
  for (let index = 0; index < lines.length; index++) {
    open[index] = start !== -1;
    if (skip[index]) continue;
    const candidate = stripMathMarkers(lines[index].replace(/\r$/, ""));
    const closes = closesDisplayMath(candidate, standalone);
    const opens = opensDisplayMath(candidate, standalone);
    if (start === -1) {
      if (opens) start = index;
      continue;
    }
    if (closes) {
      const end = starts[index] + lines[index].length;
      for (let line = start; line <= index; line++) ends[line] = end;
      start = -1;
    }
  }
  open[lines.length] = start !== -1;
  if (start !== -1) {
    const end = starts[lines.length - 1] + lines[lines.length - 1].length;
    for (let line = start; line < lines.length; line++) ends[line] = end;
  }
  return { open, ends };
}

function startsInsideDisplayMath(
  lines: readonly string[],
  open: readonly boolean[],
  lineIndex: number,
  column: number,
  standalone: boolean,
): boolean {
  if (open[lineIndex]) return true;
  if (standalone) return false;
  // Legacy blocks may open on a line that also carries the code span,
  // e.g. ``$$` ``; anything after the opener on that line is math content.
  if (column <= 0) return false;
  const candidate = stripMathMarkers(lines[lineIndex].replace(/\r$/, ""));
  return opensDisplayMath(candidate, standalone);
}

export interface LiteralOptions {
  /**
   * How a `$$` line opens a display block. `legacy` keeps the command's
   * historical boundary (`$$` prefix, line ending in `$$`); `standalone`
   * requires a bare `$$` line on both ends and is used by Live Preview.
   */
  displayBlocks?: "legacy" | "standalone";
  /**
   * Treat lines touched by a multi-line inline code span as literal. The
   * source-rewrite command needs this; Live Preview passes false and masks the
   * code range per line instead.
   */
  multilineCode?: boolean;
}

export function findLiteralLines(
  lines: readonly string[],
  options: LiteralOptions = {},
  codeRanges?: TextMask[],
): boolean[] {
  const standaloneDisplay = (options.displayBlocks ?? "legacy") === "standalone";
  const markMultiline = options.multilineCode ?? true;
  const stripped = lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  // A leading BOM hides the first line from the Markdown parser (indented code
  // and fences stop being recognised). Strip it from the parse input; the line
  // map below is built from the stripped text, so node offsets stay consistent
  // while the original line text keeps its offsets for edits.
  let bomOffset = 0;
  if (stripped.length > 0 && stripped[0].charCodeAt(0) === 0xfeff) {
    stripped[0] = stripped[0].slice(1);
    bomOffset = 1;
  }
  const starts = lineStartsFor(stripped);
  const originalStarts = lineStartsFor(lines);
  const frontmatterEnd = findFrontmatterEnd(lines);

  const parse = (text: string): {
    blockNodes: TextMask[];
    inlineNodes: TextMask[];
    barrierNodes: TextMask[];
  } => {
    const blockNodes: TextMask[] = [];
    const inlineNodes: TextMask[] = [];
    const barrierNodes: TextMask[] = [];
    markdownParser.parse(text).iterate({
      enter(node) {
        if (
          node.name === "FencedCode" ||
          node.name === "CodeBlock" ||
          node.name === "HTMLBlock" ||
          node.name === "CommentBlock"
        ) {
          blockNodes.push({ from: node.from, to: node.to });
          return;
        }
        if (node.name === "InlineCode") {
          inlineNodes.push({ from: node.from, to: node.to });
          return;
        }
        if (
          node.name === "URL" ||
          node.name === "LinkTitle" ||
          node.name === "HTMLTag" ||
          node.name === "Comment" ||
          node.name === "Entity"
        ) {
          barrierNodes.push({ from: node.from, to: node.to });
        }
      },
    });
    return { blockNodes, inlineNodes, barrierNodes };
  };

  const blankCharacters = (characters: string[], from: number, to: number): void => {
    for (let index = Math.max(0, from); index < Math.min(characters.length, to); index++) {
      if (characters[index] !== "\n") characters[index] = " ";
    }
  };

  /**
   * Per-line barrier slices. A barrier is added to every line it intersects,
   * so a link title or URL that crosses a line break stays opaque on each part.
   * Built once per parse: scanning every barrier for every line was quadratic.
   */
  const createBarrierIndex = (
    barrierNodes: readonly TextMask[],
    lineLengths: readonly number[],
  ): TextMask[][] => {
    const index: TextMask[][] = Array.from({ length: lineLengths.length }, () => []);
    for (const barrier of barrierNodes) {
      if (barrier.to <= barrier.from) continue;
      const first = lineIndexAt(starts, barrier.from);
      const last = lineIndexAt(starts, Math.max(barrier.from, barrier.to - 1));
      for (let line = first; line <= last && line < lineLengths.length; line++) {
        const lineFrom = starts[line];
        const from = Math.max(barrier.from, lineFrom) - lineFrom;
        const to = Math.min(barrier.to, lineFrom + lineLengths[line]) - lineFrom;
        if (to > from) index[line].push({ from, to });
      }
    }
    return index;
  };

  const closingCodeRunEnd = (text: string, from: number, width: number): number => {
    let cursor = from;
    while (cursor < text.length) {
      const runStart = text.indexOf("`", cursor);
      if (runStart === -1) return -1;
      let runEnd = runStart;
      while (runEnd < text.length && text[runEnd] === "`") runEnd++;
      // Inside an accepted code span a backslash is content, so it cannot
      // escape the closer. Escape handling belongs to the opener decision.
      if (runEnd - runStart === width) return runEnd;
      cursor = runEnd;
    }
    return -1;
  };

  /**
   * Whether a backtick run closes later in the same Markdown block. A block
   * boundary (fence, indented/HTML/comment block) or a blank line ends the
   * search, so an opener cannot borrow a closer from the next paragraph.
   */
  const createCodeCloser = (
    textLines: readonly string[],
    literalLines: readonly boolean[],
  ): ((lineIndex: number, column: number, width: number) => boolean) => {
    return (lineIndex, column, width) => {
      let index = lineIndex;
      let from = column + width;
      while (index < textLines.length) {
        if (literalLines[index]) return false;
        if (index > lineIndex && textLines[index].length === 0) return false;
        const lineText = textLines[index];
        let cursor = from;
        while (cursor < lineText.length) {
          const runStart = lineText.indexOf("`", cursor);
          if (runStart === -1) break;
          let runEnd = runStart;
          while (runEnd < lineText.length && lineText[runEnd] === "`") runEnd++;
          // The opener was already accepted, so a backslash before this run is
          // code content and does not escape the closer.
          if (runEnd - runStart === width) return true;
          cursor = runEnd;
        }
        index++;
        from = 0;
      }
      return false;
    };
  };

  /** Confirmed fenced/indented/HTML/comment block lines for one parse. */
  const blockLinesFor = (nodes: readonly TextMask[], lineCount: number): boolean[] => {
    const lines = new Array<boolean>(lineCount).fill(false);
    for (const node of nodes) markLines(lines, starts, node.from, node.to);
    return lines;
  };

  /**
   * Offset-preserving copy of the input in which characters owned by confirmed
   * math tokens, wiki barriers and frontmatter are spaces. Lezer must never see
   * those delimiters: a backtick inside inline math or inside a wiki target, or
   * one inside YAML, would otherwise open a code span that ends in prose.
   *
   * A backtick run that stays open continues on the next line. Until its
   * exact-width closer is found, the line is code content: masking math there
   * would blank the closer and lose the span. Confirmed literal blocks break
   * that chain: a fence can neither seed a pending opener nor carry one across.
   */
  const maskMathAndFrontmatter = (
    textLines: readonly string[],
    barrierIndex: readonly TextMask[][],
    literalLines: readonly boolean[],
    closerFor: (lineIndex: number, column: number, width: number) => boolean,
  ): string => {
    // A non-breaking space keeps the masked line a paragraph: an ASCII space
    // run at the start of a line would turn it into an indented code block and
    // hide the real code span.
    const maskCharacter = "\u00a0";
    const maskedLines: string[] = [];
    let pendingWidth = 0;
    for (let index = 0; index < textLines.length; index++) {
      const lineText = textLines[index];
      if (index <= frontmatterEnd) {
        maskedLines.push(" ".repeat(lineText.length));
        pendingWidth = 0;
        continue;
      }
      if (literalLines[index]) {
        maskedLines.push(lineText);
        pendingWidth = 0;
        continue;
      }
      if (lineText.length === 0) {
        maskedLines.push("");
        continue;
      }
      let segmentStart = 0;
      if (pendingWidth > 0) {
        const close = closingCodeRunEnd(lineText, 0, pendingWidth);
        if (close === -1) {
          maskedLines.push(lineText);
          continue;
        }
        segmentStart = close;
        pendingWidth = 0;
        if (segmentStart >= lineText.length) {
          maskedLines.push(lineText);
          continue;
        }
      }
      const segmentText = lineText.slice(segmentStart);
      const baseBarriers = clipBarriers(
        barrierIndex[index] ?? [],
        segmentStart,
        lineText.length,
      );
      // A dollar inside a wiki target must not pair with one outside it, and a
      // backtick inside one is link text, not a code opener. An earlier opener
      // with a confirmed closer owns the apparent link, though.
      const wikiBarriers = findWikiBarriers(segmentText, baseBarriers, {
        hasCodeCloser: (column, width) => closerFor(index, segmentStart + column, width),
      });
      const scan = tokenizePreviewLineDetailed(
        segmentText,
        [...baseBarriers, ...wikiBarriers],
      );
      const pendingFrom = scan.unclosedCode
        ? segmentStart + scan.unclosedCode.from
        : -1;
      const characters = lineText.split("");
      for (const wiki of wikiBarriers) {
        const end =
          pendingFrom >= 0 ? Math.min(wiki.to, pendingFrom - segmentStart) : wiki.to;
        for (let cursor = Math.max(0, wiki.from); cursor < end; cursor++) {
          characters[segmentStart + cursor] = maskCharacter;
        }
      }
      for (const token of scan.tokens) {
        if (token.kind === "code") continue;
        const from = segmentStart + token.from;
        // Everything from an unmatched opener onwards is potentially code.
        if (pendingFrom >= 0 && from >= pendingFrom) continue;
        for (let cursor = from; cursor < segmentStart + token.to; cursor++) {
          characters[cursor] = maskCharacter;
        }
      }
      if (scan.unclosedCode) pendingWidth = scan.unclosedCode.width;
      maskedLines.push(characters.join(""));
    }
    return maskedLines.join("\n");
  };

  /** Block nodes come from the normal parse; code candidates from the masked one. */
  const parseDocument = (
    text: string,
    textLines: readonly string[],
  ): {
    blockNodes: TextMask[];
    blockLines: boolean[];
    inlineNodes: TextMask[];
    barrierIndex: TextMask[][];
    closerFor: (lineIndex: number, column: number, width: number) => boolean;
  } => {
    const normal = parse(text);
    const blockLines = blockLinesFor(normal.blockNodes, textLines.length);
    const barrierIndex = createBarrierIndex(
      normal.barrierNodes,
      textLines.map((line) => line.length),
    );
    const closerFor = createCodeCloser(textLines, blockLines);
    const inline = parse(
      maskMathAndFrontmatter(textLines, barrierIndex, blockLines, closerFor),
    );
    return {
      blockNodes: normal.blockNodes,
      blockLines,
      inlineNodes: inline.inlineNodes,
      barrierIndex,
      closerFor,
    };
  };

  const parsed = parseDocument(stripped.join("\n"), stripped);
  const parserLiteral = parsed.blockLines;

  const literal = new Array<boolean>(lines.length).fill(false);
  for (let index = 0; index <= frontmatterEnd && index < literal.length; index++) {
    literal[index] = true;
  }

  // Multi-line inline code: one ownership resolver. The command marks accepted
  // lines literal; Live Preview masks only the code characters and scans the
  // rest. Accepted ranges are keyed by opener so a later reparse can never add
  // a second span that reuses an opener already owned.
  const acceptedByFrom = new Map<number, TextMask>();
  const acceptedFroms: number[] = [];
  const multilineLines = new Array<boolean>(lines.length).fill(false);
  // Line-relative end of accepted code on each line. Math ownership for a new
  // opener starts after it, so an accepted prefix cannot pair delimiters.
  const lineOwnedTo = new Array<number>(lines.length).fill(0);
  const baseSkip = parserLiteral.map(
    (value, index) => value || index <= frontmatterEnd,
  );

  const addAccepted = (from: number, to: number): boolean => {
    if (acceptedByFrom.has(from)) return false;
    let low = 0;
    let high = acceptedFroms.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (acceptedFroms[middle] < from) low = middle + 1;
      else high = middle;
    }
    // A conflicting provisional span is rejected instead of appended: the
    // line map would otherwise hold two owners for the same characters.
    const previous = low > 0 ? acceptedByFrom.get(acceptedFroms[low - 1]) : undefined;
    if (previous && previous.to > from) return false;
    const following = acceptedByFrom.get(acceptedFroms[low]);
    if (following && following.from < to) return false;
    acceptedByFrom.set(from, { from, to });
    acceptedFroms.splice(low, 0, from);
    for (
      let index = lineIndexAt(starts, from);
      index < multilineLines.length && starts[index] < to;
      index++
    ) {
      multilineLines[index] = true;
      const lineFrom = starts[index];
      const ownedTo = Math.min(to, lineFrom + stripped[index].length) - lineFrom;
      if (ownedTo > lineOwnedTo[index]) lineOwnedTo[index] = ownedTo;
    }
    return true;
  };

  /** Already-accepted code owns this offset: a new opener there is content. */
  const isInsideAcceptedCode = (offset: number): boolean => {
    let low = 0;
    let high = acceptedFroms.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (acceptedFroms[middle] <= offset) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (found === -1) return false;
    const range = acceptedByFrom.get(acceptedFroms[found]);
    return range !== undefined && range.to > offset;
  };

  /**
   * Display-math ownership for one candidate order. The scan is advanced only
   * up to the line of the candidate being decided, so accepted code lines are
   * already known when the scanner reaches them and their `$$` cannot open a
   * block. This keeps the pass linear and single.
   */
  const createMathTracker = (
    sourceLines: readonly string[],
    skipLines: readonly boolean[],
  ): { owned: boolean[]; advanceTo: (lineIndex: number) => void } => {
    const owned = new Array<boolean>(sourceLines.length).fill(false);
    let cursor = 0;
    let inBlock = false;
    const advanceTo = (lineIndex: number): void => {
      while (cursor <= lineIndex && cursor < sourceLines.length) {
        const index = cursor;
        const line = sourceLines[index].replace(/\r$/, "");
        const candidate = stripMathMarkers(line);
        if (inBlock) {
          owned[index] = true;
          if (closesDisplayMath(candidate, standaloneDisplay)) inBlock = false;
        } else if (!skipLines[index] && !multilineLines[index]) {
          if (opensDisplayMath(candidate, standaloneDisplay)) {
            owned[index] = true;
            inBlock = true;
          }
        }
        cursor++;
      }
    };
    return { owned, advanceTo };
  };

  const collectInline = (
    nodes: readonly TextMask[],
    sourceLines: readonly string[],
    skipLines: readonly boolean[],
    barrierIndex: readonly TextMask[][],
    closerFor: (lineIndex: number, column: number, width: number) => boolean,
  ): void => {
    const tracker = createMathTracker(sourceLines, skipLines);
    const tokenCache = new Map<string, InlineToken[]>();
    const wikiCache = new Map<number, TextMask[]>();
    const wikiForLine = (lineIndex: number): TextMask[] => {
      const cached = wikiCache.get(lineIndex);
      if (cached) return cached;
      const lineText = sourceLines[lineIndex] ?? "";
      const wikiBarriers = findWikiBarriers(lineText, barrierIndex[lineIndex] ?? [], {
        hasCodeCloser: (column, width) => closerFor(lineIndex, column, width),
      });
      wikiCache.set(lineIndex, wikiBarriers);
      return wikiBarriers;
    };
    /**
     * Math tokens that may own a new opener on `lineIndex`. Text already owned
     * by accepted code is skipped: re-tokenizing it as fresh prose lets its
     * dollars pair across a later opener.
     */
    const tokensForOpener = (lineIndex: number, column: number): InlineToken[] => {
      const start = Math.min(lineOwnedTo[lineIndex], column);
      const key = `${lineIndex}:${start}`;
      const cached = tokenCache.get(key);
      if (cached) return cached;
      const lineText = sourceLines[lineIndex] ?? "";
      let tokens: InlineToken[] = [];
      if (start < lineText.length) {
        const segmentText = lineText.slice(start);
        const lineBarriers = clipBarriers(
          barrierIndex[lineIndex] ?? [],
          start,
          lineText.length,
        );
        const wikiBarriers = findWikiBarriers(segmentText, lineBarriers, {
          hasCodeCloser: (segmentColumn, width) =>
            closerFor(lineIndex, start + segmentColumn, width),
        });
        tokens = tokenizePreviewLine(segmentText, [
          ...lineBarriers,
          ...wikiBarriers,
        ]).map((token) => ({
          from: token.from + start,
          to: token.to + start,
          kind: token.kind,
        }));
      }
      tokenCache.set(key, tokens);
      return tokens;
    };
    // Source order is what gives one delimiter one owner.
    const ordered = [...nodes].sort((a, b) => a.from - b.from);
    for (const node of ordered) {
      const first = lineIndexAt(starts, node.from);
      const last = lineIndexAt(starts, Math.max(node.from, node.to - 1));
      // Single-line spans are the line tokenizer's business; check this before
      // tokenizing so a line with many spans is not retokenized per span.
      if (first === last) continue;
      if (first <= frontmatterEnd) continue;
      if (isInsideAcceptedCode(node.from)) continue;
      const column = node.from - starts[first];
      // A backtick inside a confirmed wiki target is link text, not an opener.
      if (
        wikiForLine(first).some(
          (barrier) => barrier.from <= column && column < barrier.to,
        )
      ) {
        continue;
      }
      tracker.advanceTo(first);
      if (startsInsideDisplayMath(sourceLines, tracker.owned, first, column, standaloneDisplay)) {
        continue;
      }
      const insideMath = tokensForOpener(first, column).some(
        (token) => token.kind !== "code" && token.from <= column && column < token.to,
      );
      if (insideMath) continue;
      addAccepted(node.from, node.to);
    }
  };
  collectInline(
    parsed.inlineNodes,
    stripped,
    baseSkip,
    parsed.barrierIndex,
    parsed.closerFor,
  );
  if (markMultiline) {
    for (let index = 0; index < literal.length; index++) {
      if (multilineLines[index]) literal[index] = true;
    }
  }
  const { ends: blockEnds } = mathRegions(
    stripped,
    starts,
    standaloneDisplay,
    baseSkip.map((value, index) => value || multilineLines[index]),
  );

  // `$$` blocks are Obsidian syntax the parser does not know. They are found
  // line by line, and the document is reparsed after blanking them so a fence
  // inside math or frontmatter cannot suppress a later opener. The loop runs
  // until neither parse adds a new literal line.
  const characters = stripped.join("\n").split("");
  const blankRange = (from: number, to: number): void => {
    blankCharacters(characters, from, to);
  };
  for (let index = 0; index <= frontmatterEnd && index < stripped.length; index++) {
    blankRange(starts[index], starts[index] + stripped[index].length);
  }
  for (const node of parsed.inlineNodes) {
    const first = lineIndexAt(starts, node.from);
    const last = lineIndexAt(starts, Math.max(node.from, node.to - 1));
    if (first === last) continue;
    const accepted = acceptedByFrom.get(node.from);
    if (accepted) {
      const end =
        blockEnds[first] >= 0 ? Math.min(accepted.to, blockEnds[first]) : accepted.to;
      blankRange(node.from, end);
      continue;
    }
    // Rejected (math-owned): blank only its opening line, so a real code
    // opener on a later line is not erased with the apparent closer.
    blankRange(node.from, starts[first] + stripped[first].length);
  }

  const scanMath = (blockLiteral: readonly boolean[]): boolean[] => {
    const math = new Array<boolean>(lines.length).fill(false);
    let inMathBlock = false;
    for (let index = 0; index < stripped.length; index++) {
      if (inMathBlock) {
        math[index] = true;
        const closes = closesDisplayMath(stripMathMarkers(stripped[index]), standaloneDisplay);
        if (closes) inMathBlock = false;
        continue;
      }
      if (blockLiteral[index] || literal[index] || multilineLines[index]) continue;
      const opens = opensDisplayMath(stripMathMarkers(stripped[index]), standaloneDisplay);
      if (opens) {
        math[index] = true;
        inMathBlock = true;
      }
    }
    return math;
  };

  let blockLiteral: boolean[] = parserLiteral;
  let lastParsedText = stripped.join("\n");
  for (let pass = 0; pass < 3; pass++) {
    let added = false;
    const math = scanMath(blockLiteral);
    for (let index = 0; index < math.length; index++) {
      if (!math[index]) continue;
      // Blank every math line, including lines an earlier pass marked literal
      // by a wrong block classification; otherwise a fence inside math keeps
      // splitting the rest of the document.
      blankRange(starts[index], starts[index] + stripped[index].length);
      if (!literal[index]) {
        literal[index] = true;
        added = true;
      }
    }

    // Same input as the previous parse: a reparse cannot reveal anything new.
    // Apply the block map the reparse would have produced and stop; this keeps
    // documents without math, code or frontmatter to two parses.
    const reparsedText = characters.join("");
    if (reparsedText === lastParsedText) {
      for (let index = 0; index < blockLiteral.length; index++) {
        if (blockLiteral[index]) literal[index] = true;
      }
      break;
    }
    lastParsedText = reparsedText;
    const reparsedLines = reparsedText.split("\n");
    const reparsed = parseDocument(reparsedText, reparsedLines);
    const nextBlock = new Array<boolean>(lines.length).fill(false);
    for (const node of reparsed.blockNodes) {
      markLines(nextBlock, starts, node.from, node.to);
    }
    const reparseSkip = nextBlock.map(
      (value, index) => value || index <= frontmatterEnd,
    );
    let blockChanged = false;
    for (let index = 0; index < nextBlock.length; index++) {
      if (nextBlock[index] !== blockLiteral[index]) blockChanged = true;
      if (nextBlock[index] && !literal[index]) {
        literal[index] = true;
        added = true;
      }
    }
    collectInline(
      reparsed.inlineNodes,
      reparsedLines,
      reparseSkip,
      reparsed.barrierIndex,
      reparsed.closerFor,
    );
    if (markMultiline) {
      for (let index = 0; index < literal.length; index++) {
        if (multilineLines[index]) literal[index] = true;
      }
    }
    blockLiteral = nextBlock;
    if (!added && !blockChanged) break;
  }

  if (codeRanges) {
    const toOriginal = (offset: number): number => {
      const index = lineIndexAt(starts, offset);
      const delta = originalStarts[index] - starts[index];
      return offset + delta + (index === 0 ? bomOffset : 0);
    };
    const accepted = [...acceptedByFrom.values()].sort((a, b) => a.from - b.from);
    for (const range of accepted) {
      codeRanges.push({ from: toOriginal(range.from), to: toOriginal(range.to) });
    }
  }
  return literal;
}

/**
 * Scan an entire document for CJK emphasis fixes.
 *
 * Lines inside fenced code, `$$` math blocks and indented code are content,
 * not prose: their markers are literal and must never be rewritten.
 */
const DOCUMENT_BARRIER_NODES = new Set(["URL", "LinkTitle", "HTMLTag", "Comment", "Entity"]);

/** Syntax nodes whose lines are never rewritten by the command. */
const PROTECTED_LINE_NODES = new Set([
  "Link",
  "Image",
  "URL",
  "LinkTitle",
  "LinkReference",
  "LinkLabel",
  "HTMLTag",
  "Comment",
  "CommentBlock",
  "Entity",
  "InlineCode",
  "FencedCode",
  "CodeBlock",
]);

/** Syntax ranges the command must not edit, even on a line that looks prose. */
function findDocumentBarriers(text: string): TextMask[] {
  const barriers: TextMask[] = [];
  markdownParser.parse(text).iterate({
    enter(node) {
      if (DOCUMENT_BARRIER_NODES.has(node.name)) {
        barriers.push({ from: node.from, to: node.to });
      }
    },
  });
  return barriers;
}

/** `%%...%%` comments, where token ranges outside a comment are opaque. */
function findCommentRanges(text: string, tokens: readonly TextMask[] = []): TextMask[] {
  const sorted = [...tokens].sort((a, b) => a.from - b.from);
  const ranges: TextMask[] = [];
  let index = 0;
  let tokenIndex = 0;
  while (index < text.length) {
    while (tokenIndex < sorted.length && sorted[tokenIndex].to <= index) tokenIndex++;
    const token = sorted[tokenIndex];
    if (token && token.from <= index && index < token.to) {
      index = token.to;
      continue;
    }
    if (text.startsWith("%%", index)) {
      const close = text.indexOf("%%", index + 2);
      if (close === -1) break;
      ranges.push({ from: index, to: close + 2 });
      index = close + 2;
      continue;
    }
    index++;
  }
  return ranges;
}

export function findDocumentFixes(text: string): SourceFix[] {
  // The source rewrite only runs on notes without syntax the line scanner does
  // not model. One character of link, HTML, math, comment, inline-code, table
  // or entity syntax disables the command for the whole note; this is a
  // deliberate safety gate, not a parser.
  if (/[\][<!$|%`&]/.test(text)) return [];
  const fixes: SourceFix[] = [];
  const lines = text.split("\n");
  const literal = findLiteralLines(lines);
  // Mask by ranges, not whole lines: a line that ends a multi-line code span
  // can also hold a link opener, and blanking it wholesale would hide that
  // syntax from the barrier pass. Code/math/frontmatter ranges are blanked;
  // literal lines with no parser range (math, frontmatter) are blanked whole.
  const starts = lineStartsFor(lines);
  const documentTree = markdownParser.parse(text);
  const blockLiteral = new Array<boolean>(lines.length).fill(false);
  const protectedLines = new Array<boolean>(lines.length).fill(false);
  const inlineRanges: TextMask[] = [];
  documentTree.iterate({
    enter(node) {
      if (
        node.name === "Link" ||
        node.name === "Image" ||
        node.name === "URL" ||
        node.name === "LinkTitle" ||
        node.name === "LinkReference" ||
        node.name === "LinkLabel" ||
        node.name === "HTMLTag" ||
        node.name === "Comment" ||
        node.name === "CommentBlock" ||
        node.name === "Entity" ||
        node.name === "InlineCode"
      ) {
        markLines(protectedLines, starts, node.from, node.to);
      }
      if (
        node.name === "FencedCode" ||
        node.name === "CodeBlock" ||
        node.name === "HTMLBlock" ||
        node.name === "CommentBlock"
      ) {
        markLines(blockLiteral, starts, node.from, node.to);
      } else if (node.name === "InlineCode") {
        inlineRanges.push({ from: node.from, to: node.to });
      }
    },
  });
  const frontmatterEnd = findFrontmatterEnd(lines);
  const mathSkip = blockLiteral.map(
    (value, index) => value || index <= frontmatterEnd,
  );
  const { open: mathOpen, ends: blockEnds } = mathRegions(
    lines,
    starts,
    false,
    mathSkip,
  );
  const usableInline: TextMask[] = [];
  const characters = text.split("");
  const blankRange = (from: number, to: number): void => {
    for (let index = Math.max(0, from); index < Math.min(characters.length, to); index++) {
      if (characters[index] !== "\n") characters[index] = " ";
    }
  };
  for (const range of inlineRanges) {
    const first = lineIndexAt(starts, range.from);
    const column = range.from - starts[first];
    if (startsInsideDisplayMath(lines, mathOpen, first, column, false)) {
      // Math content only up to the end of that math block; the closing
      // backtick can be a real code opener in the following prose.
      const blockEnd = blockEnds[first] >= 0 ? blockEnds[first] : range.to;
      blankRange(range.from, Math.min(range.to, blockEnd));
      continue;
    }
    usableInline.push(range);
    blankRange(range.from, range.to);
  }
  for (let index = 0; index < lines.length; index++) {
    if (!literal[index]) continue;
    const lineFrom = starts[index];
    const lineTo = lineFrom + lines[index].length;
    // Frontmatter is one region: even when the Markdown parser reports inline
    // code inside it, the whole YAML line stays protected.
    if (index <= frontmatterEnd) {
      blankRange(lineFrom, lineTo);
      continue;
    }
    // A line that ends a multi-line code span can also hold link syntax; only
    // the code characters are blanked there, never the whole line.
    const touched = usableInline.some(
      (range) => range.from < lineTo && lineFrom < range.to,
    );
    if (!touched) blankRange(lineFrom, lineTo);
  }
  const masked = characters.join("");
  const maskedTree = markdownParser.parse(masked);
  maskedTree.iterate({
    enter(node) {
      if (PROTECTED_LINE_NODES.has(node.name)) {
        markLines(protectedLines, starts, node.from, node.to);
      }
    },
  });
  const documentBarriers = findDocumentBarriers(masked);
  // Comments: blank code and same-line math tokens first so a `%%` inside them
  // cannot pair with a real comment opener. Already-known URL/HTML/title
  // barriers apply here too.
  const tokenRanges: TextMask[] = [];
  for (let index = 0; index < lines.length; index++) {
    const lineText = lines[index].endsWith("\r") ? lines[index].slice(0, -1) : lines[index];
    const lineFrom = starts[index];
    const lineTo = lineFrom + lineText.length;
    const lineBarriers: TextMask[] = [];
    for (const barrier of documentBarriers) {
      if (barrier.from >= lineTo || barrier.to <= lineFrom) continue;
      lineBarriers.push({
        from: Math.max(barrier.from, lineFrom) - lineFrom,
        to: Math.min(barrier.to, lineTo) - lineFrom,
      });
    }
    for (const token of tokenizePreviewLine(lineText, lineBarriers)) {
      tokenRanges.push({ from: lineFrom + token.from, to: lineFrom + token.to });
    }
    const wikiPattern = /!?\[\[[^\]\n]*\]\]/g;
    let wikiMatch: RegExpExecArray | null;
    while ((wikiMatch = wikiPattern.exec(lineText)) !== null) {
      tokenRanges.push({
        from: lineFrom + wikiMatch.index,
        to: lineFrom + wikiMatch.index + wikiMatch[0].length,
      });
    }
  }
  for (const barrier of documentBarriers) tokenRanges.push(barrier);
  const barriers = [...documentBarriers, ...findCommentRanges(text, tokenRanges)];
  let lineFrom = 0;

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const lineText = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!literal[index] && !protectedLines[index]) {
      for (const fix of findSourceFixes(lineText)) {
        const from = lineFrom + fix.from;
        const to = lineFrom + fix.to;
        if (barriers.some((barrier) => barrier.from < to && from < barrier.to)) {
          continue;
        }
        fixes.push({ from, to, replacement: fix.replacement });
      }
    }
    lineFrom += raw.length + 1;
  }
  return fixes;
}
