import fs from "fs";
import path from "path";
import { UPLOAD_DIR } from "./db";
import { AIContentPart } from "./ai";

export interface Attachment {
  name: string;
  kind: "pdf" | "docx" | "text" | "image";
  text?: string; // extracted text for documents
  imageId?: string; // stored file id for images
  mediaType?: string;
}

/** Convert a user message + attachments into AI content parts. */
export function buildContentParts(text: string, attachments: Attachment[] | undefined): AIContentPart[] {
  const parts: AIContentPart[] = [];
  if (attachments) {
    for (const att of attachments) {
      if (att.kind === "image" && att.imageId && att.mediaType) {
        const safe = att.imageId.replace(/[^0-9a-f-]/gi, "");
        const file = path.join(UPLOAD_DIR, safe);
        try {
          const data = fs.readFileSync(file);
          parts.push({ type: "image", mediaType: att.mediaType, dataBase64: data.toString("base64") });
        } catch {
          parts.push({ type: "text", text: `[The student attached an image "${att.name}" but it could not be loaded.]` });
        }
      } else if (att.text) {
        parts.push({
          type: "text",
          text: `The student attached a document "${att.name}". Its extracted text:\n\n---\n${att.text}\n---`,
        });
      }
    }
  }
  parts.push({ type: "text", text: text || "(The student sent an attachment without a message — review it and help them learn from it.)" });
  return parts;
}
