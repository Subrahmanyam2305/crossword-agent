from __future__ import annotations
import copy
from .puzzle import Clue, CrosswordPuzzle


def get_pattern(grid: list[list[str]], clue: Clue) -> str:
    """
    Return the current letter pattern for a clue, e.g. "N_LE".
    Known letters (filled from crossing words) are shown; empties are '_'.
    """
    r, c = clue.start
    chars = []
    for i in range(clue.length):
        row_i = r + (i if clue.direction == 'D' else 0)
        col_i = c + (i if clue.direction == 'A' else 0)
        cell = grid[row_i][col_i]
        chars.append(cell if cell else '_')
    return ''.join(chars)


def known_count(grid: list[list[str]], clue: Clue) -> int:
    """Number of already-filled letters in this clue's cells."""
    return sum(1 for c in get_pattern(grid, clue) if c != '_')


def check_word(word: str, clue: Clue, grid: list[list[str]]) -> bool:
    """
    Return True if `word` can be placed for this clue without conflicting
    with any already-filled cell in the grid.
    """
    word = word.upper().strip()
    if len(word) != clue.length:
        return False
    r, c = clue.start
    for i, letter in enumerate(word):
        row_i = r + (i if clue.direction == 'D' else 0)
        col_i = c + (i if clue.direction == 'A' else 0)
        existing = grid[row_i][col_i]
        if existing and existing != letter:
            return False
    return True


def fill_word(word: str, clue: Clue, grid: list[list[str]]) -> None:
    """Fill `word` into the grid in place."""
    word = word.upper().strip()
    r, c = clue.start
    for i, letter in enumerate(word):
        row_i = r + (i if clue.direction == 'D' else 0)
        col_i = c + (i if clue.direction == 'A' else 0)
        grid[row_i][col_i] = letter


def unfill_word(clue: Clue, grid: list[list[str]],
                protected: set[tuple[int, int]] | None = None) -> None:
    """
    Clear the cells owned by this clue.
    `protected` is a set of (row, col) that should NOT be cleared because
    they are shared with a crossing word that was filled later and is still
    considered valid.
    """
    protected = protected or set()
    r, c = clue.start
    for i in range(clue.length):
        row_i = r + (i if clue.direction == 'D' else 0)
        col_i = c + (i if clue.direction == 'A' else 0)
        if (row_i, col_i) not in protected:
            grid[row_i][col_i] = ''


def current_fill(grid: list[list[str]], clue: Clue) -> str:
    """Return the word currently in the grid for this clue (may contain '')."""
    return get_pattern(grid, clue).replace('_', '')


def get_cells(clue: Clue) -> list[tuple[int, int]]:
    """Return all (row, col) positions occupied by this clue."""
    r, c = clue.start
    return [
        (r + (i if clue.direction == 'D' else 0),
         c + (i if clue.direction == 'A' else 0))
        for i in range(clue.length)
    ]


def find_inconsistencies(grid: list[list[str]],
                         clues: list[Clue]) -> list[Clue]:
    """
    Find clues that have at least one crossing conflict:
    i.e. a cell that is already filled but doesn't match what this
    clue's current fill says it should be.

    This catches cases where Phase 2 placed two words that disagree
    on a shared cell.
    """
    # Build a map from cell -> list of (clue, letter_index)
    cell_map: dict[tuple[int, int], list[tuple[Clue, int]]] = {}
    for clue in clues:
        for i, cell in enumerate(get_cells(clue)):
            cell_map.setdefault(cell, []).append((clue, i))

    bad: set[str] = set()
    for cell, owners in cell_map.items():
        if len(owners) < 2:
            continue
        letters = set()
        for clue, idx in owners:
            pattern = get_pattern(grid, clue)
            if pattern[idx] != '_':
                letters.add(pattern[idx])
        if len(letters) > 1:
            for clue, _ in owners:
                bad.add(clue.id)

    return [c for c in clues if c.id in bad]


def is_solved(grid: list[list[str]], clue: Clue) -> bool:
    """Return True if every cell of this clue is filled."""
    return '_' not in get_pattern(grid, clue)


def sort_by_constraints(clues: list[Clue],
                        grid: list[list[str]]) -> list[Clue]:
    """
    Return clues sorted by number of known letters descending.
    Most constrained first = MRV (Minimum Remaining Values) heuristic.
    """
    return sorted(clues, key=lambda c: known_count(grid, c), reverse=True)
