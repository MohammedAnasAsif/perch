# Testing Perch

Perch is built test-first: for a new behaviour or a bug, write the failing test,
make it pass, then tidy up. There are four layers.

| Layer | What it checks | Where | Run |
| --- | --- | --- | --- |
| **Unit** | Pure logic: parsing the AI's replies, push-to-talk, the agent's actions and safety rules, secret redaction, private apps, network and IPC guards, encrypted storage, reminders, wake word | `tests/*.test.ts` | `npm test` |
| **Integration** | The real app, started headless with a fake AI and fake mouse/keyboard: chat and pointing, hand-off to the agent, Allow/Stop approvals, secrets, privacy, IPC attacks, encrypted notes, reminders | `tests/integration/*.cjs` | `npm run test:integration` |
| **Acceptance** | User journeys through the real panel, clicking and typing like a person: first run, asking, agent tasks, stopping with Esc, memory, settings after a restart, accessibility | `tests/acceptance/*.cjs` | `npm run test:acceptance` |
| **Windows smoke** | The mouse/keyboard and UI Automation helper compiles and answers on real Windows | `scripts/smoke-input.mjs` | CI (Windows) |

`npm run test:all` runs unit, integration and acceptance tests. CI runs all of
them on every push and pull request, plus `npm audit` on shipped dependencies,
and only then builds the Windows installer.

## Writing a test first

1. Add the test describing the behaviour you want, for example in
   `tests/redact.test.ts`:
   ```ts
   test('passwords said in a sentence are redacted', () => {
     assert.equal(r('my wifi password is Hunter2!'), 'my wifi password is [redacted password]');
   });
   ```
2. Run `npm test` and watch it fail.
3. Write the smallest change that makes it pass.
4. Run the whole suite, then refactor with the tests as a safety net.

## How integration and acceptance tests work

`scripts/run-e2e.mjs` builds Perch, then starts the real app once per scenario
with a fresh profile, on a virtual display on Linux. The scenario file is
loaded through a test hook that **only exists in development builds**; an
installed Perch ignores it. Each scenario gets a harness `h` with:

- `h.providers.claude.stream = …`: a fake AI (see `fakeAI` in `_helpers.cjs`)
- `fakeInput(h)`: records clicks and typing instead of doing them
- `h.companion`, `h.panel()`, `h.memories`, `h.getSettings()`: the app's parts
- `h.exec(window, js)`: act inside a window like a user (click, type, read text)
- `h.check(ok, name, detail)`, `h.waitFor(fn)`, `h.wait(ms)`

Scenario headers can set the environment (`// @env NAME=value`,
`// @unset NAME`) or start Perch twice with the same profile (`// @runs 2`).

Run a single scenario with `node scripts/run-e2e.mjs tests/integration --only approval`.

## Manual checks on a real PC

Some things need real hardware: a microphone, speakers, the Windows desktop.
Before a release, go through [QA-CHECKLIST.md](QA-CHECKLIST.md).
