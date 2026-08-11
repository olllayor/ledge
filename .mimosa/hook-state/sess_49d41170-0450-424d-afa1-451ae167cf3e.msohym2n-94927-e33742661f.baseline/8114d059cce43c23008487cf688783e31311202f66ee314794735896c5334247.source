#!/bin/bash
# Verification Loop - Checks implementation against specs
# Run via: opencode run scripts/verify-implementation.sh [branch-name]

set -e

BRANCH=${1:-$(git branch --show-current)}
STATE_FILE="loop-state.md"

echo "=== Implementation Verification ==="
echo "Branch: $BRANCH"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

PASS=true

# 1. TypeScript check
echo "## 1. TypeScript Check"
if pnpm lint 2>&1; then
  echo "✅ TypeScript: PASS"
else
  echo "❌ TypeScript: FAIL"
  PASS=false
fi
echo ""

# 2. Unit tests
echo "## 2. Unit Tests"
if pnpm test 2>&1; then
  echo "✅ Tests: PASS"
else
  echo "❌ Tests: FAIL"
  PASS=false
fi
echo ""

# 3. Build check
echo "## 3. Build Check"
if pnpm build 2>&1 | tail -3; then
  echo "✅ Build: PASS"
else
  echo "❌ Build: FAIL"
  PASS=false
fi
echo ""

# 4. Check for uncommitted changes
echo "## 4. Clean Working Tree"
if git diff --quiet && git diff --cached --quiet; then
  echo "✅ Working tree: CLEAN"
else
  echo "⚠️  Working tree: DIRTY (uncommitted changes)"
fi
echo ""

# 5. Branch comparison
echo "## 5. Branch Diff"
DIFFSTAT=$(git diff main..HEAD --stat 2>/dev/null | tail -1 || echo "No diff available")
echo "$DIFFSTAT"
echo ""

# 6. Summary
echo "## Verification Summary"
if [ "$PASS" = true ]; then
  echo "✅ VERIFICATION: PASS"
  echo "Status: Ready for review/merge"
else
  echo "❌ VERIFICATION: FAIL"
  echo "Status: Needs fixes before merge"
fi

# Update state file
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ -f "$STATE_FILE" ]; then
  echo "" >> "$STATE_FILE"
  echo "## Verify Run: $TIMESTAMP" >> "$STATE_FILE"
  echo "- Branch: $BRANCH" >> "$STATE_FILE"
  echo "- Result: $([ "$PASS" = true ] && echo 'PASS' || echo 'FAIL')" >> "$STATE_FILE"
fi
