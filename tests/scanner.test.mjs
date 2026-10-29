import assert from "node:assert/strict";
import { scanLine, findSourceFixes, findDocumentFixes } from "./scanner.bundle.mjs";

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

// setext underline must not be read as highlight
assert.deepEqual(kinds("==="), []);
assert.deepEqual(kinds("===="), []);

const fixes = findSourceFixes("前面**文字。**继续");
assert.equal(fixes.length, 1);
assert.equal(fixes[0].replacement, "**文字**。");

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
assert.equal(documentFixes.length, 3);

console.log("scanner tests: ok");
