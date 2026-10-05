# NYT Crossword Agent

An AI agent that solves authentic New York Times crossword puzzles using a 3-phase constraint-propagation architecture backed by [Nebius Token Factory](https://studio.nebius.com/) inference.

Best result: **94.2% avg word accuracy** across 19 NYT puzzles using `moonshotai/Kimi-K3` with auto-check mode.

[Demo Video](https://www.loom.com/share/b3dc206ae1124b3996044c91ad2d0f42)

---

## Benchmark Results (Auto-Check Mode)

Evaluated 6 models across 19 NYT crossword puzzles (all with oracle/auto-check enabled):

| Rank | Model | Avg Word % | Avg Naive % | Avg Letter % | Blank % | Avg Time |
|------|-------|-----------|-------------|--------------|---------|----------|
| 1 | **Kimi K3** | **94.2%** | 36.8% | 97.0% | 0.7% | 195.8s |
| 2 | DS V4.1 Flash | 93.9% | 8.0% | 97.0% | 0.4% | 370.2s |
| 3 | GLM 5.3 | 92.2% | 32.1% | 96.4% | 0.8% | 186.5s |
| 4 | MiniMax M3 | 79.7% | 52.4% | 91.7% | 2.2% | 189.9s |
| 5 | Hermes 4 405B | 74.9% | 59.8% | 88.7% | 3.0% | 185.2s |
| 6 | Nemotron Ultra 550B | 73.4% | 2.1% | 88.3% | 1.8% | 275.5s |

**Agent % vs Naive %**: "Naive" is the Phase 1 ablation baseline — accuracy if only the rank-1 LLM candidate were placed without constraint propagation or repair. The gap shows how much the MRV + repair pipeline improves over raw LLM output.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          NYT Crossword Puzzle                           │
│                    (doshea/nyt_crosswords dataset)                      │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PHASE 1 — Concurrent Candidate Generation                              │
│                                                                         │
│  ThreadPoolExecutor (20 workers)                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       ┌──────────┐          │
│  │  Clue 1  │  │  Clue 2  │  │  Clue 3  │  ...  │  Clue N  │          │
│  │ LLM call │  │ LLM call │  │ LLM call │       │ LLM call │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘       └────┬─────┘          │
│       └─────────────┴─────────────┴────────────────────┘               │
│                             │                                           │
│  Each call returns top-20 candidates ordered by decreasing confidence  │
│  temp=0.0, NYT date injected into prompt, pattern="____"               │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │  candidates dict  {clue_id: [w1, w2, ...]}
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PHASE 2 — Greedy Fill with Dynamic MRV                                 │
│                                                                         │
│  while unfilled clues remain:                                           │
│    1. Re-sort remaining clues by #known crossing letters (desc)  ◄──┐  │
│    2. Pick most-constrained clue                                     │  │
│    3. Try candidates in confidence order                             │  │
│    4. Place first candidate that satisfies crossing constraints      │  │
│    5. (oracle mode) verify against solution; reject & retry if wrong │  │
│    6. Update grid  ──────────────────────────────────────────────────┘  │
│                                                                         │
│  Result: partially filled grid with some skipped clues                 │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PHASE 3a — Iterative Conflict Repair  (up to 10 iterations)           │
│                                                                         │
│  for each iteration:                                                    │
│    find_inconsistencies(grid) → list of clues with crossing conflicts  │
│    if none → CONVERGED ✓                                               │
│                                                                         │
│    for each conflicted clue:                                            │
│      emit CONFLICT event                                                │
│      re-ask LLM with constrained pattern  e.g. "S_A_E"                │
│      ├── found better word → unfill old, fill new → emit REPAIR        │
│      ├── web search fallback (Tavily) if LLM returns nothing           │
│      └── no candidate found → restore original → emit SKIP             │
│                                                                         │
│  PHASE 3b — Gap Fill (blank clues with ≥1 known crossing letter)       │
│                                                                         │
│    for each partial clue (sorted by most constraints first):           │
│      re-ask LLM with pattern  e.g. "A__O_"                            │
│      ├── web search fallback if LLM empty                              │
│      └── place if check_word passes → emit REPAIR                      │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  DONE — emit score: N/M clues correct                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Oracle / Auto-Check Mode

Simulates the NYT interactive "Check" feature. After every `fill_word` call, the agent verifies the placed word against the puzzle solution. If wrong, it immediately un-fills the cell, adds the word to a per-clue `rejected` set, and tries the next candidate. Rejected words are never retried in any phase.

```
fill_word(word, clue, grid)
    │
    └── oracle=True?
          ├── correct  → keep, return True
          └── wrong    → unfill, rejected[clue.id].add(word), return False
                              ↓
                         try next candidate
```

### Web Search Fallback (Tavily)

When the constrained LLM call returns no valid candidates, the agent optionally queries Tavily against crossword-specific sites (`xwordinfo.com`, `wordplays.com`), passing the clue text, answer length, and known letter positions. Results are filtered against the crossing pattern before placement.

---

## Stack

| Layer | Technology |
|---|---|
| LLM Inference | [Nebius Token Factory](https://studio.nebius.com/) (`moonshotai/Kimi-K3`, `deepseek-ai/DeepSeek-V4.1-Flash`, `NousResearch/Hermes-4-405B`, etc.) |
| Backend | Python · FastAPI · SSE streaming |
| Frontend | React 19 · TypeScript · Vite · Tailwind CSS v4 |
| Puzzle Data | [`doshea/nyt_crosswords`](https://github.com/doshea/nyt_crosswords) dataset |
| Web Search | [Tavily](https://tavily.com/) (optional) |

---

## Models Evaluated

All models served via [Nebius Token Factory](https://studio.nebius.com/):

| Model | Model ID | Parameters | Best Puzzle Word % |
|-------|----------|-----------|-------------------|
| **Kimi K3** | `moonshotai/Kimi-K3` | — | 100% (2017-03-13) |
| **DeepSeek V4.1 Flash** | `deepseek-ai/DeepSeek-V4.1-Flash` | — | 100% (2017-03-13) |
| **GLM 5.3** | `zai-org/GLM-5.3` | — | 97.4% (2017-03-13) |
| **MiniMax M3** | `MiniMaxAI/MiniMax-M3` | 128B | 97.4% (2017-03-13) |
| **Hermes 4 405B** | `NousResearch/Hermes-4-405B` | 405B | 90.8% (2017-02-13) |
| **Nemotron Ultra 550B** | `nvidia/Nemotron-3-Ultra-550b-a55b` | 550B | 93.6% (2017-03-13) |

### Key Observations

- **Kimi K3** and **DS V4.1 Flash** both achieve ~94% avg word accuracy with auto-check, but Kimi is 2× faster (196s vs 370s per puzzle).
- The **agent pipeline adds massive value** for models with weak naive baselines: DS V4.1 Flash jumps from 8% naive → 94% agent (+86pp), Nemotron Ultra from 2% → 73% (+71pp).
- Models with strong naive scores (Hermes 59.8%, MiniMax 52.4%) still benefit from constraint repair but see smaller lifts.
- All 6 models crash on one puzzle (`2017-04-05`) due to a non-standard 15×16 grid — remaining 19/20 puzzles are standard 15×15.

---

## Results

Full benchmark results are persisted in `data/benchmark_results.json` and viewable through the interactive Benchmark tab in the frontend (charts, heatmap, box plots).

---

## Setup

### Prerequisites

- Python 3.11+
- Node.js 20+
- A [Nebius](https://studio.nebius.com/) API key
- (Optional) A [Tavily](https://tavily.com/) API key for web search

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# edit .env → set NEBIUS_API_KEY and optionally TAVILY_API_KEY

uvicorn api:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev   # starts on http://localhost:5173
```

### Puzzle Data

Puzzles are pre-downloaded into `data/puzzles/`. To fetch more:

```bash
cd backend
python download_puzzles.py
```

---

## Project Structure

```
crossword_agent/
├── backend/
│   ├── api.py                  # FastAPI app, SSE /solve + /benchmark endpoints
│   ├── requirements.txt
│   └── src/
│       ├── agent.py            # 3-phase solver, oracle mode
│       ├── llm.py              # Nebius inference, candidate generation
│       ├── puzzle.py           # Puzzle / Clue data models
│       ├── tools.py            # Grid operations, MRV sort, conflict detection
│       └── web_search.py       # Tavily fallback search
├── data/
│   ├── puzzles/                # NYT puzzle JSONs (doshea dataset)
│   └── benchmark_results.json  # Persisted benchmark run snapshots
├── frontend/
│   └── src/
│       ├── App.tsx             # Tab nav: Solver | Benchmark
│       ├── components/
│       │   ├── CrosswordGrid.tsx
│       │   ├── ClueList.tsx
│       │   ├── AgentLog.tsx    # Live SSE event cards
│       │   ├── PuzzlePicker.tsx
│       │   └── Benchmark.tsx   # Model comparison charts, heatmap, box plots
│       ├── hooks/
│       │   ├── useSolveStream.ts
│       │   └── useBenchmark.ts # SSE benchmark runner, history loader
│       └── types.ts
└── README.md
```
