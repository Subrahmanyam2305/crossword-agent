from __future__ import annotations
import copy
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Generator

from .puzzle import Clue, CrosswordPuzzle
from .tools import (
    check_word, fill_word, unfill_word, get_pattern,
    find_inconsistencies, is_solved, sort_by_constraints,
    current_fill,
)
from .llm import get_candidates_unconstrained, get_candidates_constrained
from .web_search import search_crossword_answer

# Max concurrent LLM calls for Phase 1.  Nebius rate limits are generous;
# 20 threads keeps latency low without hammering the endpoint.
_PHASE1_WORKERS = 20


@dataclass
class SolveStep:
    """Single agent decision event, streamed to the frontend."""
    phase: int                       # 1, 2, or 3
    clue_id: str
    clue_text: str
    length: int
    pattern: str                     # known letters, e.g. "N_LE"
    candidates: list[str]            # candidates considered
    chosen: str | None               # word actually placed (None = skipped)
    action: str                      # "candidates","fill","skip","repair","conflict","converged","done"
    grid_snapshot: list[list[str]]   # full grid state after this step
    iteration: int = 0               # Phase 3 repair iteration number
    note: str = ""


@dataclass
class SolveResult:
    grid: list[list[str]]
    steps: list[SolveStep]
    clues_solved: int
    total_clues: int

    @property
    def complete(self) -> bool:
        return self.clues_solved == self.total_clues


