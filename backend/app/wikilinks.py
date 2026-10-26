"""Obsidian-style `[[links]]` in Markdown notes: `[[Target]]` or `[[Target|label]]`.

Links inside code spans and fenced code blocks are text, not links.
"""

import re
from collections.abc import Callable, Iterator
from typing import NamedTuple

LINK = re.compile(r"\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]*))?\]\]")
_INLINE_CODE = re.compile(r"(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)", re.S)
_FENCE_OPEN = re.compile(r"[ ]{0,3}(`{3,}|~{3,})")


class WikiLink(NamedTuple):
    target: str
    label: str | None


def _segments(body: str) -> Iterator[tuple[bool, str]]:
    """The body as (is_code, text) pieces, in order; joined they give the body back."""
    prose: list[str] = []
    fence: str | None = None

    def flush() -> Iterator[tuple[bool, str]]:
        text = "".join(prose)
        prose.clear()
        last = 0
        for m in _INLINE_CODE.finditer(text):
            if m.start() > last:
                yield False, text[last : m.start()]
            yield True, m.group(0)
            last = m.end()
        if last < len(text):
            yield False, text[last:]

    for line in body.splitlines(keepends=True):
        if fence is None:
            opening = _FENCE_OPEN.match(line)
            if opening:
                yield from flush()
                fence = opening.group(1)
                yield True, line
            else:
                prose.append(line)
            continue
        yield True, line
        stripped = line.strip()
        if stripped.startswith(fence) and set(stripped) == {fence[0]}:
            fence = None
    yield from flush()


def find_links(body: str) -> list[WikiLink]:
    links: list[WikiLink] = []
    for is_code, text in _segments(body):
        if is_code:
            continue
        for m in LINK.finditer(text):
            target = " ".join(m.group(1).split())
            if target:
                label = m.group(2)
                links.append(WikiLink(target, label.strip() if label is not None else None))
    return links


def _rewrite(body: str, replace: Callable[[re.Match[str]], str]) -> str:
    return "".join(
        text if is_code else LINK.sub(replace, text) for is_code, text in _segments(body)
    )


def rename_links(body: str, old: str, new: str) -> str:
    """Points every `[[old]]` / `[[old|label]]` (any case) at `new`, keeping labels."""
    key = " ".join(old.split()).lower()

    def replace(m: re.Match[str]) -> str:
        if " ".join(m.group(1).split()).lower() != key:
            return m.group(0)
        return f"[[{new}|{m.group(2)}]]" if m.group(2) is not None else f"[[{new}]]"

    return _rewrite(body, replace)
