// Task-community ("topic") detection for the session graph.
//
// Three passes:
//   1. Causal chains: every user-message opens a group; every following node
//      inherits that group until the next user-message.
//   2. Merge: chains that touch the same files belong to the same context.
//      Edits weigh four times a read; two chains merge when their weighted
//      file overlap reaches MERGE_SIMILARITY, scored against the geometric
//      mean of the two chains' total weight (lowest chain id wins).
//   3. Ride-along: chains with no file activity (pure discussion turns) join
//      the next chain's community, falling back to the previous one.
//
// Contract:
//   - Stamp `group` (int) + `groupLabel` (string) on every node.
//   - Return the total number of communities.
import type { Part } from "@opencode-ai/sdk"
import type { GraphNode } from "./topics-model.ts"

const EDIT_WEIGHT = 8
const READ_WEIGHT = 1 // a read is context, but weighs far less than an edit
// Calibrated across four real sessions by sweeping read weight,
// normalization and threshold against buildGraph's actual active-window
// chains. With sqrt normalization, unrelated chains stay well below 0.3
// while same-context ones clear it. Raise it if merging ever feels too
// eager.
const MERGE_SIMILARITY = 0.3

export function assignCommunities(nodes: GraphNode[], partsByNode: Map<string, Part[]>): number {
  // Pass 1: causal chains. A user-message opens the chain; every following
  // node rides along. While walking, collect each chain's touched files with
  // their weights.
  let groupN = -1 // the first user-message opens group 0
  const chainFiles = new Map<number, Map<string, number>>()
  for (const node of nodes) {
    if (node.kind === "user-message") {
      groupN += 1
      chainFiles.set(groupN, new Map())
    }

    node.group = groupN

    if (groupN < 0) continue
    const files = chainFiles.get(groupN)!
    for (const part of partsByNode.get(node.id) ?? []) {
      if (part.type !== "tool") continue
      if (!["read", "edit", "write"].includes(part.tool)) continue
      const input = part.state?.input ?? {}
      if (typeof input.filePath !== "string" || !input.filePath) continue
      const weight = part.tool === "read" ? READ_WEIGHT : EDIT_WEIGHT
      files.set(input.filePath, (files.get(input.filePath) ?? 0) + weight)
    }
  }

  // Pass 2: merge chains whose weighted file overlap clears the threshold.
  // score(a,b) = shared weight / sqrt(totalA * totalB) — the geometric mean,
  // so a small chain fully contained in a giant one no longer scores a
  // perfect match (0..1).
  const chainIds = [...chainFiles.keys()]
  const totals = new Map<number, number>()
  for (const gid of chainIds) {
    let sum = 0
    for (const weight of chainFiles.get(gid)!.values()) sum += weight
    totals.set(gid, sum)
  }

  const pairs: { a: number; b: number; score: number }[] = []
  for (let i = 0; i < chainIds.length; i++) {
    for (let j = i + 1; j < chainIds.length; j++) {
      const ga = chainIds[i]!
      const gb = chainIds[j]!
      const fa = chainFiles.get(ga)!
      const fb = chainFiles.get(gb)!
      if (fa.size === 0 || fb.size === 0) continue
      let shared = 0
      for (const [file, wa] of fa) {
        const wb = fb.get(file)
        if (wb) shared += Math.min(wa, wb)
      }
      const score = shared / Math.sqrt(totals.get(ga)! * totals.get(gb)!)
      if (score >= MERGE_SIMILARITY) pairs.push({ a: ga, b: gb, score })
    }
  }
  pairs.sort((x, y) => y.score - x.score)

  // Union-find with the lower chain id winning; transitive merges fall out.
  const parent = new Map<number, number>()
  for (const gid of chainIds) parent.set(gid, gid)
  const find = (gid: number): number => {
    const up = parent.get(gid)
    if (up === undefined || up === gid) return gid
    const top = find(up)
    parent.set(gid, top)
    return top
  }
  for (const pair of pairs) {
    const rootA = find(pair.a)
    const rootB = find(pair.b)
    if (rootA !== rootB) parent.set(Math.max(rootA, rootB), Math.min(rootA, rootB))
  }

  // Pass 3: final community per chain. File-less chains ride along with the
  // nearest file-bearing community (next one in order, else previous). A
  // session with no file activity at all keeps its plain chain grouping.
  const communityOfChain = new Map<number, number>()
  for (let k = 0; k < chainIds.length; k++) {
    const gid = chainIds[k]!
    if (chainFiles.get(gid)!.size > 0) {
      communityOfChain.set(gid, find(gid))
      continue
    }
    let target: number | undefined
    for (let m = k + 1; m < chainIds.length && target === undefined; m++) {
      if (chainFiles.get(chainIds[m]!)!.size > 0) target = find(chainIds[m]!)
    }
    if (target === undefined) {
      for (let m = k - 1; m >= 0 && target === undefined; m--) {
        if (chainFiles.get(chainIds[m]!)!.size > 0) target = find(chainIds[m]!)
      }
    }
    if (target !== undefined) communityOfChain.set(gid, target)
  }

  // Labels: each community is named after its most-touched file.
  const communityWeights = new Map<number, Map<string, number>>()
  for (const [gid, files] of chainFiles) {
    const community = communityOfChain.get(gid)
    if (community === undefined) continue
    const acc = communityWeights.get(community) ?? new Map<string, number>()
    for (const [file, weight] of files) acc.set(file, (acc.get(file) ?? 0) + weight)
    communityWeights.set(community, acc)
  }
  const labelOfCommunity = new Map<number, string>()
  for (const [community, files] of communityWeights) {
    const top = [...files.entries()].sort((x, y) => y[1] - x[1])[0]?.[0]
    labelOfCommunity.set(community, top ? top.split("/").slice(-2).join("/") : "work")
  }

  // Re-stamp every node through the merges and count surviving communities.
  for (const node of nodes) {
    if (node.group === undefined || node.group < 0) continue
    const community = communityOfChain.get(node.group)
    if (community === undefined) continue
    node.group = community
    node.groupLabel = labelOfCommunity.get(community) ?? "work"
  }

  const seen = new Set<number>()
  for (const node of nodes) {
    if (node.group !== undefined && node.group >= 0) seen.add(node.group)
  }
  return seen.size
}