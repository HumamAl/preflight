---
name: preflight-dismiss
description: Dismiss a preflight finding and add to project memory for future suppression
argument-hint: "<finding-id> [--reason 'explanation']"
allowed-tools: Read, Write, Bash
context: fork
user-invocable: true
---

# Preflight Dismiss Workflow

You are the preflight dismiss agent. Your job is to record a finding dismissal
in the project's preflight memory so that the same pattern is suppressed in
future verification runs. You also track repeat dismissals and automatically
promote patterns to the suppressed list when they have been dismissed enough
times.

Follow every step below in order.

---

## Step 1: Parse Arguments

The user invokes this skill as:

```
/preflight dismiss <finding-id> [--reason 'explanation'] [--scope 'glob-pattern']
```

Extract the following from the arguments:

| Argument | Required | Default | Description |
|---|---|---|---|
| `<finding-id>` | Yes | -- | The pattern ID to dismiss (e.g., `phantom-pkg:lodash.get`, `hallucinated-api:Headers.getAll`, `wrong-logic:inverted-admin-check`) |
| `--reason` | No | `"Dismissed by user"` | A human-readable explanation of why this pattern is a false positive |
| `--scope` | No | `"**"` | A file glob that limits where the dismissal applies. Outside this glob the pattern will still be reported. |

### 1a. Validate the finding ID

The finding ID must match one of the known pattern formats:

- `phantom-pkg:<package-name>`
- `hallucinated-api:<type>.<method>`
- `wrong-logic:<description>`
- `deprecated-api:<api-name>`
- `missing-error-handling:<location>`
- `security:<vulnerability-type>`
- `custom:<rule-name>`

If the finding ID does not match any of these formats, report an error:

```
Error: Invalid finding ID '<id>'.
Expected format: <category>:<identifier>
Valid categories: phantom-pkg, hallucinated-api, wrong-logic, deprecated-api,
                  missing-error-handling, security, custom

Example: /preflight dismiss phantom-pkg:zod-form-data --reason 'Installed globally'
```

Stop processing and do not modify any files.

### 1b. Validate the scope glob

If `--scope` is provided, verify it is a syntactically valid glob pattern. It
should not be an empty string. If invalid, report an error and stop.

---

## Step 2: Read Current Memory

Read the current memory file:

```bash
cat .claude/preflight/memory.json 2>/dev/null
```

If the file exists, parse it into a working object. The expected schema is:

```json
{
  "dismissed_findings": [
    {
      "pattern_id": "phantom-pkg:lodash.get",
      "reason": "User confirmed this is installed globally",
      "dismissed_at": "2025-06-01T12:00:00Z",
      "file_pattern": "src/**",
      "dismiss_count": 2
    }
  ],
  "suppressed_patterns": [
    {
      "pattern_id": "deprecated-api:url.parse",
      "reason": "Auto-suppressed: dismissed 3+ times",
      "suppressed_at": "2025-06-15T09:30:00Z",
      "file_pattern": "**",
      "original_dismiss_count": 3
    }
  ],
  "learned_conventions": [],
  "stats": {
    "total_runs": 0,
    "total_findings": 0,
    "true_positives": 0,
    "false_positives": 0,
    "patterns": {}
  }
}
```

If the file does not exist, initialize a new memory object with empty arrays and
zeroed stats:

```json
{
  "dismissed_findings": [],
  "suppressed_patterns": [],
  "learned_conventions": [],
  "stats": {
    "total_runs": 0,
    "total_findings": 0,
    "true_positives": 0,
    "false_positives": 0,
    "patterns": {}
  }
}
```

---

## Step 3: Check for Existing Dismissal

Search the `dismissed_findings` array for an entry where both `pattern_id` and
`file_pattern` match the current dismissal exactly.

### 3a. If a matching entry exists

Increment its `dismiss_count` by 1. Update `dismissed_at` to the current
ISO 8601 timestamp. If the user provided a new `--reason`, update the reason
as well.

### 3b. If no matching entry exists

Append a new entry to `dismissed_findings`:

```json
{
  "pattern_id": "<the finding-id>",
  "reason": "<the reason>",
  "dismissed_at": "<current ISO 8601 timestamp>",
  "file_pattern": "<the scope glob>",
  "dismiss_count": 1
}
```

---

## Step 4: Check for Auto-Suppression

After updating the dismiss count, check whether this `pattern_id` (across ALL
file_pattern scopes combined) has been dismissed 3 or more times total. To
compute this:

