import { useSyncExternalStore } from "react";

/** The signed-in Benefit Programs Specialist. A picker stands in for agency SSO (SPEC §9). */
export const BPS_USERS = [
  { id: "bps:kibrahim", name: "K. Ibrahim" },
  { id: "bps:mlopez", name: "M. Lopez" },
] as const;

const KEY = "caseflow.user";
const listeners = new Set<() => void>();

function read(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && BPS_USERS.some((u) => u.id === stored)) return stored;
  } catch {
    // Storage unavailable (private window): fall through to the default.
  }
  return BPS_USERS[0].id;
}

let current = read();

export function getCurrentUser(): string {
  return current;
}

export function setCurrentUser(id: string): void {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Not persisted; still applies for this session.
  }
  listeners.forEach((l) => l());
}

export function useCurrentUser(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getCurrentUser,
  );
}

export const userName = (id: string) => BPS_USERS.find((u) => u.id === id)?.name ?? id.replace(/^bps:/, "");
