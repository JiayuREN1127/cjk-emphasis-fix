---
status: accepted
date: 2026-11-23
decision-makers: syx828
---

# Bundle @lezer/markdown for literal-region detection

## Context and Problem Statement

The plugin has to decide which parts of a note are literal text before it either
decorates a line in Live Preview or rewrites source with the "fix current note"
command. Literal means fenced code, indented code, HTML blocks, inline code,
`$$` math blocks and YAML frontmatter: regions where `**` and `*` are content,
not delimiters.

That decision is currently a hand-written, line-based state machine
(`findLiteralLines` in `src/scanner.ts`). Four review rounds found cases where it
disagrees with a CommonMark parser, and the disagreement is destructive because
the rewrite command edits the note:

- `-     *字。*后` is indented code inside a list item; the classifier reports it
  as prose and rewrites it.
- `- ~~~\n\n  *字。*后` is one fence across a blank line; the blank line is read
  as the fence ending.
- `- a\n  ~~~\n~~~\n*字。*后` opens the fence inside the item, but the
  unindented line is taken as its closer.
- `10. a\n    ~~~\n    *字。*后` and `- a\n    - ~~~\n      *字。*后` fail the
  same way for ordered and nested items.
- `- <pre>` and `> <pre>` do not end with their container.
- `# h\n    *字。*后` is indented code after a heading; the classifier requires a
  preceding blank line.
- `` `\n*字。*后` `` is one inline code span across two lines; each line is
  scanned on its own.

Each fix so far added another rule to the approximation. The rules being
approximated (list content columns, blockquote containers and lazy
continuation, seven HTML block types, multiline code spans) are a Markdown block
parser. The plugin's own tests cannot prove the approximation matches what
Obsidian renders.

## Decision

Bundle `@lezer/markdown` inside the plugin and derive literal regions from its
syntax tree. Keep the existing CJK emphasis detection and decorations unchanged;
only the "is this text literal" question moves from hand-written rules to the
parser.

`@lezer/markdown` is the parser behind CodeMirror's Markdown mode, which is what
Obsidian's Live Preview uses, so block boundaries follow the same rules as the
editor. The plugin bundles its own copy; it does not replace, patch or call into
Obsidian's parser or its reading-view renderer.

YAML frontmatter and `$$` math blocks are not CommonMark and stay on the small
existing line-level heuristics, layered on top of the parser ranges.

Non-goals:

- changing Obsidian's parser or reading-view rendering;
- fixing PDF export or automatic rewriting on save;
- changing CJK emphasis flanking behaviour or the decoration styling;
- keeping the hand-written classifier alongside the parser.

## Consequences

- Good: destructive rewrites of literal content stop being a per-case bug; the
  tree reports the same block structure the editor uses.
- Good: classification runs in plain Node, so the review counterexamples become
  ordinary tests instead of manual reasoning about containers.
- Good: preview and command keep sharing one map, so they cannot disagree about
  what is code.
- Bad: `main.js` grows by the parser (expected tens of KB; measure and record).
- Bad: one more dependency to track; node names in the tree become an API
  surface to verify on upgrades.
- Bad: tests that encode the hand-written container rules must be rewritten to
  match parser output, and a few will legitimately change behaviour.

## Implementation Plan

- **Affected paths**: `package.json`, `src/scanner.ts`, `src/extension.ts`,
  `tests/scanner.test.mjs`, built `main.js`.
- **Dependencies**: add `@lezer/markdown` as a devDependency. esbuild bundles it
  into `main.js`; nothing is resolved at runtime.
- **Classifier**: parse the document once per call, collect the ranges of
  `FencedCode`, `CodeBlock`, `HTMLBlock` and inline code nodes, overlay
  frontmatter and `$$` block ranges, then derive the per-line boolean map.
  Keep the exported shape `findLiteralLines(...) -> boolean[]`; change its input
  to the document text if joining lines costs more than it saves.
- **Consumers**: `findDocumentFixes` and the ViewPlugin keep their current
  contract (one map per document, recomputed on `docChanged` only).
- **Cleanup**: delete the hand-written fence/math/list/HTML container state and
  its helper functions once the tests pass; do not leave two classifiers.
- **Patterns to follow**: pure functions in `src/scanner.ts`, no Obsidian
  imports, tests that run with `npm test` without a DOM.
