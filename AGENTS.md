# Repository Guidelines

## Project Structure & Module Organization
- Backend: `app/` (FastAPI, routers in `app/api/`, DB in `app/db/`, services in `app/services/`). Entry: `app/main.py` (also `main.py` at repo root).
- Frontend: `frontend/` (React + CRA; source in `frontend/src/`).
- Tests: `tests/` (pytest), plus helper scripts in `scripts/`.
- Data & assets: `data/` (mounted via Docker), `documentation/`, `examples/`.

## Build, Test, and Development Commands
- Python setup: `pip install -r app/requirements.txt` (use `python -m venv .venv && source .venv/bin/activate`).
- Run backend (dev): `python main.py` (or `uvicorn app.main:app --reload`).
- Run frontend (dev): `cd frontend && npm install && npm run dev` (alias of `start`).
- Full stack (Docker): `docker-compose up --build` (services: API, frontend, Ollama, Whisper).
- Tests: `pytest -v` (examples: `pytest -m "unit"`, `pytest -m "not slow"`).

## Coding Style & Naming Conventions
- Python: PEP 8, 4-space indentation; snake_case for modules/functions, PascalCase for classes.
- FastAPI routers: group endpoints by domain in `app/api/*_routes.py`; prefer dependency-injected services.
- JavaScript/React: Follow CRA defaults; PascalCase component files, kebab-case asset names.
- Type hints in Python are required for new/modified functions; docstrings for public APIs.

## Testing Guidelines
- Framework: pytest (configured via `pytest.ini`). Test files: `tests/test_*.py`, classes `Test*`, functions `test_*`.
- Markers: `unit`, `integration`, `slow` (select with `-m`).
- Aim to cover API routes, services, and DB ops; add regression tests alongside fixes.

## Commit & Pull Request Guidelines
- Commit style: Prefer Conventional Commits (observed examples: `feat: ...`, `fix: ...`).
  - Examples: `feat: add filterable data queries`, `fix: preserve schema when loading csv data`.
- PRs: one topic per PR; include summary, linked issues, before/after screenshots for UI, and test notes.

## Security & Configuration Tips
- Secrets in `.env` (root and `app/.env`); never commit secrets. Configure CORS and ports in `app/main.py` and `docker-compose.yml`.
- Data volumes mount `./data`; verify file permissions before running in Docker.

## Agent-Specific Instructions
- Useful scripts: `python scripts/run_tests.py`, quick agent checks: `python scripts/test_agents_minimal.py`.
- When adding routes, register the router in `app/main.py` and add tests in `tests/`.

