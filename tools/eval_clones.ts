// eval_clones.ts — build paired plugin/pure sessions for the compaction eval.
// Usage: bun tools/eval_clones.ts <CASE|"all">   (CASE = U1..U11 | DEG)
// Deletes + rebuilds ONLY the requested case's clones so retries always start
// clean. Two serve processes share one DB but never the same session rows.
import { Database } from "bun:sqlite"
const ROOT = import.meta.dir.replace(/\/tools$/, "")

const DB = "/home/vscode/.local/share/opencode/opencode.db"
const db = new Database(DB)
db.exec("PRAGMA busy_timeout = 5000")

const MODEL = JSON.stringify({ id: "x-preview-f-free", providerID: "opencode", variant: "default" })
const rid = (n: number) =>
  Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("")

function cleanSlug(slug: string) {
  for (const sid of db.query("SELECT id FROM session WHERE slug=?").all(slug) as { id: string }[]) {
    db.query("DELETE FROM part WHERE session_id=?").run(sid.id)
    db.query("DELETE FROM message WHERE session_id=?").run(sid.id)
    db.query("DELETE FROM session WHERE id=?").run(sid.id)
  }
}

function srcInfo(slug: string) {
  const rows = db.query(`
    SELECT s.id, s.project_id, s.workspace_id, s.directory, count(m.id) c
    FROM session s LEFT JOIN message m ON m.session_id = s.id
    WHERE s.slug=? GROUP BY s.id ORDER BY c DESC`).all(slug) as any[]
  if (!rows.length) throw new Error(`source slug missing: ${slug}`)
  return rows[0]
}

function cloneFrom(srcSlug: string, dstSlug: string, title: string) {
  cleanSlug(dstSlug)
  const src = srcInfo(srcSlug)
  const snew = "ses_" + rid(20)
  db.query(
    "INSERT INTO session (id, project_id, workspace_id, parent_id, slug, directory, path, title, version, cost, time_created, time_updated, model) VALUES (?,?,?,NULL,?,?,?,?,?,0,?,?,?)",
  ).run(snew, src.project_id, src.workspace_id, dstSlug, src.directory || `${ROOT}`, "", title, "1.18.21", Date.now(), Date.now(), MODEL)

  const msgs = db.query("SELECT id, time_created, time_updated, data FROM message WHERE session_id=? ORDER BY time_created ASC, rowid ASC").all(src.id) as any[]
  const idMap = new Map<string, string>()
  for (const m of msgs) idMap.set(m.id, "msg_" + rid(24))
  for (const m of msgs) {
    const info = JSON.parse(m.data)
    const newId = idMap.get(m.id)!
    info.id = newId
    if (info.parentID && idMap.has(info.parentID)) info.parentID = idMap.get(info.parentID)
    info.sessionID = snew
    if (!info.tokens) info.tokens = { input: 800, output: 200, reasoning: 50, cache: { read: 0, write: 0 } }
    const t = m.time_created
    db.query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?)").run(newId, snew, t, t, JSON.stringify(info))
    const parts = db.query("SELECT data, time_created, time_updated FROM part WHERE message_id=? ORDER BY rowid ASC").all(m.id) as any[]
    for (const p of parts) {
      db.query("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?,?)").run("prt_" + rid(24), newId, snew, p.time_created, p.time_updated, p.data)
    }
  }
  console.log(`cloned ${srcSlug} -> ${dstSlug} (${msgs.length} msgs) [${snew}]`)
}

function addMsg(sid: string, role: "user" | "assistant", text: string, extraParts: any[] = [], parentID?: string, time?: number) {
  const mid = "msg_" + rid(24)
  const t = time ?? Date.now()
  const info: any = { id: mid, role, time: { created: t, updated: t }, sessionID: sid, tokens: { input: 800, output: 200, reasoning: 50, cache: { read: 0, write: 0 } } }
  if (parentID) info.parentID = parentID
  const parts: any[] = [{ type: "text", text }, ...extraParts]
  db.query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?)").run(mid, sid, t, t, JSON.stringify(info))
  for (const part of parts) {
    db.query("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?,?)").run("prt_" + rid(24), mid, sid, t, t, JSON.stringify(part))
  }
  return mid
}

