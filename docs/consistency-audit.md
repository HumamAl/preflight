# Preflight Consistency Audit

**Date:** 2026-03-23
**Files audited:**
- `skills/preflight/SKILL.md`
- `agents/bug-detector.md`
- `agents/security-scanner.md`
- `agents/test-gap-analyzer.md`
- `.claude/rules/preflight-conventions.md`
- `templates/report.md`
- `data/ai-failure-patterns.json`
- `CLAUDE.md`

---

## Inconsistency #1: Confidence Scoring Formula Mismatch (SKILL.md vs security-scanner.md)

**Severity:** HIGH -- agents will compute different scores for the same finding.

SKILL.md (Step 4a) defines a **3-factor** formula with these weights:

```
confidence = (evidence * 0.50) + (pattern * 0.30) + (convention * 0.20)
```

security-scanner.md defines a **4-factor** formula with different weights:

```
confidence = (evidence * 0.40) + (pattern * 0.30) + (convention * 0.20) + (history * 0.10)
```

The security scanner adds a "Historical accuracy" factor worth 10% and reduces evidence weight from 50% to 40%. The security scanner's text even says "Compute confidence using the SKILL.md weighted formula" -- but then provides a different formula.

bug-detector.md does not include a formula at all; it uses a narrative-based confidence scoring system (ranges: 90-100, 70-89, 60-69, below 60) without explicit weights.

**Source of truth:** `skills/preflight/SKILL.md` (the orchestrator that combines all agent results).

**What needs to change:**
- `agents/security-scanner.md` should either adopt the 3-factor formula from SKILL.md or, if the 4-factor formula is intentional, SKILL.md should be updated to match. The self-contradictory sentence "Compute confidence using the SKILL.md weighted formula" followed by a different formula must be resolved either way.
- `agents/bug-detector.md` should include the same weighted formula for consistency, even if it also keeps its narrative guidance.

---

## Inconsistency #2: Pattern IDs Used by bug-detector.md Do Not Exist in ai-failure-patterns.json

**Severity:** MEDIUM -- pattern ID mismatches between agents and data files.

bug-detector.md defines these pattern_id values in its output format:

```
PHANTOM_PACKAGE | HALLUCINATED_API | PLAUSIBLE_WRONG_LOGIC | ASYNC_AWAIT_MISTAKE |
INCORRECT_EVENT_HANDLER | INCORRECT_MIDDLEWARE | DEPRECATED_API |
MISSING_ERROR_HANDLING | CONFIDENT_WRONG_TYPES
```

The categories defined in `ai-failure-patterns.json` are:

```
PHANTOM_PACKAGE, HALLUCINATED_API, PLAUSIBLE_WRONG_LOGIC, DEPRECATED_API,
CONFIDENT_WRONG_TYPES, MISSING_ERROR_HANDLING, ASYNC_MISTAKES,
REACT_MISTAKES, NEXTJS_MISTAKES, DATABASE_MISTAKES, API_MISTAKES
```

Mismatches:
- `ASYNC_AWAIT_MISTAKE` (bug-detector) vs `ASYNC_MISTAKES` (JSON) -- different naming.
- `INCORRECT_EVENT_HANDLER` (bug-detector) -- does not exist in JSON at all. Event handler issues are partially covered under `REACT_MISTAKES`.
- `INCORRECT_MIDDLEWARE` (bug-detector) -- does not exist in JSON at all.
- `REACT_MISTAKES`, `NEXTJS_MISTAKES`, `DATABASE_MISTAKES`, `API_MISTAKES` (JSON) -- not referenced by bug-detector.md's output format.

**Source of truth:** `data/ai-failure-patterns.json` (the canonical pattern database).

**What needs to change:**
- `agents/bug-detector.md` should align its pattern_id enum to use the same category names as the JSON file, or new categories should be added to the JSON for `INCORRECT_EVENT_HANDLER` and `INCORRECT_MIDDLEWARE`.
- `ASYNC_AWAIT_MISTAKE` should be renamed to `ASYNC_MISTAKES` (or vice versa).

---

## Inconsistency #3: SKILL.md Pattern ID Format vs Agent Pattern ID Format

**Severity:** MEDIUM -- two incompatible naming conventions.

