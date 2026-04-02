import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Bot, Send, Loader2, Upload, FileText, Receipt, 
  TrendingUp, TrendingDown, AlertCircle, CheckCircle2,
  DollarSign, PieChart, Sparkles, RefreshCw, Eye,
  MessageSquare, Calculator, Lightbulb, ArrowRight
} from 'lucide-react';
import { format } from 'date-fns';

export default function AIAccountant() {
  const [user, setUser] = useState(null);
  const [myCompany, setMyCompany] = useState(null);
  const [activeTab, setActiveTab] = useState('chat');
  
  // Chat state
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hi! I'm your AI Accountant. I can help you with:\n\n• Answering accounting questions\n• Categorizing transactions\n• Analyzing your financial data\n• Processing receipts and invoices\n\nHow can I assist you today?" }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef(null);
  
  // Receipt processing state
  const [uploadedFile, setUploadedFile] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [isExtracting, setIsExtracting] = useState(false);
  
  // Insights state
  const [insights, setInsights] = useState(null);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  
  // Categorization state
  const [uncategorizedTransactions, setUncategorizedTransactions] = useState([]);
  const [isCategorizing, setIsCategorizing] = useState(false);
  const [categorySuggestions, setCategorySuggestions] = useState({});

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(async (u) => {
      setUser(u);
      const impersonatedId = sessionStorage.getItem('impersonating_company_id');
      if (impersonatedId) {
        const companies = await base44.entities.Company.filter({ id: impersonatedId });
        if (companies.length > 0) setMyCompany(companies[0]);
      } else {
        const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: u.email });
        if (staffProfiles.length > 0 && staffProfiles[0].company_id) {
          const companies = await base44.entities.Company.filter({ id: staffProfiles[0].company_id });
          if (companies.length > 0) setMyCompany(companies[0]);
        } else {
          const companies = await base44.entities.Company.list("-created_date", 10);
          setMyCompany(companies.find(c => c.created_by === u.email) || companies[0]);
        }
      }
    }).catch(() => {});
  }, []);

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Transaction.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Expense.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Invoice.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payment.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: chartOfAccounts = [] } = useQuery({
    queryKey: ['chart-of-accounts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.ChartOfAccounts.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // Scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Build financial context for AI
  const buildFinancialContext = () => {
    const totalRevenue = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const unpaidInvoices = invoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled');
    const accountsReceivable = unpaidInvoices.reduce((sum, i) => sum + (Number(i.amount || 0) - Number(i.amount_paid || 0)), 0);
    
    const expensesByCategory = expenses.reduce((acc, e) => {
      const cat = e.category || 'uncategorized';
      acc[cat] = (acc[cat] || 0) + Number(e.amount || 0);
      return acc;
    }, {});

    return `
COMPANY FINANCIAL DATA:
- Company: ${myCompany?.company_name || 'Unknown'}
- Total Revenue (all time): $${totalRevenue.toFixed(2)}
- Total Expenses (all time): $${totalExpenses.toFixed(2)}
- Net Profit: $${(totalRevenue - totalExpenses).toFixed(2)}
- Accounts Receivable: $${accountsReceivable.toFixed(2)} (${unpaidInvoices.length} unpaid invoices)
- Total Transactions: ${transactions.length}
- Total Invoices: ${invoices.length}
- Total Payments: ${payments.length}
- Total Expenses: ${expenses.length}

EXPENSE BREAKDOWN:
${Object.entries(expensesByCategory).map(([cat, amt]) => `- ${cat}: $${amt.toFixed(2)}`).join('\n')}

CHART OF ACCOUNTS:
${chartOfAccounts.map(a => `- ${a.account_number}: ${a.account_name} (${a.account_type})`).join('\n')}
    `;
  };

  // Chat with AI
  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isProcessing) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsProcessing(true);

    try {
      const financialContext = buildFinancialContext();
      
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an expert AI Accountant assistant for a roofing/construction company. You help with accounting questions, financial analysis, and bookkeeping guidance.

${financialContext}

USER QUESTION: ${userMessage}

Provide a helpful, accurate response. If asked about specific numbers, use the data provided. If you need more information, ask clarifying questions. Format your response clearly with bullet points or numbered lists when appropriate.`,
      });

      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } catch (error) {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "I'm sorry, I encountered an error processing your request. Please try again." 
      }]);
    }

    setIsProcessing(false);
  };

  // Process receipt/invoice
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    setIsExtracting(true);
    setExtractedData(null);

    try {
      // Upload the file
      const uploadResult = await base44.integrations.Core.UploadFile({ file });
      
      // Extract data using AI
      const extractionResult = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url: uploadResult.file_url,
        json_schema: {
          type: "object",
          properties: {
            document_type: { type: "string", enum: ["invoice", "receipt", "bill", "estimate", "other"] },
            vendor_name: { type: "string" },
            date: { type: "string" },
            total_amount: { type: "number" },
            subtotal: { type: "number" },
            tax_amount: { type: "number" },
            invoice_number: { type: "string" },
            line_items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  description: { type: "string" },
                  quantity: { type: "number" },
                  unit_price: { type: "number" },
                  amount: { type: "number" }
                }
              }
            },
            suggested_category: { type: "string", enum: ["materials", "labor", "equipment", "office", "travel", "utilities", "insurance", "other"] },
            notes: { type: "string" }
          }
        }
      });

      if (extractionResult.status === 'success') {
        setExtractedData({
          ...extractionResult.output,
          file_url: uploadResult.file_url
        });
      } else {
        setExtractedData({ error: extractionResult.details || 'Failed to extract data' });
      }
    } catch (error) {
      setExtractedData({ error: error.message });
    }

    setIsExtracting(false);
  };

  // Save extracted expense
  const saveExtractedExpense = async () => {
    if (!extractedData || extractedData.error) return;

    try {
      await base44.entities.Expense.create({
        company_id: myCompany.id,
        vendor_name: extractedData.vendor_name || 'Unknown',
        description: extractedData.notes || extractedData.line_items?.map(i => i.description).join(', ') || 'Expense',
        amount: extractedData.total_amount || 0,
        expense_date: extractedData.date || new Date().toISOString().split('T')[0],
        category: extractedData.suggested_category || 'other',
        receipt_url: extractedData.file_url,
        status: 'pending'
      });

      queryClient.invalidateQueries(['expenses']);
      setExtractedData(null);
      setUploadedFile(null);
      alert('Expense saved successfully!');
    } catch (error) {
      alert('Failed to save expense: ' + error.message);
    }
  };

  // Generate financial insights
  const generateInsights = async () => {
    setIsGeneratingInsights(true);
    setInsights(null);

    try {
      const financialContext = buildFinancialContext();
      
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this company's financial data and provide actionable insights:

${financialContext}

Provide insights in this JSON format:`,
        response_json_schema: {
          type: "object",
          properties: {
            health_score: { type: "number", description: "Financial health score from 1-100" },
            summary: { type: "string", description: "One sentence summary of financial health" },
            positive_insights: {
              type: "array",
              items: { type: "string" },
              description: "List of positive financial observations"
            },
            concerns: {
              type: "array",
              items: { type: "string" },
              description: "List of financial concerns or risks"
            },
            recommendations: {
              type: "array",
              items: { type: "string" },
              description: "Actionable recommendations to improve finances"
            },
            cash_flow_prediction: { type: "string", description: "Prediction for next 30 days" }
          }
        }
      });

      setInsights(response);
    } catch (error) {
      setInsights({ error: error.message });
    }

    setIsGeneratingInsights(false);
  };

  // Auto-categorize transactions
  const autoCategorizeTransactions = async () => {
    // Find expenses without proper categories
    const needsCategorization = expenses.filter(e => 
      !e.category || e.category === 'other' || e.category === 'uncategorized'
    ).slice(0, 10);

    if (needsCategorization.length === 0) {
      alert('No transactions need categorization!');
      return;
    }

    setUncategorizedTransactions(needsCategorization);
    setIsCategorizing(true);
    setCategorySuggestions({});

    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Categorize these expenses for a roofing/construction company:

${needsCategorization.map((e, i) => `${i + 1}. Vendor: ${e.vendor_name || 'Unknown'}, Description: ${e.description || 'N/A'}, Amount: $${e.amount}`).join('\n')}

Available categories: materials, labor, equipment, office, travel, utilities, insurance, marketing, professional_services, cogs, other

Return categorization as JSON:`,
        response_json_schema: {
          type: "object",
          properties: {
            categorizations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "number" },
                  suggested_category: { type: "string" },
                  confidence: { type: "string", enum: ["high", "medium", "low"] },
                  reason: { type: "string" }
                }
              }
            }
          }
        }
      });

      const suggestions = {};
      response.categorizations?.forEach(cat => {
        const expense = needsCategorization[cat.index - 1];
        if (expense) {
          suggestions[expense.id] = cat;
        }
      });
      setCategorySuggestions(suggestions);
    } catch (error) {
      alert('Failed to categorize: ' + error.message);
    }

    setIsCategorizing(false);
  };

  // Apply category suggestion
  const applyCategorySuggestion = async (expenseId, category) => {
    try {
      await base44.entities.Expense.update(expenseId, { category });
      queryClient.invalidateQueries(['expenses']);
      setCategorySuggestions(prev => {
        const updated = { ...prev };
        delete updated[expenseId];
        return updated;
      });
      setUncategorizedTransactions(prev => prev.filter(e => e.id !== expenseId));
    } catch (error) {
      alert('Failed to update category: ' + error.message);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Bot className="w-8 h-8 text-purple-600" />
            AI Accountant
          </h1>
          <p className="text-gray-500 mt-1">Your intelligent bookkeeping assistant</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="chat" className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Chat Assistant
          </TabsTrigger>
          <TabsTrigger value="categorize" className="flex items-center gap-2">
            <Calculator className="w-4 h-4" />
            Categorize
          </TabsTrigger>
          <TabsTrigger value="insights" className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />
            Insights
          </TabsTrigger>
          <TabsTrigger value="process" className="flex items-center gap-2">
            <Receipt className="w-4 h-4" />
            Process Documents
          </TabsTrigger>
        </TabsList>

        {/* Chat Tab */}
        <TabsContent value="chat" className="mt-4">
          <Card className="h-[600px] flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Chat with AI Accountant</CardTitle>
              <CardDescription>Ask questions about your finances, get explanations, or request analysis</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
              <ScrollArea className="flex-1 pr-4 mb-4">
                <div className="space-y-4">
                  {messages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-lg p-3 ${
                        msg.role === 'user' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-100 text-gray-900'
                      }`}>
                        {msg.role === 'assistant' && (
                          <div className="flex items-center gap-2 mb-2 text-purple-600">
                            <Bot className="w-4 h-4" />
                            <span className="text-sm font-semibold">AI Accountant</span>
                          </div>
                        )}
                        <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                      </div>
                    </div>
                  ))}
                  {isProcessing && (
                    <div className="flex justify-start">
                      <div className="bg-gray-100 rounded-lg p-3">
                        <Loader2 className="w-5 h-5 animate-spin text-purple-600" />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
              
              <div className="flex gap-2">
                <Input
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="Ask about your finances..."
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  disabled={isProcessing}
                />
                <Button onClick={handleSendMessage} disabled={isProcessing || !inputMessage.trim()}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex gap-2 mt-3 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => setInputMessage("What's my profit margin this month?")}>
                  Profit Margin
                </Button>
                <Button variant="outline" size="sm" onClick={() => setInputMessage("Show me my biggest expenses")}>
                  Top Expenses
                </Button>
                <Button variant="outline" size="sm" onClick={() => setInputMessage("How much am I owed in unpaid invoices?")}>
                  Unpaid Invoices
                </Button>
                <Button variant="outline" size="sm" onClick={() => setInputMessage("Explain accounts receivable vs payable")}>
                  Explain AR/AP
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Categorize Tab */}
        <TabsContent value="categorize" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="w-5 h-5 text-blue-600" />
                Auto-Categorize Transactions
              </CardTitle>
              <CardDescription>AI will analyze your expenses and suggest categories</CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={autoCategorizeTransactions} 
                disabled={isCategorizing}
                className="mb-4"
              >
                {isCategorizing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Analyze Uncategorized Expenses
                  </>
                )}
              </Button>

              {uncategorizedTransactions.length > 0 && (
                <div className="space-y-3">
                  {uncategorizedTransactions.map(expense => {
                    const suggestion = categorySuggestions[expense.id];
                    return (
                      <div key={expense.id} className="p-4 border rounded-lg bg-gray-50">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-semibold">{expense.vendor_name || 'Unknown Vendor'}</p>
                            <p className="text-sm text-gray-600">{expense.description}</p>
                            <p className="text-sm text-gray-500">
                              {expense.expense_date && format(new Date(expense.expense_date), 'MMM d, yyyy')}
                            </p>
                          </div>
                          <p className="text-lg font-bold">${Number(expense.amount || 0).toFixed(2)}</p>
                        </div>
                        
                        {suggestion && (
                          <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                            <div className="flex items-center gap-2 mb-2">
                              <Sparkles className="w-4 h-4 text-blue-600" />
                              <span className="font-semibold text-blue-900">AI Suggestion</span>
                              <Badge variant={suggestion.confidence === 'high' ? 'default' : 'secondary'}>
                                {suggestion.confidence} confidence
                              </Badge>
                            </div>
                            <p className="text-sm text-blue-800 mb-2">{suggestion.reason}</p>
                            <div className="flex gap-2">
                              <Button 
                                size="sm" 
                                onClick={() => applyCategorySuggestion(expense.id, suggestion.suggested_category)}
                              >
                                <CheckCircle2 className="w-4 h-4 mr-1" />
                                Apply: {suggestion.suggested_category}
                              </Button>
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => {
                                  setCategorySuggestions(prev => {
                                    const updated = { ...prev };
                                    delete updated[expense.id];
                                    return updated;
                                  });
                                }}
                              >
                                Dismiss
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {uncategorizedTransactions.length === 0 && !isCategorizing && (
                <Alert>
                  <CheckCircle2 className="w-4 h-4" />
                  <AlertDescription>
                    Click "Analyze" to find expenses that need categorization.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Insights Tab */}
        <TabsContent value="insights" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-yellow-600" />
                Financial Insights
              </CardTitle>
              <CardDescription>AI-powered analysis of your financial health</CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={generateInsights} 
                disabled={isGeneratingInsights}
                className="mb-6"
              >
                {isGeneratingInsights ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Generate Insights
                  </>
                )}
              </Button>

              {insights && !insights.error && (
                <div className="space-y-6">
                  {/* Health Score */}
                  <div className="text-center p-6 bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl">
                    <p className="text-sm text-gray-600 mb-2">Financial Health Score</p>
                    <div className={`text-6xl font-bold ${
                      insights.health_score >= 70 ? 'text-green-600' : 
                      insights.health_score >= 50 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {insights.health_score}
                    </div>
                    <p className="text-gray-600 mt-2">{insights.summary}</p>
                  </div>

                  {/* Positive Insights */}
                  {insights.positive_insights?.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-green-700 flex items-center gap-2 mb-3">
                        <TrendingUp className="w-5 h-5" />
                        Positive Observations
                      </h3>
                      <div className="space-y-2">
                        {insights.positive_insights.map((insight, idx) => (
                          <div key={idx} className="flex items-start gap-2 p-3 bg-green-50 rounded-lg">
                            <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                            <span className="text-sm text-green-800">{insight}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Concerns */}
                  {insights.concerns?.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-orange-700 flex items-center gap-2 mb-3">
                        <AlertCircle className="w-5 h-5" />
                        Areas of Concern
                      </h3>
                      <div className="space-y-2">
                        {insights.concerns.map((concern, idx) => (
                          <div key={idx} className="flex items-start gap-2 p-3 bg-orange-50 rounded-lg">
                            <AlertCircle className="w-4 h-4 text-orange-600 mt-0.5" />
                            <span className="text-sm text-orange-800">{concern}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recommendations */}
                  {insights.recommendations?.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-blue-700 flex items-center gap-2 mb-3">
                        <Lightbulb className="w-5 h-5" />
                        Recommendations
                      </h3>
                      <div className="space-y-2">
                        {insights.recommendations.map((rec, idx) => (
                          <div key={idx} className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg">
                            <ArrowRight className="w-4 h-4 text-blue-600 mt-0.5" />
                            <span className="text-sm text-blue-800">{rec}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Cash Flow Prediction */}
                  {insights.cash_flow_prediction && (
                    <div className="p-4 bg-purple-50 rounded-lg">
                      <h3 className="font-semibold text-purple-700 flex items-center gap-2 mb-2">
                        <PieChart className="w-5 h-5" />
                        30-Day Cash Flow Prediction
                      </h3>
                      <p className="text-sm text-purple-800">{insights.cash_flow_prediction}</p>
                    </div>
                  )}
                </div>
              )}

              {insights?.error && (
                <Alert variant="destructive">
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription>{insights.error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Process Documents Tab */}
        <TabsContent value="process" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-green-600" />
                Process Receipts & Invoices
              </CardTitle>
              <CardDescription>Upload documents and AI will extract the data automatically</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-6">
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                  disabled={isExtracting}
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  {isExtracting ? (
                    <div className="flex flex-col items-center">
                      <Loader2 className="w-12 h-12 text-purple-600 animate-spin mb-3" />
                      <p className="text-gray-600">Extracting data from document...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <Upload className="w-12 h-12 text-gray-400 mb-3" />
                      <p className="text-lg font-semibold text-gray-700">Drop a receipt or invoice here</p>
                      <p className="text-sm text-gray-500 mt-1">Supports PDF, JPG, PNG</p>
                      <Button className="mt-4" variant="outline">
                        <FileText className="w-4 h-4 mr-2" />
                        Choose File
                      </Button>
                    </div>
                  )}
                </label>
              </div>

              {uploadedFile && !isExtracting && (
                <div className="mb-4 p-3 bg-gray-50 rounded-lg flex items-center gap-3">
                  <FileText className="w-5 h-5 text-blue-600" />
                  <span className="font-medium">{uploadedFile.name}</span>
                </div>
              )}

              {extractedData && !extractedData.error && (
                <div className="border rounded-lg p-6 space-y-4">
                  <div className="flex items-center gap-2 text-green-600 mb-4">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-semibold">Data Extracted Successfully</span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-gray-600">Document Type</label>
                      <p className="font-semibold capitalize">{extractedData.document_type}</p>
                    </div>
                    <div>
                      <label className="text-sm text-gray-600">Vendor</label>
                      <p className="font-semibold">{extractedData.vendor_name || 'Unknown'}</p>
                    </div>
                    <div>
                      <label className="text-sm text-gray-600">Date</label>
                      <p className="font-semibold">{extractedData.date || 'Not found'}</p>
                    </div>
                    <div>
                      <label className="text-sm text-gray-600">Total Amount</label>
                      <p className="font-semibold text-lg">${Number(extractedData.total_amount || 0).toFixed(2) || '0.00'}</p>
                    </div>
                    {extractedData.invoice_number && (
                      <div>
                        <label className="text-sm text-gray-600">Invoice #</label>
                        <p className="font-semibold">{extractedData.invoice_number}</p>
                      </div>
                    )}
                    <div>
                      <label className="text-sm text-gray-600">Suggested Category</label>
                      <Badge className="mt-1">{extractedData.suggested_category || 'other'}</Badge>
                    </div>
                  </div>

                  {extractedData.line_items?.length > 0 && (
                    <div className="mt-4">
                      <label className="text-sm text-gray-600 block mb-2">Line Items</label>
                      <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                        {extractedData.line_items.map((item, idx) => (
                          <div key={idx} className="flex justify-between text-sm">
                            <span>{item.description}</span>
                            <span className="font-semibold">${Number(item.amount || 0).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 mt-6">
                    <Button onClick={saveExtractedExpense} className="flex-1">
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Save as Expense
                    </Button>
                    <Button variant="outline" onClick={() => { setExtractedData(null); setUploadedFile(null); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {extractedData?.error && (
                <Alert variant="destructive">
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription>{extractedData.error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}