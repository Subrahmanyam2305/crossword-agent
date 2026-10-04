# NYT Crossword Agent

An AI agent that solves authentic New York Times crossword puzzles using a 3-phase constraint-propagation architecture backed by [Nebius Token Factory](https://studio.nebius.com/) inference.

Best result: **51/74 words (68.9% word accuracy, 75.9% letter accuracy)** on the 2017-01-04 NYT puzzle using `moonshotai/Kimi-K3` with oracle/auto-check mode.

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
| LLM Inference | [Nebius Token Factory](https://studio.nebius.com/) (`moonshotai/Kimi-K3`, `deepseek-ai/DeepSeek-V4-Pro-0813`, etc.) |
| Backend | Python · FastAPI · SSE streaming |
| Frontend | React 19 · TypeScript · Vite · Tailwind CSS v4 |
| Puzzle Data | [`doshea/nyt_crosswords`](https://github.com/doshea/nyt_crosswords) dataset |
| Web Search | [Tavily](https://tavily.com/) (optional) |

---

## Models Evaluated

| Model | Phase 1 Top-20 Recall | Notes |
|---|---|---|
| `moonshotai/Kimi-K3` | 18/20 | Best overall — 68.9% word accuracy |
| `deepseek-ai/DeepSeek-V4-Pro-0813` | 19/20 | Highest candidate recall |
| `google/gemma-3-27b-it` | — | Baseline |
| `Qwen/Qwen3-235B-A22B-Instruct-2507` | — | Large MoE |
| `zai-org/GLM-5.3` | 7/20 rank-1 | Weak rank-1 accuracy |

---

## Results

| Puzzle | Model | Word Accuracy | Letter Accuracy | Mode |
|---|---|---|---|---|
| 2017-01-04 | `Kimi-K3` | 51/74 (68.9%) | 75.9% | Oracle |
| 2017-01-04 | `Kimi-K3` | 18/74 (24.3%) | 35.8% | Standard |
| 2017-01-04 | `gemma-3-27b-it` | 12/74 (16%) | — | Standard |

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
│   ├── api.py                  # FastAPI app, SSE /solve endpoint
│   ├── requirements.txt
│   └── src/
│       ├── agent.py            # 3-phase solver, oracle mode
│       ├── llm.py              # Nebius inference, candidate generation
│       ├── puzzle.py           # Puzzle / Clue data models
│       ├── tools.py            # Grid operations, MRV sort, conflict detection
│       └── web_search.py       # Tavily fallback search
├── data/
│   └── puzzles/                # NYT puzzle JSONs (doshea dataset)
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── components/
│       │   ├── CrosswordGrid.tsx
│       │   ├── ClueList.tsx
│       │   ├── AgentLog.tsx    # Live SSE event cards
│       │   └── PuzzlePicker.tsx
│       ├── hooks/
│       │   └── useSolveStream.ts
│       └── types.ts
└── README.md
```
