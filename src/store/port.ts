/**
 * Storage port. The surface grows with the tasks that need it:
 * T1.3 = open/close, T1.4 = current/remember/recall, T2.3 = audit.
 */
export interface FactStore {
  close(): Promise<void>
}
