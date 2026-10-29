// Moves the mouse, types, and reads the active window's controls on Windows.
// Uses one long-running PowerShell process with small C# helpers around the
// Win32 SendInput API and Windows UI Automation, so Perch needs no extra native
// modules. Mouse coordinates are sent normalised to the virtual desktop
// (0–65535), which works regardless of display scaling.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { screen } from 'electron';
import type { VKey } from './keys';

export interface UiItem {
  /** control type, e.g. "button", "edit", "hyperlink" */
  t: string;
  /** accessible name */
  n: string;
  /** current text value for fields (never for password fields) */
  v: string;
  /** password field */
  p: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface UiSnapshot {
  title: string;
  app: string;
  items: UiItem[];
}

const CSHARP = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class PerchInput {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  // Per-monitor DPI awareness, so UI Automation reports real (physical) pixels.
  public static void InitDpi() { try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch {} }
  const uint MOVE=0x1, LDOWN=0x2, LUP=0x4, RDOWN=0x8, RUP=0x10, WHEEL=0x800, ABS=0x8000, VDESK=0x4000;
  const uint KUP=0x2, KUNICODE=0x4, KEXT=0x1;
  static void Send(INPUT i) { SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))); }
  static INPUT Mouse(int x, int y, uint flags, uint data) { var i = new INPUT(); i.type = 0; i.u.mi.dx = x; i.u.mi.dy = y; i.u.mi.dwFlags = flags; i.u.mi.mouseData = data; return i; }
  static INPUT Key(ushort vk, ushort scan, uint flags) { var i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i; }
  public static void MoveTo(int nx, int ny) { Send(Mouse(nx, ny, MOVE|ABS|VDESK, 0)); }
  public static void Click(int nx, int ny, bool right, int count) {
    MoveTo(nx, ny); Thread.Sleep(40);
    for (int c = 0; c < count; c++) {
      Send(Mouse(nx, ny, (right ? RDOWN : LDOWN)|ABS|VDESK, 0)); Thread.Sleep(25);
      Send(Mouse(nx, ny, (right ? RUP : LUP)|ABS|VDESK, 0)); Thread.Sleep(60);
    }
  }
  public static void Scroll(int nx, int ny, int notches) {
    MoveTo(nx, ny); Thread.Sleep(30);
    Send(Mouse(nx, ny, WHEEL|ABS|VDESK, unchecked((uint)(notches * 120))));
  }
  public static void Combo(string spec) {
    // spec: "vk:ext,vk:ext,..."  modifiers first
    var parts = spec.Split(',');
    var vks = new ushort[parts.Length]; var ext = new bool[parts.Length];
    for (int i = 0; i < parts.Length; i++) { var p = parts[i].Split(':'); vks[i] = ushort.Parse(p[0]); ext[i] = p[1] == "1"; }
    for (int i = 0; i < vks.Length; i++) { Send(Key(vks[i], 0, ext[i] ? KEXT : 0)); Thread.Sleep(15); }
    for (int i = vks.Length - 1; i >= 0; i--) { Send(Key(vks[i], 0, KUP | (ext[i] ? KEXT : 0))); Thread.Sleep(15); }
  }
  public static void Text(string b64) {
    var s = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(b64));
    foreach (char ch in s) {
      if (ch == '\r') continue;
      if (ch == '\n') { Combo("13:0"); continue; }
      if (ch == '\t') { Combo("9:0"); continue; }
      Send(Key(0, ch, KUNICODE)); Send(Key(0, ch, KUNICODE | KUP));
      Thread.Sleep(8);
    }
  }
}
`;

// UI Automation: lists the named, visible controls of the foreground window so
// the agent can act on "the Send button" instead of guessing pixels.
const CSHARP_UIA = String.raw`
using System;
using System.Text;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using System.Windows.Automation;
public static class PerchUia {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  static string Esc(string s, int max) {
    if (s == null) return "";
    if (s.Length > max) s = s.Substring(0, max);
    var sb = new StringBuilder();
    foreach (char c in s) {
      if (c == '"') sb.Append("\\\"");
      else if (c == '\\') sb.Append("\\\\");
      else if (c < 32) sb.Append(' ');
      else sb.Append(c);
    }
    return sb.ToString();
  }
  static string Short(ControlType t) {
    var n = t.ProgrammaticName; int i = n.LastIndexOf('.');
    return (i >= 0 ? n.Substring(i + 1) : n).ToLowerInvariant();
  }
  public static string List(int max) {
    var task = Task.Run(() => ListInner(max));
    if (!task.Wait(6000)) return "{\"error\":\"timeout\"}";
    return task.Result;
  }
  static string ListInner(int max) {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "{\"error\":\"no window\"}";
    var root = AutomationElement.FromHandle(h);
    uint pid; GetWindowThreadProcessId(h, out pid);
    string proc = "";
    try { proc = Process.GetProcessById((int)pid).ProcessName; } catch {}
    var types = new ControlType[] {
      ControlType.Button, ControlType.Edit, ControlType.Hyperlink, ControlType.MenuItem, ControlType.TabItem,
      ControlType.ListItem, ControlType.CheckBox, ControlType.RadioButton, ControlType.ComboBox,
      ControlType.TreeItem, ControlType.SplitButton, ControlType.DataItem, ControlType.Document };
    var conds = new Condition[types.Length];
    for (int i = 0; i < types.Length; i++) conds[i] = new PropertyCondition(AutomationElement.ControlTypeProperty, types[i]);
    var cond = new AndCondition(new OrCondition(conds), new PropertyCondition(AutomationElement.IsOffscreenProperty, false));
    var cr = new CacheRequest();
    cr.Add(AutomationElement.NameProperty);
    cr.Add(AutomationElement.ControlTypeProperty);
    cr.Add(AutomationElement.BoundingRectangleProperty);
    cr.Add(AutomationElement.IsPasswordProperty);
    cr.Add(AutomationElement.IsEnabledProperty);
    cr.Add(ValuePattern.ValueProperty);
    cr.AutomationElementMode = AutomationElementMode.None;
    AutomationElementCollection all;
    using (cr.Activate()) { all = root.FindAll(TreeScope.Descendants, cond); }
    var sb = new StringBuilder();
    sb.Append("{\"title\":\"").Append(Esc(root.Current.Name, 120)).Append("\",\"app\":\"").Append(Esc(proc, 60)).Append("\",\"items\":[");
    int n = 0;
    foreach (AutomationElement e in all) {
      if (n >= max) break;
      try {
        var r = e.Cached.BoundingRectangle;
        if (r.IsEmpty || r.Width < 3 || r.Height < 3) continue;
        var t = e.Cached.ControlType;
        string name = e.Cached.Name ?? "";
        bool pw = e.Cached.IsPassword;
        bool field = t == ControlType.Edit || t == ControlType.ComboBox || t == ControlType.Document;
        if (name.Trim().Length == 0 && !field) continue;
        if (!e.Cached.IsEnabled) continue;
        string val = "";
        if (field && !pw) {
          object v = e.GetCachedPropertyValue(ValuePattern.ValueProperty, true);
          if (v is string) val = (string)v;
        }
        if (n > 0) sb.Append(',');
        sb.Append("{\"t\":\"").Append(Short(t)).Append("\",\"n\":\"").Append(Esc(name, 80))
          .Append("\",\"v\":\"").Append(Esc(val, 60)).Append("\",\"p\":").Append(pw ? "true" : "false")
          .Append(",\"x\":").Append((int)r.X).Append(",\"y\":").Append((int)r.Y)
          .Append(",\"w\":").Append((int)r.Width).Append(",\"h\":").Append((int)r.Height).Append('}');
        n++;
      } catch {}
    }
    sb.Append("]}");
    return sb.ToString();
  }
}
`;

// Reads commands line by line: "<id> <verb> <args...>", replies "<id> ok [base64 payload]" or "<id> err <msg>".
const LOOP = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition $env:PERCH_CS -Language CSharp
[PerchInput]::InitDpi()
$uia = $false
try {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
  $want = @('UIAutomationClient', 'UIAutomationTypes', 'WindowsBase', 'System.Xaml')
  $refs = [AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $want -contains $_.GetName().Name } | ForEach-Object { $_.Location }
  Add-Type -TypeDefinition $env:PERCH_UIA -Language CSharp -ReferencedAssemblies $refs
  $uia = $true
} catch {
  [Console]::Error.WriteLine("UI Automation unavailable: $($_.Exception.Message)")
}
[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = $line.Split(' ')
  $id = $p[0]
  $payload = ''
  try {
    switch ($p[1]) {
      'move'   { [PerchInput]::MoveTo([int]$p[2], [int]$p[3]) }
      'click'  { [PerchInput]::Click([int]$p[2], [int]$p[3], $p[4] -eq 'right', [int]$p[5]) }
      'scroll' { [PerchInput]::Scroll([int]$p[2], [int]$p[3], [int]$p[4]) }
      'combo'  { [PerchInput]::Combo($p[2]) }
      'text'   { [PerchInput]::Text($p[2]) }
      'elements' {
        if (-not $uia) { throw 'UI Automation is not available on this PC' }
        $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([PerchUia]::List([int]$p[2])))
      }
      'ping'   { }
      default  { throw "unknown command $($p[1])" }
    }
    if ($payload) { [Console]::Out.WriteLine("$id ok $payload") } else { [Console]::Out.WriteLine("$id ok") }
  } catch {
    [Console]::Out.WriteLine("$id err $($_.Exception.Message -replace '\s+', ' ')")
  }
}
`;

