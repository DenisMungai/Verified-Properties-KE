import type { DocumentMime } from "./rules";

/**
 * The real type of a verification document from its first bytes (prompt S12 decision 1). The
 * declared Content-Type and the file name are ignored. Pure; no dependencies.
 */
export function sniffDocumentType(buf: Uint8Array): DocumentMime | null {
  if (buf.length >= 5 && String.fromCharCode(...buf.subarray(0, 5)) === "%PDF-") return "application/pdf";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= 8 && png.every((byte, i) => buf[i] === byte)) return "image/png";
  return null;
}
