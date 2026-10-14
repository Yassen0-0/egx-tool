class ValuationInputError(ValueError):
    """Raised when inputs make a calculation meaningless (e.g. discount rate <= growth).

    The MCP server turns it into a ToolError so the model reads the message and can fix its inputs.
    """
