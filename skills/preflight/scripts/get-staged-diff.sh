#!/bin/sh
# get-staged-diff.sh — Extract staged (or unstaged) diffs for preflight analysis.
#
# Priority order:
#   1. Staged changes   (git diff --cached)
#   2. Unstaged changes  (git diff)
#   3. No changes at all -> prints NO_CHANGES and exits 0
#
# Modes:
#   (default)        Full diff output with section markers
#   --files-only     List changed file paths only
#   --stat           Show diffstat summary only
#
# Options:
#   --no-filter      Disable default file type filtering
#   --pattern PAT    Only include files matching glob PAT (repeatable)
#
# Output includes machine-parseable section markers:
#   [SECTION:META]   [SECTION:FILES]   [SECTION:STAT]
#   [SECTION:DIFF]   [END]
#
# POSIX-compliant. No bashisms. Works on macOS and Linux.
# Make executable after creation:  chmod +x get-staged-diff.sh

set -e

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DIFF_SIZE_LIMIT=51200  # 50 KB in bytes
VERSION="2.0.0"

# ---------------------------------------------------------------------------
# Color support — disabled when stdout is not a terminal (i.e. piped)
# ---------------------------------------------------------------------------

if [ -t 1 ]; then
    COLOR_RESET='\033[0m'
    COLOR_BOLD='\033[1m'
    COLOR_RED='\033[31m'
    COLOR_GREEN='\033[32m'
    COLOR_YELLOW='\033[33m'
    COLOR_CYAN='\033[36m'
else
    COLOR_RESET=''
    COLOR_BOLD=''
    COLOR_RED=''
    COLOR_GREEN=''
    COLOR_YELLOW=''
    COLOR_CYAN=''
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

die() {
    printf '%serror:%s %s\n' "$COLOR_RED" "$COLOR_RESET" "$1" >&2
    exit 1
}

warn() {
    printf '%swarning:%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$1" >&2
}

section_start() {
    printf '[SECTION:%s]\n' "$1"
}

section_end() {
    printf '[/SECTION:%s]\n' "$1"
}

separator() {
    printf '%s\n' "────────────────────────────────────────────────────────"
}

usage() {
    printf 'Usage: %s [--files-only | --stat] [--no-filter] [--pattern PAT]...\n' "$(basename "$0")"
    printf '       %s --help | --version\n' "$(basename "$0")"
    exit 0
}

# Portable byte-length measurement (works on macOS and Linux).
# wc -c is POSIX; tr -d strips any whitespace padding (macOS wc pads output).
byte_length() {
    printf '%s' "$1" | wc -c | tr -d '[:space:]'
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

MODE="full"         # full | files-only | stat
FILTER_ENABLED=1    # 1 = filter out noise, 0 = include everything
PATTERNS=""         # newline-separated list of glob patterns

while [ $# -gt 0 ]; do
    case "$1" in
        --files-only)
            MODE="files-only"
            shift
            ;;
        --stat)
            MODE="stat"
            shift
            ;;
        --no-filter)
            FILTER_ENABLED=0
            shift
            ;;
        --pattern)
            [ -n "${2:-}" ] || die "--pattern requires an argument"
            if [ -z "$PATTERNS" ]; then
                PATTERNS="$2"
            else
                PATTERNS="$PATTERNS
$2"
            fi
            shift 2
            ;;
        --help|-h)
            usage
            ;;
        --version)
            printf '%s\n' "$VERSION"
            exit 0
            ;;
        *)
            die "unknown option: $1"
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

# Verify git is available.
command -v git >/dev/null 2>&1 || die "git is not installed or not in PATH"

# Verify we are inside a git work tree (handles worktrees and submodules).
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || \
    die "not inside a git repository or worktree"

# ---------------------------------------------------------------------------
# Detect git worktree and HEAD state
# ---------------------------------------------------------------------------

IS_WORKTREE=0
WORKTREE_ROOT=""
IS_DETACHED=0
HEAD_REF=""

