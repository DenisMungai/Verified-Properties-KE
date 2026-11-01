"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type MouseEvent } from "react";
import { ArrowDown, ArrowRight, ArrowUp, ImagePlus, RotateCcw, Star, Trash2, X } from "lucide-react";
import {
  deletePhotoAction,
  finalizePhotoUploadAction,
  movePhotoAction,
  requestPhotoUploadAction,
  setCoverPhotoAction,
  updatePhotoAltAction,
  type PhotoActionResult,
} from "@/app/account/listings/photo-actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { Badge, Button, Field, IconButton, Input, buttonClasses } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { putFile } from "@/lib/storage/put-file";
import {
  IMAGE_MIME_TYPES,
  MAX_PHOTOS_PER_LISTING,
  MAX_UPLOAD_BYTES,
  MIN_PHOTO_HEIGHT,
  MIN_PHOTO_WIDTH,
  PHOTO_ALT_MAX,
  PHOTO_ALT_MIN,
  isImageMime,
} from "@/lib/storage/limits";
import { ListingImage } from "./ListingImage";

export interface ManagedPhoto {
  id: string;
  baseUrl: string | null;
  altText: string;
  isCover: boolean;
}

type StagedState = "ready" | "waiting" | "uploading" | "processing" | "failed" | "invalid";

interface Staged {
  key: string;
  file: File;
  preview: string;
  alt: string;
  state: StagedState;
  progress: number;
  error?: string;
}

const PARALLEL_UPLOADS = 2;
const HINT = `JPEG, PNG or WebP · up to 8 MB · at least ${MIN_PHOTO_WIDTH} × ${MIN_PHOTO_HEIGHT} · up to ${MAX_PHOTOS_PER_LISTING} photos`;

const altReady = (alt: string) => alt.trim().length >= PHOTO_ALT_MIN;
const isActive = (state: StagedState) => state === "waiting" || state === "uploading" || state === "processing";

function stateText(item: Staged): string {
  switch (item.state) {
    case "ready":
      if (altReady(item.alt)) return "Ready: press Upload to save it";
      return item.alt.trim() ? "Not uploaded yet: the description is too short" : "Not uploaded yet: add a description";
    case "waiting":
      return "Waiting";
    case "uploading":
      return `Uploading ${item.progress}%`;
    case "processing":
      return "Processing";
    case "failed":
    case "invalid":
      return `Failed: ${item.error ?? "please try again."}`;
  }
}

/**
 * Photos step (prompt S4): stage files with required descriptions, upload them straight to
 * storage (two at a time), then manage order, cover, descriptions and deletion. Every change is
 * re-checked on the server; this component only drives the flow.
 */
