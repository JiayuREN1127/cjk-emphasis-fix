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

function collectParserEmphasis(view: EditorView): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      const name = node.name;
      if (name.includes("formatting")) return;
      const isDelimited =
        name.includes("strong") ||
        name.includes("em") ||
        name.includes("highlight") ||
        name.includes("strikethrough") ||
        name.includes("strike");
      if (!isDelimited) return;
      // Skip marker nodes such as EmphasisMark or HighlightMark.
      if (name.includes("mark") || name.includes("FormattingMark")) return;
      ranges.push({ from: node.from, to: node.to });
    },
  });
  return ranges;
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

  const strongMark = Decoration.mark({ class: "cm-cjk-strong" });
  const emMark = Decoration.mark({ class: "cm-cjk-emphasis" });
  const strongEmMark = Decoration.mark({ class: "cm-cjk-strong-em" });
  const highlightMark = Decoration.mark({ class: "cm-cjk-highlight" });
  const strikeMark = Decoration.mark({ class: "cm-cjk-strike" });
  const hideMarkerMark = Decoration.mark({ class: "cm-cjk-hide-marker" });

  const markFor = (kind: EmphasisMatch["kind"]) => {
    switch (kind) {
      case "strong-em":
        return strongEmMark;
      case "strong":
        return strongMark;
      case "highlight":
        return highlightMark;
      case "strike":
        return strikeMark;
      default:
        return emMark;
    }
  };

  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;

    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
      const line = doc.line(lineNumber);
      const { matches } = scanLine(line.text);
      const cursorOnLine = cursorHead >= line.from && cursorHead <= line.to;

      for (const match of matches) {
        const mFrom = line.from + match.from;
        const mTo = line.from + match.to;
        const cFrom = line.from + match.contentFrom;
        const cTo = line.from + match.contentTo;

        const parserHandled = parserRanges.some(
          (parser) => parser.from <= cFrom && parser.to >= cTo,
        );

        if (!parserHandled) {
          decorations.push(markFor(match.kind).range(cFrom, cTo));
        }

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
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (view) => view.decorations,
  },
);

const cjkEmphasisTheme = EditorView.baseTheme({
  ".cm-cjk-strong": {
    fontWeight: "bold !important",
  },
  ".cm-cjk-emphasis": {
    fontStyle: "italic !important",
  },
  ".cm-cjk-strong-em": {
    fontWeight: "bold !important",
    fontStyle: "italic !important",
  },
  ".cm-cjk-highlight": {
    backgroundColor: "var(--text-highlight-bg) !important",
  },
  ".cm-cjk-strike": {
    textDecoration: "line-through !important",
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