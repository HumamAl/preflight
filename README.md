[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude_Code-plugin-7C3AED)](https://docs.anthropic.com/en/docs/claude-code)
[![Version](https://img.shields.io/badge/version-0.1.0-green.svg)](https://github.com/HumamAl/preflight/releases)

# /preflight

**AI-generated code ships 1.7x more bugs than human-written code.** Your linter catches none of them. Your reviewer catches them after they hit production. /preflight catches them before they leave your machine.

> A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin that intercepts `git commit` and verifies AI-generated code for hallucinated APIs, phantom packages, and plausible-but-wrong logic -- the failure modes no existing tool catches.

---

## See it in action

```
 BEFORE /preflight                          AFTER /preflight
 ─────────────────                          ────────────────

 $ git commit -m "add validation"           $ git commit -m "add validation"
 [main 3a1f9c2] add validation
  3 files changed, 47 insertions(+)         /preflight: analyzing 3 files...

 # Looks fine. Ships to staging.            CRITICAL  src/utils/validation.ts:3
 # 2 hours later:                             Import from nonexistent package
                                              'zod-lite'. Correct package: 'zod'.
 TypeError: Cannot find module               Evidence: npm search returned 0 results.
   'zod-lite'                                 Fix: import { z } from 'zod';

 ReferenceError: response.metadata          CRITICAL  src/api/client.ts:47
   is not a function                          Property 'metadata' does not exist
                                              on fetch Response. Properties are:
 # Debug for 45 minutes.                      body, headers, ok, status, url.
 # Realize Claude hallucinated both.          Fix: const body = await response.json();
 # Mass-replace, re-test, re-deploy.
                                            MEDIUM  src/services/config.ts:22
                                              JSON.parse without try/catch.
                                              8 of 9 other call sites wrap this.
                                              Fix: try { JSON.parse(raw) } catch...

                                            Commit blocked. 3 findings. Fix and retry.
```

---

## Why this exists

AI coding tools are extraordinary. They are also confidently wrong in ways that slip past every existing check.

- **1.7x more issues** than human-written code -- [CodeRabbit State of AI in Code Reviews, 2025](https://www.coderabbit.ai/blog/the-state-of-ai-code-review-2025)
- **66% of developers** say "almost right but not quite" is their top AI frustration -- [Stack Overflow Developer Survey, 2025](https://survey.stackoverflow.co/2025/)
- **19% slower** task completion when using AI assistants on unfamiliar codebases -- [METR Study, 2025](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)
- LLMs hallucinate with confidence: fabricated package names, methods that do not exist on the types they reference, inverted conditions that read naturally but fail at runtime

Every existing code review tool checks **after you push**. /preflight checks **before you commit**. That timing difference is the entire point. By the time a post-push reviewer flags a hallucinated API, it has already been deployed, debugged, and cost you an afternoon.

---

## Quick comparison

| | **/preflight** | **CodeRabbit** | **Copilot Review** |
|---|---|---|---|
| **When it runs** | Before commit (local) | After push (PR) | After push (PR) |
| **AI-specific patterns** | Yes -- phantom packages, hallucinated APIs, wrong argument order | General code quality | General code quality |
| **Fix generation** | Every finding includes `fixed_code` | Suggestions in PR comments | Suggestions in PR comments |
| **Verification method** | Checks against your actual `node_modules`, type definitions, and source | LLM analysis of diff | LLM analysis of diff |
| **False positive control** | Confidence scoring (0-100) + evidence requirement + memory | LLM judgment | LLM judgment |
| **Setup** | One command, no config | GitHub app + config | GitHub Copilot subscription |
| **Cost** | Free (uses your Claude Code session) | Free tier + paid plans | Included with Copilot |
| **Complementary?** | Use /preflight locally, CodeRabbit/Copilot on PR | Yes | Yes |

These tools are complementary. /preflight catches AI-specific bugs locally before they ever reach a PR reviewer.

---

## Install

```bash
claude plugin install github:HumamAl/preflight
```

That is it. No config files, no CI setup, no API keys. The plugin activates immediately on your next Claude Code session.

---

## What it catches

| Category | Severity | Example |
|---|---|---|
| **Phantom packages** | Critical | `import { merge } from 'lodash-utils'` -- package does not exist |
| **Hallucinated APIs** | Critical | `response.metadata` on a fetch Response that has no `.metadata` property |
| **Plausible-but-wrong logic** | High | `bcrypt.compare(hash, plain)` -- arguments are swapped |
| **Confident wrong types** | High | `as unknown as User` bypassing type safety with no runtime check |
| **Deprecated API usage** | Medium | `ReactDOM.render()` in a React 18 project |
| **Missing error handling** | Medium | `JSON.parse(input)` without try/catch when the rest of the codebase wraps it |
| **Test coverage gaps** | Medium | New exported function with zero test coverage (with `--test-gaps`) |
| **Security vulnerabilities** | Varies | Unsanitized user input in SQL queries (with `--security`) |

---

## What it does NOT catch

Being honest about limitations:

- **Style and formatting.** Use Prettier or ESLint for that. /preflight only catches bugs.
- **Architecture decisions.** It will not tell you to use a different pattern or library.
- **Performance issues.** Unless the code is broken, /preflight does not flag "could be faster."
- **Non-AI bugs.** The detection patterns are weighted toward LLM failure modes. A null pointer you wrote yourself might slip through.
- **Languages beyond JS/TS/Python.** Logic checks work broadly, but phantom package databases and API verification have deep coverage only for JavaScript, TypeScript, and Python today.

If you want a general-purpose code reviewer, use CodeRabbit or Copilot Review. If you want to catch the specific class of bugs that AI introduces before they leave your machine, use /preflight.

---

## Usage

**Automatic** -- /preflight intercepts every `git commit` via a PreToolUse hook. Claude will run the verification and block the commit until it passes.

**Manual** -- run the slash command anytime to verify uncommitted changes:

```
/preflight
```

**Flags:**

```
/preflight              # standard check (confidence threshold: 80)
/preflight --strict     # lower threshold (60) -- catches more, may have false positives
/preflight --paranoid   # lowest threshold (40) -- flags anything remotely suspicious
/preflight --security   # include security vulnerability scan
/preflight --test-gaps  # include test coverage gap analysis
```

---

## How it works

```
  git commit (intercepted by PreToolUse hook)
       |
       v
  +-----------------+
  | get-staged-diff | ---- extracts staged/unstaged changes
  +-----------------+
       |
       v
  +----+----+
  |         |
  v         v
bug-      test-gap-
detector  analyzer      <-- subagent specialists (run in parallel)
  |         |
  v         v
  +---------+
  | merge findings, apply confidence threshold
  +---------+
       |
       v
  +---------+-----+
  | pass          | fail
  v               v
  commit          block + show report with
  proceeds        findings and fix suggestions
```

1. **Hook triggers.** The PreToolUse hook detects `git commit` commands and injects a directive to run /preflight first.
2. **Diff extraction.** `get-staged-diff.sh` pulls the staged diff (or falls back to unstaged changes). POSIX-compliant, no dependencies.
3. **Subagent analysis.** Two specialized agents run against the diff:
   - `bug-detector` -- checks for phantom packages, hallucinated APIs, wrong logic, deprecated usage, missing error handling, and wrong types. Verifies every finding with actual tool use against the project's `node_modules`, type definitions, and source files.
   - `test-gap-analyzer` -- maps changed files to test files and identifies untested functions, error paths, and edge cases.
4. **Confidence scoring.** Each finding gets a 0-100 confidence score. Only findings above the threshold (default 80) are reported. This is how false positives are controlled.
5. **Fix generation.** Every reported finding includes a concrete `fixed_code` suggestion, not just a description of what is wrong.

---

## Example output

```
FINDING:
  pattern_id: PHANTOM_PACKAGE
  severity: critical
  confidence: 95
  file: src/utils/validation.ts:3
  title: Import from nonexistent package 'zod-lite'
  description: The package 'zod-lite' does not exist on npm. The correct
    package is 'zod'. This is a known LLM hallucination pattern.
  evidence: grep 'zod-lite' package.json returned no match.
    ls node_modules/zod-lite returned "No such file or directory".
    npm search zod-lite returned zero results.
  current_code: |
    import { z } from 'zod-lite';
  fixed_code: |
    import { z } from 'zod';

FINDING:
  pattern_id: HALLUCINATED_API
  severity: critical
  confidence: 92
  file: src/api/client.ts:47
  title: Property 'metadata' does not exist on fetch Response
  description: The Fetch API Response object does not have a .metadata
    property. The code should access response headers or parse the JSON
    body instead.
  evidence: grep -r "metadata" node_modules/typescript/lib/lib.dom.d.ts
    shows no 'metadata' on Response interface. Response properties are:
    body, bodyUsed, headers, ok, redirected, status, statusText, type, url.
  current_code: |
    const data = response.metadata.results;
  fixed_code: |
    const body = await response.json();
    const data = body.results;
```

When all checks pass:

```
No AI-specific bugs detected in this diff.
```

---

## Configuration

### Confidence thresholds

| Mode | Threshold | Use case |
|---|---|---|
| Default | 80 | Daily use. High precision, minimal false positives. |
| `--strict` | 60 | Pre-release verification. Catches more at the cost of some noise. |
| `--paranoid` | 40 | Security-critical code. Flags anything remotely suspicious. |

### Custom rules

Add project-specific rules in `.claude/preflight/rules.md`:

```markdown
# Project-specific preflight rules

- All database queries must use the `db.safeQuery()` wrapper, never raw `db.query()`.
- API routes must validate request body with zod schemas.
- Never use `console.log` in production code; use the `logger` module.
```

### Shared memory

`/preflight` tracks dismissed findings in `.claude/preflight/memory.json` to reduce repeat false positives. Commit this file to share learned context with your team.

---

## FAQ

**How is this different from CodeRabbit / Codacy / Sonar?**
Those tools review code after you push. /preflight runs before you commit. They are general-purpose; /preflight specializes in the failure modes unique to LLM-generated code: fabricated packages, nonexistent APIs, subtly wrong argument orders. They are complementary -- use both.

**Doesn't Claude already have /review?**
`/review` is a generic code review. /preflight is specialized: it maintains a database of known AI hallucination patterns (phantom package names, deprecated API mixups, common argument swaps) and verifies every finding against your actual project state with tool use. It does not speculate.

**What about false positives?**
Confidence scoring is the primary defense. The default threshold of 80 is deliberately conservative. Every finding must be backed by evidence gathered through actual tool use -- grep results, file reads, type definition lookups. If a finding cannot be proven, it is discarded. Dismissed findings are tracked in memory to avoid repeats.

**How fast is it?**
Typically under 30 seconds for a normal commit. The two subagents run in parallel. Large diffs (500+ lines changed) may take longer.

**Does it work with non-AI code?**
Yes. Phantom packages, hallucinated APIs, and missing error handling are bugs regardless of who wrote the code. But the detection patterns are weighted toward the mistakes LLMs make most often, so it is most valuable on AI-assisted codebases.

**What languages are supported?**
JavaScript, TypeScript, and Python have the deepest coverage (phantom package databases, API verification, deprecated pattern lists). The logic checks (inverted conditions, swapped arguments, missing error handling) work across any language.

---

## Project structure

```
preflight/
  .claude-plugin/
    plugin.json              # Plugin manifest
  .claude/
    rules/                   # Custom rule overrides
  agents/
    bug-detector.md          # Core verification agent
    test-gap-analyzer.md     # Test coverage agent
  hooks/
    hooks.json               # PreToolUse + SessionStart hooks
  skills/
    preflight/
      scripts/
        get-staged-diff.sh   # Diff extraction (POSIX sh)
  data/                      # Pattern databases (phantom packages, deprecated APIs)
  templates/                 # Report templates
  tests/
    fixtures/                # Test cases for verification
```

---

## Contributing

Contributions are welcome. Here is how to get started with the most common types.

### Add a new hallucination pattern

1. Open `agents/bug-detector.md`
2. Find the detection category that fits (phantom packages, hallucinated APIs, wrong logic, etc.)
3. Add the pattern with:
   - A clear description of the hallucination
   - At least one real-world example
   - Verification steps (how to prove it is wrong using tool calls)
   - A `fixed_code` example
4. Open a PR

### Report a false positive

Open an issue with:
- The full finding output
- Why it was incorrect
- The code that triggered it
- What the correct behavior should be

This is one of the most valuable contributions. Every false positive report makes /preflight better for everyone.

### Add language support

The agent instructions in `agents/` are language-aware. To add a new language:
1. Add package manager verification commands (equivalent to `npm search` / `pip show`)
2. Add type definition lookup strategies
3. Add common hallucination patterns specific to that language's ecosystem
4. Add test fixtures in `tests/fixtures/`

---

## Research and references

The problem /preflight solves is backed by real data:

- [CodeRabbit: State of AI in Code Reviews, 2025](https://www.coderabbit.ai/blog/the-state-of-ai-code-review-2025) -- AI-generated code ships 1.7x more issues than human-written code
- [Stack Overflow Developer Survey, 2025](https://survey.stackoverflow.co/2025/) -- 66% of developers cite "almost right but not quite" as their top AI frustration
- [METR: AI-Assisted Development Study, 2025](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) -- 19% slower task completion when using AI on unfamiliar codebases, largely due to debugging hallucinated code

---

## What AI bugs have you encountered?

We built /preflight because we kept losing time to the same patterns: phantom packages, APIs that do not exist, argument orders that look right but are not. We are curious what patterns others are hitting.

If you have a war story about an AI hallucination that cost you real debugging time, open a discussion thread or drop it in an issue. The more patterns we catalog, the better this gets.

---

## License

MIT
