import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { PRODUCT_GUIDES, GUIDE_CATEGORY_ORDER } from "@/data/productGuides";
import {
  X,
  Search,
  BookOpen,
  Sparkles,
  ChevronRight,
  ArrowLeft,
  Loader2,
  MessageSquare,
  HelpCircle,
  Lightbulb,
  Send,
  MapPin,
  ExternalLink,
  ArrowRight,
  PlayCircle,
} from "lucide-react";
import { createPageUrl } from "@/utils";

const SHARED_TRAINING_COMPANY_ID = "695944e3c1fb00b7ab716c6f";

const PAGE_KEYWORD_MAP = [
  { patterns: ["estimate"], keywords: ["estimate", "eagleview", "ai estimator", "roof measure", "xactimate", "quote"] },
  { patterns: ["lead", "storm", "finder"], keywords: ["lead", "storm", "finder", "crm", "prospect"] },
  { patterns: ["invoice"], keywords: ["invoice", "payment", "billing"] },
  { patterns: ["calendar", "schedule"], keywords: ["calendar", "schedule", "appointment"] },
  { patterns: ["crew", "staff", "employee"], keywords: ["crew", "team", "staff"] },
  { patterns: ["account"], keywords: ["accounting", "financial", "revenue", "invoice"] },
  { patterns: ["lexi", "ai-assistant", "assistant"], keywords: ["ai", "assistant", "lexi", "training", "knowledge"] },
  { patterns: ["sarah", "voice", "call"], keywords: ["sarah", "ai", "call", "voice", "inbound"] },
  { patterns: ["customer", "portal"], keywords: ["customer", "portal", "crm"] },
  { patterns: ["knowledge", "training"], keywords: ["knowledge", "training", "guide", "video"] },
  { patterns: ["insurance", "claim"], keywords: ["insurance", "xactimate", "carrier", "claim"] },
  { patterns: ["contract", "document", "sign"], keywords: ["contract", "document", "sign", "pdf"] },
  { patterns: ["dashboard"], keywords: ["setup", "guide", "getting started", "dashboard"] },
];

const CATEGORY_COLORS = {
  processes: "bg-blue-100 text-blue-700",
  policies: "bg-purple-100 text-purple-700",
  services: "bg-green-100 text-green-700",
  pricing: "bg-amber-100 text-amber-700",
  faq: "bg-rose-100 text-rose-700",
  Operations: "bg-slate-100 text-slate-700",
  team: "bg-cyan-100 text-cyan-700",
  "Training Videos": "bg-orange-100 text-orange-700",
  // Built-in product guide categories
  "Getting Started": "bg-blue-100 text-blue-700",
  "Leads & Prospecting": "bg-emerald-100 text-emerald-700",
  "Estimates & AI": "bg-violet-100 text-violet-700",
  "Invoicing & Payments": "bg-amber-100 text-amber-700",
  Customers: "bg-cyan-100 text-cyan-700",
  "Projects & Field": "bg-orange-100 text-orange-700",
  "AI Assistant": "bg-purple-100 text-purple-700",
  Communication: "bg-sky-100 text-sky-700",
  "Reports & Settings": "bg-slate-100 text-slate-700",
};

function getPageKeywords(pathname) {
  const p = pathname.toLowerCase();
  for (const { patterns, keywords } of PAGE_KEYWORD_MAP) {
    if (patterns.some(pat => p.includes(pat))) return keywords;
  }
  return ["guide", "process", "setup"];
}

function scoreArticle(article, keywords) {
  const title = (article.title || "").toLowerCase();
  const content = (article.content || "").toLowerCase();
  const category = (article.category || "").toLowerCase();
  const ownKeywords = (article.keywords || []).map(k => String(k).toLowerCase());
  let score = 0;
  for (const kw of keywords) {
    const k = String(kw).toLowerCase().trim();
    if (!k) continue;
    if (title.includes(k)) score += 4;
    if (ownKeywords.some(o => o.includes(k) || k.includes(o))) score += 3;
    if (category.includes(k)) score += 2;
    if (content.includes(k)) score += 1;
  }
  return score;
}

