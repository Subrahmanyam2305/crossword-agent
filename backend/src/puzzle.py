from __future__ import annotations
from dataclasses import dataclass
import json
import copy


@dataclass
class Clue:
    id: str                   # "1A", "3D"
    text: str                 # "Bee ball?"
    start: tuple[int, int]    # (row, col) zero-indexed
    direction: str            # "A" or "D"
    length: int
    number: int               # grid number label (1, 2, 3, ...)


@dataclass
class CrosswordPuzzle:
    title: str
    rows: int
    cols: int
    # '#' = black square, '' = empty fillable cell
    grid: list[list[str]]
    clues: list[Clue]
    solution: dict[str, str]  # clue_id -> correct word, e.g. "1A" -> "SWARM"

    def empty_grid(self) -> list[list[str]]:
        """Return a fresh all-empty working grid."""
        return [
            ['#' if cell == '#' else '' for cell in row]
            for row in self.grid
        ]

    def clue_by_id(self, clue_id: str) -> Clue | None:
        return next((c for c in self.clues if c.id == clue_id), None)


# Characters that represent black / blocked squares in doshea JSON
_BLACK = {'.', '#', 'BLACK', ''}


def load_puzzle(path: str) -> CrosswordPuzzle:
    """
    Load a crossword from the doshea/nyt_crosswords JSON format.

    Expected top-level keys:
      size:     {rows: int, cols: int}
      grid:     flat list of single chars – letter or '.' for black
      gridnums: flat list of ints (0 = no number)
      clues:    {across: ["1. Text", ...], down: ["2. Text", ...]}
      answers:  {across: ["WORD", ...], down: ["WORD", ...]}
      title:    str (optional)
    """
    with open(path) as f:
        raw = json.load(f)

    rows: int = raw["size"]["rows"]
    cols: int = raw["size"]["cols"]

    flat: list[str] = raw["grid"]           # e.g. ['S','W','A','.', ...]
    gridnums: list[int] = raw["gridnums"]   # e.g. [1,2,3,0,4, ...]

    # Build 2-D template grid ('#' = black, '' = empty fillable)
    template_grid: list[list[str]] = [
        ['#' if flat[r * cols + c] in _BLACK else ''
         for c in range(cols)]
        for r in range(rows)
    ]

    # Map grid number → (row, col)
    num_to_pos: dict[int, tuple[int, int]] = {}
    for i, n in enumerate(gridnums):
        if n > 0:
            num_to_pos[n] = divmod(i, cols)

    def _clue_length(row: int, col: int, direction: str) -> int:
        length = 0
        r, c = row, col
        while r < rows and c < cols and template_grid[r][c] != '#':
            length += 1
            if direction == 'A':
                c += 1
            else:
                r += 1
        return length

    def _parse_clue_list(raw_clues: list[str], direction: str) -> list[Clue]:
        clues: list[Clue] = []
        for entry in raw_clues:
            dot = entry.index('.')
            number = int(entry[:dot].strip())
            text = entry[dot + 1:].strip()
            pos = num_to_pos.get(number)
            if pos is None:
                continue
            row, col = pos
            length = _clue_length(row, col, direction)
            if length >= 2:
                clues.append(Clue(
                    id=f"{number}{direction}",
                    text=text,
                    start=(row, col),
                    direction=direction,
                    length=length,
                    number=number,
                ))
        return clues

    across_clues = _parse_clue_list(raw["clues"]["across"], "A")
    down_clues   = _parse_clue_list(raw["clues"]["down"],   "D")
    all_clues    = across_clues + down_clues

    # Build solution map from answers field (authoritative in doshea format)
    answers_across: list[str] = raw.get("answers", {}).get("across", [])
    answers_down:   list[str] = raw.get("answers", {}).get("down",   [])

    solution: dict[str, str] = {}
    for clue, word in zip(across_clues, answers_across):
        solution[clue.id] = word.upper()
    for clue, word in zip(down_clues, answers_down):
        solution[clue.id] = word.upper()

    return CrosswordPuzzle(
        title=raw.get("title", path),
        rows=rows,
        cols=cols,
        grid=template_grid,
        clues=all_clues,
        solution=solution,
    )


def print_grid(grid: list[list[str]], title: str = "") -> None:
    if title:
        print(f"\n{title}")
    for row in grid:
        print(' '.join(c if c else '.' for c in row))
    print()
