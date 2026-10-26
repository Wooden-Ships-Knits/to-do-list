"""Private notes. Every query is scoped to the owner: someone else's note answers 404, so its
existence is never revealed (admins included).

Links (`[[Note]]`, `[[Project]]`, `[[Project > Subtask]]`) are worked out from the bodies when a
note is read, so they stay right after renames, deletes and restores without a link table.
"""

import re
import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.clock import now_utc
from app.errors import AppError
from app.models import Note, Project, Task
from app.queries import _contains
from app.schemas import (
    BacklinkOut,
    LinkTarget,
    NoteCreate,
    NoteLinkOut,
    NoteListItem,
    NoteOut,
    NotePatch,
)
from app.wikilinks import WikiLink, find_links, rename_links

SUBTASK_SEPARATOR = " > "
SNIPPET_LENGTH = 140
TARGET_LIMITS = {"note": 8, "project": 6, "task": 6}


def _not_found() -> AppError:
    return AppError(404, "note_not_found", "Note not found")


def _duplicate(title: str) -> AppError:
    return AppError(
        409, "duplicate_title", f"You already have a note called '{title}'", {"field": "title"}
    )


def snippet(body: str) -> str:
    """The start of the body as plain text, for lists."""
    # table divider rows ("| --- | :-: |") are layout, not text
    body = re.sub(r"^[ \t]*\|?[ \t:|-]*-{3,}[ \t:|-]*$", "", body, flags=re.M)
    text = re.sub(r"\[\[([^\]|]+)\|([^\]]*)\]\]", r"\2", body)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"[#>*_`~]|^\s*[-+]\s+(\[[ xX]\]\s+)?|\|", " ", text, flags=re.M)
    text = " ".join(text.split())
    return text if len(text) <= SNIPPET_LENGTH else text[: SNIPPET_LENGTH - 1].rstrip() + "…"


def _owned(owner_id: uuid.UUID) -> sa.Select[tuple[Note]]:
    return sa.select(Note).where(Note.owner_id == owner_id)


def fetch(session: Session, owner_id: uuid.UUID, note_id: uuid.UUID) -> Note:
    note = session.scalar(_owned(owner_id).where(Note.id == note_id))
    if note is None:
        raise _not_found()
    return note


def fetch_active(session: Session, owner_id: uuid.UUID, note_id: uuid.UUID) -> Note:
    note = fetch(session, owner_id, note_id)
    if note.deleted_at is not None:
        raise _not_found()
    return note


def _title_taken(
    session: Session, owner_id: uuid.UUID, title: str, exclude: uuid.UUID | None = None
) -> bool:
    stmt = (
        sa.select(Note.id)
        .where(
            Note.owner_id == owner_id,
            Note.deleted_at.is_(None),
            sa.func.lower(Note.title) == title.lower(),
        )
        .limit(1)
    )
    if exclude is not None:
        stmt = stmt.where(Note.id != exclude)
    return session.scalar(stmt) is not None


def list_notes(session: Session, owner_id: uuid.UUID, q: str | None) -> list[NoteListItem]:
    stmt = _owned(owner_id).where(Note.deleted_at.is_(None))
    if q and q.strip():
        text = q.strip()
        stmt = stmt.where(sa.or_(_contains(Note.title, text), _contains(Note.body, text)))
    stmt = stmt.order_by(Note.pinned.desc(), Note.updated_at.desc(), Note.id)
    return [
        NoteListItem(
            id=n.id,
            title=n.title,
            pinned=n.pinned,
            updated_at=n.updated_at,
            snippet=snippet(n.body),
        )
        for n in session.scalars(stmt)
    ]


