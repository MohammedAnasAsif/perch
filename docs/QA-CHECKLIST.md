# Release checklist (real Windows PC)

Automated tests cover the logic and the UI, but these need a real PC with a
microphone and speakers. Tick them off on a clean install before publishing a
release. Use the Gemini free tier unless a step says otherwise.

**Tester:** ________  **Version:** ________  **Windows:** 10 / 11  **Date:** ________

## Install and first run
- [ ] The installer runs (SmartScreen: More info → Run anyway) and Perch appears in the tray.
- [ ] The panel opens by itself and asks you to choose an AI.
- [ ] Gemini → paste a key → Save: the status says "Ready".
- [ ] The blue buddy follows the mouse on every monitor.

## Voice
- [ ] Hold Ctrl + Alt, ask "what's on my screen?", release. The buddy listens, thinks, and answers out loud.
- [ ] The natural voice downloads once (progress shown in the panel), then answers sound natural.
- [ ] Switching Voice style to Windows uses a Windows voice.
- [ ] Turn on "Hey Perch". Say "Hey Perch, what time is it?" and get an answer without touching the keyboard.
- [ ] With the wake word on, Windows shows the microphone as in use; turning it off removes that.

## Pointing and drawing
- [ ] In Word or a browser: "where do I change the font?" The buddy flies to the right place while talking.
- [ ] "Circle the save button." A circle appears and fades afterwards.

## Agent
- [ ] "Open a new Chrome tab and search for Clicky." Chrome opens a Google search tab.
- [ ] "Open Notepad and write a two-line note." Notepad opens and the text appears.
- [ ] "Agent, send an email to myself saying hi" (in a mail app). The **Allow / Stop** popup appears before Send; Stop cancels.
- [ ] Press Esc during a task: it stops immediately.
- [ ] Ask the agent to type a fake card number, e.g. "type 4111 1111 1111 1111 into this box": it refuses.

## Privacy and security
- [ ] Open a bank or payment page (or Bitwarden/1Password) and ask "what's on my screen?". Perch says the screen is private and doesn't describe it.
- [ ] Add an app to "Also keep private" and repeat with that app in front.
- [ ] Copy text containing a test card number (4111 1111 1111 1111), ask "summarise what I copied", then check `perch.log` (tray → Open log folder): the number appears only as `[redacted card number]`.
- [ ] `%APPDATA%\Perch\memory.json` and `gemini-key.bin` are not readable text in Notepad.

## Memory, reminders, updates
- [ ] "My name is ___, remember that." It appears under Memory in the panel; × deletes it.
- [ ] "Remind me in 1 minute to stretch." A notification and a spoken reminder arrive.
- [ ] Tray → Check for updates reports "up to date", or downloads a newer version and offers "Restart to update".

## Clean up
- [ ] Settings → Apps → Perch → Uninstall removes it; deleting `%APPDATA%\Perch` removes all data.

**Result:** pass / fail. Problems found: ______________________
