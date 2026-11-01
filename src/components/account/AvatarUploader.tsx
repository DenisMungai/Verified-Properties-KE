"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import {
  finalizeAvatarUploadAction,
  removeAvatarAction,
  requestAvatarUploadAction,
} from "@/app/account/profile/avatar-actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { Avatar, Button } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES, MIN_AVATAR_SIDE, isImageMime } from "@/lib/storage/limits";
import { putFile } from "@/lib/storage/put-file";

type Step = "idle" | "uploading" | "processing" | "removing";

const STEP_TEXT: Record<Exclude<Step, "idle">, string> = {
  uploading: "Uploading…",
  processing: "Processing…",
  removing: "Removing…",
};

/**
 * "Profile photo" panel on Listing profile (prompt lister-avatars). Pre-checks type and size for
 * a quick message, then uploads straight to storage; the server re-checks everything.
 */
export function AvatarUploader({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [step, setStep] = useState<Step>("idle");
  const [notice, setNotice] = useState<ActionState>({});
  const [, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const busy = step !== "idle";

  const fail = (error: string) => {
    setNotice({ formError: error });
    setStep("idle");
  };

  async function upload(file: File) {
    if (!isImageMime(file.type)) return fail("Upload a JPEG, PNG or WebP photo.");
    if (file.size > MAX_UPLOAD_BYTES) return fail("Photos must be 8 MB or smaller.");
    setNotice({});
    setStep("uploading");
    const request = await requestAvatarUploadAction({ contentType: file.type, size: file.size });
    if (!request.ok) return fail(request.error);
    if (!(await putFile(request.uploadUrl, file, () => undefined))) return fail("The upload didn't finish. Please try again.");
    setStep("processing");
    const result = await finalizeAvatarUploadAction({ uploadKey: request.uploadKey });
    if (!result.ok) return fail(result.error);
    setNotice({ ok: true, message: result.message });
    setStep("idle");
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) startTransition(() => upload(file));
  }

  function onRemove() {
    setNotice({});
    setStep("removing");
    startTransition(async () => {
      const result = await removeAvatarAction();
      if (!result.ok) return fail(result.error);
      setNotice({ ok: true, message: result.message });
      setStep("idle");
    });
  }

  return (
    <section aria-labelledby="avatar-heading" className="flex max-w-2xl flex-col gap-4 rounded-lg border border-line bg-white p-5">
      <FormAlert state={notice} />
      <div className="flex items-center gap-5">
        <Avatar name={name} baseUrl={avatarUrl} size="xl" />
        <div className="flex min-w-0 flex-col gap-2">
          <div>
            <h2 id="avatar-heading" className="text-small font-semibold text-ink">
              Profile photo
            </h2>
            <p className="text-micro text-slate-600">
              JPEG, PNG or WebP · up to 8 MB · at least {MIN_AVATAR_SIDE} × {MIN_AVATAR_SIDE}. Shown on your listings.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={input}
              type="file"
              accept={IMAGE_MIME_TYPES.join(",")}
              onChange={onPick}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />
            <Button type="button" variant="secondary" loading={step === "uploading" || step === "processing"} disabled={busy} onClick={() => input.current?.click()}>
              {avatarUrl ? "Change photo" : "Upload photo"}
            </Button>
            {avatarUrl && (
              <Button type="button" variant="quiet" loading={step === "removing"} disabled={busy} onClick={onRemove}>
                Remove
              </Button>
            )}
            <span role="status" className="text-micro text-slate-600">
              {busy ? STEP_TEXT[step] : ""}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