def _resolve(session: Session, owner_id: uuid.UUID, links: list[WikiLink]) -> list[NoteLinkOut]:
    """Own note first, then `Project > Subtask`, then project; otherwise unresolved."""
    if not links:
        return []
    keys = {link.target.lower() for link in links}
    notes = {
        n.title.lower(): n.id
        for n in session.scalars(
            _owned(owner_id).where(Note.deleted_at.is_(None), sa.func.lower(Note.title).in_(keys))
        )
    }
    project_keys = keys | {k.split(SUBTASK_SEPARATOR, 1)[0] for k in keys}
    projects = {
        p.name.lower(): p.id
        for p in session.scalars(
            sa.select(Project).where(
                Project.deleted_at.is_(None), sa.func.lower(Project.name).in_(project_keys)
            )
        )
    }
    tasks: dict[tuple[uuid.UUID, str], tuple[uuid.UUID, uuid.UUID]] = {}
    pairs = [k.split(SUBTASK_SEPARATOR, 1) for k in keys if SUBTASK_SEPARATOR in k]
    if pairs:
        for t in session.scalars(
            sa.select(Task).where(
                Task.deleted_at.is_(None),
                Task.project_id.in_([projects[p] for p, _ in pairs if p in projects]),
                sa.func.lower(Task.name).in_([name.strip() for _, name in pairs]),
            )
        ):
            tasks.setdefault((t.project_id, t.name.lower()), (t.id, t.project_id))

    out: list[NoteLinkOut] = []
    for link in links:
        key = link.target.lower()
        base: dict[str, Any] = {"target": link.target, "label": link.label}
        if key in notes:
            out.append(NoteLinkOut(**base, kind="note", note_id=notes[key]))
            continue
        if SUBTASK_SEPARATOR in key:
            project_name, task_name = key.split(SUBTASK_SEPARATOR, 1)
            project_id = projects.get(project_name)
            found = tasks.get((project_id, task_name.strip())) if project_id else None
            if found:
                out.append(NoteLinkOut(**base, kind="task", task_id=found[0], project_id=found[1]))
                continue
        if key in projects:
            out.append(NoteLinkOut(**base, kind="project", project_id=projects[key]))
            continue
        out.append(NoteLinkOut(**base, kind="unresolved"))
    return out


def _backlinks(session: Session, note: Note) -> list[BacklinkOut]:
    """The owner's other notes with a `[[ ]]` link to this note's title."""
    key = note.title.lower()
    candidates = session.scalars(
        _owned(note.owner_id)
        .where(Note.deleted_at.is_(None), Note.id != note.id, Note.body.contains("[["))
        .order_by(Note.updated_at.desc())
    )
    return [
        BacklinkOut(id=n.id, title=n.title, snippet=snippet(n.body))
        for n in candidates
        if any(link.target.lower() == key for link in find_links(n.body))
    ]


def to_out(session: Session, note: Note) -> NoteOut:
    return NoteOut(
        id=note.id,
        title=note.title,
        body=note.body,
        pinned=note.pinned,
        version=note.version,
        created_at=note.created_at,
        updated_at=note.updated_at,
        deleted_at=note.deleted_at,
        links=_resolve(session, note.owner_id, find_links(note.body)),
        backlinks=_backlinks(session, note) if note.deleted_at is None else [],
    )


def _commit(session: Session, title: str) -> None:
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        if "uq_notes_owner_title_active" in str(exc.orig):
            raise _duplicate(title) from exc
        raise


def create_note(session: Session, owner_id: uuid.UUID, payload: NoteCreate) -> NoteOut:
    if _title_taken(session, owner_id, payload.title):
        raise _duplicate(payload.title)
    note = Note(owner_id=owner_id, title=payload.title, body=payload.body)
    note.version = 1
    session.add(note)
    _commit(session, payload.title)
    session.refresh(note)
    return to_out(session, note)


def _conflict(session: Session, owner_id: uuid.UUID, note_id: uuid.UUID) -> AppError:
    session.rollback()
    current = session.scalar(_owned(owner_id).where(Note.id == note_id))
    details: dict[str, Any] | None = None
    if current is not None:
        session.refresh(current)
        details = {"current": to_out(session, current).model_dump(mode="json")}
    return AppError(
        409,
        "version_conflict",
        "This note was changed somewhere else (another tab or device).",
        details,
    )