// Escape raw HTML so company-authored KB content can't inject markup/scripts,
// THEN apply our lightweight markdown so headings/bold/italic still render.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderArticleHtml(raw) {
  return escapeHtml(raw || "")
    .replace(/^#{1,6}\s+(.+)$/gm, (_, t) => `<strong class="block text-slate-900 mt-3 mb-1">${t}</strong>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}

function ArticleView({ article, onBack, onOpenPage }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-slate-50">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors"
          data-testid="button-help-article-back"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <Badge className={`mb-3 text-xs font-medium ${CATEGORY_COLORS[article.category] || "bg-slate-100 text-slate-700"}`}>
          {article.category}
        </Badge>
        <h2 className="text-lg font-bold text-slate-900 mb-4 leading-tight">{article.title}</h2>
        <div
          className="prose prose-sm max-w-none text-slate-700 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderArticleHtml(article.content) }}
        />
        {article.route && (
          <Button
            onClick={() => onOpenPage?.(article.route)}
            className="mt-5 w-full bg-blue-600 hover:bg-blue-700 text-white"
            data-testid="button-help-open-page"
          >
            Open this page
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

export default function HelpWidget({ isOpen, onClose, onStartTour, myCompany, myStaffProfile }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const searchRef = useRef(null);

  const { data: rawArticles = [] } = useQuery({
    queryKey: ["help-kb-articles", myCompany?.id],
    queryFn: () => base44.entities.KnowledgeBaseArticle.list("-created_date", 500),
    enabled: isOpen && !!myCompany?.id,
    staleTime: 5 * 60 * 1000,
  });

  const companyArticles = rawArticles.filter(a => a.category !== "Training Videos");

  const { data: trainingVideos = [] } = useQuery({
    queryKey: ["help-training-videos", myCompany?.id],
    queryFn: () => base44.entities.TrainingVideo.filter({ company_id: { $in: [myCompany.id, SHARED_TRAINING_COMPANY_ID] } }),
    enabled: isOpen && !!myCompany?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Training videos are a separate entity — merge them in as "articles" so
  // they show up in search/suggestions/browse, but clicking one opens the
  // video player instead of the text article view (see handleArticleClick).
  const videoArticles = trainingVideos.map(v => ({
    id: v.id,
    title: v.title,
    category: "Training Videos",
    content: v.description || `Video: ${v.title}`,
    keywords: ["video", "training", "watch"],
    entity_type: "TrainingVideo",
  }));

  // Built-in product guides ship with the app (always available, zero upkeep);
  // a company's own Knowledge Base articles and training videos merge in on top of them.
  const articles = [...PRODUCT_GUIDES, ...companyArticles, ...videoArticles];

  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setAiQuestion("");
      setAiAnswer(null);
      setSelectedArticle(null);
      setTimeout(() => searchRef.current?.focus(), 150);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedArticle(null);
  }, [location.pathname]);

  const currentPageName = location.pathname.replace(/^\//, "").toLowerCase();
  const pageKeywords = getPageKeywords(location.pathname);

  // Suggestions: any guide whose route matches the current page comes first,
  // then anything else that scores against the page's keywords.
  const routeMatches = currentPageName
    ? articles.filter(a => (a.route || "").toLowerCase() === currentPageName)
    : [];
  const routeMatchIds = new Set(routeMatches.map(a => a.id));
  const keywordMatches = articles
    .filter(a => !routeMatchIds.has(a.id))
    .map(a => ({ ...a, score: scoreArticle(a, pageKeywords) }))
    .filter(a => a.score > 0)
    .sort((a, b) => b.score - a.score);
  const suggestedArticles = [...routeMatches, ...keywordMatches].slice(0, 5);

  const searchResults = searchQuery.trim().length > 1
    ? articles
        .map(a => ({ ...a, score: scoreArticle(a, searchQuery.trim().split(/\s+/)) }))
        .filter(a => {
          const q = searchQuery.toLowerCase();
          return (
            (a.title || "").toLowerCase().includes(q) ||
            (a.content || "").toLowerCase().includes(q) ||
            (a.category || "").toLowerCase().includes(q) ||
            (a.keywords || []).some(k => String(k).toLowerCase().includes(q)) ||
            a.score > 0
          );
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
    : [];

  const displayArticles = searchQuery.trim().length > 1 ? searchResults : suggestedArticles;

  // Browse-by-category (shown when not searching): built-in categories in a
  // fixed order first, then any extra categories from the company's KB.
  const browseGroups = (() => {
    const byCat = new Map();
    for (const a of articles) {
      const cat = a.category || "Other";
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(a);
    }
    const ordered = [];
    for (const cat of GUIDE_CATEGORY_ORDER) {
      if (byCat.has(cat)) { ordered.push([cat, byCat.get(cat)]); byCat.delete(cat); }
    }
    for (const [cat, items] of byCat) ordered.push([cat, items]);
    return ordered;
  })();

  const handleAskAI = async () => {
    if (!aiQuestion.trim() || isAiLoading) return;
    setIsAiLoading(true);
    setAiAnswer(null);
    try {
      const questionKeywords = aiQuestion.trim().split(/\s+/);
      const scored = articles
        .map(a => ({ ...a, score: scoreArticle(a, questionKeywords) }))
        .filter(a => a.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      // If nothing matched the question, fall back to the current page's guides
      // so the answer stays relevant instead of grounding on random content.
      const pageFallback = currentPageName
        ? articles.filter(a => (a.route || "").toLowerCase() === currentPageName)
        : [];
      const grounding = scored.length > 0 ? scored : pageFallback.slice(0, 2);

      const context = grounding.length > 0
        ? grounding.map(a =>
            `GUIDE: ${a.title} (Category: ${a.category})\n${(a.content || "").substring(0, 900)}`
          ).join("\n\n---\n\n")
        : "No specific guides matched this question.";

      const companyName = myCompany?.company_name || "this roofing company";
      const pageHint = currentPageName ? ` The user is currently on the "${currentPageName}" page.` : "";

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are the in-app help assistant for CompanySync, a roofing business management platform used by ${companyName}.${pageHint} Answer the user's question using the product guides below. Be concise and practical (2-5 sentences), and when it helps, give a short numbered list of steps. Use plain, everyday language. If the guides don't fully cover it, answer helpfully from your knowledge of CompanySync's features. Never say "I don't know" and never mention that you were given guides — just answer.\n\nPRODUCT GUIDES:\n${context}\n\nQUESTION: ${aiQuestion}`,
      });

      setAiAnswer(typeof response === "string" ? response : response?.message || JSON.stringify(response));
    } catch (err) {
      setAiAnswer("Sorry, I couldn't get an answer right now. Try searching the knowledge base or start a conversation with Lexi.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleArticleClick = (article) => {
    if (article.entity_type === "TrainingVideo") {
      onClose();
      navigate(`${createPageUrl("TrainingVideoPlayer")}?id=${article.id}`);
      return;
    }
    setSelectedArticle(article);
  };

  const handleGoToLexi = () => {
    onClose();
    navigate("/AIAssistant");
  };

  const handleGoToKB = () => {
    onClose();
    navigate("/KnowledgeBase");
  };

  const handleOpenPage = (route) => {
    if (!route) return;
    onClose();
    navigate("/" + route);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-black/20"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            className="fixed top-0 right-0 h-full w-[400px] max-w-[95vw] bg-white shadow-2xl z-[151] flex flex-col"
          >
            {selectedArticle ? (
              <ArticleView
                article={selectedArticle}
                onBack={() => setSelectedArticle(null)}
                onOpenPage={handleOpenPage}
              />
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                      <HelpCircle className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-slate-900 text-sm leading-tight">Help Center</h2>
                      <p className="text-xs text-slate-500">Search guides &amp; get instant answers</p>
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="text-slate-400 hover:text-slate-700 transition-colors p-1 rounded-md hover:bg-slate-100"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Search */}
                <div className="px-4 py-3 border-b bg-slate-50">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      ref={searchRef}
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search guides, how-to articles..."
                      className="pl-9 bg-white border-slate-200 text-sm h-9"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto">
                  {/* Articles */}
                  <div className="px-4 pt-4 pb-2">
                    {searchQuery.trim().length > 1 ? (
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                        {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for &ldquo;{searchQuery}&rdquo;
                      </p>
                    ) : (
                      <div className="flex items-center gap-1.5 mb-3">
                        <MapPin className="w-3.5 h-3.5 text-blue-500" />
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Suggested for this page
                        </p>
                      </div>
                    )}

                    {displayArticles.length === 0 ? (
                      <div className="text-center py-6 text-slate-400">
                        <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">
                          {searchQuery.trim().length > 1
                            ? "No guides matched your search. Try the Quick AI Answer below."
                            : "Browse the topics below, or ask the Quick AI Answer anything."}
                        </p>
                        {articles.length === 0 && (
                          <button
                            onClick={handleGoToKB}
                            className="mt-2 text-xs text-blue-600 hover:underline"
                          >
                            Open Knowledge Base →
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {displayArticles.map(article => (
                          <button
                            key={article.id}
                            onClick={() => handleArticleClick(article)}
                            className="w-full text-left p-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all group flex items-start gap-3"
                            data-testid={`button-help-article-${article.id}`}
                          >
                            {article.entity_type === "TrainingVideo" ? (
                              <PlayCircle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0 group-hover:text-orange-500 transition-colors" />
                            ) : (
                              <BookOpen className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0 group-hover:text-blue-500 transition-colors" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-800 leading-snug group-hover:text-blue-700 transition-colors line-clamp-2">
                                {article.title}
                              </p>
                              <Badge className={`mt-1 text-[10px] px-1.5 py-0 ${CATEGORY_COLORS[article.category] || "bg-slate-100 text-slate-600"}`}>
                                {article.category}
                              </Badge>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 flex-shrink-0 mt-0.5 transition-colors" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Browse all topics (only when not searching) */}
                  {searchQuery.trim().length <= 1 && (
                    <div className="px-4 pb-2">
                      <div className="flex items-center gap-1.5 mb-3 mt-1">
                        <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Browse all topics
                        </p>
                      </div>
                      <div className="space-y-4">
                        {browseGroups.map(([category, items]) => (
                          <div key={category}>
                            <Badge className={`mb-1.5 text-[10px] px-1.5 py-0 ${CATEGORY_COLORS[category] || "bg-slate-100 text-slate-600"}`}>
                              {category}
                            </Badge>
                            <div className="space-y-0.5">
                              {items.map(article => (
                                <button
                                  key={article.id}
                                  onClick={() => handleArticleClick(article)}
                                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-50 transition-colors group flex items-center gap-2"
                                  data-testid={`link-help-topic-${article.id}`}
                                >
                                  {article.entity_type === "TrainingVideo" ? (
                                    <PlayCircle className="w-3.5 h-3.5 text-orange-400 group-hover:text-orange-500 flex-shrink-0 transition-colors" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-500 flex-shrink-0 transition-colors" />
                                  )}
                                  <span className="text-sm text-slate-700 group-hover:text-blue-700 transition-colors leading-snug line-clamp-1">
                                    {article.title}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Divider */}
                  <div className="mx-4 my-3 border-t border-dashed border-slate-200" />

                  {/* Quick AI Answer */}
                  <div className="px-4 pb-4">
                    <div className="flex items-center gap-1.5 mb-3">
                      <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Quick AI Answer</p>
                    </div>

                    <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl p-3 border border-purple-100">
                      <div className="flex gap-2">
                        <Input
                          value={aiQuestion}
                          onChange={e => setAiQuestion(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && handleAskAI()}
                          placeholder="Ask anything about CompanySync..."
                          className="flex-1 bg-white border-slate-200 text-sm h-9"
                          disabled={isAiLoading}
                        />
                        <Button
                          onClick={handleAskAI}
                          disabled={!aiQuestion.trim() || isAiLoading}
                          size="sm"
                          className="bg-purple-600 hover:bg-purple-700 text-white h-9 px-3 flex-shrink-0"
                        >
                          {isAiLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                        </Button>
                      </div>

                      {aiAnswer && (
                        <motion.div
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mt-3 p-3 bg-white rounded-lg border border-purple-100 shadow-sm"
                        >
                          <div className="flex items-center gap-1.5 mb-2">
                            <Lightbulb className="w-3.5 h-3.5 text-purple-500" />
                            <span className="text-xs font-semibold text-purple-700">AI Answer</span>
                          </div>
                          <p className="text-sm text-slate-700 leading-relaxed">{aiAnswer}</p>
                          <button
                            onClick={() => { setAiQuestion(""); setAiAnswer(null); }}
                            className="mt-2 text-xs text-slate-400 hover:text-slate-600"
                          >
                            Clear
                          </button>
                        </motion.div>
                      )}

                      <p className="text-[10px] text-purple-400 mt-2">
                        Answers use CompanySync's built-in guides &amp; your Knowledge Base · ~$0.001 per question
                      </p>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="border-t bg-slate-50 px-4 py-3 flex flex-col gap-2">
                  <button
                    onClick={handleGoToLexi}
                    className="flex items-center justify-between w-full p-2.5 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 transition-all group"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 bg-gradient-to-br from-purple-500 to-blue-500 rounded-md flex items-center justify-center">
                        <MessageSquare className="w-3.5 h-3.5 text-white" />
                      </div>
                      <div className="text-left">
                        <p className="text-xs font-semibold text-slate-800">Chat with Lexi</p>
                        <p className="text-[10px] text-slate-500">Full AI conversation for complex questions</p>
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600" />
                  </button>

                  <div className="flex gap-2">
                    <button
                      onClick={handleGoToKB}
                      className="flex-1 text-xs text-slate-500 hover:text-slate-800 py-1.5 rounded-md hover:bg-white border border-transparent hover:border-slate-200 transition-all text-center"
                    >
                      <BookOpen className="w-3 h-3 inline mr-1" />
                      Knowledge Base
                    </button>
                    <button
                      onClick={() => { onClose(); onStartTour?.(); }}
                      className="flex-1 text-xs text-slate-500 hover:text-slate-800 py-1.5 rounded-md hover:bg-white border border-transparent hover:border-slate-200 transition-all text-center"
                    >
                      <HelpCircle className="w-3 h-3 inline mr-1" />
                      Product Tour
                    </button>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
