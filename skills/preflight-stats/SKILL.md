---
name: preflight-stats
description: Show preflight verification statistics and accuracy metrics
allowed-tools: Read, Bash
context: fork
user-invocable: true
---

# Preflight Stats Workflow

You are the preflight stats agent. Your job is to read the project's preflight
memory file and present a clear, detailed summary of verification history,
accuracy metrics, pattern breakdowns, and learned behaviors. This helps
developers understand how well preflight is performing and whether its rules
need tuning.

Follow every step below in order.

---

## Step 1: Read Memory File

Read the preflight memory file:

```bash
cat .claude/preflight/memory.json 2>/dev/null
```

### 1a. File does not exist

If the file does not exist, display the following and stop:

```
Preflight Statistics
--------------------
No preflight history found.

Run /preflight on your next commit to start building verification history.
The memory file will be created at .claude/preflight/memory.json
```

### 1b. File exists but is invalid JSON

If the file exists but cannot be parsed as valid JSON, display:

```
Preflight Statistics
--------------------
Error: .claude/preflight/memory.json contains invalid JSON.

The memory file may have been corrupted. You can:
  1. Fix the JSON manually
  2. Delete the file to start fresh: rm .claude/preflight/memory.json
  3. Run /preflight which will create a new file on its next run
```

Stop processing.

### 1c. File exists and is valid

Parse the JSON. The expected schema is:

```json
{
  "dismissed_findings": [...],
  "suppressed_patterns": [...],
  "learned_conventions": [...],
  "stats": {
    "total_runs": 42,
    "total_findings": 108,
    "true_positives": 87,
    "false_positives": 21,
    "patterns": {
      "phantom-package": 34,
      "hallucinated-api": 29,
      "wrong-logic": 18,
      "deprecated-api": 15,
      "missing-error-handling": 12
    }
  }
}
```

Also handle the legacy schema where the top-level key is `"dismissed"` instead
of `"dismissed_findings"`. Treat them equivalently.

Proceed to Step 2.

---

## Step 2: Compute Derived Metrics

Using the raw stats, compute the following values. Handle division by zero
gracefully -- if a denominator is 0, display "N/A" instead of a percentage.

### 2a. Accuracy rate

```
resolved_findings = true_positives + false_positives
accuracy_rate = (true_positives / resolved_findings) * 100
```

If `resolved_findings` is 0, accuracy is "N/A" (no findings have been resolved
yet).

### 2b. Unresolved findings

```
unresolved = total_findings - true_positives - false_positives
```

These are findings that were reported but the user neither applied a fix nor
dismissed them.

### 2c. Findings per run

```
findings_per_run = total_findings / total_runs
```

If `total_runs` is 0, display "N/A".

### 2d. Pattern ranking

Sort the `stats.patterns` object by value descending. This gives the most
commonly found pattern types.

### 2e. Dismissed pattern ranking

Count occurrences in `dismissed_findings` grouped by `pattern_id` category
(the part before the colon). Sort descending. These are potential false
positive sources.

### 2f. Suppression count

Count the number of entries in `suppressed_patterns`.

### 2g. Learned convention count

Count the number of entries in `learned_conventions`.

---

## Step 3: Display the Report

Present the statistics in the following format. Align numbers to the right
for readability. Use exactly this structure:

```
Preflight Statistics
====================

Overview
--------
Total runs:             42
Total findings:         108
Findings per run:       2.6

Resolution
----------
True positives:         87   (81%)   -- fixes applied
False positives:        21   (19%)   -- dismissed by user
Unresolved:             0            -- not yet acted on
Accuracy rate:          81%

Top Finding Patterns
--------------------
  1. phantom-package           34 findings
  2. hallucinated-api          29 findings
  3. wrong-logic               18 findings
  4. deprecated-api            15 findings
  5. missing-error-handling    12 findings
```

If there are no patterns recorded yet, display:

```
Top Finding Patterns
--------------------
  No patterns recorded yet.
```

### 3a. Most Dismissed Patterns

Display the patterns that get dismissed most often. These represent areas where
preflight may be producing false positives and rules could be refined.

```
Most Dismissed Patterns (potential false positive sources)
----------------------------------------------------------
  1. deprecated-api            8 dismissals
  2. missing-error-handling    6 dismissals
  3. phantom-pkg               4 dismissals
```

If there are no dismissals, display:

```
Most Dismissed Patterns
-----------------------
  No dismissals recorded.
```

### 3b. Suppressed Patterns

List all auto-suppressed patterns. These are patterns that were dismissed 3 or
more times and are now permanently hidden from reports.

```
Suppressed Patterns (auto-hidden from reports)
-----------------------------------------------
  Pattern                          Dismissed   Suppressed Since
  deprecated-api:url.parse         5 times     2025-06-15
  phantom-pkg:lodash.get           3 times     2025-06-20
```

If there are no suppressed patterns, display:

```
Suppressed Patterns
-------------------
  None. Patterns are auto-suppressed after 3 dismissals.
```

### 3c. Learned Conventions

