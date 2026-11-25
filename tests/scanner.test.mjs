import assert from "node:assert/strict";
import {
  scanLine,
  scanPreviewLine,
  findSourceFixes,
  findDocumentFixes,
  findExcessParserRanges,
  findLiteralLines,
  findWikiBarriers,
  tokenizePreviewLine,
  subtractRanges,
} from "./scanner.bundle.mjs";

function kinds(text) {
  return scanLine(text).matches.map((m) => m.kind);
}

// bold / italic / bold+italic
assert.deepEqual(kinds("**文字。**x"), ["strong"]);
assert.deepEqual(kinds("*文字。*接着"), ["em"]);
assert.deepEqual(kinds("***文字。***继续"), ["strong-em"]);

// highlight / strikethrough
assert.deepEqual(kinds("==文字。==继续"), ["highlight"]);
assert.deepEqual(kinds("前==重要！==后"), ["highlight"]);
assert.deepEqual(kinds("~~文字。~~继续"), ["strike"]);
assert.deepEqual(kinds("==文字。== 继续"), ["highlight"]);

// boundaries that already work
assert.deepEqual(kinds("**文字。**"), ["strong"]);
assert.deepEqual(kinds("**文字。**，"), ["strong"]);
assert.deepEqual(kinds("**文字。 **"), []);
assert.deepEqual(kinds("** 文字。**"), []);

// non-CJK content is left to the parser
assert.deepEqual(kinds("**hello.**x"), []);
assert.deepEqual(kinds("==hello.==x"), []);

// masked regions
assert.deepEqual(kinds("`**文字。**x`"), []);
assert.deepEqual(kinds("$$**文字。**x$$"), []);
assert.deepEqual(kinds("`==文字。==x`"), []);

// Inline code and math are resolved in source order, so neither syntax can
// swallow the other's delimiters.
assert.deepEqual(kinds("`$$`**字。**后$$x$$"), ["strong"]);
assert.deepEqual(kinds("$$`$$**字。**后`"), ["strong"]);
assert.deepEqual(scanLine("`**字。**后``").masks, []);
assert.deepEqual(kinds("`**字。**后``"), ["strong"]);

// Emphasis is allowed to contain inline code. The code span must hide its own
// delimiters, not split the line in half.
assert.deepEqual(kinds("**加粗含 `code` 的文本。**后续"), ["strong"]);
assert.deepEqual(kinds("==高亮含 `code` 的文本。==后续"), ["highlight"]);
assert.deepEqual(kinds("~~删除含 `code` 的文本。~~后续"), ["strike"]);

const inlineCodeLine =
  "因此，未来不是“编译器消灭 MKL”，而是**“高级抽象（`std::linalg`/张量 DSL）+ 专用调度编译器（处理融合与不规则尺寸）+ 底层专家级微内核（MKL/BLIS/CUTLASS）”**长期共存的格局。 ";
const inlineCodeMatches = scanLine(inlineCodeLine).matches;
assert.equal(inlineCodeMatches.length, 1, "emphasis around inline code");
assert.equal(inlineCodeMatches[0].kind, "strong");
assert.equal(
  inlineCodeLine.slice(inlineCodeMatches[0].contentFrom, inlineCodeMatches[0].contentTo),
  "“高级抽象（`std::linalg`/张量 DSL）+ 专用调度编译器（处理融合与不规则尺寸）+ 底层专家级微内核（MKL/BLIS/CUTLASS）”",
);
// The automatic rewrite skips it: the trailing `）”` closes a pair opened
// inside the span, and the opener would still not satisfy CommonMark.
assert.equal(findSourceFixes(inlineCodeLine).length, 0);

// setext underline must not be read as highlight
assert.deepEqual(kinds("==="), []);
assert.deepEqual(kinds("===="), []);

const fixes = findSourceFixes("前面**文字。**继续");
assert.equal(fixes.length, 1);
assert.equal(fixes[0].replacement, "**文字**。");

// A span whose content ends in inline code: the closing backtick is ASCII
// punctuation, so the rewrite walker used to move it and corrupt the span.
assert.equal(findSourceFixes("**`字`**后").length, 0);
assert.equal(findSourceFixes("**字`x`。**后").length, 0);
assert.equal(findSourceFixes("**` 字 `**后").length, 0);
assert.equal(findSourceFixes("**𠀀`😀`。**𠀀").length, 0);

// Closing characters that belong to a pair opened inside the span.
assert.equal(findSourceFixes("**[字](u)**后").length, 0);
assert.equal(findSourceFixes("中**“字”**后").length, 0);
assert.equal(findSourceFixes("中**（字。**后").length, 0);

// Punctuation that is safe to move even though the span contains code.
const codeFix = findSourceFixes("**加粗含 `code` 的文本。**后续");
assert.equal(codeFix.length, 1);
assert.equal(codeFix[0].replacement, "**加粗含 `code` 的文本**。");

// The rewrite only touches plain prose. Links, embeds, HTML, math and tables
// carry syntax a punctuation move can break, so the whole line is skipped.
assert.equal(findSourceFixes("[](*字。*后)").length, 0);
assert.equal(findSourceFixes("*字<br/>*后").length, 0);
assert.equal(findSourceFixes("<!--*字。*后-->").length, 0);
assert.equal(findSourceFixes("a <i x=\"*字。*后\">").length, 0);
assert.equal(findSourceFixes("![[==字。==后]]").length, 0);
assert.equal(findSourceFixes("$*字。*后$").length, 0);
assert.equal(findSourceFixes("| *字。*后 |").length, 0);
assert.equal(findSourceFixes("*«字»*后").length, 0);
assert.equal(findSourceFixes("**甲** [](*乙。*续)").length, 0);

// A list item whose first line holds a multi-line code span must keep its
// marker when the document is re-parsed.
assert.equal(findDocumentFixes("- `\n  `\n  ~~~\n~~~\n*字。*后\n").length, 0);
assert.equal(findDocumentFixes("$$\n~~~\n$$\n`\n*字。*后`\n").length, 0);

