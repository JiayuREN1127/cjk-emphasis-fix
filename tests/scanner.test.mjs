import assert from "node:assert/strict";
import { scanLine, findSourceFixes, findDocumentFixes } from "./scanner.bundle.mjs";

function kinds(text) {
  return scanLine(text).matches.map((m) => m.kind);
}

assert.deepEqual(kinds("**文字。**x"), ["strong"]);
assert.deepEqual(kinds("*文字。*接着"), ["em"]);
assert.deepEqual(kinds("***文字。***继续"), ["strong-em"]);
assert.deepEqual(kinds("**文字。**"), ["strong"]);
assert.deepEqual(kinds("**文字。**，"), ["strong"]);
assert.deepEqual(kinds("**文字。 **"), []);
assert.deepEqual(kinds("** 文字。**"), []);
assert.deepEqual(kinds("**hello.**x"), []);
assert.deepEqual(kinds("`**文字。**x`"), []);
assert.deepEqual(kinds("$$**文字。**x$$"), []);

const fixes = findSourceFixes("前面**文字。**继续");
assert.equal(fixes.length, 1);
assert.equal(fixes[0].replacement, "**文字**。")

const document = [
  "正常**文字。**继续",
  "```md",
  "坏的 **代码。**继续",
  "```",
  "再次*文字！*后文",
].join("\n");
const documentFixes = findDocumentFixes(document);
assert.equal(documentFixes.length, 2);

console.log("scanner tests: ok");
