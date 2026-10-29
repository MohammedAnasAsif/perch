// Typed access to the preload bridge from renderer code.
import type { PerchApi } from '../preload/preload';

declare global {
  interface Window {
    perch: PerchApi;
  }
}

export const perch: PerchApi = (globalThis as any).perch ?? {
  // Lets pages render in a plain browser for design work.
  send: () => {},
  invoke: async () => undefined as any,
  on: () => () => {},
};
