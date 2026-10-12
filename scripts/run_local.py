#!/usr/bin/env python3
"""
Local development runner for the Forecast API.

    python scripts/run_local.py                       # http://localhost:8000, auto-reload
    python scripts/run_local.py --port 8001 --no-reload

Runs uvicorn on app/main.py (with app/ on the import path, as the backend
expects) from the repository root. Unless DATABASE_PATH or DATA_DIR is set,
the database is <repo>/data/forecast.db - the same file Docker mounts at
/data/forecast.db and `python main.py` uses - whatever directory you start
from.
"""

import argparse
import os
import subprocess
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))
APP_DIR = os.path.join(REPO_ROOT, "app")


def build_command(host: str, port: int, reload: bool) -> list:
    cmd = [
        sys.executable, "-m", "uvicorn", "main:app",
        "--app-dir", APP_DIR,
        "--host", host,
        "--port", str(port),
    ]
    if reload:
        # Watch the backend only (not frontend/node_modules).
        cmd += ["--reload", "--reload-dir", APP_DIR]
    return cmd


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Run the Forecast API locally")
    # No login: listen on this machine only unless --host / HOST says otherwise.
    parser.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8000")))
    parser.add_argument("--no-reload", action="store_true", help="do not restart on code changes")
    args = parser.parse_args(argv)

    if not os.path.isfile(os.path.join(APP_DIR, "main.py")):
        print(f"Cannot find the backend at {APP_DIR}/main.py", file=sys.stderr)
        return 1

    env = dict(os.environ)
    if not env.get("DATABASE_PATH") and not env.get("DATA_DIR"):
        env["DATABASE_PATH"] = os.path.join(REPO_ROOT, "data", "forecast.db")

    cmd = build_command(args.host, args.port, not args.no_reload)
    print("Starting Forecast API locally")
    print(f"  app directory: {APP_DIR}")
    print(f"  database:      {env.get('DATABASE_PATH') or os.path.join(env['DATA_DIR'], 'forecast.db')}")
    print(f"  running:       {' '.join(cmd)}")
    print()

    try:
        return subprocess.run(cmd, cwd=REPO_ROOT, env=env).returncode
    except KeyboardInterrupt:
        print("\nShutting down...")
        return 0


if __name__ == "__main__":
    sys.exit(main())