// Escaped markers are literal text, not delimiters.
assert.deepEqual(kinds("a*\\*字。*后"), []);
assert.equal(findSourceFixes("a*\\*字。*后").length, 0);
assert.deepEqual(scanLine("\\`x`*字。*后").masks, []);

// Punctuation the hand-written table missed still counts for flanking.
assert.equal(findSourceFixes("**［字］**后").length, 0);
assert.equal(findSourceFixes("中**«字。**后").length, 0);

// Empty content after the move.
assert.equal(findSourceFixes("**。**后").length, 0);

// A closer that cannot close must not swallow the real span.
assert.deepEqual(kinds("**`x` **字。**后"), ["strong"]);
assert.equal(scanLine("**`x` **字。**后").matches[0].from, 6);
assert.deepEqual(kinds("*`x` *字。*后"), ["em"]);

// A consumed span must not swallow the next span on the same line.
assert.deepEqual(kinds("**甲** *乙。*续"), ["strong", "em"]);
assert.deepEqual(kinds("**甲** *乙。*续 *丙。*续"), ["strong", "em", "em"]);

// An escaped marker inside the span must not discard the real closer.
assert.deepEqual(kinds("*中\\*文。*续"), ["em"]);
assert.deepEqual(kinds("**中\\*文。**后"), ["strong"]);
// Recovery never reaches into inline code or across accepted spans.
assert.deepEqual(kinds("*字\\*`*`"), []);
const recovered = findSourceFixes("*字\\* **甲。**乙。*后");
for (let first = 0; first < recovered.length; first++) {
  for (let second = first + 1; second < recovered.length; second++) {
    const a = recovered[first];
    const b = recovered[second];
    assert.ok(a.to <= b.from || b.to <= a.from, "rewrite edits must not overlap");
  }
}

assert.deepEqual(
  scanPreviewLine("[中*](u)文。*后", [{ from: 5, to: 6 }]).matches.map((match) => match.kind),
  [],
);

// Preview code ranges are pre-masked; delimiters inside them cannot pair.
assert.deepEqual(
  scanPreviewLine("b` *字。*后 `x`", [], [{ from: 1, to: 2 }]).matches.map((match) => [
    match.from,
    match.to,
  ]),
  [[3, 7]],
);
// Math opened first wins over a code-looking span inside it.
assert.deepEqual(scanPreviewLine("$*字*`x`$").matches, []);
// A `$$` owned by multi-line code must not open display math in preview.
const codeMathLines = ["`a", "$$", "b`", "*字*"];
const previewCodes = [];
const previewLiteral = findLiteralLines(
  codeMathLines,
  { displayBlocks: "standalone", multilineCode: false },
  previewCodes,
);
assert.deepEqual(previewLiteral, [false, false, false, false]);
assert.ok(previewCodes.length > 0);
// Code discovered only after blanking math must still reach preview.
const mathThenCode = ["$$", "~~~", "$$", "`", "*字*", "`"];
const lateCodes = [];
const lateLiteral = findLiteralLines(
  mathThenCode,
  { displayBlocks: "standalone", multilineCode: false },
  lateCodes,
);
assert.deepEqual(lateLiteral, [true, true, true, false, false, false]);
assert.ok(lateCodes.length > 0);
// Reparsed code must also update the math skip: its `$$` cannot open math.
const codeDollar = ["$$", "~~~", "$$", "`", "$$", "`", "*字*"];
const codeDollarCodes = [];
const codeDollarLiteral = findLiteralLines(
  codeDollar,
  { displayBlocks: "standalone", multilineCode: false },
  codeDollarCodes,
);
assert.deepEqual(codeDollarLiteral, [true, true, true, false, false, false, false]);
assert.ok(codeDollarCodes.some((range) => range.from === 10 && range.to === 16));
// A backtick inside inline math is not a code opener.
const mathBacktick = ["$`$", "*字*`"];
const mathBacktickCodes = [];
findLiteralLines(
  mathBacktick,
  { displayBlocks: "standalone", multilineCode: false },
  mathBacktickCodes,
);
assert.deepEqual(mathBacktickCodes, []);
// Recovered ranges use original-document offsets with CRLF.
const crlfLines = ["x\r", "😀`a\r", "b` *字*"];
const crlfCodes = [];
findLiteralLines(crlfLines, { displayBlocks: "standalone", multilineCode: false }, crlfCodes);
assert.ok(crlfCodes.some((range) => range.from === 5 && range.to === 11));
// A math-owned backtick must not erase the next real code opener.
const mathOpenBacktick = ["$`$", "`*字*", "`"];
const mathOpenCodes = [];
const mathOpenLiteral = findLiteralLines(
  mathOpenBacktick,
  { displayBlocks: "standalone", multilineCode: false },
  mathOpenCodes,
);
assert.deepEqual(mathOpenLiteral, [false, false, false]);
assert.ok(mathOpenCodes.length > 0);
// Reparsed code nodes are also checked against inline math.
const reparseMath = ["$$", "~~~", "$$", "$`$", "*字*`"];
const reparseCodes = [];
findLiteralLines(
  reparseMath,
  { displayBlocks: "standalone", multilineCode: false },
  reparseCodes,
);
assert.deepEqual(reparseCodes, []);
// A dollar inside a URL does not disqualify a real code opener.
const urlDollar = ["[]($)`$", "*字*`"];
const urlCodes = [];
findLiteralLines(urlDollar, { displayBlocks: "standalone", multilineCode: false }, urlCodes);
assert.ok(urlCodes.length > 0);
// Three consecutive spans must all be collected.
const threeSpans = ["`", "$$", "`", "`", "$$", "`", "`", "*字*", "`"];
const threeCodes = [];
findLiteralLines(threeSpans, { displayBlocks: "standalone", multilineCode: false }, threeCodes);
assert.ok(threeCodes.length >= 3);

