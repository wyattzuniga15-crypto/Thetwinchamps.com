import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getUserId } from "@/lib/user";
import { UPLOAD_DIR, getDb, uid } from "@/lib/db";
import { ALLOWED_TYPES, MAX_UPLOAD_MB, extractText, resolveFileKind } from "@/lib/extract";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Validates and processes an uploaded study file.
 * Documents → text is extracted server-side and returned.
 * Images → stored on disk (never executed, never served raw) and referenced by id
 *          so the vision model can read them.
 */
export async function POST(req: NextRequest) {
  await getUserId(); // ensures identity + DB init
  getDb();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "Expected multipart form data with a 'file' field");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "No file provided");

  if (file.size === 0) return jsonError(400, "The file is empty");
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return jsonError(413, `File is too large. Maximum size is ${MAX_UPLOAD_MB} MB.`);
  }

  const resolved = resolveFileKind(file.name, file.type);
  if (!resolved) {
    return jsonError(
      415,
      `Unsupported file type. Supported: ${Object.keys(ALLOWED_TYPES)
        .map((t) => t.split("/")[1])
        .join(", ")} (PDF, DOCX, TXT, MD, CSV, PNG, JPG, WEBP, GIF).`
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    if (resolved.kind === "image") {
      // Basic magic-byte sanity check so renamed executables can't masquerade as images.
      const magicOk =
        (resolved.mediaType === "image/png" && buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) ||
        (resolved.mediaType === "image/jpeg" && buffer[0] === 0xff && buffer[1] === 0xd8) ||
        (resolved.mediaType === "image/gif" && buffer.subarray(0, 3).toString("ascii") === "GIF") ||
        (resolved.mediaType === "image/webp" && buffer.subarray(8, 12).toString("ascii") === "WEBP");
      if (!magicOk) return jsonError(415, "That file does not look like a valid image.");
      const imageId = uid();
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      fs.writeFileSync(path.join(UPLOAD_DIR, imageId), buffer);
      return NextResponse.json({
        attachment: { name: file.name.slice(0, 120), kind: "image", imageId, mediaType: resolved.mediaType },
      });
    }

    const text = await extractText(buffer, resolved.kind);
    if (!text.trim()) {
      return jsonError(422, "No readable text was found in that file. If it's a scanned document, try uploading it as an image instead.");
    }
    return NextResponse.json({
      attachment: { name: file.name.slice(0, 120), kind: resolved.kind, text },
    });
  } catch (err) {
    console.error("upload error:", err);
    return jsonError(422, "Could not read that file. It may be corrupted or password-protected.");
  }
}
