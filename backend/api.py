from __future__ import annotations
import dataclasses
import json
import os
import queue as _queue
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

_backend_dir = Path(__file__).parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv

load_dotenv(_backend_dir / ".env")

from src.puzzle import load_puzzle, CrosswordPuzzle
from src.agent import solve, SolveStep
from src.llm import MODELS
from src.tools import fill_word, get_pattern

app = FastAPI(title="Crossword Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

PUZZLES_DIR = _backend_dir.parent / "data" / "puzzles"
RESULTS_FILE = _backend_dir.parent / "data" / "benchmark_results.json"
_results_lock = threading.Lock()

# Models available for the benchmark (competitive set)
BENCHMARK_MODELS: dict[str, str] = {
    "kimi-k3":            "moonshotai/Kimi-K3",
    "glm-5-3":            "zai-org/GLM-5.3",
    "minimax-m3":         "MiniMaxAI/MiniMax-M3",
    "hermes-4-405b":      "NousResearch/Hermes-4-405B",
    "deepseek-v4.1-flash": "deepseek-ai/DeepSeek-V4.1-Flash",
    "nemotron-ultra-550b": "nvidia/Nemotron-3-Ultra-550b-a55b",
    "gpt-oss-120b":       "openai/gpt-oss-120b",
    "gpt-oss-120b-dedicated": "dedicated/openai/gpt-oss-120b-asJtKh",
}

MODEL_LABELS: dict[str, str] = {
    "kimi-k3":            "Kimi K3",
    "glm-5-3":            "GLM 5.3",
    "minimax-m3":         "MiniMax M3",
    "hermes-4-405b":      "Hermes 4 405B",
    "deepseek-v4.1-flash": "DS V4.1 Flash",
    "nemotron-ultra-550b": "Nemotron Ultra 550B",
    "gpt-oss-120b":       "GPT-OSS 120B",
    "gpt-oss-120b-dedicated": "GPT-OSS 120B (Ded.)",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _solution_grid(puzzle: CrosswordPuzzle) -> list[list[str]]:
    grid = puzzle.empty_grid()
    for clue in puzzle.clues:
        word = puzzle.solution.get(clue.id, "")
        if word:
            fill_word(word, clue, grid)
    return grid


def _compute_accuracy(solved_grid: list[list[str]], puzzle: CrosswordPuzzle, steps: list[SolveStep]) -> dict:
    """
    Returns all benchmark metrics for one (model, puzzle) run:
      - words_correct, total_words
      - clues_blank  (agent gave up, nothing placed)
      - clues_wrong  (something placed but incorrect)
      - correct_letters, total_letters
      - naive_correct (rank-1 Phase 1 candidate matched solution)
    """
    sol_grid = _solution_grid(puzzle)

    # ── Word-level outcomes ───────────────────────────────────────────────────
    words_correct = 0
    clues_blank = 0
    for c in puzzle.clues:
        pat = get_pattern(solved_grid, c)
        sol = puzzle.solution.get(c.id, "")
        if pat == sol:
            words_correct += 1
        elif set(pat) <= {"_", ""}:
            clues_blank += 1
    clues_wrong = len(puzzle.clues) - words_correct - clues_blank

    # ── Letter-level accuracy (unique cells only) ─────────────────────────────
    correct_letters = total_letters = 0
    for r in range(puzzle.rows):
        for c in range(puzzle.cols):
            expected = sol_grid[r][c]
            if expected and expected != "#":
                total_letters += 1
                if solved_grid[r][c] == expected:
                    correct_letters += 1

    # ── Naive accuracy: did rank-1 Phase 1 candidate match the solution? ──────
    phase1: dict[str, SolveStep] = {
        s.clue_id: s for s in steps if s.action == "candidates"
    }
    naive_correct = sum(
        1 for c in puzzle.clues
        if (step := phase1.get(c.id)) and step.candidates
        and step.candidates[0] == puzzle.solution.get(c.id, "")
    )

    return dict(
        words_correct=words_correct,
        total_words=len(puzzle.clues),
        clues_blank=clues_blank,
        clues_wrong=clues_wrong,
        correct_letters=correct_letters,
        total_letters=total_letters,
        naive_correct=naive_correct,
    )


# ── Results file persistence ──────────────────────────────────────────────────

def _load_results() -> dict:
    if RESULTS_FILE.exists():
        try:
            return json.loads(RESULTS_FILE.read_text())
        except Exception:
            pass
    return {"runs": []}


def _save_cell(run_id: str, model: str, puzzle_id: str, cell: dict) -> None:
    """Thread-safe write of a single (model, puzzle) result into the JSON file."""
    with _results_lock:
        data = _load_results()
        run = next((r for r in data["runs"] if r["id"] == run_id), None)
        if run is None:
            return
        run["results"].setdefault(model, {})[puzzle_id] = cell
        RESULTS_FILE.write_text(json.dumps(data, indent=2))


def _init_run(run_id: str, model_keys: list[str], oracle: bool, web_search: bool) -> None:
    with _results_lock:
        data = _load_results()
        data["runs"].append({
            "id": run_id,
            "oracle": oracle,
            "web_search": web_search,
            "models": model_keys,
            "results": {},
        })
        RESULTS_FILE.write_text(json.dumps(data, indent=2))


# ── Puzzle / solver endpoints ─────────────────────────────────────────────────

@app.get("/puzzles")
def list_puzzles():
    result = []
    for p in sorted(PUZZLES_DIR.glob("*.json")):
        try:
            puzzle = load_puzzle(str(p))
            result.append({
                "id": p.stem,
                "title": puzzle.title,
                "size": f"{puzzle.rows}x{puzzle.cols}",
                "clues": len(puzzle.clues),
            })
        except Exception:
            pass
    return result


@app.get("/puzzles/{puzzle_id}")
def get_puzzle(puzzle_id: str):
    path = PUZZLES_DIR / f"{puzzle_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Puzzle not found")
    puzzle = load_puzzle(str(path))
    return {
        "id": puzzle_id,
        "title": puzzle.title,
        "rows": puzzle.rows,
        "cols": puzzle.cols,
        "grid": puzzle.grid,
        "clues": [dataclasses.asdict(c) for c in puzzle.clues],
    }


@app.get("/solve/{puzzle_id}")
def solve_stream(
    puzzle_id: str,
    model: str = "kimi-k3",
    max_repair_iterations: int = 10,
    web_search: bool = False,
    oracle: bool = False,
):
    path = PUZZLES_DIR / f"{puzzle_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Puzzle not found")

    model_id = MODELS.get(model) or BENCHMARK_MODELS.get(model, model)

    def event_generator():
        puzzle = load_puzzle(str(path))
        for step in solve(puzzle, model=model_id,
                          max_repair_iterations=max_repair_iterations,
                          use_web_search=web_search,
                          oracle=oracle):
            data = json.dumps(dataclasses.asdict(step))
            yield f"data: {data}\n\n"
        yield "data: {\"action\": \"stream_end\"}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/models")
