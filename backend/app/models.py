import enum
import uuid
from datetime import date, datetime

import sqlalchemy as sa
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

MIN_DATE = date(2000, 1, 1)
MAX_DATE = date(2100, 12, 31)


class Base(DeclarativeBase):
    pass


class Category(enum.StrEnum):
    current = "current"
    pending = "pending"
    maintenance = "maintenance"


DATE_COLUMNS = ("plan_date", "adjusted_plan_date", "actual_date", "projected_start_date")


def _date_check(col: str) -> sa.CheckConstraint:
    return sa.CheckConstraint(
        f"{col} IS NULL OR {col} BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'",
        name=f"ck_projects_{col}_range",
    )


project_pics = sa.Table(
    "project_pics",
    Base.metadata,
    sa.Column(
        "project_id", sa.Uuid, sa.ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    ),
    sa.Column(
        "person_id", sa.Uuid, sa.ForeignKey("persons.id", ondelete="RESTRICT"), primary_key=True
    ),
)


class Stage(Base):
    __tablename__ = "stages"

    id: Mapped[int] = mapped_column(sa.Integer, sa.Identity(), primary_key=True)
    name: Mapped[str] = mapped_column(sa.String(100), nullable=False, unique=True)
    sort_order: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="0")

    __table_args__ = (
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="ck_stages_name_not_blank"),
    )


class Person(Base):
    __tablename__ = "persons"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(sa.String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.true())

    __table_args__ = (
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="ck_persons_name_not_blank"),
        sa.Index("uq_persons_name_lower", sa.text("lower(name)"), unique=True),
    )


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    description: Mapped[str] = mapped_column(sa.Text, nullable=False, server_default="")
    category: Mapped[Category] = mapped_column(
        sa.Enum(
            Category,
            name="project_category",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )
    stage_id: Mapped[int] = mapped_column(sa.ForeignKey("stages.id"), nullable=False)
    status_notes: Mapped[str] = mapped_column(sa.Text, nullable=False, server_default="")
    ongoing_issue: Mapped[str] = mapped_column(sa.Text, nullable=False, server_default="")
    plan_date: Mapped[date | None] = mapped_column(sa.Date)
    adjusted_plan_date: Mapped[date | None] = mapped_column(sa.Date)
    actual_date: Mapped[date | None] = mapped_column(sa.Date)
    projected_start_date: Mapped[date | None] = mapped_column(sa.Date)
    deadline_note: Mapped[str] = mapped_column(sa.String(500), nullable=False, server_default="")
    # Manual order inside a category (gaps of 1000; rebalanced when a gap runs out).
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
        onupdate=sa.func.now(),
    )

    stage: Mapped[Stage] = relationship(lazy="joined")
    pics: Mapped[list[Person]] = relationship(
        secondary=project_pics, lazy="selectin", order_by=Person.name
    )

    __mapper_args__ = {"version_id_col": version}  # noqa: RUF012
    __table_args__ = (
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="ck_projects_name_not_blank"),
        sa.CheckConstraint("version >= 1", name="ck_projects_version_positive"),
        *(_date_check(c) for c in DATE_COLUMNS),
        sa.Index(
            "uq_projects_name_active",
            sa.text("lower(name)"),
            unique=True,
            postgresql_where=sa.text("deleted_at IS NULL"),
        ),
        sa.Index("ix_projects_category", "category"),
        sa.Index("ix_projects_category_position", "category", "position"),
        sa.Index("ix_projects_stage_id", "stage_id"),
        sa.Index("ix_projects_plan_date", "plan_date"),
        sa.Index("ix_projects_adjusted_plan_date", "adjusted_plan_date"),
        sa.Index("ix_projects_deleted_at", "deleted_at"),
    )


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(sa.BigInteger, sa.Identity(), primary_key=True)
    project_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    field: Mapped[str] = mapped_column(sa.String(100), nullable=False)
    old_value: Mapped[str | None] = mapped_column(sa.Text)
    new_value: Mapped[str | None] = mapped_column(sa.Text)
    changed_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )

    __table_args__ = (sa.Index("ix_activity_logs_project_changed", "project_id", "changed_at"),)
