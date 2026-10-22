"""subtasks: tasks, task_pics, activity_logs.task_id

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

MAX_DEPTH = 3
DATE_COLUMNS = ("plan_date", "adjusted_plan_date", "actual_date")


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column(
            "project_id", sa.Uuid, sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("parent_id", sa.Uuid),
        sa.Column("depth", sa.Integer, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("notes", sa.Text, nullable=False, server_default=""),
        sa.Column("stage_id", sa.Integer, sa.ForeignKey("stages.id"), nullable=False),
        sa.Column("plan_date", sa.Date),
        sa.Column("adjusted_plan_date", sa.Date),
        sa.Column("actual_date", sa.Date),
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("id", "project_id", name="uq_tasks_id_project"),
        sa.ForeignKeyConstraint(
            ["parent_id", "project_id"],
            ["tasks.id", "tasks.project_id"],
            name="fk_tasks_parent_same_project",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="ck_tasks_name_not_blank"),
        sa.CheckConstraint("version >= 1", name="ck_tasks_version_positive"),
        sa.CheckConstraint(f"depth BETWEEN 1 AND {MAX_DEPTH}", name="ck_tasks_depth_range"),
        sa.CheckConstraint("(parent_id IS NULL) = (depth = 1)", name="ck_tasks_depth_root"),
        sa.CheckConstraint("parent_id IS NULL OR parent_id <> id", name="ck_tasks_not_own_parent"),
        *(
            sa.CheckConstraint(
                f"{c} IS NULL OR {c} BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'",
                name=f"ck_tasks_{c}_range",
            )
            for c in DATE_COLUMNS
        ),
    )
    op.create_index(
        "ix_tasks_project_parent_position", "tasks", ["project_id", "parent_id", "position"]
    )
    op.create_index("ix_tasks_parent_id", "tasks", ["parent_id"])
    op.create_index("ix_tasks_stage_id", "tasks", ["stage_id"])
    op.create_index("ix_tasks_plan_date", "tasks", ["plan_date"])
    op.create_index("ix_tasks_deleted_at", "tasks", ["deleted_at"])

    # depth = parent depth + 1, checked at commit so a subtree can be moved row by row.
    # Fires for the changed row (against its parent) and for its children (when the depth
    # of a parent changes). Together with the depth CHECKs this also rules out cycles.
    op.execute(
        """
        CREATE FUNCTION tasks_check_depth() RETURNS trigger AS $$
        DECLARE parent_depth integer;
        BEGIN
          IF NEW.parent_id IS NOT NULL THEN
            SELECT depth INTO parent_depth FROM tasks WHERE id = NEW.parent_id;
            IF parent_depth IS NULL OR NEW.depth <> parent_depth + 1 THEN
              RAISE EXCEPTION 'task depth must be its parent''s depth + 1'
                USING ERRCODE = 'check_violation', CONSTRAINT = 'ck_tasks_depth_parent';
            END IF;
          END IF;
          IF EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = NEW.id AND c.depth <> NEW.depth + 1)
          THEN
            RAISE EXCEPTION 'task depth must be its parent''s depth + 1'
              USING ERRCODE = 'check_violation', CONSTRAINT = 'ck_tasks_depth_parent';
          END IF;
          RETURN NULL;
        END
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER trg_tasks_depth
        AFTER INSERT OR UPDATE OF parent_id, depth ON tasks
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION tasks_check_depth()
        """
    )

    op.create_table(
        "task_pics",
        sa.Column(
            "task_id", sa.Uuid, sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column(
            "person_id", sa.Uuid, sa.ForeignKey("persons.id", ondelete="RESTRICT"), primary_key=True
        ),
    )
    op.create_index("ix_task_pics_person_id", "task_pics", ["person_id"])

    # Existing history rows describe projects, so they keep task_id = NULL.
    op.add_column(
        "activity_logs",
        sa.Column("task_id", sa.Uuid, sa.ForeignKey("tasks.id", ondelete="CASCADE")),
    )
    op.create_index("ix_activity_logs_task_id", "activity_logs", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_activity_logs_task_id", table_name="activity_logs")
    op.drop_column("activity_logs", "task_id")
    op.drop_table("task_pics")
    op.execute("DROP TRIGGER IF EXISTS trg_tasks_depth ON tasks")
    op.execute("DROP FUNCTION IF EXISTS tasks_check_depth()")
    op.drop_table("tasks")
