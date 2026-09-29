/**
 * Internal helpers shared by the engine and the presets. Not part of the
 * public API: nothing here is re-exported from the package root or
 * `/presets`.
 */
import { kindOf } from "./deepEqual.js";

const SHORT_ESCAPES = new Map([
  ["\n", "\\n"],
  ["\r", "\\r"],
  ["\t", "\\t"],
]);

/**
 * Escape control characters, line and paragraph separators, and bidi
 * formatting characters, so caller text inside an error message cannot start
 * a fake new line, reorder what a reader sees, or send a terminal escape.
 */
export function escapeText(text: string): string {
  return text.replace(
    /[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu,
    (ch) => SHORT_ESCAPES.get(ch) ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** A caller string as a quoted, escaped label for an error message. */
export function quote(text: string): string {
  return `"${escapeText(text.replace(/["\\]/g, "\\$&"))}"`;
}

/** A thrown value's message, escaped; never throws itself. */
export function describeError(error: unknown): string {
  try {
    return escapeText(error instanceof Error ? String(error.message) : String(error));
  } catch {
    return "(unprintable thrown value)";
  }
}

/** Any value, described for an error message without running caller code that could throw. */
export function describeValue(value: unknown): string {
  if (typeof value === "string") return quote(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "object" && value !== null) return "an object";
  if (typeof value === "function") return "a function";
  return typeof value === "symbol" ? "a symbol" : String(value);
}

export const hasOwn = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

/** Only a plain `{}` or `Object.create(null)` object counts as an options record. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || kindOf(value) !== "Object") return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Blank means only whitespace and default-ignorable characters (zero-width and bidi formatting marks). */
export function isBlank(text: string): boolean {
  return /^[\s\p{Default_Ignorable_Code_Point}]*$/u.test(text);
}
