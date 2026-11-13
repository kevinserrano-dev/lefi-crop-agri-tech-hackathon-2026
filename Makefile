# Lefi Crop AI — developer entry points. Day-to-day operation: `lefi help`. Guide: README.md.
.PHONY: help setup check doctor dry-run cli lint-shell test-shell brain-check sim-check robot-sim-check

help:
	@echo "make setup       Interactive installer (choose AI / core / admin roles)"
	@echo "make check       Verify everything installed on this machine"
	@echo "make dry-run     Show what the installer would do, change nothing"
	@echo "make cli         Install the 'lefi' command globally"
	@echo "make lint-shell  shellcheck the installer and CLI"
	@echo "make test-shell  Installer library tests (hardware scan, recommender, answers, events)"
	@echo "make brain-check Brain: ruff, format, mypy --strict, import-linter, pytest"
	@echo "make sim-check   Greenhouse simulator: ruff, format, mypy --strict, pytest"
	@echo "make robot-sim-check  MH3 simulation bridge: ruff, format, mypy --strict, pytest"

setup:
	@./scripts/install.sh

check doctor:
	@./scripts/install.sh --check

dry-run:
	@./scripts/install.sh --dry-run

cli:
	@./bin/lefi cli install

lint-shell:
	@shellcheck bin/lefi scripts/install.sh scripts/lib/*.sh scripts/cli/*.sh scripts/tests/*.sh scripts/dev/*.sh \
		simulators/robot-mh3/*.sh

test-shell:
	@./scripts/tests/run.sh

brain-check:
	@cd services/brain && uv sync --locked -q && uv run ruff check . && uv run ruff format --check . \
		&& uv run mypy && uv run lint-imports && uv run pytest

sim-check:
	@cd simulators/greenhouse && uv sync --locked -q && uv run ruff check . && uv run ruff format --check . \
		&& uv run mypy && uv run pytest

robot-sim-check:
	@cd simulators/robot-mh3 && uv sync --locked -q && uv run ruff check . && uv run ruff format --check . \
		&& uv run mypy && uv run pytest
