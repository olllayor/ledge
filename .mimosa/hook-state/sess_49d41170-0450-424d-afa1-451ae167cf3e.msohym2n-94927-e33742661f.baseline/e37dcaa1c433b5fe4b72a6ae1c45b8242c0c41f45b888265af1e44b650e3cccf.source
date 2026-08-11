#!/bin/bash
# Bug Hunter - Scans codebase for minor bugs and creates GitHub issues
# Run via: bash .opencode/loops/hunt-bugs.sh [--dry-run]

set -e

DRY_RUN=false
if [ "$1" = "--dry-run" ]; then
  DRY_RUN=true
  echo "=== DRY RUN MODE ==="
  echo "Issues will be reported but NOT created."
  echo ""
fi

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "unknown")
STATE_FILE="loop-state.md"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ISSUES_CREATED=0

echo "=== Bug Hunter Scan ==="
echo "Repository: $REPO"
echo "Timestamp: $TIMESTAMP"
echo ""

# 1. Find console.log statements
echo "━━━ 1. Console.log Statements ━━━"
CONSOLE_LOGS=$(rg "console\.log" src/ --line-number 2>/dev/null || true)
if [ -n "$CONSOLE_LOGS" ]; then
  echo "$CONSOLE_LOGS"
  echo ""
  
  if [ "$DRY_RUN" = false ]; then
    # Check if issue already exists
    EXISTING=$(gh issue list --search "console.log production" --json number --limit 1 2>/dev/null || echo "[]")
    if [ "$EXISTING" = "[]" ]; then
      echo "Creating issue for console.log statements..."
      gh issue create \
        --title "[Bug] console.log statements in production code" \
        --body "Found console.log statements that should be removed before production:

$(echo "$CONSOLE_LOGS" | sed 's/^/- /')

These should be replaced with proper logging or removed entirely." \
        --label "bug" 2>&1
      ISSUES_CREATED=$((ISSUES_CREATED + 1))
    else
      echo "Issue already exists, skipping."
    fi
  fi
else
  echo "✅ No console.log statements found."
fi
echo ""

# 2. Find TODO/FIXME/HACK comments
echo "━━━ 2. TODO/FIXME/HACK Comments ━━━"
TODOS=$(rg "TODO|FIXME|HACK|XXX" src/ --line-number -i 2>/dev/null || true)
if [ -n "$TODOS" ]; then
  echo "$TODOS"
  echo ""
  
  if [ "$DRY_RUN" = false ]; then
    EXISTING=$(gh issue list --search "TODO FIXME" --json number --limit 1 2>/dev/null || echo "[]")
    if [ "$EXISTING" = "[]" ]; then
      echo "Creating issue for TODO/FIXME comments..."
      gh issue create \
        --title "[Tech Debt] TODO/FIXME comments requiring attention" \
        --body "Found TODO/FIXME/HACK comments that may need resolution:

$(echo "$TODOS" | sed 's/^/- /')

Review these and create separate issues for any that should be addressed." \
        --label "enhancement" 2>&1
      ISSUES_CREATED=$((ISSUES_CREATED + 1))
    else
      echo "Issue already exists, skipping."
    fi
  fi
else
  echo "✅ No TODO/FIXME/HACK comments found."
fi
echo ""

# 3. Find any types
echo "━━━ 3. Type Safety Issues ━━━"
ANY_TYPES=$(rg ":\s*any\b" src/ --line-number 2>/dev/null || true)
if [ -n "$ANY_TYPES" ]; then
  echo "$ANY_TYPES" | head -20
  TOTAL=$(echo "$ANY_TYPES" | wc -l)
  if [ "$TOTAL" -gt 20 ]; then
    echo "... and $((TOTAL - 20)) more"
  fi
  echo ""
  
  if [ "$DRY_RUN" = false ] && [ "$TOTAL" -gt 5 ]; then
    EXISTING=$(gh issue list --search "type any" --json number --limit 1 2>/dev/null || echo "[]")
    if [ "$EXISTING" = "[]" ]; then
      echo "Creating issue for type safety..."
      gh issue create \
        --title "[Tech Debt] Reduce usage of 'any' type ($TOTAL occurrences)" \
        --body "Found $TOTAL occurrences of ': any' type in src/. This reduces type safety and should be gradually reduced.

Top 20 occurrences:
$(echo "$ANY_TYPES" | head -20 | sed 's/^/- /')

Consider replacing with proper types or 'unknown' where appropriate." \
        --label "tech-debt" 2>&1
      ISSUES_CREATED=$((ISSUES_CREATED + 1))
    else
      echo "Issue already exists, skipping."
    fi
  fi
else
  echo "✅ No 'any' type usage found."
fi
echo ""

# 4. Find empty catch blocks
echo "━━━ 4. Empty Catch Blocks ━━━"
EMPTY_CATCH=$(rg "catch\s*\([^)]*\)\s*\{\s*\}" src/ --line-number -U 2>/dev/null || true)
if [ -n "$EMPTY_CATCH" ]; then
  echo "$EMPTY_CATCH"
  echo ""
  
  if [ "$DRY_RUN" = false ]; then
    EXISTING=$(gh issue list --search "empty catch" --json number --limit 1 2>/dev/null || echo "[]")
    if [ "$EXISTING" = "[]" ]; then
      echo "Creating issue for empty catch blocks..."
      gh issue create \
        --title "[Bug] Empty catch blocks swallow errors silently" \
        --body "Found empty catch blocks that swallow errors without logging or handling:

$(echo "$EMPTY_CATCH" | sed 's/^/- /')

These should at minimum log the error for debugging purposes." \
        --label "bug" 2>&1
      ISSUES_CREATED=$((ISSUES_CREATED + 1))
    else
      echo "Issue already exists, skipping."
    fi
  fi
else
  echo "✅ No empty catch blocks found."
fi
echo ""

# Summary
echo "━━━ Summary ━━━"
echo "Scan completed at: $TIMESTAMP"
echo "Issues created: $ISSUES_CREATED"
echo ""

# Update loop-state.md
if [ -f "$STATE_FILE" ]; then
  echo "" >> "$STATE_FILE"
  echo "## Bug Hunter Run: $TIMESTAMP" >> "$STATE_FILE"
  echo "- Console.log: $(echo "$CONSOLE_LOGS" | grep -c . || echo 0) found" >> "$STATE_FILE"
  echo "- TODO/FIXME: $(echo "$TODOS" | grep -c . || echo 0) found" >> "$STATE_FILE"
  echo "- Any types: $(echo "$ANY_TYPES" | grep -c . || echo 0) found" >> "$STATE_FILE"
  echo "- Empty catch: $(echo "$EMPTY_CATCH" | grep -c . || echo 0) found" >> "$STATE_FILE"
  echo "- Issues created: $ISSUES_CREATED" >> "$STATE_FILE"
fi