function toolEdit(f: string, t: number) {
  return { type: "tool", tool: "edit", callID: "call_" + rid(8), state: { status: "completed", input: { filePath: f }, output: `Edited ${f}`, metadata: {}, title: f, time: { start: t, end: t + 500 } } }
}
function toolRead(f: string, t: number) {
  return { type: "tool", tool: "read", callID: "call_" + rid(8), state: { status: "completed", input: { filePath: f }, output: `contents of ${f}`, metadata: {}, title: f, time: { start: t, end: t + 200 } } }
}
function toolBashErr(cmd: string, err: string, t: number) {
  return { type: "tool", tool: "bash", callID: "call_" + rid(8), state: { status: "error", input: { command: cmd }, error: err, metadata: {}, title: cmd, time: { start: t, end: t + 300 } } }
}
function bashErr(cmd: string, err: string, t: number) {
  return toolBashErr(cmd, err, t)
}

function buildInline(slug: string, builder: (sid: string, t0: number, add: typeof addMsg) => void, startOffsetMs = 2_000_000) {
  cleanSlug(slug)
  const src = srcInfo("syn-rare")
  const snew = "ses_" + rid(20)
  db.query(
    "INSERT INTO session (id, project_id, workspace_id, parent_id, slug, directory, path, title, version, cost, time_created, time_updated, model) VALUES (?,?,?,NULL,?,?,?,?,?,0,?,?,?)",
  ).run(snew, src.project_id, src.workspace_id, slug, src.directory || `${ROOT}`, "", slug, "1.18.21", Date.now(), Date.now(), MODEL)
  builder(snew, Date.now() - startOffsetMs, addMsg)
  console.log(`built inline ${slug} [${snew}]`)
}