// Tokenizer: code and math ownership in source order.
const tokenRanges = (text, barriers = []) =>
  tokenizePreviewLine(text, barriers).map((token) => [token.from, token.to, token.kind]);
assert.deepEqual(tokenRanges("$$a$$$x$"), [
  [0, 5, "display"],
  [5, 8, "inline"],
]);
assert.deepEqual(tokenRanges("$$a$b$$*字。*后$x$"), [
  [0, 7, "display"],
  [12, 15, "inline"],
]);
assert.deepEqual(tokenRanges("[]($$)*字。*后$$", [{ from: 3, to: 5 }]), []);
assert.deepEqual(tokenRanges("$*字。*后$"), [[0, 7, "inline"]]);
assert.deepEqual(tokenRanges("$x\\$$"), [[0, 5, "inline"]]);
assert.deepEqual(tokenRanges("\\$$x$"), [[2, 5, "inline"]]);
assert.deepEqual(tokenRanges("$a$$"), [[0, 3, "inline"]]);
assert.deepEqual(tokenRanges("`a`$x$"), [
  [0, 3, "code"],
  [3, 6, "inline"],
]);
assert.deepEqual(tokenRanges("`$$`"), [[0, 4, "code"]]);
assert.deepEqual(tokenRanges("$$`$$"), [[0, 5, "display"]]);
assert.deepEqual(tokenRanges("$$`$$**字。**后"), [[0, 5, "display"]]);
assert.deepEqual(tokenRanges("`**字。**后``"), []);
assert.deepEqual(tokenRanges("`*字。*后\\`"), [[0, 8, "code"]]);

// Preview repair follows the tokenizer and keeps prose outside tokens.
assert.deepEqual(
  scanPreviewLine("[]($$)*字。*后$$", [{ from: 3, to: 5 }]).matches.map((match) => [
    match.from,
    match.to,
  ]),
  [[6, 10]],
);
assert.deepEqual(
  scanPreviewLine("$*字$*文。*后").matches.map((match) => [match.from, match.to]),
  [[4, 8]],
);
assert.deepEqual(
  scanPreviewLine("*$5元。*后").matches.map((match) => [match.from, match.to]),
  [[0, 6]],
);
assert.deepEqual(scanPreviewLine("$*字。*后$").matches, []);
assert.deepEqual(
  scanPreviewLine("$$`$$**字。**后").matches.map((match) => [match.from, match.to]),
  [[5, 11]],
);
assert.deepEqual(
  scanPreviewLine("😀$𠀀$*字。*后").matches.map((match) => [match.from, match.to]),
  [[6, 10]],
);
assert.deepEqual(scanPreviewLine("**加粗含 `code` 的文本。**后续").matches.map((match) => match.kind), [
  "strong",
]);

// The command keeps its historical display boundaries; preview requires a
// standalone `$$`.
assert.equal(findDocumentFixes("$$$\n**字。**后\n").length, 0);
assert.equal(findDocumentFixes("$$\nb$$\n**字。**后\n").length, 0);
assert.deepEqual(findLiteralLines(["$$$", "**字。**后"], { displayBlocks: "standalone" }), [
  false,
  false,
]);
assert.deepEqual(
  findLiteralLines(["$$", "b$$", "**字。**后"], { displayBlocks: "standalone" }),
  [true, true, true],
);
// Overflow resets stop at barriers.
assert.deepEqual(
  subtractRanges({ from: 0, to: 10 }, [{ from: 3, to: 5 }, { from: 7, to: 8 }]),
  [
    { from: 0, to: 3 },
    { from: 5, to: 7 },
    { from: 8, to: 10 },
  ],
);
// A long token line must not blow the call stack.
assert.equal(tokenizePreviewLine("$x$".repeat(130000)).length, 130000);

