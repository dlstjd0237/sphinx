# Integrations and troubleshooting

The Git hook is the checkpoint. It works on its own, including for pushes from a terminal or [GUI client](#gui-git-clients). Coding-agent integrations add two things: guidance telling the agent to wait for a blocked Git command, and fallback forms for checks that could not open in the browser. For the first-run path, see the [README](../README.md).

- [Supported clients](#supported-clients)
- [Choosing and opening clients](#choosing-and-opening-clients)
- [Per-client notes](#per-client-notes)
- [How a checkpoint reaches you](#how-a-checkpoint-reaches-you)
- [GUI Git clients](#gui-git-clients)
- [Remote machines, SSH, and CI](#remote-machines-ssh-and-ci)
- [Git hooks and existing hooks](#git-hooks-and-existing-hooks)
- [Manual JSON protocol](#manual-json-protocol)
- [Troubleshooting](#troubleshooting)
- [Uninstall](#uninstall)

## Supported clients

| Client | Checkpoint | Fallback | Installed integration |
| --- | --- | --- | --- |
| Codex | Local browser questionnaire | Native MCP form | MCP server and lifecycle hooks |
| Claude Code | Local browser questionnaire | Native MCP form | MCP server and lifecycle hooks |
| Pi 1.2+ | Local browser questionnaire | Native dialogs | Local Pi extension |
| Cursor 1.7+ | Local browser questionnaire | Browser, after Git exits | Local user hooks |
| OpenCode 1.x | Local browser questionnaire | Browser, after Git exits | Local OpenCode plugin |

Client integrations are separate from the reviewer model. Pi, Cursor, and OpenCode do not supply reviewer authentication; choose a Codex/Claude CLI route, OpenRouter, or an OpenAI-compatible endpoint (see [configuration](configuration.md#reviewer-models)).

## Choosing and opening clients

`--agents auto` (the default) detects clients by executable, configuration directory, or an existing Sphinx installation. Guided setup shows checkboxes with **All supported agents** first and detected clients preselected: arrow keys move, Space toggles, Enter confirms. Clear every box to skip agent setup; previously connected integrations stay installed.

```sh
sphinx install --agents codex,claude,pi,cursor,opencode   # explicit subset
sphinx install --agents none                              # Git only
```

Run `sphinx install` again after installing a new supported client; Sphinx does not discover new clients on its own.

On native Windows, `--agents auto` connects no new agent. It keeps Claude Code only if it is already connected, and `--agents claude` opts in. Naming any other agent is an error, raised before Sphinx changes anything. Guided setup offers Claude Code alone.

Interactive installation opens the selected clients afterwards: fresh Codex, Claude Code, Pi, and OpenCode CLI sessions, or a new Cursor window. Opening a client sends no prompt and makes no Sphinx model request. Existing client processes are not restarted. Sphinx does not open clients on Windows. Start a new Claude Code session in this repository to load Sphinx.

```sh
sphinx install --no-launch                            # install without opening clients
sphinx install --yes --preset codex-economy --launch  # unattended install, then open
sphinx activate                                       # open configured clients later
sphinx activate --agents codex,claude
```

`activate` does not reinstall or change settings; `--json` returns launch results. If a client is missing or no terminal or editor can be opened, Sphinx prints the command to run yourself.

Opening a client does not verify MCP connectivity or hook trust. Sphinx never bypasses a client's trust review. Check what Sphinx can see with `sphinx doctor`.

## Per-client notes

**Codex.** Open `/hooks` and trust the Sphinx hooks; `sphinx doctor` cannot verify this. Codex approval policies can cancel native forms: in Codex 0.162.1, approval policy `never` cancels them unless the host enables full-access form input for the user thread. A cancelled form leaves the check pending; finish it with `sphinx check` in a terminal. Sphinx does not change your approval policy.

**Claude Code.** Start a new session to load the hooks. Confirm the `sphinx` server is connected in `/mcp`. On Windows, Claude Code must find Git Bash to run Sphinx's hooks: Git for Windows in its default folder, or `CLAUDE_CODE_GIT_BASH_PATH` pointing at `bash.exe`. Without it, Claude Code runs hooks in PowerShell, and Sphinx's hooks fail with non-blocking hook errors.

**Pi.** Start a new session, or run `/reload` in an existing one. Native fallback dialogs need an interactive session or a dialog-capable RPC client; noninteractive modes leave the check pending for `sphinx check`.

**Cursor.** Start a new Agent conversation in the opened window. Activation flags versions older than 1.7 for an update. The installed user hooks cover local sessions, not Cursor cloud agents.

**OpenCode.** Start a new session. The plugin is installed in OpenCode's configuration directory (honoring `OPENCODE_CONFIG_DIR` or `XDG_CONFIG_HOME`).

Each client controls how its own forms and dialogs look, and may keep its own interaction logs.

## How a checkpoint reaches you

1. **Browser (normal).** The blocked Git hook serves a questionnaire on `127.0.0.1` and prints its URL. On macOS and Windows it opens in your default browser by itself: in front on Windows and for GUI Git clients on macOS, in a background tab (without activating Terminal or moving your coding window) for macOS terminals and coding agents. Elsewhere, open the printed URL. One page handles every checkpoint in a Git operation. Git continues when you pass and choose Continue.
2. **Native fallback.** If the browser page cannot be presented, Git stops and the check is queued. Codex and Claude Code show an MCP form after the shell command exits; Pi shows extension dialogs; Cursor and OpenCode point you to the browser page. Because Git has already exited, passing a fallback check does not resume it; run the Git command again once.
3. **Terminal.** `sphinx check` runs the same check in your terminal at any time. It supports `/learn`, `/dispute <reason>`, and `/quit` (save and leave pending). When Git asks in its own terminal while it waits, `/stop` (or `/quit`) stops the operation, and after a pass you type `continue` or `stop`.

All three share one assessment per change. **Your answers go directly to Sphinx; the coding model never sees questions, answers, or feedback.** It receives only status, assessment IDs, progress, and usage counts. It does not start the interview or relay answers, and there is no extra coding-model turn per answer. A paused or dismissed check does not reopen on unrelated shell commands; retrying the blocked Git command queues it again. The integration follows checks across `cd` and `git -C`.

Agent guidance tells the coding agent not to start a duplicate Git command while one is waiting and not to answer for you. The host may still cancel a long-running shell command before you finish; in that case, complete the check and retry once.

## GUI Git clients

Fork, Sourcetree, and GitHub Desktop run hooks through a real Git, whether bundled or the system one, so the machine-wide `core.hooksPath` applies and Sphinx checks a push from the client like any other, and a commit once you turn commit checks on (see **Commits** below). The hook gets no terminal, and the client shows little while it waits. GitHub Desktop by default shows a hook's output only when the hook fails, Sourcetree has no live console, and Fork shows pre-push output afterwards, in a dialog or its Activity Manager. The page that opens by itself is the signal that Git is waiting for you.

**Opening.** On Windows and macOS the page opens in your default browser without any action from you: in front on Windows and for GUI clients on macOS, in the background for macOS terminals and coding agents. Windows can keep the browser behind the client and only flash its taskbar button. Answer, pass, and choose **Continue push** (**Continue commit** for a commit). The client then finishes the operation. Git has no hook timeout of its own: with Fork's Git on Windows 11, a commit waited 10.5 minutes in its pre-commit hook and then went through. Git therefore waits as long as Sphinx does: up to 25 minutes, or until the 3-minute stop below. A client that gives up sooner does so by its own rule.

**Closing every tab.** When Git runs from a GUI client or on Windows without a terminal, and Sphinx could hand the page to the system (`rundll32` on Windows, `open` on macOS), the push or commit stops 3 minutes after every Sphinx tab is closed. This also covers a browser that then never showed the page. Git prints `Sphinx: no questionnaire page was open for 3 minutes, so this push stopped. Your progress is saved; push again to reopen the questionnaire.` and exits with an error, so look for it in the client's error message or output. A browser that unloads a long-hidden tab (for example Chrome's Memory Saver) or a jump of the system clock can trigger this stop while the tab still looks open. Your progress is saved either way, so push again. Terminals and coding agents keep the 25-minute wait, and so does a push whose page Sphinx could not hand to the system: Git prints the page's address and waits, and a GUI client shows neither until Git exits. Once it has, push from a terminal, which shows the address while Git waits; your progress is saved.

**Cancelling.** Clients differ: GitHub Desktop has no cancel button for a commit or push, and a cancel in Fork may end only `git.exe`. On Windows, that leaves the hook's `sh` and `node` running, so Sphinx's hook keeps waiting. If its page is closed, it stops by itself 3 minutes after its last tab closed, or 3 minutes after Sphinx handed the page to the system if no tab ever connected. A push you start meanwhile waits for it, then opens its own page for the same change. If its page is still open and you choose Continue, the page reports success, but what happens next depends on which `git.exe` the client ended. Git for Windows' `cmd\git.exe` is a launcher that starts the real Git, `mingw64\bin\git.exe`. If the client ended the real Git, nothing is pushed. Your pass is confirmed, so the next push of the same change goes through without questions, for as long as the pass lasts (24 hours, unless the code, destination, or policy changes). If it ended only `cmd\git.exe`, the real Git keeps running and finishes the push. Which of the two a cancel in Fork ends has not been checked. If you cancelled in the client, choose **Stop push** instead: your pass is saved, and the next push asks only whether to continue. If you already pushed again, that push waits for the old page: choose **Continue push** there, then **Continue push** on the page the new push opens. **Stop push** on the old page stops both.

**Commits.** Sphinx checks pushes by default. To check commits made in a client, set `"events": ["pre-commit"]` in `.sphinxconfig`, or `["pre-push", "pre-commit"]` for both.

**Skipping hooks.** GitHub Desktop's Bypass and Fork's option to skip hooks skip Sphinx like any other hook. Sphinx is practice, not a security gate.

**Windows.** Sphinx installs a dispatcher for every Git hook name so it can chain your own hooks. On Windows, a dispatcher costs about 0.1 s, and `pre-commit` and `pre-push` cost 0.3 to 0.4 s because they also start Node. One Git command can fire many dispatchers: `reference-transaction` runs at least twice whenever Git updates a branch or other ref, and `post-index-change` whenever Git writes the index. With Sphinx installed, a checkout or a commit therefore takes most of a second longer, and a fetch, staging a file, or a status that rewrites the index less than 0.2 s longer. Measured with Fork's Git on Windows 11, as medians of 10 runs each with versus without Sphinx's hooks, `git checkout -b` took 0.77 s longer, switching back with `git checkout main` 0.70 s, a push to an unprotected branch 0.51 s, `git fetch` 12 ms, and `git status` 6 ms. Staging one file took 0.06 to 0.1 s longer, in single runs. A push of a change whose pass you had already confirmed took 0.85 s longer in one run, because Sphinx checks the pass and then cleans up. In Git Bash, the MinTTY window gives Node a pipe instead of a terminal, unless Git for Windows' optional pseudo-console support is turned on. With a pipe, Sphinx treats a push from that window as unattended: the page still opens, Git prints its address in the window, and the 3-minute stop applies. For the same reason, guided `sphinx install` stops in that window and tells you to run it from Windows Terminal or PowerShell, or to pass `--yes`.

**macOS.** Some Mac clients started from the Dock or Finder run hooks with launchd's short PATH, which lacks `~/.local/bin`, Homebrew, and nvm. Fork, for example, runs its pre-push hook that way. `sphinx install` records the directories that hold `claude`, `codex`, and `gh` and adds them after the PATH Git gives the hook, so a GUI push finds your reviewer CLI. Run `sphinx install` from your usual shell, not through `npx` inside a project whose `node_modules/.bin` has those tools. Run it again after you move or reinstall one of them.

**Coding agents Sphinx cannot recognize.** Sphinx tells a coding agent's push from a GUI push by markers that the agents it integrates with leave in their shells. Cursor's shell has no marker of its own that Sphinx could confirm, so Sphinx recognizes a Cursor agent's push only by the session tag that its `sessionStart` hook asks Cursor to set. A push with no terminal and no such marker counts as a GUI push: one from Cursor when the tag does not reach the shell, or one from a coding agent that Sphinx does not integrate with. Its page then opens in front on macOS, as it always does on Windows, and the 3-minute stop applies.

### Windows checklist

An automated run with Fork's Git on Windows 11 checked a commit and a push with the questionnaire, Continue and Stop after passing, the 3-minute stop and a retry that takes over, ending the real Git (`mingw64\bin\git.exe`) while Sphinx waits, an existing hook that rejects the push, a moved Sphinx file, and opening the page in the real default browser. The clients' own windows and buttons have not been checked by hand. If you use Fork, Sourcetree, or GitHub Desktop, run these steps once in it:

1. Run `sphinx install` from Windows Terminal or PowerShell. In a test repository with a remote, commit to a protected branch (`main` or `master` by default) before each push below.
2. Push from the client. The page should open in front, or the browser's taskbar button should flash, and no console window should appear.
3. Pass, choose **Continue push**, and confirm the client finishes the push.
4. Push again and leave the page unanswered for 6 minutes. Note whether the client gives up or keeps waiting.
5. Push and cancel in the client (skip this in GitHub Desktop, which has no cancel button). Pass on the page, choose **Continue push**, then check whether the remote moved (see **Cancelling**).
6. Push and close the tab. After 3 minutes the client should report that the push failed, with Sphinx's `no questionnaire page was open for 3 minutes` line in its output.

### macOS checklist

Automated tests cover the macOS behavior, but it has not been checked by hand in each client. If you use one, check it once:

1. Run `sphinx install` from your usual shell. In a test repository with a remote, commit to a protected branch (`main` or `master` by default).
2. Push from Fork, Sourcetree, and GitHub Desktop in turn. Each should open the questionnaire in front of the client, with no terminal involved, and none should report `No supported evaluator CLI found` or `Could not start claude`.
3. Pass, choose **Continue push**, and confirm the client completes the push.
4. Push from a Cursor agent session. The page should open in a background tab and leave Cursor in front. If it opens in front, Cursor did not pass its session tag on (see above).
5. Push from the Terminal app. The page should open in a background tab, as before.

## Remote machines, SSH, and CI

The installation covers your local machine. Remote machines, containers, and hosted coding agents need their own installation.

Sphinx opens the browser automatically only on macOS and Windows. On Linux, WSL, and over SSH it prints the loopback URL instead. From a remote session, forward the same port number (for example `ssh -L <port>:127.0.0.1:<port> host`) and open the printed URL unchanged in your local browser; the page rejects other hosts and ports. Or run `sphinx check` on the remote machine. A remote connection may time out sooner than Sphinx's 25-minute wait.

CI never starts a questionnaire. The check stays pending and Git stops.

## Git hooks and existing hooks

`sphinx install` sets a machine-wide Git `core.hooksPath`, which covers existing and new repositories that use that Git configuration. Existing repository hooks still run first, with their arguments and input, and their rejection is preserved. Hooks with streaming protocols are forwarded directly. Reinstallation is idempotent, and agent settings are merged rather than replaced.

A repository that sets its own `core.hooksPath` needs a compatibility step. `sphinx doctor` reports this:

```sh
cd your-repo
sphinx install --repo
```

Besides the checkpoint hooks, `post-commit`, `post-merge`, `post-rewrite`, and `post-checkout` schedule [background preparation](configuration.md#background-preparation).

## Manual JSON protocol

For integrations and debugging, the CLI returns questions and feedback as JSON. It never returns answer keys. Codex and Claude use `sphinx mcp` internally, and Pi calls the same controller from its extension; none of them asks the coding model to run these commands.

```sh
sphinx pending --json
sphinx check --json
sphinx answer <assessment-id> --text 'Your answer and reason' --json
sphinx explain <assessment-id> --json
sphinx dispute <assessment-id> --text 'Why the premise is wrong' --json
```

These are for a person or a test harness. A coding agent must not answer on your behalf.

`help`, `status`, `pending`, and `config` never call a model. `--json` output contains no banners or ANSI styling; color is off when output is redirected, and `NO_COLOR=1` disables it.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Git is waiting and no page opened | Open the `Sphinx questionnaire:` URL that Git printed. A GUI client does not show it while Git waits. There the push stops by itself, with your progress saved: after 3 minutes with no page open if Sphinx could hand the page to the system, otherwise at the 25-minute deadline. Then push again, or push from a terminal, which shows the URL while Git waits. |
| You closed the tab | From a terminal or a coding agent, Git keeps waiting: reopen the same URL until the 25-minute deadline. From a GUI client, or on Windows with neither a terminal nor a coding agent, Git stops 3 minutes after every Sphinx tab is closed; push again. Git Bash's default MinTTY window counts as no terminal, so the stop applies there (see **Windows** under GUI Git clients). |
| You chose Stop push (or Pause check), the deadline passed, or the host cancelled the shell | Progress is saved. Run the Git command once more, or `sphinx check` first. |
| You passed and chose Stop push, or Git stopped waiting before you chose | The push or commit did not go through. Your pass is saved, so running the same Git command again asks only whether to continue, with no new questions. |
| A native form was cancelled or never appeared | Run `sphinx check` in a terminal. In Codex, see the approval policy note above. |
| The review failed before questions appeared | The page offers to continue from saved work. From a terminal: `sphinx check --id <id>`, or `--retry-review` for a failed, questionless review. See [limits](configuration.md#model-calls-tokens-and-limits). |
| The check keeps coming back after you passed | If it asks only Continue or Stop, the earlier push or commit stopped before you chose Continue; choose Continue to let it through. If it asks questions again, something changed: code, destination base, policy, ignore rules, or context. Completion also expires after 24 hours. |
| Hooks do not run in one repository | `sphinx doctor`, then `sphinx install --repo` if it reports a hooks override. |
| Missing remote history | `git fetch`, then push again. |

Never start a second copy of a Git command that is still waiting.

## Uninstall

```sh
sphinx uninstall --repo   # remove an explicit repository integration, if present
sphinx uninstall          # remove machine-wide Git and agent integrations
npm uninstall -g sphinx-understand
```

Uninstall restores the previous hook configuration when Sphinx still owns it and removes only its own unchanged agent handlers and MCP registration. Later edits are preserved and reported. Machine-wide uninstall leaves explicit repository installations in place, with a warning; remove those first. Configuration, credentials, and assessment state stay in `~/.config/sphinx` for you to keep or delete.
