<p align="center">
  <img src="assets/icon.png" width="96" alt="Perch icon: a small blue teardrop with two eyes" />
</p>

<h1 align="center">Perch</h1>

<p align="center">
  An open-source AI buddy for Windows that sits next to your cursor.<br />
  Hold a key, ask about anything on your screen, and it answers out loud, points at things, and can even do tasks for you.
</p>

---

Perch is a Windows take on the "AI next to your cursor" idea popularised by
[Clicky](https://github.com/farzaa/clicky) on the Mac. It's written from scratch
in Electron + TypeScript and **can run completely free**: use Google's free
Gemini tier, or a local AI on your own PC with Ollama. Claude is supported too
for the best quality.

## What it does

- **Lives by your cursor.** A small blue buddy follows your mouse on every monitor.
- **Push to talk.** Hold **Ctrl + Alt**, ask your question, let go.
- **Sees your screen.** When you let go, Perch takes a screenshot of the monitor your cursor is on and sends it to the AI with your question.
- **Talks back.** The answer streams into a speech bubble and is read aloud with a Windows voice, sentence by sentence.
- **Points at things.** The buddy flies over to buttons and menus while it talks about them, like "click the Insert tab… then Page Number".
- **Agent mode.** Start with **"agent"** and Perch does the task for you: it can research the web, write documents, and (if you allow it) click and type on your PC. See [Agent mode](#agent-mode).
- **Remembers the conversation** for follow-ups until you start a new one.
- **Type instead** from the tray panel if you can't talk out loud.

## Choose your AI

| | Cost | Works on | Notes |
| --- | --- | --- | --- |
| **Gemini** | Free tier, no card | Any PC | Free key from [Google AI Studio](https://aistudio.google.com/apikey). Has daily limits. On the free tier Google may use what you send to improve its products and humans may review it, so avoid private screens. |
| **Local (Ollama)** | Free | Strong PCs (16 GB RAM, ideally a GPU) | Fully private and offline after setup. Slower and less precise than cloud AIs. |
| **Claude** | Paid per use | Any PC | Best answers, pointing and agent mode. Key from the [Claude Console](https://platform.claude.com/settings/keys). |

### Setting up local AI (Ollama)

1. Install [Ollama](https://ollama.com/download).
2. Open Command Prompt and download a vision model:
   ```
   ollama pull qwen3-vl:8b
   ```
   Use `qwen3-vl:4b` on PCs with 8 GB of RAM (or `qwen3-vl:2b` for very slow PCs).
3. In Perch's panel, choose **Local** and pick the model.

## Install

### Option 1: the installer

1. Download **Perch-Setup-x.y.z.exe** from [Releases](../../releases/latest).
2. Run it. The installer isn't code-signed yet, so Windows SmartScreen may warn you: click **More info → Run anyway**.

### Option 2: run from source

You need [Node.js 20 or newer](https://nodejs.org) and Git.

```powershell
git clone https://github.com/MohammedAnasAsif/perch.git
cd perch
npm install
npm start
```

To build your own installer: `npm run dist` (the result lands in `release/`).

## First run

1. Perch appears in the system tray (the blue icon by the clock; it may be under the **^** overflow arrow) and opens its panel.
2. **Choose your AI** and add its key if it needs one. Keys are encrypted with Windows DPAPI and stored only on your PC.
3. The first time, Perch downloads a speech-recognition model (about 80 MB for the default). After that, speech recognition works offline.
4. Hold **Ctrl + Alt**, say something like *"how do I add page numbers here?"*, and release.

Press **Esc** at any time to make Perch stop.

## Agent mode

Ask Perch to *do* something ("open a new Chrome tab and search for…", "write me a note…") and it hands the request to its agent automatically. You can also start with **"agent"** to make sure:

- *"Agent, find three good laptops under 60,000 rupees and write me a comparison."*
- *"Agent, open Notepad and draft a leave application for tomorrow."*
- *"Agent, summarise this article."* (with the page open in your browser)

The agent works step by step: it can search the web, read pages, save documents to `Documents\Perch`, and, if **Let it use mouse and keyboard** is on, click, type, scroll and open apps. The buddy flies to each spot before clicking, and a status line shows what it's doing.

**Safety:**

- **Esc stops it instantly.** Holding the talk keys stops it too.
- Before anything risky (sending, posting, buying, deleting, installing, changing settings) a popup asks **Allow** or **Stop**. Stop is the default. You can make it ask before *every* click instead.
- It never types passwords, card numbers or one-time codes; it asks you to do that part.
- Text on web pages and on screen is treated as information, not instructions.
- Turn off **Let it use mouse and keyboard** to keep the agent to research and writing only.

Agent tasks take several AI requests each, so they work best with Claude. Gemini's free daily limit can run out after a few tasks, and local models are better at research and writing than at precise clicking.

## Settings

Click the tray icon to open the panel.

| Setting | What it does |
| --- | --- |
| AI | Gemini (free), Local (free, Ollama) or Claude, with each one's key and model. |
| Thinking (Claude) | How much effort Claude puts in. *Low* keeps replies snappy. |
| Agent | Whether the agent may use the mouse and keyboard, and when it must ask first. |
| Push to talk | Ctrl + Alt, Ctrl + Win or Ctrl + Shift. |
| Speech recognition | Whisper model size. The "any language" options also understand Hindi, Spanish and many more, but are slower. |
| Speak replies / Voice / Speed | Uses the voices installed in Windows. More voices: *Settings → Time & language → Speech → Add voices*. |
| Show buddy when idle | Turn off to only see the buddy while it's listening or talking. |
| Start with Windows | Launch Perch when you sign in. |

## Privacy

- **Your voice never leaves your PC.** Speech recognition runs locally (Whisper via [transformers.js](https://github.com/huggingface/transformers.js)).
- **When you ask something**, Perch sends your transcribed question, one screenshot of the monitor your cursor is on, and the recent conversation text to the AI you chose. With **Local**, that never leaves your PC. Nothing is sent while Perch is idle.
- In agent mode, web searches go to DuckDuckGo and pages are fetched directly from their sites.
- Perch's own buddy, bubble and popups are excluded from screenshots.
- API keys are encrypted on disk and only sent to their own service.

See [Anthropic's](https://www.anthropic.com/legal/privacy) and [Google's](https://ai.google.dev/gemini-api/terms) terms for how each handles API data.

## Troubleshooting

**"I can't use the microphone"**: Open *Settings → Privacy & security → Microphone* and turn on **Let desktop apps access your microphone**.

**Nothing happens when I hold Ctrl + Alt**: Some keyboards use AltGr (right Alt) as Ctrl + Alt, and other apps may grab the combo. Try **Ctrl + Win** or **Ctrl + Shift** in the panel. If the panel says the keyboard hook is unavailable, use **Ctrl + Alt + Space** to start and again to stop.

**"I've hit Gemini's free limit"**: Wait until the daily reset, or switch the model to *Flash-Lite*, which has higher free limits.

**The agent didn't do what I asked**: Open the tray menu → **Open log folder** and look at `perch.log` (or attach it to a [GitHub issue](https://github.com/MohammedAnasAsif/perch/issues)). It lists what Perch heard and each step the agent took. API keys are never written to it.

**"I can't reach Ollama"**: Make sure Ollama is running (it starts with Windows after installing) and that you've pulled the model shown in the panel.

**Speech model won't download**: It comes from huggingface.co; check that your network or firewall allows it, then change the Speech recognition setting to retry.

**It's slow**: Use Gemini Flash-Lite or Claude Haiku, *Low* thinking, and the *Fastest* speech model. Local models are much faster with a graphics card.

## How it works

```
 Hold Ctrl+Alt ─▶ mic recording (engine window)
 Release       ─▶ Whisper transcribes locally   ┐
               ─▶ screenshot of cursor's screen ┘─▶ "agent …"? ─ no ─▶ chat (streaming)
                                                        │ yes               │
                                                        ▼                   ▼
                                     agent loop: screenshot → JSON action   bubble + voice
                                     → approve if risky → click/type/search  + pointing
                                     → repeat until "done"
```

| Path | Role |
| --- | --- |
| `src/main/main.ts` | App lifecycle, tray, IPC, cursor-following loop |
| `src/main/companion.ts` | The state machine: listen → transcribe → think → speak → point, and agent runs |
| `src/main/brain.ts` | Chat prompt and conversation memory |
| `src/main/ai/` | Claude, Gemini and Ollama providers behind one interface |
| `src/main/agent/` | Agent loop, actions and safety checks, web tools, Windows mouse/keyboard input |
| `src/main/confirm.ts` | The Allow / Stop popup |
| `src/main/capture.ts` | Screenshots and coordinate mapping (DPI-aware) |
| `src/main/hotkey.ts`, `ptt.ts` | Global push-to-talk via [uiohook-napi](https://github.com/SnosMe/uiohook-napi) |
| `src/main/windows.ts` | Click-through overlay per monitor, hidden engine window, panel |
| `src/renderer/` | The buddy overlay, settings panel, popup, and the voice engine |
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

Inspired by [Clicky](https://github.com/farzaa/clicky) by Farza (MIT). Perch is an independent project with its own code and isn't affiliated with Clicky, Anthropic, Google or Ollama.

## License

[MIT](LICENSE)