SKILL.md uses **kebab-case with colons** for pattern IDs:
- `phantom-pkg:<package-name>`
- `hallucinated-api:<type>.<method>`
- `wrong-logic:<brief-description>`
- `unsafe-type:<description>`
- `deprecated-api:<api-name>`
- `missing-error-handling:<location>`
- `security:<vulnerability-type>`
- `custom:<rule-name>`

Agent files use **SCREAMING_SNAKE_CASE** without colons:
- `PHANTOM_PACKAGE`
- `HALLUCINATED_API`
- `PLAUSIBLE_WRONG_LOGIC`
- `DEPRECATED_API`
- etc.

These are fundamentally different naming schemes. The SKILL.md scheme includes instance-specific suffixes (e.g., `phantom-pkg:lodash.get`), while agent pattern IDs are category-level only (e.g., `PHANTOM_PACKAGE`).

**Source of truth:** Both have value. The SKILL.md format is richer (category + instance), but the agent format must be parseable by the orchestrator.

**What needs to change:**
- Define one canonical format and use it everywhere. The recommended approach: agents output `PHANTOM_PACKAGE` as the category, and the SKILL.md orchestrator constructs the instance-level pattern ID (e.g., `phantom-pkg:lodash.get`) when generating the report. This should be documented explicitly in SKILL.md's Step 4 or Step 5 so the mapping is clear.

---

## Inconsistency #4: Report Template Format Does Not Match SKILL.md Report Format

**Severity:** HIGH -- the orchestrator and template describe different output structures.

SKILL.md Step 5b defines this report format for each finding:

```
[SEVERITY] Short description
  Confidence: XX/100
  File: path/to/file.ext:line_number
  Pattern: pattern-id

  Detailed explanation...
  Evidence: ...
  Fix:
  - old code
  + new code
```

The `templates/report.md` Mustache template uses a completely different structure:
- Grouped by file, not by severity.
- Uses box-drawing characters for visual framing.
- Includes extra fields: `{{severity_badge}}`, `{{finding_number}}`, `{{context_before_*}}`, `{{context_after_*}}`, `{{diff_lines}}`.
- Has sections for "Diff Context" (3 lines before/after), "Fix Preview (diff)", and interactive action prompts ("Apply fix", "Dismiss finding").
- Includes a full "Scan Timing" table, "Exit Codes" section, and expandable scoring guide.

None of these template features are described in SKILL.md's Step 5.

**Source of truth:** `templates/report.md` (it is the more complete and polished format).

**What needs to change:**
- SKILL.md Step 5b should reference the template file (`templates/report.md`) instead of defining its own inline format, or the two should be reconciled into one format. Currently a developer reading SKILL.md would produce output that does not match the template.

---

## Inconsistency #5: Agent Output Formats Are Not Uniform

**Severity:** MEDIUM -- the orchestrator must handle different field sets from each agent.

All three agents use the `FINDING:` block structure, but the fields differ:

| Field | bug-detector.md | security-scanner.md | test-gap-analyzer.md |
|-------|:-:|:-:|:-:|
| `pattern_id` | Yes | Yes | Yes |
| `severity` | Yes | Yes | Yes |
| `confidence` | Yes | Yes | Yes |
| `file` | Yes | Yes | Yes |
| `title` | Yes (max 80 chars) | Yes (no char limit noted) | Yes (no char limit noted) |
| `description` | Yes | Yes | Yes |
| `evidence` | Yes | Yes | Yes |
| `current_code` | Yes | Yes | No |
| `fixed_code` | Yes | Yes | No |
| `suggested_test` | No | No | Yes |

The test-gap-analyzer uses `suggested_test` instead of `current_code` / `fixed_code`. This is reasonable given its purpose, but the orchestrator (SKILL.md) and the report template both assume `current_code` and `fixed_code` are present. The template has `{{current_code}}` and `{{fixed_code}}` placeholders with no fallback for `suggested_test`.

**Source of truth:** The report template should handle all agent outputs.

**What needs to change:**
- `templates/report.md` needs a conditional section for test-gap-analyzer findings that renders `suggested_test` instead of `current_code`/`fixed_code`.
- Alternatively, test-gap-analyzer could output `current_code` (empty or with the untested code) and `fixed_code` (with the test skeleton), but this would be semantically misleading.

---

## Inconsistency #6: Severity Level "low" Exists Only in test-gap-analyzer.md

**Severity:** MEDIUM -- inconsistent severity vocabulary across the system.

