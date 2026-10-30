import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  EditorView,
} from "@codemirror/view";
import { Extension, Prec, Range } from "@codemirror/state";
import { editorLivePreviewField } from "obsidian";
import { getSettings } from "./settings";
import { scanLine, EmphasisMatch } from "./scanner";

/**
 * Class names Obsidian itself uses for these runs. Reusing them means themes
 * style the marked span exactly the way they style regular emphasis (bold
 * colour, highlight background, and so on) instead of us inventing a look.
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
  const cursorHead = view.state.selection.main.head;

  const marks = new Map<string, Decoration>();
  const markFor = (kind: EmphasisMatch["kind"]) => {
    const key = kind;
    let mark = marks.get(key);
    if (!mark) {
      mark = Decoration.mark({ class: classesFor(kind).join(" ") });
      marks.set(key, mark);
    }
    return mark;
  };

  const hideMarkerMark = Decoration.mark({ class: "cm-cjk-hide-marker" });

  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;

    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
      const line = doc.line(lineNumber);
      const { matches } = scanLine(line.text);
      if (matches.length === 0) continue;

      const cursorOnLine = cursorHead >= line.from && cursorHead <= line.to;

      for (const match of matches) {
        const mFrom = line.from + match.from;
        const mTo = line.from + match.to;
        const cFrom = line.from + match.contentFrom;
        const cTo = line.from + match.contentTo;

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
  ".cm-cjk-hide-marker": {
    fontSize: "0 !important",
    overflow: "hidden !important",
  },
});

export function cjkEmphasisExtension(): Extension {
  return [Prec.highest(cjkEmphasisViewPlugin), cjkEmphasisTheme];
}

export type { EmphasisMatch };
