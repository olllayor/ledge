#!/bin/bash
# Full Loop Runner - Executes the complete loop cycle
# Run via: opencode run scripts/run-loop.sh

set -e

STATE_FILE="loop-state.md"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "=== Ledge Loop Runner ==="
echo "Starting cycle: $TIMESTAMP"
echo ""

# Ensure loop-state.md exists
if [ ! -f "$STATE_FILE" ]; then
  echo "# Loop State" > "$STATE_FILE"
  echo "" >> "$STATE_FILE"
  echo "## Last Run" >> "$STATE_FILE"
  echo "- Never" >> "$STATE_FILE"
fi

# Phase 1: Discovery
echo "━━━ Phase 1: Discovery ━━━"
bash .opencode/loops/triage-discovery.sh
echo ""

# Phase 2: Categorize
echo "━━━ Phase 2: Categorize ━━━"
bash .opencode/loops/triage-categorize.sh
echo ""

# Phase 3: Verify current state
echo "━━━ Phase 3: Verify ━━━"
bash .opencode/loops/verify-implementation.sh 2>/dev/null || echo "Verification skipped (no branch context)"
echo ""

# Update last run timestamp
if [ -f "$STATE_FILE" ]; then
  sed -i '' "s/- Never/- $TIMESTAMP/" "$STATE_FILE" 2>/dev/null || \
  sed -i '' "s/- Never/- $TIMESTAMP/" "$STATE_FILE" 2>/dev/null
fi

echo "━━━ Loop Complete ━━━"
echo "Next steps:"
echo "1. Review loop-state.md for findings"
echo "2. Run opencode to process action items"
echo "3. Use /goal to implement fixes"
