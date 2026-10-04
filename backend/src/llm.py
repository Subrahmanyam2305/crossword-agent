from __future__ import annotations
import json
import os
import re
from openai import OpenAI

NEBIUS_BASE_URL = "https://api.studio.nebius.com/v1/"

MODELS = {
    "kimi-k3":             "moonshotai/Kimi-K3",
    "deepseek-v4.1-flash": "deepseek-ai/DeepSeek-V4.1-Flash",
    "glm-5-3":             "zai-org/GLM-5.3",
    "minimax-m3":          "MiniMaxAI/MiniMax-M3",
    "hermes-4-405b":       "NousResearch/Hermes-4-405B",
    "nemotron-ultra-550b": "nvidia/Nemotron-3-Ultra-550b-a55b",
}

_client: OpenAI | None = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        api_key = os.environ.get("NEBIUS_API_KEY")
        if not api_key:
            raise EnvironmentError(
                "NEBIUS_API_KEY not set. Copy .env.example to .env and add your key."
            )
        _client = OpenAI(api_key=api_key, base_url=NEBIUS_BASE_URL)
    return _client


def _extract_text(choice) -> str:
    """
    DeepSeek V4 Flash is a thinking model: the final answer goes into `content`
    and the chain-of-thought into `reasoning_content`.
    When `content` is empty, scan `reasoning_content` for a JSON array
    (the last one found is usually the conclusion) rather than returning the
    whole reasoning blob which contaminates the word-extraction fallback.
    """
    content = (choice.message.content or "").strip()
    if content:
        return content

    reasoning = getattr(choice.message, "reasoning_content", None) or ""
    # Find the last JSON-array-like substring in the reasoning trace
    matches = list(re.finditer(r'\[[^\[\]]{3,}\]', reasoning))
    if matches:
        return matches[-1].group(0)
    return reasoning


def _parse_word_list(raw: str, expected_length: int) -> list[str]:
    """
    Robustly extract a list of uppercase words from LLM output.
    Handles JSON arrays, numbered lists, comma-separated, one-per-line.
    """
    # Try JSON array first (most reliable when model follows instructions)
    try:
        arr = json.loads(raw)
        if isinstance(arr, list):
            seen: set[str] = set()
            result = []
            for w in arr:
                if not isinstance(w, str):
                    continue
                w = w.upper().strip()
                if len(w) == expected_length and w not in seen:
                    seen.add(w)
                    result.append(w)
            return result
    except (json.JSONDecodeError, ValueError):
        pass

    # Try to find a JSON array anywhere in the text (e.g. wrapped in markdown)
    m = re.search(r'\[([^\]]+)\]', raw)
    if m:
        try:
            arr = json.loads(f"[{m.group(1)}]")
            if isinstance(arr, list):
                seen = set()
                result = []
                for w in arr:
                    if not isinstance(w, str):
                        continue
                    w = w.upper().strip()
                    if len(w) == expected_length and w not in seen:
                        seen.add(w)
                        result.append(w)
                return result
        except (json.JSONDecodeError, ValueError):
            pass

    # Last resort: extract all letter-only tokens of the right length
    words = re.findall(r'\b[A-Za-z]{2,}\b', raw)
    seen = set()
    result = []
    for w in words:
        w = w.upper()
        if len(w) == expected_length and w not in seen:
            seen.add(w)
            result.append(w)
    return result


def get_candidates_unconstrained(
    clue_text: str,
    length: int,
    model: str,
    n: int = 20,
    puzzle_date: str = "",
) -> list[str]:
    """
    Phase 1: generate candidates knowing only the clue and word length.
    Returns up to `n` unique uppercase words of exactly `length` letters.
    """
    date_hint = f" (published {puzzle_date})" if puzzle_date else ""
    prompt = (
        f'New York Times crossword{date_hint}.\n'
        f'Clue: "{clue_text}"\n'
        f'Answer length: {length} letters.\n\n'
        f'Reply with ONLY a JSON array of your top {n} uppercase answer candidates, '
        f'each exactly {length} letters, ordered from MOST to LEAST confident. '
        f'The first entry must be your single best answer. No explanation, no other text.\n'
        f'Example for 5 letters: ["SWARM","HORDE","TROOP","GROUP","CLOUD","FLOCK","BUNCH","BEVY","COVEY","BROOD"]'
    )
    client = get_client()
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": (
                "You are an expert New York Times crossword solver with deep knowledge of "
                "crossword conventions, wordplay, abbreviations, and cultural references. "
                "NYT clues often use wordplay, puns, and obscure vocabulary. "
                "Always respond with a JSON array of candidates ordered from most to least confident — "
                "your best answer must be first. Output only the JSON array, nothing else."
            )},
            {"role": "user", "content": prompt},
        ],
        temperature=0.0,
        max_tokens=500,
    )
    raw = _extract_text(response.choices[0])
    return _parse_word_list(raw, length)[:n]


def get_candidates_constrained(
    clue_text: str,
    length: int,
    pattern: str,
    model: str,
    n: int = 5,
    puzzle_date: str = "",
) -> list[str]:
    """
    Phase 3: re-generate candidates conditioning on known crossing letters.
    pattern e.g. "N_LE" — letter = confirmed from crossing word, _ = unknown.
    """
    date_hint = f" (published {puzzle_date})" if puzzle_date else ""
    known_positions = [
        f"position {i+1}='{ch}'"
        for i, ch in enumerate(pattern)
        if ch != '_'
    ]
    constraints = ", ".join(known_positions) if known_positions else "none yet"

    prompt = (
        f'New York Times crossword{date_hint}.\n'
        f'Clue: "{clue_text}"\n'
        f'Answer length: {length} letters.\n'
        f'Known letters (from crossing words): {pattern}  (_ = unknown)\n'
        f'Fixed positions: {constraints}\n\n'
        f'List your top {n} candidates as a JSON array, ordered from MOST to LEAST confident. '
        f'The first entry must be your single best answer. '
        f'Every word MUST be exactly {length} uppercase letters AND satisfy the fixed positions. '
        f'Output ONLY the JSON array.'
    )
    client = get_client()
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": (
                "You are an expert New York Times crossword solver with deep knowledge of "
                "crossword conventions, wordplay, abbreviations, and cultural references. "
                "Always respond with a JSON array of candidates ordered from most to least confident — "
                "your best answer must be first. Output only the JSON array, nothing else."
            )},
            {"role": "user", "content": prompt},
        ],
        temperature=0.0,
        max_tokens=200,
    )
    raw = _extract_text(response.choices[0])
    candidates = _parse_word_list(raw, length)[:n]

    # Hard-filter: reject anything that violates the pattern
    def matches(word: str) -> bool:
        return len(word) == len(pattern) and all(
            p == '_' or p == w for p, w in zip(pattern, word)
        )

    return [w for w in candidates if matches(w)][:n]
