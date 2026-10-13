// ── Hands-free voice message delivery ────────────────────────────────────────
// Opens (or reuses) the recipient's one-to-one thread, uploads the clip, and
// posts it through the normal Team Chat message endpoint so the recipient gets
// a standard playable voice message plus the existing email/SMS notice.
//
// Kept out of the component so "did it land in the right thread?" is testable.

export const VOICE_ATTACHMENT_NAME = "Voice message";

export async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || `Request failed (${res.status})`);
  return payload;
}

/**
 * @param {object}   args
 * @param {string}   args.companyId
 * @param {{email:string,name:string}} args.sender
 * @param {{email:string,name:string}} args.recipient
 * @param {{file:File,seconds:number}} args.clip
 * @param {(file:File)=>Promise<object>} args.uploadFile
 * @param {(url:string, body:object)=>Promise<object>} [args.request]
 * @returns {Promise<{conversationId:string, url:string}>}
 */
export async function deliverVoiceMessage({
  companyId,
  sender,
  recipient,
  clip,
  uploadFile,
  request = postJson,
}) {
  if (!companyId) throw new Error("I couldn't work out which company you're in");
  if (!sender?.email) throw new Error("I couldn't work out who you are");
  if (!recipient?.email) throw new Error("I couldn't work out who to send it to");
  if (!clip?.file) throw new Error("There was no recording to send");

  // The server dedupes direct threads by participant set, so this both creates
  // a new thread and reuses the existing one.
  const conversation = await request("/api/chat/conversations", {
    company_id: companyId,
    chat_type: "direct",
    participants: [
      { email: sender.email, name: sender.name || sender.email },
      { email: recipient.email, name: recipient.name || recipient.email },
    ],
  });
  const conversationId = conversation?.conversation?.id;
  if (!conversationId) throw new Error("I couldn't open that teammate's thread");

  const uploaded = await uploadFile(clip.file);
  const url = uploaded?.file_url || uploaded?.url;
  if (!url) throw new Error("The recording could not be uploaded");

  await request("/api/chat/messages", {
    company_id: companyId,
    conversation_id: conversationId,
    message: url,
    message_type: "audio",
    attachment_name: VOICE_ATTACHMENT_NAME,
  });

  return { conversationId, url };
}