const builders: Record<string, () => void> = {
  U1: () => {
    for (const slug of ["x-u1-plugin", "x-u1-pure"]) {
      buildInline(slug, (sid, t0, add) => {
        let p: string | undefined
        p = add(sid, "user", "Add a simple in-memory cache to src/core.ts with get/set.", [], p, t0); t0 += 20000
        p = add(sid, "assistant", "Added get/set cache to src/core.ts.", [toolEdit("src/core.ts", t0)], p, t0); t0 += 20000
        p = add(sid, "user", "Add a clear() method too.", [], p, t0); t0 += 20000
        p = add(sid, "assistant", "Added clear() to src/core.ts.", [toolEdit("src/core.ts", t0)], p, t0); t0 += 20000
        p = add(sid, "user", "Make it thread-safe with a mutex.", [], p, t0); t0 += 20000
        p = add(sid, "assistant", "Wrapped get/set/clear in a mutex.", [toolEdit("src/core.ts", t0)], p, t0); t0 += 20000
      })
    }
  },
  U2: () => {
    for (const slug of ["x-u2-plugin", "x-u2-pure"]) {
      buildInline(slug, (sid, t0, add) => {
        let p: string | undefined
        p = add(sid, "user", "Build the request router in src/app.ts.", [], p, t0); t0 += 20000
        for (let i = 0; i < 11; i++) {
          p = add(sid, "user", `Router iteration ${i + 1}: handle more methods and edge cases.`, [], p, t0); t0 += 20000
          const parts = [toolEdit("src/app.ts", t0)]
          if (i % 2 === 0) parts.push(toolRead("src/app.ts", t0))
          p = add(sid, "assistant", `Router iteration ${i + 1}: added handlers and guards in src/app.ts.`, parts, p, t0); t0 += 20000
        }
      })
    }
  },
  U3: () => { cloneFrom("syn-parallel", "x-u3-plugin", "U3 parallel 3-way"); cloneFrom("syn-parallel", "x-u3-pure", "U3 parallel 3-way") },
  U4: () => { cloneFrom("syn-rare", "x-u4-plugin", "U4 rare-file drowned"); cloneFrom("syn-rare", "x-u4-pure", "U4 rare-file drowned") },
  U5: () => { cloneFrom("syn-decision", "x-u5-plugin", "U5 decision rationale"); cloneFrom("syn-decision", "x-u5-pure", "U5 decision rationale") },
  U6: () => { cloneFrom("syn-causal", "x-u6-plugin", "U6 causal chain"); cloneFrom("syn-causal", "x-u6-pure", "U6 causal chain") },
  U7: () => { cloneFrom("syn-blocked", "x-u7-plugin", "U7 blocked exact errors"); cloneFrom("syn-blocked", "x-u7-pure", "U7 blocked exact errors") },
  U8: () => { cloneFrom("syn-large", "x-u8-plugin", "U8 large stress"); cloneFrom("syn-large", "x-u8-pure", "U8 large stress") },
  U9: () => { cloneFrom("syn-rare", "x-u9-plugin", "U9 fusion base"); cloneFrom("syn-rare", "x-u9-pure", "U9 fusion base") },
  U10: () => {
    // h4-plugin lost its messages to a concurrent DB writer once already;
    // fall back to h4-pure (identical window) so both arms always get 880.
    const pick = () => {
      for (const s of ["h4-plugin", "h4-pure"]) {
        const info = srcInfo(s)
        const c = (db.query("SELECT count(*) c FROM message WHERE session_id=?").get(info.id) as any).c
        if (c > 100) return s
      }
      throw new Error("no viable h4 source")
    }
    const src = pick()
    console.log(`U10 source: ${src}`)
    cloneFrom(src, "x-u10-plugin", "U10 real historical")
    cloneFrom(src, "x-u10-pure", "U10 real historical")
  },
  // Two threads: an unresolved API blocker (exact error string) and normal
  // logger work. Fusion rounds must carry `401 Unauthorized` forward.
  U11: () => {
    for (const slug of ["x-u11-plugin", "x-u11-pure"]) {
      buildInline(slug, (sid, t0, add) => {
        let p: string | undefined
        p = add(sid, "user", "Add an API client in src/api/client.ts that fetches https://api.example.com/v1/spec.", [], p, t0); t0 += 20000
        p = add(sid, "assistant", "Implemented fetchSpec() in src/api/client.ts.", [toolEdit("src/api/client.ts", t0)], p, t0); t0 += 20000
        p = add(sid, "user", "Also add a structured logger in src/util/logger.ts.", [], p, t0); t0 += 20000
        p = add(sid, "assistant", "Added src/util/logger.ts with level support.", [toolEdit("src/util/logger.ts", t0)], p, t0); t0 += 20000
        p = add(sid, "user", "Fetch the spec now.", [], p, t0); t0 += 20000
        p = add(sid, "assistant", "curl returned HTTP/1.1 401 Unauthorized for https://api.example.com/v1/spec — the endpoint requires an API key header and we have none configured. BLOCKED until a key is provided.", [bashErr("curl https://api.example.com/v1/spec", "HTTP/1.1 401 Unauthorized", t0)], p, t0); t0 += 20000
        p = add(sid, "user", "Try a bearer token guess meanwhile.", [], p, t0); t0 += 20000
        p = add(sid, "assistant", "Guessed token rejected: still HTTP/1.1 401 Unauthorized. Remaining blocked on credentials for src/api/client.ts.", [bashErr("curl -H \"Authorization: Bearer guess\" https://api.example.com/v1/spec", "HTTP/1.1 401 Unauthorized", t0)], p, t0); t0 += 20000
        p = add(sid, "user", "Improve the logger while we wait for the key.", [], p, t0); t0 += 20000
        p = add(sid, "assistant", "Added child loggers with request IDs in src/util/logger.ts.", [toolEdit("src/util/logger.ts", t0)], p, t0); t0 += 20000
        p = add(sid, "user", "One more retry of the fetch.", [], p, t0); t0 += 20000
        p = add(sid, "assistant", "Retried: HTTP/1.1 401 Unauthorized again. Still blocked; logger work continues independently.", [bashErr("curl https://api.example.com/v1/spec", "HTTP/1.1 401 Unauthorized", t0)], p, t0); t0 += 20000
      })
    }
  },
  // Production-scale window (~30k tok): 5 workstreams x many iterations so
  // the 8k-token recency tail leaves a large multi-topic head. BIGF reuses
  // it for fusion at scale.
  // Mid-scale organic window (~11k tok): three distinct workstreams with
  // unique decisions, bug strings and file sets — sized so a real 16k-context
  // model keeps a meaningful multi-topic head outside its raw tail.
  MID: () => {
    const streams = [
      { dir: "src/auth", files: ["jwt.ts", "session.ts"], bugs: ["ERR_AUTH_401_TOKEN_EXPIRED", "HMAC rotation drift on leap seconds"] },
      { dir: "src/export", files: ["csv.ts", "quoting.ts"], bugs: ["CSV_QUOTE_ESCAPE_BUG", "BOM duplicated after append mode"] },
      { dir: "src/ci", files: ["retry.ts", "matrix.ts"], bugs: ["FLAKY_RACE_IN_RETRY_QUEUE", "worker pool starvation at p99"] },
    ]
    const decisions = [
      "chose HMAC key rotation over refresh tokens",
      "switched to RFC4180 quoting instead of regex escaping",
      "made retries jittered and idempotency-keyed",
    ]
    let n = 0
    const slugs = process.argv[2] === "MIDF" ? ["x-midf-plugin", "x-midf-pure"] : ["x-mid-plugin", "x-mid-pure"]
    for (const slug of slugs) {
      buildInline(slug, (sid, t0, add) => {
        let p: string | undefined
        p = add(sid, "user", "Kickoff: ship auth hardening, CSV export fix, and CI flake reduction this sprint.", [], p, t0); t0 += 30000
        let round = 0
        while (t0 < Date.now() - 100000) {
          round++
          streams.forEach((s, si) => {
            n++
            const f = s.dir + "/" + s.files[(round + si) % s.files.length]!
            const u = round % 3 === 0
              ? `Round ${round} ${s.dir}: ${s.bugs[n % s.bugs.length]!} resurfaced — address it in ${f}.`
              : `Continue ${f}: next increment for ${s.dir} (${round}-${n}).`
            p = add(sid, "user", u, [], p, t0); t0 += 15000
            const a = n % 4 === 0
              ? `Edited ${f}: ${decisions[si]!}. Verified against ${s.bugs[0]!}; tests green.`
              : `${f} updated (r${round}): handled edge case, added regression coverage; ${s.bugs[n % s.bugs.length]!} no longer reproduces.`
            p = add(sid, "assistant", a, [toolEdit(f, t0)], p, t0); t0 += 15000
          })
        }
      }, 2_450_000)
    }
  },
  // Real recorded histories for the engagement sweep: six genuine sessions,
  // never used by any prior eval round.
  ENG: () => {
    const sources: Array<[string, string]> = [
      ["crisp-forest", "cf"], ["quiet-river", "qriver"], ["brave-planet", "bplanet"],
      ["nimble-lagoon", "nlagoon"], ["witty-eagle", "weagle"], ["stellar-cabin", "scabin"],
    ]
    for (const [src, short] of sources) {
      cloneFrom(src, `x-eng-${short}-plugin`, "eng sweep")
      cloneFrom(src, `x-eng-${short}-pure`, "eng sweep")
    }
  },
  MIDF: () => { const saved = process.argv[2]; process.argv[2] = "MIDF"; builders.MID(); process.argv[2] = saved },
  BIG1: () => {
    for (const slug of ["x-big1-plugin", "x-big1-pure"]) {
      buildInline(slug, (sid, t0, add) => {
        const streams = [
          { dir: "src/export", files: ["csv.ts", "json.ts", "types.ts"] },
          { dir: "src/auth", files: ["jwt.ts", "session.ts"] },
          { dir: "src/queue", files: ["worker.ts", "retry.ts"] },
          { dir: "src/ui", files: ["table.tsx", "filters.tsx"] },
          { dir: "src/search", files: ["indexer.ts", "query.ts"] },
        ]
        let p: string | undefined
        p = add(sid, "user", "Kickoff: build all five subsystems this week — " + streams.map(s => s.dir.replace("src/", "")).join(", ") + ".", [], p, t0); t0 += 30000
        let round = 0
        while (t0 < Date.now() - 100000) {
          round++
          for (const s of streams) {
            const f = s.dir + "/" + s.files[round % s.files.length]
            p = add(sid, "user", round + "-" + s.dir + ": next increment for " + f + " — extend handlers and edge cases per plan.", [], p, t0); t0 += 20000
            p = add(sid, "assistant", "Edited " + f + " for round " + round + ": added handlers and edge-case coverage; tests pass.", [toolEdit(f, t0), toolRead(f, t0)], p, t0); t0 += 20000
          }
        }
      }, 8_000_000)
    }
  },
  BIGF: () => { cloneFrom("x-big1-plugin", "x-bigf-plugin", "fusion large"); cloneFrom("x-big1-pure", "x-bigf-pure", "fusion large") },
  DEG: () => { cloneFrom("syn-rare", "x-deg-plugin", "degradation loop"); cloneFrom("syn-rare", "x-deg-pure", "degradation loop") },
  // Recency-critical: substantial early multi-file work in the head, then
  // decisive reversals in the newest turns (approach switch + fresh secret +
  // deletion order) which live inside the raw tail at sweep-time keep sizes.
  U12: () => {
    for (const slug of ["x-u12-plugin", "x-u12-pure"]) {
      buildInline(slug, (sid, t0, add) => {
        let p: string | undefined
        p = add(sid, "user", "Kickoff: build the export pipeline — CSV writer in src/export/csv.ts, JSON writer in src/export/json.ts, shared types in src/export/types.ts.", [], p, t0); t0 += 30000
        for (let i = 0; i < 6; i++) {
          const f = ["src/export/csv.ts", "src/export/json.ts", "src/export/types.ts"][i % 3]
          p = add(sid, "user", `Export pipeline iteration ${i + 1}: extend ${f}.`, [], p, t0); t0 += 30000
          p = add(sid, "assistant", `Edited ${f} — export pipeline iteration ${i + 1} applied.`, [toolEdit(f, t0)], p, t0); t0 += 30000
        }
        p = add(sid, "user", "Add integration tests in src/export/pipeline.test.ts covering both writers.", [], p, t0); t0 += 30000
        p = add(sid, "assistant", "Added src/export/pipeline.test.ts with coverage for CSV and JSON writers.", [toolEdit("src/export/pipeline.test.ts", t0)], p, t0); t0 += 30000
        // ---- newest turns (recency tail at sweep keep sizes) ----
        p = add(sid, "user", "STOP — direction change: drop the streaming approach entirely, we buffer exports in memory instead.", [], p, t0); t0 += 30000
        p = add(sid, "assistant", "Understood: buffering in memory, streaming removed from the plan.", [], p, t0); t0 += 30000
        p = add(sid, "user", "The S3 bucket changed too: use s3://exports-prod-eu going forward.", [], p, t0); t0 += 30000
        p = add(sid, "assistant", "Noted: all uploads target s3://exports-prod-eu from now on.", [], p, t0); t0 += 20000
        p = add(sid, "user", "Also delete src/export/json.ts — JSON output was cut from scope.", [], p, t0); t0 += 30000
        p = add(sid, "assistant", "Deleted src/export/json.ts and removed its tests from src/export/pipeline.test.ts.", [toolEdit("src/export/pipeline.test.ts", t0)], p, t0)
      })
    }
  },
}

const arg = process.argv[2] ?? "all"
if (arg !== "all" && !builders[arg]) {
  console.error(`unknown case ${arg}; use U1..U11, DEG or all`)
  process.exit(1)
}
for (const [k, fn] of Object.entries(builders)) {
  if (arg === "all" || k === arg) fn()
}
db.close()
console.log(`DONE clones ${arg}`)
