# Crossword Agent — Research & Implementation Plan

## What We Know From Prior Art

Four generations of crossword solvers, each building on the last:

| Generation | System | Approach | Best Accuracy |
|---|---|---|---|
| 1 | Dr.Fill (2011) | TF-IDF QA + depth-first search | 71% perfect puzzles |
| 2 | Berkeley Crossword Solver (ACL 2022) | Neural bi-encoder + Loopy Belief Propagation + Local Search | 82% perfect puzzles |
| 3 | LMs are Crossword Solvers (NAACL 2025) | Pure LLM + constraint-aware iterative repair | 93% letter accuracy |
| 4 | RAG + Two-Step Reasoning (EVALITA 2026) | Retrieval-augmented LLM + reranking | Current SOTA on clue answering |

**The critical insight from NAACL 2025**: Feeding partial grid letters back into the LLM prompt
during iterative repair takes per-clue accuracy from **43.5% → 89.6%**. The constraint loop
is not optional — it is the main source of accuracy gains.

**BCS ablation confirms this pattern**:
- BCS QA + BP + Local Search: 82% perfect puzzles
- BCS QA + BP only (no local search): 44% perfect puzzles

---

## Architecture Decision

We implement a **3-phase agent** that maps directly to BCS's three stages but uses an LLM
(via Nebius Token Factory) in place of the specialized bi-encoder.

```
PHASE 1: Unconstrained candidate generation
  For each clue → ask LLM for top-10 answers (clue + length only)
  Cost: 1 LLM call per clue (~20 calls for a 5x5 mini)

PHASE 2: Greedy fill with constraint filtering
  Sort clues by known letters descending (most constrained first = MRV heuristic)
  For each clue: pick first candidate that matches current grid pattern
  Fill word, update grid state

PHASE 3: Iterative constraint repair (the critical loop)
  Repeat until no changes or max_iterations:
    Find crossing inconsistencies (cell where word_A[i] != word_B[j])
    For each inconsistent clue: re-ask LLM with known pattern ("N_LE")
    If better candidate found: replace, update grid
```

Why this architecture:
- Grounded in NAACL 2025 paper, can cite it directly in the interview
- Clean separation of concerns: Phase 1 is cheap first-pass, Phase 3 is expensive repair
- Natural benchmarking story: compare Phase 1 only vs full 3-phase

---

## Repository Structure

```
crossword-agent/
├── PLAN.md
├── README.md
│
├── backend/                       ← Python, FastAPI
│   ├── requirements.txt
│   ├── .env.example               ← NEBIUS_API_KEY=your_key_here
│   ├── api.py                     ← FastAPI: /puzzles, /solve/{id} (SSE stream)
│   ├── benchmark.py               ← CLI: run eval across models, write CSV
│   └── src/
│       ├── puzzle.py              ← data structures + loader
│       ├── tools.py               ← pattern extraction, constraint checking
│       ├── agent.py               ← 3-phase solver, yields SolveStep events
│       ├── llm.py                 ← Nebius Token Factory client + prompts
│       └── eval.py                ← letter acc, word acc, perfect puzzle rate
│
├── frontend/                      ← React + TypeScript + Vite
│   ├── package.json
│   └── src/
│       ├── App.tsx
│       ├── components/
│       │   ├── CrosswordGrid.tsx  ← animated grid, cell color states
│       │   ├── AgentLog.tsx       ← step-by-step decision log
│       │   ├── PuzzlePicker.tsx   ← dropdown: select puzzle + model
│       │   └── BenchmarkTable.tsx ← results table
│       └── hooks/
│           └── useSolveStream.ts  ← EventSource SSE consumer
│
└── data/
    └── puzzles/                   ← 20-30 NYT mini JSON files
```

### How the demo works end-to-end

```
User clicks "Solve" in React UI
  → POST /solve/{puzzle_id}?model=llama-70b
  → FastAPI starts agent, streams SolveStep events via SSE
  → React EventSource receives each step
  → CrosswordGrid re-renders: cells animate white → yellow → green
  → AgentLog appends decision: clue, candidates, pattern, chosen word
  → Phase 3 repair: cells flash red on inconsistency, green on fix
```

---

## Implementation Tasks

### Step 1 — Data structures + puzzle loader (`src/puzzle.py`)
**Goal**: Load a puzzle JSON, expose a clean interface. No LLM involved.

