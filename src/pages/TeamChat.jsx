import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { usePageVisibility } from "@/hooks/usePageVisibility";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MessageSquare,
  Users,
  Megaphone,
  Plus,
  Send,
  CheckCircle2,
  Sparkles,
  Loader2,
  Bell,
  ArrowLeft,
  Search,
  X,
  Bot,
  Paperclip,
  ChevronDown,
  ChevronRight,
  Hash,
  MoreVertical,
  UserPlus,
  FileText,
  Download,
  Mic,
  Trash2,
  Headphones,
} from "lucide-react";
import HandsFreeVoiceMessage, { isHandsFreeSupported } from "@/components/chat/HandsFreeVoiceMessage";

const BOT_EMAIL = "companysync-bot@system";
// Lexi is a conversational teammate in the roster — a separate identity from
// the one-way alert bot above. Must match LEXI_EMAIL in lib/lexiTeamChat.cjs.
const LEXI_EMAIL = "lexi@system";
const LEXI_CONTACT = { email: LEXI_EMAIL, name: "Lexi" };

// ─── API ──────────────────────────────────────────────────────────────────────
const API = {
  async getConversations(companyId) {
    const res = await fetch(`/api/chat/conversations?company_id=${companyId}`);
    if (!res.ok) throw new Error("Failed to load conversations");
    return res.json();
  },
  async getMessages(convId, companyId) {
    const res = await fetch(`/api/chat/messages?conversation_id=${convId}&company_id=${companyId}&limit=100`);
    if (!res.ok) throw new Error("Failed to load messages");
    return res.json();
  },
  async sendMessage(data) {
    const res = await fetch("/api/chat/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!res.ok) throw new Error("Failed to send message");
    return res.json();
  },
  async createConversation(data) {
    const res = await fetch("/api/chat/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Error ${res.status}`); }
    return res.json();
  },
  async updateMembers(data) {
    const res = await fetch("/api/chat/conversations/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Error ${res.status}`); }
    return res.json();
  },
  async markRead(convId, companyId) {
    await fetch("/api/chat/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversation_id: convId, company_id: companyId }) });
  },
  async toggleReaction(messageId, emoji, companyId) {
    const res = await fetch("/api/chat/reactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message_id: messageId, emoji, company_id: companyId }) });
    if (!res.ok) throw new Error("Reaction failed");
    return res.json();
  },
  async invokeLLM(prompt, companyId) {
    const res = await fetch("/api/integrations/invoke-llm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, companyId }) });
    if (!res.ok) throw new Error("AI failed");
    return res.json();
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts), now = new Date();
  const today = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function fmtDateLabel(ts) {
  const d = new Date(ts), now = new Date(), yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
function avColor(name) {
  const p = ["bg-blue-500","bg-purple-500","bg-emerald-600","bg-orange-500","bg-pink-500","bg-teal-500","bg-indigo-500"];
  return p[(name||"?").charCodeAt(0) % p.length];
}
// Render **bold** segments in bot alerts
function renderBold(text) {
  const parts = String(text || "").split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : p));
}
function isSpaceLike(c) { return c.chat_type === "space" || c.chat_type === "group" || c.chat_type === "broadcast"; }

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Av({ name, src, size = "md" }) {
  const [err, setErr] = useState(false);
  const ini = (name||"?").split(" ").map(n=>n[0]).join("").toUpperCase().slice(0,2);
  const sz = size==="sm"?"w-7 h-7 text-xs":size==="lg"?"w-10 h-10 text-sm":"w-8 h-8 text-xs";
  if (src && !err) return <img src={src} alt={name} className={`${sz} rounded-full object-cover flex-shrink-0 border border-slate-200`} onError={()=>setErr(true)} />;
  return <div className={`${sz} ${avColor(name)} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0 select-none`}>{ini}</div>;
}

// Space avatar — custom image, or icon fallback per type
function SpaceAv({ conv, size = "md" }) {
  const [err, setErr] = useState(false);
  const sz = size==="lg"?"w-10 h-10":"w-9 h-9";
  const ic = size==="lg"?"w-5 h-5":"w-4 h-4";
  if (conv.avatar_url && !err) return <img src={conv.avatar_url} alt={conv.name||"Space"} className={`${sz} rounded-full object-cover flex-shrink-0 border border-slate-200`} onError={()=>setErr(true)} />;
  if (String(conv.id||"").startsWith("conv_alerts_")) return <div className={`${sz} bg-indigo-600 rounded-full flex items-center justify-center flex-shrink-0`}><Bot className={`${ic} text-white`}/></div>;
  if (conv.chat_type==="broadcast") return <div className={`${sz} bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0`}><Megaphone className={`${ic} text-orange-600`}/></div>;
  return <div className={`${sz} bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0`}><Hash className={`${ic} text-purple-600`}/></div>;
}

// ─── Date divider ─────────────────────────────────────────────────────────────
function DateDivider({ label }) {
  return (
    <div className="flex items-center gap-3 my-5">
      <div className="flex-1 h-px bg-slate-200" />
      <span className="text-xs text-slate-400 font-medium whitespace-nowrap px-1">{label}</span>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );
}

// ─── Emoji quick reactions ─────────────────────────────────────────────────────
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "🎉", "👏"];

// ─── Message bubble ───────────────────────────────────────────────────────────
function Bubble({ msg, isMine, avSrc, showHeader, isLast, onReact, userEmail }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const isDone  = msg.message_type === "task_done";
  const isImg   = msg.message_type === "image";
  const isFile  = msg.message_type === "file";
  const isAudio = msg.message_type === "audio";
  const isBot   = msg.sender_email === BOT_EMAIL;
  const isLexi  = msg.sender_email === LEXI_EMAIL;
  const reactions = msg.reactions || {};
  const hasReactions = Object.keys(reactions).some(e => (reactions[e]||[]).length > 0);

  function ReactionBar() {
    if (!hasReactions && !pickerOpen) return null;
    return (
      <div className={`flex flex-wrap gap-1 mt-1 ${isMine ? "justify-end" : ""}`}>
        {Object.entries(reactions).filter(([,u])=>u.length>0).map(([emoji, users]) => (
          <button key={emoji} onClick={()=>onReact(msg.id, emoji)} data-testid={`reaction-${msg.id}-${emoji}`}
            className={`flex items-center gap-0.5 text-[13px] px-2 py-0.5 rounded-full border transition-colors ${users.includes(userEmail)?"bg-blue-50 border-blue-300 text-blue-700 font-medium":"bg-white border-slate-200 text-slate-600 hover:border-blue-200 hover:bg-blue-50"}`}>
            {emoji}<span className="text-[11px] ml-0.5">{users.length}</span>
          </button>
        ))}
      </div>
    );
  }

  function EmojiPickerPopup() {
    if (!pickerOpen) return null;
    return (
      <div className={`flex gap-0.5 p-1 bg-white rounded-2xl shadow-lg border border-slate-200 mt-1 ${isMine?"self-end":""}`}
        data-testid={`emoji-picker-${msg.id}`}>
        {QUICK_EMOJIS.map(e => (
          <button key={e} onClick={()=>{ onReact(msg.id, e); setPickerOpen(false); }}
            className={`text-base w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-slate-100 ${(reactions[e]||[]).includes(userEmail)?"bg-blue-50 ring-1 ring-blue-300":""}`}>
            {e}
          </button>
        ))}
      </div>
    );
  }

  if (isLexi) return (
    <div className={`flex gap-2 ${showHeader?"mt-3":"mt-0.5"} group`} data-testid={`bubble-lexi-${msg.id}`}>
      <div className="w-8 flex-shrink-0">
        {showHeader && <div className="w-8 h-8 bg-violet-600 rounded-full flex items-center justify-center flex-shrink-0"><Sparkles className="w-4 h-4 text-white"/></div>}
      </div>
      <div className="max-w-[80%]">
        {showHeader && (
          <div className="flex items-center gap-1.5 mb-1 px-1">
            <span className="text-xs font-semibold text-slate-700">Lexi</span>
            <span className="text-[9px] font-bold bg-violet-100 text-violet-600 px-1.5 py-px rounded uppercase tracking-wide">Assistant</span>
          </div>
        )}
        <div className="rounded-2xl rounded-tl-none px-4 py-3 bg-violet-50 border border-violet-100 text-sm text-slate-800 leading-relaxed shadow-sm break-words whitespace-pre-wrap">
          {renderBold(msg.message)}
        </div>
        {isLast && <div className="text-xs text-slate-400 px-1 mt-1">{fmtTime(msg.created_at)}</div>}
      </div>
    </div>
  );

  if (isBot) return (
    <div className={`flex gap-2 ${showHeader?"mt-3":"mt-0.5"} group`} data-testid={`bubble-bot-${msg.id}`}>
      <div className="w-8 flex-shrink-0">
        {showHeader && <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center flex-shrink-0"><Bot className="w-4 h-4 text-white"/></div>}
      </div>
      <div className="max-w-[80%]">
        {showHeader && (
          <div className="flex items-center gap-1.5 mb-1 px-1">
            <span className="text-xs font-semibold text-slate-700">CompanySync Bot</span>
            <span className="text-[9px] font-bold bg-indigo-100 text-indigo-600 px-1.5 py-px rounded uppercase tracking-wide">Bot</span>
          </div>
        )}
        <div className="rounded-2xl rounded-tl-none px-4 py-3 bg-indigo-50 border border-indigo-100 text-sm text-slate-800 leading-relaxed shadow-sm break-words whitespace-pre-wrap">
          {renderBold(msg.message)}
        </div>
        {isLast && <div className="text-xs text-slate-400 px-1 mt-1">{fmtTime(msg.created_at)}</div>}
      </div>
    </div>
  );

  if (isDone) return (
    <div className={`flex gap-2 ${showHeader?"mt-3":"mt-0.5"} group`}>
      {!isMine && <div className="w-8 flex-shrink-0">{showHeader && <Av name={msg.sender_name} src={avSrc} />}</div>}
      <div className={`max-w-[75%] ${isMine?"ml-auto":""}`}>
        {showHeader && !isMine && <div className="text-xs font-semibold text-slate-600 mb-1 px-1">{msg.sender_name||msg.sender_email}</div>}
        <div className="rounded-2xl px-4 py-3 bg-emerald-50 border border-emerald-200 shadow-sm">
          <div className="flex items-center gap-1.5 text-emerald-700 font-semibold text-sm mb-1"><CheckCircle2 className="w-4 h-4"/>Task Marked Done</div>
          {msg.task_title && <div className="text-sm font-medium text-emerald-800">{msg.task_title}</div>}
          <div className="text-xs text-emerald-600 mt-0.5">{msg.message}</div>
        </div>
        {isLast && <div className={`text-xs text-slate-400 px-1 mt-1 ${isMine?"text-right":""}`}>{fmtTime(msg.created_at)}</div>}
      </div>
    </div>
  );

  return (
    <div className={`flex gap-2 ${isMine?"flex-row-reverse":""} ${showHeader?"mt-3":"mt-0.5"} group`}>
      {!isMine && <div className="w-8 flex-shrink-0 self-end">{showHeader && <Av name={msg.sender_name} src={avSrc} />}</div>}
      <div className={`max-w-[72%] flex flex-col ${isMine?"items-end":"items-start"}`}>
        {showHeader && !isMine && <div className="text-xs font-semibold text-slate-600 mb-1 px-1">{msg.sender_name||msg.sender_email}</div>}
        <div className="relative">
          {isImg
            ? <a href={msg.message} target="_blank" rel="noopener noreferrer"><img src={msg.message} alt={msg.attachment_name||"shared"} className="max-w-[220px] rounded-2xl shadow-sm border border-slate-200 object-cover" style={{maxHeight:220}}/></a>
            : isAudio
            ? <div className={`flex items-center gap-2 rounded-2xl px-3 py-2 shadow-sm border ${isMine?"bg-blue-600 border-blue-600":"bg-white border-slate-200"}`} data-testid={`audio-message-${msg.id}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isMine?"bg-blue-500":"bg-blue-50"}`}>
                  <Mic className={`w-4 h-4 ${isMine?"text-white":"text-blue-600"}`}/>
                </div>
                <audio controls src={msg.message} preload="metadata" className="h-9" style={{width:210,maxWidth:"58vw"}}/>
              </div>
            : isFile
            ? <a href={msg.message} target="_blank" rel="noopener noreferrer" data-testid={`file-attachment-${msg.id}`}
                className={`flex items-center gap-2.5 rounded-2xl px-4 py-3 shadow-sm border max-w-[260px] transition-colors ${isMine?"bg-blue-600 border-blue-600 text-white hover:bg-blue-700":"bg-white border-slate-200 text-slate-800 hover:bg-slate-50"}`}>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isMine?"bg-blue-500":"bg-blue-50"}`}>
                  <FileText className={`w-4 h-4 ${isMine?"text-white":"text-blue-600"}`}/>
                </div>
                <span className="text-sm font-medium truncate flex-1">{msg.attachment_name||"Attachment"}</span>
                <Download className={`w-4 h-4 flex-shrink-0 ${isMine?"text-blue-200":"text-slate-400"}`}/>
              </a>
            : <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm break-words whitespace-pre-wrap ${isMine?"bg-blue-600 text-white rounded-tr-none":"bg-white border border-slate-200 text-slate-800 rounded-tl-none"}`}>{msg.message}</div>
          }
          {/* Emoji trigger — visible on hover (desktop) or always on mobile */}
          <button
            onClick={()=>setPickerOpen(p=>!p)}
            data-testid={`button-react-${msg.id}`}
            className={`absolute ${isMine?"-left-7":"-right-7"} bottom-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity w-6 h-6 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-[12px] hover:bg-slate-50`}
            title="Add reaction"
          >😊</button>
        </div>
        <EmojiPickerPopup/>
        <ReactionBar/>
        {isLast && <span className={`text-xs text-slate-400 px-1 mt-1 ${isMine?"text-right":""}`}>{fmtTime(msg.created_at)}</span>}
      </div>
    </div>
  );
}

// ─── Sidebar section header (collapsible) ─────────────────────────────────────
function SectionHeader({ label, open, onToggle, unread, action }) {
  return (
    <div className="flex items-center justify-between pr-1">
      <button onClick={onToggle} data-testid={`section-toggle-${label.toLowerCase().replace(/\s+/g,"-")}`}
        className="flex items-center gap-1 px-2 py-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-700 transition-colors select-none">
        {open ? <ChevronDown className="w-3.5 h-3.5"/> : <ChevronRight className="w-3.5 h-3.5"/>}
        {label}
        {!open && unread>0 && <span className="ml-1 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-px rounded-full">{unread>9?"9+":unread}</span>}
      </button>
      {action}
    </div>
  );
}

// ─── DM roster item ───────────────────────────────────────────────────────────
function DmItem({ contact, conv, isActive, avMap, opening, onClick }) {
  const unread = conv?.unread_count || 0;
  const isLexi = contact.email === LEXI_EMAIL;
  return (
    <button data-testid={`dm-item-${contact.email}`} onClick={onClick} disabled={opening}
      className={`w-full text-left px-3 py-2 rounded-xl mb-0.5 flex items-center gap-2.5 transition-colors border ${isActive?"bg-blue-50 border-blue-100":"border-transparent hover:bg-slate-50"}`}>
      <div className="relative flex-shrink-0">
        {isLexi
          ? <div className="w-8 h-8 bg-violet-600 rounded-full flex items-center justify-center flex-shrink-0"><Sparkles className="w-4 h-4 text-white"/></div>
          : <Av name={contact.name} src={avMap[contact.email]} size="md"/>}
        {unread>0 && <span className="absolute -top-0.5 -right-0.5 bg-blue-600 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">{unread>9?"9+":unread}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span className={`text-sm truncate ${unread>0?"font-semibold text-slate-900":"font-medium text-slate-700"}`}>{contact.name}</span>
          {conv?.last_message_at && <span className="text-[11px] text-slate-400 flex-shrink-0">{fmtTime(conv.last_message_at)}</span>}
        </div>
        {conv?.last_message
          ? <p className={`text-xs truncate mt-0.5 ${unread>0?"text-slate-600 font-medium":"text-slate-400"}`}>{conv.last_message}</p>
          : opening ? <p className="text-xs text-slate-400 mt-0.5">Opening…</p>
          : isLexi ? <p className="text-xs text-violet-400 mt-0.5 truncate">Ask me to create a task, book a job, look someone up…</p>
          : null}
      </div>
    </button>
  );
}

// ─── Space list item ──────────────────────────────────────────────────────────
function SpaceItem({ conv, isActive, onClick }) {
  const unread = conv.unread_count || 0;
  const name = conv.name || (conv.chat_type==="broadcast"?"Broadcast":"Space");
  return (
    <button data-testid={`space-item-${conv.id}`} onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-xl mb-0.5 flex items-center gap-2.5 transition-colors border ${isActive?"bg-blue-50 border-blue-100":"border-transparent hover:bg-slate-50"}`}>
      <div className="relative flex-shrink-0">
        <SpaceAv conv={conv}/>
        {unread>0 && <span className="absolute -top-0.5 -right-0.5 bg-blue-600 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">{unread>9?"9+":unread}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span className={`text-sm truncate ${unread>0?"font-semibold text-slate-900":"font-medium text-slate-700"}`}>{name}</span>
          {(conv.last_message_at||conv.created_at) && <span className="text-[11px] text-slate-400 flex-shrink-0">{fmtTime(conv.last_message_at||conv.created_at)}</span>}
        </div>
        {conv.last_message && <p className={`text-xs truncate mt-0.5 ${unread>0?"text-slate-600 font-medium":"text-slate-400"}`}>{conv.last_message}</p>}
      </div>
    </button>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function TeamChat() {
  const { toast } = useToast();
  const { user, myCompany, staffProfiles } = useRoleBasedData();
  const qc = useQueryClient();
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const fileRef   = useRef(null);
  const isVisible = usePageVisibility();

  const [selectedId,     setSelectedId]     = useState(null);
  const [dmsOpen,        setDmsOpen]        = useState(true);
  const [spacesOpen,     setSpacesOpen]     = useState(true);
  const [sideSearch,     setSideSearch]     = useState("");
  const [draft,          setDraft]          = useState("");
  const [showNew,        setShowNew]        = useState(false);
  const [newType,        setNewType]        = useState("space");
  const [newName,        setNewName]        = useState("");
  const [newAvatar,      setNewAvatar]      = useState("");
  const [newParts,       setNewParts]       = useState([]);
  const [ctSearch,       setCtSearch]       = useState("");
  const [showTaskDone,   setShowTaskDone]   = useState(false);
  const [selTask,        setSelTask]        = useState("");
  const [taskNote,       setTaskNote]       = useState("");
  const [summarizing,    setSummarizing]    = useState(false);
  const [summary,        setSummary]        = useState(null);
  const [summaryOpen,    setSummaryOpen]    = useState(false);
  const [creating,       setCreating]       = useState(false);
  const [markingDone,    setMarkingDone]    = useState(false);
  const [uploading,      setUploading]      = useState(false);
  const [recording,      setRecording]      = useState(false);
  const [recSecs,        setRecSecs]        = useState(0);
  const recRef = useRef(null);
  const [openingDm,      setOpeningDm]      = useState(null);
  const [showMembers,    setShowMembers]    = useState(false);
  const [membersDraft,   setMembersDraft]   = useState([]);
  const [memberSearch,   setMemberSearch]   = useState("");
  const [savingMembers,  setSavingMembers]  = useState(false);
  const [handsFreeOpen,  setHandsFreeOpen]  = useState(false);

  const companyId = myCompany?.id;
  const userEmail = user?.email;
  const userName  = user?.full_name || user?.email || "Me";

  // Contacts — built from staffProfiles (all staff in the company)
  const allContacts = useMemo(() => {
    const seen = new Set(), list = [];
    (staffProfiles||[]).forEach(s => {
      if (!s.user_email || seen.has(s.user_email)) return;
      seen.add(s.user_email);
      list.push({ email: s.user_email, name: s.full_name || s.user_email });
    });
    return list;
  }, [staffProfiles]);
  const otherContacts = useMemo(()=>allContacts.filter(c=>c.email!==userEmail),[allContacts,userEmail]);
  const avMap = useMemo(()=>{ const m={}; (staffProfiles||[]).filter(s=>s.avatar_url).forEach(s=>{m[s.user_email]=s.avatar_url;}); return m; },[staffProfiles]);

  // My open tasks
  const {data:myTasksData} = useQuery({
    queryKey:["my-open-tasks",companyId,userEmail], enabled:!!companyId&&!!userEmail, staleTime:60_000,
    queryFn: async()=>{
      const res=await base44.entities.Tasks.filter({company_id:companyId,status:{$ne:"done"}});
      return (res||[]).filter(t=>t.assignees?.some(a=>a.email===userEmail)||t.assigned_to===userEmail||t.created_by===userEmail);
    },
  });
  const myOpenTasks = myTasksData || [];

  // Conversations
  const {data:convsData, isLoading:convsLoading} = useQuery({
    queryKey:["chat-conversations",companyId,userEmail], enabled:!!companyId&&!!userEmail,
    queryFn:()=>API.getConversations(companyId),
    // Conversation metadata does not need sub-10-second polling. Messages and
    // mutations still refresh immediately, while the visible fallback poll keeps
    // unread counts current without multiplying API traffic for every open tab.
    refetchInterval: isVisible?30_000:false, staleTime:20_000,
    refetchIntervalInBackground:false,
  });
  const conversations = convsData?.conversations || [];

  // DM roster: map other-participant email → conversation
  const dmByEmail = useMemo(()=>{
    const m={};
    conversations.filter(c=>c.chat_type==="direct").forEach(c=>{
      const o=(c.participants||[]).find(p=>p.email&&p.email!==userEmail);
      if (o?.email) m[o.email.toLowerCase()]=c;
    });
    return m;
  },[conversations,userEmail]);

  // Roster = every team member (whether or not a DM exists yet) + any existing
  // DM partners not in the current staff roster (e.g. removed staff, subs)
  const dmRoster = useMemo(()=>{
    const roster = otherContacts.map(c=>({ contact:c, conv:dmByEmail[c.email.toLowerCase()]||null }));
    const rosterEmails = new Set(otherContacts.map(c=>c.email.toLowerCase()));
    rosterEmails.add(LEXI_EMAIL); // Lexi is pinned separately below
    Object.entries(dmByEmail).forEach(([email,conv])=>{
      if (!rosterEmails.has(email)) {
        const o=(conv.participants||[]).find(p=>p.email&&p.email!==userEmail);
        roster.push({ contact:{ email:o?.email||email, name:o?.name||o?.email||email }, conv });
      }
    });
    // Sort: unread first, then most recent, then alphabetical
    roster.sort((a,b)=>{
      const ua=a.conv?.unread_count||0, ub=b.conv?.unread_count||0;
      if ((ua>0)!==(ub>0)) return ub>0?1:-1;
      const ta=a.conv?.last_message_at?new Date(a.conv.last_message_at).getTime():0;
      const tb=b.conv?.last_message_at?new Date(b.conv.last_message_at).getTime():0;
      if (ta!==tb) return tb-ta;
      return (a.contact.name||"").localeCompare(b.contact.name||"");
    });
    // Lexi always sits at the top of Direct messages — she is reachable in one
    // tap from the same place you talk to the team.
    return [{ contact: LEXI_CONTACT, conv: dmByEmail[LEXI_EMAIL] || null }, ...roster];
  },[otherContacts,dmByEmail,userEmail]);

  // Teammates the hands-free flow can address (people only — never Lexi,
  // never a Space).
  const voiceRoster = useMemo(
    ()=>dmRoster.map(r=>r.contact).filter(c=>c.email!==LEXI_EMAIL),
    [dmRoster]
  );

  const spaces = useMemo(()=>{
    const list = conversations.filter(isSpaceLike);
    list.sort((a,b)=>{
      const ta=a.last_message_at?new Date(a.last_message_at).getTime():0;
      const tb=b.last_message_at?new Date(b.last_message_at).getTime():0;
      return tb-ta;
    });
    return list;
  },[conversations]);

  // Search filter
  const q = sideSearch.trim().toLowerCase();
  const filteredRoster = useMemo(()=> q
    ? dmRoster.filter(r=>r.contact.name.toLowerCase().includes(q)||r.contact.email.toLowerCase().includes(q)||(r.conv?.last_message||"").toLowerCase().includes(q))
    : dmRoster
  ,[dmRoster,q]);
  const filteredSpaces = useMemo(()=> q
    ? spaces.filter(c=>(c.name||"").toLowerCase().includes(q)||(c.last_message||"").toLowerCase().includes(q))
    : spaces
  ,[spaces,q]);

  const dmUnread     = dmRoster.reduce((s,r)=>s+(r.conv?.unread_count||0),0);
  const spacesUnread = spaces.reduce((s,c)=>s+(c.unread_count||0),0);
  const totalUnread  = dmUnread + spacesUnread;

  const selConv = conversations.find(c=>c.id===selectedId)||null;

  // Messages
  const {data:msgsData, isLoading:msgsLoading} = useQuery({
    queryKey:["chat-messages",selectedId,companyId], enabled:!!selectedId&&!!companyId,
    queryFn:()=>API.getMessages(selectedId,companyId),
    refetchInterval:isVisible&&selectedId?15_000:false, staleTime:10_000,
    refetchIntervalInBackground:false,
  });
  const messages = msgsData?.messages || [];

  // Derived conv info
  const convName = useMemo(()=>{
    if (!selConv) return "";
    if (selConv.chat_type==="direct") {
      const o=(selConv.participants||[]).find(p=>p.email!==userEmail);
      return o?.name||o?.email||"Direct";
    }
    return selConv.name||(selConv.chat_type==="broadcast"?"Broadcast":"Space");
  },[selConv,userEmail]);

  const convSub = useMemo(()=>{
    if (!selConv) return "";
    if (selConv.chat_type==="direct") {
      const other=(selConv.participants||[]).find(p=>p.email!==userEmail);
      if (other?.email===LEXI_EMAIL) return "Your assistant · replies right here";
      return "Direct message";
    }
    if (selConv.chat_type==="broadcast") return `Space · everyone (${allContacts.length})`;
    const cnt=(selConv.participants||[]).length;
    return `Space · ${cnt} member${cnt!==1?"s":""}`;
  },[selConv,allContacts]);

  const otherPartEmail = selConv?.chat_type==="direct"
    ? (selConv.participants||[]).find(p=>p.email!==userEmail)?.email : null;
  const isLexiThread = otherPartEmail === LEXI_EMAIL;

  const canManageMembers = selConv && isSpaceLike(selConv)
    && selConv.chat_type!=="broadcast"
    && !String(selConv.id||"").startsWith("conv_alerts_");

  // Message sections with date dividers & grouping
  const sections = useMemo(()=>{
    const out=[];
    let lastDate=null, lastSender=null, lastTime=null;
    messages.forEach((msg,idx)=>{
      const dt=new Date(msg.created_at), ds=dt.toDateString();
      if (ds!==lastDate) { out.push({kind:"divider",label:fmtDateLabel(msg.created_at),key:`d${idx}`}); lastDate=ds; lastSender=null; lastTime=null; }
      const gap=lastTime?(dt-lastTime):Infinity;
      const grouped=lastSender===msg.sender_email&&gap<5*60*1000;
      const next=messages[idx+1];
      const nextGrouped=next&&next.sender_email===msg.sender_email&&(new Date(next.created_at)-dt)<5*60*1000;
      out.push({kind:"msg",msg,showHeader:!grouped,isLast:!nextGrouped,key:msg.id});
      lastSender=msg.sender_email; lastTime=dt;
    });
    return out;
  },[messages]);

  // Auto-scroll
  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[messages.length,selectedId]);

  // Deep links: ?handsfree=1 opens the hands-free flow, ?lexi=1 opens her thread
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(()=>{
    if (!companyId || !userEmail) return;
    const params = new URLSearchParams(location.search||"");
    const handsfree = params.get("handsfree")==="1";
    const lexi = params.get("lexi")==="1";
    if (!handsfree && !lexi) return;
    // Consume the param so a refresh doesn't relaunch the flow and a second
    // tap on the same shortcut does.
    navigate(location.pathname, { replace: true });
    if (handsfree) setHandsFreeOpen(true);
    else openDm(LEXI_CONTACT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[location.search,companyId,userEmail]);

  // Select conv
  function selectConv(id) {
    setSelectedId(id); setSummary(null); setSummaryOpen(false);
    if (companyId) API.markRead(id,companyId).catch(()=>{});
    setTimeout(()=>inputRef.current?.focus(),150);
  }

  // Open (or create) a DM with a team member
  async function openDm(contact) {
    const existing = dmByEmail[contact.email.toLowerCase()];
    if (existing) return selectConv(existing.id);
    if (!companyId||!userEmail) return;
    setOpeningDm(contact.email);
    try {
      const me = allContacts.find(c=>c.email===userEmail);
      const data = await API.createConversation({
        company_id: companyId, chat_type: "direct",
        participants: [{email:userEmail,name:me?.name||userName},{email:contact.email,name:contact.name}],
      });
      qc.invalidateQueries({queryKey:["chat-conversations",companyId,userEmail]});
      if (data.conversation?.id) selectConv(data.conversation.id);
    } catch(e){toast({title:"Could not open chat",description:e.message,variant:"destructive"});}
    finally{setOpeningDm(null);}
  }

  // Send mutation
  const sendMut = useMutation({
    mutationFn:API.sendMessage,
    onSuccess:()=>{ qc.invalidateQueries({queryKey:["chat-messages",selectedId,companyId]}); qc.invalidateQueries({queryKey:["chat-conversations",companyId,userEmail]}); },
    onError:e=>toast({title:"Send failed",description:e.message,variant:"destructive"}),
  });

  // Reaction toggle — optimistic update then refresh
  async function handleReact(messageId, emoji) {
    if (!companyId) return;
    try {
      await API.toggleReaction(messageId, emoji, companyId);
      qc.invalidateQueries({queryKey:["chat-messages",selectedId,companyId]});
    } catch(e){toast({title:"Reaction failed",description:e.message,variant:"destructive"});}
  }

  // Quick reply chips — shown when last message is from someone else
  const lastMsg = messages[messages.length - 1];
  const showQuickReplies = lastMsg && lastMsg.sender_email !== userEmail && lastMsg.message_type === "text";
  // Lexi answers server-side; until her reply lands the thread looks stalled.
  const lexiThinking = isLexiThread && !!lastMsg && lastMsg.sender_email === userEmail && lastMsg.message_type === "text";
  const QUICK_REPLIES = ["Thanks", "Got it", "Sounds good", "On it!", "Approved", "Thanks for the update"];

  function handleSend() {
    const text=draft.trim();
    if (!text||!selectedId||!companyId) return;
    setDraft("");
    sendMut.mutate({company_id:companyId,conversation_id:selectedId,message:text,message_type:"text"});
  }
  function onKey(e) { if (e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleSend();} }

  // File / image upload (paperclip)
  async function uploadAttachment(e) {
    const file=e.target.files?.[0]; if (!file||!selectedId||!companyId) return;
    e.target.value="";
    if (file.size > 20*1024*1024) { toast({title:"File too large",description:"Attachments are limited to 20 MB.",variant:"destructive"}); return; }
    setUploading(true);
    try {
      const r=await base44.integrations.Core.UploadFile({ file });
      const url=r?.file_url||r?.url; if (!url) throw new Error("No URL");
      const isImage = (file.type||"").startsWith("image/");
      sendMut.mutate({
        company_id:companyId, conversation_id:selectedId, message:url,
        message_type: isImage ? "image" : "file",
        attachment_name: file.name,
      });
    } catch(err){toast({title:"Upload failed",description:err.message,variant:"destructive"});}
    finally{setUploading(false);}
  }

  // Voice message recording (mic)
  const fmtRec = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  const recStartingRef = useRef(false);
  async function startRecording() {
    if (recStartingRef.current || recRef.current || recording || !selectedId || !companyId) return;
    recStartingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus","audio/webm","audio/mp4"].find(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported(t))||"";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      mr.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t=>t.stop());
        if (recRef.current) clearInterval(recRef.current.timer);
        const send = recRef.current?.send;
        recRef.current = null;
        setRecording(false); setRecSecs(0);
        if (!send || chunks.length === 0) return;
        const type = mr.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : "webm";
        const file = new File(chunks, `voice-message-${Date.now()}.${ext}`, { type });
        setUploading(true);
        try {
          const r = await base44.integrations.Core.UploadFile({ file });
          const url = r?.file_url || r?.url; if (!url) throw new Error("No URL");
          sendMut.mutate({ company_id: companyId, conversation_id: selectedId, message: url, message_type: "audio", attachment_name: "Voice message" });
        } catch(err){ toast({ title: "Voice message failed", description: err.message, variant: "destructive" }); }
        finally { setUploading(false); }
      };
      recRef.current = {
        mr, stream, send: false,
        timer: setInterval(()=>setRecSecs(s=>{ if (s>=299){ stopRecording(true); } return s+1; }),1000),
      };
      mr.start();
      setRecSecs(0); setRecording(true);
    } catch {
      toast({ title: "Microphone unavailable", description: "Allow microphone access in your browser to record voice messages.", variant: "destructive" });
    } finally {
      recStartingRef.current = false;
    }
  }
  function stopRecording(send) {
    const rec = recRef.current; if (!rec) return;
    rec.send = send;
    try { rec.mr.stop(); } catch { /* already stopped */ }
  }
  useEffect(()=>{ // switching conversations cancels any in-progress recording
    stopRecording(false);
  },[selectedId]);
  useEffect(()=>()=>{ // cleanup on unmount: stop mic without sending
    const rec = recRef.current;
    if (rec) { try { rec.mr.stop(); } catch {} rec.stream.getTracks().forEach(t=>t.stop()); clearInterval(rec.timer); recRef.current = null; }
  },[]);

  // Task done
  async function handleTaskDone() {
    const task=myOpenTasks.find(t=>t.id===selTask); if (!task||!selectedId||!companyId) return;
    setMarkingDone(true);
    try {
      await base44.entities.Tasks.update(selTask,{status:"done"});
      sendMut.mutate({company_id:companyId,conversation_id:selectedId,message:taskNote.trim()||`Task completed: ${task.name||task.title}`,message_type:"task_done",task_id:selTask,task_title:task.name||task.title});
      setShowTaskDone(false); setSelTask(""); setTaskNote("");
    } catch(err){toast({title:"Failed",description:err.message,variant:"destructive"});}
    finally{setMarkingDone(false);}
  }

  // Lexi summarize
  async function handleSummarize() {
    if (!messages.length) return;
    setSummarizing(true); setSummary(null); setSummaryOpen(true);
    try {
      const recent=messages.slice(-20);
      const tx=recent.map(m=>`${m.sender_name||m.sender_email}: ${m.message}`).join("\n");
      const r=await API.invokeLLM(`Summarize this team chat in 3-5 bullet points (decisions, action items, outcomes):\n\n${tx}\n\nPlain text bullets only.`,companyId);
      setSummary(r?.response||r?.text||r?.content||"No summary available.");
    } catch{setSummary("Unable to summarize at this time.");}
    setSummarizing(false);
  }

  // Create space / broadcast
  async function handleCreate() {
    if (!companyId||!userEmail) return;
    setCreating(true);
    try {
      let parts=[];
      if (newType==="broadcast") { parts=allContacts.map(c=>({email:c.email,name:c.name})); }
      else {
        parts=newParts.map(e=>{ const c=allContacts.find(x=>x.email===e); return {email:e,name:c?.name||e}; });
        if (!parts.find(p=>p.email===userEmail)) { const me=allContacts.find(c=>c.email===userEmail); parts.push({email:userEmail,name:me?.name||userName}); }
      }
      const data = await API.createConversation({
        company_id:companyId, chat_type:newType,
        name:newName.trim()||(newType==="broadcast"?"Broadcast":"New space"),
        participants:parts,
        avatar_url:newAvatar.trim()||undefined,
      });
      qc.invalidateQueries({queryKey:["chat-conversations",companyId,userEmail]});
      setSelectedId(data.conversation?.id);
      setShowNew(false); setNewName(""); setNewAvatar(""); setNewParts([]); setNewType("space"); setCtSearch("");
    } catch(e){toast({title:"Could not create space",description:e.message,variant:"destructive"});}
    finally{setCreating(false);}
  }

  function togglePart(email) { setNewParts(p=>p.includes(email)?p.filter(e=>e!==email):[...p,email]); }
  const canCreate = newType==="broadcast" ? !!newName.trim()||true : (newParts.length>=1 && !!newName.trim());
  const filtCt=useMemo(()=>{
    if (!ctSearch.trim()) return otherContacts;
    const s=ctSearch.toLowerCase();
    return otherContacts.filter(c=>c.name.toLowerCase().includes(s)||c.email.toLowerCase().includes(s));
  },[otherContacts,ctSearch]);

  // Members dialog
  function openMembersDialog() {
    if (!selConv) return;
    setMembersDraft((selConv.participants||[]).map(p=>({email:p.email,name:p.name||p.email})));
    setMemberSearch("");
    setShowMembers(true);
  }
  function draftHas(email) { return membersDraft.some(m=>m.email.toLowerCase()===email.toLowerCase()); }
  function toggleDraftMember(c) {
    setMembersDraft(d=>draftHas(c.email)?d.filter(m=>m.email.toLowerCase()!==c.email.toLowerCase()):[...d,{email:c.email,name:c.name}]);
  }
  async function saveMembers() {
    if (!selConv||!companyId) return;
    const existing=(selConv.participants||[]).map(p=>(p.email||"").toLowerCase());
    const draftEmails=membersDraft.map(m=>m.email.toLowerCase());
    const add=membersDraft.filter(m=>!existing.includes(m.email.toLowerCase()));
    const remove=existing.filter(e=>!draftEmails.includes(e));
    if (add.length===0&&remove.length===0) { setShowMembers(false); return; }
    setSavingMembers(true);
    try {
      await API.updateMembers({company_id:companyId,conversation_id:selConv.id,add,remove});
      qc.invalidateQueries({queryKey:["chat-conversations",companyId,userEmail]});
      setShowMembers(false);
      toast({title:"Members updated"});
    } catch(e){toast({title:"Could not update members",description:e.message,variant:"destructive"});}
    finally{setSavingMembers(false);}
  }
  const memberCandidates = useMemo(()=>{
    const s=memberSearch.trim().toLowerCase();
    const list=allContacts.filter(c=>!s||c.name.toLowerCase().includes(s)||c.email.toLowerCase().includes(s));
    return list;
  },[allContacts,memberSearch]);

  // ─── Layout ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex overflow-hidden bg-slate-50 absolute inset-x-0 top-0 md:static md:h-[calc(100dvh-64px)]"
      style={{bottom:"calc(3.5rem + env(safe-area-inset-bottom))"}}>

      {/* LEFT SIDEBAR */}
      <div className={`flex-shrink-0 bg-white border-r border-slate-200 flex flex-col ${selectedId?"hidden md:flex md:w-72":"flex w-full md:w-72"}`}>
        {/* Header */}
        <div className="px-4 pt-4 pb-2 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-slate-900 text-lg">Chat</h2>
              {totalUnread>0 && <span className="bg-blue-600 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full" data-testid="badge-total-unread">{totalUnread}</span>}
            </div>
            <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full text-slate-500 hover:text-blue-600 hover:bg-blue-50" onClick={()=>{setShowNew(true);setCtSearch("");}} data-testid="button-new-conversation" title="New space">
              <Plus className="w-5 h-5"/>
            </Button>
          </div>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"/>
            <input value={sideSearch} onChange={e=>setSideSearch(e.target.value)} placeholder="Search people & spaces…" data-testid="input-sidebar-search"
              className="w-full pl-8 pr-8 h-8 text-sm bg-slate-50 border border-slate-200 rounded-full outline-none focus:ring-1 focus:ring-blue-300 transition-shadow"
            />
            {sideSearch && <button onClick={()=>setSideSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5"/></button>}
          </div>
          {/* Hands-free: one big target, reachable without opening a thread */}
          <button onClick={()=>setHandsFreeOpen(true)} data-testid="button-handsfree-sidebar"
            className="mt-3 w-full min-h-[3rem] rounded-2xl bg-violet-600 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] transition-transform">
            <Headphones className="w-5 h-5"/>Hands-free voice message
          </button>
        </div>

        {/* Sections */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 pt-1">
          {convsLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-400"/></div>
          ) : (
            <>
              {/* Direct messages */}
              <SectionHeader label="Direct messages" open={dmsOpen} onToggle={()=>setDmsOpen(o=>!o)} unread={dmUnread}/>
              {dmsOpen && (
                filteredRoster.length===0
                  ? <p className="text-xs text-slate-400 px-3 py-2">{q?"No people match":"No team members yet"}</p>
                  : filteredRoster.map(({contact,conv})=>(
                      <DmItem key={contact.email} contact={contact} conv={conv} avMap={avMap}
                        isActive={conv?.id===selectedId} opening={openingDm===contact.email}
                        onClick={()=>openDm(contact)}/>
                    ))
              )}

              {/* Spaces */}
              <div className="mt-2">
                <SectionHeader label="Spaces" open={spacesOpen} onToggle={()=>setSpacesOpen(o=>!o)} unread={spacesUnread}
                  action={
                    <button onClick={()=>{setShowNew(true);setCtSearch("");}} title="Create space" data-testid="button-create-space-inline"
                      className="p-1 rounded-full text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                      <Plus className="w-4 h-4"/>
                    </button>
                  }/>
                {spacesOpen && (
                  filteredSpaces.length===0
                    ? <p className="text-xs text-slate-400 px-3 py-2">{q?"No spaces match":"No spaces yet — tap + to create one"}</p>
                    : filteredSpaces.map(c=>(
                        <SpaceItem key={c.id} conv={c} isActive={c.id===selectedId} onClick={()=>selectConv(c.id)}/>
                      ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* RIGHT PANEL */}
      {selectedId ? (
        <div className="flex-1 flex flex-col min-w-0 bg-slate-50">
          {/* Thread header */}
          <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-3 flex-shrink-0 shadow-sm">
            <Button variant="ghost" size="icon" className="md:hidden h-8 w-8 rounded-full text-slate-500" onClick={()=>setSelectedId(null)}>
              <ArrowLeft className="w-4 h-4"/>
            </Button>
            {isLexiThread
              ? <div className="w-8 h-8 bg-violet-600 rounded-full flex items-center justify-center flex-shrink-0"><Sparkles className="w-4 h-4 text-white"/></div>
              : selConv?.chat_type==="direct"
              ? <Av name={convName} src={avMap[otherPartEmail]} size="md"/>
              : selConv ? <SpaceAv conv={selConv}/> : null
            }
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-slate-900 text-sm truncate" data-testid="text-conv-name">{convName}</div>
              <div className="text-xs text-slate-500">{convSub}</div>
            </div>
            <button onClick={()=>setHandsFreeOpen(true)} data-testid="button-handsfree-thread"
              title="Send a hands-free voice message"
              className="h-11 w-11 rounded-full bg-violet-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm active:scale-95 transition-transform">
              <Headphones className="w-5 h-5"/>
            </button>
            <Button variant="ghost" size="sm" onClick={handleSummarize} disabled={summarizing||!messages.length}
              className="text-violet-600 hover:bg-violet-50 hidden sm:flex items-center gap-1.5 h-8 rounded-full text-xs font-medium"
              data-testid="button-lexi-summarize"
            >
              <Sparkles className="w-3.5 h-3.5"/>{summarizing?"Summarizing…":"Lexi Summarize"}
            </Button>
            {selConv && isSpaceLike(selConv) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-slate-500" data-testid="button-space-menu">
                    <MoreVertical className="w-4 h-4"/>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canManageMembers
                    ? <DropdownMenuItem onClick={openMembersDialog} data-testid="menu-manage-members">
                        <UserPlus className="w-4 h-4 mr-2"/>Manage members
                      </DropdownMenuItem>
                    : <DropdownMenuItem disabled>
                        <Users className="w-4 h-4 mr-2"/>{selConv.chat_type==="broadcast"?"Includes everyone":"Members managed automatically"}
                      </DropdownMenuItem>
                  }
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Summary banner */}
          {summaryOpen && (
            <div className="bg-violet-50 border-b border-violet-100 px-4 py-3 flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-violet-500 mt-0.5 flex-shrink-0"/>
              <div className="flex-1">
                <p className="text-xs font-semibold text-violet-700 mb-1">Lexi Summary</p>
                {summarizing
                  ? <div className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400"/><span className="text-xs text-violet-500">Analyzing…</span></div>
                  : <p className="text-xs text-violet-800 whitespace-pre-wrap leading-relaxed">{summary}</p>}
              </div>
              <button onClick={()=>setSummaryOpen(false)} className="text-violet-400 hover:text-violet-600"><X className="w-4 h-4"/></button>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {msgsLoading
              ? <div className="flex items-center justify-center h-full"><Loader2 className="w-5 h-5 animate-spin text-slate-400"/></div>
              : messages.length===0
              ? <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center mb-3"><MessageSquare className="w-7 h-7 text-blue-300"/></div>
                  <p className="text-slate-500 font-medium text-sm">Start the conversation</p>
                  <p className="text-slate-400 text-xs mt-1">Say something to kick off the conversation</p>
                </div>
              : <>
                  {sections.map(item=>item.kind==="divider"
                    ? <DateDivider key={item.key} label={item.label}/>
                    : <Bubble key={item.key} msg={item.msg} isMine={item.msg.sender_email===userEmail} avSrc={avMap[item.msg.sender_email]} showHeader={item.showHeader} isLast={item.isLast} onReact={handleReact} userEmail={userEmail}/>
                  )}
                  {lexiThinking && (
                    <div className="flex gap-2 mt-3" data-testid="lexi-thinking">
                      <div className="w-8 h-8 bg-violet-600 rounded-full flex items-center justify-center flex-shrink-0"><Sparkles className="w-4 h-4 text-white"/></div>
                      <div className="rounded-2xl rounded-tl-none px-4 py-3 bg-violet-50 border border-violet-100 text-sm text-violet-600 flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin"/>Lexi is thinking…
                      </div>
                    </div>
                  )}
                  <div ref={bottomRef}/>
                </>
            }
          </div>

          {/* Quick reply chips */}
          {showQuickReplies && (
            <div className="flex gap-2 overflow-x-auto px-4 pb-2 pt-1 flex-shrink-0" style={{scrollbarWidth:"none"}}>
              {QUICK_REPLIES.map(chip=>(
                <button key={chip} data-testid={`quick-reply-${chip}`}
                  onClick={()=>{ if(!selectedId||!companyId) return; sendMut.mutate({company_id:companyId,conversation_id:selectedId,message:chip,message_type:"text"}); }}
                  className="flex-shrink-0 text-sm px-4 py-1.5 rounded-full border border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:text-blue-700 hover:bg-blue-50 transition-colors whitespace-nowrap shadow-sm">
                  {chip}
                </button>
              ))}
            </div>
          )}

          {/* Input bar */}
          <div className="bg-white border-t border-slate-200 px-4 py-3 flex-shrink-0">
            <div className="flex items-end gap-2">
              <div className="flex gap-0.5 pb-1 flex-shrink-0">
                <button onClick={()=>fileRef.current?.click()} disabled={uploading||recording} title="Attach a file" data-testid="button-attach-file"
                  className="p-2 rounded-full text-slate-800 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                  {uploading?<Loader2 className="w-4 h-4 animate-spin"/>:<Paperclip className="w-5 h-5"/>}
                </button>
                <button onClick={recording?()=>stopRecording(true):startRecording} disabled={uploading} data-testid="button-mic"
                  title={recording?"Stop & send voice message":"Record a voice message"}
                  className={`p-2 rounded-full transition-colors ${recording?"text-red-500 bg-red-50 animate-pulse":"text-slate-800 hover:text-red-500 hover:bg-red-50"}`}>
                  <Mic className="w-5 h-5"/>
                </button>
                <button onClick={()=>setShowTaskDone(true)} disabled={recording} title="Mark task done" data-testid="button-task-done"
                  className="p-2 rounded-full text-slate-800 hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                  <CheckCircle2 className="w-5 h-5"/>
                </button>
              </div>
              <input type="file" ref={fileRef} className="hidden" onChange={uploadAttachment}/>
              {recording
                ? <div className="flex-1 flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 min-h-[40px]" data-testid="recording-bar">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0"/>
                    <span className="text-sm font-medium text-red-600 flex-1">Recording… {fmtRec(recSecs)}</span>
                    <button onClick={()=>stopRecording(false)} title="Cancel recording" data-testid="button-cancel-recording"
                      className="p-1.5 rounded-full text-red-400 hover:text-red-600 hover:bg-red-100 transition-colors">
                      <Trash2 className="w-4 h-4"/>
                    </button>
                  </div>
                : <Textarea ref={inputRef} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={onKey}
                    placeholder="Message…" rows={1}
                    className="flex-1 resize-none rounded-2xl border-slate-200 bg-slate-50 text-sm leading-relaxed py-2.5 px-4 min-h-[40px] max-h-32 focus-visible:ring-1 focus-visible:ring-blue-300"
                    data-testid="input-message"
                  />
              }
              <Button onClick={recording?()=>stopRecording(true):handleSend} disabled={(!recording&&!draft.trim())||sendMut.isPending||uploading} size="icon"
                className={`h-10 w-10 rounded-full flex-shrink-0 mb-0.5 transition-all ${(draft.trim()||recording)?"bg-blue-600 hover:bg-blue-700 text-white shadow-sm":"bg-slate-200 text-slate-700 cursor-not-allowed"}`}
                data-testid="button-send">
                {(sendMut.isPending||uploading)?<Loader2 className="w-4 h-4 animate-spin"/>:<Send className="w-4 h-4"/>}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 hidden md:flex flex-col items-center justify-center bg-slate-50">
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-4"><MessageSquare className="w-10 h-10 text-blue-300"/></div>
          <h3 className="text-slate-700 font-semibold text-lg mb-1">Team Chat</h3>
          <p className="text-slate-400 text-sm text-center max-w-xs leading-relaxed">Pick a teammate under Direct messages,<br/>or open a Space to chat with the group.</p>
          <Button onClick={()=>setShowNew(true)} className="mt-6 bg-blue-600 hover:bg-blue-700 text-white rounded-full px-6">
            <Plus className="w-4 h-4 mr-1.5"/>Create a Space
          </Button>
        </div>
      )}

      {/* NEW SPACE DIALOG */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create a Space</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              {[{k:"space",l:"Space",I:Hash,d:"Pick members"},{k:"broadcast",l:"Everyone",I:Megaphone,d:"All team members"}].map(({k,l,I,d})=>(
                <button key={k} onClick={()=>{setNewType(k);setNewParts([]);}} data-testid={`type-${k}`}
                  className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border text-xs font-medium transition-colors ${newType===k?"bg-blue-50 border-blue-300 text-blue-700":"border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                  <I className="w-4 h-4"/>{l}
                  <span className="text-[10px] font-normal opacity-70">{d}</span>
                </button>
              ))}
            </div>
            <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Space name…" data-testid="input-space-name"
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-blue-300"/>
            <input value={newAvatar} onChange={e=>setNewAvatar(e.target.value)} placeholder="Avatar image URL (optional)…" data-testid="input-space-avatar"
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-blue-300"/>
            {newType!=="broadcast" && (
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">Add members</label>
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"/>
                  <input value={ctSearch} onChange={e=>setCtSearch(e.target.value)} placeholder="Search people…" data-testid="input-contact-search"
                    className="w-full pl-8 h-8 text-sm border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-blue-300"/>
                </div>
                <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {filtCt.length===0
                    ? <p className="text-sm text-slate-400 text-center py-6">No contacts found</p>
                    : filtCt.map(c=>{
                        const sel=newParts.includes(c.email);
                        return (
                          <button key={c.email} onClick={()=>togglePart(c.email)} data-testid={`contact-${c.email}`}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${sel?"bg-blue-50":"hover:bg-slate-50"}`}>
                            <Av name={c.name} src={avMap[c.email]} size="sm"/>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                              <p className="text-xs text-slate-400 truncate">{c.email}</p>
                            </div>
                            {sel && <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                            </div>}
                          </button>
                        );
                      })
                  }
                </div>
              </div>
            )}
            {newType==="broadcast" && (
              <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3">
                <p className="text-sm text-orange-700 font-medium">📢 Everyone is included</p>
                <p className="text-xs text-orange-600 mt-0.5">Messages go to all {allContacts.length} team members.</p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={()=>setShowNew(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!canCreate||creating} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-create-conversation">
              {creating?<Loader2 className="w-4 h-4 animate-spin mr-1.5"/>:<Plus className="w-4 h-4 mr-1.5"/>}Create Space
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MANAGE MEMBERS DIALOG */}
      <Dialog open={showMembers} onOpenChange={setShowMembers}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-blue-600"/>Manage Members</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-slate-500">{membersDraft.length} member{membersDraft.length!==1?"s":""} in {selConv?.name||"this space"}</p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"/>
              <input value={memberSearch} onChange={e=>setMemberSearch(e.target.value)} placeholder="Search people…" data-testid="input-member-search"
                className="w-full pl-8 h-8 text-sm border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-blue-300"/>
            </div>
            <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
              {memberCandidates.length===0
                ? <p className="text-sm text-slate-400 text-center py-6">No people found</p>
                : memberCandidates.map(c=>{
                    const sel=draftHas(c.email);
                    const isSelf=c.email===userEmail;
                    return (
                      <button key={c.email} onClick={()=>toggleDraftMember(c)} data-testid={`member-${c.email}`}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${sel?"bg-blue-50":"hover:bg-slate-50"}`}>
                        <Av name={c.name} src={avMap[c.email]} size="sm"/>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{c.name}{isSelf?" (you)":""}</p>
                          <p className="text-xs text-slate-400 truncate">{c.email}</p>
                        </div>
                        {sel && <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                        </div>}
                      </button>
                    );
                  })
              }
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={()=>setShowMembers(false)}>Cancel</Button>
            <Button onClick={saveMembers} disabled={savingMembers||membersDraft.length===0} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-save-members">
              {savingMembers?<Loader2 className="w-4 h-4 animate-spin mr-1.5"/>:<UserPlus className="w-4 h-4 mr-1.5"/>}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TASK DONE DIALOG */}
      <Dialog open={showTaskDone} onOpenChange={setShowTaskDone}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-600"/>Mark Task Done</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {myOpenTasks.length===0
              ? <p className="text-sm text-slate-500 text-center py-4">No open tasks assigned to you.</p>
              : <>
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-1.5 block">Select task</label>
                    <Select value={selTask} onValueChange={setSelTask}>
                      <SelectTrigger data-testid="select-task"><SelectValue placeholder="Choose a task…"/></SelectTrigger>
                      <SelectContent>{myOpenTasks.map(t=><SelectItem key={t.id} value={t.id}>{t.name||t.title||t.id}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-1.5 block">Note (optional)</label>
                    <Textarea value={taskNote} onChange={e=>setTaskNote(e.target.value)} placeholder="Any details to share…" rows={2} className="resize-none" data-testid="input-task-note"/>
                  </div>
                  <div className="bg-slate-50 rounded-lg px-3 py-2.5 flex items-start gap-2">
                    <Bell className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400"/>
                    <p className="text-xs text-slate-500">Admins and assignees will be notified via email and SMS.</p>
                  </div>
                </>
            }
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={()=>setShowTaskDone(false)}>Cancel</Button>
            <Button onClick={handleTaskDone} disabled={!selTask||markingDone||myOpenTasks.length===0} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="button-confirm-task-done">
              {markingDone?<Loader2 className="w-4 h-4 animate-spin mr-1.5"/>:<CheckCircle2 className="w-4 h-4 mr-1.5"/>}Mark Done &amp; Notify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* HANDS-FREE VOICE MESSAGE */}
      <HandsFreeVoiceMessage
        open={handsFreeOpen}
        onClose={()=>setHandsFreeOpen(false)}
        companyId={companyId}
        userEmail={userEmail}
        userName={userName}
        roster={voiceRoster}
        onDelivered={()=>{ qc.invalidateQueries({queryKey:["chat-conversations",companyId,userEmail]}); }}
      />
    </div>
  );
}
