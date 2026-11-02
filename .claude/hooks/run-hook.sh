#!/usr/bin/env bash
# Run a Node hook from .claude/hooks/, failing closed.
#
# Hooks exit 0 (allow) or 2 (block). Any other exit (node missing, the hook
# file missing, a crash, malformed input) becomes 2, so a broken fence
# blocks the edit instead of silently letting it through. Lesson from
# patrimoni: its guard errored in a checkout without the venv and let every
# edit through. Copied from target-watch.
hook="$1"
node "$CLAUDE_PROJECT_DIR/.claude/hooks/$hook"
rc=$?
if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; then
  echo "Hook $hook could not run (exit $rc); blocking to fail closed." >&2
  exit 2
fi
exit "$rc"
