# Preflight Report

**Scan completed:** {{timestamp}}
**Scan duration:** {{scan_duration_ms}}ms ({{scan_duration_human}})
**Diff source:** {{diff_source}} ({{files_changed}} files, +{{insertions}} -{{deletions}})

---

## Quick Summary

| Metric              | Value                   |
|---------------------|-------------------------|
| Total findings      | {{total_findings}}      |
| Critical            | {{critical_count}}      |
| High                | {{high_count}}          |
| Medium              | {{medium_count}}        |
| Files affected      | {{files_affected}}      |
| Estimated fix time  | {{estimated_fix_time}}  |

{{#if has_critical}}
```
 ╔══════════════════════════════════════════════════════════════╗
 ║  BLOCKED -- {{critical_count}} critical finding(s) must be resolved       ║
 ║  before committing.                                         ║
 ╚══════════════════════════════════════════════════════════════╝
```
{{else if has_findings}}
```
 ╔══════════════════════════════════════════════════════════════╗
 ║  PASSED WITH WARNINGS -- review recommended before commit   ║
 ╚══════════════════════════════════════════════════════════════╝
```
{{else}}
```
 ╔══════════════════════════════════════════════════════════════╗
 ║  PASSED -- no issues detected, clear to commit              ║
 ╚══════════════════════════════════════════════════════════════╝
```
{{/if}}

---

## Findings by File

{{#each files_with_findings}}

### `{{file_path}}` ({{finding_count}} finding(s))

{{#each findings}}

```
 ┌──────────────────────────────────────────────────────────────┐
 │ [{{severity_badge}}] Finding #{{finding_number}}: {{title}}
 └──────────────────────────────────────────────────────────────┘
```

**Pattern:** `{{pattern_id}}`
**Severity:** {{severity}} | **Confidence:** {{confidence}}%
**Location:** `{{file}}:{{line}}`

#### Description

{{description}}

#### Evidence

{{evidence}}

#### Diff Context

The relevant code surrounding the finding (3 lines before and after):

```{{language}}
  {{context_before_1}}
  {{context_before_2}}
  {{context_before_3}}
> {{current_code_line}}
  {{context_after_1}}
  {{context_after_2}}
  {{context_after_3}}
```

#### Current Code

```{{language}}
{{current_code}}
```

#### Suggested Fix

```{{language}}
{{fixed_code}}
```

#### Fix Preview (diff)

```diff
{{#each diff_lines}}
{{this}}
{{/each}}
```

```
 ├──────────────────────────────────────────────────────────────┤
 │ Apply:   "Apply fix for finding #{{finding_number}}."
 │ Dismiss: "Dismiss finding #{{finding_number}}: <reason>"
 └──────────────────────────────────────────────────────────────┘
```

{{/each}}
{{/each}}

---

## Actions

### Apply All Fixes

```
 ╔══════════════════════════════════════════════════════════════╗
 ║                                                              ║
 ║   To apply every suggested fix automatically, respond with:  ║
 ║                                                              ║
 ║       Apply all preflight fixes.                             ║
 ║                                                              ║
 ║   Preflight will edit each file at the reported locations,   ║
 ║   replacing the current code with the fixed code. You will   ║
 ║   see each edit as it happens and can undo any individual    ║
 ║   change with your editor's undo command.                    ║
 ║                                                              ║
 ╚══════════════════════════════════════════════════════════════╝
```

### Apply a Single Fix

To apply one specific fix, respond with:

```
Apply fix for finding #{{finding_number}}.
```

### Dismiss a Finding

If a finding is a false positive or intentionally accepted, respond with:

```
Dismiss finding #{{finding_number}}: {{reason}}
```

Dismissed findings are recorded in the session so preflight does not re-flag
them on subsequent runs. Dismissals do not persist across sessions.

### Dismiss All Similar Findings

To batch-dismiss every finding that shares the same pattern, respond with:

```
Dismiss all {{pattern_id}} findings: {{reason}}
```

This dismisses all findings in this report with the pattern `{{pattern_id}}`
at once. Useful when a pattern triggers multiple false positives (for example,
a project that intentionally wraps a non-standard API).

### Re-run Preflight

After applying fixes or making manual changes, respond with:

```
/preflight
```

to re-scan the current diff and confirm all issues are resolved.

---

## Scan Timing

| Phase                | Duration       |
|----------------------|----------------|
| Diff extraction      | {{phase_diff_ms}}ms |
| Project detection    | {{phase_detect_ms}}ms |
| Pattern matching     | {{phase_match_ms}}ms |
| Verification         | {{phase_verify_ms}}ms |
| Report generation    | {{phase_report_ms}}ms |
| **Total**            | **{{scan_duration_ms}}ms** |

---

## Exit Codes

| Code | Meaning                                                          |
|------|------------------------------------------------------------------|
| `0`  | Clean -- no findings. Safe to commit.                            |
| `1`  | Findings exist -- review the report above and resolve or dismiss.|
| `2`  | Error -- preflight encountered an internal error during scan.    |

---

## Understanding This Report (First-Time Users)

<details>
<summary>Click to expand the scoring guide</summary>

### Severity Levels

- **Critical** -- The code will break at runtime or build time. This is not
  a style issue; it is a confirmed or near-certain defect. Commits are blocked
  until critical findings are resolved or explicitly dismissed.
- **High** -- The code is very likely incorrect but may not crash immediately.
  Examples: wrong argument order, missing error handling on I/O, using a
  deprecated API that will be removed. Review strongly recommended.
- **Medium** -- The code is suspicious and may indicate a latent bug. Evidence
  is indirect or the issue depends on runtime conditions. Worth reviewing but
  safe to dismiss if you understand the context.

### Confidence Scores

The confidence percentage reflects how certain preflight is that the finding
is a real bug, **not** how severe the bug would be.

| Range   | Meaning                                                     |
|---------|-------------------------------------------------------------|
| 90-100% | Verified with tool evidence; will break at runtime.         |
| 75-89%  | Strong evidence from types or docs; very likely incorrect.  |
| 60-74%  | Probable issue; evidence is indirect or partial.            |
| <60%    | Below reporting threshold -- these are never shown.         |

Findings below 60% confidence are automatically discarded. If you believe
a reported finding is a false positive, dismiss it with a reason so preflight
can learn from the feedback.

### What "Estimated Fix Time" Means

The estimated fix time is a rough guideline based on the complexity of the
suggested changes. It accounts for the number of findings, the type of fix
(simple rename vs. structural refactor), and whether the fixes are
auto-applicable. It does **not** include time for manual review or testing.

### Diff Context

Each finding includes a "Diff Context" block showing 3 lines before and after
the flagged line (marked with `>`). This helps you see the surrounding code
without switching to your editor.

### Fix Preview (diff)

The "Fix Preview" block shows the exact `diff` output that would result from
applying the suggested fix. Lines prefixed with `-` are removed; lines prefixed
with `+` are added. This lets you review the precise change before applying it.

</details>

---

<!-- Repeat the "Finding" block above for each finding. -->
<!-- The {{#each files_with_findings}} / {{#each findings}} handlebars loop -->
<!-- generates one block per finding, grouped by file.                       -->

<!-- Below is an example of a complete finding as it would appear in output. -->

<!--
### `src/validators/schema.ts` (1 finding(s))

```
 ┌──────────────────────────────────────────────────────────────┐
 │ [CRITICAL] Finding #1: Hallucinated package `zod-mini`
 └──────────────────────────────────────────────────────────────┘
```

**Pattern:** `PHANTOM_PACKAGE`
**Severity:** critical | **Confidence:** 95%
**Location:** `src/validators/schema.ts:3`

#### Description

The import `import { z } from 'zod-mini'` references a package that does not
exist. The correct package name is `zod`. This will fail at build time with
MODULE_NOT_FOUND.

#### Evidence

Ran `grep "zod-mini" package.json` -- no results.
Ran `ls node_modules/zod-mini 2>/dev/null` -- directory does not exist.
Ran `grep "zod" package.json` -- found `"zod": "^3.22.4"` in dependencies.

#### Diff Context

```typescript
  import { NextRequest } from 'next/server';
  import { validateBody } from '../lib/validate';
  import { userSchema } from '../schemas/user';
> import { z } from 'zod-mini';
  import { db } from '../lib/db';
  import { hashPassword } from '../lib/auth';
  import { ApiError } from '../lib/errors';
```

#### Current Code

```typescript
import { z } from 'zod-mini';
```

#### Suggested Fix

```typescript
import { z } from 'zod';
```

#### Fix Preview (diff)

```diff
- import { z } from 'zod-mini';
+ import { z } from 'zod';
```

```
 ├──────────────────────────────────────────────────────────────┤
 │ Apply:   "Apply fix for finding #1."
 │ Dismiss: "Dismiss finding #1: <reason>"
 └──────────────────────────────────────────────────────────────┘
```
-->