# Detect worktree: if the git dir is not directly inside the work tree,
# or if git worktree list shows more than one entry, we are in a worktree.
GIT_COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null || true)"
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null || true)"

if [ -n "$GIT_COMMON_DIR" ] && [ -n "$GIT_DIR" ]; then
    # Resolve to absolute paths for reliable comparison.
    # Use cd + pwd which is POSIX-safe (no readlink -f needed).
    if [ -d "$GIT_COMMON_DIR" ] && [ -d "$GIT_DIR" ]; then
        ABS_COMMON="$(cd "$GIT_COMMON_DIR" && pwd)"
        ABS_GIT="$(cd "$GIT_DIR" && pwd)"
        if [ "$ABS_COMMON" != "$ABS_GIT" ]; then
            IS_WORKTREE=1
            WORKTREE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
        fi
    fi
fi

# Detect detached HEAD state.
if ! git symbolic-ref HEAD >/dev/null 2>&1; then
    IS_DETACHED=1
    HEAD_REF="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
else
    HEAD_REF="$(git symbolic-ref --short HEAD 2>/dev/null || echo 'unknown')"
fi

# ---------------------------------------------------------------------------
# Determine diff source
# ---------------------------------------------------------------------------

DIFF_SOURCE=""
DIFF_ARGS=""

if git diff --cached --quiet 2>/dev/null; then
    # No staged changes — fall back to unstaged.
    if git diff --quiet 2>/dev/null; then
        # Nothing at all.
        section_start "META"
        printf 'STATUS: NO_CHANGES\n'
        section_end "META"
        printf '[END]\n'
        exit 0
    else
        DIFF_SOURCE="unstaged"
        DIFF_ARGS=""
    fi
else
    DIFF_SOURCE="staged"
    DIFF_ARGS="--cached"
fi

# ---------------------------------------------------------------------------
# Detect merge commit and set merge-base diff target
# ---------------------------------------------------------------------------

MERGE_BASE=""
IS_MERGE=0

# If HEAD is a merge commit (has more than one parent), diff against merge base.
PARENT_COUNT="$(git cat-file -p HEAD 2>/dev/null | grep -c '^parent ' || echo '0')"
if [ "$PARENT_COUNT" -gt 1 ]; then
    IS_MERGE=1
    # Use the first parent as the merge base reference.
    FIRST_PARENT="$(git rev-parse HEAD^1 2>/dev/null || true)"
    SECOND_PARENT="$(git rev-parse HEAD^2 2>/dev/null || true)"
    if [ -n "$FIRST_PARENT" ] && [ -n "$SECOND_PARENT" ]; then
        MERGE_BASE="$(git merge-base "$FIRST_PARENT" "$SECOND_PARENT" 2>/dev/null || true)"
    fi
fi

# ---------------------------------------------------------------------------
# Build pathspec filter arguments
# ---------------------------------------------------------------------------

# Default exclusion patterns for noise files.
# These are applied via pathspec magic (":!pattern") which is portable.
build_pathspec_excludes() {
    if [ "$FILTER_ENABLED" -eq 1 ]; then
        printf '%s\n' \
            ":(exclude)*.lock" \
            ":(exclude)package-lock.json" \
            ":(exclude)yarn.lock" \
            ":(exclude)pnpm-lock.yaml" \
            ":(exclude)bun.lockb" \
            ":(exclude)*.min.js" \
            ":(exclude)*.min.css" \
            ":(exclude)*.map" \
            ":(exclude)node_modules/*" \
            ":(exclude).git/*" \
            ":(exclude)dist/*" \
            ":(exclude)build/*" \
            ":(exclude)vendor/*" \
            ":(exclude)*.png" \
            ":(exclude)*.jpg" \
            ":(exclude)*.jpeg" \
            ":(exclude)*.gif" \
            ":(exclude)*.ico" \
            ":(exclude)*.woff" \
            ":(exclude)*.woff2" \
            ":(exclude)*.ttf" \
            ":(exclude)*.eot" \
            ":(exclude)*.pdf" \
            ":(exclude)*.zip" \
            ":(exclude)*.tar.gz" \
            ":(exclude)*.tgz" \
            ":(exclude)*.pyc" \
            ":(exclude)__pycache__/*"
    fi
}