// Command must not edit literal math, link metadata, nested delimiters or
// Obsidian comments, and must recognize a BOM before frontmatter.
assert.equal(findDocumentFixes("$$\n```\n$$\n$$\n*字。*后\n$$\n").length, 0);
assert.equal(findDocumentFixes("---\nx: |\n  ```\n---\n$$\n*字。*后\n$$\n").length, 0);
assert.equal(findDocumentFixes("[a](\n*字。*后\n)\n").length, 0);
assert.equal(findDocumentFixes("[a]: u\n  \"*字。*后\"\n").length, 0);
assert.equal(findDocumentFixes("*字 _甲_。*后\n").length, 0);
assert.equal(findDocumentFixes("%%*字。*后%%\n").length, 0);
assert.equal(
  findDocumentFixes("\uFEFF---\na: \"*字。*后\"\n---\n**字。**后\n").length,
  1,
);
const nestedHighlight = findDocumentFixes("*==字==。*x\n");
assert.equal(nestedHighlight.length, 1);
assert.equal(nestedHighlight[0].replacement, "*==字==*。");
const nestedStrike = findDocumentFixes("*~~字~~。*x\n");
assert.equal(nestedStrike.length, 1);
assert.equal(nestedStrike[0].replacement, "*~~字~~*。");
assert.equal(findDocumentFixes("****。**x\n").length, 0);
assert.equal(findDocumentFixes("%%\n*字。*x\n%%\n").length, 0);
assert.equal(findDocumentFixes("$$\n~~~\n$$\n$$\n```\n$$\n```\n*字。*x\n```\n").length, 0);
assert.equal(findDocumentFixes("$$\n```\n$$\n[a](\n*字。*x\n)\n").length, 0);
assert.equal(findDocumentFixes("---\na: |\n  ---\n  *字。*x\n---\n").length, 0);
assert.equal(findDocumentFixes("$$\n`\n$$\n$$\n`\n*字。*x\n$$\n").length, 0);
assert.equal(findDocumentFixes("`\n` [](\n*字。*x\n)\n").length, 0);
assert.equal(findDocumentFixes("`%%`\n%%\n*字。*x\n%%\n").length, 0);
assert.equal(findDocumentFixes("---\ns: \"*字。*x\"\n--- \n").length, 0);
assert.equal(findDocumentFixes("$$\n`\n$$\n`\n` [](\n*字。*x\n)\n").length, 0);
assert.equal(findDocumentFixes("$$`\nb$$\n$$\n`\n*字。*x\n$$\n").length, 0);
assert.equal(findDocumentFixes("---\na: \"`x` %%\"\n---\n%%\n*字。*x\n%%\n").length, 0);
assert.equal(findDocumentFixes("$$%%$$\n%%\n*字。*x\n%%\n").length, 0);
assert.equal(findDocumentFixes("$$\n`\n$$\n`*字。*x\n`\n").length, 0);
assert.equal(findDocumentFixes("~~~\n$$\n~~~\n`*字。*x\n`\n").length, 0);
assert.equal(findDocumentFixes("[]($) %% $\n*字。*x\n%%\n").length, 0);
assert.equal(findDocumentFixes("---\na: |\n  $$\n---\n`*字。*x\n`\n").length, 0);
assert.equal(findDocumentFixes("`x`*字。*x\n").length, 0);
assert.equal(findDocumentFixes("[](%%)\n%%\n*字。*x\n%%\n").length, 0);
assert.equal(findDocumentFixes("\t$$\n$$\n`\n$$\n`\n*字。*x\n`\n").length, 0);
assert.equal(findDocumentFixes("[[%%]]\n%%\n*字。*x\n%%\n").length, 0);
assert.equal(findDocumentFixes("%%`%%`%%\n*字。*x\n%%\n").length, 0);
assert.equal(findDocumentFixes("\uFEFF    *字。*x\n").length, 0);
assert.equal(findDocumentFixes("\uFEFF~~~\n*字。*x\n~~~\n").length, 0);
assert.equal(findDocumentFixes("--- \na: \"*字。*x\"\n---\n").length, 0);
assert.equal(findDocumentFixes("**字*。**x\n").length, 0);
const bomFence = "\uFEFF   ~~~\n*字。*x\n   ~~~\n**字。**后\n";
const bomFenceFixes = findDocumentFixes(bomFence);
assert.equal(bomFenceFixes.length, 1);
const bomApplied = bomFence.slice(0, bomFenceFixes[0].from) + bomFenceFixes[0].replacement + bomFence.slice(bomFenceFixes[0].to);
assert.ok(bomApplied.includes("*字。*x"), "fence body must stay untouched");
assert.ok(bomApplied.endsWith("**字**。后\n"), "prose after the fence must be repaired");
// A URL starting with a backtick must not swallow the URL barrier.
assert.deepEqual(
  scanPreviewLine("[](`)*字。*x`", [{ from: 3, to: 4 }]).matches.map((match) => [
    match.from,
    match.to,
  ]),
  [[5, 9]],
);
// A wiki link containing a code token stays a barrier.
assert.deepEqual(scanPreviewLine("[[`x`*字*]]", [{ from: 0, to: 10 }]).matches, []);


// A wiki-link-looking match inside code is code content; one spanning two code
// spans is not a wiki link and must not suppress the prose between them.
assert.deepEqual(scanPreviewLine("`[[a]]*字*`").matches, []);
assert.deepEqual(
  scanPreviewLine("`[[` *字。* `]]`").matches.map((match) => [match.from, match.to]),
  [[5, 9]],
);


assert.equal(findSourceFixes("*字&amp;*后").length, 0);
assert.equal(findSourceFixes("*字&#65;*后").length, 0);
// Frontmatter is searched without a line limit.
const longFrontmatter = [
  "---",
  ...Array.from({ length: 205 }, (_, index) => `# comment ${index}`),
  'a: "*字。*后"',
  "---",
  "**字。**后",
].join("\n");
assert.equal(findDocumentFixes(longFrontmatter).length, 1);

// The command treats multi-line code lines as literal.
assert.deepEqual(findLiteralLines(["`a", "b` **字。**后"]), [true, true]);

const highlightFix = findSourceFixes("前==重要！==后");
assert.equal(highlightFix[0].replacement, "==重要==！");

const strikeFix = findSourceFixes("~~删除。~~继续");
assert.equal(strikeFix[0].replacement, "~~删除~~。");

const document = [
  "正常**文字。**继续",
  "```md",
  "坏的 **代码。**继续",
  "```",
  "再次*文字！*后文",
  "高亮==重点。==后续",
].join("\n");
const documentFixes = findDocumentFixes(document);
assert.equal(documentFixes.length, 0);

// Blocks whose content is literal text, never rewritten.
assert.equal(findDocumentFixes("$$\n**字。**后\n$$\n").length, 0);
assert.equal(findDocumentFixes("    **字。**后\n").length, 0);
assert.equal(findDocumentFixes("\t**字。**后\n").length, 0);
assert.equal(findDocumentFixes(" \t**字。**后\n").length, 0);
assert.equal(findDocumentFixes("```\n\t```\n**字。**后\n").length, 0);
assert.equal(findDocumentFixes("> ```\n> **字。**后\n> ```\n").length, 0);
assert.equal(findDocumentFixes("```\n**字。**后\n```x\n**字。**后\n```\n").length, 0);
assert.equal(
  findDocumentFixes(["```", "**字。**后", "```x", "**字。**后", "```", "**字。**后"].join("\n")).length,
  0,
);
assert.equal(findDocumentFixes("~~~\n**字。**后\n~~~\n").length, 0);

// A `$$` span closed on the same line is a mask, not a block; the prose on
// that line and after it is still fixed.
assert.equal(findDocumentFixes("$$x$$ **字。**后\n**字。**后\n").length, 0);
assert.equal(findDocumentFixes("$$$$\n**字。**后\n").length, 0);
assert.equal(findDocumentFixes("    $$\n**字。**后\n").length, 0);
// Backticks inside a math block are content, not a fence opener.
assert.equal(findDocumentFixes("$$\n```\n$$\n**字。**后\n").length, 0);

