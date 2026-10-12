import { useCallback, useEffect, useRef, useState } from "react";
import type { CaseResponse, CaseSummary } from "@caseflow/shared";
import { api, ApiError } from "./api";
import type { PolicySummary } from "./api";

/** Metadata the server pushes for every appended event (GET /api/stream). */
export interface StreamEvent {
  id: number;
  caseNumber: string;
  type: string;
  actor: string;
  createdAt: string;
}

// One EventSource for the whole app, shared by every subscriber.
const subscribers = new Set<(e: StreamEvent) => void>();
let source: EventSource | null = null;

function subscribe(listener: (e: StreamEvent) => void): () => void {
  subscribers.add(listener);
  if (!source) {
    source = new EventSource("/api/stream");
    source.addEventListener("case-event", (msg) => {
      const event = JSON.parse((msg as MessageEvent<string>).data) as StreamEvent;
      subscribers.forEach((s) => s(event));
    });
  }
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0 && source) {
      source.close();
      source = null;
    }
  };
}

export function useEventStream(listener: (e: StreamEvent) => void): void {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => subscribe((e) => ref.current(e)), []);
}

interface Resource<T> {
  data: T | null;
  error: string | null;
  reload: () => void;
}

/** Fetch once, then refetch (debounced) whenever a matching event arrives. */
function useLiveResource<T>(load: () => Promise<T>, matches: (e: StreamEvent) => boolean, deps: unknown[]): Resource<T> & { lastEvent: StreamEvent | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<StreamEvent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => {
    load()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not reach the CaseFlow API."));
  }, deps);

  useEffect(() => {
    setData(null);
    reload();
  }, [reload]);

  useEventStream((e) => {
    if (!matches(e)) return;
    setLastEvent(e);
    clearTimeout(timer.current);
    timer.current = setTimeout(reload, 120);
  });

  return { data, error, reload, lastEvent };
}

export const useCases = () => useLiveResource<CaseSummary[]>(() => api.cases(), () => true, []);

export const useCase = (caseNumber: string) =>
  useLiveResource<CaseResponse>(() => api.case(caseNumber), (e) => e.caseNumber === caseNumber, [caseNumber]);

export function usePolicies(): Resource<PolicySummary[]> {
  const [data, setData] = useState<PolicySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api.policies().then(setData, () => setError("Could not load policies."));
  }, []);
  useEffect(reload, [reload]);
  return { data, error, reload };
}
