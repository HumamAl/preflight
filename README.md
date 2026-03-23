[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude_Code-plugin-7C3AED)](https://docs.anthropic.com/en/docs/claude-code)
[![Version](https://img.shields.io/badge/version-0.1.0-green.svg)](https://github.com/HumamAl/preflight/releases)

# /preflight

**AI-generated code ships with bugs your linter will never catch.** Hallucinated APIs, phantom packages, arguments in the wrong order -- all confident, all plausible, all wrong. /preflight catches them before they leave your machine.

> A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin that intercepts `git commit` and verifies AI-generated code for hallucinated APIs, phantom packages, and plausible-but-wrong logic -- the failure modes no existing tool detects.

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

## Quick start

```bash
# Install the plugin (one command, no config, no API keys)
claude plugin install github:HumamAl/preflight

# That's it. On your next commit, /preflight runs automatically.
# Or run it manually anytime:
/preflight

# Want deeper checks?
/preflight --security           # add OWASP top 10 + secret detection
/preflight --strict             # lower confidence threshold, catch more
/preflight src/api/**           # scope to specific files
```

---

## Why this exists

AI coding tools are extraordinary. They are also confidently wrong in ways that slip past every existing check.

- **1.7x more issues** in AI-generated code than human-written code -- [CodeRabbit State of AI in Code Reviews, 2025](https://www.coderabbit.ai/blog/the-state-of-ai-code-review-2025)
- **66% of developers** say "almost right but not quite" is their top AI frustration -- [Stack Overflow Developer Survey, 2025](https://survey.stackoverflow.co/2025/)
- **19% slower** task completion when using AI assistants on unfamiliar codebases -- [METR Study, 2025](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)
- LLMs hallucinate with confidence: fabricated package names, methods that do not exist on the types they reference, inverted conditions that read naturally but fail at runtime

Every existing code review tool checks **after you push**. /preflight checks **before you commit**. That timing difference is the entire point. By the time a post-push reviewer flags a hallucinated API, it has already been deployed, debugged, and cost you an afternoon.

---

## Quick comparison

| | **/preflight** | **CodeRabbit** | **Copilot Review** |
|---|---|---|---|
| **When it runs** | Before commit (local) | After push (PR) | After push (PR) |
| **AI-specific patterns** | Phantom packages, hallucinated APIs, wrong argument order | General code quality | General code quality |
| **Fix generation** | Every finding includes `fixed_code` | Suggestions in PR comments | Suggestions in PR comments |
| **Verification method** | Checks against your actual `node_modules`, type definitions, and source | LLM analysis of diff | LLM analysis of diff |
| **False positive control** | Confidence scoring (0-100) + evidence requirement + memory | LLM judgment | LLM judgment |
| **Setup** | One command, no config | GitHub app + config | GitHub Copilot subscription |
| **Cost** | Free (uses your Claude Code session) | Free tier + paid plans | Included with Copilot |
| **Complementary?** | Use /preflight locally, CodeRabbit/Copilot on PR | Yes | Yes |

These tools solve different problems at different stages. /preflight catches AI-specific bugs locally before they ever reach a PR reviewer. Use them together.

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
| **Security vulnerabilities** | Varies | Unsanitized user input in SQL queries (with `--security`) |

The pattern database currently covers 31 AI failure patterns, 128 known phantom package names (79 npm, 49 Python), and 180 deprecated API entries across 11 ecosystems.

---

## What it does NOT catch

Being honest about limitations:

- **Style and formatting.** Use Prettier or ESLint. /preflight only catches bugs.
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
/preflight                   # standard check (confidence threshold: 60)
/preflight --strict          # lower threshold (40) -- catches more, may have false positives
/preflight --paranoid        # lowest threshold (20) -- flags anything remotely suspicious
/preflight --security        # include OWASP top 10 + secret detection scan
/preflight src/api/**        # scope to files matching a glob pattern
```

**Dismiss false positives:**

```
/preflight dismiss PHANTOM_PACKAGE      # stop flagging this pattern
/preflight-stats                        # view accuracy and detection stats
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
  +---------------------------+
  | detect project context    | ---- language, framework, package manager
  +---------------------------+
       |
       v
  +---------------------------+
  | core verification         | ---- phantom packages, hallucinated APIs,
  | (inline in skill)         |      wrong logic, deprecated APIs, missing
  +---------------------------+      error handling, custom rules
       |
       +------ --security flag? ------+
       |                              |
       v                              v
  (skip)                     +--------------------+
                             | security-scanner   | ---- OWASP top 10,
                             | (subagent)         |      secrets, injection
                             +--------------------+
       |                              |
       v                              v
  +-----------------------------------+
  | merge findings, apply confidence  |
  | threshold, check dismissed list   |
  +-----------------------------------+
       |
       v
  +----------+-----+
  | pass           | fail
  v                v
  commit           block + show report with
  proceeds         findings and fix suggestions
```

1. **Hook triggers.** The PreToolUse hook detects `git commit`, `git push`, and `git merge` commands and injects a directive to run /preflight first.
2. **Diff extraction.** `get-staged-diff.sh` pulls the staged diff (or falls back to unstaged changes). POSIX-compliant, no dependencies.
3. **Project detection.** /preflight fingerprints your project: language, framework, package manager, test runner, error handling conventions. This context shapes what gets flagged and what gets accepted.
4. **Core verification.** The skill checks for phantom packages, hallucinated APIs, wrong logic, deprecated usage, missing error handling, and custom rules. Every finding is verified with actual tool use against the project's `node_modules`, type definitions, and source files.
5. **Security scanning (optional).** When `--security` is passed, a specialized security-scanner subagent runs OWASP top 10 checks, secret detection, and injection analysis.
6. **Confidence scoring.** Each finding gets a 0-100 confidence score. Only findings above the threshold (default 60) are reported. Findings that cannot be backed by evidence are discarded. This is how false positives are controlled.
7. **Fix generation.** Every reported finding includes a concrete `fixed_code` suggestion, not just a description of what is wrong.

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
| Default | 60 | Daily use. High precision, minimal false positives. |
| `--strict` | 40 | Pre-release verification. Catches more at the cost of some noise. |
| `--paranoid` | 20 | Security-critical code. Flags anything remotely suspicious. |

### Custom rules

Add project-specific rules in `.claude/preflight/rules.md`:

```markdown
# Project-specific preflight rules

- All database queries must use the `db.safeQuery()` wrapper, never raw `db.query()`.
- API routes must validate request body with zod schemas.
- Never use `console.log` in production code; use the `logger` module.
```

### Shared memory

/preflight tracks dismissed findings in `.claude/preflight/memory.json` to reduce repeat false positives. Commit this file to share learned context with your team.

---

## FAQ

**How is this different from CodeRabbit / Codacy / Sonar?**
Those tools review code after you push. /preflight runs before you commit. They are general-purpose; /preflight specializes in the failure modes unique to LLM-generated code: fabricated packages, nonexistent APIs, subtly wrong argument orders. They are complementary -- use both.

**Doesn't Claude already have /review?**
`/review` is a generic code review. /preflight is specialized: it maintains a database of known AI hallucination patterns (phantom package names, deprecated API mixups, common argument swaps) and verifies every finding against your actual project state with tool use. It does not speculate.

**What about false positives?**
Every finding must be backed by evidence gathered through actual tool use -- grep results, file reads, type definition lookups. If a finding cannot be proven, it is discarded. The default threshold of 60 is deliberately conservative. Dismissed findings are tracked in memory to avoid repeats. After three dismissals of the same pattern, it is auto-suppressed.

**How fast is it?**
Typically under 30 seconds for a normal commit. Large diffs (500+ lines changed) may take longer. Adding `--security` spawns an additional agent, which adds time but runs in parallel with the core checks.

**Does it work with non-AI code?**
Yes. Phantom packages, hallucinated APIs, and missing error handling are bugs regardless of who wrote the code. But the detection patterns are weighted toward the mistakes LLMs make most often, so it is most valuable on AI-assisted codebases.

**What languages are supported?**
JavaScript, TypeScript, and Python have the deepest coverage (phantom package databases, API verification, deprecated pattern lists). The logic checks (inverted conditions, swapped arguments, missing error handling) work across any language. Go test fixtures are included and more languages are planned.

**Can I use this in CI?**
/preflight is designed as a local pre-commit check inside Claude Code. It is not a standalone CLI tool. For CI, use it alongside tools like CodeRabbit or Sonar that are built for that environment.

---

## Project structure

```
preflight/
  .claude-plugin/
    plugin.json                  # Plugin manifest (name, version, author)
  .claude/
    rules/
      preflight-conventions.md   # Confidence calibration, framework rules
  agents/
    bug-detector.md              # Core bug detection patterns
    security-scanner.md          # OWASP top 10, secret detection
    test-gap-analyzer.md         # Test coverage analysis
  hooks/
    hooks.json                   # PreToolUse, SessionStart, Stop hooks
  skills/
    preflight/
      SKILL.md                   # /preflight command -- full verification workflow
      scripts/
        get-staged-diff.sh       # Diff extraction (POSIX sh)
    preflight-dismiss/
      SKILL.md                   # /preflight-dismiss -- manage false positives
    preflight-stats/
      SKILL.md                   # /preflight-stats -- view accuracy metrics
  data/
    ai-failure-patterns.json     # 31 common LLM code-generation failures
    phantom-packages.json        # 128 frequently hallucinated package names
    deprecated-apis.json         # 180 deprecated APIs across 11 ecosystems
    false-positive-mitigations.json  # Mitigation strategies per pattern
  templates/
    report.md                    # Mustache template for output reports
  scripts/
    test-detection.sh            # Test runner for detection patterns
    validate-plugin.sh           # Plugin structure validator
  docs/
    competitive-analysis.md      # Analysis of existing tools
  tests/
    fixtures/                    # Test cases (TS, Python, Go)
```

---

## Contributing

Contributions are welcome. Here is how to get started with the most common types.

### Add a new hallucination pattern

1. Add the pattern to the appropriate JSON file in `data/`:
   - Phantom package? Add to `data/phantom-packages.json` under the right ecosystem key (`npm` or `python`)
   - Deprecated API? Add to `data/deprecated-apis.json` under the right ecosystem key
   - General AI failure? Add to `data/ai-failure-patterns.json`
2. Include a clear description, at least one real-world example, and the correct alternative
3. Add a test fixture in `tests/fixtures/` that triggers the new pattern
4. Run `scripts/test-detection.sh` to verify detection works
5. Open a PR

### Report a false positive

Open an issue with:
- The full finding output
- Why it was incorrect
- The code that triggered it
- What the correct behavior should be

This is one of the most valuable contributions. Every false positive report makes /preflight better for everyone.

### Add language support

The detection logic is language-aware. To add a new language:
1. Add phantom package entries for the ecosystem to `data/phantom-packages.json`
2. Add deprecated API entries to `data/deprecated-apis.json`
3. Add package manager verification commands in the SKILL.md project detection step
4. Add framework-specific rules to `.claude/rules/preflight-conventions.md`
5. Add test fixtures in `tests/fixtures/`

### Run it locally

```bash
# Start Claude Code with the plugin loaded from your local clone
claude --plugin-dir /path/to/preflight

# Stage a test fixture and run preflight
cp tests/fixtures/phantom-package.ts /tmp/test-repo/src/
cd /tmp/test-repo && git add -A
# Then inside Claude Code:
/preflight
```

---

## Research and references

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
