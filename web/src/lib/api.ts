import type { CaseResponse, CaseSummary, FactChanges } from "@caseflow/shared";
import { getCurrentUser } from "./user";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-caseflow-user", getCurrentUser());
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.code);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

export interface PolicySummary {
  version: string;
  title: string;
  effectiveFrom: string;
  effectiveTo: string;
  manualReference: string;
  provisional: { field: string; reason: string }[];
  sources: { label: string; url?: string; covers: string }[];
}

export const api = {
  cases: () => request<CaseSummary[]>("/cases"),
  case: (caseNumber: string) => request<CaseResponse>(`/cases/${caseNumber}`),
  policies: () => request<PolicySummary[]>("/policies"),
  upload: (caseNumber: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<unknown>(`/cases/${caseNumber}/documents`, { method: "POST", body: form });
  },
  run: (caseNumber: string) => post<{ accepted: boolean }>(`/cases/${caseNumber}/run`),
  revise: (caseNumber: string, changes: FactChanges, reason: string) => post<CaseResponse>(`/cases/${caseNumber}/revise`, { changes, reason }),
  approve: (caseNumber: string, note: string | null) => post<CaseResponse>(`/cases/${caseNumber}/approve`, { note }),
  pend: (caseNumber: string, reason: string) => post<CaseResponse>(`/cases/${caseNumber}/pend`, { reason }),
  retryNotice: (caseNumber: string) => post<{ accepted: boolean }>(`/cases/${caseNumber}/notice`),
  samples: () => request<string[]>("/samples"),
  sampleFile: async (fileName: string) => {
    const res = await fetch(`/api/samples/${fileName}`);
    if (!res.ok) throw new ApiError(`Sample ${fileName} not found`, res.status);
    return new File([await res.blob()], fileName, { type: "application/pdf" });
  },
  documentUrl: (caseNumber: string, documentId: string) => `/api/cases/${caseNumber}/documents/${documentId}`,
};
