"""«السجل» over MCP (stdio), exposed in the app as mcp__egx__<tool> for the Monos assistant."""

import functools

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from . import commands
from .errors import LedgerInputError

INSTRUCTIONS = """\
The user's ledger of assets in EGP («السجل»): read it, find assets, and add or edit purchases, prices
and movements (money transferred from one asset to another, or spent).
Every number comes from these tools; never compute values yourself.
Describe the numbers only: never buy, sell or hold advice. Confirm with the user before any change.
"""

server = MCPServer(name="egx", instructions=INSTRUCTIONS, version="0.2.0")


def tool(fn):
    """Register fn as an MCP tool, returning input errors to the model as readable tool errors."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except LedgerInputError as exc:
            raise ToolError(str(exc)) from exc

    return server.tool()(wrapper)


for _fn in commands.MCP_TOOLS:
    tool(_fn)


def main() -> None:
    server.run("stdio")


if __name__ == "__main__":
    main()
