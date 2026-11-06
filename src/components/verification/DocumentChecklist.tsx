"use client";

import { useRef, useState, useTransition } from "react";
import { FileText, Image as ImageIcon, Trash2, Upload } from "lucide-react";
import {
  finalizeDocumentAction,
  removeDocumentAction,
  requestDocumentUploadAction,
  submitVerificationAction,
} from "@/app/account/verification/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { Button } from "@/components/ui";
import { putFile } from "@/lib/storage/put-file";
import {
  DOCUMENT_LABELS,
  DOCUMENT_REJECT_MESSAGES,
  isDocumentMime,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_FILES,
  MAX_FILES_PER_TYPE,
  missingDocumentTypes,
  type DocumentType,
} from "@/lib/verification/rules";

export interface ChecklistDocument {
  id: string;
  documentType: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
}

const ACCEPT = "application/pdf,image/jpeg,image/png";

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Upload list for a verification request (prompt S12 decision 10; design 05 document rows). One
 * row per required document type; files go straight to private storage by presigned PUT, then the
 * server checks and records them. Listers can remove their files but never download them.
 */
export function DocumentChecklist({ required, documents }: { required: DocumentType[]; documents: ChecklistDocument[] }) {
  const [busyType, setBusyType] = useState<DocumentType | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  // Server Actions run inside a transition so their refresh() re-renders this list.
  const [, startAction] = useTransition();
  const inputs = useRef<Partial<Record<DocumentType, HTMLInputElement | null>>>({});

  const missing = missingDocumentTypes(required, documents.map((d) => d.documentType));
  const full = documents.length >= MAX_DOCUMENT_FILES;
  const busy = busyType !== null || removing !== null || submitting;

  /**
   * Busy and message state is set before the transition so it shows at once; the Server Actions
   * then run inside the transition, so their refresh() re-renders the list with the new file.
   */
  function pick(type: DocumentType, file: File) {
    setError(null);
    setNotice(null);
    const input = inputs.current[type];
    if (input) input.value = "";
    if (!isDocumentMime(file.type)) return setError(DOCUMENT_REJECT_MESSAGES.type);
    if (file.size === 0) return setError(DOCUMENT_REJECT_MESSAGES.empty);
    if (file.size > MAX_DOCUMENT_BYTES) return setError(DOCUMENT_REJECT_MESSAGES.size);
    setBusyType(type);
    setProgress(0);
    startAction(() => upload(type, file));
  }

  async function upload(type: DocumentType, file: File) {
    try {
      const request = await requestDocumentUploadAction({ documentType: type, contentType: file.type, size: file.size });
      if (!request.ok) return setError(request.error);
      const sent = await putFile(request.uploadUrl, file, setProgress);
      if (!sent) return setError("The upload didn't finish. Check your connection and try again.");
      const done = await finalizeDocumentAction({ uploadKey: request.uploadKey, documentType: type, fileName: file.name });
      if (!done.ok) return setError(done.error);
      setNotice(`${DOCUMENT_LABELS[type].label} added.`);
    } finally {
      setBusyType(null);
    }
  }

  function startRemove(document: ChecklistDocument) {
    setError(null);
    setNotice(null);
    setRemoving(document.id);
    startAction(() => remove(document));
  }

  async function remove(document: ChecklistDocument) {
    try {
      const result = await removeDocumentAction({ documentId: document.id });
      if (!result.ok) setError(result.error);
      else setNotice("Document removed.");
    } finally {
      setRemoving(null);
    }
  }

  function submit() {
    setError(null);
    setNotice(null);
    startSubmit(async () => {
      const result = await submitVerificationAction();
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <section aria-labelledby="documents-heading" className="flex flex-col gap-5 rounded-lg border border-line bg-white p-5 md:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="documents-heading" className="text-title">
          Your documents
        </h2>
        <p className="text-small text-slate-600">
          PDF, JPEG or PNG, up to 10 MB each and {MAX_FILES_PER_TYPE} files per document. Only our review team can open them; they
          are never shown on your profile.
        </p>
      </div>

      {error && <FormAlert state={{ formError: error }} />}
      {notice && <FormAlert state={{ message: notice }} />}
      <p role="status" aria-live="polite" className="sr-only">
        {busyType ? `Uploading ${DOCUMENT_LABELS[busyType].label}: ${progress}%` : ""}
      </p>

      <ul className="flex flex-col gap-3">
        {required.map((type) => {
          const files = documents.filter((d) => d.documentType === type);
          const canAdd = files.length < MAX_FILES_PER_TYPE && !full;
          const inputId = `document-${type}`;
          const uploading = busyType === type;
          return (
            <li key={type} className="flex flex-col gap-3 rounded-sm bg-canvas p-3">
              <div className="flex flex-col gap-1">
                <p className="text-small font-semibold text-ink">
                  {DOCUMENT_LABELS[type].label}
                  {files.length === 0 && <span className="ml-2 text-micro font-medium text-warning-text">Required</span>}
                </p>
                <p className="text-micro text-slate-600">{DOCUMENT_LABELS[type].hint}</p>
              </div>

              {files.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {files.map((file) => (
                    <li key={file.id} className="flex items-center gap-3 rounded-sm border border-line bg-white p-2 pl-3">
                      <span
                        aria-hidden="true"
                        className="inline-flex size-control-sm shrink-0 items-center justify-center rounded-sm bg-mint-50 text-emerald-700"
                      >
                        {file.contentType === "application/pdf" ? <FileText className="size-4" /> : <ImageIcon className="size-4" />}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-small text-ink">{file.fileName}</span>
                        <span className="text-micro text-slate-600">
                          {file.contentType === "application/pdf" ? "PDF" : "Image"} · {formatSize(file.sizeBytes)}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        className="px-3"
                        disabled={busy}
                        loading={removing === file.id}
                        onClick={() => startRemove(file)}
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                        Remove<span className="sr-only"> {file.fileName}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {canAdd && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    ref={(el) => {
                      inputs.current[type] = el;
                    }}
                    id={inputId}
                    type="file"
                    accept={ACCEPT}
                    className="sr-only"
                    disabled={busy}
                    aria-label={`Add a file for ${DOCUMENT_LABELS[type].label}`}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) pick(type, file);
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full sm:w-auto"
                    disabled={busy}
                    loading={uploading}
                    onClick={() => inputs.current[type]?.click()}
                  >
                    <Upload aria-hidden="true" className="size-4" />
                    {files.length === 0 ? "Add file" : "Add another file"}
                  </Button>
                  {uploading && (
                    <span aria-hidden="true" className="text-micro text-slate-600 tabular">
                      Uploading… {progress}%
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-small text-slate-600">
          {missing.length === 0
            ? "Everything we need is here. Submit when you're ready."
            : `Still needed: ${missing.map((type) => DOCUMENT_LABELS[type].label).join(", ")}.`}
        </p>
        <Button type="button" className="w-full sm:w-auto" disabled={busy || missing.length > 0} loading={submitting} onClick={submit}>
          Submit for review
        </Button>
      </div>
    </section>
  );
}
