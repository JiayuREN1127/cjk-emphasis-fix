import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  EditorView,
} from "@codemirror/view";
import { Extension, Prec, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { editorLivePreviewField } from "obsidian";
import { getSettings } from "./settings";
import { scanLine, EmphasisMatch } from "./scanner";

interface DocRange {
  from: number;
  to: number;
}

/**
 * Emphasis runs the parser actually produced. Obsidian sometimes produces a
 * run wider than what the author marked: when the closing delimiter fails the
 * flanking rule the run stays open and everything up to the end of the
 * paragraph is styled. Those ranges let the excess be neutralised.
 */
function collectParserEmphasis(view: EditorView): DocRange[] {
  const ranges: DocRange[] = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      const name = node.name;
      if (name.includes("formatting") || name.includes("Formatting")) return;
      const isDelimited =
        name.includes("strong") ||
        name.includes("em") ||
        name.includes("highlight") ||
        name.includes("strikethrough") ||
        name.includes("strike");
      if (!isDelimited) return;
      if (name.includes("mark") || name.includes("Mark")) return;
      ranges.push({ from: node.from, to: node.to });
    },
  });
  return ranges;
}

/**
 * Class names Obsidian itself uses, so themes style the marked span the same
 * way they style regular emphasis (bold colour, highlight background, ...).
 */
function classesFor(kind: EmphasisMatch["kind"]): string[] {
  switch (kind) {
    case "strong-em":
      return ["cm-strong", "cm-em", "cm-cjk-strong-em"];
    case "strong":
      return ["cm-strong", "cm-cjk-strong"];
    case "highlight":
      return ["cm-highlight", "cm-cjk-highlight"];
    case "strike":
      return ["cm-strikethrough", "cm-cjk-strike"];
    default:
      return ["cm-em", "cm-cjk-emphasis"];
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const settings = getSettings();
  if (!settings.enableLivePreviewFix) return Decoration.none;

  // Source mode shows raw markdown; decorations would corrupt it visually.
  const livePreview = view.state.field(editorLivePreviewField, false);
  if (livePreview === false) return Decoration.none;

  const decorations: Range<Decoration>[] = [];
  const doc = view.state.doc;
  const parserRanges = collectParserEmphasis(view);
  const cursorHead = view.state.selection.main.head;

  const marks = new Map<string, Decoration>();
  const markFor = (kind: EmphasisMatch["kind"]) => {
    let mark = marks.get(kind);
    if (!mark) {
      mark = Decoration.mark({ class: classesFor(kind).join(" ") });
      marks.set(kind, mark);
    }
    return mark;
  };

  const hideMarkerMark = Decoration.mark({ class: "cm-cjk-hide-marker" });
  const plainMark = Decoration.mark({ class: "cm-cjk-plain" });
  const neutralised = new Set<string>();

  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;

    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
      const line = doc.line(lineNumber);
      const { matches } = scanLine(line.text);
      if (matches.length === 0) continue;

      const cursorOnLine = cursorHead >= line.from && cursorHead <= line.to;
      const lineParser = parserRanges.filter(
        (range) => range.from < line.to && range.to > line.from,
      );

      for (const match of matches) {
        const mFrom = line.from + match.from;
        const mTo = line.from + match.to;
        const cFrom = line.from + match.contentFrom;
        const cTo = line.from + match.contentTo;

        // The parser node starts at the content, not at the opening delimiter.
        // If it reaches past the closing delimiter, the editor is styling
        // characters the author did not mark.
        const covering = lineParser.find(
          (range) => range.from <= cFrom && range.to >= cTo,
        );
        if (covering && covering.to > mTo) {
          const resetFrom = mTo;
          const resetTo = Math.min(covering.to, line.to);
          const key = `${resetFrom}:${resetTo}`;
          if (resetTo > resetFrom && !neutralised.has(key)) {
            neutralised.add(key);
            decorations.push(plainMark.range(resetFrom, resetTo));
          }
        }

        // Always style the content: the syntax tree is not a reliable signal
        // that the editor rendered it, and restyling is harmless.
        decorations.push(markFor(match.kind).range(cFrom, cTo));

        if (!(settings.keepMarkersNearCursor && cursorOnLine)) {
          const delimiter = match.delimiterLength;
          decorations.push(hideMarkerMark.range(mFrom, mFrom + delimiter));
          decorations.push(hideMarkerMark.range(mTo - delimiter, mTo));
        }
      }
    }
  }

  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(decorations, true);
}

const cjkEmphasisViewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (view) => view.decorations,
  },
);

const cjkEmphasisTheme = EditorView.baseTheme({
  // Everything the editor's own emphasis styling would normally add is rolled
  // back to the surrounding plain-text appearance. Theme colours come from
  // Obsidian's own variables, so nothing is hard-coded.
  // Doubled selector so this outranks any single-class theme rule, and the
  // properties cover everything themes commonly attach to emphasis: colour,
  // weight, style, background, underline and shadow. Colours come from
  // Obsidian's own variables so each theme keeps its own palette.
  ".cm-cjk-plain.cm-cjk-plain": {
    color: "var(--text-normal) !important",
    fontWeight: "normal !important",
    fontStyle: "normal !important",
    textDecoration: "none !important",
    backgroundColor: "transparent !important",
    textShadow: "none !important",
    borderBottom: "none !important",
    letterSpacing: "normal !important",
  },
  ".cm-cjk-hide-marker": {
    fontSize: "0 !important",
    overflow: "hidden !important",
  },
});

export function cjkEmphasisExtension(): Extension {
  return [Prec.highest(cjkEmphasisViewPlugin), cjkEmphasisTheme];
}

export type { EmphasisMatch };
