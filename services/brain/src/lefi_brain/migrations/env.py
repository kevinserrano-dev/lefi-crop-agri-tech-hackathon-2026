"""Alembic environment. The URL comes from `core.migrations.alembic_config` or, when the
`alembic` CLI is used by a developer, from the Brain settings."""

from __future__ import annotations

from alembic import context

from lefi_brain.core.db import Base, make_sync_engine
from lefi_brain.models import import_all_models

import_all_models()
target_metadata = Base.metadata

config = context.config


def _database_url() -> str:
    configured = config.get_main_option("lefi.database_url")
    if configured:
        return configured
    from lefi_brain.core.config import load_settings

    return load_settings().resolved_database_url


url = _database_url()


def run_offline() -> None:
    from lefi_brain.core.db import sync_url

    context.configure(
        url=sync_url(url),
        target_metadata=target_metadata,
        literal_binds=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_online() -> None:
    engine = make_sync_engine(url)
    try:
        with engine.connect() as connection:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                render_as_batch=True,  # SQLite needs batch mode for ALTER TABLE
            )
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_offline()
else:
    run_online()
