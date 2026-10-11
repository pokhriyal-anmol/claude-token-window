# token-window

A Claude Code mod that shows how many input and output tokens you have used in the current 5-hour rate-limit window, split by session.

![Dashboard preview with sample data](docs/preview.png)

## What you get

- A button above the prompt with the live count. Click it to open the dashboard pane.
- Input and output tokens for the window, plus API calls and your estimated share of the 5-hour limit.
- A **Show** dropdown: all sessions, or one session by its sidebar title.
- A **Range** dropdown: last 5 hours, last 5 windows, or last 10 windows, with an average line.
- A narrow, single-column layout that follows the pane width and follows light or dark mode.
- A small JSON file per active session in `.claude/token-usage/` of the project you are in. The folder ignores itself, so nothing reaches git.

## Install

In a Claude Code terminal session:

```
/plugin install token-window --marketplace pokhriyal-anmol/claude-token-window
```

Answer `y` to add the marketplace, then pick the user scope. Restart the session if the pane does not appear. Open it with `/tokens` or the button above the prompt.

Requires `python3` on your PATH.

## How it works

```mermaid
flowchart LR
  subgraph Local["Your machine only"]
    T["Session transcripts<br/>~/.claude/projects"]
    M["App session metadata<br/>(sidebar titles)"]
    S["scan.py<br/>sums tokens per 5h window"]
    P["Dashboard pane<br/>and prompt button"]
    F[".claude/token-usage/<br/>per-session JSON, git-ignored"]
  end
  L["Claude Code rate-limit reading<br/>(percent used, reset time)"]

  T -- "token counts per API call" --> S
  M -- "session titles" --> S
  S -- "per-session, per-window totals" --> P
  L -- "limit percentage" --> P
  S -- "current window totals" --> F

  classDef store fill:#eef2f7,stroke:#8a96a3,color:#171a1f
  classDef proc fill:#e3f0ff,stroke:#2a78d6,color:#171a1f
  classDef ext fill:#fff1ea,stroke:#eb6834,color:#171a1f
  class T,M,F store
  class S,P proc
  class L ext
```

The mod reads transcripts that Claude Code already writes to disk. Nothing is sent anywhere. A 5-hour window opens at the first call after the previous one closed, which approximates how plan limits are counted.

## Notes and limits

- Token counts come from transcripts. They are not Anthropic billing figures.
- The share of the 5-hour limit for one session is estimated from the account-level percentage and that session's share of the window.
- Input is fresh input plus cache writes. Cache reads are shown separately and not counted.
- Each refresh rescans the last 14 days of transcripts. That takes well under a second for a typical setup.
- Colors follow your operating system theme.

## Develop

```
claude plugin validate .
claude --plugin-dir .
```

The hooks module is `hooks/register.tsx`, the scanner is `hooks/scan.py`, and the shared state contract is `types/index.d.ts`.

## License

MIT
