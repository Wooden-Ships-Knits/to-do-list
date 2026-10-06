"""initial schema

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

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
DATE_COLUMNS = ("plan_date", "adjusted_plan_date", "actual_date", "projected_start_date")


def upgrade() -> None:
    category = postgresql.ENUM("current", "pending", "maintenance", name="project_category")
    category.create(op.get_bind(), checkfirst=True)

    stages = op.create_table(
        "stages",
        sa.Column("id", sa.Integer, sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="ck_stages_name_not_blank"),
    )
    op.bulk_insert(stages, [{"name": n, "sort_order": i} for i, n in enumerate(STAGES, start=1)])

    op.create_table(
        "persons",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="ck_persons_name_not_blank"),
    )
    op.create_index("uq_persons_name_lower", "persons", [sa.text("lower(name)")], unique=True)

    op.create_table(
        "projects",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column(
            "category",
            postgresql.ENUM(name="project_category", create_type=False),
            nullable=False,
        ),
        sa.Column("stage_id", sa.Integer, sa.ForeignKey("stages.id"), nullable=False),
        sa.Column("status_notes", sa.Text, nullable=False, server_default=""),
        sa.Column("ongoing_issue", sa.Text, nullable=False, server_default=""),
        sa.Column("plan_date", sa.Date),
        sa.Column("adjusted_plan_date", sa.Date),
        sa.Column("actual_date", sa.Date),
        sa.Column("projected_start_date", sa.Date),
        sa.Column("deadline_note", sa.String(500), nullable=False, server_default=""),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="ck_projects_name_not_blank"),
        sa.CheckConstraint("version >= 1", name="ck_projects_version_positive"),
        *(
            sa.CheckConstraint(
                f"{c} IS NULL OR {c} BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'",
                name=f"ck_projects_{c}_range",
            )
            for c in DATE_COLUMNS
        ),
    )
    op.create_index(
        "uq_projects_name_active",
        "projects",
        [sa.text("lower(name)")],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index("ix_projects_category", "projects", ["category"])
    op.create_index("ix_projects_stage_id", "projects", ["stage_id"])
    op.create_index("ix_projects_plan_date", "projects", ["plan_date"])
    op.create_index("ix_projects_adjusted_plan_date", "projects", ["adjusted_plan_date"])
    op.create_index("ix_projects_deleted_at", "projects", ["deleted_at"])

    op.create_table(
        "project_pics",
        sa.Column(
            "project_id",
            sa.Uuid,
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "person_id", sa.Uuid, sa.ForeignKey("persons.id", ondelete="RESTRICT"), primary_key=True
        ),
    )
    op.create_index("ix_project_pics_person_id", "project_pics", ["person_id"])

    op.create_table(
        "activity_logs",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        sa.Column(
            "project_id", sa.Uuid, sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("field", sa.String(100), nullable=False),
        sa.Column("old_value", sa.Text),
        sa.Column("new_value", sa.Text),
        sa.Column(
            "changed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index(
        "ix_activity_logs_project_changed", "activity_logs", ["project_id", "changed_at"]
    )


def downgrade() -> None:
    op.drop_table("activity_logs")
    op.drop_table("project_pics")
    op.drop_table("projects")
    op.drop_table("persons")
    op.drop_table("stages")
    postgresql.ENUM(name="project_category").drop(op.get_bind(), checkfirst=True)
