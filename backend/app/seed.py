"""Idempotent seed: running it twice never duplicates data."""

import logging
from dataclasses import dataclass, field
from datetime import date

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.db import session_factory
from app.models import ActivityLog, Category, Person, Project, Stage, User
from app.services.projects import next_position

log = logging.getLogger("app.seed")

STAGES = [
    "Not Started",
    "Investigation",
    "In Progress",
    "In Development",
    "Testing",
    "Waiting",
    "Built",
    "Live",
    "Under Maintenance",
    "Done",
]
PEOPLE = ["Denan", "Luthfi", "Prada", "Dzawil", "Andika"]
# Every team member gets an admin login "<name in lower case>" whose first password is the
# username; it has to be changed at the first login.
ACCOUNTS = PEOPLE


@dataclass
class SeedProject:
    name: str
    category: Category
    stage: str
    description: str = ""
    status_notes: str = ""
    ongoing_issue: str = ""
    plan_date: date | None = None
    projected_start_date: date | None = None
    deadline_note: str = ""
    pics: list[str] = field(default_factory=list)


C, P, M = Category.current, Category.pending, Category.maintenance

PROJECTS = [
    SeedProject(
        "SY Product Page Inventory Sync",
        C,
        "In Progress",
        description="Combine Unfixed, Fixed, and SALE variants on one product page and sync their inventory.",
        plan_date=date(2026, 10, 1),
        pics=["Denan"],
    ),
    SeedProject(
        "YMAL: WISER Historical Data",
        C,
        "Waiting",
        description="Migrate WISER's historical click and revenue data into our YMAL app.",
        status_notes="Ongoing, waiting on WISER response",
        plan_date=date(2026, 10, 8),
        pics=["Luthfi"],
    ),
    SeedProject(
        "Return Report",
        C,
        "Testing",
        description="Improve return reporting based on the order month and complete return period.",
        status_notes="Report is completed, including gridlines and indexing. Currently in testing and validation, comparing results against the full dataset for accuracy and consistency.",
        pics=["Prada"],
    ),
    SeedProject(
        "Shopify Order Checker Improvement",
        C,
        "In Development",
        description="Improve the existing checker to identify orders that can be fulfilled from NE and orders that need to be placed on HOLD.",
        status_notes="Live order mirroring is working. NE stock matching and the HOLD checker are under development.",
        pics=["Prada"],
    ),
    SeedProject(
        "Payment Notice Email Date Tracking",
        C,
        "Testing",
        description="Automatically record PPIC payment reminder emails and customer-requested reminder dates in the monthly Google Sheets tracker.",
        status_notes="Evaluation stage (PPIC is running and testing the trial version).",
        pics=["Dzawil"],
    ),
    SeedProject(
        "Z Customer",
        C,
        "Live",
        description="Analyze order and return history to establish a fair statistical rule for tagging customers with a proven high-return pattern.",
        status_notes="1,737 Proven + Possible Z customers tagged in Shopify for Redo.",
        deadline_note="TBD for revision after Paola's review",
        pics=["Andika"],
    ),
    SeedProject(
        "Loyalty Program App",
        P,
        "Not Started",
        description="Build a replacement app for LoyaltyLion.",
        projected_start_date=date(2026, 10, 15),
        deadline_note="Mid-Oct",
        pics=["Denan"],
    ),
    SeedProject(
        "Wholesale Leads",
        P,
        "Not Started",
        description="Recommend potential wholesale stores to sales representatives.",
        pics=["Luthfi", "Prada"],
    ),
    SeedProject(
        "FAQ Page",
        P,
        "Not Started",
        description="Create an FAQ page for DOF.",
        pics=["Luthfi"],
    ),
    SeedProject(
        "Competitor Store Location Crawler",
        P,
        "Not Started",
        description="Build a bot to find stores that carry Wooden Ships competitor brands.",
        pics=["Prada"],
    ),
    SeedProject(
        "Block AI and Bot Crawlers",
        P,
        "Not Started",
        description="Prevent unauthorized bots from scraping our website.",
    ),
    SeedProject(
        "FILTER",
        P,
        "Investigation",
        description="Create an automation to ensure sweaters are tagged correctly for armhole-related attributes, so the filters consistently identify all applicable products.",
        status_notes="Root cause investigation",
    ),
    SeedProject(
        "HR App",
        M,
        "In Development",
        ongoing_issue="Merge the recruitment update into the live app, improve the UI/UX, and fix payroll calculation discrepancies.",
        status_notes="Discrepancies found in payroll calculation, particularly Regular Hours, where the app differs from previous attendance records. The payroll recap does not yet properly handle the new leave balance used to offset negative hours.",
        pics=["Denan", "Prada"],
    ),
    SeedProject(
        "WS Shopify Video App",
        M,
        "Testing",
        ongoing_issue="List all product pages with videos and migrate them to the new app; waiting for Paola's feedback on the SOP.",
        status_notes="Built and in testing",
        pics=["Denan"],
    ),
    SeedProject(
        "SY Image Order Sync App",
        M,
        "Built",
        ongoing_issue="Develop the app UI for the team.",
        pics=["Denan"],
    ),
    SeedProject(
        "Slow Seller App",
        M,
        "Under Maintenance",
        ongoing_issue="Overwhelming UI, needs fixing. Data mismatch.",
        pics=["Luthfi"],
    ),
]


