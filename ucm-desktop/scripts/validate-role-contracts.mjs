import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopRoot, "..");
const contractsDir = path.join(repoRoot, "roles", "contracts");

const REQUIRED_ROLE_CONTRACT_IDS = [
  "conductor",
  "spec_agent",
  "research_agent",
  "architect_agent",
  "builder_agent",
  "reviewer_agent",
  "qa_agent",
  "security_agent",
  "release_agent",
  "ops_agent",
  "learning_agent",
];

function fail(message) {
  console.error(`[ucm-validate-role-contracts] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(contractsDir)) {
  fail(`Missing role contracts directory: ${contractsDir}`);
}

const contractFiles = fs
  .readdirSync(contractsDir)
  .filter((fileName) => fileName.endsWith(".yaml"))
  .sort();

if (contractFiles.length === 0) {
  fail(`No role contract files found under ${contractsDir}`);
}

const seenContractIds = new Set();
const definedIds = new Set();
const errors = [];
const requiredIds = new Set(REQUIRED_ROLE_CONTRACT_IDS);

for (const fileName of contractFiles) {
  const contractPath = path.join(contractsDir, fileName);
  let parsed;
  try {
    parsed = YAML.parse(fs.readFileSync(contractPath, "utf8"));
  } catch (error) {
    errors.push(`Invalid YAML in ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }

  const id = parsed?.id;
  if (typeof id !== "string" || !id.trim()) {
    errors.push(`Missing or invalid "id" field in ${fileName}.`);
    continue;
  }

  if (seenContractIds.has(id)) {
    errors.push(`Duplicate role contract id "${id}" found in ${fileName}.`);
    continue;
  }
  seenContractIds.add(id);

  if (!requiredIds.has(id)) {
    errors.push(`Unexpected role contract id "${id}" in ${fileName}.`);
    continue;
  }

  definedIds.add(id);
  const expectedFileName = `${id}.yaml`;
  if (fileName !== expectedFileName) {
    errors.push(`Role contract "${id}" must be named ${expectedFileName}, but found ${fileName}.`);
  }
}

for (const id of REQUIRED_ROLE_CONTRACT_IDS) {
  if (!definedIds.has(id)) {
    errors.push(`Missing role contract file for required id "${id}".`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`[ucm-validate-role-contracts] ${error}`);
  }
  fail("Role contract validation failed.");
}

console.log("[ucm-validate-role-contracts] Role contract files are canonical and valid.");
