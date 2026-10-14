# The hiring panel skill

You apply to dozens of jobs and never find out why companies say no. This skill tells you first: four independent reviewers try to reject your resume, then it rebuilds your resume with every mistake fixed. Free, MIT, no signup, no API key.

Modified and maintained by **مدرسة الذكاء الاصطناعي**.

## The panel

1. **The automated screen** decides if a human even sees your resume: can it be read, are titles and dates clear,
   which of the job's key terms are missing. PASS or REJECT, with the lines it's about.
2. **The hiring manager** decides if you get the interview, and says what decided it in the first ten seconds.
3. **Two readers, alone.** Nobody sees anybody else's notes: the recruiter (30 seconds, top third only) and a teammate
   (how do you work with others?). HIRE, MAYBE or PASS each.

Then it merges everything into one list of mistakes, worst first, **rebuilds your resume with every one fixed**
(same facts, nothing invented), and runs the automated screen again to show the before and after verdict.

Everything goes in `.hiring-panel/` where you run it: `PANEL.md` and `RESUME-IMPROVED.md`.

## Install

Copy `skills/hiring-panel` into `~/.claude/skills/`, then open a new Claude Code session.

## Use

```
/hiring-panel ~/Documents/resume.pdf  Senior product designer at a fintech startup
```

Paste the job posting after your resume for the sharpest read. One run is five sub-agent calls and counts toward
your Claude plan's usage.

## Good to know

- It never invents employers, titles, dates or numbers. Where a fix needs a fact it doesn't have, it leaves
  `[ADD: ...]` and asks you.
- It's a structured second opinion made by language models. It doesn't guarantee an interview.
- It is not made by Anthropic.

Run the tests with `python3 -m unittest discover -s tests`.

## Rights

Modifications and maintained version: © 2026 مدرسة الذكاء الاصطناعي. The original MIT copyright notice is retained in `LICENSE` as required by that license.
