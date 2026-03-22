# Preflight Plugin

A Claude Code plugin that runs pre-commit verification on AI-generated code.
Catches hallucinated APIs, phantom packages, wrong method signatures, deprecated
API usage, and plausible-but-wrong logic before they enter git history.

## Architecture

The plugin uses a hook-driven pipeline:

1. **Hooks** (`hooks/hooks.json`) intercept `git commit`, `git push`, and
   `git merge` via a `PreToolUse` hook on the `Bash` tool. A `SessionStart`
   hook loads the pattern database stats on startup. A `Stop` hook persists
   session telemetry.
2. **Skill** (`skills/preflight/SKILL.md`) is the `/preflight` command. It
   orchestrates the full workflow: obtain diff, parse arguments, dispatch
   subagents, score and filter findings, generate the report.
3. **Subagents** (`agents/*.md`) do the actual analysis. Each agent has a
   narrow focus and is dispatched by the skill with the diff as input.
4. **Data files** (`data/*.json`) supply known-bad patterns: phantom package
   names, deprecated APIs, and common AI failure patterns.
5. **Rules** (`.claude/rules/preflight-conventions.md`) define confidence
   calibration, framework-specific checks, and when to flag vs. accept.

## File Structure

```
preflight/
  .claude-plugin/plugin.json   Plugin manifest (name, version, description)
  hooks/hooks.json             Hook definitions (PreToolUse, SessionStart, Stop)
  skills/preflight/
    SKILL.md                   /preflight skill -- full verification workflow
    scripts/get-staged-diff.sh Helper script to extract staged/unstaged diffs
  agents/
    bug-detector.md            Detects phantom pkgs, hallucinated APIs, wrong logic
    security-scanner.md        OWASP top 10, secrets, injection, auth gaps
    test-gap-analyzer.md       Missing test coverage for changed code
  data/
    ai-failure-patterns.json   Common LLM code-generation failure patterns
    deprecated-apis.json       Deprecated APIs by ecosystem and version
    phantom-packages.json      Frequently hallucinated package names
  templates/
    report.md                  Mustache template for the output report
  .claude/rules/
    preflight-conventions.md   Confidence calibration, framework rules, flag policy
  tests/fixtures/              TypeScript files exercising each detection category
```

## How to Test

Load the plugin locally and run it against the included test fixtures:

```bash
# Start Claude Code with the plugin loaded
claude --plugin-dir /path/to/preflight

# Stage a test fixture and run preflight
cp tests/fixtures/phantom-package.ts /tmp/test-repo/src/
cd /tmp/test-repo && git add -A
# Then inside Claude Code:
/preflight
```

Test fixtures cover: `phantom-package.ts`, `hallucinated-api.ts`,
`plausible-wrong-logic.ts`, `deprecated-api.ts`, `security-issues.ts`,
and `clean-code.ts` (should produce zero findings).

## How to Add New Patterns

Edit the JSON files in `data/`. Each follows a consistent schema:

- **`phantom-packages.json`** -- keyed by ecosystem (`npm`, `pip`, etc.).
  Each entry: `{ "hallucinated": "...", "correct": "...", "notes": "..." }`.
- **`deprecated-apis.json`** -- keyed by ecosystem (`react`, `node`, etc.).
  Each entry: `{ "deprecated": "...", "replacement": "...", "since_version": "...", "notes": "..." }`.
- **`ai-failure-patterns.json`** -- array of pattern objects with `pattern`,
  `category`, `description`, and `examples` fields.

After editing, test by running `/preflight` against a fixture that exercises
the new pattern.

## How to Add New Detection Agents

1. Create `agents/<agent-name>.md`.
2. Include the required YAML frontmatter:
   ```yaml
   ---
   name: <agent-name>
   description: >
     One-paragraph description of what this agent detects.
   tools: Read, Grep, Glob, Bash
   disallowedTools: Write, Edit, WebSearch, WebFetch, Agent
   model: sonnet
   maxTurns: 20
   effort: high
   ---
   ```
3. Write the agent body with: Role, Detection Categories, Output Format, Rules.
4. Wire it into `skills/preflight/SKILL.md` so the orchestrator dispatches it.

## Key Conventions

- **Read-only analysis.** All agents use Read, Grep, Glob, and Bash only. They
  must never use Write or Edit during verification. Modifications happen only in
  the explicit fix step after the user approves.
- **Evidence-backed findings.** Every finding must include evidence gathered via
  tool use (file contents, grep results, manifest checks). Speculation is not
  acceptable.
- **Confidence calibration.** Scores follow the table in
  `.claude/rules/preflight-conventions.md`: 90-100 = verified, will break;
  75-89 = strong evidence; 60-74 = probable; below 60 = discard. The default
  reporting threshold is 60.
- **Precision over recall.** False positives erode developer trust. It is
  better to miss a real bug than to report something that is not wrong.
- **Structured output.** Findings use the exact format defined in each agent's
  Output Format section and the report template in `templates/report.md`.
- **Severity hierarchy.** CRITICAL = runtime crash or security breach; HIGH =
  incorrect behavior; MEDIUM = convention deviation or code smell.

## Common Development Tasks

| Task | Steps |
|------|-------|
| Edit detection logic | Modify the relevant `agents/*.md` file |
| Adjust confidence thresholds | Edit `.claude/rules/preflight-conventions.md` |
| Add a framework-specific rule | Add to section 3 of `preflight-conventions.md` |
| Change the report layout | Edit `templates/report.md` |
| Add a new skill argument | Update the argument table in `skills/preflight/SKILL.md` Step 2 |
| Modify hook triggers | Edit `hooks/hooks.json` (matcher patterns, command logic) |
| Add test fixtures | Create a `.ts` file in `tests/fixtures/` with code that should trigger (or not trigger) a specific detection category |

## Plugin Format Requirements

A valid Claude Code plugin requires:

- **`.claude-plugin/plugin.json`** -- Manifest with `name`, `version`,
  `description`. Optional: `author`, `license`, `keywords`.
- **`hooks/hooks.json`** -- Defines lifecycle hooks (`PreToolUse`,
  `SessionStart`, `Stop`, etc.) with matcher patterns and shell commands.
- **`skills/<name>/SKILL.md`** -- Skill definition with YAML frontmatter
  (`name`, `description`, `argument-hint`, `allowed-tools`, `context`, `agent`,
  `effort`, `user-invocable`) followed by the instruction body.