# Build include patterns.
build_pathspec_includes() {
    if [ -n "$PATTERNS" ]; then
        printf '%s\n' "$PATTERNS" | while IFS= read -r pat; do
            [ -n "$pat" ] && printf '%s\n' "$pat"
        done
    fi
}

# Assemble pathspec into a temp file so we can use xargs safely.
# This avoids issues with argument list length and special characters.
PATHSPEC_FILE="$(mktemp "${TMPDIR:-/tmp}/preflight-pathspec.XXXXXX")"
trap 'rm -f "$PATHSPEC_FILE"' EXIT INT TERM

build_pathspec_includes > "$PATHSPEC_FILE"
build_pathspec_excludes >> "$PATHSPEC_FILE"

# Read pathspec args from file into a variable (line-by-line safe).
# We build a command string to avoid word-splitting issues with spaces in paths.
get_diff_cmd_args() {
    _args=""
    while IFS= read -r _line; do
        [ -z "$_line" ] && continue
        _args="$_args \"$_line\""
    done < "$PATHSPEC_FILE"
    printf '%s' "$_args"
}

PATHSPEC_ARGS="$(get_diff_cmd_args)"

# Wrapper: run git diff with the correct arguments and pathspec.
run_git_diff() {
    _extra_flags="$1"
    # Using eval here is intentional — pathspec args are self-generated,
    # not user-supplied, and need proper word-splitting.
    eval "git diff $DIFF_ARGS $_extra_flags -- . $PATHSPEC_ARGS"
}

# ---------------------------------------------------------------------------
# Collect raw diff and check size
# ---------------------------------------------------------------------------

if [ "$MODE" = "full" ]; then
    RAW_DIFF="$(run_git_diff "--unified=3")"
    DIFF_BYTES="$(byte_length "$RAW_DIFF")"

    if [ "$DIFF_BYTES" -gt "$DIFF_SIZE_LIMIT" ]; then
        DIFF_TOO_LARGE=1
    else
        DIFF_TOO_LARGE=0
    fi
else
    RAW_DIFF=""
    DIFF_BYTES=0
    DIFF_TOO_LARGE=0
fi

# ---------------------------------------------------------------------------
# Collect stats
# ---------------------------------------------------------------------------

STAT_OUTPUT="$(run_git_diff "--stat")"
NUMSTAT_OUTPUT="$(run_git_diff "--numstat")"

FILES_CHANGED=0
TOTAL_INSERTIONS=0
TOTAL_DELETIONS=0

# Parse numstat line by line (POSIX-safe — no process substitution).
if [ -n "$NUMSTAT_OUTPUT" ]; then
    FILES_CHANGED=$(printf '%s\n' "$NUMSTAT_OUTPUT" | wc -l | tr -d '[:space:]')

    TOTAL_INSERTIONS=$(printf '%s\n' "$NUMSTAT_OUTPUT" | \
        awk '{ if ($1 != "-") s += $1 } END { print s+0 }')

    TOTAL_DELETIONS=$(printf '%s\n' "$NUMSTAT_OUTPUT" | \
        awk '{ if ($2 != "-") s += $2 } END { print s+0 }')
fi

# Collect file list.
FILE_LIST="$(run_git_diff "--name-only")"

# ---------------------------------------------------------------------------
# Output: META section (always emitted)
# ---------------------------------------------------------------------------

