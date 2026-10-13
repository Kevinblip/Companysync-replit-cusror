import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  MessageCircle, 
  Send, 
  Sparkles, 
  ExternalLink,
  MapPin,
  FileSpreadsheet,
  HelpCircle,
  ChevronDown,
  CheckCircle2
} from "lucide-react";

export default function PropertyDataSpecialist({ myCompany }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const messagesEndRef = React.useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Welcome message
    setMessages([{
      role: "assistant",
      content: `👋 Hi! I'm your Property Data Specialist AI.

I'll help you get REAL property owner data from county auditor websites (100% FREE).

**What I can help with:**
🏠 Find your county's property records website
📋 Guide you step-by-step through downloading CSVs
🎯 Help you identify storm-affected areas
📞 Explain how to enrich leads with phone numbers

**Quick Starts:**
• "How do I get Cleveland property data?"
• "Show me Richland County instructions"
• "What's the best way to find storm leads?"

Ask me anything!`,
      timestamp: new Date().toISOString()
    }]);
  }, []);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = {
      role: "user",
      content: input,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsThinking(true);

    try {
      // AI analyzes the question and provides contextual help
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a Property Data Specialist AI helping users import real property owner data from county auditor websites.

CONTEXT:
- Users need to get property records from county auditor websites (FREE public data)
- Common counties: Richland OH, Cuyahoga OH (Cleveland), Summit OH (Akron), Franklin OH (Columbus)
- Process: Visit county auditor → Search properties → Filter by zip/city → Export CSV → Upload to CRM
- CSV should have: Owner Name, Address, City, Zip, Phone (optional), Property Value (optional)
- After import, users can enrich with phone numbers using skip tracing (costs credits)

MAJOR OHIO COUNTIES & INSTRUCTIONS:

**Cuyahoga County (Cleveland):**
Website: https://myplace.cuyahogacounty.us/
Steps:
1. Click "Property Search"
2. Select "Address" search
3. Enter zip code (e.g., 44102, 44103, 44105)
4. Click search button - returns 500-2000 properties
5. Click "Download Addresses (CSV)"

**Richland County (Mansfield):**
Website: https://richlandcountyoh.us/auditor/
Steps:
1. Go to Property Search
2. Filter by zip code (e.g., 44903, 44906)
3. Click "Export to CSV"
4. Download includes owner names, addresses, values

**Summit County (Akron):**
Website: https://fiscaloffice.summitoh.net/
Steps:
1. Property Search → Advanced
2. Filter by zip or street
3. Export results to Excel/CSV

**Franklin County (Columbus):**
Website: https://propertymax.franklincountyauditor.com/
Steps:
1. Quick Search → Advanced Options
2. Select zip codes (e.g., 43085, 43201)
3. Download property list

**General Tips:**
- After a storm, target affected zip codes
- 500-2000 properties per zip is typical
- Owner-occupied vs rental properties can be filtered
- Older buildings = more likely to need roofing work

USER QUESTION: "${input}"

INSTRUCTIONS:
- If they mention a county, provide SPECIFIC step-by-step instructions with the actual website URL
- If they ask about Cleveland/Cuyahoga, give the exact myplace.cuyahogacounty.us instructions
- If they ask "how", give the complete workflow from storm → download → import
- If asking about phone numbers, explain skip tracing enrichment (costs credits, ~$0.20/lead)
- Be conversational, helpful, and specific
- Use emojis and formatting for readability
- If they need a website link, provide it in markdown: [County Name](URL)

Provide a helpful, detailed response (2-3 paragraphs max):`,
        add_context_from_internet: false
      });

      const aiMessage = {
        role: "assistant",
        content: typeof response === 'string' ? response : JSON.stringify(response),
        timestamp: new Date().toISOString()
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error("AI Error:", error);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Sorry, I encountered an error. Please try asking your question again!",
        timestamp: new Date().toISOString()
      }]);
    }

    setIsThinking(false);
  };

  const handleQuickQuestion = (question) => {
    setInput(question);
    setTimeout(() => handleSend(), 100);
  };

  return (
    <Card className="bg-gradient-to-br from-purple-50 to-blue-50 border-purple-200 shadow-lg">
      <CardHeader 
        className="cursor-pointer hover:bg-white/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            AI Property Data Specialist
            <Badge className="bg-purple-600 text-white">Live Help</Badge>
          </CardTitle>
          <ChevronDown 
            className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          />
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleQuickQuestion("How do I get Cleveland property data?")}
              className="text-left justify-start"
            >
              <MapPin className="w-4 h-4 mr-2 flex-shrink-0" />
              Cleveland Guide
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleQuickQuestion("Show me Richland County instructions")}
              className="text-left justify-start"
            >
              <FileSpreadsheet className="w-4 h-4 mr-2 flex-shrink-0" />
              Richland County
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleQuickQuestion("How do I find storm-affected properties?")}
              className="text-left justify-start"
            >
              <MapPin className="w-4 h-4 mr-2 flex-shrink-0" />
              Storm Leads
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleQuickQuestion("How does phone number enrichment work?")}
              className="text-left justify-start"
            >
              <HelpCircle className="w-4 h-4 mr-2 flex-shrink-0" />
              Phone Lookup
            </Button>
          </div>

          {/* Chat Messages */}
          <ScrollArea className="h-[400px] border rounded-lg bg-white p-4">
            <div className="space-y-4">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg p-3 ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    {message.role === 'assistant' && (
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-4 h-4 text-purple-600" />
                        <span className="font-semibold text-sm">AI Specialist</span>
                      </div>
                    )}
                    <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                    <div className="text-xs opacity-60 mt-1">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
              
              {isThinking && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-lg p-3 max-w-[85%]">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-600 animate-pulse" />
                      <span className="text-sm">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="flex gap-2">
            <Input
              placeholder="Ask me anything about property data..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              className="flex-1"
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isThinking}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}