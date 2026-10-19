// ── Hands-free voice message delivery ────────────────────────────────────────
// Opens (or reuses) the recipient's one-to-one thread and posts through the
// normal Team Chat message endpoint. A person gets a playable voice message.
// Lexi gets the spoken transcript as text, because the server only answers
// text and an audio post would never get a reply.
//
// Kept out of the component so "did it land in the right thread?" is testable.

export const VOICE_ATTACHMENT_NAME = "Voice message";
export const LEXI_VOICE_EMAIL = "lexi@system";
export const LEXI_VOICE_CONTACT = { email: LEXI_VOICE_EMAIL, name: "Lexi" };

export function isLexiVoiceRecipient(recipient) {
  return String(recipient?.email || "").trim().toLowerCase() === LEXI_VOICE_EMAIL;
}

// Lexi is always a hands-free recipient. An owner with no other staff used to
// get an empty roster and the "no teammates" dialog.
export function voiceRecipients(contacts) {
  const people = [];
  const seen = new Set([LEXI_VOICE_EMAIL]);
  for (const contact of Array.isArray(contacts) ? contacts : []) {
    const email = String(contact?.email || "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    people.push(contact);
  }
  return [LEXI_VOICE_CONTACT, ...people];
}

export function soleVoiceRecipient(roster) {
  const list = (Array.isArray(roster) ? roster : []).filter((contact) => contact?.email);
  return list.length === 1 ? list[0] : null;
}

export function lexiTranscriptText(clip) {
  return String(clip?.transcript || "").replace(/\s+/g, " ").trim().slice(0, 4000);
}

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

  const forLexi = isLexiVoiceRecipient(recipient);
  const transcript = forLexi ? lexiTranscriptText(clip) : "";
  if (forLexi && !transcript) {
    throw new Error("I couldn't transcribe that for Lexi, so nothing was sent.");
  }
  if (!forLexi && !clip?.file) throw new Error("There was no recording to send");

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

  // Audio posts never reach Lexi (the server only answers text). Her hands-free
  // message is the transcript, which the existing text turn replies to.
  if (forLexi) {
    await request("/api/chat/messages", {
      company_id: companyId,
      conversation_id: conversationId,
      message: transcript,
      message_type: "text",
    });
    return { conversationId, url: null, transcript };
  }

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
