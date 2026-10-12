import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Alert,
  AlertText,
  Button,
  ButtonGroup,
  Checkbox,
  FileInput,
  Label,
  Modal,
  ModalFooter,
  ModalHeading,
  TextInput,
  Textarea,
  type FileInputRef,
  type ModalRef,
} from "@trussworks/react-uswds";
import type { CaseResponse, FactChanges, VerificationFlag } from "@caseflow/shared";
import { api, ApiError } from "../lib/api";
import { centsToDollarString, dollarsToCents, money } from "../lib/format";

const isFinal = (v: CaseResponse) => v.status === "APPROVED" || v.status === "NOTICE_READY";
const message = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Please try again.");

export interface ActionsHandle {
  openRevise: (suggestion?: VerificationFlag) => void;
}

/** What the BPS can do next: add documents, run the pipeline, revise facts, approve, or pend (ADR-0008). */
export const ActionsPanel = forwardRef<ActionsHandle, { view: CaseResponse }>(function ActionsPanel({ view }, ref) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<string[]>([]);
  const fileInput = useRef<FileInputRef>(null);
  const reviseModal = useRef<ReviseHandle>(null);
  const approveModal = useRef<ModalRef>(null);
  const pendModal = useRef<ModalRef>(null);

  const final = isFinal(view);
  const processing = view.status === "PROCESSING";
  const prefix = view.applicant?.headOfHousehold.last.toLowerCase();

  useEffect(() => {
    api
      .samples()
      .then((all) => setSamples(all.filter((f) => prefix && f.startsWith(`${prefix}-`) && !view.documents.some((d) => d.fileName === f))))
      .catch(() => setSamples([]));
  }, [prefix, view.documents]);

  useImperativeHandle(ref, () => ({ openRevise: (suggestion) => reviseModal.current?.open(suggestion) }), []);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  const uploadFiles = (files: File[]) =>
    act("upload", async () => {
      for (const f of files) await api.upload(view.caseNumber, f);
      fileInput.current?.clearFiles();
    });

  return (
    <section aria-labelledby="actions-heading" className="cf-card cf-actions">
      <h2 id="actions-heading" className="cf-card__title">
        Actions
      </h2>
      {error && (
        <Alert type="error" slim className="margin-bottom-2" role="alert">
          <AlertText>{error}</AlertText>
        </Alert>
      )}

      {!final && (
        <>
          <Label htmlFor="documents-input" className="margin-top-0">
            Add documents (PDF)
          </Label>
          <FileInput
            id="documents-input"
            name="documents"
            accept="application/pdf"
            multiple
            ref={fileInput}
            disabled={processing || busy !== null}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) void uploadFiles(files);
            }}
          />
          {samples.length > 0 && (
            <Button
              type="button"
              unstyled
              className="margin-top-1 font-sans-xs"
              disabled={processing || busy !== null}
              onClick={() => act("upload", async () => {
                for (const f of samples) await api.upload(view.caseNumber, await api.sampleFile(f));
              })}
            >
              Attach {samples.length} synthetic sample document{samples.length === 1 ? "" : "s"} for this applicant
            </Button>
          )}

          <Button
            type="button"
            size="big"
            className="width-full margin-top-3"
            disabled={processing || busy !== null}
            onClick={() => act("run", () => api.run(view.caseNumber))}
          >
            {processing ? "Pipeline running…" : view.determination ? "Run pipeline again" : "Run pipeline"}
          </Button>
        </>
      )}

      {view.determination && !final && !processing && (
        <ButtonGroup className="margin-top-2 cf-actions__group">
          <Button type="button" disabled={view.status !== "AWAITING_REVIEW"} onClick={() => approveModal.current?.toggleModal(undefined, true)}>
            Approve determination
          </Button>
          <Button type="button" outline onClick={() => reviseModal.current?.open()}>
            Revise facts
          </Button>
          <Button type="button" outline onClick={() => pendModal.current?.toggleModal(undefined, true)}>
            Pend
          </Button>
        </ButtonGroup>
      )}

      {final && view.approval && (
        <p className="margin-y-0">
          Approved by <strong>{view.approval.actor.replace("bps:", "")}</strong>. The case is closed to changes.
        </p>
      )}

      <ReviseModal ref={reviseModal} view={view} />
      <ApproveModal modalRef={approveModal} view={view} />
      <PendModal modalRef={pendModal} view={view} />
    </section>
  );
});

// ---------------------------------------------------------------------------------------------

interface ReviseHandle {
  open: (suggestion?: VerificationFlag) => void;
}

const FACTS: { key: Exclude<keyof FactChanges, "paysUtilities">; label: string }[] = [
  { key: "monthlyEarnedIncomeCents", label: "Earned income per month" },
  { key: "monthlyUnearnedIncomeCents", label: "Other income per month (e.g. Social Security)" },
  { key: "monthlyShelterCostCents", label: "Rent or mortgage per month" },
  { key: "countableResourcesCents", label: "Countable resources" },
];