export class WindowsInput {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (payload: string) => void; reject: (e: Error) => void }>();
  private buf = '';

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    if (process.platform !== 'win32') {
      return (this.ready = Promise.reject(new Error('Controlling the mouse and keyboard only works on Windows.')));
    }
    this.ready = new Promise((resolve, reject) => {
      // The loop script goes in as an encoded command; stdin carries only our
      // commands, one per line.
      const encoded = Buffer.from(LOOP, 'utf16le').toString('base64');
      const proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { env: { ...process.env, PERCH_CS: CSHARP, PERCH_UIA: CSHARP_UIA }, windowsHide: true },
      );
      this.proc = proc;
      let started = false;
      const timer = setTimeout(() => {
        if (!started) reject(new Error('The input helper took too long to start.'));
      }, 30_000);
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk: string) => {
        this.buf += chunk;
        let i: number;
        while ((i = this.buf.indexOf('\n')) !== -1) {
          const line = this.buf.slice(0, i).trim();
          this.buf = this.buf.slice(i + 1);
          if (!line) continue;
          if (line === 'ready') {
            started = true;
            clearTimeout(timer);
            resolve();
            continue;
          }
          const m = /^(\d+) (ok|err)(?: (.*))?$/.exec(line);
          if (!m) continue;
          const p = this.pending.get(Number(m[1]));
          if (!p) continue;
          this.pending.delete(Number(m[1]));
          if (m[2] === 'ok') p.resolve(m[3] ?? '');
          else p.reject(new Error(m[3] || 'Input command failed'));
        }
      });
      proc.stderr.on('data', (d) => console.error('[perch] input helper:', String(d).trim()));
      proc.on('exit', () => {
        clearTimeout(timer);
        if (!started) reject(new Error('The input helper could not start.'));
        for (const p of this.pending.values()) p.reject(new Error('The input helper stopped.'));
        this.pending.clear();
        this.proc = null;
        this.ready = null;
      });
    });
    return this.ready;
  }

  private async send(cmd: string): Promise<string> {
    await this.start();
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin.write(`${id} ${cmd}\n`);
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('Input command timed out.'));
      }, 15_000);
    });
  }

  /** Warm up (compiling the helper takes a second or two). */
  async prepare() {
    await this.send('ping');
  }

  /** Converts a point in screen DIPs to normalised virtual-desktop coordinates. */
  private normalise(x: number, y: number) {
    const phys = screen.dipToScreenPoint({ x, y });
    const rects = screen.getAllDisplays().map((d) => screen.dipToScreenRect(null, d.bounds));
    const left = Math.min(...rects.map((r) => r.x));
    const top = Math.min(...rects.map((r) => r.y));
    const right = Math.max(...rects.map((r) => r.x + r.width));
    const bottom = Math.max(...rects.map((r) => r.y + r.height));
    const nx = Math.round(((phys.x - left) * 65535) / Math.max(1, right - left - 1));
    const ny = Math.round(((phys.y - top) * 65535) / Math.max(1, bottom - top - 1));
    return { nx: Math.min(65535, Math.max(0, nx)), ny: Math.min(65535, Math.max(0, ny)) };
  }

  async click(x: number, y: number, opts: { right?: boolean; double?: boolean } = {}) {
    const { nx, ny } = this.normalise(x, y);
    await this.send(`click ${nx} ${ny} ${opts.right ? 'right' : 'left'} ${opts.double ? 2 : 1}`);
  }

  async scroll(x: number, y: number, notches: number) {
    const { nx, ny } = this.normalise(x, y);
    await this.send(`scroll ${nx} ${ny} ${Math.round(notches)}`);
  }

  async keys(keys: VKey[]) {
    await this.send(`combo ${keys.map((k) => `${k.vk}:${k.ext ? 1 : 0}`).join(',')}`);
  }

  async type(text: string) {
    // Long text is sent in chunks so a single command never runs too long.
    const chars = [...text];
    for (let i = 0; i < chars.length; i += 400) {
      await this.send(`text ${Buffer.from(chars.slice(i, i + 400).join(''), 'utf8').toString('base64')}`);
    }
  }

  /** Named, visible controls of the foreground window (positions in physical pixels). */
  async elements(max = 120): Promise<UiSnapshot> {
    const payload = await this.send(`elements ${max}`);
    const json = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    if (json.error) throw new Error(`Couldn't read the window (${json.error}).`);
    return json as UiSnapshot;
  }

  dispose() {
    this.proc?.kill();
    this.proc = null;
    this.ready = null;
  }
}