- **Patterns to avoid**: reaching into Obsidian's syntax tree from the command
  path; parsing on every selection or viewport update.

### Verification

- [x] Every counterexample from review rounds 3 and 4 yields no source fix
      inside code, HTML, math or frontmatter, and still fixes adjacent prose.
- [x] `npm test`, `npm run lint`, `npm run build` and `node --check main.js`
      pass.
- [x] Bundle size delta of `main.js` is measured and recorded in this ADR.
- [ ] A note containing a fence inside a blockquote and inside a list, indented
      code, an HTML block, a multiline inline code span, frontmatter and a `$$`
      block shows no decorations and no rewrites inside those regions in
      Obsidian Live Preview.

## Alternatives Considered

- **Use the editor's existing syntax tree** (`syntaxTree` from
  `@codemirror/language`): no new dependency and exact agreement with the
  editor, but node names are undocumented, the command path would need an open
  MarkdownView, and offline tests cannot cover it.
- **Keep the hand-written classifier**: zero dependencies, but four review
  rounds produced destructive counterexamples from the same class (container
  arithmetic), so the approach does not converge.
- **Remove the source-rewrite command**: removes the risk entirely, but drops
  the portability feature for exports and other editors.

## More Information

Related code: `src/scanner.ts` (`findLiteralLines`, `findDocumentFixes`),
`src/extension.ts` (`buildDecorations`). Revisit this decision if
`@lezer/markdown` changes block node names, or if the bundled parser grows
`main.js` by more than roughly 150 KB.

- 2026-11-23: implemented. `main.js` grew from 16,797 to 50,019 bytes
  (+33,222, about 33 KB). Classification of a 20,000-line document takes about
  12–20 ms in Node on this machine, once per document edit. The hand-written
  container, list, HTML and fence state was removed; frontmatter and `$$`
  overlays remain. The parser reports fences opened inside `$$` blocks as
  false positives, so block nodes that start inside a math block are discarded
  before the literal map is built. The manual Obsidian check is still open.
- 2026-11-23 (0.4.1): a preview-focused review found that ordinary
  `**bold** *italic*` lines lost the italic span, and that literal regions
  could leak in both directions when code, math and frontmatter overlapped.
  The scanner now retries after a consumed-delimiter overlap, and the literal
  map re-parses with frontmatter, math and multi-line code blanked out so a
  fence inside them cannot hide the rest of the note. Parser emphasis nodes
  are classified by kind and container nodes are excluded from neutralisation.
- 2026-11-23 (0.4.7): the source rewrite was repeatedly found to edit literal
  code, link metadata, YAML and comments. It is now gated at document level:
  a note containing link, HTML, math, comment, inline-code, table or entity
  syntax (any of `[ ] < ! $ | % &` or a backtick) is refused as a whole, and
  the setting stays off by default. Live Preview keeps the tokenizer described
  above. Oracle returned ship for this release candidate.
- 2026-11-23 (0.4.8): Obsidian reports emphasis inside a link label as
  `em_link`; neutralisation now recognises the prefix (and `strong_`) and keeps
  the same-kind guard, so the run's trailing text is reset without flattening
  nested bold/italic. A preview change that scanned prose after multi-line
  code was reverted after review: code ranges must come from the same literal
  analysis that knows math ownership.
- 2026-11-23 (0.4.9): Live Preview repairs prose that follows a multi-line
  inline code span. The classifier now yields one final, non-overlapping range
  set shared by math exclusion, wiki classification and decorations; candidates
  are resolved once in source order against accepted code, frontmatter, display
  and inline math, and wiki barriers, and reparsed nodes follow the same rules.
  Backticks owned by math and openers with an earlier confirmed closer are
  resolved before Lezer pairs delimiters, and fenced/indented/HTML/comment
  blocks break pending inline state. Inside an accepted span a backslash no
  longer escapes the closer, while an escaped opener remains prose. Measured
  median analysis: 1k/2k/4k multi-line spans 7/12/25 ms, 2k/4k/8k linked lines
  14/42/144 ms. Oracle returned ship after the frozen matrix passed; the user's
  Obsidian check confirmed `字。` renders italic. Live Preview keeps the source
  line break inside a code span where Reading view renders a space; that
  difference is outside the plugin's rendering contract.



