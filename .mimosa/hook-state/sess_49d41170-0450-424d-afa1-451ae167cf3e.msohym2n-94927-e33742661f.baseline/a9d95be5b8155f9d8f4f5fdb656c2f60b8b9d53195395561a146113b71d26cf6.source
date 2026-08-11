#!/bin/bash
# Daily Triage Loop - Discovers and categorizes work items
# Run via: opencode run scripts/triage-discovery.sh

set -e

echo "=== Ledge Daily Triage Discovery ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# 1. Check recent git activity
echo "## Recent Commits (last 24h)"
git log --oneline --since="24 hours ago" 2>/dev/null || echo "No commits in last 24h"
echo ""

# 2. Check for open issues (requires gh CLI)
if command -v gh &> /dev/null; then
  echo "## Open Issues"
  gh issue list --state open --limit 10 2>/dev/null || echo "No gh access or no issues"
  echo ""
fi

# 3. Check for failing tests
echo "## Test Status"
if pnpm test 2>&1 | tail -5; then
  echo "Tests: PASSING"
else
  echo "Tests: FAILING"
fi
echo ""

# 4. Check for lint issues
echo "## Lint Status"
if pnpm lint 2>&1 | tail -3; then
  echo "Lint: PASSING"
else
  echo "Lint: ISSUES FOUND"
fi
echo ""

# 5. Check for outdated dependencies
echo "## Dependency Updates"
pnpm outdated 2>/dev/null | head -10 || echo "No outdated deps or pnpm outdated not available"
echo ""

# 6. Summary
echo "## Triage Summary"
echo "Discoveries logged to: loop-state.md"
echo "Next step: Run triage-categorize.sh to process findings"
