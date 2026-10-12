"""
Start the API from the repository root:

    python main.py                 # http://localhost:8000 (PORT / HOST to change)
    uvicorn main:app               # same app, any uvicorn options

The backend imports its packages (db, api, services, ...) as top-level
modules, so app/ is put on the import path first. Unless DATABASE_PATH or
DATA_DIR is set, the database is <repo>/data/forecast.db, the same file
scripts/run_local.py and Docker (./data mounted at /data) use.
"""
import os
import sys

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(REPO_ROOT, "app")
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)
if not os.getenv("DATABASE_PATH") and not os.getenv("DATA_DIR"):
    os.environ["DATABASE_PATH"] = os.path.join(REPO_ROOT, "data", "forecast.db")

from app.main import app  # noqa: E402

if __name__ == "__main__":
    import uvicorn
    print("Starting server...")
    uvicorn.run(app, host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", "8000")))