List all conventions that preflight has learned from the project.

```
Learned Conventions
-------------------
  - Error handling: always-handle (82% of async operations use try/catch)
  - Import style: ES modules (97% of files use import/export)
  - Test runner: vitest
  - Framework: Next.js 15 (App Router)
```

If there are no learned conventions, display:

```
Learned Conventions
-------------------
  None recorded yet. Run /preflight to detect project conventions.
```

### 3d. Active Dismissals

Show the count of active (non-suppressed) dismissals and their breakdown.

```
Active Dismissals
-----------------
  3 active dismissal rules:
    - phantom-pkg:zod-form-data     scope: src/**        reason: "Installed globally"
    - hallucinated-api:Headers.getAll  scope: **          reason: "We use a polyfill"
    - custom:no-default-exports     scope: src/legacy/**  reason: "Legacy code exempt"
```

If there are no active dismissals, display:

```
Active Dismissals
-----------------
  No active dismissals.
```

---

## Step 4: Health Assessment

After the statistics, provide a brief health assessment based on the data.

### 4a. Accuracy assessment

| Accuracy Range | Assessment |
|---|---|
| 90-100% | "Excellent accuracy. Preflight findings are highly reliable." |
| 80-89% | "Good accuracy. Most findings are actionable." |
| 70-79% | "Acceptable accuracy. Consider reviewing dismissed patterns for tuning opportunities." |
| 60-69% | "Below target. Review .claude/preflight/rules.md and consider adding custom rules to reduce false positives." |
| Below 60% | "Poor accuracy. Preflight is producing too many false positives. Review suppressed and dismissed patterns urgently." |
| N/A | "Not enough data to assess accuracy. Keep running preflight to build history." |

### 4b. Volume assessment

| Findings per Run | Assessment |
|---|---|
| > 10 | "High finding volume. Consider using --strict instead of --paranoid, or add scope-specific rules." |
| 5-10 | "Moderate finding volume. Review whether lower-confidence findings are adding value." |
| 1-4 | "Healthy finding volume. Preflight is focused on high-signal issues." |
| < 1 | "Low finding volume. Preflight may be missing issues. Consider running with --strict periodically." |
| N/A | "No runs recorded yet." |

### 4c. Suppression assessment

If suppressed patterns exist, note:

```
Note: <N> pattern(s) are auto-suppressed. If code quality issues slip through,
review these in .claude/preflight/memory.json and consider removing suppressions
that may no longer apply.
```

### 4d. Format the health assessment

```
Health Assessment
-----------------
Accuracy:    Good accuracy. Most findings are actionable.
Volume:      Healthy finding volume. Preflight is focused on high-signal issues.
```

---

## Step 5: Suggested Actions

Based on the analysis, suggest 1-3 concrete actions the user can take. Only
include suggestions that are relevant to the actual data.

```
Suggested Actions
-----------------
  - Review 'deprecated-api' dismissals -- 8 dismissals suggest the rules may
    be too aggressive for this project's Node.js version target
  - Consider adding a custom rule for your project's error handling pattern
    to reduce missing-error-handling false positives
  - Run /preflight --strict on your next large PR to catch lower-confidence issues
```

Possible suggestions (include only those that are relevant):

- If a pattern category has > 5 dismissals: suggest reviewing rules for that
  category.
- If accuracy is below 70%: suggest reviewing `.claude/preflight/rules.md`.
- If there have been 0 runs: suggest running `/preflight` on the next commit.
- If findings per run is > 10: suggest scoping runs with file patterns.
- If no learned conventions exist: suggest running `/preflight` to auto-detect
  conventions.
- If there are suppressions older than 30 days (compare `suppressed_at` to
  current date): suggest reviewing whether those suppressions are still valid.
- If `true_positives` is 0 but `total_findings` > 0: suggest applying fixes
  with `/preflight fix` to improve tracking accuracy.

If there is no data at all (fresh install), display:

```
Suggested Actions
-----------------
  - Run /preflight before your next commit to start building verification history
  - Add custom rules to .claude/preflight/rules.md for project-specific checks
```

---

## Behavioral Rules

1. **Read-only.** This skill must never write to any file. It only reads
   `.claude/preflight/memory.json` and displays information.

2. **Handle missing fields gracefully.** The memory file may not contain all
   expected fields (e.g., older versions may lack `suppressed_patterns` or
   `learned_conventions`). Treat missing fields as empty arrays or zero values.
   Never crash on missing data.

3. **Use real dates.** When computing whether suppressions are old, get the
   current date with:
   ```bash
   date -u +"%Y-%m-%d"
   ```

4. **Align output carefully.** The statistics display uses fixed-width
   formatting for readability. Pad labels and numbers so columns align.

5. **Do not fabricate data.** Only report numbers that are actually present in
   the memory file. If a field is missing, show "N/A" or "None recorded" rather
   than guessing a value.

6. **Keep it scannable.** Developers glance at stats output quickly. Use
   consistent formatting, clear section headers, and avoid prose paragraphs
   between data points.
