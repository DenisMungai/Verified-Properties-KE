import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cleanDocument, DocumentRejectedError } from "./documents";
import { documentFits } from "./lister";
import { sniffDocumentType } from "./sniff";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1");

async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 30, channels: 3, background: "#14833B" } })
    .jpeg()
    .withExif({ IFD0: { Copyright: "secret-owner" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "1/1 17/1 0/1" } })
    .toBuffer();
}

describe("sniffDocumentType", () => {
  it("reads the real type from the first bytes", async () => {
    expect(sniffDocumentType(PDF)).toBe("application/pdf");
    expect(sniffDocumentType(await jpegWithGps())).toBe("image/jpeg");
    expect(sniffDocumentType(await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).png().toBuffer())).toBe("image/png");
  });
  it("refuses anything else, whatever it is called", () => {
    expect(sniffDocumentType(Buffer.from("just text pretending to be a pdf"))).toBeNull();
    expect(sniffDocumentType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffDocumentType(Buffer.alloc(0))).toBeNull();
  });
});

describe("cleanDocument (S12 decision 1)", () => {
  it("keeps a complete PDF as uploaded", async () => {
    const clean = await cleanDocument(PDF);
    expect(clean.contentType).toBe("application/pdf");
    expect(clean.body.equals(PDF)).toBe(true);
  });

  it("refuses a truncated PDF", async () => {
    await expect(cleanDocument(Buffer.from("%PDF-1.4\n1 0 obj", "latin1"))).rejects.toBeInstanceOf(DocumentRejectedError);
  });

  it("re-encodes images and drops EXIF and GPS data", async () => {
    const raw = await jpegWithGps();
    expect((await sharp(raw).metadata()).exif).toBeDefined();
    const clean = await cleanDocument(raw);
    expect(clean.contentType).toBe("image/jpeg");
    const meta = await sharp(clean.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(clean.body.includes(Buffer.from("secret-owner"))).toBe(false);
  });

  it("refuses text renamed to .pdf and empty files", async () => {
    await expect(cleanDocument(Buffer.from("hello"))).rejects.toThrow("Upload a PDF, JPEG or PNG file.");
    await expect(cleanDocument(Buffer.alloc(0))).rejects.toThrow("That file is empty.");
  });

  it("refuses a corrupt image", async () => {
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
    await expect(cleanDocument(corrupt)).rejects.toBeInstanceOf(DocumentRejectedError);
  });
});

describe("documentFits", () => {
  const docs = (types: string[]) => types.map((documentType) => ({ documentType }));
  it("allows 2 files per type and 6 in all", () => {
    expect(documentFits(docs(["national_id"]), "national_id")).toBe("ok");
    expect(documentFits(docs(["national_id", "national_id"]), "national_id")).toBe("per_type");
    expect(documentFits(docs(["a", "b", "c", "d", "e", "f"]), "national_id")).toBe("total");
  });
});