export function PhotoManager({
  listingId,
  photos,
  editable,
  reviewWarning,
  continueHref,
  saveHref,
}: {
  listingId: string;
  photos: ManagedPhoto[];
  editable: boolean;
  reviewWarning: string | null;
  continueHref: string;
  saveHref: string;
}) {
  const [staged, setStaged] = useState<Staged[]>([]);
  const [notice, setNotice] = useState<ActionState>({});
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const previews = useRef(new Set<string>());

  // Revoke local previews on unmount.
  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const uploading = staged.some((item) => isActive(item.state));
  const uploadable = staged.filter((item) => item.state === "ready" || item.state === "failed");
  // Described photos upload now; the rest wait for their description instead of blocking the batch.
  const described = uploadable.filter((item) => altReady(item.alt));
  const needDescription = uploadable.length - described.length;
  const canUpload = !uploading && described.length > 0;
  // Picked but not saved: these are lost if the lister leaves the step.
  const notUploaded = staged.filter((item) => item.state === "ready" || item.state === "failed" || isActive(item.state)).length;
  const slotsLeft = MAX_PHOTOS_PER_LISTING - photos.length - staged.filter((s) => s.state !== "invalid").length;

  // Warn before a reload or tab close would drop photos that were picked but never uploaded.
  useEffect(() => {
    if (notUploaded === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [notUploaded]);

  /** In-app links skip beforeunload, so confirm before leaving with photos still to upload. */
  function confirmLeave(event: MouseEvent<HTMLAnchorElement>) {
    if (notUploaded === 0) return;
    const photos = `${notUploaded} photo${notUploaded === 1 ? " hasn't" : "s haven't"}`;
    if (!window.confirm(`${photos} been uploaded yet and will be lost. Leave anyway?`)) event.preventDefault();
  }

  function patch(key: string, changes: Partial<Staged>) {
    setStaged((items) => items.map((item) => (item.key === key ? { ...item, ...changes } : item)));
  }

  function removeStaged(key: string) {
    setStaged((items) => {
      const found = items.find((item) => item.key === key);
      if (found) {
        URL.revokeObjectURL(found.preview);
        previews.current.delete(found.preview);
      }
      return items.filter((item) => item.key !== key);
    });
  }

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    let room = slotsLeft;
    const next: Staged[] = [];
    for (const file of Array.from(files)) {
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      const base = { key: crypto.randomUUID(), file, preview, alt: "", progress: 0 };
      let error: string | undefined;
      if (!isImageMime(file.type)) error = "Upload a JPEG, PNG or WebP photo.";
      else if (file.size > MAX_UPLOAD_BYTES) error = "Photos must be 8 MB or smaller.";
      else if (room <= 0) error = `A listing can have up to ${MAX_PHOTOS_PER_LISTING} photos.`;
      if (!error) room -= 1;
      next.push(error ? { ...base, state: "invalid", error } : { ...base, state: "ready" });
    }
    setStaged((items) => [...items, ...next]);
    setNotice({});
    if (input.current) input.current.value = "";
  }

  async function uploadOne(item: Staged): Promise<boolean> {
    patch(item.key, { state: "uploading", progress: 0, error: undefined });
    const request = await requestPhotoUploadAction({ listingId, contentType: item.file.type, size: item.file.size });
    if (!request.ok) {
      patch(item.key, { state: "failed", error: request.error });
      return false;
    }
    const sent = await putFile(request.uploadUrl, item.file, (progress) => patch(item.key, { progress }));
    if (!sent) {
      patch(item.key, { state: "failed", error: "The upload didn't finish. Check your connection and retry." });
      return false;
    }
    patch(item.key, { state: "processing", progress: 100 });
    const done = await finalizePhotoUploadAction({ listingId, uploadKey: request.uploadKey, altText: item.alt });
    if (!done.ok) {
      patch(item.key, { state: "failed", error: done.error });
      return false;
    }
    if (done.message) setNotice({ message: done.message });
    removeStaged(item.key);
    return true;
  }

  async function uploadAll(items: Staged[]) {
    setNotice({});
    for (const item of items) patch(item.key, { state: "waiting" });
    const queue = [...items];
    let added = 0;
    let failed = 0;
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        if (await uploadOne(item)) added += 1;
        else failed += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, queue.length) }, worker));
    const summary = [added && `${added} photo${added === 1 ? "" : "s"} added.`, failed && `${failed} failed.`]
      .filter(Boolean)
      .join(" ");
    setAnnouncement(summary);
  }

  function edit(run: () => Promise<PhotoActionResult>, success: string) {
    startTransition(async () => {
      const result = await run();
      // Updates after an await need their own transition, so the announcement commits together
      // with the refreshed photo list rather than before it.
      startTransition(() => {
        if (result.ok) {
          setNotice({});
          setAnnouncement(success);
        } else {
          setNotice({ formError: result.error });
        }
      });
    });
  }

  const ids = (photoId: string) => ({ listingId, photoId });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-title">Property photos</h2>
        <p className="text-small text-slate-700">
          {photos.length} of {MAX_PHOTOS_PER_LISTING} photos. The cover photo is shown first in search.
        </p>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <FormAlert state={notice} />

      {editable ? (
        <section aria-labelledby="add-photos-heading" className="flex flex-col gap-4">
          <h3 id="add-photos-heading" className="sr-only">
            Add photos
          </h3>
          {reviewWarning && <p className="rounded-md bg-warning-tint px-4 py-3 text-small text-warning-text">{reviewWarning}</p>}
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              addFiles(event.dataTransfer.files);
            }}
            className={cn(
              "flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-4 py-6 text-center",
              dragging ? "border-emerald-600 bg-mint-50" : "border-line-strong bg-canvas",
            )}
          >
            <ImagePlus aria-hidden="true" className="size-8 text-emerald-700" />
            <p className="text-body text-ink">
              Drag photos here or{" "}
              <button
                type="button"
                onClick={() => input.current?.click()}
                disabled={slotsLeft <= 0}
                className="inline-flex min-h-control items-center font-semibold text-emerald-700 underline underline-offset-4 hover:text-ink disabled:text-slate-600 disabled:no-underline"
                aria-describedby="photo-hint"
              >
                choose files
              </button>
            </p>
            <p id="photo-hint" className="text-micro text-slate-600">
              {HINT}
            </p>
            <input
              ref={input}
              type="file"
              accept={IMAGE_MIME_TYPES.join(",")}
              multiple
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
              onChange={(event) => addFiles(event.target.files)}
            />
          </div>

          {staged.length > 0 && (
            <div className="flex flex-col gap-4">
              <ul aria-label="Photos to upload" className="flex flex-col gap-4">
                {staged.map((item) => (
                  <StagedRow
                    key={item.key}
                    item={item}
                    onAlt={(alt) => patch(item.key, { alt })}
                    onRemove={() => removeStaged(item.key)}
                    onRetry={altReady(item.alt) ? () => void uploadAll([item]) : undefined}
                  />
                ))}
              </ul>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  size="lg"
                  onClick={() => void uploadAll(described)}
                  disabled={!canUpload}
                  loading={uploading}
                  className="w-full sm:w-auto"
                >
                  {described.length > 0
                    ? `Upload ${described.length} photo${described.length === 1 ? "" : "s"}`
                    : "Upload photos"}
                </Button>
                {!uploading && needDescription > 0 && (
                  <p className="text-micro text-slate-600">
                    {needDescription} photo{needDescription === 1 ? " needs a description" : "s need descriptions"} of at least{" "}
                    {PHOTO_ALT_MIN} characters before {needDescription === 1 ? "it" : "they"} can upload.
                  </p>
                )}
              </div>
            </div>
          )}
        </section>
      ) : (
        <p className="rounded-md bg-canvas px-4 py-3 text-small text-slate-700">
          Photos can&apos;t be changed on this listing.
        </p>
      )}

      {photos.length > 0 ? (
        <ol aria-label="Listing photos" className="flex flex-col gap-3">
          {photos.map((photo, index) => (
            <PhotoRow
              key={photo.id}
              photo={photo}
              position={index + 1}
              isFirst={index === 0}
              isLast={index === photos.length - 1}
              disabled={!editable || pending}
              onMove={(direction) =>
                edit(() => movePhotoAction(ids(photo.id), direction), `Photo ${index + 1} moved ${direction}.`)
              }
              onCover={() => edit(() => setCoverPhotoAction(ids(photo.id)), "Cover updated.")}
              onAlt={(alt) => edit(() => updatePhotoAltAction(ids(photo.id), alt), "Description saved.")}
              onDelete={() => edit(() => deletePhotoAction(ids(photo.id)), `Photo ${index + 1} deleted.`)}
            />
          ))}
        </ol>
      ) : (
        <p className="text-small text-slate-600">No photos yet. Add at least one to submit the listing.</p>
      )}

      <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Link href={saveHref} onClick={confirmLeave} className={buttonClasses({ variant: "secondary", size: "lg", className: "w-full sm:w-auto" })}>
          Save draft
        </Link>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          {!uploading && notUploaded > 0 && (
            <p className="text-micro font-medium text-warning-text">
              {notUploaded} photo{notUploaded === 1 ? " isn't" : "s aren't"} uploaded yet. Describe {notUploaded === 1 ? "it" : "each one"} and
              press Upload, or {notUploaded === 1 ? "it" : "they"} won&apos;t be saved.
            </p>
          )}
          {uploading ? (
            <>
              <Button size="lg" disabled aria-describedby="continue-wait" className="w-full sm:w-auto">
                Continue
                <ArrowRight aria-hidden="true" className="size-4" />
              </Button>
              <p id="continue-wait" className="text-micro text-slate-600">
                Wait for uploads to finish.
              </p>
            </>
          ) : (
            <Link href={continueHref} onClick={confirmLeave} className={buttonClasses({ size: "lg", className: "w-full sm:w-auto" })}>
              Continue
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function StagedRow({
  item,
  onAlt,
  onRemove,
  onRetry,
}: {
  item: Staged;
  onAlt: (alt: string) => void;
  onRemove: () => void;
  onRetry?: () => void;
}) {
  const active = isActive(item.state);
  const failed = item.state === "failed" || item.state === "invalid";
  const fieldId = `alt-${item.key}`;
  const typed = item.alt.trim().length;
  const tooShort = typed > 0 && typed < PHOTO_ALT_MIN;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-line p-3 sm:flex-row sm:gap-4">
      {/* A local preview of the chosen file; decorative, the description field names it. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- blob: URLs can't use next/image */}
      <img src={item.preview} alt="" className="aspect-[4/3] w-24 shrink-0 self-start rounded-md object-cover sm:w-32" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {item.state === "invalid" ? (
          <p className="break-words text-small font-medium text-ink">{item.file.name}</p>
        ) : (
          <Field
            id={fieldId}
            label="Describe this photo"
            hint={`At least ${PHOTO_ALT_MIN} characters, e.g. “Living room with balcony view”. Read aloud to people using screen readers.`}
            error={
              tooShort
                ? `Add ${PHOTO_ALT_MIN - typed} more character${PHOTO_ALT_MIN - typed === 1 ? "" : "s"} (at least ${PHOTO_ALT_MIN}).`
                : undefined
            }
            required
          >
            {(control) => (
              <Input
                {...control}
                value={item.alt}
                maxLength={PHOTO_ALT_MAX}
                disabled={active}
                onChange={(event) => onAlt(event.target.value)}
              />
            )}
          </Field>
        )}
        {active && (
          <div
            role="progressbar"
            aria-label={`Upload progress for ${item.file.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={item.progress}
            className="h-2 overflow-hidden rounded-full bg-line"
          >
            <div className="h-full rounded-full bg-emerald-600 transition-[width]" style={{ width: `${item.progress}%` }} />
          </div>
        )}
        <p className={cn("text-micro", failed ? "font-medium text-danger" : "text-slate-600")}>{stateText(item)}</p>
        {!active && (
          <div className="flex flex-wrap gap-2">
            {item.state === "failed" && onRetry && (
              <Button variant="secondary" onClick={onRetry}>
                <RotateCcw aria-hidden="true" className="size-4" />
                Retry
              </Button>
            )}
            <Button variant="quiet" onClick={onRemove} aria-label={`Remove ${item.file.name}`}>
              <X aria-hidden="true" className="size-4" />
              Remove
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function PhotoRow({
  photo,
  position,
  isFirst,
  isLast,
  disabled,
  onMove,
  onCover,
  onAlt,
  onDelete,
}: {
  photo: ManagedPhoto;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onMove: (direction: "up" | "down") => void;
  onCover: () => void;
  onAlt: (alt: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [alt, setAlt] = useState(photo.altText);
  const fieldId = `photo-alt-${photo.id}`;
  return (
    <li className="flex flex-col gap-3 rounded-lg bg-canvas p-3 sm:flex-row sm:gap-4">
      {/* self-start keeps the 4:3 frame from stretching to the row's height. */}
      <ListingImage
        baseUrl={photo.baseUrl}
        alt={photo.altText}
        sizes="(min-width: 640px) 128px, 100vw"
        className="w-full shrink-0 self-start rounded-md sm:w-32"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-micro font-medium text-slate-600">Photo {position}</span>
          {photo.isCover && (
            <Badge tone="verified" icon={<Star aria-hidden="true" className="size-3" />}>
              Cover
            </Badge>
          )}
        </div>
        {editing ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!altReady(alt)) return;
              onAlt(alt.trim());
              setEditing(false);
            }}
          >
            <Field
              id={fieldId}
              label="Photo description"
              error={altReady(alt) ? undefined : `Use at least ${PHOTO_ALT_MIN} characters.`}
              required
            >
              {(control) => (
                <Input {...control} value={alt} maxLength={PHOTO_ALT_MAX} onChange={(event) => setAlt(event.target.value)} />
              )}
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="secondary" disabled={disabled || !altReady(alt)}>
                Save description
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setAlt(photo.altText);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col items-start">
            <p className="break-words text-small text-ink">{photo.altText}</p>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setEditing(true)}
              aria-label={`Edit description of photo ${position}`}
              className="inline-flex min-h-control items-center text-small font-medium text-emerald-700 underline underline-offset-4 hover:text-ink disabled:text-slate-600"
            >
              Edit description
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <IconButton
            label={`Move photo ${position} up`}
            icon={<ArrowUp />}
            disabled={disabled || isFirst}
            onClick={() => onMove("up")}
          />
          <IconButton
            label={`Move photo ${position} down`}
            icon={<ArrowDown />}
            disabled={disabled || isLast}
            onClick={() => onMove("down")}
          />
          {!photo.isCover && (
            <Button variant="quiet" disabled={disabled} onClick={onCover} aria-label={`Set as cover: photo ${position}`}>
              <Star aria-hidden="true" className="size-4" />
              Set as cover
            </Button>
          )}
          <details className="group relative">
            <summary
              aria-label={`Delete photo ${position}`}
              className={cn(
                "inline-flex size-control cursor-pointer list-none items-center justify-center rounded-md text-danger hover:bg-danger-tint [&::-webkit-details-marker]:hidden",
                disabled && "pointer-events-none text-slate-500",
              )}
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </summary>
            <div className="mt-2 flex flex-col gap-2 rounded-md border border-line bg-white p-3 sm:absolute sm:right-0 sm:z-10 sm:w-64">
              <p className="text-small text-ink">Delete this photo? This can&apos;t be undone.</p>
              <Button variant="danger" disabled={disabled} onClick={onDelete}>
                Delete photo {position}
              </Button>
            </div>
          </details>
        </div>
      </div>
    </li>
  );
}
