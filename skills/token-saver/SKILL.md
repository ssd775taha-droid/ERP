---
name: token-saver
description: >-
  Save and reduce token usage during a session. Use when the user types /token-saver, or asks to cut token/context usage, keep answers short, or make a long session cheaper.
license: MIT
metadata:
  version: "1.0.0"
---

# /token-saver

Work in low-token mode for the rest of the session. Never lower correctness to save tokens.

## Output
- Answer first, in the fewest words that stay clear. No preamble, no recap of the request, no closing summary of what you just did.
- Do not repeat code, files or tool output the user already saw. Refer to `file:line` instead.
- Use lists or tables only when they are shorter than prose.
- Ask a question only when the answer changes what you do; otherwise pick a sensible default and say it in one line.

## Reading and searching
- Search (Grep/Glob) before reading. Read only the needed line range (`offset`/`limit`), never a whole large file.
- Do not re-read a file you just edited or already read this session.
- Limit command output: `head`, `tail`, `-n`, `--stat`, `--oneline`, `-q`. Never dump logs, lockfiles or generated files.
- Run independent tool calls in parallel in one step.

## Edits
- Use Edit with the smallest unique `old_string`, not a full-file Write.
- Batch related changes into few steps. Do not narrate each step.

## Delegation
- Do not start sub-agents or workflows unless the user asks; each one starts cold and costs more.

## Long sessions
- When context grows large, suggest `/compact` (keep decisions, file paths, open tasks) or a fresh session for an unrelated task.
- Keep durable facts (conventions, commands, decisions) in a short `CLAUDE.md` instead of re-explaining them.
- Prefer a smaller/faster model for simple edits and lookups.

## Rules
- Say so briefly if a saving would risk a wrong result, and do the safe thing.
