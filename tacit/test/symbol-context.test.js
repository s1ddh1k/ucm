const test = require("node:test");
const assert = require("node:assert/strict");
const {
  detectSymbolCandidate,
  scanJsSymbols,
  selectChangedSymbols,
} = require("../src/symbol-context");

test("detects common JS symbol declarations", () => {
  assert.deepEqual(detectSymbolCandidate("export function run() {"), {
    name: "run",
    kind: "function",
  });
  assert.deepEqual(detectSymbolCandidate("export const buildPlan = async () => {"), {
    name: "buildPlan",
    kind: "arrow",
  });
  assert.deepEqual(detectSymbolCandidate("class SessionManager {"), {
    name: "SessionManager",
    kind: "class",
  });
});

test("selects the narrowest changed symbols from JS content", () => {
  const source = [
    "export function computeTotal(items) {",
    "  const prices = items.map((item) => Number(item.price));",
    "  return prices.reduce((sum, price) => sum + price, 0);",
    "}",
    "",
    "export const formatTotal = (total) => {",
    "  return `$${total.toFixed(2)}`;",
    "};",
    "",
  ].join("\n");

  const symbols = scanJsSymbols(source);
  assert.equal(symbols.length, 2);

  const selected = selectChangedSymbols(source, [{ start: 2, end: 3 }]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].name, "computeTotal");
  assert.match(selected[0].snippet, /prices\.reduce/);

  const second = selectChangedSymbols(source, [{ start: 6, end: 7 }]);
  assert.equal(second.length, 1);
  assert.equal(second[0].name, "formatTotal");
});
