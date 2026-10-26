"""logins and priority: users, sessions, activity_logs.actor_id, created_by_id, priority

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

PRIORITY = postgresql.ENUM("urgent", "high", "normal", "low", name="priority_level")


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("username", sa.String(50), nullable=False),
        sa.Column(
            "person_id",
            sa.Uuid,
            sa.ForeignKey("persons.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("is_admin", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("must_change_password", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("password_changed_at", sa.DateTime(timezone=True)),
        sa.Column("last_login_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("username ~ '^[a-z0-9._-]+$'", name="ck_users_username_format"),
    )
    op.create_index("uq_users_username_lower", "users", [sa.text("lower(username)")], unique=True)

    op.create_table(
        "sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])

    # Existing rows were written before logins existed: actor and creator stay NULL
    # ("Unknown"), and nothing had a priority yet.
    op.add_column(
        "activity_logs",
        sa.Column("actor_id", sa.Uuid, sa.ForeignKey("users.id", ondelete="SET NULL")),
    )
    op.create_index("ix_activity_logs_actor_id", "activity_logs", ["actor_id"])

    PRIORITY.create(op.get_bind())
    for table in ("projects", "tasks"):
        op.add_column(
            table,
            sa.Column("created_by_id", sa.Uuid, sa.ForeignKey("users.id", ondelete="SET NULL")),
        )
        op.add_column(
            table, sa.Column("priority", postgresql.ENUM(name="priority_level", create_type=False))
        )
        op.create_index(f"ix_{table}_priority", table, ["priority"])


def downgrade() -> None:
    for table in ("tasks", "projects"):
        op.drop_index(f"ix_{table}_priority", table_name=table)
        op.drop_column(table, "priority")
        op.drop_column(table, "created_by_id")
    PRIORITY.drop(op.get_bind())
    op.drop_index("ix_activity_logs_actor_id", table_name="activity_logs")
    op.drop_column("activity_logs", "actor_id")
    op.drop_table("sessions")
    op.drop_table("users")
