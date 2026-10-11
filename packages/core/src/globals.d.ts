// Minimal platform globals used by core (available in browsers, Node 17+, Deno, WebViews).
// Declared here so core does not need the DOM or Node type libraries.
declare function structuredClone<T>(value: T): T;
declare var crypto: { randomUUID(): string };
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
