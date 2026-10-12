"""
MCP (Model Context Protocol) server for the forecast model.

Lets an AI coding assistant (Claude Code, Codex, any MCP client) read and
change the model through the same operations the web UI uses. See
``documentation/mcp_server_guide.md`` for setup and the tool catalog.

Usage from the FastAPI app::

    from mcp_server import mcp_lifespan, mount_mcp
    mount_mcp(app)                      # serves streamable HTTP at /mcp
    # and inside the app lifespan:
    async with mcp_lifespan():
        yield
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional

from starlette.responses import PlainTextResponse
from starlette.routing import Mount, Route

from mcp_server.core import TRANSPORT_SECURITY, mcp, set_app
import mcp_server.tools  # noqa: F401  (registers the tools)

MCP_PATH = "/mcp"

# The SDK's streamable-HTTP transport for the current app lifespan. A
# session manager runs once, so the transport is built on every lifespan
# start (production starts once; the test suite starts one app per test).
_transport: Optional[Any] = None


class _Dispatch:
    """ASGI entry for ``/mcp`` and ``/mcp/``: forward to the live transport.

    The transport routes on ``/``. Serving the exact path here (instead of
    only a mount) avoids Starlette's 307 to ``/mcp/``, which not every MCP
    client follows on POST. A class rather than a function so Starlette
    treats it as a raw ASGI app (all methods) instead of a GET endpoint.
    """

    async def __call__(self, scope, receive, send) -> None:
        if _transport is None:
            await PlainTextResponse("MCP server is starting", status_code=503)(scope, receive, send)
            return
        if scope["type"] == "http":
            scope = dict(scope, path="/", raw_path=b"/")
        await _transport(scope, receive, send)


_dispatch = _Dispatch()


@asynccontextmanager
async def mcp_lifespan() -> AsyncIterator[None]:
    """Run the MCP transport for the life of the FastAPI app."""
    global _transport
    _transport = mcp.streamable_http_app(
        streamable_http_path="/",      # served at /mcp by the FastAPI app
        json_response=True,
        stateless_http=True,
        transport_security=TRANSPORT_SECURITY,
    )
    try:
        async with mcp.session_manager.run():
            yield
    finally:
        _transport = None


def mount_mcp(fastapi_app) -> None:
    """Attach the MCP server to a FastAPI app at ``/mcp`` (and ``/mcp/``).

    The tools call the app in-process, so ``fastapi_app`` must be the app
    whose routes are the real API (the one that owns the database). The
    app's lifespan must run ``mcp_lifespan``.
    """
    set_app(fastapi_app)
    fastapi_app.router.routes.append(Route(MCP_PATH, endpoint=_dispatch, name="mcp"))
    fastapi_app.router.routes.append(Mount(MCP_PATH, app=_dispatch, name="mcp-mount"))


__all__ = ["mcp", "mcp_lifespan", "mount_mcp", "MCP_PATH"]
