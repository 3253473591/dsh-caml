/**
 * Cordis plugin entry for dsh-caml.
 *
 * Wiring (config, store, tools) is added by later tasks; this module only
 * carries the stable plugin identity so the entry point exists.
 */
export const name = 'dsh-caml'

export function apply(_ctx: unknown): void {
  // Tool registration and store lifecycle are added in T1.4 / T1.5.
}