// The same classifier drives Live Preview decorations.
assert.deepEqual(findLiteralLines(["```", "**字。**后", "```", "**字。**后"]), [true, true, true, false]);
assert.deepEqual(findLiteralLines(["$$", "**字。**后", "$$"]), [true, true, true]);
assert.deepEqual(findLiteralLines(["    **字。**后", "**字。**后"]), [true, false]);
// Indented code cannot interrupt a paragraph.
assert.deepEqual(findLiteralLines(["文字", "    **字。**后"]), [false, false]);
assert.equal(findDocumentFixes("文字\n    **字。**后\n").length, 1);
assert.deepEqual(findLiteralLines(["> ```", "> **字。**后", "> ```", "> **字。**后"]), [
  true,
  true,
  true,
  false,
]);
assert.deepEqual(
  findLiteralLines(["```", "**字。**后", "```x", "**字。**后", "```", "**字。**后"]),
  [true, true, true, true, true, false],
);

// Literal regions must not leak into the rest of the document, in either
// direction, and must follow the container they belong to.
assert.deepEqual(findLiteralLines("`a\n$$\nb`\n\n**文。**续\n".split("\n")), [
  true, true, true, false, false, false,
]);
assert.deepEqual(findLiteralLines("- $$\n  **中。**续\n  $$\n\n**文。**续\n".split("\n")), [
  true, true, true, false, false, false,
]);
assert.deepEqual(findLiteralLines("---\nx: |\n  ```\n---\n**中。**续\n".split("\n")), [
  true, true, true, true, false, false,
]);
assert.equal(findDocumentFixes("---\na: \"**字。**后\"\n\n---\n**字。**后\n").length, 1);
assert.deepEqual(findLiteralLines("$$\n```\n$$\n```mermaid\n**中。**续\n```\n".split("\n")), [
  true, true, true, true, true, true, false,
]);

// A fence belongs to the container it opened in.
assert.deepEqual(findLiteralLines(["> ~~~", "**字。**后"]), [true, false]);
assert.equal(findDocumentFixes("> ~~~\n**字。**后\n").length, 1);
assert.equal(findDocumentFixes("> ~~~\n~~~\n**字。**后\n").length, 0);
assert.equal(findDocumentFixes("~~~\n> ~~~\n**字。**后\n").length, 0);
assert.deepEqual(findLiteralLines(["> > ~~~", "> **字。**后"]), [true, false]);
assert.equal(findDocumentFixes("> > ~~~\n> **字。**后\n").length, 1);

// List items: an indented continuation is prose, a fence inside an item is code.
assert.equal(findDocumentFixes("- a\n\n    **字。**后\n").length, 1);
assert.equal(findDocumentFixes("- a\n\n    - **字。**后\n").length, 1);
assert.equal(findDocumentFixes("- ~~~\n  **字。**后\n").length, 0);

// A backtick fence may not carry a backtick in its info string.
assert.equal(findDocumentFixes("``` a`\n**字。**后\n").length, 0);

// A closing backtick run is not escaped by a preceding backslash.
assert.equal(findSourceFixes("`*字。*后\\`").length, 0);

// Frontmatter and raw HTML are not prose.
assert.equal(findDocumentFixes("---\na: \"**字。**后\"\n---\n**字。**后\n").length, 1);
assert.equal(findDocumentFixes("<pre>\n**字。**后\n</pre>\n").length, 0);
assert.equal(findDocumentFixes("<div>\n**字。**后\n</div>\n\n**字。**后\n").length, 0);

// CRLF line endings.
assert.equal(findDocumentFixes("~~~\r\nx\r\n~~~\r\n**字。**后").length, 1);

// Obsidian reports emphasis inside a link as `em_link` spanning up to the
// trailing text; that tail must be neutralised.
assert.deepEqual(
  findExcessParserRanges(
    [{ to: 5, delimiterLength: 1, kind: "em" }],
    [{ from: 2, to: 6, kind: "em" }],
    "xxxxx",
    0,
    10,
  ),
  [{ from: 5, to: 6 }],
);
// A different kind is a nested construct, not overflow.
assert.deepEqual(
  findExcessParserRanges(
    [{ to: 6, delimiterLength: 2, kind: "strong" }],
    [{ from: 0, to: 8, kind: "em" }],
    "xxxxxxxx",
    0,
    10,
  ),
  [],
);
// A second single-marker span starting just after the closer is separate.
assert.deepEqual(
  findExcessParserRanges(
    [{ to: 4, delimiterLength: 1, kind: "em" }],
    [{ from: 5, to: 6, kind: "em" }],
    "xxxxx",
    0,
    10,
  ),
  [],
);

const overflowText = "x".repeat(200);
assert.deepEqual(
  findExcessParserRanges([{ to: 102, delimiterLength: 2 }], [{ from: 23, to: 111 }], overflowText, 0, 200),
  [{ from: 102, to: 111 }],
);
assert.deepEqual(
  findExcessParserRanges(
    [{ to: 102, delimiterLength: 2 }],
    [{ from: 23, to: 29 }, { from: 42, to: 111 }],
    overflowText,
    0,
    200,
  ),
  [{ from: 102, to: 111 }],
);
assert.deepEqual(
  findExcessParserRanges([{ to: 102, delimiterLength: 2 }], [{ from: 102, to: 111 }], overflowText, 0, 200),
  [{ from: 102, to: 111 }],
);
assert.deepEqual(
  findExcessParserRanges([{ to: 102, delimiterLength: 2 }], [{ from: 102, to: 100 }], overflowText, 0, 200),
  [],
);
assert.deepEqual(
  findExcessParserRanges([{ to: 102, delimiterLength: 2 }], [{ from: 120, to: 130 }], overflowText, 0, 200),
  [],
);
// A run of another kind is a separate construct, not overflow.
assert.deepEqual(
  findExcessParserRanges(
    [{ to: 5, delimiterLength: 2, kind: "strong" }],
    [{ from: 5, to: 8, kind: "em" }],
    "      ",
    0,
    8,
  ),
  [],
);
// Whitespace between the spans keeps a separate bold intact.
assert.deepEqual(
  findExcessParserRanges(
    [{ to: 6, delimiterLength: 2, kind: "strong" }],
    [{ from: 7, to: 11, kind: "strong" }],
    "**字。** **粗**",
    0,
    12,
  ),
  [],
);
// No whitespace: the parser opened a new span on the closing delimiter.
assert.deepEqual(
  findExcessParserRanges(
    [{ to: 6, delimiterLength: 2, kind: "strong" }],
    [{ from: 8, to: 12, kind: "strong" }],
    "**字。****粗**",
    0,
    13,
  ),
  [{ from: 8, to: 12 }],
);