Every other file uses three severity levels: `critical`, `high`, `medium`.

test-gap-analyzer.md uses: `medium | low`.

The `low` severity does not appear in:
- SKILL.md's severity assignment (Step 5c) -- only defines CRITICAL, HIGH, MEDIUM.
- CLAUDE.md's severity hierarchy -- "CRITICAL = runtime crash or security breach; HIGH = incorrect behavior; MEDIUM = convention deviation or code smell."
- `templates/report.md` -- the severity guide only defines Critical, High, Medium.
- `preflight-conventions.md` -- confidence calibration table has no "low" row.

This means the orchestrator and report template have no handling for `low` severity findings from the test-gap-analyzer.

**Source of truth:** `agents/test-gap-analyzer.md` is reasonable in using `low` for advisory findings, but the rest of the system needs to accommodate it.

**What needs to change:**
- Add `low` to the severity vocabulary in SKILL.md Step 5c, CLAUDE.md's Key Conventions, and `templates/report.md`'s severity guide and summary table (add a `{{low_count}}` field).
- OR: Change test-gap-analyzer.md to use only `medium` (collapsing its `low` findings into `medium`).

---

## Inconsistency #7: CLAUDE.md File Structure Is Outdated

**Severity:** HIGH -- developers relying on CLAUDE.md will have a wrong mental model.

CLAUDE.md lists this file structure:

```
preflight/
  .claude-plugin/plugin.json
  hooks/hooks.json
  skills/preflight/
    SKILL.md
    scripts/get-staged-diff.sh
  agents/
    bug-detector.md
    security-scanner.md
    test-gap-analyzer.md
  data/
    ai-failure-patterns.json
    deprecated-apis.json
    phantom-packages.json
  templates/
    report.md
  .claude/rules/
    preflight-conventions.md
  tests/fixtures/
```

Actual file structure has these differences:

1. **Missing from CLAUDE.md:**
   - `scripts/` directory (contains `test-detection.sh`, `validate-plugin.sh`)
   - `docs/` directory (contains `competitive-analysis.md`)
   - `data/false-positive-mitigations.json`
   - `skills/preflight-dismiss/SKILL.md`
   - `skills/preflight-quick/` (directory exists, appears empty)
   - `skills/preflight-stats/SKILL.md`
   - `CLAUDE.md` itself (not listed, understandable)
   - `README.md`
   - `LICENSE`
   - Additional test fixtures: `go-phantom-import.go`, `mixed-issues.ts`, `python-clean.py`, `python-hallucinated-api.py`, `python-phantom-package.py`, `python-security.py`

2. **CLAUDE.md says test fixtures cover:** `phantom-package.ts`, `hallucinated-api.ts`, `plausible-wrong-logic.ts`, `deprecated-api.ts`, `security-issues.ts`, `clean-code.ts`. The actual directory has those plus six more files.

**Source of truth:** The actual filesystem.

**What needs to change:**
- CLAUDE.md's "File Structure" section must be updated to reflect the actual tree, including the `scripts/`, `docs/`, `data/false-positive-mitigations.json`, the additional skill directories, and all test fixture files.

---

## Inconsistency #8: Confidence Threshold Is Consistent (No Issue Found)

SKILL.md default threshold: **60** (Step 2: `THRESHOLD = 60`).
preflight-conventions.md threshold: **60** ("The reporting threshold is 60").
security-scanner.md threshold: **60** ("Reporting threshold: 60").
bug-detector.md threshold: **60** ("Confidence threshold is 60" in Rule 4).
test-gap-analyzer.md threshold: **60** ("The reporting threshold is 60").

All files agree. No inconsistency.

---

## Inconsistency #9: "Always Flag" Lists Are Inconsistent Between SKILL.md and Conventions

**Severity:** MEDIUM -- agents guided by different files will flag different things.

SKILL.md (Check 6, "Always flag these regardless of convention") lists only three error-handling-specific items:
1. `JSON.parse()` on user input without try/catch
2. `fetch()` without checking `response.ok`
3. `fs.readFile` / `fs.writeFile` without error handling

