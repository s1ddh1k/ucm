const {
  readFile,
  writeFile,
  mkdir,
  appendFile,
  rename,
} = require("node:fs/promises");
const crypto = require("node:crypto");

const {
  DAEMON_DIR,
  PROPOSALS_DIR,
  CURATION_MODE_PATH,
  DEFERRED_PROPOSALS_PATH,
  CLUSTERS_PATH,
  FEEDBACK_PATH,
  DISCARD_HISTORY_PATH,
  CURATION_LOG_PATH,
  DEFAULT_CONFIG,
} = require("./ucmd-constants.js");

const {
  loadProposal,
  listProposals,
  deleteProposal,
  saveProposal,
  moveProposal,
} = require("./ucmd-proposal.js");

let log = () => {};
let deps = {};

function setLog(fn) {
  log = fn;
}
function setDeps(d) {
  deps = { log: () => {}, broadcastWs: () => {}, ...d };
}

// ── Async file-level mutex to prevent concurrent read-modify-write corruption ──
const _locks = {};
async function withLock(key, fn) {
  if (!_locks[key]) _locks[key] = Promise.resolve();
  const prev = _locks[key];
  let resolve;
  _locks[key] = new Promise((r) => {
    resolve = r;
  });
  await prev;
  try {
    return await fn();
  } finally {
    resolve();
  }
}

async function writeJsonAtomic(filePath, data, directory) {
  await mkdir(directory, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmpPath, filePath);
}

async function appendJsonLine(filePath, data, directory) {
  await mkdir(directory, { recursive: true });
  await appendFile(filePath, `${JSON.stringify(data)}\n`);
}

// ══════════════════════════════════════════════════════════════
// §2 — Mode System (Stabilization / Big Bet)
// ══════════════════════════════════════════════════════════════