```python
@dataclass
class Clue:
    id: str              # "1A", "3D"
    text: str            # "River in Egypt"
    start: tuple[int, int]
    direction: str       # "A" or "D"
    length: int

@dataclass
class CrosswordPuzzle:
    grid: list[list[str]]   # '' = empty, '#' = black, 'A'-'Z' = filled
    clues: list[Clue]
    solution: dict[str, str]  # clue_id -> correct word, for eval only
```

Test: load one puzzle, print clues, print empty grid. Zero LLM calls.

---

### Step 2 — Grid tools (`src/tools.py`)
**Goal**: Pure Python, no LLM. These are the constraint-checking primitives.

```python
def get_pattern(grid, clue) -> str:
    # Returns e.g. "N_LE" — known letters from crossing words
    
def check_word(word, clue, grid) -> bool:
    # Does this word fit without conflicting any filled cell?

def fill_word(word, clue, grid) -> None:
    # Mutate grid in place

def unfill_word(clue, grid) -> None:
    # Undo a fill (for backtracking)

def find_inconsistencies(grid, clues) -> list[Clue]:
    # Return clues where crossing words disagree on a shared cell
```

Test: fill a word, check a conflict, find an inconsistency. Zero LLM calls.

---

### Step 3 — LLM client + prompts (`src/llm.py`)
**Goal**: Nebius Token Factory integration. One function per prompt type.

```python
client = OpenAI(
    api_key=os.getenv("NEBIUS_API_KEY"),
    base_url="https://api.studio.nebius.com/v1/"
)

def get_candidates_unconstrained(clue_text, length, model, n=10) -> list[str]:
    # Phase 1 prompt: clue + length only

def get_candidates_constrained(clue_text, length, pattern, model, n=5) -> list[str]:
    # Phase 3 prompt: clue + length + known letters e.g. "N_LE"
```

Two separate prompts — the constrained one explicitly includes the pattern and
instructs the model to respect each fixed letter position.

Test: call both functions for one clue, inspect output. First real Token Factory call.

---

### Step 4 — Agent loop (`src/agent.py`)
**Goal**: Wire the 3 phases together.

```python
def solve(puzzle: CrosswordPuzzle, model: str, max_repair_iterations=10) -> SolveResult:
    grid = copy.deepcopy(puzzle.empty_grid)

    # Phase 1: generate candidates for all clues
    candidates = {c.id: get_candidates_unconstrained(c.text, c.length, model)
                  for c in puzzle.clues}

    # Phase 2: greedy fill, most constrained first
    for clue in sorted_by_constraints(puzzle.clues, grid):
        valid = [w for w in candidates[clue.id] if check_word(w, clue, grid)]
        if valid:
            fill_word(valid[0], clue, grid)

    # Phase 3: iterative repair
    for _ in range(max_repair_iterations):
        bad_clues = find_inconsistencies(grid, puzzle.clues)
        if not bad_clues:
            break
        for clue in bad_clues:
            pattern = get_pattern(grid, clue)
            new_candidates = get_candidates_constrained(
                clue.text, clue.length, pattern, model
            )
            valid = [w for w in new_candidates if check_word(w, clue, grid)]
            if valid and valid[0] != current_fill(grid, clue):
                unfill_word(clue, grid)
                fill_word(valid[0], clue, grid)

    return SolveResult(grid=grid, clues_solved=count_solved(grid, puzzle))
```

---

### Step 5 — Evaluation (`src/eval.py`)
**Goal**: Match academic metrics so results are directly comparable to published work.

```python
def evaluate(result: SolveResult, puzzle: CrosswordPuzzle) -> EvalMetrics:
    letter_acc = correct_letters / total_fillable_letters
    word_acc   = correct_words / total_words
    perfect    = (word_acc == 1.0)
    return EvalMetrics(letter_acc, word_acc, perfect)
```

---

### Step 6 — Demo script (`demo.py`)
**Goal**: Single entry point for the 1-minute video. Loads one puzzle, runs agent,
prints grid state after each phase so you can narrate the progression.

```
$ python demo.py --puzzle data/puzzles/mini_001.json --model meta-llama/Meta-Llama-3.1-70B-Instruct

[Phase 1] Generating candidates...
  1A "Morning moisture"  → DEW, FOG, ICE, WET, ...
  2D "Not fake"          → REAL, TRUE, GENUINE, ...

[Phase 2] Greedy fill (most constrained first)...
  Filling 3A "Modify" (pattern A_E_D) → AMEND ✓
  Filling 1A "Morning moisture" → DEW ✓
  ...

[Phase 3] Repair loop...
  Inconsistency at (2,3): AMEND says E, LINER says I
  Re-asking with pattern _I_E_ → MINED ✓
  Iteration 1: 2 fixes applied
  Iteration 2: 0 fixes, converged.

Final grid:
  D E W I T
  A M E N D
  ...

Letter accuracy: 94.3%  |  Word accuracy: 80.0%  |  Perfect: No
```

