# Known Issues

- Issue: Secrets committed to repo (.env files)
  - Details: Both `.env` (root) and `app/.env` contain real `OPENAI_API_KEY` values that are checked into version control.
  - Impact: Critical security risk; potential unauthorized API usage and account compromise.
  - Evidence: `.env` and `app/.env` contain API keys in plaintext.
  - Fix:
    - Immediately revoke and rotate the exposed keys.
    - Remove secrets from history (e.g., using `git filter-repo` or BFG) and force-push.
    - Keep `.env` files untracked; load secrets from environment or Docker compose, not from committed files.

- Issue: Invalid CORS configuration with credentials and wildcard origin
  - Details: `app/main.py` sets `allow_credentials=True` while including `"*"` in `allow_origins`.
  - Impact: Starlette/FastAPI rejects this per CORS spec, causing startup/runtime errors; browsers will not accept wildcard with credentials.
  - Evidence: `app/main.py` CORS middleware includes `"*"` in `allow_origins`.
  - Fix:
    - Remove `"*"` and specify explicit origins (e.g., `http://localhost:3000`, `http://frontend:3000`).
    - Or set `allow_credentials=False` if you must use wildcard (not recommended).

- Issue: Virtual environment committed to source control (`app/venv/`)
  - Details: A full Python virtualenv is present under `app/venv/` and will be copied into Docker images.
  - Impact: Bloats the repository and images; introduces OS-specific binaries; risks path confusion.
  - Evidence: `app/venv/` directory with platform-specific executables is in the repo.
  - Fix:
    - Remove `app/venv/` from the repository and history.
    - Add `app/venv/` to `.gitignore` (root pattern `venv/` does not cover nested `app/venv/`).
    - Rely on `requirements.txt` and per-environment venvs instead.

