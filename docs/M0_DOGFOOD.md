# M0 — Stock KMind dogfood: one real recall session, one observed friction

Owner: oss-factory [#212](https://github.com/kvnloo/oss-factory/issues/212) §7 (sequencing authority). This file is the fork-local work packet because Issues are disabled on this fork. When Issues are enabled, copy this into the first issue and link it from #212.

Audit pin: fork `main` == upstream `main` at `42f1706` on 2026-10-20. Re-resolve before touching code.

## Goal lock
Make **one personally relevant recall session** easy in stock KMind on a real host. Preserve the real source note, the user's explicit rating, review state, and reopen behavior. Do not substitute planning, a new app, a schema, a test harness or a different repo's experiment for that outcome.

## A. Reconcile before mutating
- [ ] Read this fork's contribution/agent instructions, upstream head, any branches/PRs. Record exact SHAs.
- [ ] Confirm an **authorized** Obsidian (preferred) or SiYuan host actually exists on the user's machine. Use a disposable/test vault or a backed-up profile. Host unavailable = blocker to report, not a reason to rewrite KMind.
- [ ] Build from the pinned scripts after checking the live lockfile: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm lint && pnpm build:obsidian`. Node 22+, pnpm 11.15.0. Record pass/fail; a browser playground is not a host.

## B. Observe the unmodified workflow
- [ ] Pick 3–5 real notes from one current project (a repo lesson, a decision, a conversation takeaway). Keep source links; separate facts from interpretation. No chat-history ingestion.
- [ ] Walk the actual journey: open → bind note to a locus → attempt unaided recall → reveal → explicit rating → close → reopen → land on the right content.
- [ ] Record only: build/host, steps completed/failed, rough time per step, corrections needed, whether persistence survived reopen, and whether the user would voluntarily repeat it tomorrow. No keystroke/screenshot/wearable instrumentation for this.

## C. Select one change from observed friction (or none)
Candidate categories (hypotheses, not asserted bugs): hard launch, too many binding steps, confusing recall/reveal, lost place after reopen, inaccessible controls, source prep burden.
- [ ] If a bottleneck is confirmed: one narrow fork-local change with a reproducer, tests, and a native recheck of the same job stock-vs-candidate. Preserve cancel, offline, missing-note handling and review ownership (KMind's local FSRS stays scheduler; Anki collections untouched).
- [ ] If no meaningful bottleneck: write "stock sufficient; no patch" and stop.

## D. Acceptance (M0 gate from #212 §7D)
- [ ] User reaches meaningful content, recalls unaided, rates explicitly, and recovers it after close/reopen on the real host.
- [ ] Bottleneck + stock-vs-candidate outcome recorded, or "stock sufficient" justified.
- [ ] Existing Anki data unchanged; pilot review state isolated with one owner.
- [ ] Opt-out/cancel works; no required AI provider, sensor or background service (leave optional AI off for the baseline).
- [ ] Proof tiers labeled: source / test / native-device. No learning-efficacy claim.

## Receipt format
One comment on oss-factory #212: host + build SHA, what changed or did not, observed journey timings, tests run vs not run, one next justified action (M1 capture only if capture was the bottleneck).

## Not in scope
Neuroforge scaffold, Anki compiler, Civ 100-card pilot, NOOP/ActivityWatch bridges, Hermes adapters, any `hcl:backlog` issue. License: MPL-2.0 with upstream name/icon restrictions (suka233 / KMind contributors) — inspect before any distribution.