section_start "META"
printf 'DIFF_SOURCE: %s\n' "$DIFF_SOURCE"
printf 'HEAD_REF: %s\n' "$HEAD_REF"
printf 'IS_DETACHED_HEAD: %s\n' "$IS_DETACHED"
printf 'IS_WORKTREE: %s\n' "$IS_WORKTREE"
if [ "$IS_WORKTREE" -eq 1 ] && [ -n "$WORKTREE_ROOT" ]; then
    printf 'WORKTREE_ROOT: %s\n' "$WORKTREE_ROOT"
fi
printf 'IS_MERGE_COMMIT: %s\n' "$IS_MERGE"
if [ -n "$MERGE_BASE" ]; then
    printf 'MERGE_BASE: %s\n' "$MERGE_BASE"
fi
printf 'FILES_CHANGED: %s\n' "$FILES_CHANGED"
printf 'TOTAL_INSERTIONS: %s\n' "$TOTAL_INSERTIONS"
printf 'TOTAL_DELETIONS: %s\n' "$TOTAL_DELETIONS"
printf 'DIFF_BYTES: %s\n' "$DIFF_BYTES"
printf 'FILTER_ENABLED: %s\n' "$FILTER_ENABLED"
section_end "META"

# ---------------------------------------------------------------------------
# Output: FILES section
# ---------------------------------------------------------------------------

section_start "FILES"
if [ -n "$FILE_LIST" ]; then
    printf '%s\n' "$FILE_LIST"
else
    printf '(none)\n'
fi
section_end "FILES"

# Exit early for --files-only mode.
if [ "$MODE" = "files-only" ]; then
    printf '[END]\n'
    exit 0
fi

# ---------------------------------------------------------------------------
# Output: STAT section
# ---------------------------------------------------------------------------

section_start "STAT"
if [ -n "$STAT_OUTPUT" ]; then
    printf '%s\n' "$STAT_OUTPUT"
else
    printf '(no changes)\n'
fi
printf '%sSUMMARY:%s %s file(s) changed, %s%s insertion(s)%s, %s%s deletion(s)%s\n' \
    "$COLOR_BOLD" "$COLOR_RESET" \
    "$FILES_CHANGED" \
    "$COLOR_GREEN" "$TOTAL_INSERTIONS" "$COLOR_RESET" \
    "$COLOR_RED" "$TOTAL_DELETIONS" "$COLOR_RESET"
section_end "STAT"

# Exit early for --stat mode.
if [ "$MODE" = "stat" ]; then
    printf '[END]\n'
    exit 0
fi

# ---------------------------------------------------------------------------
# Output: DIFF section (full mode only)
# ---------------------------------------------------------------------------

section_start "DIFF"

if [ "$DIFF_TOO_LARGE" -eq 1 ]; then
    warn "Diff is $(( DIFF_BYTES / 1024 ))KB which exceeds the 50KB limit."
    warn "Consider using --pattern to narrow the scope. Example:"
    warn "  $0 --pattern '*.ts' --pattern '*.tsx'"
    printf '%sWARNING:%s Diff output truncated (%s bytes > %s byte limit).\n' \
        "$COLOR_YELLOW" "$COLOR_RESET" "$DIFF_BYTES" "$DIFF_SIZE_LIMIT"
    printf 'Use --pattern to filter by file type, or --stat / --files-only for summaries.\n'
    separator
    printf 'Changed files for reference:\n'
    printf '%s\n' "$FILE_LIST"
    separator
    # Output first ~50KB worth of the diff then cut off.
    printf '%s' "$RAW_DIFF" | head -c "$DIFF_SIZE_LIMIT"
    printf '\n... [TRUNCATED at %s bytes] ...\n' "$DIFF_SIZE_LIMIT"
else
    if [ -n "$RAW_DIFF" ]; then
        printf '%s\n' "$RAW_DIFF"
    else
        printf '(empty diff after filtering)\n'
    fi
fi

section_end "DIFF"

# ---------------------------------------------------------------------------
# Finish
# ---------------------------------------------------------------------------

printf '[END]\n'