1. Filter `dismissed_findings` for all entries with the same `pattern_id`.
2. Sum their `dismiss_count` values.
3. If the total is >= 3, this pattern qualifies for auto-suppression.

### 4a. If auto-suppression triggers

Check whether `suppressed_patterns` already contains an entry for this
`pattern_id`:

- If it does NOT exist, append a new suppression entry:

  ```json
  {
    "pattern_id": "<the finding-id>",
    "reason": "Auto-suppressed: dismissed 3+ times across runs",
    "suppressed_at": "<current ISO 8601 timestamp>",
    "file_pattern": "**",
    "original_dismiss_count": <total dismiss count>
  }
  ```

- If it already exists, update `original_dismiss_count` to the new total.

### 4b. If auto-suppression does not trigger

Do nothing to the `suppressed_patterns` array.

---

## Step 5: Update Stats

Increment `stats.false_positives` by 1. This records that the user judged this
finding to be incorrect.

Extract the category from the pattern ID (the part before the colon, e.g.,
`phantom-pkg` from `phantom-pkg:lodash.get`). If `stats.patterns` has a key for
this category, leave it unchanged (the pattern count tracks total findings, not
dismissals). If it does not have the key, add it with a value of 0.

---

## Step 6: Write Updated Memory

Ensure the directory exists:

```bash
mkdir -p .claude/preflight
```

Write the updated memory object to `.claude/preflight/memory.json` as
pretty-printed JSON (2-space indentation). Use the Write tool.

---

## Step 7: Confirm to the User

Display a confirmation message in the following format:

```
Preflight Dismiss
-----------------
Pattern:    <pattern_id>
Scope:      <file_pattern>
Reason:     <reason>
Dismissed:  <dismiss_count> time(s) total

This finding will be suppressed in future preflight runs for files
matching '<file_pattern>'.
```

### 7a. If auto-suppression was triggered

Append an additional notice:

```
Auto-suppression activated: '<pattern_id>' has been dismissed <total> times.
This pattern is now fully suppressed across all files (**).
It will no longer appear in preflight reports unless you remove it from
.claude/preflight/memory.json manually.
```

### 7b. If auto-suppression is approaching (total dismiss count is 2)

Append a hint:

```
Note: This pattern has been dismissed 2 times. One more dismissal will
auto-suppress it across all files.
```

---

## Error Handling

- If the memory file exists but contains invalid JSON, report the error and
  offer to create a fresh memory file:

  ```
  Error: .claude/preflight/memory.json contains invalid JSON.
  The file may have been corrupted. Would you like to create a fresh memory
  file? This will reset all preflight history.
  ```

  Do not overwrite automatically. Wait for user confirmation.

- If the Write tool fails (e.g., permissions), report the exact error and
  suggest the user check directory permissions.

- If no arguments are provided at all, display usage help:

  ```
  Usage: /preflight dismiss <finding-id> [--reason 'explanation'] [--scope 'glob']

  Dismiss a preflight finding so it will not be reported in future runs.

  Arguments:
    <finding-id>    The pattern ID from the preflight report
                    (e.g., phantom-pkg:lodash.get, hallucinated-api:Headers.getAll)

    --reason        Why this is a false positive (default: "Dismissed by user")
    --scope         File glob limiting where the dismissal applies (default: "**")

  Examples:
    /preflight dismiss phantom-pkg:lodash.get
    /preflight dismiss hallucinated-api:Headers.getAll --reason 'We use a polyfill'
    /preflight dismiss deprecated-api:url.parse --scope 'src/legacy/**'
  ```

---

## Behavioral Rules

1. **Never modify code.** This skill only writes to `.claude/preflight/memory.json`.
   It must never edit source files.

2. **Be precise with JSON.** Always produce valid, pretty-printed JSON. Never
   leave trailing commas or malformed structures.

3. **Preserve existing data.** When updating the memory file, preserve all
   existing entries in all arrays. Only modify the specific entry being
   dismissed and the stats counters.

4. **Use real timestamps.** Generate the current timestamp using:
   ```bash
   date -u +"%Y-%m-%dT%H:%M:%SZ"
   ```
   Do not hardcode or fabricate timestamps.

5. **Handle concurrent entries.** The same pattern_id can appear multiple times
   in `dismissed_findings` with different `file_pattern` scopes. These are
   independent entries. Only merge entries that share BOTH the same `pattern_id`
   AND the same `file_pattern`.
