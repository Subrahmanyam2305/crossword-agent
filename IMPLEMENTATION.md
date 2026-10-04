# Crossword agent: implementation guide

**Target:** a complete, explainable submission by Tuesday, October 6, 2026, using 5–6 hours of development and at most $100 in Nebius credits. This is a build plan; no implementation or benchmark results are claimed here.

## 1. Recommended scope

Build a **Python solver with a small Streamlit interface**: upload puzzle JSON, generate answer candidates through Nebius, search for compatible answers, and request more candidates when blocked. Show the grid, progress, elapsed time, and an honest completion status. Streamlit keeps the UI and solver in one process; a TypeScript frontend is a later extension.

Support standard English Across/Down puzzles, including black squares and variable answer lengths. Benchmark small 5×5 puzzles. Exclude cryptics, rebuses, image recognition, training, retrieval, and deployment from this submission. Use plain Python orchestration, the OpenAI-compatible SDK, Pydantic, Streamlit, python-dotenv, and pytest.

The defensible engineering contribution is the **generate → validate → search → expand** loop, its explicit limits, and measured improvement over simpler variants.

## 2. Corrections to the original plan

| Original assumption | Correction and consequence |
|---|---|
| Greedy fill followed by conflict repair | Conflict-rejecting fills cannot create the conflicts that trigger repair. Trigger recovery on blocked/unassigned clues instead. |
| A mutable grid is sufficient state | It loses each answer's ownership of crossing letters. Store entry assignments; derive the grid. Undo must preserve neighboring answers. |
| Most known letters means MRV | Minimum remaining values means **fewest currently compatible candidates**; recompute after each assignment. |
| 43.5% → 89.6% proves the pattern prompt's effect | This is the complete SweepClip procedure's clue accuracy on 100 Monday NYT grids using GPT-4-Turbo. Its letter accuracy was 93.1%, with 48% perfect grids. It does not predict our results. [NAACL 2025, §5.1](https://aclanthology.org/2025.naacl-long.104.pdf) |
| Berkeley's results transfer directly | Its 81.7% perfect versus 44.3% without local search supports revision, but uses specialized models and a different dataset. Borrow the separation of language inference and constraints, not the performance claim. [BCS, Table 4](https://aclanthology.org/2022.acl-long.219v2.pdf) |
| NYT archive supplies Minis; EVALITA establishes English SOTA | The cited [archive example](https://raw.githubusercontent.com/doshea/nyt_crosswords/master/2018/03/09.json) is 15×15. EVALITA's retrieval result concerns Italian isolated clues. Neither supports the proposed Mini claims. [EVALITA overview](https://ceur-ws.org/Vol-4195/62.pdf) |

## 3. Solver design

### Data contract and state

Use an explicit JSON schema: `id`, `rows`, `cols`, `blocks: [[row,col], ...]`, and `clues: [{id,text,row,col,direction,length}]`. Coordinates are zero-based; direction is `A` or `D`. Supply a complete original example in the repository. Validate bounds, unique IDs, slot geometry, block intersections, and coverage of every open cell.

Keep solutions in a **separate evaluation file/object**, never in the object passed to `solve()`. At import, build each slot's ordered cells and crossing tuples `(clue_a, offset_a, clue_b, offset_b)`.

```python
domains: dict[str, list[str]]       # Ranked, validated candidate answers
assignments: dict[str, str]         # Canonical tentative state
# derive_grid(assignments), compatible(clue, answer, assignments)
# solve(puzzle_without_gold, config) -> SolveResult
```

**Generate.** Request up to eight distinct candidates per clue, ranked by plausibility, with clue text and length. Use `{"candidates":["NILE", ...]}`. Normalize case and ordinary spacing/hyphenation; reject other unsupported characters, wrong lengths, duplicates, and pattern violations. Fewer than eight valid candidates is acceptable. Candidate rank is an ordering heuristic, not calibrated confidence.

**Search.** Implement bounded depth-first backtracking. Seed the best partial result with a greedy fill, then search from empty assignments. Choose the unassigned slot with the smallest compatible domain; break ties by most unassigned neighbors, then clue ID. Try candidates in rank order. Forward-check neighboring domains and backtrack on an empty one. Copy the small assignment dictionary on each branch instead of manually erasing grid cells. Keep the best consistent partial assignment **before** pruning a dead end, ranked by assigned-slot count, then lower summed candidate rank. Preserve it across rounds.

**Expand.** When search cannot complete, select an unassigned clue with zero compatible candidates first, then the most known crossing letters, then clue ID. Derive its pattern from other assignments only. Request additional candidates; if none are new, relax a letter from the worst-ranked assigned neighbor, then try an unconstrained query within the call budget. Treat crossing letters as tentative. Merge new candidates, retain initial rankings, and restart search from empty assignments so earlier choices can change. Skip previously attempted `(clue, pattern, model, prompt_version)` queries.

```text
initial_candidates = generate(puzzle)
best = search(initial_candidates)
while incomplete(best) and budget_remaining:
    additions = expand_blocked_clues(best)
    if no new candidates after permitted pattern relaxations: stop
    best = better_partial_or_complete(best, search(merged_candidates))
return best, status, usage, event_log
```

Start with four concurrent model calls, three expansion rounds, three expansion calls per round (including pattern fallbacks), and a search limit of 50,000 nodes or two seconds per pass. Cap the whole puzzle at 120 seconds; clip request timeouts and retry waits to the remaining deadline. Tune limits on development puzzles. Every retry counts against time and spending limits. A search cutoff is not proof that the candidate set is infeasible.

Return `complete_consistent` only when every clue is assigned with valid lengths and matching crossings; otherwise return `stalled`, `budget_exhausted`, or `provider_error`. A fully filled, consistent grid can still be wrong. The first complete assignment is acceptable for this MVP; do not claim it is globally optimal. Gold answers must never drive search, ranking, regeneration, or stopping.

## 4. Nebius integration and cost controls

Use `NEBIUS_API_KEY`, configurable `NEBIUS_MODEL`, and `https://api.tokenfactory.nebius.com/v1/`. Load `.env` at startup; keep credentials server-side and `.env` ignored. [Nebius quickstart](https://docs.tokenfactory.nebius.com/quickstart)

Before building around a model, fetch `GET /v1/models?verbose=true`, save its accessible ID and prices, and make one real candidate-generation request. Current Nebius examples use `nvidia/Nemotron-3_5-Lightning` for text and `MiniMaxAI/MiniMax-M3` for reasoning; treat these as smoke-test candidates, not proven crossword winners. Choose on the development set and freeze before testing. Do not assume the three historical IDs in `PLAN.md` remain available. [Nebius model defaults and availability caveat](https://github.com/nebius/nebius-physical-ai/blob/main/docs/workbench/token-factory.md)

Use supported JSON-schema output, falling back to JSON mode and local validation. Verify compatibility for the selected model. Use low temperature where supported, bounded output tokens, and at most one malformed-output retry. Reasoning models may need a larger token cap to produce their final JSON. [Structured output](https://docs.tokenfactory.nebius.com/ai-models-inference/json)

Set a 30-second request timeout and at most two transient retries, with jitter and `Retry-After`; fail immediately on invalid credentials. Avoid stacked SDK/application retry loops. [Rate limits](https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits)

Cache by model, prompt version, generation settings, clue, length, and pattern. Record usage, latency, retries, and finish reason for every call. Budget $5 for pilots and $20 for the initial benchmark, with an $80 total stop leaving $20 in reserve. Reserve estimated maximum in-flight cost before dispatch; retain reservations after timeouts with unknown usage. Calculate cost from actual billed tokens and the saved prices; the verbose catalog's prices are **per token**, not per million. Record unknown usage as unknown. [Model listing and pricing fields](https://docs.tokenfactory.nebius.com/api-reference/examples/list-of-models)

## 5. Benchmark that fits the assignment

### Dataset and isolation

Use Tree-of-Thoughts' **156 GooBix 5×5 puzzles**. Each record contains ten clues, five across then five down, and 25 solution letters in row-major order. They have no black squares and every answer has length five. Add two original blocked-grid fixtures to test the broader input format. [Dataset](https://github.com/princeton-nlp/tree-of-thought-llm/blob/master/src/tot/data/crosswords/mini0505.json), [loader](https://github.com/princeton-nlp/tree-of-thought-llm/blob/master/src/tot/tasks/crosswords.py)

```python
dev_indices = [135, 140, 145, 150, 155]
test_indices = list(range(0, 100, 5))  # 20 puzzles; zero-based indices
```

The test indices follow the [official experiment notebook](https://github.com/princeton-nlp/tree-of-thought-llm/blob/master/scripts/crosswords/search_crosswords-dfs.ipynb); the development split is our explicit choice. Pin the source commit and SHA-256 in a manifest. Check disjoint puzzle IDs and duplicate full-puzzle hashes; report any repeated clues across splits. Tune only on development puzzles, then freeze prompts and limits.

Bundle your original examples; provide an attributed download script for the research data and keep downloaded puzzles out of Git. The repository's software license alone does not establish the original puzzles' redistribution rights. This old public benchmark may overlap model training data; describe results as exploratory, not evidence of unseen-puzzle generalization. Do not label these puzzles by NYT weekday difficulty.

### Paired conditions

Run one selected Nebius model on all 20 test puzzles with **the same cached initial candidates**:

| Condition | What it measures |
|---|---|
| A. Greedy | Select by MRV and commit the first fitting candidate; remove blocked entries from the pending queue while leaving them unassigned. |
| B. Search | Backtracking and forward checking, with no candidate expansion. |
| C. Full agent | Identical search plus bounded expansion. |

This isolates search gains (B−A) and expansion gains (C−B). An optional second model comes after the complete submission works. Initial top-1 clue accuracy and candidate recall@8 are useful offline diagnostics; independent answers can conflict, so do not overwrite them into a supposedly valid grid.

Report **letter accuracy** over unique open cells, **word accuracy** over exact strings read from each final grid slot, and **perfect puzzles** as an integer count plus percentage. Blanks count as incorrect. Also report fill coverage, completion status, API failures, timeouts, elapsed time, tokens, and estimated USD. Keep every frozen test puzzle in the denominator, including failures.

Save one CSV row per puzzle/condition plus run configuration and local JSONL traces. Report macro-average accuracy and paired per-puzzle deltas; include a paired bootstrap interval over puzzles if time allows. With 20 puzzles, one perfect solution changes the rate by five percentage points. For cost comparisons, include shared initial generation in each condition's standalone estimate, while reporting actual deduplicated spend separately. Cached replay time is not live inference latency.

Inspect at least three failures: missing candidate, bad candidate ranking, search cutoff, overconstrained expansion, or provider/format error. Publish observed values even if the full agent loses. Never fill a results table with expected numbers or compare this small dataset directly with published NYT percentages.

## 6. Build order and repository

```text
src/crossword_agent/
  puzzle.py       # Validation, slots, crossings, derived grid
  solver.py       # Greedy, bounded search, candidate expansion
  nebius.py       # Prompts, validation, retries, cache, usage
  evaluate.py     # Gold isolation, metrics, paired runs
app.py            # Streamlit demo
scripts/          # fetch_data.py, benchmark.py
tests/            # Deterministic fixtures and failure cases
data/examples/    # Original runnable puzzles
data/manifest.json
results/          # Actual CSV, config, concise findings
README.md, IMPLEMENTATION.md, pyproject.toml, uv.lock, .env.example
```

| Elapsed time | Deliverable |
|---|---|
| 0:00–0:25 | Scaffold, Nebius smoke test, dataset import, schema. |
| 0:25–1:35 | Deterministic solver and meaningful tests using fake candidates. |
| 1:35–2:15 | Nebius candidate generation, expansion, cache, usage limits. |
| 2:15–2:45 | Development runs; freeze settings and launch benchmark. |
| 2:45–3:25 | Visual demo while benchmark runs. |
| 3:25–4:05 | Inspect results and failures; write measured findings. |
| 4:05–4:45 | README, clean-install check, GitHub repository. |
| 4:45–5:20 | Rehearse and record the one-minute video. |
| 5:20–6:00 | Buffer for defects and submission checks. |

Required tests: a wrong first guess that needs backtracking; a missing answer recovered by a mocked expansion; crossing letters surviving reassignment; repair patterns excluding the target's own letters; hand-calculated accuracy with blanks; provider/budget failure returning a consistent partial result. These should run without credentials. Separately verify a real Nebius call and one end-to-end puzzle.

The README should make these intended commands work from a clean checkout:

```bash
uv sync --frozen
cp .env.example .env                 # Set the Nebius key and verified model
uv run python scripts/fetch_data.py
uv run pytest
uv run streamlit run app.py
uv run python scripts/benchmark.py --split test --strategies greedy,search,full
```

Explain the search with one hand-traced failure and recovery. Keep brief design notes on why you chose bounded search, separate gold data, and this benchmark. Review every generated module and be ready to explain its invariants and limitations. Declare AI assistance honestly if asked or required.

## 7. Demo and client-facing delivery

Use one screen: numbered grid, Across/Down clues, Solve button, visible progress, and a compact results panel. Emit concise events such as “candidate rejected: wrong length” and “expanded 3D after search stalled.” Show completion separately from evaluation accuracy; arbitrary uploads without answers cannot display accuracy. Streamlit's [status container](https://docs.streamlit.io/develop/api-reference/status/st.status) supports progress updates. Preserve run state across UI reruns to avoid duplicate paid requests.

Aim for a 50–55-second recording with readable text and this structure:

| Time | Show and say |
|---|---|
| 0–10s | “This agent takes a crossword and its clues, then returns a proposed solution with a visible progress trail.” |
| 10–28s | Show a run: “Nebius generates plausible answers. The solver checks shared letters, revisits blocked choices, and requests alternatives when needed.” |
| 28–43s | Show actual results: “Across 20 test puzzles, the agent achieved **[measured accuracy]**, compared with **[baseline]**, at **[measured cost and latency]**.” |
| 43–55s | “The main remaining issue is **[observed failure]**. The system returns partial results when it reaches its limits. My next improvement would target that failure.” |

Choose a development puzzle demonstrating real recovery. If inference is slow, replay a saved real trace labeled **Recorded run**; retain the actual live latency in the results. Replace every placeholder before recording. Finish with repository and video links, runnable instructions, measured benchmarks, and explicit limitations. Consider retrieval only if the observed failures justify it.
