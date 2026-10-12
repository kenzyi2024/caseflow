import { extractText, getDocumentProxy } from "unpdf";

/**
 * The PDF's text layer, used only to check the model's evidence quotes.
 * Returns null for scans/images or unreadable files: evidence then can't be verified, and intake says so.
 */
export async function extractPdfText(pdf: Uint8Array): Promise<string | null> {
  try {
    const doc = await getDocumentProxy(new Uint8Array(pdf)); // copy: pdf.js may detach the buffer it's given
    const { text } = await extractText(doc, { mergePages: true });
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}