preflight-conventions.md (Section 4, "Always Flag") lists **19 items** spanning multiple categories:
- Imports of packages not in the manifest
- Method calls on nonexistent APIs
- `bcrypt.compare(hash, plain)` argument swap
- `JSON.parse()` without try/catch
- `await` inside `.forEach()`
- Missing `await` on async functions
- Type assertions bypassing runtime checks
- `.query` on `useRouter()` from `next/navigation`
- Vue `ref()` without `.value` / with `.value` in template
- Vue `reactive()` destructuring without `toRefs()`
- SvelteKit `error()`/`redirect()`/`fail()` caught by try/catch
- SvelteKit `$lib/server/` imported in universal module
- Go unchecked error returns
- Rust `unwrap()` in library/server code
- Python blocking I/O in async FastAPI handlers
- Django `ForeignKey` without `on_delete`
- Django mutable defaults on model fields
- Rust `unsafe` without `// SAFETY:` comment
- Rust `MutexGuard` held across `.await`
- Rust `.map()` without consuming the iterator

The SKILL.md "always flag" list is a small subset of the conventions "always flag" list. The SKILL.md list is scoped only to error-handling, while the conventions file covers all categories.

**Source of truth:** `preflight-conventions.md` (it is the comprehensive reference).

**What needs to change:**
- This is partially a context issue -- SKILL.md's "always flag" is specifically within Check 6 (Missing Error Handling), so the scope is intentionally narrower. However, SKILL.md should explicitly reference the full "Always Flag" list in preflight-conventions.md somewhere (e.g., in Step 3a preamble) so that agents know to consult it for all checks, not just error handling.

---

## Inconsistency #10: "Never Flag" Lists Are Partially Misaligned

**Severity:** LOW -- the SKILL.md list is a subset but does not contradict.

SKILL.md (Check 5, step 3, "Do NOT flag the following as deprecated") lists:
- `var` instead of `let`/`const`
- `any` type in TypeScript
- String concatenation instead of template literals
- Missing return type annotations
- Unused variables or imports
- Preference for one library over another

preflight-conventions.md (Section 4, "Never Flag") lists:
- Code style, formatting, or naming preferences
- Missing comments or documentation (except `// SAFETY:` on Rust `unsafe`)
- "Could be more efficient" suggestions without a concrete bug
- Use of `any` type
- Missing return type annotations
- Unused variables or imports
- Preference for one library over another
- Nuxt auto-imported functions used without explicit imports
- Use of `clone()` in Rust

The SKILL.md list is a subset. There is no contradiction, but SKILL.md's "never flag" is only in the context of deprecated APIs, while the conventions file applies globally. SKILL.md is missing the broader items: "Could be more efficient" suggestions, Nuxt auto-imports, Rust `clone()`.

**Source of truth:** `preflight-conventions.md`.

**What needs to change:**
- SKILL.md should reference the full "Never Flag" list from conventions rather than maintaining a partial copy. This prevents future drift.

---

## Inconsistency #11: SKILL.md Report Format (Step 5b) vs Agent Output Format

**Severity:** MEDIUM -- the SKILL.md finding format does not match what agents produce.

SKILL.md Step 5b defines this finding structure:

```
[SEVERITY] Short description
  Confidence: XX/100
  File: path/to/file.ext:line_number
  Pattern: pattern-id
  ...
  Fix:
  - old code
  + new code
```

All three agents output this structure:

```
FINDING:
  pattern_id: ...
  severity: ...
  confidence: ...
  file: ...
  title: ...
  description: ...
  evidence: ...
  current_code: |
    ...
  fixed_code: |
    ...
```

These are structurally different. SKILL.md's format uses `[SEVERITY]` as a prefix, `Confidence: XX/100`, `Pattern:`, and inline diff-style fixes. Agent format uses YAML-like key-value pairs with `FINDING:` block markers.

The SKILL.md format appears to be the intended *final* output (what the user sees), while the agent format is the intermediate output (what the orchestrator receives). But SKILL.md never describes the transformation between them.

**Source of truth:** SKILL.md should document both: the agent output format (input to the orchestrator) and the final user-facing format.

**What needs to change:**
- SKILL.md Step 4 or Step 5 should document how agent `FINDING:` blocks are transformed into the user-facing report format (either the Step 5b format or the `templates/report.md` template).

---

## Inconsistency #12: CLAUDE.md Describes ai-failure-patterns.json Schema Incorrectly

**Severity:** LOW -- affects only developers adding new patterns.

CLAUDE.md says:

> `ai-failure-patterns.json` -- array of pattern objects with `pattern`, `category`, `description`, and `examples` fields.