async function loadCurationMode() {
  try {
    const raw = await readFile(CURATION_MODE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    if (e && e.code !== "ENOENT")
      log(`[curation] loadCurationMode error: ${e.message}`);
    // Default mode
    const defaultMode = {
      mode: "stabilization",
      since: new Date().toISOString(),
      forcedBy: null,
      history: [],
    };
    try {
      await saveCurationMode(defaultMode);
    } catch (writeErr) {
      log(`[curation] failed to write default mode: ${writeErr.message}`);
    }
    return defaultMode;
  }
}

async function saveCurationMode(modeData) {
  await writeJsonAtomic(CURATION_MODE_PATH, modeData, DAEMON_DIR);
}

function checkTransitionToBigBet(metrics, modeData, config) {
  const thresholds =
    config?.curation?.transitionThresholds?.toBigBet ||
    DEFAULT_CONFIG.curation.transitionThresholds.toBigBet;

  const daysSince =
    (Date.now() - new Date(modeData.since).getTime()) / (1000 * 60 * 60 * 24);

  const criteria = {
    successRate: {
      passed: (metrics.successRate ?? 0) >= thresholds.successRate,
      value: metrics.successRate ?? 0,
      threshold: thresholds.successRate,
    },
    firstPassRate: {
      passed:
        (metrics.loopMetrics?.firstPassRate ?? 0) >= thresholds.firstPassRate,
      value: metrics.loopMetrics?.firstPassRate ?? 0,
      threshold: thresholds.firstPassRate,
    },
    openBugCount: {
      passed: (metrics._openBugCount ?? 0) <= thresholds.openBugCount,
      value: metrics._openBugCount ?? 0,
      threshold: thresholds.openBugCount,
    },
    minStabilizationDays: {
      passed: daysSince >= thresholds.minStabilizationDays,
      value: Math.floor(daysSince),
      threshold: thresholds.minStabilizationDays,
    },
    complexityTrend: {
      passed: metrics._complexityTrend === "decreasing",
      value: metrics._complexityTrend || "unknown",
      threshold: "decreasing",
    },
  };

  const allPassed = Object.values(criteria).every((c) => c.passed);
  return { shouldTransition: allPassed, criteria };
}

function checkTransitionToStabilization(metrics, config) {
  const thresholds =
    config?.curation?.transitionThresholds?.toStabilization ||
    DEFAULT_CONFIG.curation.transitionThresholds.toStabilization;

  const criteria = {
    successRate: {
      triggered: (metrics.successRate ?? 1) < thresholds.successRate,
      value: metrics.successRate ?? 1,
      threshold: thresholds.successRate,
    },
    failingStageRate: {
      triggered: false,
      value: 0,
      threshold: thresholds.failingStageRate,
    },
    openBugCount: {
      triggered: (metrics._openBugCount ?? 0) > thresholds.openBugCount,
      value: metrics._openBugCount ?? 0,
      threshold: thresholds.openBugCount,
    },
  };

  // Check stage fail rates
  if (metrics.stageMetrics) {
    for (const [stage, sm] of Object.entries(metrics.stageMetrics)) {
      if ((sm.failRate || 0) > thresholds.failingStageRate) {
        criteria.failingStageRate = {
          triggered: true,
          value: sm.failRate,
          threshold: thresholds.failingStageRate,
          stage,
        };
        break;
      }
    }
  }

  const anyTriggered = Object.values(criteria).some((c) => c.triggered);
  return { shouldTransition: anyTriggered, criteria };
}

async function evaluateModeTransition(metrics, config) {
  return withLock("curation-mode", async () => {
    const modeData = await loadCurationMode();
    if (modeData.forcedBy === "user") return { transitioned: false, modeData };

    const autoTransition =
      config?.curation?.autoTransition ??
      DEFAULT_CONFIG.curation.autoTransition;
    if (!autoTransition) return { transitioned: false, modeData };

    let result;
    if (modeData.mode === "stabilization") {
      result = checkTransitionToBigBet(metrics, modeData, config);
      if (result.shouldTransition) {
        const entry = {
          from: "stabilization",
          to: "big_bet",
          timestamp: new Date().toISOString(),
          triggeredBy: "auto",
          reason: "All stabilization→big_bet criteria met",
          criteria: result.criteria,
        };
        modeData.history.push(entry);
        modeData.mode = "big_bet";
        modeData.since = entry.timestamp;
        modeData.forcedBy = null;
        await saveCurationMode(modeData);
        log(`[curation] auto-transitioned to big_bet`);
        deps.broadcastWs?.("mode:changed", {
          previousMode: "stabilization",
          mode: "big_bet",
          reason: entry.reason,
          triggeredBy: "auto",
        });
        return { transitioned: true, modeData, direction: "to_big_bet" };
      }
    } else {
      result = checkTransitionToStabilization(metrics, config);
      if (result.shouldTransition) {
        const triggeredKeys = Object.entries(result.criteria)
          .filter(([, c]) => c.triggered)
          .map(([k, c]) => `${k}=${c.value}(threshold:${c.threshold})`);
        const entry = {
          from: "big_bet",
          to: "stabilization",
          timestamp: new Date().toISOString(),
          triggeredBy: "auto",
          reason: `Triggered by: ${triggeredKeys.join(", ")}`,
          criteria: result.criteria,
        };
        modeData.history.push(entry);
        modeData.mode = "stabilization";
        modeData.since = entry.timestamp;
        modeData.forcedBy = null;
        await saveCurationMode(modeData);
        log(`[curation] auto-transitioned to stabilization`);
        deps.broadcastWs?.("mode:changed", {
          previousMode: "big_bet",
          mode: "stabilization",
          reason: entry.reason,
          triggeredBy: "auto",
        });
        return { transitioned: true, modeData, direction: "to_stabilization" };
      }
    }

    return { transitioned: false, modeData };
  });
}

async function setMode(mode, reason) {
  if (mode !== "stabilization" && mode !== "big_bet") {
    throw new Error(
      `invalid mode: ${mode}. Must be "stabilization" or "big_bet"`,
    );
  }
  return withLock("curation-mode", async () => {
    const modeData = await loadCurationMode();
    if (modeData.mode === mode) return modeData;
    const entry = {
      from: modeData.mode,
      to: mode,
      timestamp: new Date().toISOString(),
      triggeredBy: "user",
      reason: reason || `User set mode to ${mode}`,
      criteria: {},
    };
    modeData.history.push(entry);
    const previousMode = modeData.mode;
    modeData.mode = mode;
    modeData.since = entry.timestamp;
    modeData.forcedBy = "user";
    await saveCurationMode(modeData);
    log(`[curation] mode set to ${mode} by user: ${reason}`);
    deps.broadcastWs?.("mode:changed", {
      previousMode,
      mode,
      reason: entry.reason,
      triggeredBy: "user",
    });
    return modeData;
  });
}

// ══════════════════════════════════════════════════════════════
// §3 — Multi-Axis Scoring
// ══════════════════════════════════════════════════════════════

const SCORE_AXES = [
  "impact",
  "urgency",
  "uncertainty",
  "executionCost",
  "cwFitness",
];

function getWeightProfile(profileName, config) {
  const profiles =
    config?.curation?.scoring?.profiles ||
    DEFAULT_CONFIG.curation.scoring.profiles;
  return profiles[profileName] || profiles.default;
}

function computePriority(scores, weights) {
  let sum = 0;
  for (const axis of SCORE_AXES) {
    const s = Number(scores[axis]) || 0;
    const w = Number(weights[axis]) || 0;
    sum += s * w;
  }
  return Math.max(0, Math.min(100, Math.round(sum) || 0));
}

function recalcPriority(proposal, config) {
  if (!proposal.scores) return proposal.priority || 0;
  const profileName =
    proposal.weightProfile ||
    config?.curation?.scoring?.activeProfile ||
    "default";
  const profile = getWeightProfile(profileName, config);
  return computePriority(proposal.scores, profile.weights);
}

async function batchRecalcPriorities(config) {
  let count = 0;
  for (const status of ["proposed", "approved", "packaged"]) {
    const proposals = await listProposals(status);
    for (const p of proposals) {
      if (!p.scores) continue;
      const newPriority = recalcPriority(p, config);
      if (newPriority !== p.priority) {
        p.priority = newPriority;
        await saveProposal(p);
        count++;
      }
    }
  }
  return { recalculated: count };
}

// ══════════════════════════════════════════════════════════════
// §4 — Proposal Clustering
// ══════════════════════════════════════════════════════════════

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function jaccardSimilarity(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function proposalText(p) {
  return [p.title, p.problem, p.change].filter(Boolean).join(" ");
}

async function loadClusters() {
  try {
    const raw = await readFile(CLUSTERS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    if (e && e.code !== "ENOENT")
      log(`[curation] loadClusters error: ${e.message}`);
    return { version: 1, clusters: {}, proposalToCluster: {} };
  }
}

async function saveClusters(data) {
  await writeJsonAtomic(CLUSTERS_PATH, data, PROPOSALS_DIR);
}

function generateClusterId() {
  return `cl-${crypto.randomBytes(4).toString("hex")}`;
}

function mergeScoredCluster(members) {
  const scores = {};
  for (const axis of SCORE_AXES) {
    const values = members
      .map((m) => m.scores?.[axis])
      .filter((v) => v != null);
    if (values.length === 0) {
      scores[axis] = 0;
      continue;
    }
    if (axis === "uncertainty") {
      scores[axis] = Math.min(...values);
    } else if (axis === "executionCost" || axis === "cwFitness") {
      // representative value (first member)
      scores[axis] = values[0];
    } else {
      scores[axis] = Math.max(...values);
    }
  }
  return scores;
}

async function clusterProposals(config) {
  return withLock("clusters", async () => {
    const threshold =
      config?.curation?.clustering?.similarityThreshold ??
      DEFAULT_CONFIG.curation.clustering.similarityThreshold;
    const maxSize =
      config?.curation?.clustering?.maxClusterSize ??
      DEFAULT_CONFIG.curation.clustering.maxClusterSize;

    const proposals = await listProposals("proposed");
    if (proposals.length === 0)
      return { version: 1, clusters: {}, proposalToCluster: {} };

    // Group by category
    const byCategory = {};
    for (const p of proposals) {
      const cat = p.category || "unknown";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(p);
    }

    const clusters = {};
    const proposalToCluster = {};

    for (const [, catProposals] of Object.entries(byCategory)) {
      if (catProposals.length < 2) continue;

      // Build similarity pairs (L2: Jaccard)
      const pairs = [];
      for (let i = 0; i < catProposals.length; i++) {
        for (let j = i + 1; j < catProposals.length; j++) {
          const sim = jaccardSimilarity(
            proposalText(catProposals[i]),
            proposalText(catProposals[j]),
          );
          if (sim >= threshold) {
            pairs.push({ i, j, similarity: sim });
          }
        }
      }

      // Union-Find clustering
      const parent = catProposals.map((_, idx) => idx);
      function find(x) {
        while (parent[x] !== x) {
          parent[x] = parent[parent[x]];
          x = parent[x];
        }
        return x;
      }
      function union(a, b) {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[ra] = rb;
      }

      for (const { i, j } of pairs) {
        union(i, j);
      }

      // Collect groups
      const groups = {};
      for (let i = 0; i < catProposals.length; i++) {
        const root = find(i);
        if (!groups[root]) groups[root] = [];
        groups[root].push(i);
      }

      for (const indices of Object.values(groups)) {
        if (indices.length < 2) continue;
        // Sort by priority before enforcing max cluster size so high-priority proposals are kept
        indices.sort(
          (a, b) =>
            (catProposals[b].priority || 0) - (catProposals[a].priority || 0),
        );
        const limited = indices.slice(0, maxSize);
        if (limited.length < 2) continue;
        const members = limited.map((i) => catProposals[i]);
        // Representative = highest priority (already sorted);
        const representative = members[0];
        const clusterId = generateClusterId();
        const mergedScores = mergeScoredCluster(members);

        const config2 = deps.config?.() || {};
        const profileName =
          config2?.curation?.scoring?.activeProfile || "default";
        const profile = getWeightProfile(profileName, config2);

        clusters[clusterId] = {
          id: clusterId,
          representativeId: representative.id,
          title: representative.title,
          category: representative.category,
          members: members.map((m, idx) => ({
            proposalId: m.id,
            role: idx === 0 ? "representative" : "variant",
            relationship:
              m.dedupHash === representative.dedupHash
                ? "duplicate"
                : "complementary",
          })),
          mergedScores,
          mergedPriority: computePriority(mergedScores, profile.weights),
        };

        for (const m of members) {
          proposalToCluster[m.id] = clusterId;
        }
      }
    }

    const data = { version: 1, clusters, proposalToCluster };
    await saveClusters(data);
    deps.broadcastWs?.("proposal:clustered", {
      clusterCount: Object.keys(clusters).length,
      newClusters: Object.keys(clusters),
    });
    return data;
  });
}

async function mergeIntoClusters(proposalIds, representativeId) {
  return withLock("clusters", async () => {
    const clusterData = await loadClusters();
    const proposals = [];
    for (const id of proposalIds) {
      const p = await loadProposal(id);
      if (!p) throw new Error(`proposal not found: ${id}`);
      proposals.push(p);
    }

    const rep = representativeId
      ? proposals.find((p) => p.id === representativeId)
      : proposals[0];
    if (!rep) throw new Error("representative not found in provided proposals");

    // Remove from existing clusters
    for (const id of proposalIds) {
      const existingClusterId = clusterData.proposalToCluster[id];
      if (existingClusterId && clusterData.clusters[existingClusterId]) {
        const cluster = clusterData.clusters[existingClusterId];
        cluster.members = cluster.members.filter((m) => m.proposalId !== id);
        if (cluster.members.length < 2) {
          // Dissolve cluster
          for (const m of cluster.members) {
            delete clusterData.proposalToCluster[m.proposalId];
          }
          delete clusterData.clusters[existingClusterId];
        } else if (cluster.representativeId === id) {
          // Re-elect representative
          cluster.representativeId = cluster.members[0].proposalId;
          cluster.members[0].role = "representative";
        }
      }
      delete clusterData.proposalToCluster[id];
    }

    const clusterId = generateClusterId();
    const mergedScores = mergeScoredCluster(proposals);
    const config2 = deps.config?.() || {};
    const profileName = config2?.curation?.scoring?.activeProfile || "default";
    const profile = getWeightProfile(profileName, config2);

    clusterData.clusters[clusterId] = {
      id: clusterId,
      representativeId: rep.id,
      title: rep.title,
      category: rep.category,
      members: proposals.map((p) => ({
        proposalId: p.id,
        role: p.id === rep.id ? "representative" : "variant",
        relationship:
          p.dedupHash === rep.dedupHash ? "duplicate" : "complementary",
      })),
      mergedScores,
      mergedPriority: computePriority(mergedScores, profile.weights),
    };

    for (const p of proposals) {
      clusterData.proposalToCluster[p.id] = clusterId;
    }

    await saveClusters(clusterData);
    return clusterData.clusters[clusterId];
  });
}

async function splitFromCluster(proposalId) {
  return withLock("clusters", async () => {
    const clusterData = await loadClusters();
    const clusterId = clusterData.proposalToCluster[proposalId];
    if (!clusterId) return { removed: false };

    const cluster = clusterData.clusters[clusterId];
    if (!cluster) {
      delete clusterData.proposalToCluster[proposalId];
      await saveClusters(clusterData);
      return { removed: true };
    }

    cluster.members = cluster.members.filter(
      (m) => m.proposalId !== proposalId,
    );
    delete clusterData.proposalToCluster[proposalId];

    if (cluster.members.length < 2) {
      // Dissolve cluster
      for (const m of cluster.members) {
        delete clusterData.proposalToCluster[m.proposalId];
      }
      delete clusterData.clusters[clusterId];
    } else if (cluster.representativeId === proposalId) {
      // Promote next member
      cluster.representativeId = cluster.members[0].proposalId;
      cluster.members[0].role = "representative";
    }

    await saveClusters(clusterData);
    return { removed: true, clusterId };
  });
}

// ══════════════════════════════════════════════════════════════
// §6 — Conflict Detection & Safe Scheduling
// ══════════════════════════════════════════════════════════════

async function detectConflicts(proposalId) {
  const proposal = await loadProposal(proposalId);
  if (!proposal) throw new Error(`proposal not found: ${proposalId}`);

  const conflicts = [];

  // Check overlap with active/pending proposals
  const activeProposals = [
    ...(await listProposals("approved")),
    ...(await listProposals("packaged")),
  ];
  for (const active of activeProposals) {
    if (active.id === proposalId) continue;

    // Category + project overlap
    if (
      active.category === proposal.category &&
      active.project &&
      active.project === proposal.project
    ) {
      conflicts.push({
        type: "category_project",
        severity: "medium",
        conflictsWith: active.id,
        detail: `Same category (${active.category}) and project (${active.project})`,
      });
    }

    // Dedup hash match
    if (active.dedupHash && active.dedupHash === proposal.dedupHash) {
      conflicts.push({
        type: "dedup",
        severity: "critical",
        conflictsWith: active.id,
        detail: "Identical dedup hash",
      });
    }
  }

  deps.broadcastWs?.("proposal:conflict_detected", {
    proposalId,
    conflicts,
    severity:
      conflicts.length === 0
        ? "none"
        : conflicts.some((c) => c.severity === "critical")
          ? "critical"
          : conflicts.some((c) => c.severity === "high")
            ? "high"
            : "medium",
  });

  return { proposalId, conflicts };
}

function determineInsertionPoint(proposal) {
  const category = proposal.category;
  const risk = proposal.risk;

  if (category === "docs") return "between_stages";
  if ((category === "bugfix" || category === "security") && risk === "high") {
    return "between_stages";
  }
  if (category === "architecture" || proposal.modeEligibility === "big_bet") {
    return "between_pipelines";
  }
  return "between_subtasks";
}

// Deferred queue
async function loadDeferredProposals() {
  try {
    const raw = await readFile(DEFERRED_PROPOSALS_PATH, "utf-8");
    const data = JSON.parse(raw);
    // Prune expired entries
    const now = new Date().toISOString();
    const before = data.entries.length;
    data.entries = data.entries.filter(
      (e) => !e.expiresAt || e.expiresAt > now,
    );
    if (data.entries.length < before) {
      log(
        `[curation] pruned ${before - data.entries.length} expired deferred entries`,
      );
      await saveDeferredProposals(data);
    }
    return data;
  } catch (e) {
    if (e && e.code !== "ENOENT")
      log(`[curation] loadDeferredProposals error: ${e.message}`);
    return { entries: [] };
  }
}

async function saveDeferredProposals(data) {
  await writeJsonAtomic(DEFERRED_PROPOSALS_PATH, data, DAEMON_DIR);
}

async function deferProposal(proposalId, insertionPoint, blockedBy) {
  return withLock("deferred", async () => {
    const deferred = await loadDeferredProposals();
    const existing = deferred.entries.find((e) => e.proposalId === proposalId);
    if (existing) {
      existing.insertionPoint = insertionPoint;
      existing.blockedBy = blockedBy;
      existing.status = "deferred";
      existing.expiresAt = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString();
    } else {
      deferred.entries.push({
        proposalId,
        insertionPoint,
        blockedBy: blockedBy || null,
        priority: 0,
        status: "deferred",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }
    await saveDeferredProposals(deferred);
    return deferred;
  });
}

// ══════════════════════════════════════════════════════════════
// §7 — Dual Curation (AI + User) & Curation History
// ══════════════════════════════════════════════════════════════

async function appendCurationLog(entry) {
  await appendJsonLine(CURATION_LOG_PATH, entry, PROPOSALS_DIR);
}

async function recordCurationAction(
  proposalId,
  action,
  previousValue,
  newValue,
  actor,
  reason,
) {
  const entry = {
    proposalId,
    actor,
    action,
    previousValue,
    newValue,
    reason: reason || "",
    timestamp: new Date().toISOString(),
  };
  await appendCurationLog(entry);
  return entry;
}

// ══════════════════════════════════════════════════════════════
// §8 — Execution Feedback Loop
// ══════════════════════════════════════════════════════════════

async function loadFeedback() {
  try {
    const raw = await readFile(FEEDBACK_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    if (e && e.code !== "ENOENT")
      log(`[curation] loadFeedback error: ${e.message}`);
    return {
      records: [],
      aggregates: {
        byCategory: {},
        byRisk: {},
        byCategoryRisk: {},
        lastUpdated: null,
      },
    };
  }
}

async function saveFeedback(data) {
  await writeJsonAtomic(FEEDBACK_PATH, data, PROPOSALS_DIR);
}

function updateAggregates(feedback) {
  const agg = {
    byCategory: {},
    byRisk: {},
    byCategoryRisk: {},
    lastUpdated: new Date().toISOString(),
  };

  const halfLifeDays =
    deps.config?.()?.curation?.feedback?.halfLifeDays ??
    DEFAULT_CONFIG.curation.feedback.halfLifeDays;
  const archiveAfterDays =
    deps.config?.()?.curation?.feedback?.archiveAfterDays ??
    DEFAULT_CONFIG.curation.feedback.archiveAfterDays;
  const now = Date.now();

  const activeRecords = feedback.records.filter((r) => {
    const ageDays =
      (now - new Date(r.executedAt).getTime()) / (1000 * 60 * 60 * 24);
    return ageDays <= archiveAfterDays;
  });

  const validVerdicts = new Set(["improved", "regressed", "neutral"]);

  for (const record of activeRecords) {
    const ageDays =
      (now - new Date(record.executedAt).getTime()) / (1000 * 60 * 60 * 24);
    const weight = 0.5 ** (ageDays / halfLifeDays);
    const verdict = validVerdicts.has(record.verdict)
      ? record.verdict
      : "neutral";

    for (const [keyField, keyValue] of [
      ["byCategory", record.category],
      ["byRisk", record.risk],
      ["byCategoryRisk", `${record.category}|${record.risk}`],
    ]) {
      if (!agg[keyField][keyValue]) {
        agg[keyField][keyValue] = {
          total: 0,
          improved: 0,
          regressed: 0,
          neutral: 0,
          avgScore: 0,
          weightedTotal: 0,
          weightedScoreSum: 0,
        };
      }
      const bucket = agg[keyField][keyValue];
      bucket.total++;
      bucket[verdict]++;
      bucket.weightedTotal += weight;
      bucket.weightedScoreSum += (record.evaluationScore || 0) * weight;
      bucket.avgScore =
        bucket.weightedTotal > 0
          ? bucket.weightedScoreSum / bucket.weightedTotal
          : 0;
    }
  }

  feedback.aggregates = agg;
  feedback.records = activeRecords;
}

async function recordFeedback(proposalId, taskId, outcome) {
  const proposal = await loadProposal(proposalId);
  if (!proposal) throw new Error(`proposal not found: ${proposalId}`);

  return withLock("feedback", async () => {
    const feedback = await loadFeedback();
    const record = {
      proposalId,
      taskId,
      category: proposal.category,
      risk: proposal.risk,
      project: proposal.project || null,
      scores: proposal.scores || null,
      verdict: outcome.verdict || "neutral",
      evaluationScore: outcome.score || 0,
      delta: outcome.delta || {},
      executionDurationMs: outcome.executionDurationMs || 0,
      executedAt: new Date().toISOString(),
    };

    feedback.records.push(record);
    updateAggregates(feedback);
    await saveFeedback(feedback);

    deps.broadcastWs?.("proposal:feedback_recorded", {
      proposalId,
      verdict: record.verdict,
      scoringAdjusted: false,
    });

    return record;
  });
}

function calibrateScores(rawScores, proposal, aggregates) {
  const key = `${proposal.category}|${proposal.risk}`;
  const stats = aggregates?.byCategoryRisk?.[key];
  const minSamples =
    deps.config?.()?.curation?.feedback?.calibrationMinSamples ??
    DEFAULT_CONFIG.curation.feedback.calibrationMinSamples;

  if (!stats || stats.total < minSamples || stats.total === 0) return rawScores;

  const calibrated = { ...rawScores };
  const successRate = (stats.improved || 0) / stats.total;

  if (successRate < 0.4) {
    calibrated.uncertainty = Math.min(100, (rawScores.uncertainty || 0) + 15);
  }
  if (successRate > 0.7 && stats.total >= 5) {
    calibrated.uncertainty = Math.max(0, (rawScores.uncertainty || 0) - 10);
  }
  if (stats.avgScore < 0) {
    calibrated.executionCost = Math.min(
      100,
      (rawScores.executionCost || 0) + 10,
    );
  }

  return calibrated;
}

// ══════════════════════════════════════════════════════════════
// §9 — Discard History
// ══════════════════════════════════════════════════════════════

async function loadDiscardHistory() {
  try {
    const raw = await readFile(DISCARD_HISTORY_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    if (e && e.code !== "ENOENT")
      log(`[curation] loadDiscardHistory error: ${e.message}`);
    return { records: [] };
  }
}

async function saveDiscardHistory(data) {
  await writeJsonAtomic(DISCARD_HISTORY_PATH, data, PROPOSALS_DIR);
}

async function discardProposal(proposalId, reason, actor) {
  const proposal = await loadProposal(proposalId);
  if (!proposal) throw new Error(`proposal not found: ${proposalId}`);

  const validReasons = [
    "duplicate",
    "superseded",
    "noise",
    "conflict",
    "manual",
    "regulator",
  ];
  const safeReason = validReasons.includes(reason) ? reason : "manual";

  return withLock("discard", async () => {
    const history = await loadDiscardHistory();
    const config = deps.config?.() || {};
    const maxRecords =
      config?.curation?.discard?.maxRecords ??
      DEFAULT_CONFIG.curation.discard.maxRecords;
    const retentionDays =
      config?.curation?.discard?.retentionDays ??
      DEFAULT_CONFIG.curation.discard.retentionDays;

    // Prune old records
    const cutoff = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    history.records = history.records.filter((r) => r.discardedAt >= cutoff);

    history.records.push({
      proposalId,
      title: proposal.title,
      category: proposal.category,
      risk: proposal.risk,
      project: proposal.project || null,
      dedupHash: proposal.dedupHash,
      discardedAt: new Date().toISOString(),
      actor: actor || "user",
      reason: safeReason,
      reasonDetail: reason !== safeReason ? reason : "",
    });

    // Enforce max records
    if (history.records.length > maxRecords) {
      history.records = history.records.slice(
        history.records.length - maxRecords,
      );
    }

    // Remove from clusters first (least impactful if partially fails)
    await splitFromCluster(proposalId);

    // Delete the proposal file before recording history
    // so if delete fails, we don't record a false discard
    await deleteProposal(proposalId);

    // Record history and log only after successful deletion
    await saveDiscardHistory(history);

    await appendCurationLog({
      proposalId,
      actor,
      action: "discard",
      reason: safeReason,
      timestamp: new Date().toISOString(),
    });

    deps.broadcastWs?.("proposal:discarded", {
      proposalId,
      reason: safeReason,
      discardedBy: actor,
    });

    return { proposalId, discarded: true };
  });
}

async function getDiscardedDedupHashes() {
  const history = await loadDiscardHistory();
  return new Set(history.records.map((r) => r.dedupHash).filter(Boolean));
}

// ══════════════════════════════════════════════════════════════
// §2.5 — Big Bet Readiness Checklist
// ══════════════════════════════════════════════════════════════

async function computeReadinessChecklist(proposalId) {
  const proposal = await loadProposal(proposalId);
  if (!proposal) throw new Error(`proposal not found: ${proposalId}`);

  const modeData = await loadCurationMode();

  // Impact scope estimation from proposal text
  const changeText = (proposal.change || "").toLowerCase();
  const fileMatches = changeText.match(/\b[\w/]+\.\w+\b/g) || [];
  const moduleMatches = changeText.match(/\bmodule|\blib\/|\bsrc\//gi) || [];

  const checklist = {
    impactScope: {
      passed: fileMatches.length <= 20,
      detail: `${fileMatches.length} files mentioned, ${moduleMatches.length} modules`,
    },
    rollbackPlan: {
      passed: true,
      detail: "git revert viable",
    },
    dependencies: {
      passed: true,
      detail: "none detected",
      blocking: [],
    },
    successCriteria: {
      passed: !!(
        proposal.expectedImpact && proposal.expectedImpact.length > 10
      ),
      detail: proposal.expectedImpact ? "defined in proposal" : "missing",
    },
    conflictFree: {
      passed: true,
      detail: "checking...",
    },
  };

  // Check conflicts
  try {
    const { conflicts } = await detectConflicts(proposalId);
    checklist.conflictFree.passed = conflicts.length === 0;
    checklist.conflictFree.detail =
      conflicts.length === 0
        ? "no active conflicts"
        : `${conflicts.length} conflict(s) detected`;
  } catch {
    checklist.conflictFree.passed = false;
    checklist.conflictFree.detail = "conflict check failed";
  }

  // Check dependencies — proposals in 'approved' state that overlap
  const approved = await listProposals("approved");
  const blocking = approved
    .filter(
      (a) =>
        a.project === proposal.project &&
        a.id !== proposalId &&
        a.category === proposal.category,
    )
    .map((a) => a.id);
  if (blocking.length > 0) {
    checklist.dependencies.passed = false;
    checklist.dependencies.detail = `blocked by ${blocking.length} active proposal(s)`;
    checklist.dependencies.blocking = blocking;
  }

  const allPassed = Object.values(checklist).every((c) => c.passed);
  const result = {
    proposalId,
    ready: allPassed,
    checklist,
    computedAt: new Date().toISOString(),
    promotable: allPassed && modeData.mode === "big_bet",
  };

  deps.broadcastWs?.("proposal:readiness_checked", {
    proposalId,
    ready: result.ready,
    failedChecks: Object.entries(checklist)
      .filter(([, c]) => !c.passed)
      .map(([k]) => k),
  });

  return result;
}

// ══════════════════════════════════════════════════════════════
// §2.4 — Mode-aware proposal filtering
// ══════════════════════════════════════════════════════════════

async function applyModeFilter(proposals, config) {
  const modeData = await loadCurationMode();
  if (modeData.mode !== "stabilization") return proposals;

  const exceptions =
    config?.regulator?.stabilizationExceptions ||
    DEFAULT_CONFIG.regulator.stabilizationExceptions;

  const result = [];
  for (const p of proposals) {
    if (exceptions.includes(p.category) || p.category === "security") {
      result.push(p);
      continue;
    }
    const isStabilizationCategory = [
      "bugfix",
      "core",
      "performance",
      "test",
    ].includes(p.category);
    if (isStabilizationCategory) {
      result.push(p);
    } else {
      // Tag as big_bet eligible, put on hold
      p.modeEligibility = "big_bet";
      const fromStatus = p.status || "proposed";
      try {
        await moveProposal(p.id, fromStatus, "held");
        p.status = "held";
        log(
          `[curation] proposal ${p.id} held (stabilization mode, category=${p.category})`,
        );
      } catch (err) {
        log(`[curation] failed to hold proposal ${p.id}: ${err.message}`);
        result.push(p);
      }
    }
  }
  return result;
}

// ══════════════════════════════════════════════════════════════
// Scoring Profile CRUD
// ══════════════════════════════════════════════════════════════

function listScoringProfiles(config) {
  const profiles =
    config?.curation?.scoring?.profiles ||
    DEFAULT_CONFIG.curation.scoring.profiles;
  return Object.entries(profiles).map(([key, p]) => ({
    key,
    label: p.label,
    weights: p.weights,
    active:
      key ===
      (config?.curation?.scoring?.activeProfile ||
        DEFAULT_CONFIG.curation.scoring.activeProfile),
  }));
}

module.exports = {
  setLog,
  setDeps,
  // Mode
  loadCurationMode,
  saveCurationMode,
  setMode,
  evaluateModeTransition,
  checkTransitionToBigBet,
  checkTransitionToStabilization,
  applyModeFilter,
  // Scoring
  SCORE_AXES,
  getWeightProfile,
  computePriority,
  recalcPriority,
  batchRecalcPriorities,
  calibrateScores,
  listScoringProfiles,
  // Clustering
  jaccardSimilarity,
  loadClusters,
  saveClusters,
  clusterProposals,
  mergeIntoClusters,
  splitFromCluster,
  // Conflict
  detectConflicts,
  determineInsertionPoint,
  loadDeferredProposals,
  deferProposal,
  // Curation history
  appendCurationLog,
  recordCurationAction,
  // Feedback
  loadFeedback,
  recordFeedback,
  updateAggregates,
  // Discard
  loadDiscardHistory,
  discardProposal,
  getDiscardedDedupHashes,
  // Readiness
  computeReadinessChecklist,
};