// Every common Chinese punctuation mark, both for rendering and for the
// optional source rewrite.
const punctuation = [
  "。", "、", "，", "；", "：", "！", "？", "）", "】", "》", "」", "』",
  "…", "—", "～", "·", "“", "”", "‘", "’", "〈", "〔", "〖", "／", "．", "％", "＃",
];
for (const mark of punctuation) {
  assert.deepEqual(kinds(`**文字${mark}**继续`), ["strong"], `render ${mark}`);
  const fix = findSourceFixes(`**文字${mark}**继续`);
  assert.equal(fix.length, 1, `fix ${mark}`);
  assert.equal(fix[0].replacement, `**文字**${mark}`, `fix result ${mark}`);
}

// --- Review blockers: wiki barriers, math-owned backticks, frontmatter and
// --- one deduplicated code-range resolver. -------------------------------

// Emulate the Live Preview pass: code ranges are clipped per line, wiki
// barriers are derived from that line, and matches become absolute ranges.
function previewMatches(lines, codeRanges) {
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const found = [];
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index];
    const lineFrom = starts[index];
    const code = codeRanges
      .filter((range) => range.to > lineFrom && range.from < lineFrom + text.length)
      .map((range) => ({
        from: Math.max(range.from, lineFrom) - lineFrom,
        to: Math.min(range.to, lineFrom + text.length) - lineFrom,
      }));
    const barriers = findWikiBarriers(text, code);
    for (const match of scanPreviewLine(text, barriers, code).matches) {
      found.push([lineFrom + match.from, lineFrom + match.to]);
    }
  }
  return found;
}

// 1) Shared wiki barrier helper: brackets inside code/math make the match
// content, a nested URL stays opaque, and a wiki link may contain one token.
assert.deepEqual(findWikiBarriers("[[a]]"), [{ from: 0, to: 5 }]);
assert.deepEqual(findWikiBarriers("`[[a]]`"), []);
assert.deepEqual(findWikiBarriers("[[`x`]]"), [{ from: 0, to: 7 }]);
assert.deepEqual(findWikiBarriers("[a]((x$y))", [{ from: 3, to: 10 }]), []);
assert.deepEqual(findWikiBarriers("[[a]](x)", [{ from: 0, to: 5 }]), []);
// `$` inside a wiki target cannot pair with a dollar outside it, so the
// backtick after the link opens the multi-line span.
const wikiDollar = ["[[$]]`$", "*字*`"];
const wikiDollarBarriers = findWikiBarriers(wikiDollar[0]);
assert.deepEqual(wikiDollarBarriers, [{ from: 0, to: 5 }]);
assert.deepEqual(
  scanPreviewLine(wikiDollar[0], wikiDollarBarriers, [{ from: 5, to: 7 }]).matches,
  [],
);
const wikiDollarCodes = [];
findLiteralLines(
  wikiDollar,
  { displayBlocks: "standalone", multilineCode: false },
  wikiDollarCodes,
);
assert.deepEqual(wikiDollarCodes, [{ from: 5, to: 12 }]);
assert.deepEqual(previewMatches(wikiDollar, wikiDollarCodes), []);

// 2) A math-owned backtick is blanked before Lezer pairs code spans, so the
// second backtick opens the multi-line span.
const mathOwned = ["$`$`", "*字*`"];
const mathOwnedCodes = [];
const mathOwnedLiteral = findLiteralLines(
  mathOwned,
  { displayBlocks: "standalone", multilineCode: false },
  mathOwnedCodes,
);
assert.deepEqual(mathOwnedLiteral, [false, false]);
assert.deepEqual(mathOwnedCodes, [{ from: 3, to: 9 }]);
assert.deepEqual(previewMatches(mathOwned, mathOwnedCodes), []);

// 3) Frontmatter is blanked before the first inline collection: a backtick in
// YAML cannot seed a range that ends in prose, and the prose stays decorated.
const yamlBacktick = ["---", 'a: "`"', "...", "*字*`"];
const yamlCodes = [];
const yamlLiteral = findLiteralLines(
  yamlBacktick,
  { displayBlocks: "standalone", multilineCode: false },
  yamlCodes,
);
assert.deepEqual(yamlLiteral, [true, true, true, false]);
assert.deepEqual(yamlCodes, []);
assert.deepEqual(previewMatches(yamlBacktick, yamlCodes), [[15, 18]]);

// 4) One ownership resolver: when a group's `$$` is owned by the code span
// that opened before it, the next opener is still recognised, and every
// accepted range appears exactly once.
const repeatedGroups = [];
for (let index = 0; index < 5; index++) repeatedGroups.push("`", "$$", "`");
repeatedGroups.push("`", "*字*", "`");
assert.equal(repeatedGroups.length, 18);
const repeatedCodes = [];
findLiteralLines(
  repeatedGroups,
  { displayBlocks: "standalone", multilineCode: false },
  repeatedCodes,
);
assert.deepEqual(repeatedCodes, [
  { from: 0, to: 6 },
  { from: 7, to: 13 },
  { from: 14, to: 20 },
  { from: 21, to: 27 },
  { from: 28, to: 34 },
  { from: 35, to: 42 },
]);