const ReviseModal = forwardRef<ReviseHandle, { view: CaseResponse }>(function ReviseModal({ view }, ref) {
  const modal = useRef<ModalRef>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [paysUtilities, setPaysUtilities] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = view.determination?.input;

  useImperativeHandle(ref, () => ({
    open: (suggestion) => {
      if (!current) return;
      const next = { ...current, ...(suggestion?.suggestedChange?.changes ?? {}) };
      setValues(Object.fromEntries(FACTS.map((f) => [f.key, centsToDollarString(next[f.key])])));
      setPaysUtilities(next.paysUtilities);
      setReason(suggestion ? `${suggestion.code === "UNREPORTED_EMPLOYER" ? "VEC wage match" : "Verification"}: ` : "");
      setError(null);
      modal.current?.toggleModal(undefined, true);
    },
  }));

  async function submit() {
    if (!current) return;
    const changes: FactChanges = {};
    for (const f of FACTS) {
      const cents = dollarsToCents(values[f.key] ?? "");
      if (!Number.isFinite(cents) || cents < 0) return setError(`${f.label} must be a dollar amount.`);
      if (cents !== current[f.key]) changes[f.key] = cents;
    }
    if (paysUtilities !== current.paysUtilities) changes.paysUtilities = paysUtilities;
    if (Object.keys(changes).length === 0) return setError("Change at least one fact.");
    setSaving(true);
    setError(null);
    try {
      await api.revise(view.caseNumber, changes, reason);
      modal.current?.toggleModal(undefined, false);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal ref={modal} id="revise-modal" aria-labelledby="revise-heading" aria-describedby="revise-description" isLarge>
      <ModalHeading id="revise-heading">Revise facts</ModalHeading>
      <p id="revise-description">
        Correct what you have verified. The rules engine recalculates the benefit; you never enter the benefit itself. Your reason is saved in the
        audit trail.
      </p>
      {error && (
        <Alert type="error" slim role="alert">
          <AlertText>{error}</AlertText>
        </Alert>
      )}
      <div className="grid-row grid-gap">
        {FACTS.map((f) => (
          <div key={f.key} className="tablet:grid-col-6">
            <Label htmlFor={`fact-${f.key}`}>{f.label} ($)</Label>
            <TextInput
              id={`fact-${f.key}`}
              name={f.key}
              type="text"
              inputMode="decimal"
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
            {current && <span className="font-sans-2xs text-base">Currently {money(current[f.key])}</span>}
          </div>
        ))}
      </div>
      <Checkbox
        id="fact-utilities"
        name="paysUtilities"
        className="margin-top-2"
        label="Household pays heating or cooling costs (Virginia utility standard applies)"
        checked={paysUtilities}
        onChange={(e) => setPaysUtilities(e.target.checked)}
      />
      <Label htmlFor="revise-reason">Reason (required)</Label>
      <Textarea id="revise-reason" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What did you verify, and how?" />
      <ModalFooter>
        <ButtonGroup>
          <Button type="button" onClick={submit} disabled={saving}>
            {saving ? "Recalculating…" : "Save and recalculate"}
          </Button>
          <Button type="button" unstyled className="padding-105" onClick={() => modal.current?.toggleModal(undefined, false)}>
            Cancel
          </Button>
        </ButtonGroup>
      </ModalFooter>
    </Modal>
  );
});

function ApproveModal({ modalRef, view }: { modalRef: React.RefObject<ModalRef | null>; view: CaseResponse }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const d = view.determination?.determination;
  const open = view.openActionFlags.length;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.approve(view.caseNumber, note.trim() || null);
      setNote("");
      modalRef.current?.toggleModal(undefined, false);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal ref={modalRef} id="approve-modal" aria-labelledby="approve-heading" aria-describedby="approve-description">
      <ModalHeading id="approve-heading">Approve determination</ModalHeading>
      <p id="approve-description">
        {d ? (d.eligible ? `Eligible: ${money(d.monthlyBenefitCents)} per month under ${d.policyVersion}.` : `Not eligible under ${d.policyVersion}.`) : null} Approving
        records your name in the audit trail and drafts the Notice of Action.
      </p>
      {open > 0 && (
        <Alert type="warning" slim>
          <AlertText>
            {open} action-required flag{open === 1 ? " is" : "s are"} still open. Revise the facts, or explain below why the case can be approved anyway.
          </AlertText>
        </Alert>
      )}
      {error && (
        <Alert type="error" slim role="alert">
          <AlertText>{error}</AlertText>
        </Alert>
      )}
      <Label htmlFor="approve-note">Note {open > 0 ? "(required)" : "(optional)"}</Label>
      <Textarea id="approve-note" name="note" value={note} onChange={(e) => setNote(e.target.value)} />
      <ModalFooter>
        <ButtonGroup>
          <Button type="button" onClick={submit} disabled={saving}>
            {saving ? "Approving…" : "Approve"}
          </Button>
          <Button type="button" unstyled className="padding-105" onClick={() => modalRef.current?.toggleModal(undefined, false)}>
            Cancel
          </Button>
        </ButtonGroup>
      </ModalFooter>
    </Modal>
  );
}

function PendModal({ modalRef, view }: { modalRef: React.RefObject<ModalRef | null>; view: CaseResponse }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    try {
      await api.pend(view.caseNumber, reason);
      setReason("");
      modalRef.current?.toggleModal(undefined, false);
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <Modal ref={modalRef} id="pend-modal" aria-labelledby="pend-heading" aria-describedby="pend-description">
      <ModalHeading id="pend-heading">Pend for verification</ModalHeading>
      <p id="pend-description">Use this when you need more information from the applicant or an employer before deciding.</p>
      {error && (
        <Alert type="error" slim role="alert">
          <AlertText>{error}</AlertText>
        </Alert>
      )}
      <Label htmlFor="pend-reason">What are you waiting for? (required)</Label>
      <Textarea id="pend-reason" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      <ModalFooter>
        <ButtonGroup>
          <Button type="button" onClick={submit}>
            Pend case
          </Button>
          <Button type="button" unstyled className="padding-105" onClick={() => modalRef.current?.toggleModal(undefined, false)}>
            Cancel
          </Button>
        </ButtonGroup>
      </ModalFooter>
    </Modal>
  );
}
