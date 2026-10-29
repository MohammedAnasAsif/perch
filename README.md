<p align="center">
  <img src="assets/icon.png" width="96" alt="Perch icon: a small blue teardrop with two eyes" />
</p>

<h1 align="center">Perch</h1>

<p align="center">
  An open-source AI buddy for Windows that sits next to your cursor.<br />
  Hold a key, ask about anything on your screen, and it answers out loud and flies over to point at things.
</p>

---

Perch is a Windows take on the "AI next to your cursor" idea popularised by
[Clicky](https://github.com/farzaa/clicky) on the Mac. It's written from scratch
in Electron + TypeScript, uses Claude to understand your screen, and does speech
recognition **locally on your PC**, so the only thing you need is a Claude API key.

## What it does

- **Lives by your cursor.** A small blue buddy follows your mouse on every monitor.
- **Push to talk.** Hold **Ctrl + Alt**, ask your question, let go.
- **Sees your screen.** When you let go, Perch takes a screenshot of the monitor your cursor is on and sends it to Claude with your question.
- **Talks back.** The answer streams into a speech bubble and is read aloud with a Windows voice, sentence by sentence, as it arrives.
- **Points at things.** Claude can mark spots on the screenshot, and the buddy flies over to each one while that sentence is being spoken, like "click the Insert tab… then Page Number".
- **Remembers the conversation** for follow-ups ("and where's the next step?") until you start a new one.
- **Type instead** from the tray panel if you can't talk out loud.

## Install

### Option 1: the installer

1. Open the [Actions tab](../../actions), pick the latest successful **Build Windows installer** run, and download **Perch-Setup** from its *Artifacts* (or grab it from [Releases](../../releases) once there is one).
2. Run `Perch-Setup-x.y.z.exe`. The installer isn't code-signed yet, so Windows SmartScreen may warn you: click **More info → Run anyway**.

### Option 2: run from source

You need [Node.js 20 or newer](https://nodejs.org) and Git.

```powershell
git clone https://github.com/MohammedAnasAsif/WinClicky.git
cd WinClicky
npm install
npm start
```

To build your own installer: `npm run dist` (the result lands in `release/`).

## First run

1. Perch appears in the system tray (the blue icon by the clock; it may be under the **^** overflow arrow) and opens its panel.
2. Paste your **Claude API key** (create one in the [Claude Console](https://platform.claude.com/)). It's encrypted with Windows DPAPI and stored only on your PC.
3. The first time, Perch downloads a speech-recognition model (about 80 MB for the default). The panel shows progress. After that it works offline.
4. Hold **Ctrl + Alt**, say something like *"how do I add page numbers here?"*, and release.

Press **Esc** at any time to make Perch stop talking.

## Settings

Click the tray icon to open the panel.

| Setting | What it does |
| --- | --- |
| Model | Claude Sonnet 5.5 (default, balanced), Haiku 5.5 (fastest, cheapest) or Opus 5.5 (smartest). |
| Thinking | How much effort Claude puts in. *Low* keeps replies snappy. |
| Push to talk | Ctrl + Alt, Ctrl + Win or Ctrl + Shift. |
| Speech recognition | Whisper model size. *Balanced (English)* is the default; the "any language" options also understand Hindi, Spanish and many more, but are slower. |
| Speak replies / Voice / Speed | Uses the voices installed in Windows. More voices: *Settings → Time & language → Speech → Add voices*. |
| Show buddy when idle | Turn off to only see the buddy while it's listening or talking. |
| Start with Windows | Launch Perch when you sign in. |

## Privacy

- **Your voice never leaves your PC.** Speech recognition runs locally (Whisper via [transformers.js](https://github.com/huggingface/transformers.js)).
- **When you ask something**, Perch sends Claude your transcribed question, one screenshot of the monitor your cursor is on, and the recent conversation text. Nothing is sent while Perch is idle.
- Perch's own buddy and bubble are excluded from screenshots.
- Your API key is encrypted on disk and only sent to Anthropic's API.

Anthropic's handling of API data is described in their [privacy policy](https://www.anthropic.com/legal/privacy).

## Troubleshooting

**"I can't use the microphone"**: Open *Settings → Privacy & security → Microphone* and turn on **Let desktop apps access your microphone**.

**Nothing happens when I hold Ctrl + Alt**: Some keyboards use AltGr (right Alt) as Ctrl + Alt, and other apps may grab the combo. Try **Ctrl + Win** or **Ctrl + Shift** in the panel. If the panel says the keyboard hook is unavailable, use **Ctrl + Alt + Space** to start and again to stop.

**Speech model won't download**: It comes from huggingface.co; check that your network or firewall allows it, then change the Speech recognition setting to retry.

**It's slow**: Pick *Haiku 5.5* and *Low* thinking, and the *Fastest* speech model.

## How it works

```
 Hold Ctrl+Alt ─▶ mic recording (engine window)
 Release       ─▶ Whisper transcribes locally   ┐
               ─▶ screenshot of cursor's screen ┘─▶ Claude (streaming)
                                                        │
             speech bubble ◀── text ◀── [POINT:x,y:label] tags parsed out
             Windows voice ◀── sentence by sentence
             buddy flies   ◀── each point, as its sentence starts
```

| Path | Role |
| --- | --- |
| `src/main/main.ts` | App lifecycle, tray, IPC, cursor-following loop |
| `src/main/companion.ts` | The state machine: listen → transcribe → think → speak → point |
| `src/main/brain.ts` | Claude client and system prompt |
| `src/main/capture.ts` | Screenshots and coordinate mapping (DPI-aware) |
| `src/main/hotkey.ts`, `ptt.ts` | Global push-to-talk via [uiohook-napi](https://github.com/SnosMe/uiohook-napi) |
| `src/main/windows.ts` | Click-through overlay per monitor, hidden engine window, panel |
| `src/renderer/overlay.ts` | The buddy, bubble and pointing animation |
| `src/renderer/engine.ts` | Microphone, Whisper worker, Windows text-to-speech |
| `src/renderer/panel.ts` | Settings and status panel |
| `src/shared/stream.ts` | Streaming parser for point tags and sentence splitting |

## Development

```powershell
npm install
npm run dev        # build and launch with logs
npm test           # unit tests
npm run typecheck
npm run dist       # Windows installer in release/
```

`overlay.html?demo` and `panel.html?demo` (inside `dist/renderer`) render the UI in a normal browser for design work.

## Credits

Inspired by [Clicky](https://github.com/farzaa/clicky) by Farza (MIT). Perch is an independent project with its own code and isn't affiliated with Clicky or Anthropic.

## License

[MIT](LICENSE)