def solve(
    puzzle: CrosswordPuzzle,
    model: str,
    max_repair_iterations: int = 10,
    use_web_search: bool = False,
    oracle: bool = False,
) -> Generator[SolveStep, None, SolveResult]:
    """
    3-phase crossword solver.

    Yields SolveStep events so callers (API, UI, tests) can observe
    every decision in real time.

    Phase 1: Unconstrained candidate generation — ALL clues called concurrently
             via a thread pool, then streamed in original clue order.
    Phase 2: Greedy fill, most-constrained-first (MRV heuristic).
    Phase 3: Iterative constraint repair — re-ask LLM with known letter pattern.

    oracle=True: after every fill, verify against the solution.  Wrong words are
    immediately unfilled, added to a per-clue rejected set, and the next candidate
    is tried.  Rejected words are never retried in any later phase.
    Architecture mirrors NAACL 2025 "Language Models are Crossword Solvers":
    the constraint-aware re-asking in Phase 3 drives accuracy from ~43% → ~89%.
    """
    grid = puzzle.empty_grid()
    steps: list[SolveStep] = []
    # Extract date from puzzle title for LLM context (e.g. "NY TIMES, WED, JAN 04, 2017")
    puzzle_date = puzzle.title
    # Per-clue set of words already known to be wrong (oracle mode)
    rejected: dict[str, set[str]] = {c.id: set() for c in puzzle.clues}

    def _is_correct(word: str, clue: Clue) -> bool:
        """Oracle check: True iff word matches the puzzle solution."""
        return puzzle.solution.get(clue.id, "") == word.upper()

    def _try_fill(word: str, clue: Clue) -> bool:
        """
        Fill word into grid. In oracle mode, immediately unfill and reject
        if the word is wrong. Returns True if the word was kept.
        """
        fill_word(word, clue, grid)
        if oracle and not _is_correct(word, clue):
            unfill_word(clue, grid)
            rejected[clue.id].add(word)
            return False
        return True

    def snap() -> list[list[str]]:
        return copy.deepcopy(grid)

    def emit(step: SolveStep) -> SolveStep:
        steps.append(step)
        return step

    # ── Phase 1: Concurrent candidate generation ─────────────────────────────
    # Fire all LLM calls in parallel; this cuts Phase 1 from O(n * latency)
    # to O(latency) — ~15s instead of ~5min for a 74-clue puzzle.
    candidates: dict[str, list[str]] = {}

    def _fetch(clue: Clue) -> tuple[Clue, list[str], str | None]:
        """Return (clue, candidates, error_msg)."""
        try:
            raw = get_candidates_unconstrained(clue.text, clue.length, model, puzzle_date=puzzle_date)
            return clue, raw, None
        except Exception as exc:
            return clue, [], str(exc)

    with ThreadPoolExecutor(max_workers=_PHASE1_WORKERS) as pool:
        future_map = {pool.submit(_fetch, clue): clue for clue in puzzle.clues}
        # Collect all results keyed by clue.id so we can emit in original order
        results: dict[str, tuple[list[str], str | None]] = {}
        for future in as_completed(future_map):
            clue, raw, err = future.result()
            results[clue.id] = (raw, err)

    # Stream events in the original clue order (not completion order) so the
    # frontend log is deterministic and matches the grid layout.
    for clue in puzzle.clues:
        raw, err = results[clue.id]
        if err:
            step = emit(SolveStep(
                phase=1, clue_id=clue.id, clue_text=clue.text,
                length=clue.length, pattern="_" * clue.length,
                candidates=[], chosen=None, action="skip",
                grid_snapshot=snap(),
                note=f"LLM error: {err}",
            ))
            yield step
            # Hard stop on auth errors; soft-continue for transient errors
            if "401" in err or "403" in err or "does not exist" in err:
                return SolveResult(grid=grid, steps=steps,
                                   clues_solved=0, total_clues=len(puzzle.clues))
            continue

        candidates[clue.id] = raw
        step = emit(SolveStep(
            phase=1, clue_id=clue.id, clue_text=clue.text,
            length=clue.length, pattern="_" * clue.length,
            candidates=raw, chosen=None, action="candidates",
            grid_snapshot=snap(),
        ))
        yield step

    # ── Phase 2: Greedy fill, most-constrained-first ─────────────────────────
    # Re-sort on every step so each newly-placed word immediately propagates
    # its letters as constraints to crossing clues (true MRV).
    remaining_p2 = {c.id: c for c in puzzle.clues if c.id in candidates}
    while remaining_p2:
        # Pick the unfilled clue with the most known letters right now
        ordered = sort_by_constraints(
            [c for c in remaining_p2.values() if not is_solved(grid, c)],
            grid,
        )
        if not ordered:
            break
        clue = ordered[0]
        del remaining_p2[clue.id]

        pattern = get_pattern(grid, clue)
        # Exclude already-rejected words so we never retry them
        valid = [w for w in candidates[clue.id]
                 if check_word(w, clue, grid) and w not in rejected[clue.id]]

        chosen = None
        for word in valid:
            if _try_fill(word, clue):
                chosen = word
                break
            # oracle rejected it — note in step but keep trying next candidate

        if chosen:
            step = emit(SolveStep(
                phase=2, clue_id=clue.id, clue_text=clue.text,
                length=clue.length, pattern=pattern,
                candidates=candidates[clue.id], chosen=chosen,
                action="fill", grid_snapshot=snap(),
                note=f"Rejected {len(rejected[clue.id])} wrong candidates before placing." if rejected[clue.id] else "",
            ))
        else:
            step = emit(SolveStep(
                phase=2, clue_id=clue.id, clue_text=clue.text,
                length=clue.length, pattern=pattern,
                candidates=candidates[clue.id], chosen=None,
                action="skip", grid_snapshot=snap(),
                note="No valid candidate matches current grid constraints",
            ))
        yield step

    # ── Phase 3: Iterative constraint repair ─────────────────────────────────
    for iteration in range(1, max_repair_iterations + 1):
        bad_clues = find_inconsistencies(grid, puzzle.clues)

        if not bad_clues:
            yield emit(SolveStep(
                phase=3, clue_id="", clue_text="",
                length=0, pattern="",
                candidates=[], chosen=None, action="converged",
                grid_snapshot=snap(), iteration=iteration,
                note=f"No inconsistencies. Converged after {iteration - 1} repair iterations.",
            ))
            break

        changed = False
        for clue in bad_clues:
            pattern = get_pattern(grid, clue)

            yield emit(SolveStep(
                phase=3, clue_id=clue.id, clue_text=clue.text,
                length=clue.length, pattern=pattern,
                candidates=[], chosen=None, action="conflict",
                grid_snapshot=snap(), iteration=iteration,
                note=f"Conflict detected — re-asking with pattern '{pattern}'",
            ))

            try:
                new_candidates = get_candidates_constrained(
                    clue.text, clue.length, pattern, model, puzzle_date=puzzle_date
                )
            except Exception as exc:
                yield emit(SolveStep(
                    phase=3, clue_id=clue.id, clue_text=clue.text,
                    length=clue.length, pattern=pattern,
                    candidates=[], chosen=None, action="skip",
                    grid_snapshot=snap(), iteration=iteration,
                    note=f"LLM error: {exc}",
                ))
                continue

            current = current_fill(grid, clue)
            # Exclude already-rejected words in constrained candidates
            valid = [w for w in new_candidates
                     if check_word(w, clue, grid) and w not in rejected[clue.id]]

            # If LLM constrained call yielded nothing AND web search is enabled,
            # try Tavily for crossword-specific answer lookup
            if not valid and use_web_search:
                try:
                    web_candidates = search_crossword_answer(
                        clue.text, clue.length,
                        puzzle_date=puzzle_date,
                        pattern=pattern,
                    )
                    web_valid = [w for w in web_candidates
                                 if check_word(w, clue, grid) and w not in rejected[clue.id]]
                    if web_valid:
                        new_candidates = web_candidates
                        valid = web_valid
                        yield emit(SolveStep(
                            phase=3, clue_id=clue.id, clue_text=clue.text,
                            length=clue.length, pattern=pattern,
                            candidates=web_candidates, chosen=None, action="skip",
                            grid_snapshot=snap(), iteration=iteration,
                            note=f"🔍 Web search found candidates: {web_candidates[:3]}",
                        ))
                except Exception:
                    pass

            chosen = None
            for word in valid:
                if word == current:
                    continue   # already placed, no change
                unfill_word(clue, grid)
                if _try_fill(word, clue):
                    chosen = word
                    break
                # oracle rejected — keep trying next

            if chosen:
                changed = True
                yield emit(SolveStep(
                    phase=3, clue_id=clue.id, clue_text=clue.text,
                    length=clue.length, pattern=pattern,
                    candidates=new_candidates, chosen=chosen,
                    action="repair", grid_snapshot=snap(), iteration=iteration,
                    note=f"Repaired: '{current}' → '{chosen}'",
                ))
            else:
                # Restore original word if we unfilled and found nothing better
                if current and check_word(current, clue, grid) and current not in rejected[clue.id]:
                    fill_word(current, clue, grid)
                yield emit(SolveStep(
                    phase=3, clue_id=clue.id, clue_text=clue.text,
                    length=clue.length, pattern=pattern,
                    candidates=new_candidates, chosen=None,
                    action="skip", grid_snapshot=snap(), iteration=iteration,
                    note="No better constrained candidate found",
                ))

        if not changed:
            break

    # ── Phase 3b: Gap fill — constrained re-ask for partial clues ────────────
    # Clues skipped in Phase 2 stay blank. Once crossings are filled, their
    # pattern has some known letters — use those to ask the LLM (and optionally
    # Tavily) for a fitting word. We only fill, never overwrite, so check_word
    # ensures no crossing conflicts.
    gap_clues = sort_by_constraints(
        [c for c in puzzle.clues
         if not is_solved(grid, c)
         and '_' in get_pattern(grid, c)
         and get_pattern(grid, c) != '_' * c.length],   # at least 1 known letter
        grid,
    )
    for clue in gap_clues:
        pattern = get_pattern(grid, clue)
        # Try LLM constrained first
        try:
            new_candidates = get_candidates_constrained(
                clue.text, clue.length, pattern, model, puzzle_date=puzzle_date
            )
        except Exception:
            new_candidates = []

        valid = [w for w in new_candidates
                 if check_word(w, clue, grid) and w not in rejected[clue.id]]

        # If LLM came up empty, try web search
        if not valid and use_web_search:
            try:
                web_candidates = search_crossword_answer(
                    clue.text, clue.length,
                    puzzle_date=puzzle_date,
                    pattern=pattern,
                )
                valid = [w for w in web_candidates
                         if check_word(w, clue, grid) and w not in rejected[clue.id]]
                if valid:
                    new_candidates = web_candidates
            except Exception:
                pass

        chosen = None
        for word in valid:
            if _try_fill(word, clue):
                chosen = word
                break

        if chosen:
            yield emit(SolveStep(
                phase=3, clue_id=clue.id, clue_text=clue.text,
                length=clue.length, pattern=pattern,
                candidates=new_candidates, chosen=chosen,
                action="repair", grid_snapshot=snap(),
                note=f"Gap filled with pattern '{pattern}'",
            ))
        else:
            yield emit(SolveStep(
                phase=3, clue_id=clue.id, clue_text=clue.text,
                length=clue.length, pattern=pattern,
                candidates=new_candidates, chosen=None,
                action="skip", grid_snapshot=snap(),
                note="No gap-fill candidate found",
            ))

    # ── Done ─────────────────────────────────────────────────────────────────
    clues_solved = sum(
        1 for c in puzzle.clues
        if get_pattern(grid, c) == puzzle.solution.get(c.id, "")
    )
    yield emit(SolveStep(
        phase=3, clue_id="", clue_text="",
        length=0, pattern="",
        candidates=[], chosen=None, action="done",
        grid_snapshot=snap(),
        note=f"Solved {clues_solved}/{len(puzzle.clues)} clues correctly",
    ))

    return SolveResult(
        grid=grid,
        steps=steps,
        clues_solved=clues_solved,
        total_clues=len(puzzle.clues),
    )