The actual JSON structure is:
- Top-level object with `metadata`, `categories`, and `patterns` keys.
- `categories` is an array of `{ id, label, description, severity_range }` objects.
- `patterns` is an array of objects with `id`, `category`, `name`, `description`, `severity`, `detection_strategy`, `sub_patterns`, etc.
- There is no top-level `pattern` field per object. The field names are `id`, `category`, `name`, not `pattern`, `category`, `description`.

**Source of truth:** The actual JSON file.

**What needs to change:**
- CLAUDE.md's "How to Add New Patterns" section should describe the actual schema: top-level `{ metadata, categories, patterns }`, with patterns having `id`, `category`, `name`, `description`, `severity`, `detection_strategy`, `sub_patterns`, etc.

---

## Inconsistency #13: Security Scanner Says "SKILL.md weighted formula" But Uses a Different One

**Severity:** HIGH -- this is the same issue as #1 but worth calling out as a separate documentation bug.

`agents/security-scanner.md` line 571 states:

> Compute confidence using the SKILL.md weighted formula:

Then immediately provides a 4-factor formula that differs from SKILL.md's 3-factor formula. This is self-contradictory within the same sentence. Either the security scanner's formula should be updated to match SKILL.md, or the text should not claim it matches.

**Source of truth:** `skills/preflight/SKILL.md`.

**What needs to change:**
- Fix the sentence to say "Compute confidence using the following weighted formula:" and either adopt SKILL.md's formula or explicitly note the deviation.

---

## Inconsistency #14: maxTurns Mismatch Between CLAUDE.md Template and Actual Agents

**Severity:** LOW -- affects only new agent creation.

CLAUDE.md's "How to Add New Detection Agents" section shows a template with `maxTurns: 20`.

Actual agents use:
- `bug-detector.md`: `maxTurns: 25`
- `security-scanner.md`: `maxTurns: 25`
- `test-gap-analyzer.md`: `maxTurns: 20`

Two of three agents use 25, not 20.

**Source of truth:** The actual agents.

**What needs to change:**
- CLAUDE.md template should use `maxTurns: 25` or note that this value should be tuned per agent.

---

## Summary Table

| # | Inconsistency | Severity | Source of Truth | Files to Fix |
|---|---------------|----------|-----------------|-------------|
| 1 | Confidence formula: 3-factor (SKILL.md) vs 4-factor (security-scanner.md) | HIGH | SKILL.md | security-scanner.md, bug-detector.md |
| 2 | Pattern IDs: bug-detector uses IDs not in ai-failure-patterns.json | MEDIUM | ai-failure-patterns.json | bug-detector.md (or JSON) |
| 3 | Pattern ID format: kebab-case (SKILL.md) vs SCREAMING_SNAKE_CASE (agents) | MEDIUM | Both (needs mapping docs) | SKILL.md |
| 4 | Report format: SKILL.md Step 5b vs templates/report.md | HIGH | templates/report.md | SKILL.md |
| 5 | Agent output fields differ (current_code/fixed_code vs suggested_test) | MEDIUM | templates/report.md | templates/report.md |
| 6 | Severity level "low" only in test-gap-analyzer.md | MEDIUM | test-gap-analyzer.md | SKILL.md, CLAUDE.md, templates/report.md |
| 7 | CLAUDE.md file structure is outdated | HIGH | Actual filesystem | CLAUDE.md |
| 8 | Confidence threshold = 60 everywhere | None | -- | -- (consistent) |
| 9 | "Always flag" list much smaller in SKILL.md than conventions | MEDIUM | preflight-conventions.md | SKILL.md |
| 10 | "Never flag" list partial in SKILL.md vs conventions | LOW | preflight-conventions.md | SKILL.md |
| 11 | SKILL.md report format vs agent FINDING: block format | MEDIUM | SKILL.md | SKILL.md (document transformation) |
| 12 | CLAUDE.md describes wrong JSON schema for ai-failure-patterns.json | LOW | ai-failure-patterns.json | CLAUDE.md |
| 13 | Security scanner claims to use SKILL.md formula but doesn't | HIGH | SKILL.md | security-scanner.md |
| 14 | CLAUDE.md agent template says maxTurns: 20, but 2/3 agents use 25 | LOW | Actual agents | CLAUDE.md |
