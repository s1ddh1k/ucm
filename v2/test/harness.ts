/**
 * 자체 테스트 러너. 외부 의존성 없음.
 */

interface TestCase {
  name: string;
  fn: () => Promise<void> | void;
}

interface Suite {
  name: string;
  tests: TestCase[];
  beforeEach?: () => Promise<void> | void;
  afterEach?: () => Promise<void> | void;
}

const suites: Suite[] = [];
let currentSuite: Suite | null = null;

export function describe(name: string, fn: () => void): void {
  const suite: Suite = { name, tests: [] };
  currentSuite = suite;
  fn();
  suites.push(suite);
  currentSuite = null;
}

export function it(name: string, fn: () => Promise<void> | void): void {
  if (!currentSuite) throw new Error("it() must be inside describe()");
  currentSuite.tests.push({ name, fn });
}

export function beforeEach(fn: () => Promise<void> | void): void {
  if (!currentSuite) throw new Error("beforeEach() must be inside describe()");
  currentSuite.beforeEach = fn;
}

export function afterEach(fn: () => Promise<void> | void): void {
  if (!currentSuite) throw new Error("afterEach() must be inside describe()");
  currentSuite.afterEach = fn;
}

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

export function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new AssertionError(message);
}

assert.equal = <T>(actual: T, expected: T, message?: string): void => {
  if (!Object.is(actual, expected)) {
    throw new AssertionError(
      message ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
};

assert.deepEqual = <T>(actual: T, expected: T, message?: string): void => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new AssertionError(message ?? `expected ${b}, got ${a}`);
  }
};

assert.throws = (fn: () => void, message?: string): void => {
  try {
    fn();
    throw new AssertionError(message ?? "expected function to throw");
  } catch (e) {
    if (e instanceof AssertionError) throw e;
  }
};

assert.match = (actual: string, re: RegExp, message?: string): void => {
  if (!re.test(actual)) {
    throw new AssertionError(message ?? `expected "${actual}" to match ${re}`);
  }
};

assert.includes = (haystack: string, needle: string, message?: string): void => {
  if (!haystack.includes(needle)) {
    throw new AssertionError(message ?? `expected string to include "${needle}"`);
  }
};

async function runAll(): Promise<void> {
  let totalPassed = 0;
  let totalFailed = 0;
  const failures: { suite: string; test: string; error: unknown }[] = [];

  for (const suite of suites) {
    console.log(`\n  ${suite.name}`);
    for (const test of suite.tests) {
      try {
        if (suite.beforeEach) await suite.beforeEach();
        await test.fn();
        if (suite.afterEach) await suite.afterEach();
        console.log(`    ✓ ${test.name}`);
        totalPassed++;
      } catch (e) {
        console.log(`    ✗ ${test.name}`);
        if (e instanceof Error) console.log(`      ${e.message}`);
        totalFailed++;
        failures.push({ suite: suite.name, test: test.name, error: e });
      }
    }
  }

  console.log(`\n  ${totalPassed} passing, ${totalFailed} failing\n`);

  if (failures.length > 0) {
    console.log("  Failures:\n");
    for (const f of failures) {
      console.log(`    ${f.suite} > ${f.test}`);
      if (f.error instanceof Error) {
        console.log(`      ${f.error.message}\n`);
      }
    }
    process.exit(1);
  }
}

// CLI 엔트리포인트
if (import.meta.main) {
  const args = process.argv.slice(2);
  const testFiles: string[] = [];

  const base = import.meta.dir.replace(/\/test$/, "");

  if (args.length > 0) {
    for (const arg of args) {
      const resolved = arg.startsWith("/") ? arg : `${base}/${arg}`;
      testFiles.push(resolved);
    }
  } else {
    // 모든 테스트 파일
    const glob = new Bun.Glob("test/*.test.ts");
    const dir = import.meta.dir.replace(/\/test$/, "");
    for await (const file of glob.scan({ cwd: dir })) {
      testFiles.push(`${dir}/${file}`);
    }
    testFiles.sort();
  }

  for (const file of testFiles) {
    await import(file);
  }

  await runAll();
}