---

### Step 7 — Benchmark (`benchmark.py`)
**Goal**: Run eval across 3 models on 20 puzzles, produce a CSV and summary table.

Models to compare:
- `meta-llama/Meta-Llama-3.1-70B-Instruct`
- `Qwen/Qwen2.5-72B-Instruct`
- `deepseek-ai/DeepSeek-V3`

Strategy ablations to compare:
- Phase 1 only (no constraint repair)
- Phase 1 + 2 (greedy fill, no repair)
- Phase 1 + 2 + 3 (full pipeline)

Output: `results/benchmark.csv` with columns:
`model, strategy, puzzle_id, letter_acc, word_acc, perfect, tokens_used, cost_usd`

---

## Build Order + Timeline

```
Saturday PM   backend/src/puzzle.py  — data structures + loader
              download 20 puzzles from doshea/nyt_crosswords
              backend/src/tools.py   — pure Python, testable immediately

Sunday AM     backend/src/llm.py     — first Nebius Token Factory call
              backend/src/agent.py   — 3-phase solver with yield/generator
              backend/api.py         — FastAPI + SSE endpoint

Sunday PM     frontend scaffold (Vite + React + TypeScript)
              CrosswordGrid.tsx      — static grid, cell states
              useSolveStream.ts      — SSE consumer hook
              wire grid + stream together, one puzzle end-to-end in browser

Monday        AgentLog.tsx           — decision log panel
              BenchmarkTable.tsx     — results display
              backend/eval.py + benchmark.py
              run 20 puzzles × 3 models, capture CSV

Tuesday       README.md, polish UI colors/animations
              record 1-min video in the React app
              push to GitHub
```

---

## Key Design Decisions to Explain in the Interview

| Decision | Reasoning |
|---|---|
| 3-phase architecture | Maps to BCS stages; Phase 3 (constraint repair) is critical per NAACL 2025 ablation |
| Most-constrained-first ordering | MRV heuristic from CSP literature; maximizes fill quality per call |
| Separate prompt for Phase 3 | Pattern string ("N_LE") in prompt is the mechanism that drives 43% → 89% accuracy |
| Two LLM call types, not one | Phase 1 is recall-focused (10 candidates), Phase 3 is precision-focused (5 candidates with constraints) |
| Nebius Token Factory as backend | OpenAI-compatible API, dedicated endpoints, multiple open models for benchmark |
| Mini crosswords (5x5) for benchmark | Fast iteration, $100 credit covers 20+ puzzles per model |

---

## Evaluation Proposed Methodology

### Metrics (matching academic standard from BCS paper)
1. **Letter accuracy**: % of grid squares correctly filled
2. **Word accuracy**: % of clues with exactly correct answer
3. **Perfect puzzle rate**: % of puzzles where all words are correct

### Test set
- 20 NYT mini crosswords (5x5) from `doshea/nyt_crosswords` GitHub archive
- Mix of Monday (easy) and Friday (hard) puzzles to show difficulty sensitivity

### Baselines
1. **Random**: fill each word with a random valid-length dictionary word
2. **Phase 1 only**: take highest-confidence LLM candidate, no constraint repair
3. **Phase 1+2**: greedy fill, no iterative repair
4. **Full pipeline**: all 3 phases (expected best)

### Statistical reporting
- Mean ± std across 20 puzzles per condition
- Cost per puzzle in USD (tokens × price per token on Token Factory)

---

## What the 1-Minute Video Should Show

```
0:00-0:10  React app open in browser, blank 5x5 grid visible.
           Select puzzle + model from dropdown, click "Solve".
0:10-0:30  Grid animates: Phase 1 fills candidates in the log panel.
           Phase 2: cells light up yellow then green as words are placed.
0:30-0:50  Phase 3: two cells flash red (inconsistency detected),
           agent log shows re-ask with pattern, cells turn green on fix.
           Final grid complete. Letter accuracy shown: e.g. 94%.
0:50-1:00  Switch to benchmark tab: table of 3 models, letter acc, cost/puzzle.
           "Main failure mode: wordplay clues. Natural extension: Tavily
            agentic search for real-time knowledge lookup."
```
