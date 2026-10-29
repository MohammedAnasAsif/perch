// Moves the mouse and types on Windows. Uses one long-running PowerShell process
// with a small C# helper around the Win32 SendInput API, so Perch needs no extra
// native modules. Coordinates are sent normalised to the virtual desktop
// (0–65535), which works regardless of display scaling.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { screen } from 'electron';
import type { VKey } from './keys';

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

// Reads commands line by line: "<id> <verb> <args...>", replies "<id> ok" or "<id> err <msg>".
const LOOP = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition $env:PERCH_CS -Language CSharp
[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = $line.Split(' ')
  $id = $p[0]
  try {
    switch ($p[1]) {
      'move'   { [PerchInput]::MoveTo([int]$p[2], [int]$p[3]) }
      'click'  { [PerchInput]::Click([int]$p[2], [int]$p[3], $p[4] -eq 'right', [int]$p[5]) }
      'scroll' { [PerchInput]::Scroll([int]$p[2], [int]$p[3], [int]$p[4]) }
      'combo'  { [PerchInput]::Combo($p[2]) }
      'text'   { [PerchInput]::Text($p[2]) }
      'ping'   { }
      default  { throw "unknown command $($p[1])" }
    }
    [Console]::Out.WriteLine("$id ok")
  } catch {
    [Console]::Out.WriteLine("$id err $($_.Exception.Message -replace '\s+', ' ')")
  }
}
`;

export class WindowsInput {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
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
        { env: { ...process.env, PERCH_CS: CSHARP }, windowsHide: true },
      );
      this.proc = proc;
      let started = false;
      const timer = setTimeout(() => {
        if (!started) reject(new Error('The input helper took too long to start.'));
      }, 20_000);
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
          if (m[2] === 'ok') p.resolve();
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

  private async send(cmd: string): Promise<void> {
    await this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
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

  dispose() {
    this.proc?.kill();
    this.proc = null;
    this.ready = null;
  }
}
