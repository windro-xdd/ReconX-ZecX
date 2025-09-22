from alembic import op
import sqlalchemy as sa
import sqlalchemy.dialects.postgresql as psql

# revision identifiers, used by Alembic.
revision = '0001_initial'
down_revision = None
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        'recon_jobs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('type', sa.String(length=32), index=True, nullable=False),
        sa.Column('params', psql.JSONB(), nullable=False),
        sa.Column('state', sa.Enum('queued','running','paused','cancelled','completed','failed', name='jobstate'), index=True, nullable=False, server_default='queued'),
        sa.Column('progress', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('project', sa.String(length=64), server_default='default', index=True, nullable=False),
        sa.Column('org_user', sa.String(length=64), server_default='anon', nullable=False),
    )
    op.create_index('ix_jobs_project_type_state', 'recon_jobs', ['project','type','state'])

    op.create_table(
        'recon_findings',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('job_id', sa.Integer(), sa.ForeignKey('recon_jobs.id', ondelete='CASCADE'), index=True, nullable=False),
        sa.Column('kind', sa.String(length=32), index=True, nullable=False),
        sa.Column('data', psql.JSONB(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_findings_job_kind', 'recon_findings', ['job_id','kind'])


def downgrade() -> None:
    op.drop_index('ix_findings_job_kind', table_name='recon_findings')
    op.drop_table('recon_findings')
    op.drop_index('ix_jobs_project_type_state', table_name='recon_jobs')
    op.drop_table('recon_jobs')
    op.execute("DROP TYPE IF EXISTS jobstate")
