import {
  hasCJKRelatedContent,
  isPunctuation,
  isWhitespace,
  isWhitespaceOrPunctuation,
} from "./cjk";

export type EmphasisKind = "em" | "strong" | "strong-em";

export interface EmphasisMatch {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  delimiterLength: 1 | 2 | 3;
  kind: EmphasisKind;
  cjkRelated: boolean;
}

export interface TextMask {
  from: number;
  to: number;
}

function overlaps(a: TextMask, b: TextMask): boolean {
  return a.from < b.to && b.from < a.to;
}

function findBacktickMasks(text: string): TextMask[] {
  const masks: TextMask[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      i++;
      continue;
    }
    let runEnd = i + 1;
    while (runEnd < text.length && text[runEnd] === "`") runEnd++;
    const delimiter = text.slice(i, runEnd);
    const close = text.indexOf(delimiter, runEnd);
    if (close === -1) {
      i = runEnd;
      continue;
    }
    masks.push({ from: i, to: close + delimiter.length });
    i = close + delimiter.length;
  }
  return masks;
}

function findDisplayMathMasks(text: string): TextMask[] {
  const masks: TextMask[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("$$", i);
    if (open === -1) break;
    const close = text.indexOf("$$", open + 2);
    if (close === -1) break;
    masks.push({ from: open, to: close + 2 });
    i = close + 2;
  }
  return masks;
}

export function findMasks(text: string): TextMask[] {
  return [...findBacktickMasks(text), ...findDisplayMathMasks(text)].sort(
    (a, b) => a.from - b.from,
  );
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
  delimiterLength: 1 | 2 | 3,
): EmphasisMatch | null {
  if (contentFrom >= contentTo) return null;
  const content = text.slice(contentFrom, contentTo);
  if (/^\s/u.test(content) || /\s$/u.test(content)) return null;

  const cjkRelated = hasCJKRelatedContent(content);
  if (!cjkRelated) return null;

  const after = text.codePointAt(to);
  const relaxedClosingBoundary =
    cjkRelated && !isWhitespaceOrPunctuation(after);

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
    delimiterLength,
    kind: delimiterLength === 3 ? "strong-em" : delimiterLength === 2 ? "strong" : "em",
    cjkRelated,
  };
}

function scanWithRegex(
  text: string,
  start: number,
  end: number,
  expression: RegExp,
  delimiterLength: 1 | 2 | 3,
  consumed: TextMask[],
): EmphasisMatch[] {
  const segment = text.slice(start, end);
  const matches: EmphasisMatch[] = [];
  expression.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(segment)) !== null) {
    const from = start + match.index;
    const to = from + match[0].length;
    const range = { from, to };
    if (consumed.some((item) => overlaps(item, range))) continue;

    const contentFrom = from + delimiterLength;
    const contentTo = to - delimiterLength;
    const candidate = isValidCandidate(
      text,
      from,
      to,
      contentFrom,
      contentTo,
      delimiterLength,
    );
    if (!candidate) continue;

    matches.push(candidate);
    consumed.push(range);
  }
  return matches;
}

export function scanLine(text: string): { matches: EmphasisMatch[]; masks: TextMask[] } {
  const masks = findMasks(text);
  const consumed: TextMask[] = [];
  const matches: EmphasisMatch[] = [];
  const segments: TextMask[] = [];
  let cursor = 0;
  for (const mask of masks) {
    if (cursor < mask.from) segments.push({ from: cursor, to: mask.from });
    cursor = Math.max(cursor, mask.to);
  }
  if (cursor < text.length) segments.push({ from: cursor, to: text.length });

  for (const segment of segments) {
    // Strong+italic must be found before strong and italic.
    matches.push(
      ...scanWithRegex(
        text,
        segment.from,
        segment.to,
        /\*\*\*(.+?)\*\*\*/g,
        3,
        consumed,
      ),
    );
    matches.push(
      ...scanWithRegex(
        text,
        segment.from,
        segment.to,
        /(?<!\*)\*\*(.+?)\*\*(?!\*)/g,
        2,
        consumed,
      ),
    );
    matches.push(
      ...scanWithRegex(
        text,
        segment.from,
        segment.to,
        /(?<!\*)\*([^*\n]+)\*(?!\*)/g,
        1,
        consumed,
      ),
    );
  }

  return {
    matches: matches.sort((a, b) => a.from - b.from),
    masks,
  };
}

export function trailingPunctuationLength(text: string, from: number, to: number): number {
  let cursor = to;
  while (cursor > from) {
    const code = text.codePointAt(cursor - 1);
    if (code === undefined || !isPunctuation(code)) break;
    cursor -= code > 0xffff ? 2 : 1;
  }
  return to - cursor;
}

export interface SourceFix {
  from: number;
  to: number;
  replacement: string;
}

export function findSourceFixes(text: string): SourceFix[] {
  const { matches, masks } = scanLine(text);
  const fixes: SourceFix[] = [];
  for (const match of matches) {
    if (isMasked(match.from, masks)) continue;
    const after = text.codePointAt(match.to);
    if (after === undefined || isWhitespaceOrPunctuation(after)) continue;

    const punctLength = trailingPunctuationLength(text, match.contentFrom, match.contentTo);
    if (punctLength === 0) continue;

    const contentWithoutPunctuation = text.slice(
      match.contentFrom,
      match.contentTo - punctLength,
    );
    const delimiter = text.slice(match.from, match.contentFrom);
    const punctuation = text.slice(match.contentTo - punctLength, match.contentTo);
    fixes.push({
      from: match.from,
      to: match.to,
      replacement: `${delimiter}${contentWithoutPunctuation}${delimiter}${punctuation}`,
    });
  }
  return fixes;
}

/**
 * Scan an entire document (not just a single line) for CJK emphasis fixes.
 * Skips fenced code blocks so inline `**` inside code is never touched.
 */
export function findDocumentFixes(text: string): SourceFix[] {
  const fixes: SourceFix[] = [];
  const lines = text.split("\n");
  let inFence: string | null = null;
  let lineFrom = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineText = lines[lineIndex];
    const lineLeading = lineText.match(/^(\s*)/)?.[1] ?? "";

    // Fence toggling: ``` or ~~~ at start (after leading whitespace)
    const fenceMatch = lineText.slice(lineLeading.length).match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      if (!inFence) {
        inFence = fence;
        lineFrom += lineText.length + 1;
        continue;
      } else if (fence[0] === inFence[0] && fence.length >= inFence.length) {
        inFence = null;
        lineFrom += lineText.length + 1;
        continue;
      }
    }
    if (!inFence) {
      for (const fix of findSourceFixes(lineText)) {
        fixes.push({
          from: lineFrom + fix.from,
          to: lineFrom + fix.to,
          replacement: fix.replacement,
        });
      }
    }
    lineFrom += lineText.length + 1;
  }
  return fixes;
}
