#!/usr/bin/env bash
# validate-plugin.sh -- Validate the /preflight plugin for structural correctness.
#
# Checks:
#   1. All required files exist
#   2. plugin.json is valid JSON with required fields
#   3. hooks.json is valid JSON with correct structure
#   4. SKILL.md has valid YAML frontmatter
#   5. Agent .md files have valid YAML frontmatter with required fields
#   6. All .json data files are valid JSON
#   7. get-staged-diff.sh is executable
#   8. No broken file references
#   9. Total plugin size is reasonable (warn if > 500KB)
#  10. Test fixtures exist and have expected-findings comments
#
# Usage:
#   ./scripts/validate-plugin.sh
#
# Exit codes:
#   0  All checks passed
#   1  One or more checks failed

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve plugin root (parent directory of this script's directory)
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# Counters
# ---------------------------------------------------------------------------

PASS=0
FAIL=0
WARN=0

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

pass() {
    PASS=$((PASS + 1))
    printf '  \033[32mPASS\033[0m  %s\n' "$1"
}

fail() {
    FAIL=$((FAIL + 1))
    printf '  \033[31mFAIL\033[0m  %s\n' "$1"
}

warn() {
    WARN=$((WARN + 1))
    printf '  \033[33mWARN\033[0m  %s\n' "$1"
}

section() {
    printf '\n\033[1m[%s]\033[0m\n' "$1"
}

# ---------------------------------------------------------------------------
# Check: jq availability
# ---------------------------------------------------------------------------

HAS_JQ=0
if command -v jq >/dev/null 2>&1; then
    HAS_JQ=1
fi

# Validate JSON file using jq or python as fallback. Sets VALID_JSON=1/0.
validate_json() {
    local file="$1"
    VALID_JSON=0
    if [ ! -f "$file" ]; then
        return
    fi
    if [ "$HAS_JQ" -eq 1 ]; then
        if jq empty "$file" 2>/dev/null; then
            VALID_JSON=1
        fi
    elif command -v python3 >/dev/null 2>&1; then
        if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$file" 2>/dev/null; then
            VALID_JSON=1
        fi
    elif command -v python >/dev/null 2>&1; then
        if python -c "import json,sys; json.load(open(sys.argv[1]))" "$file" 2>/dev/null; then
            VALID_JSON=1
        fi
    else
        warn "Neither jq nor python available; skipping JSON validation for $file"
        VALID_JSON=1
    fi
}

# Extract a string field from a JSON file. Result in JSON_FIELD_VALUE.
json_field() {
    local file="$1"
    local field="$2"
    JSON_FIELD_VALUE=""
    if [ "$HAS_JQ" -eq 1 ]; then
        JSON_FIELD_VALUE="$(jq -r ".$field // empty" "$file" 2>/dev/null || true)"
    elif command -v python3 >/dev/null 2>&1; then
        JSON_FIELD_VALUE="$(python3 -c "
import json, sys
data = json.load(open(sys.argv[1]))
keys = sys.argv[2].split('.')
v = data
for k in keys:
    if isinstance(v, dict) and k in v:
        v = v[k]
    else:
        sys.exit(0)
print(v if isinstance(v, str) else '')
" "$file" "$field" 2>/dev/null || true)"
    fi
}

# Check if a JSON file has a top-level key. Sets HAS_KEY=1/0.
json_has_key() {
    local file="$1"
    local key="$2"
    HAS_KEY=0
    if [ "$HAS_JQ" -eq 1 ]; then
        if jq -e "has(\"$key\")" "$file" >/dev/null 2>&1; then
            HAS_KEY=1
        fi
    elif command -v python3 >/dev/null 2>&1; then
        if python3 -c "
import json, sys
data = json.load(open(sys.argv[1]))
sys.exit(0 if sys.argv[2] in data else 1)
" "$file" "$key" 2>/dev/null; then
            HAS_KEY=1
        fi
    fi
}

# Extract YAML frontmatter from a markdown file. Sets FRONTMATTER_VALID=1/0
# and populates FRONTMATTER_FIELDS (newline-separated key list).
validate_yaml_frontmatter() {
    local file="$1"
    FRONTMATTER_VALID=0
    FRONTMATTER_FIELDS=""

    if [ ! -f "$file" ]; then
        return
    fi

    # Check that the file starts with ---
    local first_line
    first_line="$(head -1 "$file")"
    if [ "$first_line" != "---" ]; then
        return
    fi

    # Extract frontmatter block (between first --- and second ---)
    local frontmatter
    frontmatter="$(awk 'NR==1 && /^---$/{found=1; next} found && /^---$/{exit} found{print}' "$file")"

    if [ -z "$frontmatter" ]; then
        return
    fi

    # Basic YAML validation: every non-empty, non-comment line should contain a colon
    # for top-level keys, or be indented continuation.
    local bad_lines=0
    while IFS= read -r line; do
        # Skip empty lines and comment lines
        [ -z "$line" ] && continue
        echo "$line" | grep -q '^\s*#' && continue
        # Indented lines (continuation of multiline values) are fine
        echo "$line" | grep -q '^\s' && continue
        # Top-level lines must have a colon
        if ! echo "$line" | grep -q ':'; then
            bad_lines=$((bad_lines + 1))
        fi
    done <<EOF
$frontmatter
EOF

    if [ "$bad_lines" -gt 0 ]; then
        return
    fi

    FRONTMATTER_VALID=1
    # Extract top-level field names
    FRONTMATTER_FIELDS="$(echo "$frontmatter" | grep -E '^[a-zA-Z]' | sed 's/:.*//' | tr -d ' ')"
}

# Check if a field name appears in FRONTMATTER_FIELDS
frontmatter_has_field() {
    echo "$FRONTMATTER_FIELDS" | grep -qx "$1" 2>/dev/null
}

# =========================================================================
# BEGIN CHECKS
# =========================================================================

printf '\033[1mPreflight Plugin Validator\033[0m\n'
printf 'Plugin root: %s\n' "$PLUGIN_ROOT"

# -------------------------------------------------------------------------
# 1. Required files exist
# -------------------------------------------------------------------------

section "1. Required Files"

REQUIRED_FILES=(
    ".claude-plugin/plugin.json"
    "hooks/hooks.json"
    "skills/preflight/SKILL.md"
    "skills/preflight/scripts/get-staged-diff.sh"
    "agents/bug-detector.md"
    "agents/security-scanner.md"
    "agents/test-gap-analyzer.md"
    "data/ai-failure-patterns.json"
    "data/deprecated-apis.json"
    "data/phantom-packages.json"
    "templates/report.md"
    ".claude/rules/preflight-conventions.md"
    "CLAUDE.md"
)

for rel_path in "${REQUIRED_FILES[@]}"; do
    if [ -f "$PLUGIN_ROOT/$rel_path" ]; then
        pass "$rel_path exists"
    else
        fail "$rel_path is missing"
    fi
done

# -------------------------------------------------------------------------
# 2. plugin.json is valid JSON with required fields
# -------------------------------------------------------------------------

section "2. plugin.json Validation"

PLUGIN_JSON="$PLUGIN_ROOT/.claude-plugin/plugin.json"

validate_json "$PLUGIN_JSON"
if [ "$VALID_JSON" -eq 1 ]; then
    pass "plugin.json is valid JSON"
else
    fail "plugin.json is NOT valid JSON"
fi

PLUGIN_REQUIRED_FIELDS=("name" "version" "description")
for field_name in "${PLUGIN_REQUIRED_FIELDS[@]}"; do
    json_field "$PLUGIN_JSON" "$field_name"
    if [ -n "$JSON_FIELD_VALUE" ]; then
        pass "plugin.json has '$field_name' field (value: $JSON_FIELD_VALUE)"
    else
        fail "plugin.json is missing required field '$field_name'"
    fi
done

# -------------------------------------------------------------------------
# 3. hooks.json is valid JSON with correct structure
# -------------------------------------------------------------------------

section "3. hooks.json Validation"

HOOKS_JSON="$PLUGIN_ROOT/hooks/hooks.json"

validate_json "$HOOKS_JSON"
if [ "$VALID_JSON" -eq 1 ]; then
    pass "hooks.json is valid JSON"
else
    fail "hooks.json is NOT valid JSON"
fi

# Check for required hook event types
json_has_key "$HOOKS_JSON" "hooks"
if [ "$HAS_KEY" -eq 1 ]; then
    pass "hooks.json has top-level 'hooks' key"
else
    fail "hooks.json is missing top-level 'hooks' key"
fi

EXPECTED_HOOK_EVENTS=("PreToolUse" "SessionStart" "Stop")
for event in "${EXPECTED_HOOK_EVENTS[@]}"; do
    if [ "$HAS_JQ" -eq 1 ]; then
        if jq -e ".hooks.$event" "$HOOKS_JSON" >/dev/null 2>&1; then
            pass "hooks.json defines '$event' hook"
        else
            fail "hooks.json is missing '$event' hook"
        fi
    elif command -v python3 >/dev/null 2>&1; then
        if python3 -c "
import json, sys
data = json.load(open(sys.argv[1]))
hooks = data.get('hooks', {})
sys.exit(0 if sys.argv[2] in hooks else 1)
" "$HOOKS_JSON" "$event" 2>/dev/null; then
            pass "hooks.json defines '$event' hook"
        else
            fail "hooks.json is missing '$event' hook"
        fi
    else
        warn "Cannot check hook event '$event' (no jq or python3)"
    fi
done

# Validate that each hook entry has 'type' and 'command' fields
if [ "$HAS_JQ" -eq 1 ]; then
    HOOK_COMMANDS_MISSING=0
    HOOK_ENTRIES="$(jq -r '
        [.hooks | to_entries[] | .key as $event |
         .value[] | .hooks[]? |
         select(.type == null or .command == null) |
         $event
        ] | .[]
    ' "$HOOKS_JSON" 2>/dev/null || true)"
    if [ -z "$HOOK_ENTRIES" ]; then
        pass "All hook entries have 'type' and 'command' fields"
    else
        fail "Some hook entries are missing 'type' or 'command': $HOOK_ENTRIES"
    fi
fi

# -------------------------------------------------------------------------
# 4. SKILL.md has valid YAML frontmatter
# -------------------------------------------------------------------------

section "4. SKILL.md Frontmatter"

SKILL_MD="$PLUGIN_ROOT/skills/preflight/SKILL.md"

validate_yaml_frontmatter "$SKILL_MD"
if [ "$FRONTMATTER_VALID" -eq 1 ]; then
    pass "SKILL.md has valid YAML frontmatter"
else
    fail "SKILL.md has invalid or missing YAML frontmatter"
fi

SKILL_REQUIRED_FIELDS=("name" "description" "allowed-tools" "user-invocable")
for field_name in "${SKILL_REQUIRED_FIELDS[@]}"; do
    if frontmatter_has_field "$field_name"; then
        pass "SKILL.md frontmatter has '$field_name'"
    else
        fail "SKILL.md frontmatter is missing '$field_name'"
    fi
done

# -------------------------------------------------------------------------
# 5. Agent .md files have valid YAML frontmatter with required fields
# -------------------------------------------------------------------------

section "5. Agent Files"

AGENT_REQUIRED_FIELDS=("name" "description" "tools")

for agent_file in "$PLUGIN_ROOT"/agents/*.md; do
    [ -f "$agent_file" ] || continue
    agent_name="$(basename "$agent_file")"

    validate_yaml_frontmatter "$agent_file"
    if [ "$FRONTMATTER_VALID" -eq 1 ]; then
        pass "$agent_name has valid YAML frontmatter"
    else
        fail "$agent_name has invalid or missing YAML frontmatter"
    fi

    for field_name in "${AGENT_REQUIRED_FIELDS[@]}"; do
        if frontmatter_has_field "$field_name"; then
            pass "$agent_name frontmatter has '$field_name'"
        else
            fail "$agent_name frontmatter is missing '$field_name'"
        fi
    done
done

# -------------------------------------------------------------------------
# 6. All .json data files are valid JSON
# -------------------------------------------------------------------------

section "6. Data Files (JSON Validation)"

for json_file in "$PLUGIN_ROOT"/data/*.json; do
    [ -f "$json_file" ] || continue
    json_name="$(basename "$json_file")"

    validate_json "$json_file"
    if [ "$VALID_JSON" -eq 1 ]; then
        pass "$json_name is valid JSON"
    else
        fail "$json_name is NOT valid JSON"
    fi
done

# -------------------------------------------------------------------------
# 7. get-staged-diff.sh is executable
# -------------------------------------------------------------------------

section "7. Script Executability"

DIFF_SCRIPT="$PLUGIN_ROOT/skills/preflight/scripts/get-staged-diff.sh"

if [ -f "$DIFF_SCRIPT" ]; then
    if [ -x "$DIFF_SCRIPT" ]; then
        pass "get-staged-diff.sh is executable"
    else
        fail "get-staged-diff.sh exists but is NOT executable (run: chmod +x)"
    fi
else
    fail "get-staged-diff.sh does not exist"
fi

# Check shebang line
if [ -f "$DIFF_SCRIPT" ]; then
    SHEBANG="$(head -1 "$DIFF_SCRIPT")"
    if echo "$SHEBANG" | grep -q '^#!/'; then
        pass "get-staged-diff.sh has a shebang line"
    else
        fail "get-staged-diff.sh is missing a shebang line"
    fi
fi

# -------------------------------------------------------------------------
# 8. No broken file references
# -------------------------------------------------------------------------

section "8. Cross-Reference Integrity"

# Check that SKILL.md references to agents match actual agent files.
# The skill references agents like "security-scanner" and "bug-detector".
SKILL_CONTENT="$(cat "$SKILL_MD" 2>/dev/null || true)"

AGENT_BASENAMES=()
for agent_file in "$PLUGIN_ROOT"/agents/*.md; do
    [ -f "$agent_file" ] || continue
    AGENT_BASENAMES+=("$(basename "$agent_file" .md)")
done

# Check agents referenced in SKILL.md exist
REFERENCED_AGENTS=()
if echo "$SKILL_CONTENT" | grep -qo 'security-scanner'; then
    REFERENCED_AGENTS+=("security-scanner")
fi
if echo "$SKILL_CONTENT" | grep -qo 'bug-detector'; then
    REFERENCED_AGENTS+=("bug-detector")
fi
if echo "$SKILL_CONTENT" | grep -qo 'test-gap-analyzer'; then
    REFERENCED_AGENTS+=("test-gap-analyzer")
fi

for ref_agent in "${REFERENCED_AGENTS[@]}"; do
    found=0
    for existing in "${AGENT_BASENAMES[@]}"; do
        if [ "$ref_agent" = "$existing" ]; then
            found=1
            break
        fi
    done
    if [ "$found" -eq 1 ]; then
        pass "SKILL.md references agent '$ref_agent' which exists"
    else
        fail "SKILL.md references agent '$ref_agent' which does NOT exist"
    fi
done

# Check that CLAUDE.md mentions all agent files
CLAUDE_MD="$PLUGIN_ROOT/CLAUDE.md"
if [ -f "$CLAUDE_MD" ]; then
    CLAUDE_CONTENT="$(cat "$CLAUDE_MD")"
    for agent_basename in "${AGENT_BASENAMES[@]}"; do
        if echo "$CLAUDE_CONTENT" | grep -q "$agent_basename"; then
            pass "CLAUDE.md references agent '$agent_basename'"
        else
            warn "CLAUDE.md does not mention agent '$agent_basename'"
        fi
    done
fi

# Check that data files referenced in agents are present
DATA_FILES=()
for data_file in "$PLUGIN_ROOT"/data/*.json; do
    [ -f "$data_file" ] || continue
    DATA_FILES+=("$(basename "$data_file")")
done

for data_name in "ai-failure-patterns.json" "deprecated-apis.json" "phantom-packages.json"; do
    found=0
    for existing in "${DATA_FILES[@]}"; do
        if [ "$data_name" = "$existing" ]; then
            found=1
            break
        fi
    done
    if [ "$found" -eq 1 ]; then
        pass "Data file '$data_name' exists"
    else
        fail "Data file '$data_name' is missing"
    fi
done

# Check that templates/report.md exists and is referenced
if [ -f "$PLUGIN_ROOT/templates/report.md" ]; then
    pass "Report template exists at templates/report.md"
else
    fail "Report template is missing at templates/report.md"
fi

# -------------------------------------------------------------------------
# 9. Plugin size check
# -------------------------------------------------------------------------

section "9. Plugin Size"

# Calculate total size (portable: works on macOS and Linux)
if command -v du >/dev/null 2>&1; then
    # du -sk gives size in KB on both macOS and Linux
    TOTAL_SIZE_KB="$(du -sk "$PLUGIN_ROOT" 2>/dev/null | awk '{print $1}')"
    if [ -n "$TOTAL_SIZE_KB" ] && [ "$TOTAL_SIZE_KB" -gt 0 ]; then
        if [ "$TOTAL_SIZE_KB" -gt 500 ]; then
            warn "Plugin size is ${TOTAL_SIZE_KB}KB (exceeds 500KB recommendation)"
        else
            pass "Plugin size is ${TOTAL_SIZE_KB}KB (within 500KB limit)"
        fi
    else
        warn "Could not determine plugin size"
    fi
else
    warn "du command not available; skipping size check"
fi

# Also check individual large files
LARGE_FILE_THRESHOLD=102400  # 100KB in bytes
for file in "$PLUGIN_ROOT"/data/*.json; do
    [ -f "$file" ] || continue
    file_size="$(wc -c < "$file" | tr -d '[:space:]')"
    if [ "$file_size" -gt "$LARGE_FILE_THRESHOLD" ]; then
        warn "$(basename "$file") is $(( file_size / 1024 ))KB -- consider trimming"
    fi
done

# -------------------------------------------------------------------------
# 10. Test fixtures exist and have expected-findings comments
# -------------------------------------------------------------------------

section "10. Test Fixtures"

FIXTURES_DIR="$PLUGIN_ROOT/tests/fixtures"

if [ -d "$FIXTURES_DIR" ]; then
    pass "Test fixtures directory exists"
else
    fail "Test fixtures directory is missing"
fi

# Expected fixture files (base names without extension)
EXPECTED_FIXTURES=(
    "phantom-package.ts"
    "hallucinated-api.ts"
    "plausible-wrong-logic.ts"
    "deprecated-api.ts"
    "security-issues.ts"
    "clean-code.ts"
    "python-phantom-package.py"
    "python-hallucinated-api.py"
)

for fixture in "${EXPECTED_FIXTURES[@]}"; do
    fixture_path="$FIXTURES_DIR/$fixture"
    if [ -f "$fixture_path" ]; then
        pass "Fixture '$fixture' exists"

        # Check for expected-findings comment in the first 5 lines
        head_content="$(head -5 "$fixture_path")"
        if echo "$head_content" | grep -qi 'expected.findings\|Expected findings'; then
            pass "Fixture '$fixture' has expected-findings comment"
        else
            fail "Fixture '$fixture' is missing expected-findings comment in first 5 lines"
        fi
    else
        fail "Fixture '$fixture' is missing"
    fi
done

# Check the clean-code fixture specifically expects 0 findings
CLEAN_FIXTURE="$FIXTURES_DIR/clean-code.ts"
if [ -f "$CLEAN_FIXTURE" ]; then
    if head -3 "$CLEAN_FIXTURE" | grep -q '0'; then
        pass "clean-code.ts expects 0 findings"
    else
        warn "clean-code.ts may not clearly state 0 expected findings"
    fi
fi

# =========================================================================
# SUMMARY
# =========================================================================

printf '\n'
printf '\033[1m════════════════════════════════════════\033[0m\n'
printf '\033[1m  Validation Summary\033[0m\n'
printf '\033[1m════════════════════════════════════════\033[0m\n'
printf '  \033[32mPassed:\033[0m  %d\n' "$PASS"
printf '  \033[31mFailed:\033[0m  %d\n' "$FAIL"
printf '  \033[33mWarnings:\033[0m %d\n' "$WARN"
printf '\033[1m════════════════════════════════════════\033[0m\n'

if [ "$FAIL" -gt 0 ]; then
    printf '\n\033[31mRESULT: FAIL\033[0m -- %d check(s) failed.\n' "$FAIL"
    exit 1
else
    if [ "$WARN" -gt 0 ]; then
        printf '\n\033[32mRESULT: PASS\033[0m (with %d warning(s))\n' "$WARN"
    else
        printf '\n\033[32mRESULT: PASS\033[0m -- all checks passed.\n'
    fi
    exit 0
fi
