"""manual order: projects.position

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("position", sa.Integer, nullable=True))
    # Backfill in the current order: creation order (the first activity-log row of each
    # project follows the insert order, which is the seed order), then created_at, then name.
    op.execute(
        """
        UPDATE projects p SET position = r.n * 1000
        FROM (
          SELECT pr.id,
                 row_number() OVER (
                   PARTITION BY pr.category
                   ORDER BY
                     COALESCE((SELECT min(a.id) FROM activity_logs a
                               WHERE a.project_id = pr.id AND a.field = 'project'),
                              9223372036854775807),
                     pr.created_at, pr.name
                 ) AS n
          FROM projects pr
        ) r
        WHERE p.id = r.id
        """
    )
    op.alter_column("projects", "position", nullable=False)
    op.create_index("ix_projects_category_position", "projects", ["category", "position"])


def downgrade() -> None:
    op.drop_index("ix_projects_category_position", table_name="projects")
    op.drop_column("projects", "position")
