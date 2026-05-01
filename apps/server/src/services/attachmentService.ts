import fs from "node:fs/promises";
import path from "node:path";
import mime from "mime-types";
import { paths } from "../config/paths.js";
import type { AttachmentInput, PreparedAttachment } from "../types.js";

const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 36 * 1024 * 1024;

function safeName(name: string, index: number): string {
  const fallback = `attachment-${index + 1}`;
  const base = path.basename(name || fallback).replace(/[^\w .@()+-]/g, "_").trim();
  return base || fallback;
}

export async function prepareAttachments(taskId: string, attachments: AttachmentInput[] = []): Promise<PreparedAttachment[]> {
  if (!attachments.length) return [];
  if (attachments.length > 8) throw new Error("You can attach up to 8 files at a time");

  const taskDir = path.join(paths.uploads, taskId);
  await fs.mkdir(taskDir, { recursive: true });
  let total = 0;

  const prepared: PreparedAttachment[] = [];
  for (const [index, attachment] of attachments.entries()) {
    if (!attachment?.contentBase64) continue;
    const buffer = Buffer.from(attachment.contentBase64, "base64");
    total += buffer.byteLength;
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${attachment.name || "Attachment"} is larger than 12 MB`);
    }
    if (total > MAX_TOTAL_BYTES) {
      throw new Error("Attachments are larger than the 36 MB total limit");
    }

    const name = safeName(attachment.name, index);
    const filePath = path.join(taskDir, `${index + 1}-${name}`);
    await fs.writeFile(filePath, buffer);
    const detectedMime = attachment.mime || mime.lookup(name) || "application/octet-stream";
    prepared.push({
      name,
      path: filePath,
      mime: String(detectedMime),
      size: buffer.byteLength,
      image: String(detectedMime).startsWith("image/"),
    });
  }
  return prepared;
}

export function appendAttachmentContext(prompt: string, attachments: PreparedAttachment[]): string {
  if (!attachments.length) return prompt;
  const lines = attachments.map((attachment, index) => {
    const kind = attachment.image ? "image" : "file";
    return `${index + 1}. ${attachment.name} (${kind}, ${attachment.mime}, ${attachment.size} bytes): ${attachment.path}`;
  });
  return `${prompt.trim()}\n\nAttached files are saved on this Mac. Use these local paths when relevant:\n${lines.join("\n")}`;
}
