#!/usr/bin/env python3
"""
Run the forecast MCP server over stdio.

Use this when the MCP client runs on the same machine as the model and you
do not want to go through the HTTP endpoint at http://localhost:8000/mcp.
It starts the FastAPI app in-process (no network port) and talks MCP on
stdin/stdout. Point it at the same database the web app uses with
DATABASE_PATH (or DATA_DIR); SQLite handles both processes sharing the file.

    DATABASE_PATH=./data/forecast.db python scripts/run_mcp_stdio.py

Prefer the HTTP endpoint when the app runs in Docker: the database lives
inside the container's /data volume and HTTP needs no path configuration.
"""
import io
import os
import sys

_APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, "app"))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)


def main() -> None:
    import logging

    # stdout carries the protocol. The app prints progress messages (database
    # init, some routes), so send everything that goes through sys.stdout to
    # stderr and give the transport the real stdout.
    real_stdout = io.TextIOWrapper(os.fdopen(os.dup(sys.stdout.fileno()), "wb", buffering=0), encoding="utf-8")
    sys.stdout = sys.stderr
    logging.basicConfig(level=os.getenv("MCP_LOG_LEVEL", "WARNING"), stream=sys.stderr)

    from db import initialize_database
    import main as api_main  # noqa: F401  (builds the FastAPI app and mounts the MCP server)
    from mcp_server import mcp

    initialize_database()

    import anyio
    from mcp.server.stdio import stdio_server

    async def serve() -> None:
        stdin = anyio.wrap_file(io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8"))
        stdout = anyio.wrap_file(real_stdout)
        async with stdio_server(stdin, stdout) as (read_stream, write_stream):
            # Same as MCPServer.run_stdio_async, with explicit streams.
            server = mcp._lowlevel_server
            await server.run(read_stream, write_stream, server.create_initialization_options())

    anyio.run(serve)


if __name__ == "__main__":
    main()
