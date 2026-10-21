class LedgerInputError(ValueError):
    """An input the ledger cannot use (an unknown asset, a non-positive price, a bad date).

    The message is in Arabic: the screen shows it as it is, and the MCP server turns it into a
    ToolError so the assistant can read it and ask the user again.
    """
