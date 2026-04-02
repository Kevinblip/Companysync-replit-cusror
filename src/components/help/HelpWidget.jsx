import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";

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
  let score = 0;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (title.includes(k)) score += 4;
    if (category.includes(k)) score += 2;
    if (content.includes(k)) score += 1;
  }
  return score;
}

const CATEGORY_COLORS = {
  processes: "bg-blue-100 text-blue-700",
  policies: "bg-purple-100 text-purple-700",
  services: "bg-green-100 text-green-700",
  pricing: "bg-amber-100 text-amber-700",
  faq: "bg-rose-100 text-rose-700",
  Operations: "bg-slate-100 text-slate-700",
  team: "bg-cyan-100 text-cyan-700",
  "Training Videos": "bg-orange-100 text-orange-700",
};

function ArticleView({ article, onBack }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-slate-50">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors"
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
          dangerouslySetInnerHTML={{
            __html: (article.content || "")
              .replace(/^#{1,6}\s+(.+)$/gm, (_, t) => `<strong class="block text-slate-900 mt-3 mb-1">${t}</strong>`)
              .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
              .replace(/\*(.+?)\*/g, "<em>$1</em>")
              .replace(/\n\n/g, "<br/><br/>")
              .replace(/\n/g, "<br/>"),
          }}
        />
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

  const articles = rawArticles.filter(a => a.category !== "Training Videos");

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

  const pageKeywords = getPageKeywords(location.pathname);

  const suggestedArticles = articles
    .map(a => ({ ...a, score: scoreArticle(a, pageKeywords) }))
    .filter(a => a.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const searchResults = searchQuery.trim().length > 1
    ? articles
        .map(a => ({ ...a, score: scoreArticle(a, searchQuery.trim().split(/\s+/)) }))
        .filter(a => {
          const q = searchQuery.toLowerCase();
          return (
            (a.title || "").toLowerCase().includes(q) ||
            (a.content || "").toLowerCase().includes(q) ||
            (a.category || "").toLowerCase().includes(q) ||
            a.score > 0
          );
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
    : [];

  const displayArticles = searchQuery.trim().length > 1 ? searchResults : suggestedArticles;

  const handleAskAI = async () => {
    if (!aiQuestion.trim() || isAiLoading) return;
    setIsAiLoading(true);
    setAiAnswer(null);
    try {
      const questionKeywords = aiQuestion.trim().split(/\s+/);
      const topArticles = articles
        .map(a => ({ ...a, score: scoreArticle(a, questionKeywords) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      const context = topArticles.length > 0
        ? topArticles.map(a =>
            `ARTICLE: ${a.title}\n${(a.content || "").substring(0, 600)}`
          ).join("\n\n---\n\n")
        : "No specific knowledge base articles found for this question.";

      const companyName = myCompany?.company_name || "this roofing company";

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a helpful support assistant for CompanySync, a roofing business management platform used by ${companyName}. Answer the question below using the knowledge base articles provided. Be concise (2-5 sentences max). If the answer isn't in the articles, give a general helpful answer based on CompanySync's features. Never say "I don't know" — always try to be helpful.\n\nKNOWLEDGE BASE:\n${context}\n\nQUESTION: ${aiQuestion}`,
      });

      setAiAnswer(typeof response === "string" ? response : response?.message || JSON.stringify(response));
    } catch (err) {
      setAiAnswer("Sorry, I couldn't get an answer right now. Try searching the knowledge base or start a conversation with Lexi.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleGoToLexi = () => {
    onClose();
    navigate("/AIAssistant");
  };

  const handleGoToKB = () => {
    onClose();
    navigate("/KnowledgeBase");
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
              <ArticleView article={selectedArticle} onBack={() => setSelectedArticle(null)} />
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
                            ? "No articles matched your search. Try the AI answer below."
                            : "No articles found. Add articles to your Knowledge Base to see suggestions here."}
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
                            onClick={() => setSelectedArticle(article)}
                            className="w-full text-left p-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all group flex items-start gap-3"
                          >
                            <BookOpen className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0 group-hover:text-blue-500 transition-colors" />
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
                        Answers based on your Knowledge Base · ~$0.001 per question
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
