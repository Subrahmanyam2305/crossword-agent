from __future__ import annotations
import os
import re

_tavily_client = None


def _get_client():
    global _tavily_client
    if _tavily_client is None:
        from tavily import TavilyClient
        api_key = os.environ.get("TAVILY_API_KEY")
        if not api_key:
            raise EnvironmentError("TAVILY_API_KEY not set")
        _tavily_client = TavilyClient(api_key=api_key)
    return _tavily_client


def search_crossword_answer(
    clue_text: str,
    length: int,
    puzzle_date: str = "",
    pattern: str = "",
) -> list[str]:
    """
    Use Tavily to search crossword answer databases for a specific clue.
    Returns uppercase candidate words of exactly `length` letters.

    When `pattern` is provided (e.g. "A__O"), it is included in the query
    and used to post-filter results, significantly narrowing candidates.
    """
    date_hint = f" {puzzle_date}" if puzzle_date else ""

    # Include known letters in query if we have them — dramatically narrows results
    pattern_hint = ""
    if pattern and "_" in pattern:
        known = ", ".join(
            f"letter {i+1}='{ch}'" for i, ch in enumerate(pattern) if ch != "_"
        )
        if known:
            pattern_hint = f" Known letters: {known}."

    query = f'NYT crossword{date_hint} clue "{clue_text}" {length} letters answer{pattern_hint}'

    try:
        client = _get_client()
        response = client.search(
            query=query,
            search_depth="basic",
            max_results=5,
            include_domains=[
                "xwordinfo.com",
                "wordplays.com",
                "crosswordtracker.com",
                "crosswordsolver.org",
                "crossword-clue-answer.com",
            ],
        )
    except Exception:
        # Fall back to broader search without domain restriction
        try:
            client = _get_client()
            response = client.search(
                query=query,
                search_depth="basic",
                max_results=5,
            )
        except Exception:
            return []

    # Extract all text from results
    all_text = ""
    for result in response.get("results", []):
        all_text += " " + result.get("title", "")
        all_text += " " + result.get("content", "")

    return _extract_words(all_text, length, pattern)


def _extract_words(text: str, length: int, pattern: str = "") -> list[str]:
    """
    Extract uppercase words of exactly `length` letters from search result text.
    If pattern is given (e.g. "A__O"), words that don't match are moved to the back.
    """
    def matches_pattern(word: str) -> bool:
        if not pattern or len(pattern) != len(word):
            return True
        return all(p == "_" or p == w for p, w in zip(pattern, word))

    seen: set[str] = set()
    result: list[str] = []

    # Priority 1: words that appear after "Answer:", "answer is", "=", etc.
    answer_patterns = [
        r'[Aa]nswer[:\s]+([A-Z]{' + str(length) + r'})\b',
        r'[Aa]nswer[:\s]+([a-z]{' + str(length) + r'})\b',
        r'=\s*([A-Z]{' + str(length) + r'})\b',
        r'→\s*([A-Z]{' + str(length) + r'})\b',
    ]
    for pat in answer_patterns:
        for m in re.finditer(pat, text):
            w = m.group(1).upper()
            if w not in seen and w.isalpha():
                seen.add(w)
                result.append(w)

    # Priority 2: ALL-CAPS words of the right length
    for m in re.finditer(r'\b([A-Z]{' + str(length) + r'})\b', text):
        w = m.group(1)
        if w not in seen and w.isalpha():
            seen.add(w)
            result.append(w)

    # Priority 3: lowercase words of the right length (less reliable)
    for m in re.finditer(r'\b([a-z]{' + str(length) + r'})\b', text):
        w = m.group(1).upper()
        if w not in seen and w.isalpha():
            seen.add(w)
            result.append(w)

    # Sort: pattern-matching words first, non-matching last
    if pattern:
        result.sort(key=lambda w: (0 if matches_pattern(w) else 1))

    return result[:10]
