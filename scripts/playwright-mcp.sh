#!/usr/bin/env bash
# Starts the Playwright MCP server (browser automation for Claude Code).
# In Claude Code cloud sessions it uses the pre-installed Chromium; elsewhere Playwright's own browser.
args=(--isolated)
if [ -x /opt/pw-browsers/chromium ]; then
  args+=(--headless --no-sandbox --executable-path /opt/pw-browsers/chromium)
fi
exec npx -y @playwright/mcp@latest "${args[@]}" "$@"
