import "server-only";
import sharp from "sharp";
import { MAX_INPUT_PIXELS } from "@/lib/storage/limits";
import { DOCUMENT_REJECT_MESSAGES, type DocumentMime } from "./rules";
import { sniffDocumentType } from "./sniff";

/**
 * Checking and cleaning an uploaded verification document (prompt S12 decisions 1 and 6).
 * Images are decoded and re-encoded, which drops EXIF and GPS data and neutralises malformed or
 * polyglot files. PDFs are stored as uploaded once their signature checks out.
 */

export class DocumentRejectedError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
    this.name = "DocumentRejectedError";
  }
}

export interface CleanDocument {
  body: Buffer;
  contentType: DocumentMime;
}

export async function cleanDocument(raw: Buffer): Promise<CleanDocument> {
  if (raw.length === 0) throw new DocumentRejectedError(DOCUMENT_REJECT_MESSAGES.empty);
  const type = sniffDocumentType(raw);
  if (!type) throw new DocumentRejectedError(DOCUMENT_REJECT_MESSAGES.type);
  if (type === "application/pdf") {
    // A PDF must also end like one; truncated uploads are refused.
    if (!raw.subarray(Math.max(0, raw.length - 1024)).toString("latin1").includes("%%EOF")) {
      throw new DocumentRejectedError(DOCUMENT_REJECT_MESSAGES.unreadable);
    }
    return { body: raw, contentType: type };
  }
  try {
    const image = sharp(raw, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    const body = type === "image/png" ? await image.png().toBuffer() : await image.jpeg({ quality: 90 }).toBuffer();
    return { body, contentType: type };
  } catch {
    throw new DocumentRejectedError(DOCUMENT_REJECT_MESSAGES.unreadable);
  }
}
