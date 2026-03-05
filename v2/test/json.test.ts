import { describe, it, assert } from "./harness.ts";
import { extractJson } from "../src/json.ts";

describe("json.ts", () => {
  it("extracts from markdown code block with json tag", () => {
    const raw = 'Here is the result:\n```json\n{"goal":"build app"}\n```\nDone.';
    const result = extractJson<{ goal: string }>(raw);
    assert.deepEqual(result, { goal: "build app" });
  });

  it("extracts from markdown code block without json tag", () => {
    const raw = 'Result:\n```\n{"passed":true}\n```';
    const result = extractJson<{ passed: boolean }>(raw);
    assert.deepEqual(result, { passed: true });
  });

  it("extracts from direct JSON string", () => {
    const raw = '{"goal":"test","context":"ctx","acceptance":"done"}';
    const result = extractJson<{ goal: string }>(raw);
    assert.equal(result?.goal, "test");
  });

  it("extracts from text with embedded JSON via bracket search", () => {
    const raw = 'The answer is {"passed":false,"keepChanges":true,"reason":"test failed"} here.';
    const result = extractJson<{ passed: boolean; reason: string }>(raw);
    assert.equal(result?.passed, false);
    assert.equal(result?.reason, "test failed");
  });

  it("extracts array via bracket search", () => {
    const raw = 'Items: [1, 2, 3] end';
    const result = extractJson<number[]>(raw);
    assert.deepEqual(result, [1, 2, 3]);
  });

  it("prefers code block over bracket search", () => {
    const raw = '{"wrong":true}\n```json\n{"right":true}\n```';
    const result = extractJson<{ right?: boolean; wrong?: boolean }>(raw);
    assert.equal(result?.right, true);
  });

  it("returns null for no JSON", () => {
    const result = extractJson("no json here at all");
    assert.equal(result, null);
  });

  it("returns null for malformed JSON", () => {
    const result = extractJson("```json\n{broken:}\n```");
    assert.equal(result, null);
  });

  it("handles nested JSON objects", () => {
    const raw = '```json\n{"a":{"b":{"c":1}}}\n```';
    const result = extractJson<{ a: { b: { c: number } } }>(raw);
    assert.equal(result?.a.b.c, 1);
  });

  it("handles multiple code blocks, returns first valid", () => {
    const raw = '```json\n{invalid}\n```\n```json\n{"valid":true}\n```';
    const result = extractJson<{ valid: boolean }>(raw);
    assert.equal(result?.valid, true);
  });

  it("handles JSON with escaped characters", () => {
    const raw = '{"message":"line1\\nline2","path":"C:\\\\Users"}';
    const result = extractJson<{ message: string; path: string }>(raw);
    assert.equal(result?.message, "line1\nline2");
  });
});