const deduplicated = ["$$", "~~~", "$$", "`", "$$", "`", "`", "*字*", "`"];
const deduplicatedCodes = [];
findLiteralLines(
  deduplicated,
  { displayBlocks: "standalone", multilineCode: false },
  deduplicatedCodes,
);
assert.deepEqual(deduplicatedCodes, [
  { from: 10, to: 16 },
  { from: 17, to: 24 },
]);

// 5) Both shapes stay cheap: counts only, never wall-clock times.
const manyGroups = [];
for (let index = 0; index < 2000; index++) manyGroups.push("`", "$$", "`");
const manyCodes = [];
findLiteralLines(
  manyGroups,
  { displayBlocks: "standalone", multilineCode: false },
  manyCodes,
);
assert.equal(manyCodes.length, 2000);
assert.deepEqual(manyCodes[0], { from: 0, to: 6 });
assert.deepEqual(manyCodes[manyCodes.length - 1], { from: 13993, to: 13999 });

const singleLineBenchmark = "`a` *字* ".repeat(2000);
const singleLineCodes = [];
findLiteralLines(
  [singleLineBenchmark],
  { displayBlocks: "standalone", multilineCode: false },
  singleLineCodes,
);
assert.deepEqual(singleLineCodes, []);

// --- 0.4.9 blockers: cross-line code pending during math masking, one display
// --- math predicate, wiki-owned backticks, and an indexed barrier lookup. ---

// 1) A code opener that stays open owns the start of the next line. Its closer
// is found before math is masked, so the code span survives and the math after
// the closer keeps its stars.
const pendingCode = ["`", "$`$*字*$"];
const pendingCodes = [];
const pendingLiteral = findLiteralLines(
  pendingCode,
  { displayBlocks: "standalone", multilineCode: false },
  pendingCodes,
);
assert.deepEqual(pendingLiteral, [false, false]);
assert.deepEqual(pendingCodes, [{ from: 0, to: 4 }]);
assert.deepEqual(previewMatches(pendingCode, pendingCodes), []);

const pendingProse = ["`", "$`$*字*$ *文*"];
const pendingProseCodes = [];
findLiteralLines(
  pendingProse,
  { displayBlocks: "standalone", multilineCode: false },
  pendingProseCodes,
);
assert.deepEqual(pendingProseCodes, [{ from: 0, to: 4 }]);
assert.deepEqual(previewMatches(pendingProse, pendingProseCodes), [[10, 13]]);

// The reverse ownership (math first, then the real code opener) is unchanged.
const reverseOwnership = ["$`$`", "*字*`"];
const reverseCodes = [];
findLiteralLines(
  reverseOwnership,
  { displayBlocks: "standalone", multilineCode: false },
  reverseCodes,
);
assert.deepEqual(reverseCodes, [{ from: 3, to: 9 }]);
assert.deepEqual(previewMatches(reverseOwnership, reverseCodes), []);

// 2) Standalone display math closes only on a bare `$$` line, using the same
// predicate in the tracker and in the literal pass. `b$$` is content.
const displayClose = ["$$", "b$$", "`", "$$", "*字* `x`"];
const displayCodes = [];
const displayLiteral = findLiteralLines(
  displayClose,
  { displayBlocks: "standalone", multilineCode: false },
  displayCodes,
);
assert.deepEqual(displayLiteral, [true, true, true, true, false]);
assert.deepEqual(displayCodes, []);
assert.deepEqual(previewMatches(displayClose, displayCodes), [[12, 15]]);
assert.deepEqual(scanPreviewLine("*字* `x`").tokens, [{ from: 4, to: 7, kind: "code" }]);

// 3) A backtick inside a wiki alias is link text: no code range, and the prose
// after the link is decorated. Brackets inside code stay code content.
const wikiAlias = ["[[a|`]]", "*字* `x`"];
assert.deepEqual(findWikiBarriers("[[a|`]]"), [{ from: 0, to: 7 }]);
const wikiAliasCodes = [];
const wikiAliasLiteral = findLiteralLines(
  wikiAlias,
  { displayBlocks: "standalone", multilineCode: false },
  wikiAliasCodes,
);
assert.deepEqual(wikiAliasLiteral, [false, false]);
assert.deepEqual(wikiAliasCodes, []);
assert.deepEqual(previewMatches(wikiAlias, wikiAliasCodes), [[8, 11]]);

const wikiCounterexample = ["`[[a]]*字*`"];
assert.deepEqual(findWikiBarriers(wikiCounterexample[0]), []);
const wikiCounterCodes = [];
findLiteralLines(
  wikiCounterexample,
  { displayBlocks: "standalone", multilineCode: false },
  wikiCounterCodes,
);
assert.deepEqual(wikiCounterCodes, []);
assert.deepEqual(previewMatches(wikiCounterexample, wikiCounterCodes), []);

// 4) The barrier index reaches a continuation line of a multi-line link title,
// so its `$` cannot pair with a dollar after the title and swallow the opener.
const urlDollarExact = ["[]($)`$", "*字*`"];
const urlDollarExactCodes = [];
findLiteralLines(
  urlDollarExact,
  { displayBlocks: "standalone", multilineCode: false },
  urlDollarExactCodes,
);
assert.deepEqual(urlDollarExactCodes, [{ from: 5, to: 12 }]);

const multilineTitle = ['[x](u "t', ' $x") `$', "*字*`"];
const multilineTitleCodes = [];
const multilineTitleLiteral = findLiteralLines(
  multilineTitle,
  { displayBlocks: "standalone", multilineCode: false },
  multilineTitleCodes,
);
assert.deepEqual(multilineTitleLiteral, [false, false, false]);
assert.deepEqual(multilineTitleCodes, [{ from: 15, to: 22 }]);
assert.deepEqual(previewMatches(multilineTitle, multilineTitleCodes), []);