def seed_stages(session: Session) -> dict[str, Stage]:
    existing = {s.name: s for s in session.scalars(sa.select(Stage))}
    for order, name in enumerate(STAGES, start=1):
        if name not in existing:
            stage = Stage(name=name, sort_order=order)
            session.add(stage)
            existing[name] = stage
    session.flush()
    return existing


def seed(session: Session) -> dict[str, int]:
    stages = seed_stages(session)
    people = {p.name.lower(): p for p in session.scalars(sa.select(Person))}
    created_people = 0
    for name in PEOPLE:
        if name.lower() not in people:
            person = Person(name=name)
            session.add(person)
            people[name.lower()] = person
            created_people += 1
    session.flush()

    created_users = seed_users(session, people)

    existing_names = {
        n.lower()
        for n in session.scalars(sa.select(Project.name).where(Project.deleted_at.is_(None)))
    }
    created_projects = 0
    for sp in PROJECTS:
        if sp.name.lower() in existing_names:
            continue
        project = Project(
            name=sp.name,
            category=sp.category,
            stage_id=stages[sp.stage].id,
            description=sp.description,
            status_notes=sp.status_notes,
            ongoing_issue=sp.ongoing_issue,
            plan_date=sp.plan_date,
            projected_start_date=sp.projected_start_date,
            deadline_note=sp.deadline_note,
            pics=[people[n.lower()] for n in sp.pics],
            position=next_position(session, sp.category),  # seed order = manual order
        )
        project.version = 1
        session.add(project)
        session.flush()
        session.add(ActivityLog(project_id=project.id, field="project", new_value="created"))
        created_projects += 1
    session.commit()
    return {"people": created_people, "users": created_users, "projects": created_projects}


def seed_users(session: Session, people: dict[str, Person]) -> int:
    """Creates the missing accounts only: an existing account (and its password) is never
    touched, so running the seed again is safe."""
    taken = {u.lower() for u in session.scalars(sa.select(User.username))}
    linked = set(session.scalars(sa.select(User.person_id)))
    created = 0
    for name in ACCOUNTS:
        username = name.lower()
        person = people[username]
        if username in taken or person.id in linked:
            continue
        session.add(
            User(
                username=username,
                person_id=person.id,
                password_hash=hash_password(username),
                is_admin=True,
                is_active=True,
                must_change_password=True,
            )
        )
        created += 1
    session.flush()
    return created


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    with session_factory()() as session:
        result = seed(session)
    log.info(
        "Seed complete: %s new people, %s new users, %s new projects",
        result["people"],
        result["users"],
        result["projects"],
    )


if __name__ == "__main__":
    main()
