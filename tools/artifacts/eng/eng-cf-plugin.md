# TOPIC 1: opencode-topic-compaction/compaction-report.md
- Consolidated change queue locked: **approved** #1 §1 terminology paragraph (*conversation window* = submitted session content, *context window* = configured maximum, explicitly independent e.g. 10k window under 16k+32k contexts); #2 §1 sizing rationale (multi-topic head above default raw tail + generation headroom; MID ~11k tok ↔ 16k models, BIG ~27k tok ↔ 32k); #3 §4/§8 "~27k tok **of history**" disambiguation phrasing; #6 §9 rework (delete frontier-model item 4; extend instability item 3 with *"…how this rate transfers to other models is unknown"*; §4 transparency note stays verbatim)
- **Optional, folded into batch**: #4 §0 concrete topic-definition sentence (chains opened by user messages, tool calls attach files, edits weigh 8× reads, merge at weighted-overlap ≥ 0.3, dominant-file labels, time-gap fallback); #5 §2 small-window-yield explainer (head literally empty below tail, break-even math ≈ override tokens vs saved tokens); #7 §5 engagement sampling-composition note (synthetics probe boundaries / under-sample by construction; organic n=2 sessions 5/5 = production-relevant signal)
- Sweep-driven rewrites pre-planned (outcome-dependent): §5 gains *recorded real sessions* block — per-session window size + mechanism (yield / injected→`# TOPIC` / injected→native) + measured rate line replacing "n=2 organic" framing; §1 case-suite *Real-world windows* row updated; high compliance → verdict gains rate clause + n=2 caveat deleted; mixed → mechanism column carries story; organic non-compliance → new §9 limitation (shape compliance model-cooperated even organically)
- Fresh base-arm outputs double as degeneracy datapoints: degradation → §4 study counts updated with same transparency framing; clean → one sentence noting wider sample held
- All fixes #1–#7 land in **one consolidated edit pass after the sweep finishes**, then user re-reads (their open question "include optional #4/#5/#7?" was implicitly answered yes by accepting the plan)
- blocked: none so far

# TOPIC 2: opencode/patch_mid.ts
- Engagement sweep is **remote-tier only** (confirmed): >32k-token windows physically cannot fit local 16k/32k LM Studio loads
- Runner supports tier overrides via `EVAL_PROVIDER` / `EVAL_MODEL` env (defaults `opencode` / `x-preview-f-free`)
- Parked post-publication: MIDPLUS @16k (~12.5k text-tok window, real model) proving topic path fires inside a genuine small-context deployment
- Standing fusion datapoints unchanged: 16k U9-plugin 1870 ch TOPIC ✓, U11-plugin 1921 ch ✓ carrying verbatim `HTTP/1.1 401 Unauthorized`; 32k U9-plugin 2831 ch, U11-plugin 1507 ch; declared-context 2048 sweep all native-format yields; U9-plugin-r2 at declared-context still uncaptured (provider hang)
- blocked: none so far

# TOPIC 3: opencode-topic-compaction/feedback-chatbot.md
- External chatbot feedback fully absorbed into the change queue (#1–#7) and §4-corrections lineage; no open items remain from it
- blocked: none so far

# TOPIC 4: opencode-topic-compaction/README.md
- Real sessions located in `/home/vscode/.local/share/opencode/opencode.db`: six organic histories never used in evals — `crisp-forest` 1171 msgs (plugin assessment), `quiet-river` 893 (code study Q&A, distinct domain), `brave-planet` 508, `nimble-lagoon` 503, `witty-eagle` 501, `stellar-cabin` 460; `h1-h4`/`e1-e4`/`syn-*` are prior-eval clones (excluded); short @explore subagent runs excluded
- Harness written via `/tmp/opencode/patch_eng.ts`: `tools/eval_clones.ts` gained `ENG:` builder (before `MIDF:`) cloning each source → `x-eng-{cf,qriver,bplanet,nlagoon,weagle,scabin}-{plugin,pure}`; `tools/eval_run2.ts` gained imports (`mkdirSync`, `activeWindow`/`buildGraph` from `../src/graph-model.ts`, `compactionContext` from `../src/graph-compaction.ts`), `ENG_SESSIONS`, `classifyEng()` (returns `{slug,msgs,head,rawTail,nodes,gatePass,injectedChars}`), `runEngSweep()` (reclone once → `${OUT}/eng-classify.jsonl` → paired arms plugin `:4399` then pure `:4400`, one in-place retry, writes `${OUT}/eng-<short>-<arm>.md`, appends `results.jsonl` `{kase:"eng-<short>",arm,ok,chars,secs}`, ends `"ENG SWEEP DONE"`), dispatch `else if (target === "ENG")`. Verified: `cloner ENG: true`, `runner ENG: true | dispatched: true`
- Launch incidents fixed: importing `eval_clones.ts` ran its main (side-effect module) creating 3 partial clones (e.g. `ses_ltuxqxd99qus710etbtl`) — purged via SQL DELETE ("cleaned 3 stale eng sessions"); `bun build tools/eval_run2.ts --outfile=/dev/null` hung indefinitely, ate the first launch window (no log created) — avoid `bun build` compile checks, validate by direct execution
- Final launch issued (result unobserved): `setsid nohup bash -c 'cd /workspaces/opencode-topic-compaction; export EVAL_PROVIDER=opencode EVAL_MODEL="x-preview-f-free" POLL_BUDGET_SECS=600; bun tools/eval_run2.ts ENG' > /tmp/opencode/eng_sweep.log 2>&1 &` then `sleep 60; head -12 /tmp/opencode/eng_sweep.log`
- Budget: user allows absolute max ~5 h wall clock; estimate 60–120 min for ~12 remote generations + stalls
- blocked: none so far (pending first successful log read)

# STATE
- Overall goal: finalize `compaction-report.md` for opencode-topic-compaction; the real-history engagement sweep replaces the weakest evidence (n=2 organic engagement) before one consolidated report edit pass and user re-read
- Current status: ENG harness verified and sweep just launched detached; last tool call returned no visible output, so liveness unconfirmed
- What to do next:
  1. Confirm process/log: `pgrep -f "eval_run2.ts ENG"` + read `/tmp/opencode/eng_sweep.log`; if absent/dead, relaunch the exact setsid command (skip `bun build`)
  2. Poll until `ENG SWEEP DONE`, tracking per-arm lines `eng-<short>-<arm>: OK <n> ch startsTopic=<bool> in <s>s`
  3. Analyze `/tmp/opencode/compaction-eval/` (`eng-classify.jsonl`, `eng-*.md`): gate-pass vs yield, injected/`# TOPIC` compliance, CJK/meta-echo/runaway scan on base arms
  4. Snapshot artifacts to `tools/artifacts/eng/`, run gates (baseline: `src/test_cluster.ts` 30→51 checks all passing), then apply the single consolidated report pass (§5 rewrite + §1 case-suite row + #1–#7 + outcome branches) and present the diff for user feedback
  5. After feedback, resume remaining TODOs — mine: secrets sweep, `package.json`/`tsconfig.json` sanity, optional CI workflow running `bun src/test_cluster.ts`; user's: code review of `src/*` (+ mirror rule: copy to `.opencode/plugins/`, rerun gates), README voice + LICENSE copyright holder name passes, `.opencode/` published-subset decision, commit & push (commit set: `src/` ↔ `.opencode/plugins/`, `tools/` incl. `artifacts/{16k,32k}/` + `artifacts/eng/`, `README.md`, `AGENTS.md`, `compaction-report.md`, `session-vanish-race.md`; `.gitignore` covers `node_modules` symlink and `graph-poc/`)