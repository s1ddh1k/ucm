const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyAnswersToPlan,
  normalizeCommitPlan,
  normalizeSubject,
} = require("../src/commit-plan");

test("normalizes commit subjects and trims noisy prefixes", () => {
  assert.equal(
    normalizeSubject("Feat(cart): Add Cart Total Utility.", "add fallback"),
    "add Cart Total Utility",
  );
});

test("normalizes commit plans with bounded bullets and refs", () => {
  const plan = normalizeCommitPlan(
    {
      type: "FEAT",
      scope: "Cart Utilities!!!",
      subject:
        "feat(cart): Add a very long commit subject that should be shortened because it is too long for a clean conventional commit subject line.",
      whyBullets: [
        "Normalize item prices before summing them so cart totals do not depend on input shape.",
        "Normalize item prices before summing them so cart totals do not depend on input shape.",
      ],
      changeBullets: [
        "Map every item price through Number(...) before reduction so the total calculation accepts string-like inputs.",
      ],
      verificationBullets: [
        "Run node test/cart.test.js and verify the existing checkout flow still passes with numeric and string prices.",
      ],
      notesBullets: [
        "This note is intentionally verbose to confirm long bullets are still bounded and cleaned up instead of spilling indefinitely across the generated message output.",
      ],
      refs: [
        "src/cart.js",
        "src/cart.js",
        "test/cart.test.js",
      ],
      questions: [
        { id: "q1", kind: "verification", question: "어떻게 검증했나요?" },
        { id: "q1", kind: "verification", question: "어떻게 검증했나요?" },
      ],
      confidence: "high",
    },
    {
      type: "refactor",
      scope: "repo",
      subject: "add fallback",
      whyBullets: ["fallback why"],
      changeBullets: ["fallback change"],
      verificationBullets: [],
      notesBullets: [],
      refs: [],
    },
  );

  assert.equal(plan.type, "feat");
  assert.equal(plan.scope, "cart-utilities");
  assert.ok(plan.subject.length <= 58);
  assert.equal(plan.whyBullets.length, 1);
  assert.equal(plan.refs.length, 2);
  assert.equal(plan.questions.length, 1);
});

test("applies answers to the right plan sections", () => {
  const next = applyAnswersToPlan(
    {
      type: "feat",
      scope: "cart",
      subject: "add cart total helper",
      whyBullets: ["Add total calculation support."],
      changeBullets: ["Add computeTotal."],
      verificationBullets: [],
      notesBullets: [],
      refs: [],
      questions: [],
      confidence: "medium",
    },
    [
      { id: "decision_rationale", kind: "why" },
      { id: "test_gap", kind: "verification" },
      { id: "mixed_scope", kind: "notes" },
    ],
    {
      decision_rationale: "String price inputs need normalization.",
      test_gap: "Ran node test/cart.test.js locally.",
      mixed_scope: "No mixed scope here.",
    },
  );

  assert.ok(next.whyBullets.includes("String price inputs need normalization."));
  assert.ok(next.verificationBullets.includes("Ran node test/cart.test.js locally."));
  assert.ok(next.notesBullets.includes("No mixed scope here."));
});
