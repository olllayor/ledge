#!/bin/bash
# Triage Categorize - Processes discoveries and updates loop-state.md
# Run via: opencode run scripts/triage-categorize.sh

set -e

STATE_FILE="loop-state.md"

echo "=== Triage Categorization ==="

# Read current state or create new
if [ ! -f "$STATE_FILE" ]; then
  cat > "$STATE_FILE" << 'EOF'
# Loop State

## Last Run
- Never

## Findings
_None yet._

## In Progress
_None._

## Completed
_None._

## Blocked
_None._

## Metrics
- Runs: 0
- Issues Fixed: 0
- Tokens Used: 0
EOF
fi

# Append new triage entry
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat >> "$STATE_FILE" << EOF

---

## Triage Run: $TIMESTAMP

### Status
- [ ] CI check
- [ ] Test check
- [ ] Lint check
- [ ] Issue review
- [ ] Dependency review

### Findings
_Agent will populate after running triage-discovery.sh_

### Action Items
_Agent will categorize findings into:_
- **Quick Fix** (< 30min)
- **Feature** (new work)
- **Bug** (needs investigation)
- **Tech Debt** (refactor/improve)
- **Blocked** (needs human decision)
EOF

echo "Updated $STATE_FILE with new triage entry"
echo "Timestamp: $TIMESTAMP"
echo ""
echo "Next: Run the loop with opencode to populate findings"