// Many single-line barriers keep their own line only; counts, not times.
const barrierHeavy = [];
for (let index = 0; index < 2000; index++) barrierHeavy.push("[x](u)");
barrierHeavy.push("`", "*字*", "`");
const barrierHeavyCodes = [];
const barrierHeavyLiteral = findLiteralLines(
  barrierHeavy,
  { displayBlocks: "standalone", multilineCode: false },
  barrierHeavyCodes,
);
assert.deepEqual(barrierHeavyCodes, [{ from: 14000, to: 14007 }]);
assert.equal(barrierHeavyLiteral.length, 2003);
assert.ok(barrierHeavyLiteral.every((value) => value === false));

// --- 0.4.9 round 2: shared boundary lines, wiki text inside code, and code
// --- fences breaking pending inline state. ----------------------------------

// 1) A line can close one multiline span and open the next. The accepted
// prefix must not be re-tokenized as fresh prose: its dollar cannot pair with
// the dollar after the second opener.
const sharedBoundary = ["`", "$` `$", "*字*`"];
const sharedCodes = [];
const sharedLiteral = findLiteralLines(
  sharedBoundary,
  { displayBlocks: "standalone", multilineCode: false },
  sharedCodes,
);
assert.deepEqual(sharedLiteral, [false, false, false]);
assert.deepEqual(sharedCodes, [
  { from: 0, to: 4 },
  { from: 5, to: 12 },
]);
assert.deepEqual(previewMatches(sharedBoundary, sharedCodes), []);

// The closer ends code; math after it stays opaque and only the later prose
// emphasis is marked.
const sharedCounterexample = ["`", "$`$*字*$ *文*"];
const sharedCounterCodes = [];
findLiteralLines(
  sharedCounterexample,
  { displayBlocks: "standalone", multilineCode: false },
  sharedCounterCodes,
);
assert.deepEqual(sharedCounterCodes, [{ from: 0, to: 4 }]);
assert.deepEqual(previewMatches(sharedCounterexample, sharedCounterCodes), [[10, 13]]);

// 2) Wiki-looking text between a real opener and its closer is code content.
// The earlier backtick wins only because an exact-width closer is confirmed,
// so the link-looking text does not split the line into gaps.
const wikiInsideCode = ["`[[a]]", "$`$*字*$"];
const wikiInsideCodes = [];
const wikiInsideLiteral = findLiteralLines(
  wikiInsideCode,
  { displayBlocks: "standalone", multilineCode: false },
  wikiInsideCodes,
);
assert.deepEqual(wikiInsideLiteral, [false, false]);
assert.deepEqual(wikiInsideCodes, [{ from: 0, to: 9 }]);
assert.deepEqual(previewMatches(wikiInsideCode, wikiInsideCodes), []);
// The decision is shared: without a confirmed closer the candidate is a link;
// with one, the candidate is code content.
assert.deepEqual(findWikiBarriers("`[[a]]"), [{ from: 1, to: 6 }]);
assert.deepEqual(
  findWikiBarriers("`[[a]]", [], { hasCodeCloser: () => true }),
  [],
);

// A wiki link that opens first owns its backtick; it never seeds code.
const wikiAliasOwned = ["[[a|`]]", "*字* `x`"];
const wikiAliasOwnedCodes = [];
const wikiAliasOwnedLiteral = findLiteralLines(
  wikiAliasOwned,
  { displayBlocks: "standalone", multilineCode: false },
  wikiAliasOwnedCodes,
);
assert.deepEqual(wikiAliasOwnedLiteral, [false, false]);
assert.deepEqual(wikiAliasOwnedCodes, []);
assert.deepEqual(previewMatches(wikiAliasOwned, wikiAliasOwnedCodes), [[8, 11]]);
assert.deepEqual(
  findWikiBarriers("[[a|`]]", [], { hasCodeCloser: () => true }),
  [{ from: 0, to: 7 }],
);

// 3) A backtick inside a fenced block is literal: it neither starts pending
// inline code nor carries one across the block boundary.
const fencedBacktick = ["~~~", "`", "~~~", "$`$`", "*字*`"];
const fencedCodes = [];
const fencedLiteral = findLiteralLines(
  fencedBacktick,
  { displayBlocks: "standalone", multilineCode: false },
  fencedCodes,
);
assert.deepEqual(fencedLiteral, [true, true, true, false, false]);
assert.deepEqual(fencedCodes, [{ from: 13, to: 19 }]);
assert.deepEqual(previewMatches(fencedBacktick, fencedCodes), []);

// Pending state still crosses ordinary paragraph newlines.
const paragraphPending = ["`", "*字*", "`"];
const paragraphCodes = [];
const paragraphLiteral = findLiteralLines(
  paragraphPending,
  { displayBlocks: "standalone", multilineCode: false },
  paragraphCodes,
);
assert.deepEqual(paragraphLiteral, [false, false, false]);
assert.deepEqual(paragraphCodes, [{ from: 0, to: 7 }]);
assert.deepEqual(previewMatches(paragraphPending, paragraphCodes), []);

// A backslash inside an accepted code span is content and cannot escape the
// closer: the exact-width run after it still ends the span.
const escapedCloser = ["`[[a]]", "$\\`$*字*$ *文*"];
const escapedCloserCodes = [];
const escapedCloserLiteral = findLiteralLines(
  escapedCloser,
  { displayBlocks: "standalone", multilineCode: false },
  escapedCloserCodes,
);
assert.deepEqual(escapedCloserLiteral, [false, false]);
assert.deepEqual(escapedCloserCodes, [{ from: 0, to: 10 }]);
assert.deepEqual(previewMatches(escapedCloser, escapedCloserCodes), [[16, 19]]);

// An escaped first backtick is prose, not an opener: it must not be promoted
// to a code span just because a same-width run appears later.
const escapedOpener = ["\\`[[a]]", "$\\`$*字*$ *文*"];
const escapedOpenerCodes = [];
findLiteralLines(
  escapedOpener,
  { displayBlocks: "standalone", multilineCode: false },
  escapedOpenerCodes,
);
assert.deepEqual(escapedOpenerCodes, []);

console.log("scanner tests: ok");