def _rewrite_links(session: Session, note: Note, old: str, new: str) -> None:
    """Renaming a note points the owner's `[[old]]` links at the new title."""
    others = session.scalars(
        _owned(note.owner_id).where(
            Note.deleted_at.is_(None), Note.id != note.id, Note.body.contains("[[")
        )
    )
    for other in others:
        body = rename_links(other.body, old, new)
        if body != other.body:
            other.body = body


def update_note(
    session: Session, owner_id: uuid.UUID, note_id: uuid.UUID, payload: NotePatch
) -> NoteOut:
    note = fetch_active(session, owner_id, note_id)
    if note.version != payload.version:
        raise _conflict(session, owner_id, note_id)
    sent = payload.model_fields_set - {"version"}
    changed = False
    with session.no_autoflush:
        if "title" in sent and payload.title is not None and payload.title != note.title:
            if _title_taken(session, owner_id, payload.title, exclude=note.id):
                raise _duplicate(payload.title)
            old = note.title
            note.title = payload.title
            if old.lower() != payload.title.lower():
                _rewrite_links(session, note, old, payload.title)
            changed = True
        if "body" in sent and payload.body is not None and payload.body != note.body:
            note.body = payload.body
            changed = True
        if "pinned" in sent and payload.pinned is not None and payload.pinned != note.pinned:
            note.pinned = payload.pinned
            changed = True
    if not changed:
        session.rollback()
        return to_out(session, note)
    note.updated_at = now_utc()
    try:
        _commit(session, note.title)
    except StaleDataError as exc:
        raise _conflict(session, owner_id, note_id) from exc
    session.refresh(note)
    return to_out(session, note)


def delete_note(session: Session, owner_id: uuid.UUID, note_id: uuid.UUID) -> None:
    note = fetch_active(session, owner_id, note_id)
    note.deleted_at = now_utc()
    session.commit()


def restore_note(session: Session, owner_id: uuid.UUID, note_id: uuid.UUID) -> NoteOut:
    note = fetch(session, owner_id, note_id)
    if note.deleted_at is None:
        raise AppError(409, "not_deleted", "Note is not deleted")
    if _title_taken(session, owner_id, note.title, exclude=note.id):
        raise _duplicate(note.title)
    note.deleted_at = None
    note.updated_at = now_utc()
    _commit(session, note.title)
    session.refresh(note)
    return to_out(session, note)


def link_targets(session: Session, owner_id: uuid.UUID, q: str | None) -> list[LinkTarget]:
    """Suggestions for `[[`: own notes, the team's projects and their subtasks."""
    text = (q or "").strip()
    out: list[LinkTarget] = []

    notes = _owned(owner_id).where(Note.deleted_at.is_(None))
    if text:
        notes = notes.where(_contains(Note.title, text))
    for n in session.scalars(notes.order_by(Note.updated_at.desc()).limit(TARGET_LIMITS["note"])):
        out.append(LinkTarget(kind="note", label=n.title, insert=n.title, id=n.id))

    projects = sa.select(Project).where(Project.deleted_at.is_(None))
    if text:
        projects = projects.where(_contains(Project.name, text))
    for p in session.scalars(
        projects.order_by(sa.func.lower(Project.name)).limit(TARGET_LIMITS["project"])
    ):
        out.append(LinkTarget(kind="project", label=p.name, insert=p.name, id=p.id))

    tasks = (
        sa.select(Task, Project.name)
        .join(Project, Project.id == Task.project_id)
        .where(Task.deleted_at.is_(None), Project.deleted_at.is_(None))
    )
    if text:
        tasks = tasks.where(_contains(Task.name, text))
    for task, project_name in session.execute(
        tasks.order_by(sa.func.lower(Task.name)).limit(TARGET_LIMITS["task"])
    ):
        path = f"{project_name}{SUBTASK_SEPARATOR}{task.name}"
        out.append(LinkTarget(kind="task", label=path, insert=path, id=task.id))
    return out
