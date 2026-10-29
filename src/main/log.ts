// Mirrors the main process's console output into a log file
// (%APPDATA%\Perch\logs\perch.log) so problems can be diagnosed after the fact.
// The file is capped at ~1 MB; the previous one is kept as perch.old.log.
import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';

const MAX_BYTES = 1_000_000;

export function logDir() {
  return join(app.getPath('userData'), 'logs');
}

export function logFile() {
  return join(logDir(), 'perch.log');
}

// Never write secrets: API keys look like sk-ant-…, AIza…, or long tokens.
function redact(s: string) {
  return s
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-[redacted]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, 'AIza[redacted]')
    .replace(/(x-goog-api-key|x-api-key|authorization)["']?\s*[:=]\s*["']?[^\s"',}]+/gi, '$1: [redacted]');
}

export function installFileLog() {
  try {
    mkdirSync(logDir(), { recursive: true });
  } catch {
    return;
  }
  let written = existsSync(logFile()) ? statSync(logFile()).size : 0;

  const write = (level: string, args: unknown[]) => {
    try {
      const line = `${new Date().toISOString()} ${level} ${redact(format(...args))}\n`;
      if (written + line.length > MAX_BYTES) {
        renameSync(logFile(), join(logDir(), 'perch.old.log'));
        written = 0;
      }
      appendFileSync(logFile(), line);
      written += line.length;
    } catch {
      /* logging must never break the app */
    }
  };

  for (const [method, level] of [
    ['log', 'INFO'],
    ['info', 'INFO'],
    ['warn', 'WARN'],
    ['error', 'ERROR'],
  ] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      write(level, args);
    };
  }
  process.on('uncaughtException', (err) => console.error('[perch] uncaught exception', err));
  process.on('unhandledRejection', (err) => console.error('[perch] unhandled rejection', err));
  console.log(`[perch] started v${app.getVersion()} on ${process.platform} ${process.getSystemVersion?.() ?? ''}`);
}
