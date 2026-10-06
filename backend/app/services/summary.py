import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.clock import today
from app.deadline import DeadlineStatus
from app.models import Category, Person, Project, project_pics
from app.queries import status_expr
from app.schemas import PicCount, Summary


def build_summary(session: Session) -> Summary:
    active = Project.deleted_at.is_(None)
    by_category = dict.fromkeys((c.value for c in Category), 0)
    for category, count in session.execute(
        sa.select(Project.category, sa.func.count()).where(active).group_by(Project.category)
    ):
        by_category[category.value] = count

    status = status_expr(today())
    by_status = dict.fromkeys((s.value for s in DeadlineStatus), 0)
    for key, count in session.execute(
        sa.select(status, sa.func.count()).where(active).group_by(status)
    ):
        by_status[key] = count

    counts = dict(
        session.execute(
            sa.select(project_pics.c.person_id, sa.func.count())
            .join(Project, Project.id == project_pics.c.project_id)
            .where(active)
            .group_by(project_pics.c.person_id)
        )
        .tuples()
        .all()
    )
    by_pic = [
        PicCount(person_id=p.id, name=p.name, count=counts.get(p.id, 0))
        for p in session.scalars(sa.select(Person).order_by(sa.func.lower(Person.name)))
        if p.is_active or counts.get(p.id, 0) > 0
    ]
    unassigned = (
        session.scalar(
            sa.select(sa.func.count()).where(
                active, ~sa.exists().where(project_pics.c.project_id == Project.id)
            )
        )
        or 0
    )
    return Summary(
        total=sum(by_category.values()),
        by_category=by_category,
        by_deadline_status=by_status,
        by_pic=by_pic,
        unassigned=unassigned,
    )
