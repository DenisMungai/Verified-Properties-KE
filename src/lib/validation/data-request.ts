import { z } from "zod";
import {
  DATA_REQUEST_DETAILS_MAX,
  DATA_REQUEST_DETAILS_MIN,
  DATA_REQUEST_KINDS,
  DATA_REQUEST_NOTE_MAX,
} from "@/lib/legal";

/** Data requests (prompt S20 decision 7). Shared by the form and the Server Actions. */

export const DATA_REQUEST_FIELDS = ["kind", "details"] as const;

export const dataRequestSchema = z.object({
  kind: z.enum(DATA_REQUEST_KINDS, { error: "Choose what you want to do." }),
  details: z
    .string({ error: "Tell us a little more." })
    .trim()
    .min(DATA_REQUEST_DETAILS_MIN, { error: `Tell us a little more (at least ${DATA_REQUEST_DETAILS_MIN} characters).` })
    .max(DATA_REQUEST_DETAILS_MAX, { error: `Use ${DATA_REQUEST_DETAILS_MAX} characters or fewer.` }),
});

export type DataRequestInput = z.infer<typeof dataRequestSchema>;

export const closeDataRequestSchema = z.object({
  requestId: z.uuid({ error: "We couldn't find that request." }),
  note: z
    .string({ error: "Add a note for the user." })
    .trim()
    .min(1, { error: "Add a note for the user." })
    .max(DATA_REQUEST_NOTE_MAX, { error: `Use ${DATA_REQUEST_NOTE_MAX} characters or fewer.` }),
});
