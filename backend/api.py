from __future__ import annotations
import dataclasses
import json
import os
import sys
from pathlib import Path

# Ensure `src` package resolves whether uvicorn is launched from the repo root
# (python -m uvicorn backend.api:app) or from inside backend/ (uvicorn api:app)
_backend_dir = Path(__file__).parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv

load_dotenv(_backend_dir / ".env")

from src.puzzle import load_puzzle, CrosswordPuzzle
from src.agent import solve
from src.llm import MODELS

app = FastAPI(title="Crossword Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

PUZZLES_DIR = _backend_dir.parent / "data" / "puzzles"


def _load_all_puzzles() -> dict[str, CrosswordPuzzle]:
    puzzles = {}
    for p in sorted(PUZZLES_DIR.glob("*.json")):
        try:
            puzzles[p.stem] = load_puzzle(str(p))
        except Exception:
            pass
    return puzzles


@app.get("/puzzles")
def list_puzzles():
    """Return a list of available puzzle IDs and titles."""
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
    """Return puzzle metadata and empty grid (no solution)."""
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
    model: str = "qwen3-30b",
    max_repair_iterations: int = 10,
    web_search: bool = False,
    oracle: bool = False,
):
    """
    Stream solver steps as Server-Sent Events.
    Each event is a JSON-serialised SolveStep.

    Frontend connects with:
        const es = new EventSource(`/solve/${puzzleId}?model=${model}`)
        es.onmessage = (e) => { const step = JSON.parse(e.data); ... }
    """
    path = PUZZLES_DIR / f"{puzzle_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Puzzle not found")

    model_id = MODELS.get(model, model)

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
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/models")
def list_models():
    return [{"id": k, "name": v} for k, v in MODELS.items()]