def list_models():
    return [{"id": k, "name": v} for k, v in MODELS.items()]


# ── Benchmark endpoints ───────────────────────────────────────────────────────

@app.get("/benchmark/models")
def benchmark_model_list():
    return [{"id": k, "name": v, "label": MODEL_LABELS.get(k, k)} for k, v in BENCHMARK_MODELS.items()]


@app.get("/benchmark/results")
def get_benchmark_results():
    """Return all saved benchmark runs."""
    return _load_results()


@app.get("/benchmark")
def benchmark_stream(
    models: str = "",
    oracle: bool = False,
    web_search: bool = False,
):
    """
    Run all puzzles through selected models in parallel and stream SSE events.

    Events:
      {"type":"start",  "model":"kimi-k3", "puzzle":"2017-01-04"}
      {"type":"result", "model":"kimi-k3", "puzzle":"2017-01-04",
       "words_correct":51, "total_words":74, "word_pct":68.9,
       "clues_blank":8, "clues_wrong":15,
       "correct_letters":312, "total_letters":411, "letter_pct":75.9,
       "naive_correct":28, "naive_word_pct":37.8, "elapsed_s":43.2}
      {"type":"error",  "model":"...", "puzzle":"...", "error":"..."}
      {"type":"done",   "run_id":"..."}
    """
    model_keys = [m.strip() for m in models.split(",") if m.strip()] if models else list(BENCHMARK_MODELS.keys())
    model_keys = [k for k in model_keys if k in BENCHMARK_MODELS]
    if not model_keys:
        raise HTTPException(status_code=400, detail="No valid model keys provided")

    puzzle_paths = sorted(PUZZLES_DIR.glob("*.json"))
    if not puzzle_paths:
        raise HTTPException(status_code=404, detail="No puzzles found")

    run_id = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    _init_run(run_id, model_keys, oracle, web_search)

    def event_generator():
        q: _queue.Queue = _queue.Queue()
        total_jobs = len(model_keys) * len(puzzle_paths)

        def _run(model_key: str, puzzle_path: Path):
            model_id = BENCHMARK_MODELS[model_key]
            puzzle_id = puzzle_path.stem
            t0 = time.time()
            try:
                q.put({"type": "start", "model": model_key, "puzzle": puzzle_id})
                puzzle = load_puzzle(str(puzzle_path))
                gen = solve(puzzle, model=model_id, use_web_search=web_search, oracle=oracle)
                result = None
                try:
                    while True:
                        next(gen)
                except StopIteration as exc:
                    result = exc.value

                elapsed = round(time.time() - t0, 1)
                if result is None:
                    err = {"type": "error", "model": model_key, "puzzle": puzzle_id,
                           "error": "Solver returned no result", "elapsed_s": elapsed}
                    q.put(err)
                    return

                metrics = _compute_accuracy(result.grid, puzzle, result.steps)
                word_pct   = round(metrics["words_correct"] / metrics["total_words"] * 100, 1) if metrics["total_words"] else 0.0
                letter_pct = round(metrics["correct_letters"] / metrics["total_letters"] * 100, 1) if metrics["total_letters"] else 0.0
                naive_pct  = round(metrics["naive_correct"] / metrics["total_words"] * 100, 1) if metrics["total_words"] else 0.0

                cell = {
                    **metrics,
                    "word_pct": word_pct,
                    "letter_pct": letter_pct,
                    "naive_word_pct": naive_pct,
                    "elapsed_s": elapsed,
                }
                _save_cell(run_id, model_key, puzzle_id, cell)
                q.put({"type": "result", "model": model_key, "puzzle": puzzle_id, "run_id": run_id, **cell})
            except Exception as exc:
                err = {"type": "error", "model": model_key, "puzzle": puzzle_id,
                       "error": str(exc), "elapsed_s": round(time.time() - t0, 1)}
                q.put(err)

        threads = [
            threading.Thread(target=_run, args=(mk, pp), daemon=True)
            for mk in model_keys
            for pp in puzzle_paths
        ]
        for t in threads:
            t.start()

        received = 0
        while received < total_jobs:
            event = q.get()
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("type") in ("result", "error"):
                received += 1

        yield f'data: {json.dumps({"type": "done", "run_id": run_id})}\n\n'

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
