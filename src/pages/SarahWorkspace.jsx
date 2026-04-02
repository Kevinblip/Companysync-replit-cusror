import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload, Save, Sparkles, RefreshCw, Send, Trash2, Bug,
  Phone, MessageSquare, Activity, Clock, TrendingUp, AlertTriangle,
  PhoneIncoming, PhoneOff, PhoneOutgoing, User, Zap, PhoneForwarded, Brain,
  Copy, ExternalLink, UserPlus, ArrowRight, Plus, Edit, Megaphone, Mail, Target,
  BookOpen, CheckCircle2, XCircle, Shield, ChevronDown, ChevronUp
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";

const DEFAULT_PROMPT = `Role: You are {agent}, the Lead Qualifier and Office Manager for {brand}. You're knowledgeable about the platform and help teams solve real problems with customer management, scheduling, and support.

Personality: Conversational, helpful, and human. You're not a chatbot repeating the same lines—you actually know things and share them naturally. Never mention being AI. Vary your responses.

Core Instructions:
1. READ FROM MEMORY: Always draw from the knowledge base/website about {brand} features. Reference actual capabilities.
2. VARY YOUR GREETINGS: Don't say "I'm {agent} from {brand}" every time. Mix it up: "Hey!", "Great question!", "Happy to help!", etc.
3. BE SPECIFIC: Instead of generic answers, give concrete examples: "Yeah, {brand} lets you track tickets, create customer portals, and automate follow-ups—all from one dashboard."
4. CONVERSATION FIRST: Ask ONE clarifying question max. Don't end every message with "How can I assist?"
5. NATURAL TONE: Use contractions (you're, we're, it's). Sound like a real person, not a script.

Answer Pattern:
- Acknowledge their question naturally
- Provide a real answer (from your knowledge)
- Ask ONE follow-up if needed
- Never repeat yourself

Triage (when unclear what they want):
- Sales interest? "Sounds like you're exploring the platform. Are you looking to try it out or just learning about features?"
- Technical question? "What specifically are you trying to do? I can walk you through how it works."
- Support issue? "Got it. Let me help you with that."

Avoid These:
- "How can I assist you further today?"
- "I'm {agent} from {brand}" (repeated)
- "May I have your [info]?" (stiff)
- Generic "Here's what we do" speeches

Use placeholders: {brand}, {agent}, {calendly_link}, {triage_first}`;

import Dialer from "@/components/communication/Dialer";
import SMSDialog from "@/components/communication/SMSDialog";
import GeminiLiveClient from "@/components/ai/GeminiLiveClient";
import OpenAILiveClient from "@/components/ai/OpenAILiveClient";
import SarahVoiceSettings from "@/components/ai/SarahVoiceSettings";
import SarahPresenceSettings from "@/components/ai/SarahPresenceSettings";

function ConversationCard({ conversation, company, onCall, onSMS }) {
  return (
    <Card 
      className={conversation.isEmergency ? 'border-2 border-red-500 animate-pulse' : ''}
    >
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
              conversation.isEmergency ? 'bg-red-600' : 'bg-blue-600'
            }`}>
              <User className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">{conversation.name}</h3>
              <p className="text-sm text-gray-600">{conversation.phone}</p>
            </div>
          </div>
          
          <div className="flex flex-col items-end gap-2">
            <Badge className={conversation.isEmergency ? 'bg-red-600' : 'bg-green-600'}>
              {conversation.isEmergency ? '🚨 EMERGENCY' : '🟢 ACTIVE'}
            </Badge>
            <span className="text-xs text-gray-500">
              Last: {(() => { const d = typeof conversation.lastActivity === 'number' ? new Date(conversation.lastActivity) : new Date(String(conversation.lastActivity).endsWith('Z') ? conversation.lastActivity : conversation.lastActivity + 'Z'); return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: company?.timezone || 'America/New_York' }); })()}
            </span>
          </div>
        </div>

        <ScrollArea className="h-96 bg-gray-50 rounded-lg p-3 mb-4">
          <div className="space-y-3">
            {conversation.messages.map((msg, i) => {
              const isCall = (msg.communication_type || msg.type) === 'call';
              const transcript = msg.transcription || msg.data?.transcription || '';
              return (
                <div key={i} className="w-full">
                  {isCall ? (
                    <div className="bg-white border border-gray-200 rounded-lg p-3 text-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <Phone className="w-3 h-3 text-blue-600" />
                        <span className="text-xs font-medium text-gray-700">
                          {msg.direction === 'forwarded' ? 'Staff line call' : msg.direction === 'outbound' ? 'Outbound call' : 'Inbound call'}
                        </span>
                        <span className="text-xs text-gray-400">
                          {(() => { const ds = String(msg.created_date); const d = new Date(ds.endsWith('Z') ? ds : ds + 'Z'); return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: company?.timezone || 'America/New_York' }); })()}
                        </span>
                        {msg.duration_minutes && <span className="text-xs text-gray-400">· {Math.round(msg.duration_minutes * 10) / 10}m</span>}
                      </div>
                      {msg.ai_summary && (
                        <div className="flex items-start gap-1.5 mb-2 p-2 bg-amber-50 border border-amber-200 rounded" data-testid={`text-ai-summary-${msg.id}`}>
                          <Sparkles className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-amber-900">{msg.ai_summary}</p>
                        </div>
                      )}
                      {msg.recording_url && (
                        <div className="mb-2" data-testid={`audio-recording-${msg.id}`}>
                          <audio controls className="w-full h-8" preload="none" data-testid={`audio-player-${msg.id}`}>
                            <source src={msg.recording_url} type="audio/mpeg" />
                          </audio>
                        </div>
                      )}
                      {transcript && (
                        <details className="mt-1">
                          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">View transcript</summary>
                          <pre className="mt-1 text-xs text-gray-600 whitespace-pre-wrap max-h-32 overflow-y-auto bg-gray-50 p-2 rounded">{transcript}</pre>
                        </details>
                      )}
                      {!msg.ai_summary && !msg.recording_url && !transcript && (
                        <p className="text-xs text-gray-400 italic">Call completed · recording processing...</p>
                      )}
                    </div>
                  ) : (
                    <div className={`flex ${msg.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                        msg.direction === 'inbound' ? 'bg-white border border-gray-200' : 'bg-blue-600 text-white'
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <MessageSquare className="w-3 h-3" />
                          <span className="text-xs opacity-70">
                            {(() => { const ds = String(msg.created_date); const d = new Date(ds.endsWith('Z') ? ds : ds + 'Z'); return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: company?.timezone || 'America/New_York' }); })()}
                          </span>
                        </div>
                        <p>{msg.message}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="flex gap-2">
          <Button 
            size="sm" 
            className={conversation.isEmergency ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}
            onClick={() => onCall(conversation)}
          >
            <Phone className="w-4 h-4 mr-1" />
            Call Customer
          </Button>
          <Button 
            size="sm" 
            variant="outline"
            onClick={() => onSMS(conversation)}
          >
            <MessageSquare className="w-4 h-4 mr-1" />
            Send SMS
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickLeadCallList({ company, agentName, onCall, calling }) {
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['leads', 'new', company?.id],
    queryFn: () => company ? base44.entities.Lead.filter({ company_id: company.id, status: 'new' }, '-created_date', 10) : [],
    enabled: !!company?.id,
    refetchInterval: 30000,
  });

  const { data: outboundComms = [] } = useQuery({
    queryKey: ['communications', 'outbound', company?.id],
    queryFn: () => company ? base44.entities.Communication.filter({ company_id: company.id, direction: 'outbound' }, '-created_date', 50).then(r => r.filter(c => (c.communication_type || c.type) === 'call')) : [],
    enabled: !!company?.id,
  });

  const calledPhones = new Set(outboundComms.map(c => c.contact_phone?.replace(/\D/g, '')));
  const uncalledLeads = leads.filter(l => l.phone && !calledPhones.has(l.phone.replace(/\D/g, '')));

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading leads...</p>;
  if (uncalledLeads.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <UserPlus className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No new uncalled leads</p>
        <p className="text-xs mt-1">New leads will appear here when they come in.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[300px] overflow-y-auto">
      {uncalledLeads.map(lead => (
        <div key={lead.id} className="flex items-center justify-between p-2 border rounded-md hover-elevate">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{lead.name || 'Unknown'}</p>
            <p className="text-xs text-muted-foreground">{lead.phone}</p>
            {lead.notes && <p className="text-xs text-muted-foreground truncate">{lead.notes.substring(0, 60)}</p>}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={calling}
            onClick={() => onCall(lead)}
            data-testid={`button-call-lead-${lead.id}`}
          >
            <PhoneOutgoing className="w-3 h-3 mr-1" />
            Call
          </Button>
        </div>
      ))}
    </div>
  );
}

const DEFAULT_CAMPAIGNS = [
  {
    id: '_default_follow_up',
    name: 'General Follow-Up',
    type: 'follow_up',
    description: 'Standard follow-up call for leads who reached out about roofing services.',
    intro_script: 'Introduce yourself as {agent} from {brand} and ask if you are speaking with {lead_name}. Reference their inquiry about {lead_service} and offer to help.',
    talking_points: '1. Confirm identity\n2. Reference their inquiry\n3. Ask about the issue — storm damage, leak, age of roof\n4. Offer free inspection\n5. Schedule appointment if interested',
    goals: 'Qualify the lead, understand their roofing needs, and schedule an inspection if interested.',
    sms_template: 'Hi {lead_name}, this is {agent} from {brand}. We tried reaching you about your {lead_service} inquiry. Would you like to schedule a free inspection? Reply YES or call us back at {from_number}.',
    email_subject: 'Following Up on Your {lead_service} Inquiry - {brand}',
    email_template: 'Hi {lead_name},\n\nThis is {agent} from {brand}. We tried calling you regarding your recent inquiry about {lead_service}.\n\nWe offer free roof inspections that take about 15 minutes. Would you like to schedule one?\n\nFeel free to reply to this email or call us at {from_number}.\n\nBest regards,\n{agent}\n{brand}',
    follow_up_enabled: true,
    follow_up_sms_delay: 5,
    follow_up_email_delay: 30,
    max_follow_ups: 3,
    is_default: true,
    custom_greeting: '',
    campaign_system_prompt: '',
    tone_style: 'casual_friendly',
    humor_level: 20,
    knowledge_base: 'We offer comprehensive roofing services including inspections, repairs, and full replacements. Our inspections are completely free and typically take about 15-20 minutes. Common roof issues include missing or damaged shingles, leaks around flashing, gutter damage, and storm damage from hail or wind. We work with all major insurance companies and can help homeowners navigate the claims process.',
    example_conversations: [
      { customer: "Hi, I filled out a form online about getting my roof looked at.", sarah: "Hey there! Thanks for reaching out. I saw your inquiry come through and wanted to follow up personally. What's going on with your roof - are you seeing any specific issues or just looking for a general checkup?" },
      { customer: "We had some bad storms last week and I think there might be damage.", sarah: "I totally understand the concern - those storms were pretty rough. A lot of homeowners in your area have been calling in. The good news is we can come out for a free inspection and check everything out. Would sometime this week work for you?" }
    ],
    objection_handling: [
      { objection: "I'm not sure I need an inspection right now.", response: "I completely understand. The nice thing is our inspections are totally free and only take about 15 minutes. It's really just peace of mind to know your roof is in good shape, especially after recent weather. No pressure at all." },
      { objection: "I already have a roofer I use.", response: "That's great that you have someone you trust! We just like to offer a second opinion since our inspections are free. Sometimes a fresh set of eyes can catch things. But no worries if you're all set." },
      { objection: "How much is this going to cost me?", response: "The inspection itself is completely free - no strings attached. If we do find something that needs attention, we'll give you a detailed estimate before any work begins. And if insurance covers it, there's typically no out-of-pocket cost to you." }
    ],
    dos: [
      "Reference their original inquiry or form submission",
      "Offer a free no-obligation inspection",
      "Be friendly and conversational",
      "Ask about recent weather in their area",
      "Provide your direct callback number"
    ],
    donts: [
      "Be pushy about scheduling",
      "Make promises about what insurance will cover",
      "Rush through the conversation",
      "Use overly technical roofing terminology",
      "Forget to confirm their address"
    ],
    ai_identification: true,
    ai_identification_text: "Hi, I'm {agent}, an AI assistant for {brand}.",
    bailout_message: "I'm having a technical glitch, I'll have a human manager call you right back.",
  },
  {
    id: '_default_sedgwick',
    name: 'Sedgwick Insurance Lead',
    type: 'sedgwick',
    description: 'For leads from Sedgwick — introduce as preferred contractor, help with insurance claims.',
    intro_script: 'Introduce yourself as {agent} from {brand}, a preferred contractor for Sedgwick. Let them know you are calling because Sedgwick referred their claim to you and you are here to help with their insurance claim and inspect the damage.',
    talking_points: '1. Confirm identity — "Am I speaking with {lead_name}?"\n2. Explain Sedgwick referred their claim to you\n3. Ask about the damage — what happened, when, extent of damage\n4. Explain you handle the entire insurance claims process\n5. Schedule an inspection appointment\n6. Reassure them — no out-of-pocket costs typically with insurance claims',
    goals: 'Confirm the lead, assess damage details, explain insurance claim process, and schedule an inspection appointment.',
    sms_template: 'Hi {lead_name}, this is {agent} from {brand}. Sedgwick assigned your claim to us as their preferred contractor. We tried calling about your property damage. Please call us back at {from_number} or reply to schedule an inspection.',
    email_subject: 'Sedgwick Insurance Claim - {brand} Preferred Contractor',
    email_template: 'Hi {lead_name},\n\nThis is {agent} from {brand}. Sedgwick has assigned your insurance claim to us as their preferred contractor.\n\nWe tried reaching you by phone to discuss the damage to your property and schedule a free inspection. We handle the entire claims process so you don\'t have to worry about paperwork.\n\nPlease reply to this email or call us at {from_number} to schedule your inspection.\n\nBest regards,\n{agent}\n{brand}',
    follow_up_enabled: true,
    follow_up_sms_delay: 5,
    follow_up_email_delay: 30,
    max_follow_ups: 5,
    is_default: true,
    custom_greeting: '',
    campaign_system_prompt: '',
    tone_style: 'warm_empathetic',
    humor_level: 10,
    knowledge_base: 'Sedgwick is one of the largest claims management companies in the world. As a preferred contractor for Sedgwick, we are pre-approved to handle insurance claims for their policyholders. The claims process works as follows:\n\n1. Sedgwick receives a claim from the homeowner\'s insurance company\n2. They assign the claim to a preferred contractor (us)\n3. We contact the homeowner to schedule a free inspection\n4. We document all damage with photos and measurements\n5. We submit our findings and estimate to Sedgwick\n6. Once approved, we complete the repairs\n\nKey points for homeowners:\n- There are typically no out-of-pocket costs beyond their insurance deductible\n- We handle ALL the paperwork and communication with the insurance company\n- We are fully licensed, bonded, and insured\n- Our work is backed by manufacturer warranties\n- The inspection is completely free and takes about 30-45 minutes\n- We document everything with photos for the insurance claim\n- Homeowners should have their claim number ready if possible\n- We can work with any insurance company, not just Sedgwick referrals',
    example_conversations: [
      { customer: "Who is this? Why are you calling me?", sarah: "I completely understand the question. My name is {agent} and I'm calling from {brand}. Sedgwick - your insurance claims company - assigned your property damage claim to us because we're their preferred contractor in your area. I'm calling to help you get your damage taken care of." },
      { customer: "I didn't know Sedgwick was sending someone. What do I need to do?", sarah: "You don't need to worry about a thing. Sedgwick referred your claim to us because we're their trusted contractor. All we need to do is schedule a time for me to come out, take a look at the damage, and document everything for your claim. The inspection is completely free and we handle all the paperwork. Do you have some time this week?" },
      { customer: "Is this really going to be covered by insurance?", sarah: "That's a great question. Since Sedgwick assigned this claim to us, that means your insurance company has already acknowledged the claim. In most cases, you're only responsible for your deductible - we handle everything else directly with the insurance company. We'll document all the damage during our inspection and submit everything for approval." }
    ],
    objection_handling: [
      { objection: "I already have a contractor.", response: "I totally respect that. Just so you know, as Sedgwick's preferred contractor, we have a streamlined process with them that can speed up your claim approval. But if you're happy with your current contractor, that's completely fine. Would you like us to at least do a free second opinion inspection?" },
      { objection: "I need to check with my spouse.", response: "Of course, that makes perfect sense. This is a big decision for your home. I can call back at a time that works for both of you, or I can send you all the information by email so you can review it together. What would be easier?" },
      { objection: "How much will this cost?", response: "Since this is an insurance claim through Sedgwick, in most cases the only cost to you is your insurance deductible. We handle everything else directly with the insurance company. The inspection itself is completely free, and we don't start any work until everything is approved." },
      { objection: "I don't trust insurance companies.", response: "I hear you, and honestly that's why we're here. As Sedgwick's preferred contractor, our job is to advocate for YOU, not the insurance company. We document every bit of damage thoroughly to make sure your claim covers everything it should. We've helped hundreds of homeowners get their full claim amount." },
      { objection: "I'll wait and see.", response: "I understand wanting to take your time. Just keep in mind that most insurance claims have a deadline for filing, and some damage can get worse over time - especially if there are any leaks. Even just getting the free inspection done now gives you documentation in case you need it later. No obligation at all." }
    ],
    dos: [
      "Mention you handle the entire claims process",
      "Reassure about no out-of-pocket costs beyond deductible",
      "Be empathetic about property damage",
      "Reference Sedgwick by name",
      "Offer to explain every step of the process"
    ],
    donts: [
      "Use technical insurance jargon",
      "Rush the homeowner",
      "Guarantee specific claim amounts",
      "Pressure for immediate decisions",
      "Forget to mention you're the preferred contractor"
    ],
    ai_identification: true,
    ai_identification_text: "Hi, I'm {agent}, an AI assistant calling on behalf of {brand}, a preferred contractor for Sedgwick.",
    bailout_message: "I'm having a technical difficulty. Let me have a human team member call you right back. I apologize for the inconvenience.",
  },
  {
    id: '_default_cold_outreach',
    name: 'Cold Outreach',
    type: 'cold_outreach',
    description: 'Proactive outreach to find new leads — introduce services and gauge interest.',
    intro_script: 'Introduce yourself as {agent} from {brand}. Mention you are reaching out to homeowners in the area offering free roof inspections. Ask if they have had their roof checked recently.',
    talking_points: '1. Confirm you are speaking with the homeowner\n2. Mention you service their area\n3. Ask when their roof was last inspected\n4. Mention storm season and common damage signs\n5. Offer a free no-obligation inspection\n6. Schedule if interested, leave contact info if not',
    goals: 'Generate interest in a free roof inspection. Be friendly and not pushy. If not interested, thank them politely.',
    sms_template: 'Hi {lead_name}, this is {agent} from {brand}. We offer free roof inspections in your area. Would you like to schedule one? Reply YES or call {from_number}.',
    email_subject: 'Free Roof Inspection in Your Area - {brand}',
    email_template: 'Hi {lead_name},\n\nThis is {agent} from {brand}. We are offering free roof inspections in your neighborhood.\n\nA quick 15-minute inspection can identify potential issues before they become costly repairs, especially with recent storm activity in the area.\n\nWould you like to schedule a free, no-obligation inspection?\n\nCall us at {from_number} or reply to this email.\n\nBest regards,\n{agent}\n{brand}',
    follow_up_enabled: false,
    follow_up_sms_delay: 10,
    follow_up_email_delay: 60,
    max_follow_ups: 1,
    is_default: true,
    custom_greeting: '',
    campaign_system_prompt: '',
    tone_style: 'direct_confident',
    humor_level: 15,
    knowledge_base: 'We provide free roof inspections to homeowners in the area. Recent storm activity in the region has caused significant roof damage that many homeowners may not be aware of. Common signs of roof damage include:\n- Missing or lifted shingles\n- Granule loss (check gutters for granules)\n- Dented or damaged flashing\n- Water stains on ceilings or walls\n- Sagging areas on the roof\n\nRoof maintenance tips:\n- Have your roof inspected at least once a year\n- After any major storm, get a professional inspection\n- Most roof damage is not visible from the ground\n- Small issues can become expensive repairs if left unchecked\n- A well-maintained roof can last 25-30 years\n\nOur inspection process:\n- Completely free, no obligation\n- Takes about 15-20 minutes\n- We check shingles, flashing, gutters, vents, and overall structure\n- You receive a detailed report with photos\n- If we find damage, we can help with insurance claims',
    example_conversations: [
      { customer: "I'm not interested, my roof is fine.", sarah: "I totally get it! A lot of folks feel the same way. The tricky thing is most roof damage from storms isn't visible from the ground. Since the inspection is completely free and only takes about 15 minutes, it's really just peace of mind. But no pressure at all - can I at least leave you our number in case you ever need us?" },
      { customer: "How did you get my number?", sarah: "Great question. We're reaching out to homeowners in your neighborhood because we service your area and with the recent storm season, we wanted to make sure folks know about our free inspection offer. If you'd prefer not to hear from us, just let me know and I'll make sure we remove you from our list." }
    ],
    objection_handling: [
      { objection: "I'm on the Do Not Call list.", response: "I completely understand and I apologize for the inconvenience. I'll make sure to remove your number from our list right away. Have a great day." },
      { objection: "I'm renting, not the homeowner.", response: "Oh no worries at all! If you happen to know the property owner, we'd love to offer them a free inspection. Otherwise, have a great day and thanks for your time!" },
      { objection: "I just had my roof done recently.", response: "That's great to hear! Since it's newer, you're probably in good shape. Just keep us in mind if you ever notice anything or need a second opinion down the road. Can I leave you our number just in case?" }
    ],
    dos: [
      "Be upfront about why you're calling",
      "Mention the free inspection immediately",
      "Reference recent storms or weather in their area",
      "Respect their time and keep it brief",
      "Leave contact information even if not interested"
    ],
    donts: [
      "Be pushy or aggressive",
      "Call back if they say they're not interested",
      "Make false claims about roof damage",
      "Pressure for an immediate appointment",
      "Argue with the homeowner"
    ],
    ai_identification: true,
    ai_identification_text: "Hi, I'm {agent}, an AI assistant for {brand}.",
    bailout_message: "I'm having a technical glitch, I'll have a human manager call you right back.",
  }
];

function CampaignCard({ campaign, onEdit, onDelete, onSelect, isSelected, agentName }) {
  const typeColors = {
    follow_up: 'bg-blue-100 text-blue-800',
    sedgwick: 'bg-purple-100 text-purple-800',
    cold_outreach: 'bg-orange-100 text-orange-800',
    custom: 'bg-green-100 text-green-800',
  };
  const typeIcons = {
    follow_up: <PhoneOutgoing className="w-3 h-3" />,
    sedgwick: <Target className="w-3 h-3" />,
    cold_outreach: <Megaphone className="w-3 h-3" />,
    custom: <Sparkles className="w-3 h-3" />,
  };
  return (
    <Card
      className={`cursor-pointer transition-all ${isSelected ? 'ring-2 ring-blue-500 border-blue-500 shadow-md' : 'hover:border-gray-400'}`}
      onClick={() => onSelect(campaign)}
      data-testid={`card-campaign-${campaign.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <Badge className={typeColors[campaign.type] || typeColors.custom}>
              {typeIcons[campaign.type] || typeIcons.custom}
              <span className="ml-1 capitalize">{campaign.type?.replace(/_/g, ' ')}</span>
            </Badge>
            {isSelected && <Badge className="bg-blue-600 text-white border-0">Active</Badge>}
          </div>
          <div className="flex gap-1">
            <Button 
              size="sm" 
              variant="ghost" 
              className="h-8 w-8 p-0"
              onClick={(e) => { e.stopPropagation(); onEdit(campaign); }} 
              data-testid={`button-edit-campaign-${campaign.id}`}
            >
              <Edit className="w-3.5 h-3.5" />
            </Button>
            {!campaign.is_default && (
              <Button 
                size="sm" 
                variant="ghost" 
                className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                onClick={(e) => { e.stopPropagation(); onDelete(campaign.id); }} 
                data-testid={`button-delete-campaign-${campaign.id}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
        <h3 className="font-semibold text-sm mb-1">{campaign.name}</h3>
        <p className="text-xs text-muted-foreground line-clamp-2">{campaign.description}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {campaign.follow_up_enabled && (
            <div className="flex items-center gap-1">
              <MessageSquare className="w-3 h-3 text-green-600" />
              <span className="text-xs text-muted-foreground">SMS</span>
            </div>
          )}
          {campaign.follow_up_enabled && campaign.email_template && (
            <div className="flex items-center gap-1">
              <Mail className="w-3 h-3 text-blue-600" />
              <span className="text-xs text-muted-foreground">Email</span>
            </div>
          )}
          {(campaign.knowledge_base || campaign.example_conversations?.length > 0 || campaign.objection_handling?.length > 0 || campaign.dos?.length > 0) && (
            <div className="flex items-center gap-1">
              <Brain className="w-3 h-3 text-purple-600" />
              <span className="text-xs text-muted-foreground">Trained</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CampaignEditor({ campaign, onSave, onCancel, agentName }) {
  const [form, setForm] = useState(campaign || {
    name: '',
    type: 'custom',
    description: '',
    intro_script: '',
    talking_points: '',
    goals: '',
    sms_template: '',
    email_subject: '',
    email_template: '',
    follow_up_enabled: true,
    follow_up_sms_delay: 5,
    follow_up_email_delay: 30,
    max_follow_ups: 3,
    custom_greeting: '',
    campaign_system_prompt: '',
    tone_style: 'professional',
    humor_level: 20,
    knowledge_base: '',
    example_conversations: [],
    objection_handling: [],
    dos: [],
    donts: [],
    ai_identification: true,
    ai_identification_text: "Hi, I'm {agent}, an AI assistant for {brand}.",
    bailout_message: "I'm having a technical glitch, I'll have a human manager call you right back.",
  });
  const [showTraining, setShowTraining] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Campaign Name</Label>
          <Input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} placeholder="e.g., Sedgwick Insurance Lead" data-testid="input-campaign-name" />
        </div>
        <div>
          <Label className="text-xs">Campaign Type</Label>
          <Select value={form.type} onValueChange={(v) => setForm({...form, type: v})}>
            <SelectTrigger data-testid="select-campaign-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="follow_up">Follow-Up</SelectItem>
              <SelectItem value="sedgwick">Sedgwick / Insurance</SelectItem>
              <SelectItem value="cold_outreach">Cold Outreach</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="text-xs">Description</Label>
        <Input value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} placeholder="Brief description of this campaign" data-testid="input-campaign-description" />
      </div>
      <div>
        <Label className="text-xs">Introduction Script for {agentName}</Label>
        <Textarea value={form.intro_script} onChange={(e) => setForm({...form, intro_script: e.target.value})} placeholder="How Sarah should introduce herself on this type of call..." rows={3} data-testid="input-campaign-intro" />
        <p className="text-xs text-muted-foreground mt-1">Variables: {'{agent}'}, {'{brand}'}, {'{lead_name}'}, {'{lead_service}'}, {'{from_number}'}</p>
      </div>
      <div>
        <Label className="text-xs">Talking Points</Label>
        <Textarea value={form.talking_points} onChange={(e) => setForm({...form, talking_points: e.target.value})} placeholder="Key points Sarah should cover during the call..." rows={4} data-testid="input-campaign-talking-points" />
      </div>
      <div>
        <Label className="text-xs">Call Goals</Label>
        <Textarea value={form.goals} onChange={(e) => setForm({...form, goals: e.target.value})} placeholder="What should Sarah accomplish on this call?" rows={2} data-testid="input-campaign-goals" />
      </div>

      <div className="border-t pt-4">
        <div className="flex items-center justify-between mb-3">
          <Label className="text-sm font-medium">Auto Follow-Up (SMS & Email)</Label>
          <Switch checked={form.follow_up_enabled} onCheckedChange={(v) => setForm({...form, follow_up_enabled: v})} data-testid="switch-follow-up" />
        </div>
        {form.follow_up_enabled && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">SMS Template (sent if no answer)</Label>
              <Textarea value={form.sms_template} onChange={(e) => setForm({...form, sms_template: e.target.value})} placeholder="Hi {lead_name}, this is {agent} from {brand}..." rows={2} data-testid="input-campaign-sms" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">SMS Delay (minutes after call)</Label>
                <Input type="number" value={form.follow_up_sms_delay} onChange={(e) => setForm({...form, follow_up_sms_delay: parseInt(e.target.value) || 5})} data-testid="input-sms-delay" />
              </div>
              <div>
                <Label className="text-xs">Max Follow-Ups</Label>
                <Input type="number" value={form.max_follow_ups} onChange={(e) => setForm({...form, max_follow_ups: parseInt(e.target.value) || 3})} data-testid="input-max-followups" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Email Subject</Label>
              <Input value={form.email_subject} onChange={(e) => setForm({...form, email_subject: e.target.value})} placeholder="Following Up on Your {lead_service} Inquiry" data-testid="input-campaign-email-subject" />
            </div>
            <div>
              <Label className="text-xs">Email Template</Label>
              <Textarea value={form.email_template} onChange={(e) => setForm({...form, email_template: e.target.value})} placeholder="Hi {lead_name},\n\nThis is {agent} from {brand}..." rows={4} data-testid="input-campaign-email" />
            </div>
            <div>
              <Label className="text-xs">Email Delay (minutes after call)</Label>
              <Input type="number" value={form.follow_up_email_delay} onChange={(e) => setForm({...form, follow_up_email_delay: parseInt(e.target.value) || 30})} data-testid="input-email-delay" />
            </div>
          </div>
        )}
      </div>

      <div className="border-t pt-4">
        <Button
          variant="ghost"
          className="w-full flex items-center justify-between"
          onClick={() => setShowTraining(!showTraining)}
          data-testid="button-toggle-training"
        >
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4" />
            <span className="font-medium">Train {agentName} for This Campaign</span>
          </div>
          {showTraining ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>

        {showTraining && (
          <div className="mt-4">
            <Tabs defaultValue="greeting" className="w-full">
              <TabsList className="flex flex-wrap gap-1 h-auto">
                <TabsTrigger value="greeting" data-testid="tab-training-greeting">
                  <Shield className="w-3 h-3 mr-1" />
                  Greeting
                </TabsTrigger>
                <TabsTrigger value="prompt" data-testid="tab-training-prompt">
                  <Sparkles className="w-3 h-3 mr-1" />
                  Prompt
                </TabsTrigger>
                <TabsTrigger value="personality" data-testid="tab-training-personality">
                  <Brain className="w-3 h-3 mr-1" />
                  Personality
                </TabsTrigger>
                <TabsTrigger value="knowledge" data-testid="tab-training-knowledge">
                  <BookOpen className="w-3 h-3 mr-1" />
                  Knowledge
                </TabsTrigger>
                <TabsTrigger value="examples" data-testid="tab-training-examples">
                  <MessageSquare className="w-3 h-3 mr-1" />
                  Examples
                </TabsTrigger>
                <TabsTrigger value="objections" data-testid="tab-training-objections">
                  <Target className="w-3 h-3 mr-1" />
                  Objections
                </TabsTrigger>
                <TabsTrigger value="rules" data-testid="tab-training-rules">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Rules
                </TabsTrigger>
                <TabsTrigger value="bailout" data-testid="tab-training-bailout">
                  <PhoneOff className="w-3 h-3 mr-1" />
                  Bailout
                </TabsTrigger>
              </TabsList>

              <TabsContent value="greeting" className="space-y-4 mt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">{agentName} identifies as AI in opening</Label>
                    <p className="text-xs text-muted-foreground">When enabled, {agentName} will disclose being an AI assistant</p>
                  </div>
                  <Switch
                    checked={form.ai_identification ?? true}
                    onCheckedChange={(v) => setForm({...form, ai_identification: v})}
                    data-testid="switch-ai-identification"
                  />
                </div>
                {form.ai_identification && (
                  <div>
                    <Label className="text-xs">AI Identification Text</Label>
                    <Input
                      value={form.ai_identification_text || ''}
                      onChange={(e) => setForm({...form, ai_identification_text: e.target.value})}
                      placeholder="Hi, I'm {agent}, an AI assistant for {brand}."
                      data-testid="input-ai-identification-text"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Variables: {'{agent}'}, {'{brand}'}</p>
                  </div>
                )}
                <div>
                  <Label className="text-xs">Custom Opening Greeting</Label>
                  <Textarea
                    value={form.custom_greeting || ''}
                    onChange={(e) => setForm({...form, custom_greeting: e.target.value})}
                    placeholder={`Custom opening line for ${agentName} on this campaign type...`}
                    rows={3}
                    data-testid="input-custom-greeting"
                  />
                </div>
              </TabsContent>

              <TabsContent value="prompt" className="space-y-4 mt-4">
                <div>
                  <Label className="text-xs">Campaign System Prompt</Label>
                  <Textarea
                    value={form.campaign_system_prompt || ''}
                    onChange={(e) => setForm({...form, campaign_system_prompt: e.target.value})}
                    placeholder={`Custom system prompt for ${agentName} when running this campaign...`}
                    rows={8}
                    data-testid="input-campaign-system-prompt"
                  />
                  <p className="text-xs text-muted-foreground mt-1">This overrides the global system prompt when {agentName} is running this campaign. Leave blank to use the global prompt.</p>
                </div>
              </TabsContent>

              <TabsContent value="personality" className="space-y-6 mt-4">
                <div>
                  <Label className="text-xs">Tone & Style</Label>
                  <Select value={form.tone_style || 'professional'} onValueChange={(v) => setForm({...form, tone_style: v})}>
                    <SelectTrigger data-testid="select-tone-style"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="warm_empathetic">Warm & Empathetic</SelectItem>
                      <SelectItem value="professional">Professional</SelectItem>
                      <SelectItem value="casual_friendly">Casual & Friendly</SelectItem>
                      <SelectItem value="direct_confident">Direct & Confident</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs">Humor Level</Label>
                    <span className="text-xs text-muted-foreground">{form.humor_level ?? 20}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">Serious</span>
                    <Slider
                      value={[form.humor_level ?? 20]}
                      onValueChange={(v) => setForm({...form, humor_level: v[0]})}
                      min={0}
                      max={100}
                      step={5}
                      data-testid="slider-humor-level"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">Witty</span>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="knowledge" className="space-y-4 mt-4">
                <div>
                  <Label className="text-xs">Campaign Knowledge Base</Label>
                  <Textarea
                    value={form.knowledge_base || ''}
                    onChange={(e) => setForm({...form, knowledge_base: e.target.value})}
                    placeholder="Enter everything Sarah needs to know for this campaign type — products, processes, pricing, FAQs..."
                    rows={10}
                    data-testid="input-knowledge-base"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Teach {agentName} everything she needs to know for this campaign type</p>
                </div>
              </TabsContent>

              <TabsContent value="examples" className="space-y-4 mt-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Example Conversations</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setForm({...form, example_conversations: [...(form.example_conversations || []), { customer: '', sarah: '' }]})}
                    data-testid="button-add-example"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add Example
                  </Button>
                </div>
                {(form.example_conversations || []).map((ex, i) => (
                  <Card key={i}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary">Example {i + 1}</Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            const updated = [...(form.example_conversations || [])];
                            updated.splice(i, 1);
                            setForm({...form, example_conversations: updated});
                          }}
                          data-testid={`button-remove-example-${i}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                      <div>
                        <Label className="text-xs">Customer says:</Label>
                        <Textarea
                          value={ex.customer}
                          onChange={(e) => {
                            const updated = [...(form.example_conversations || [])];
                            updated[i] = { ...updated[i], customer: e.target.value };
                            setForm({...form, example_conversations: updated});
                          }}
                          rows={2}
                          placeholder="What the customer might say..."
                          data-testid={`input-example-customer-${i}`}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">{agentName} responds:</Label>
                        <Textarea
                          value={ex.sarah}
                          onChange={(e) => {
                            const updated = [...(form.example_conversations || [])];
                            updated[i] = { ...updated[i], sarah: e.target.value };
                            setForm({...form, example_conversations: updated});
                          }}
                          rows={2}
                          placeholder={`How ${agentName} should respond...`}
                          data-testid={`input-example-sarah-${i}`}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {(!form.example_conversations || form.example_conversations.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">No example conversations yet. Add some to help {agentName} learn your preferred style.</p>
                )}
              </TabsContent>

              <TabsContent value="objections" className="space-y-4 mt-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Objection Handling</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setForm({...form, objection_handling: [...(form.objection_handling || []), { objection: '', response: '' }]})}
                    data-testid="button-add-objection"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add Objection
                  </Button>
                </div>
                {(form.objection_handling || []).map((obj, i) => (
                  <Card key={i}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary">Objection {i + 1}</Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            const updated = [...(form.objection_handling || [])];
                            updated.splice(i, 1);
                            setForm({...form, objection_handling: updated});
                          }}
                          data-testid={`button-remove-objection-${i}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                      <div>
                        <Label className="text-xs">When they say:</Label>
                        <Textarea
                          value={obj.objection}
                          onChange={(e) => {
                            const updated = [...(form.objection_handling || [])];
                            updated[i] = { ...updated[i], objection: e.target.value };
                            setForm({...form, objection_handling: updated});
                          }}
                          rows={2}
                          placeholder="The objection or pushback..."
                          data-testid={`input-objection-${i}`}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">{agentName} should respond:</Label>
                        <Textarea
                          value={obj.response}
                          onChange={(e) => {
                            const updated = [...(form.objection_handling || [])];
                            updated[i] = { ...updated[i], response: e.target.value };
                            setForm({...form, objection_handling: updated});
                          }}
                          rows={2}
                          placeholder={`How ${agentName} should handle this...`}
                          data-testid={`input-objection-response-${i}`}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {(!form.objection_handling || form.objection_handling.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">No objection scripts yet. Add common pushbacks and how {agentName} should handle them.</p>
                )}
              </TabsContent>

              <TabsContent value="rules" className="space-y-4 mt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        <Label className="text-sm font-medium">Do's</Label>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setForm({...form, dos: [...(form.dos || []), '']})}
                        data-testid="button-add-do"
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Add
                      </Button>
                    </div>
                    {(form.dos || []).map((item, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <CheckCircle2 className="w-3 h-3 text-green-600 flex-shrink-0" />
                        <Input
                          value={item}
                          onChange={(e) => {
                            const updated = [...(form.dos || [])];
                            updated[i] = e.target.value;
                            setForm({...form, dos: updated});
                          }}
                          placeholder="Something Sarah should do..."
                          data-testid={`input-do-${i}`}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            const updated = [...(form.dos || [])];
                            updated.splice(i, 1);
                            setForm({...form, dos: updated});
                          }}
                          data-testid={`button-remove-do-${i}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                    {(!form.dos || form.dos.length === 0) && (
                      <p className="text-xs text-muted-foreground text-center py-2">No rules added yet</p>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <XCircle className="w-4 h-4 text-red-600" />
                        <Label className="text-sm font-medium">Don'ts</Label>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setForm({...form, donts: [...(form.donts || []), '']})}
                        data-testid="button-add-dont"
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Add
                      </Button>
                    </div>
                    {(form.donts || []).map((item, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <XCircle className="w-3 h-3 text-red-600 flex-shrink-0" />
                        <Input
                          value={item}
                          onChange={(e) => {
                            const updated = [...(form.donts || [])];
                            updated[i] = e.target.value;
                            setForm({...form, donts: updated});
                          }}
                          placeholder="Something Sarah should NOT do..."
                          data-testid={`input-dont-${i}`}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            const updated = [...(form.donts || [])];
                            updated.splice(i, 1);
                            setForm({...form, donts: updated});
                          }}
                          data-testid={`button-remove-dont-${i}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                    {(!form.donts || form.donts.length === 0) && (
                      <p className="text-xs text-muted-foreground text-center py-2">No rules added yet</p>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="bailout" className="space-y-4 mt-4">
                <div>
                  <Label className="text-xs">Bailout Script</Label>
                  <Textarea
                    value={form.bailout_message || ''}
                    onChange={(e) => setForm({...form, bailout_message: e.target.value})}
                    placeholder="What Sarah says if the connection drops..."
                    rows={3}
                    data-testid="input-bailout-message"
                  />
                  <p className="text-xs text-muted-foreground mt-1">What {agentName} says if the connection drops or she encounters a technical issue</p>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel-campaign">Cancel</Button>
        <Button onClick={() => onSave(form)} disabled={!form.name.trim()} data-testid="button-save-campaign">
          <Save className="w-4 h-4 mr-1" />
          Save Campaign
        </Button>
      </div>
    </div>
  );
}

function RecentOutboundCalls({ company }) {
  const { data: outboundCalls = [], isLoading } = useQuery({
    queryKey: ['communications', 'outbound-recent', company?.id],
    queryFn: () => company ? base44.entities.Communication.filter({
      company_id: company.id,
      direction: 'outbound',
      communication_type: 'call',
    }, '-created_date', 20) : [],
    enabled: !!company?.id,
    refetchInterval: 15000,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (outboundCalls.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <PhoneOutgoing className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No outbound calls yet</p>
        <p className="text-xs mt-1">Outbound calls made by {company?.name ? `${company.name}'s` : 'your'} AI assistant will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {outboundCalls.map(call => (
        <div key={call.id} className="flex items-center justify-between p-3 border rounded-md">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="flex-shrink-0">
              <PhoneOutgoing className="w-4 h-4 text-green-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{call.contact_name || 'Unknown'}</p>
              <p className="text-xs text-muted-foreground">{call.contact_phone}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-right">
              <Badge variant={call.status === 'completed' ? 'default' : 'secondary'} className="text-xs">
                {call.status || 'initiated'}
              </Badge>
              {call.duration > 0 && (
                <p className="text-xs text-muted-foreground mt-1">{Math.floor(call.duration / 60)}:{String(call.duration % 60).padStart(2, '0')}</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground whitespace-nowrap">
              {(() => {
                const ds = String(call.created_date);
                const d = new Date(ds.endsWith('Z') ? ds : ds + 'Z');
                return d.toLocaleString('en-US', {
                  month: 'short', day: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                  hour12: true,
                  timeZone: company?.timezone || 'America/New_York'
                });
              })()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SarahWorkspace() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [fileUploading, setFileUploading] = useState(false);
  const [form, setForm] = useState({
    assistant_name: "sarah",
    avatar_url: "",
    engine: "gemini-2.0-flash-exp",
    live_mode: false,
    voice_enabled: false,
    voice_id: "Polly.Joanna",
    response_speed: "normal",
    background_audio: "none",
    interim_audio: "typing", // Default to typing for new setups
    personality_assertiveness: 50,
    personality_humor: 20,
    system_prompt: DEFAULT_PROMPT,
    brand_short_name: "Companysync",
    short_sms_mode: true,
    max_sms_chars: 180,
    answer_then_ask_one: true,
    calendly_booking_url: "",
    sarah_inbound_phone: "",
    sarah_outbound_phone: "",
    triage_categories: ["leak", "missing shingles", "hail", "wind", "other"],
    triage_first_question: "What happened? (leak, missing shingles, hail, wind, other)",
    triage_followup_leak: "Is water getting in right now? Y/N",
    escalation_keywords: ["emergency", "urgent", "asap", "911", "flood", "fire"],
    intent_templates: {
      who_are_you: "I'm {agent} of {brand}. How can I help?",
      greeting: "Hi, this is {agent} of {brand}. How can I help today?",
      price: "We can help with pricing after a quick look. Want to schedule a free inspection?",
      appointment: "I can get you booked! Let me grab a couple quick details — what's your name, and what day works best for you?",
      address: "Please share the service address (street, city, zip) and I'll pull availability.",
      stop: "You're unsubscribed. Reply START to opt back in.",
      wrong_number: "Thanks for letting us know-We'll update our records.",
      smalltalk: "You're welcome! Anything else I can help with?",
      fallback: "Got it. {triage_first}"
    },
    scheduling_defaults: {
      duration_min: 45,
      buffer_min: 15,
      business_hours_start: 9,
      business_hours_end: 17,
      days_lookahead: 7,
      title_template: "Inspection - [Client Name] - [City]",
    },
    conversation_limits: {
      max_sms_turns: 10,
      max_thread_minutes: 60,
      action_at_cap: "wrapup_notify",
      cooldown_hours: 12,
      wrapup_template: "I'll hand this to our team to finish up. Expect a follow-up shortly."
    },
  });
  const [recordId, setRecordId] = useState(null);
  const [resetPhone, setResetPhone] = useState("");
  
  // Test Conversation State
  const [testPhone, setTestPhone] = useState("+15551234567");
  const [testMessage, setTestMessage] = useState("");
  const [testConversation, setTestConversation] = useState([]);
  const [testDebugInfo, setTestDebugInfo] = useState(null);
  const [voiceTestPhone, setVoiceTestPhone] = useState("");
  const [voiceTestLoading, setVoiceTestLoading] = useState(false);
  const [isActivatingThoughtly, setIsActivatingThoughtly] = useState(false);
  // Simulate Thoughtly call
  const [simCaller, setSimCaller] = useState('+15551234567');
  const [simulatingCall, setSimulatingCall] = useState(false);
  const [editingLivePhone, setEditingLivePhone] = useState(false);
  const [livePhoneDraft, setLivePhoneDraft] = useState('');
  
  // Thoughtly webhook configuration
  const [thoughtlyAgentId, setThoughtlyAgentId] = useState("xlHlPjRc");
  const [webhookConfiguring, setWebhookConfiguring] = useState(false);
  const [webhookResult, setWebhookResult] = useState(null);
  const [webhookError, setWebhookError] = useState(null);
  const [showAgentIdDialog, setShowAgentIdDialog] = useState(false);
  const [newAgentId, setNewAgentId] = useState("");
  const [thoughtlyPhone, setThoughtlyPhone] = useState("");

  // Outbound Call State
  const [outboundPhone, setOutboundPhone] = useState("");
  const [outboundName, setOutboundName] = useState("");
  const [outboundService, setOutboundService] = useState("");
  const [outboundCalling, setOutboundCalling] = useState(false);
  const [outboundResult, setOutboundResult] = useState(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState('_default_follow_up');
  const [showCampaignEditor, setShowCampaignEditor] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [leadEmail, setLeadEmail] = useState("");

  // Dialer & SMS State
  const [showDialer, setShowDialer] = useState(false);
  const [showSMS, setShowSMS] = useState(false);
  const [selectedContact, setSelectedContact] = useState({ name: "", phone: "" });

  const agentName = form.assistant_name ? form.assistant_name.charAt(0).toUpperCase() + form.assistant_name.slice(1) : "Sarah";

  const handleCallContact = (conv) => {
    setSelectedContact({ name: conv.name, phone: conv.phone });
    setShowDialer(true);
  };

  const handleSMSContact = (conv) => {
    setSelectedContact({ name: conv.name, phone: conv.phone });
    setShowSMS(true);
  };

  const { data: savedCampaigns = [], refetch: refetchCampaigns } = useQuery({
    queryKey: ['outbound-campaigns', company?.id],
    queryFn: () => company ? base44.entities.OutboundCampaign.filter({ company_id: company.id }, '-created_date', 50).catch(() => []) : [],
    enabled: !!company?.id,
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: (id) => base44.entities.OutboundCampaign.delete(id),
    onSuccess: () => {
      refetchCampaigns();
      toast.success("Campaign deleted");
      if (selectedCampaignId && !selectedCampaignId.startsWith('_default_')) {
        setSelectedCampaignId('_default_follow_up');
      }
    },
    onError: () => {
      toast.error("Failed to delete campaign");
    }
  });

  const allCampaigns = [
    ...DEFAULT_CAMPAIGNS,
    ...savedCampaigns.map(c => ({ ...c, is_default: false })),
  ];
  const selectedCampaign = allCampaigns.find(c => c.id === selectedCampaignId) || allCampaigns[0];

  const saveCampaignMutation = useMutation({
    mutationFn: async (campaignData) => {
      if (!company) return;
      const payload = { ...campaignData, company_id: company.id };
      
      // If it's a default campaign being edited for the first time, treat as create
      if (campaignData.is_default || (campaignData.id && campaignData.id.startsWith('_default_'))) {
        const { id, is_default, ...rest } = payload;
        return base44.entities.OutboundCampaign.create(rest);
      }
      
      if (campaignData.id) {
        return base44.entities.OutboundCampaign.update(campaignData.id, payload);
      } else {
        const { id, ...rest } = payload;
        return base44.entities.OutboundCampaign.create(rest);
      }
    },
    onSuccess: (data) => {
      refetchCampaigns();
      setShowCampaignEditor(false);
      setEditingCampaign(null);
      if (data?.id) {
        setSelectedCampaignId(data.id);
      }
      toast.success("Campaign saved successfully");
    },
  });

  const initiateOutboundCall = async (phone, name, service, email) => {
    if (!phone || !company) return;
    setOutboundCalling(true);
    setOutboundResult(null);
    try {
      const campaign = selectedCampaign;
      const resp = await base44.functions.invoke('sarahBridgeAPI', {
        action: 'initiateOutboundCall',
        companyId: company.id,
        data: {
          leadPhone: phone,
          leadName: name || '',
          leadService: service || '',
          leadEmail: email || leadEmail || '',
          campaignId: campaign?.id || '',
          campaignType: campaign?.type || 'follow_up',
          campaignName: campaign?.name || 'General Follow-Up',
          introScript: (campaign?.intro_script || '').substring(0, 200),
          talkingPoints: (campaign?.talking_points || '').substring(0, 200),
          callGoals: (campaign?.goals || '').substring(0, 100),
          followUpEnabled: campaign?.follow_up_enabled || false,
          smsTemplate: (campaign?.sms_template || '').substring(0, 200),
          emailSubject: (campaign?.email_subject || '').substring(0, 100),
          emailTemplate: (campaign?.email_template || '').substring(0, 200),
          followUpSmsDelay: campaign?.follow_up_sms_delay || 5,
          followUpEmailDelay: campaign?.follow_up_email_delay || 30,
          maxFollowUps: campaign?.max_follow_ups || 3,
          campaignSystemPrompt: (campaign?.campaign_system_prompt || '').substring(0, 200),
          toneStyle: campaign?.tone_style || '',
          humorLevel: campaign?.humor_level ?? 20,
          knowledgeBase: campaign?.knowledge_base || '',
          exampleConversations: campaign?.example_conversations || [],
          objectionHandling: campaign?.objection_handling || [],
          campaignDos: campaign?.dos || [],
          campaignDonts: campaign?.donts || [],
          aiIdentification: campaign?.ai_identification !== undefined ? campaign.ai_identification : true,
          aiIdentificationText: campaign?.ai_identification_text || '',
          customGreeting: campaign?.custom_greeting || '',
          bailoutMessage: campaign?.bailout_message || '',
        },
      });
      const result = resp?.data || resp;
      if (result.success) {
        setOutboundResult({ success: true, message: `Call initiated to ${phone} (${campaign?.name || 'General'})`, callSid: result.callSid });
        queryClient.invalidateQueries({ queryKey: ['communications'] });
      } else {
        setOutboundResult({ success: false, message: result.error || 'Failed to initiate call' });
      }
    } catch (err) {
      setOutboundResult({ success: false, message: err.message });
    } finally {
      setOutboundCalling(false);
    }
  };

  const configureThoughtlyWebhook = async () => {
    setWebhookConfiguring(true);
    setWebhookResult(null);
    setWebhookError(null);
    try {
      const response = await base44.functions.invoke('configureThoughtlyWebhook', {
        agent_id: thoughtlyAgentId
      });
      setWebhookResult(response.data);
    } catch (err) {
      console.error('Full error:', err);
      const d = err?.response?.data;
      const details = d?.details ?? d?.error ?? err.message ?? "Failed to configure webhook";
      setWebhookError(typeof details === 'string' ? details : JSON.stringify(details, null, 2));
    } finally {
      setWebhookConfiguring(false);
    }
  };

  const testThoughtlyConnection = async () => {
    setWebhookConfiguring(true);
    setWebhookResult(null);
    setWebhookError(null);
    try {
      const response = await base44.functions.invoke('listThoughtlyAgents', {});
      const agents = response.data?.agents || [];
      if (agents.length > 0) {
        setWebhookResult({ 
          success: true, 
          message: `✅ API Key Valid! Found ${agents.length} agent(s)`,
          agents: agents
        });
        // Auto-fill first agent ID
        if (agents[0]?.id) {
          setThoughtlyAgentId(agents[0].id);
        }
      } else {
        setWebhookResult({ 
          success: true, 
          message: `✅ API Key Valid! (No agents found)`, 
          agents: []
        });
      }
    } catch (err) {
      console.error('Connection test error:', err);
      const d = err?.response?.data;
      const details = d?.details ?? d?.error ?? err.message ?? "Unknown error";
      
      if (d?.details && (d.details.hasApiKey === false || d.details.hasTeamId === false)) {
        setWebhookError(`Missing Credentials: API Key (${d.details.hasApiKey ? 'OK' : 'Missing'}), Team ID (${d.details.hasTeamId ? 'OK' : 'Missing'}). Please check your Secrets settings.`);
      } else {
        setWebhookError('Connection Failed: ' + (typeof details === 'string' ? details : JSON.stringify(details)));
      }
    } finally {
      setWebhookConfiguring(false);
    }
  };

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const { data: twilioSettings = [] } = useQuery({
    queryKey: ["twilio-settings", company?.id],
    queryFn: () => company ? base44.entities.TwilioSettings.filter({ company_id: company.id }, "-updated_date", 50) : [],
    enabled: !!company,
    initialData: [],
  });

  const twilioConfig = React.useMemo(() => {
  if (!twilioSettings?.length) return null;
  // Prefer the active Thoughtly config first, then any record with a thoughtly_phone, else most recent
  return (
    twilioSettings.find(s => s.use_thoughtly_ai === true) ||
    twilioSettings.find(s => !!s.thoughtly_phone) ||
    twilioSettings[0]
  );
}, [twilioSettings]);

  const timeZone = React.useMemo(() => {
    return company?.timezone || 'America/New_York';
  }, [company]);

  useEffect(() => {
    if (!user || companies.length === 0) return;
    const owned = companies.find((c) => c.created_by === user.email);
    setCompany(owned || companies[0]);
  }, [user, companies]);

  useEffect(() => {
    // Keep phone and agent ID state in sync with Twilio config
    // When not editing, we want to reflect the latest saved value
    if (twilioConfig?.thoughtly_phone) {
      setThoughtlyPhone(twilioConfig.thoughtly_phone);
    } else if (twilioConfig?.main_phone_number) {
      setThoughtlyPhone(twilioConfig.main_phone_number);
    }

    if (twilioConfig?.thoughtly_agent_id) {
      setThoughtlyAgentId(twilioConfig.thoughtly_agent_id);
    }
  }, [twilioConfig]);

  // Load existing settings
  useQuery({
    queryKey: ["assistant-settings-sarah", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      let rows = await base44.entities.AssistantSettings.filter({ company_id: company.id }, '-updated_date', 10);
      const rec = rows[0];
      if (rec) {
        setRecordId(rec.id);
        setForm({
          assistant_name: rec.assistant_name || "sarah",
          avatar_url: rec.avatar_url || "",
          engine: rec.engine || "gemini-2.5-flash",
          live_mode: !!rec.live_mode,
          voice_enabled: !!rec.voice_enabled,
          // Ensure we don't load old ElevenLabs IDs into the UI
          voice_id: rec.voice_id || "Polly.Joanna",
          response_speed: rec.response_speed || "normal",
          system_prompt: rec.system_prompt || DEFAULT_PROMPT,
          background_audio: rec.background_audio || "none",
          interim_audio: rec.interim_audio || "none",
          personality_assertiveness: rec.personality_assertiveness ?? 50,
          personality_humor: rec.personality_humor ?? 20,
          brand_short_name: rec.brand_short_name || "",
          short_sms_mode: rec.short_sms_mode ?? true,
          max_sms_chars: rec.max_sms_chars ?? 180,
          answer_then_ask_one: rec.answer_then_ask_one ?? true,
          calendly_booking_url: rec.calendly_booking_url || "",
          sarah_outbound_phone: rec.sarah_outbound_phone || "",
          sarah_inbound_phone: rec.sarah_inbound_phone || "",
          triage_categories: rec.triage_categories?.length ? rec.triage_categories : ["leak", "missing shingles", "hail", "wind", "other"],
          triage_first_question: rec.triage_first_question || "What happened? (leak, missing shingles, hail, wind, other)",
          triage_followup_leak: rec.triage_followup_leak || "Is water getting in right now? Y/N",
          escalation_keywords: rec.escalation_keywords?.length ? rec.escalation_keywords : ["emergency", "urgent", "asap", "911", "flood", "fire"],
          intent_templates: rec.intent_templates || form.intent_templates,
          scheduling_defaults: rec.scheduling_defaults || form.scheduling_defaults,
          conversation_limits: rec.conversation_limits || form.conversation_limits,
        });
      }
      return rows;
    },
  });

  // Fetch communications for active conversations
  const { data: activeComms = [] } = useQuery({
    queryKey: ['active-communications', company?.id],
    queryFn: async () => {
      if (!company) return [];
      // Fetch more history (1000 items) to show context
      const all = await base44.entities.Communication.filter({
        company_id: company.id
      }, "-created_date", 1000);
      
      const relevant = all.filter(c => {
        const t = c.communication_type || c.type;
        return t === 'call' || t === 'sms' || t === 'whatsapp';
      });
      
      // Identify participants active in the last 24 hours
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).getTime();
      const activeParticipants = new Set();
      
      relevant.forEach(c => {
        if (new Date(c.created_date).getTime() > twentyFourHoursAgo) {
          activeParticipants.add(c.contact_phone || c.contact_email);
        }
      });

      // Return ALL messages for active participants (showing full history from the fetched batch)
      return relevant.filter(c => activeParticipants.has(c.contact_phone || c.contact_email));
    },
    enabled: !!company,
    initialData: [],
    refetchInterval: 10000
  });

  // Fetch today's stats
  const { data: todayComms = [] } = useQuery({
    queryKey: ['today-communications', company?.id],
    queryFn: async () => {
      if (!company) return [];
      const all = await base44.entities.Communication.filter({
        company_id: company.id
      }, "-created_date", 1000);
      
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      
      return all.filter(c => new Date(c.created_date) >= todayStart);
    },
    enabled: !!company,
    initialData: [],
    refetchInterval: 10000
  });

  const stats = React.useMemo(() => {
    const calls = todayComms.filter(c => (c.communication_type || c.type) === 'call');
    const inboundCalls = calls.filter(c => c.direction === 'inbound');
    const totalCallMinutes = calls.reduce((sum, c) => sum + (c.duration_minutes || 0), 0);
    const emergencyCalls = calls.filter(c => c.outcome === 'emergency' || c.intent === 'emergency');
    
    return {
      totalCalls: calls.length,
      inboundCalls: inboundCalls.length,
      totalSMS: todayComms.filter(c => (c.communication_type || c.type) === 'sms' || (c.communication_type || c.type) === 'whatsapp').length,
      avgCallDuration: calls.length > 0 ? totalCallMinutes / calls.length : 0,
      emergencies: emergencyCalls.length,
      aiHandled: calls.filter(c => c.message?.includes('Sarah') || c.message?.includes(agentName) || c.ai_analyzed).length
    };
  }, [todayComms]);

  const activeByPhone = React.useMemo(() => {
    const grouped = {};
    activeComms.forEach(comm => {
      const key = comm.contact_phone || comm.contact_email;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(comm);
    });
    return Object.entries(grouped).map(([phone, comms]) => ({
      phone,
      name: comms[0].contact_name || 'Unknown',
      messages: comms.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)),
      isEmergency: comms.some(c => c.outcome === 'emergency' || c.intent === 'emergency'),
      lastActivity: Math.max(...comms.map(c => new Date(c.created_date).getTime()))
    })).sort((a, b) => b.lastActivity - a.lastActivity);
  }, [activeComms]);

  const resetConversationMutation = useMutation({
    mutationFn: async (phone) => {
      return await base44.functions.invoke('resetSarahConversation', { phone_number: phone });
    },
    onSuccess: (data) => {
      alert(`✅ ${data.data?.message || 'Conversation reset!'}`);
      setResetPhone("");
    },
    onError: (error) => {
      alert(`❌ ${error.message || 'Reset failed'}`);
    }
  });

  const testSarahMutation = useMutation({
    mutationFn: async ({ phone, message }) => {
      const response = await base44.functions.invoke('testSarahConversation', {
        phone_number: phone,
        message: message,
        company_id: company?.id
      });
      return response.data || response;
    },
    onSuccess: (data) => {
      setTestConversation(prev => [
        ...prev,
        { role: 'customer', message: testMessage, timestamp: new Date().toISOString() },
        { role: 'sarah', message: data.response, timestamp: new Date().toISOString() }
      ]);
      setTestDebugInfo(data.debug);
      setTestMessage("");
    },
    onError: (error) => {
      setTestConversation(prev => [
        ...prev,
        { role: 'customer', message: testMessage, timestamp: new Date().toISOString() },
        { role: 'error', message: error.message || 'Test failed', timestamp: new Date().toISOString() }
      ]);
      setTestMessage("");
    }
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        company_id: company?.id,
        ...form,
      };
      console.log('[SarahWorkspace] Saving settings, recordId:', recordId, 'assistant_name:', payload.assistant_name, 'brand_short_name:', payload.brand_short_name);
      if (recordId) {
        await base44.entities.AssistantSettings.update(recordId, payload);
        console.log('[SarahWorkspace] Updated record', recordId, 'with assistant_name:', payload.assistant_name);
        return { updated: true };
      } else {
        const created = await base44.entities.AssistantSettings.create(payload);
        setRecordId(created.id);
        console.log('[SarahWorkspace] Created new record', created.id, 'with assistant_name:', payload.assistant_name);
        return { created: true };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assistant-settings-sarah", company?.id] });
      alert(`Sarah's settings saved successfully! Changes will take effect on the next call.`);
    },
    onError: (error) => {
      console.error('Save error:', error);
      alert(`Failed to save settings: ${error?.message || 'Unknown error'}`);
    },
  });

  const testVoice = async () => {
    // Check for Twilio/Polly voices
    if (form.voice_id && form.voice_id.startsWith('Polly.')) {
      const phone = prompt("📞 Call Me to Test Voice\n\nEnter your phone number to receive a quick test call with this voice:", user?.phone || "");
      
      if (!phone) return;

      try {
        alert(" Initiating call to " + phone + "...");
        const res = await base44.functions.invoke('testVoiceCall', {
          to: phone,
          voice_id: form.voice_id,
          text: "Hi! This is " + agentName + " from " + (form.brand_short_name || "our company") + ". I am testing my new voice settings. If you like this voice, go ahead and save the settings.",
          company_id: company?.id
        });
        
        if (res.data.success) {
          alert("✅ Calling you now! Pick up to hear the voice.");
        } else {
          throw new Error(res.data.error);
        }
      } catch (err) {
        alert("❌ Test call failed: " + err.message);
      }
      return;
    }

    try {
      alert('🔊 Testing voice...');
      
      // Use ElevenLabs for other voices
      const response = await base44.functions.invoke('elevenLabsSpeak', {
        text: "Hi! I'm " + agentName + " from " + (form.brand_short_name || "our company") + ". This is how I sound.",
        voiceId: form.voice_id
      });

      let audioBlob;
      if (response.data?.audio_url) {
        const res = await fetch(response.data.audio_url);
        audioBlob = await res.blob();
      } else if (response.data instanceof Blob) {
        audioBlob = response.data;
      } else if (response.data instanceof ArrayBuffer) {
        audioBlob = new Blob([response.data], { type: 'audio/mpeg' });
      } else {
        throw new Error('Invalid audio format');
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      await audio.play();
      alert('✅ Voice test played!');
    } catch (error) {
      alert('❌ Voice test failed: ' + error.message);
    }
  };

  const twilioVoices = [
    { id: "Polly.Joanna", name: "Joanna (US Female - Professional)" },
    { id: "Polly.Salli", name: "Salli (US Female - Energetic)" },
    { id: "Polly.Kimberly", name: "Kimberly (US Female - Cheerful)" },
    { id: "Polly.Kendra", name: "Kendra (US Female - Mature)" },
    { id: "Polly.Ivy", name: "Ivy (US Child - Young)" },
    { id: "Polly.Matthew", name: "Matthew (US Male - Professional)" },
    { id: "Polly.Joey", name: "Joey (US Male - Energetic)" },
    { id: "Polly.Justin", name: "Justin (US Male - Young)" },
    { id: "Polly.Amy", name: "Amy (UK Female)" },
    { id: "Polly.Emma", name: "Emma (UK Female)" },
    { id: "Polly.Brian", name: "Brian (UK Male)" }
  ];

  const handleFile = async (file) => {
    if (!file) return;
    setFileUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setForm((f) => ({ ...f, avatar_url: file_url }));
    } finally {
      setFileUploading(false);
    }
  };

  const handleTestSend = () => {
    if (!testMessage.trim()) return;
    testSarahMutation.mutate({ phone: testPhone, message: testMessage });
  };

  const clearTestConversation = () => {
    setTestConversation([]);
    setTestDebugInfo(null);
  };

  const simulateThoughtlyCall = async () => {
    const toNumber = thoughtlyPhone || twilioConfig?.thoughtly_phone || twilioConfig?.main_phone_number;
    if (!toNumber) {
      alert('❌ Please set the Thoughtly Phone first.');
      return;
    }
    try {
      setSimulatingCall(true);
      const payload = {
        data: {
          type: 'NEW_RESPONSE',
          from: simCaller,
          to: toNumber,
          agent_id: thoughtlyAgentId || twilioConfig?.thoughtly_agent_id,
          customer_name: 'Test Caller',
          transcript: 'This is a simulated test call from Sarah Workspace.',
          intent: 'test_call',
          duration: 60
        }
      };
      const res = await base44.functions.invoke('thoughtlyWebhook', payload);
      const ok = res?.data?.success !== false;
      alert(ok ? '✅ Simulated call logged. Check Active Conversations and Communication.' : ('❌ Simulation failed: ' + (res?.data?.error || 'Unknown error')));
    } catch (e) {
      alert('❌ Simulation error: ' + (e.message || 'Unknown'));
    } finally {
      setSimulatingCall(false);
    }
  };

  const onChange = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const onSchedChange = (key, value) => setForm((f) => ({ ...f, scheduling_defaults: { ...f.scheduling_defaults, [key]: value } }));
  const onConvChange = (key, value) => setForm((f) => ({ ...f, conversation_limits: { ...f.conversation_limits, [key]: value } }));

  const updateAgentIdMutation = useMutation({
    mutationFn: async (agentId) => {
      if (!company?.id) throw new Error('Company ID missing');
      const response = await base44.functions.invoke('configureThoughtlyWebhook', {
        agent_id: agentId,
        company_id: company.id
      });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['twilio-settings'] });
      setShowAgentIdDialog(false);
      setNewAgentId("");
      alert('✅ Agent ID updated and webhook configured!');
    },
    onError: (error) => {
      console.error(error);
      const msg = error?.response?.data?.error || error.message || "Failed to update";
      alert('❌ Failed to update: ' + msg);
    }
  });

  const handleActivateThoughtly = async () => {
    if (!company?.id) {
      alert('❌ Company not found');
      return;
    }

    // Step 1: Get Agent ID
    const agentId = prompt("Please enter your Thoughtly Agent ID (e.g., xlHlPjRc):", thoughtlyAgentId || "");
    if (!agentId) return;

    // Step 2: Get Thoughtly Phone Number
    const thoughtlyNum = prompt("Please enter the Thoughtly Agent Phone Number (e.g., +1888...):\n\n⚠️ IMPORTANT: This must be the number Thoughtly assigned to your agent, NOT your Twilio number.", thoughtlyPhone || "");
    if (!thoughtlyNum) return;

    if (twilioConfig?.main_phone_number && thoughtlyNum.replace(/\D/g, '') === twilioConfig.main_phone_number.replace(/\D/g, '')) {
      alert("❌ Error: The Thoughtly Phone Number cannot be the same as your Twilio Number.\n\nPlease enter the forwarding number provided by Thoughtly.");
      return;
    }

    setIsActivatingThoughtly(true);
    try {
      // Use configureThoughtlyWebhook to link agent and set forwarding number
      const response = await base44.functions.invoke('configureThoughtlyWebhook', {
        agent_id: agentId,
        company_id: company.id,
        phone_number: thoughtlyNum 
      });

      const data = response.data;

      if (data.success) {
         alert(`✅ Thoughtly agent linked successfully!\n\nCalls to your Twilio number will now forward to Thoughtly (${thoughtlyNum}).`);
         setThoughtlyAgentId(agentId);
         setThoughtlyPhone(thoughtlyNum);
         queryClient.invalidateQueries({ queryKey: ["twilio-settings"] });
         queryClient.invalidateQueries({ queryKey: ["assistant-settings-sarah"] });
      } else {
         alert('❌ Failed: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error(error);
      const msg = error?.response?.data?.error || error.message || "Unknown error";
      alert('❌ Error: ' + msg);
    } finally {
      setIsActivatingThoughtly(false);
    }
  };

  return (
    <>
      <Dialog open={showAgentIdDialog} onOpenChange={setShowAgentIdDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Thoughtly Agent ID</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Agent ID</Label>
              <Input
                value={newAgentId}
                onChange={(e) => setNewAgentId(e.target.value)}
                placeholder="e.g., e25d96bd-a768-40eb-a330-b0e8e3ade0b8"
                className="mt-2"
              />
              <p className="text-xs text-gray-500 mt-2">
                Get your Agent ID from Thoughtly dashboard
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAgentIdDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => updateAgentIdMutation.mutate(newAgentId)}
                disabled={!newAgentId.trim() || updateAgentIdMutation.isPending}
                className="bg-green-600 hover:bg-green-700"
              >
                {updateAgentIdMutation.isPending ? "Updating..." : "Update"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="p-6 space-y-6 bg-gradient-to-br from-blue-50 to-purple-50 min-h-screen">
      <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-3">
          {form.avatar_url && (
            <img src={form.avatar_url} alt={agentName} className="w-16 h-16 rounded-full object-cover border-4 border-white shadow-lg" />
          )}
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{agentName} Workspace</h1>
            <p className="text-gray-600">Sales Assistant • Lead Qualifier • Follow-up</p>
          </div>
        </div>
      </div>
      <Badge className="bg-blue-600 text-white">Active</Badge>
      </div>

      {/* SOFT-HIDDEN: Thoughtly Status Banner - disabled platform-wide */}

      <Tabs defaultValue="live" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="live" data-testid="tab-live">Live Dashboard</TabsTrigger>
          <TabsTrigger value="outbound" data-testid="tab-outbound">Campaigns</TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-performance">Performance</TabsTrigger>
          <TabsTrigger value="test" data-testid="tab-test">Test & Debug</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
        </TabsList>

        {/* Live Dashboard Tab */}
        <TabsContent value="live" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Active Conversations (Today)</h2>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-gray-600">Live</span>
            </div>
          </div>

          {activeByPhone.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-gray-500">
                <PhoneOff className="w-16 h-16 mx-auto mb-3 text-gray-300" />
                <p className="font-medium">No active conversations</p>
                <p className="text-sm mt-1">When calls or messages come in, they'll appear here</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {activeByPhone.map((conversation, idx) => (
                <ConversationCard 
                  key={idx}
                  conversation={conversation}
                  company={company}
                  onCall={handleCallContact}
                  onSMS={handleSMSContact}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Outbound Calls Tab */}
        <TabsContent value="outbound" className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <PhoneOutgoing className="w-5 h-5 text-green-600" />
                Outbound Campaigns
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Choose a campaign mode and have {agentName} call, text, and email leads automatically.
              </p>
            </div>
            <Button size="sm" onClick={() => { setEditingCampaign(null); setShowCampaignEditor(true); }} data-testid="button-new-campaign">
              <Plus className="w-4 h-4 mr-1" />
              New Campaign
            </Button>
          </div>

          {showCampaignEditor && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {editingCampaign ? `Edit: ${editingCampaign.name}` : 'Create New Campaign'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CampaignEditor
                  campaign={editingCampaign}
                  agentName={agentName}
                  onSave={(data) => saveCampaignMutation.mutate(data)}
                  onCancel={() => { setShowCampaignEditor(false); setEditingCampaign(null); }}
                />
              </CardContent>
            </Card>
          )}

          <div>
            <Label className="text-xs font-medium mb-2 block">Select Campaign Mode</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {allCampaigns.map(c => (
                <CampaignCard
                  key={c.id}
                  campaign={c}
                  isSelected={selectedCampaignId === c.id}
                  agentName={agentName}
                  onSelect={(camp) => setSelectedCampaignId(camp.id)}
                  onEdit={(camp) => { setEditingCampaign(camp); setShowCampaignEditor(true); }}
                  onDelete={(id) => {
                    if (confirm("Are you sure you want to delete this campaign?")) {
                      deleteCampaignMutation.mutate(id);
                    }
                  }}
                />
              ))}
            </div>
          </div>

          {selectedCampaign && (
            <Card className="border-blue-200 bg-blue-50/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4 text-blue-600" />
                  Active: {selectedCampaign.name}
                </CardTitle>
                <CardDescription className="text-xs">{selectedCampaign.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <p><strong>Sarah will:</strong> {selectedCampaign.intro_script?.replace(/\{agent\}/g, agentName).replace(/\{brand\}/g, form.brand_short_name || 'your company').substring(0, 200)}...</p>
                {selectedCampaign.follow_up_enabled && (
                  <p className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> SMS after {selectedCampaign.follow_up_sms_delay}min
                    {selectedCampaign.email_template && <><Mail className="w-3 h-3 ml-2" /> Email after {selectedCampaign.follow_up_email_delay}min</>}
                    {' · '} Up to {selectedCampaign.max_follow_ups} follow-ups
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  Outbound Call
                </CardTitle>
                <CardDescription className="text-xs">
                  Enter lead details and {agentName} will call using the <strong>{selectedCampaign?.name || 'selected'}</strong> campaign script.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs">Phone Number *</Label>
                  <Input
                    placeholder="+1 (555) 123-4567"
                    value={outboundPhone}
                    onChange={(e) => setOutboundPhone(e.target.value)}
                    data-testid="input-outbound-phone"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Lead Name</Label>
                    <Input
                      placeholder="John Smith"
                      value={outboundName}
                      onChange={(e) => setOutboundName(e.target.value)}
                      data-testid="input-outbound-name"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Email (for follow-up)</Label>
                    <Input
                      placeholder="john@example.com"
                      value={leadEmail}
                      onChange={(e) => setLeadEmail(e.target.value)}
                      data-testid="input-outbound-email"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Service Interest / Notes</Label>
                  <Input
                    placeholder="Roof inspection, hail damage, insurance claim, etc."
                    value={outboundService}
                    onChange={(e) => setOutboundService(e.target.value)}
                    data-testid="input-outbound-service"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!outboundPhone || outboundCalling}
                  onClick={() => initiateOutboundCall(outboundPhone, outboundName, outboundService, leadEmail)}
                  data-testid="button-initiate-outbound"
                >
                  {outboundCalling ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <PhoneOutgoing className="w-4 h-4 mr-2" />
                  )}
                  {outboundCalling ? 'Initiating...' : `Call with ${agentName} — ${selectedCampaign?.name || 'General'}`}
                </Button>

                {outboundResult && (
                  <Alert variant={outboundResult.success ? "default" : "destructive"} className="mt-2">
                    <AlertDescription className="text-sm">
                      {outboundResult.message}
                      {outboundResult.callSid && (
                        <span className="block text-xs text-muted-foreground mt-1">Call SID: {outboundResult.callSid}</span>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <UserPlus className="w-4 h-4" />
                  Quick Call from Leads
                </CardTitle>
                <CardDescription className="text-xs">
                  New leads that haven't been called yet. Uses the <strong>{selectedCampaign?.name || 'selected'}</strong> campaign.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {company ? (
                  <QuickLeadCallList
                    company={company}
                    agentName={agentName}
                    onCall={(lead) => {
                      setOutboundPhone(lead.phone);
                      setOutboundName(lead.name || '');
                      setOutboundService(lead.notes?.match(/Service: (.+)/)?.[1] || '');
                      setLeadEmail(lead.email || '');
                      initiateOutboundCall(lead.phone, lead.name, lead.notes?.match(/Service: (.+)/)?.[1] || '', lead.email || '');
                    }}
                    calling={outboundCalling}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Loading company data...</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Recent Outbound Calls
              </CardTitle>
            </CardHeader>
            <CardContent>
              {company ? (
                <RecentOutboundCalls company={company} />
              ) : (
                <p className="text-sm text-muted-foreground">Loading...</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Phone className="w-4 h-4 text-blue-600" />
                  <span className="text-xs text-gray-600">Total Calls</span>
                </div>
                <div className="text-2xl font-bold">{stats.totalCalls}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <PhoneIncoming className="w-4 h-4 text-green-600" />
                  <span className="text-xs text-gray-600">Inbound</span>
                </div>
                <div className="text-2xl font-bold text-green-700">{stats.inboundCalls}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="w-4 h-4 text-purple-600" />
                  <span className="text-xs text-gray-600">SMS</span>
                </div>
                <div className="text-2xl font-bold text-purple-700">{stats.totalSMS}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs text-gray-600">Avg Duration</span>
                </div>
                <div className="text-2xl font-bold text-indigo-700">
                  {stats.avgCallDuration.toFixed(1)}m
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-yellow-600" />
                  <span className="text-xs text-gray-600">AI Handled</span>
                </div>
                <div className="text-2xl font-bold text-yellow-700">{stats.aiHandled}</div>
              </CardContent>
            </Card>

            <Card className="bg-red-50 border-red-200">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <span className="text-xs text-red-600">Emergencies</span>
                </div>
                <div className="text-2xl font-bold text-red-700">{stats.emergencies}</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                  AI Performance Today
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Answer Rate</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-green-500"
                        style={{ 
                          width: `${stats.inboundCalls > 0 ? (stats.aiHandled / stats.inboundCalls * 100) : 0}%` 
                        }}
                      />
                    </div>
                    <span className="text-sm font-semibold">
                      {stats.inboundCalls > 0 ? ((stats.aiHandled / stats.inboundCalls * 100).toFixed(0)) : 0}%
                    </span>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Avg Handle Time</span>
                  <span className="text-sm font-semibold">{stats.avgCallDuration.toFixed(1)} min</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Total Volume</span>
                  <span className="text-sm font-semibold">{stats.totalCalls} calls</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">SMS Responses</span>
                  <span className="text-sm font-semibold">{stats.totalSMS}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-purple-600" />
                  Quick Stats
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="p-3 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg">
                  <div className="text-sm text-blue-700 font-medium mb-1">AI Automation Rate</div>
                  <div className="text-2xl font-bold text-blue-900">
                    {stats.inboundCalls > 0 ? ((stats.aiHandled / stats.inboundCalls * 100).toFixed(0)) : 0}%
                  </div>
                  <p className="text-xs text-blue-600 mt-1">
                    {stats.aiHandled} of {stats.inboundCalls} calls handled by {agentName}
                  </p>
                </div>

                <div className={`p-3 rounded-lg ${
                  stats.emergencies > 0 
                    ? 'bg-gradient-to-r from-red-50 to-red-100' 
                    : 'bg-gradient-to-r from-green-50 to-green-100'
                }`}>
                  <div className={`text-sm font-medium mb-1 ${
                    stats.emergencies > 0 ? 'text-red-700' : 'text-green-700'
                  }`}>
                    Emergency Calls
                  </div>
                  <div className={`text-2xl font-bold ${
                    stats.emergencies > 0 ? 'text-red-900' : 'text-green-900'
                  }`}>
                    {stats.emergencies}
                  </div>
                  <p className={`text-xs mt-1 ${
                    stats.emergencies > 0 ? 'text-red-600' : 'text-green-600'
                  }`}>
                    {stats.emergencies > 0 ? 'Requires immediate attention' : 'No emergencies today'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Test & Debug Tab */}
        <TabsContent value="test" className="space-y-6">
          <Card className="bg-purple-50 border-purple-200">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bug className="w-5 h-5 text-purple-600" />
                  <CardTitle>Test Sarah Conversation</CardTitle>
                </div>
                <Button variant="ghost" size="sm" onClick={clearTestConversation} className="text-purple-600">
                  <Trash2 className="w-4 h-4 mr-1" /> Clear
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 mb-4">
                Simulate a customer SMS conversation to test Sarah's responses and see debug info.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-lg border p-4">
                  <Input 
                    placeholder="Test Phone: +15551234567" 
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    className="mb-3"
                  />
                  
                  <ScrollArea className="h-64 mb-3 pr-2">
                    <div className="space-y-3">
                      {testConversation.length === 0 && (
                        <p className="text-center text-gray-400 text-sm py-8">
                          Send a test message to start...
                        </p>
                      )}
                      {testConversation.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'customer' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                            msg.role === 'customer' ? 'bg-blue-500 text-white' :
                            msg.role === 'sarah' ? 'bg-gray-100 text-gray-900' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {msg.role === 'sarah' && <span className="font-semibold text-purple-600">{agentName}: </span>}
                            {msg.message}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  
                  <div className="flex gap-2">
                    <Input 
                      placeholder="Type a test message..." 
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleTestSend()}
                      disabled={testSarahMutation.isPending}
                    />
                    <Button 
                      onClick={handleTestSend}
                      disabled={!testMessage.trim() || testSarahMutation.isPending}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      {testSarahMutation.isPending ? "..." : <Send className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                
                <div className="bg-gray-900 rounded-lg p-4 text-xs font-mono">
                  <div className="flex items-center gap-2 mb-3 text-gray-400">
                    <Bug className="w-4 h-4" />
                    <span>Debug Info</span>
                  </div>
                  <ScrollArea className="h-72">
                    {testDebugInfo ? (
                      <div className="space-y-2 text-gray-300">
                        <div>
                          <span className="text-purple-400">Contact:</span> {testDebugInfo.contactName || 'Unknown'}
                          {testDebugInfo.isNewContact && <Badge className="ml-2 bg-green-600">NEW</Badge>}
                        </div>
                        <div>
                          <span className="text-purple-400">Lead Info:</span>
                          <pre className="mt-1 text-green-400 whitespace-pre-wrap text-xs">
                            {JSON.stringify(testDebugInfo.extractedInfo, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <span className="text-purple-400">Missing:</span>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {testDebugInfo.missingInfo?.map(m => (
                              <Badge key={m} variant="outline" className="text-yellow-400 border-yellow-400">{m}</Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-gray-500">Send a message to see debug info...</p>
                    )}
                  </ScrollArea>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-blue-50 border-blue-200">
            <CardHeader>
              <div className="flex items-center gap-3">
                <RefreshCw className="w-5 h-5 text-blue-600" />
                <CardTitle>Reset Conversation Cap</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 mb-4">
                If {agentName} stopped responding due to hitting the conversation limit, reset it here.
              </p>
              <div className="flex gap-3">
                <Input 
                  placeholder="+1234567890" 
                  value={resetPhone}
                  onChange={(e) => setResetPhone(e.target.value)}
                  className="max-w-xs"
                />
                <Button 
                  onClick={() => resetConversationMutation.mutate(resetPhone)}
                  disabled={!resetPhone || resetConversationMutation.isPending}
                >
                  <RefreshCw className="w-4 h-4 mr-1" />
                  {resetConversationMutation.isPending ? "Resetting..." : "Reset"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* SOFT-HIDDEN: Thoughtly Webhook Configuration - disabled platform-wide */}
          {/* SOFT-HIDDEN: Simulate Thoughtly Call - disabled platform-wide */}

          <Card className="bg-pink-50 border-pink-200">
            <CardHeader>
              <div className="flex items-center gap-3">
                <Phone className="w-5 h-5 text-pink-600" />
                <CardTitle>📞 Test Sarah Voice Call</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-600">Twilio will call you to hear Sarah's voice in action.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div className="md:col-span-2">
                  <Label>Your Phone Number</Label>
                  <Input 
                    value={voiceTestPhone} 
                    onChange={(e) => setVoiceTestPhone(e.target.value)} 
                    placeholder="+12165551234" 
                    className="mt-1"
                  />
                </div>
                <Button 
                  onClick={async () => {
                    if (!voiceTestPhone.trim()) {
                      alert('Please enter a phone number');
                      return;
                    }
                    try {
                      setVoiceTestLoading(true);
                      const res = await base44.functions.invoke('testSarahVoiceCall', {
                        phone_number: voiceTestPhone,
                        company_id: company?.id
                      });
                      if (res.data?.success) {
                        alert(`✅ Calling ${voiceTestPhone} with Sarah's voice...`);
                      } else {
                        alert('❌ ' + (res.data?.error || 'Failed to initiate call'));
                      }
                    } catch (e) {
                      alert('❌ Error: ' + (e.message || 'Unknown error'));
                    } finally {
                      setVoiceTestLoading(false);
                    }
                  }}
                  disabled={voiceTestLoading}
                  className="bg-pink-600 hover:bg-pink-700"
                >
                  {voiceTestLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Calling...
                    </>
                  ) : (
                    <>
                      <Phone className="w-4 h-4 mr-2" />
                      Call Me Now
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-pink-700">You'll receive a call with Sarah's configured voice</p>
            </CardContent>
          </Card>

          {(twilioConfig?.thoughtly_agent_id || twilioConfig?.main_phone_number) && (
            <Card className="bg-green-50 border-green-200">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Phone className="w-5 h-5 text-green-600" />
                  <CardTitle>📞 Test Live Call</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-gray-600">
                  Call your assistant to test the voice AI in action.
                </p>
                <div className="bg-white rounded-lg border-2 border-green-300 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs text-gray-500">Assistant Phone Number</Label>
                      <div className="text-2xl font-bold text-green-700 mt-1">
                        {editingLivePhone ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={livePhoneDraft}
                              onChange={(e) => setLivePhoneDraft(e.target.value)}
                              placeholder="+12165550123"
                              className="max-w-xs"
                            />
                            <Button
                              size="sm"
                              onClick={async () => {
                                if (!company?.id || !livePhoneDraft) return;
                                try {
                                  const res = await base44.functions.invoke('updateThoughtlyPhone', {
                                    company_id: company.id,
                                    phone: livePhoneDraft,
                                  });
                                  
                                  if (res.data?.success) {
                                    setEditingLivePhone(false);
                                    queryClient.invalidateQueries({ queryKey: ["twilio-settings"] });
                                    alert('✅ Phone number updated!');
                                  } else {
                                    alert('❌ Error updating phone: ' + (res.data?.error || 'Unknown error'));
                                  }
                                } catch (err) {
                                  console.error(err);
                                  alert('❌ Error updating phone: ' + err.message);
                                }
                              }}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              Save
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingLivePhone(false)}>Cancel</Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <span>{twilioConfig?.main_phone_number || 'Not configured'}</span>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setLivePhoneDraft(twilioConfig?.main_phone_number || '');
                                setEditingLivePhone(true);
                              }}
                            >
                              Edit
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                    <Button
                      onClick={() => {
                        // Use main Twilio number for testing Sarah voice (not Thoughtly)
                        const num = twilioConfig?.main_phone_number;
                        if (num) {
                          window.open(`tel:${num}`,'_self');
                        } else {
                          alert('No Twilio phone number configured. Check TwilioSettings.');
                        }
                      }}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <Phone className="w-4 h-4 mr-2" />
                      Call Now
                    </Button>
                  </div>
                </div>
                <Button
                  onClick={async () => {
                    try {
                      const result = await base44.functions.invoke('testThoughtlyCall', {
                        companyId: company?.id
                      });
                      const data = result.data;
                      if (data.success) {
                        alert(`✅ Thoughtly is ready!\n\n📞 Phone Number: ${data.details.phone_number}\n\n📋 Next Steps:\n${data.details.next_steps.join('\n')}`);
                      } else {
                        alert(`❌ Error: ${data.error}\n\nStep: ${data.step}`);
                      }
                    } catch (error) {
                      alert('❌ Test failed: ' + error.message);
                    }
                  }}
                  variant="outline"
                  className="w-full"
                >
                  <Bug className="w-4 h-4 mr-2" />
                  Run Diagnostic Test
                </Button>
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-blue-800">
                    <strong>💡 Tip:</strong> This calls directly to Thoughtly - ultra-low latency with natural voice responses!
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-6">
          {/* Assistant Name */}
          <Card className="border-blue-200 bg-blue-50/30">
            <CardHeader>
              <CardTitle>Assistant Name</CardTitle>
              <CardDescription>Choose a name for your AI voice assistant. This name will be used when speaking to your customers on calls.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <Label>Assistant Name</Label>
                  <Input 
                    value={form.assistant_name || ""}
                    onChange={(e) => onChange('assistant_name', e.target.value)}
                    placeholder="Sarah"
                    className="mt-1"
                    data-testid="input-assistant-display-name"
                  />
                  <p className="text-xs text-gray-500 mt-1">Your assistant will introduce herself by this name on calls and messages. Default is "Sarah".</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Avatar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-6">
                {form.avatar_url ? (
                  <img src={form.avatar_url} alt={agentName} className="w-24 h-24 rounded-full object-cover border-4 border-blue-200" />
                ) : (
                  <div className="w-24 h-24 rounded-full border-4 border-gray-200 flex items-center justify-center text-gray-400">
                    <Sparkles className="w-8 h-8" />
                  </div>
                )}
                <div>
                  <input type="file" id="sarah-avatar" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
                  <label htmlFor="sarah-avatar">
                    <Button variant="outline" className="gap-2" disabled={fileUploading} type="button" asChild>
                      <span className="cursor-pointer">
                        <Upload className="w-4 h-4" /> {fileUploading ? "Uploading..." : "Upload New Avatar"}
                      </span>
                    </Button>
                  </label>
                  <p className="text-xs text-gray-500 mt-2">Recommended: Square image, 500x500px or larger</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI Engine (Beta)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Engine</Label>
                <Select value={form.engine} onValueChange={(v) => onChange('engine', v)}>
                  <SelectTrigger className="w-full mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini-2.0-flash-exp">Gemini 2.0 Flash Experimental</SelectItem>
                    <SelectItem value="gemini-2.0-flash-live-preview-04-09">Gemini 2.0 Flash Live Preview</SelectItem>
                    <SelectItem value="gemini-2.5-flash-native-audio-preview-12-2025">Gemini 2.5 Flash Native Audio</SelectItem>
                    <SelectItem value="gemini-2.0-flash">Gemini 2.0 Flash (Stable)</SelectItem>
                    <SelectItem value="gemini-1.5-flash">Gemini 1.5 Flash</SelectItem>
                    <SelectItem value="gpt-4o">OpenAI (GPT-4o)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-2">
                  Gemini enables low-latency voice and better realtime performance.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* SOFT-HIDDEN: Live Mode (Multimodal Live API) - experimental, may cause blank screen */}
          {/*
          <Card>
           <CardHeader>
             <CardTitle>Live (Real-time) - Beta</CardTitle>
           </CardHeader>
           <CardContent className="space-y-3">
             <p className="text-sm text-gray-600">Enable Gemini Multimodal Live API for push-to-talk voice</p>
             <div className="flex items-center justify-between mb-4">
               <Label>Enable Live Mode</Label>
               <Switch checked={form.live_mode} onCheckedChange={(v) => {
                 console.log('[SARAH LIVE MODE] Toggle:', v ? 'ENABLED' : 'DISABLED');
                 onChange('live_mode', v);
               }} />
             </div>

             {form.live_mode && (
               <div className="pt-4 border-t">
                 <Label className="mb-2 block">Live Voice Preview</Label>
                 {form.engine === 'gpt-4o' || form.engine === 'gpt-4o-realtime' ? (
                   <OpenAILiveClient systemPrompt={form.system_prompt} />
                 ) : (
                   <GeminiLiveClient 
                     systemPrompt={form.system_prompt} 
                     model={form.engine}
                   />
                 )}
               </div>
             )}
           </CardContent>
          </Card>
          */}

          <SarahVoiceSettings />

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">2</div>
                <CardTitle>Phone Numbers & Activation</CardTitle>
              </div>
              <CardDescription>Configure Sarah's phone numbers and activate her voice.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border border-gray-100">
                <Phone className="w-5 h-5 text-gray-400 mt-0.5" />
                <p className="text-sm text-gray-600">
                  You need a phone number from Twilio. <a href="https://www.twilio.com/console/phone-numbers/search" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">Buy a Number</a> if you don't have one yet.
                </p>
              </div>

              {!twilioConfig ? (
                <Alert>
                  <AlertTriangle className="w-4 h-4" />
                  <AlertDescription>
                    No Twilio settings found. Please configure your Twilio account in the{" "}
                    <Link to={createPageUrl("Communication")} className="underline font-medium">Communication Hub</Link> first.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="text-sm font-bold text-gray-700">Main Phone Number (for Sarah)</Label>
                      <Input 
                        value={form.sarah_inbound_phone || ""} 
                        onChange={(e) => onChange('sarah_inbound_phone', e.target.value)} 
                        placeholder="+12167777154" 
                        className="bg-white"
                      />
                      <p className="text-xs text-muted-foreground">This is the number Sarah will answer. When someone calls this number, Sarah will pick up.</p>
                      <div className="mt-2">
                        <Badge variant={twilioConfig.sarah_voice_enabled ? "default" : "secondary"}>
                          {twilioConfig.sarah_voice_enabled ? "Sarah Active" : "Not Connected"}
                        </Badge>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-bold text-gray-700">Outbound Caller ID</Label>
                      <Input 
                        value={form.sarah_outbound_phone || ""} 
                        onChange={(e) => onChange('sarah_outbound_phone', e.target.value)} 
                        placeholder="+12167777154" 
                        className="bg-white"
                      />
                      <p className="text-xs text-muted-foreground">The number displayed when Sarah calls leads. Usually the same as your main number.</p>
                    </div>
                  </div>

                  <div className="pt-4 border-t space-y-4">
                    <p className="text-sm text-muted-foreground">
                      When enabled, Sarah will answer all incoming calls on your Twilio number. 
                      She'll greet callers using your brand name, save their info as leads, 
                      and can book appointments on your calendar.
                    </p>
                    
                    <div className="flex gap-3">
                      <Button
                        data-testid="button-enable-sarah-voice"
                        className="bg-black text-white hover:bg-black/90"
                        disabled={twilioConfig.sarah_voice_enabled}
                        onClick={async () => {
                          if (!twilioConfig.account_sid || !twilioConfig.auth_token) {
                            alert("Your Twilio Account SID and Auth Token must be configured first.");
                            return;
                          }
                          try {
                            const webhookUrl = "https://sarah-media-stream-bridge-production.up.railway.app/twiml/voice";
                            const result = await base44.functions.invoke("sarahBridgeAPI", {
                              action: "enableSarahVoice",
                              companyId: company?.id,
                              data: { webhook_url: webhookUrl },
                            });
                            if (result.data?.success) {
                              queryClient.invalidateQueries({ queryKey: ["twilio-settings"] });
                              alert("Sarah Voice is now ACTIVE and answering calls!");
                            } else {
                              alert("Failed to enable: " + (result.data?.error || "Unknown error"));
                            }
                          } catch (err) {
                            alert("Failed to enable: " + (err.message || "Unknown error"));
                          }
                        }}
                      >
                        <Zap className="w-4 h-4 mr-2" />
                        {twilioConfig.sarah_voice_enabled ? "Sarah is Active" : "Save & Activate Sarah Voice"}
                      </Button>

                      {twilioConfig.sarah_voice_enabled && (
                        <Button
                          variant="outline"
                          className="text-red-600"
                          data-testid="button-disable-sarah-voice"
                          onClick={async () => {
                            if (!confirm("Disable Sarah Voice? Calls will no longer be answered by Sarah AI.")) return;
                            try {
                              await base44.functions.invoke("sarahBridgeAPI", {
                                action: "disableSarahVoice",
                                companyId: company?.id,
                              });
                              queryClient.invalidateQueries({ queryKey: ["twilio-settings"] });
                              alert("Sarah Voice has been disabled.");
                            } catch (err) {
                              alert("Failed to disable: " + (err.message || "Unknown error"));
                            }
                          }}
                        >
                          <PhoneOff className="w-4 h-4 mr-2" />
                          Disable Sarah Voice
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <SarahPresenceSettings />

          <Card>
            <CardHeader>
              <CardTitle>Personality & Behavior</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
                <Brain className="w-5 h-5 text-blue-600 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-blue-900 text-sm">Connected to AI Memory</h4>
                  <p className="text-xs text-blue-700 mt-1">
                   {agentName} automatically reads from your <strong>AI Memory</strong> (website, PDFs, docs). 
                   You don't need to paste that info here.
                  </p>
                  <Link to={createPageUrl('AITraining')} className="text-xs text-blue-600 underline mt-2 inline-block font-medium">
                    Manage AI Memory →
                  </Link>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Core Instructions (System Prompt)</Label>
                  <Button 
                    type="button"
                    variant="outline" 
                    size="sm"
                    onClick={() => onChange("system_prompt", DEFAULT_PROMPT)}
                  >
                    Reset to Professional Default
                  </Button>
                </div>
                <Textarea rows={10} className="mt-2 font-mono text-sm" value={form.system_prompt} onChange={(e) => onChange("system_prompt", e.target.value)} />
                <p className="text-xs text-gray-500 mt-2">
                  Customize {agentName}'s voice, tone, and operating rules. The default focuses on empathetic, triage-first roofing support.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Business Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Brand Short Name</Label>
                <Input value={form.brand_short_name} onChange={(e) => onChange('brand_short_name', e.target.value)} placeholder="Your Company Name" />
                <p className="text-xs text-gray-500 mt-1">How {agentName} introduces your company</p>
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <Label className="text-base font-semibold">Short SMS Mode</Label>
                  <p className="text-sm text-gray-500 mt-1">Keep messages concise for SMS</p>
                </div>
                <Switch checked={form.short_sms_mode} onCheckedChange={(v) => onChange('short_sms_mode', v)} />
              </div>

              <div>
                <Label>Max SMS Characters</Label>
                <Input type="number" value={form.max_sms_chars} onChange={(e) => onChange('max_sms_chars', parseInt(e.target.value))} />
                <p className="text-xs text-gray-500 mt-1">Character limit for SMS responses (default: 180)</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Scheduling</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Calendly Booking URL</Label>
                <div className="flex gap-2 mt-1">
                  <Input className="flex-1" value={form.calendly_booking_url} onChange={(e) => onChange('calendly_booking_url', e.target.value)} placeholder="https://getcompanysync.com/BookAppointment?company_id=..." />
                  {form.calendly_booking_url && (
                    <>
                      <Button 
                        variant="outline" 
                        size="icon"
                        type="button"
                        onClick={() => { navigator.clipboard.writeText(form.calendly_booking_url); alert('Link copied!'); }}
                        title="Copy link"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="icon"
                        type="button"
                        onClick={() => window.open(form.calendly_booking_url, '_blank')}
                        title="Preview booking page"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">{agentName} will send this link when customers ask to schedule appointments</p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <Label>Duration (min)</Label>
                  <Input type="number" value={form.scheduling_defaults.duration_min} onChange={(e) => onSchedChange('duration_min', parseInt(e.target.value))} />
                </div>
                <div>
                  <Label>Buffer (min)</Label>
                  <Input type="number" value={form.scheduling_defaults.buffer_min} onChange={(e) => onSchedChange('buffer_min', parseInt(e.target.value))} />
                </div>
                <div>
                  <Label>Start Hour</Label>
                  <Input type="number" value={form.scheduling_defaults.business_hours_start} onChange={(e) => onSchedChange('business_hours_start', parseInt(e.target.value))} />
                </div>
                <div>
                  <Label>End Hour</Label>
                  <Input type="number" value={form.scheduling_defaults.business_hours_end} onChange={(e) => onSchedChange('business_hours_end', parseInt(e.target.value))} />
                </div>
                <div>
                  <Label>Days Lookahead</Label>
                  <Input type="number" value={form.scheduling_defaults.days_lookahead} onChange={(e) => onSchedChange('days_lookahead', parseInt(e.target.value))} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Triage Process</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <Label className="text-base font-semibold">Answer then ask one</Label>
                  <p className="text-sm text-gray-500 mt-1">Respond to their question FIRST, then ask for one piece of info</p>
                </div>
                <Switch checked={form.answer_then_ask_one} onCheckedChange={(v) => onChange('answer_then_ask_one', v)} />
              </div>

              <div>
                <Label>Triage Categories (comma separated)</Label>
                <Input 
                  value={(form.triage_categories || []).join(', ')} 
                  onChange={(e) => onChange('triage_categories', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} 
                  placeholder="leak, missing shingles, hail, wind"
                />
              </div>

              <div>
                <Label>First Triage Question</Label>
                <Textarea 
                  rows={2}
                  value={form.triage_first_question} 
                  onChange={(e) => onChange('triage_first_question', e.target.value)} 
                  placeholder="What happened? (leak, missing shingles, hail, wind, other)"
                />
                <p className="text-xs text-gray-500 mt-1">Use placeholders: {'{brand}'}, {'{agent}'}, {'{calendly_link}'}, {'{triage_first}'}</p>
              </div>

              <div>
                <Label>Leak Follow-up Question</Label>
                <Textarea 
                  rows={2}
                  value={form.triage_followup_leak} 
                  onChange={(e) => onChange('triage_followup_leak', e.target.value)} 
                  placeholder="Is water getting in right now? Y/N"
                />
                <p className="text-xs text-gray-500 mt-1">Used when customer mentions a leak</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Conversation Limits</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <Label>Max SMS turns</Label>
                  <Input type="number" value={form.conversation_limits.max_sms_turns} onChange={(e) => onConvChange('max_sms_turns', parseInt(e.target.value))} />
                </div>
                <div>
                  <Label>Max thread duration (min)</Label>
                  <Input type="number" value={form.conversation_limits.max_thread_minutes} onChange={(e) => onConvChange('max_thread_minutes', parseInt(e.target.value))} />
                </div>
                <div>
                  <Label>Cooldown (hours)</Label>
                  <Input type="number" value={form.conversation_limits.cooldown_hours} onChange={(e) => onConvChange('cooldown_hours', parseInt(e.target.value))} />
                </div>
              </div>

              <div>
                <Label>Action at cap</Label>
                <Select value={form.conversation_limits.action_at_cap} onValueChange={(v) => onConvChange('action_at_cap', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wrapup_notify">Wrap-up + notify admins</SelectItem>
                    <SelectItem value="wrapup_only">Wrap-up only</SelectItem>
                    <SelectItem value="silent">Silent (stop responding)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Wrap-up message</Label>
                <Textarea 
                  rows={2}
                  value={form.conversation_limits.wrapup_template} 
                  onChange={(e) => onConvChange('wrapup_template', e.target.value)} 
                  placeholder="I'll hand this to our team to finish up. Expect a follow-up shortly."
                />
                <p className="text-xs text-gray-500 mt-1">Use placeholders: {'{brand}'}, {'{agent}'}, {'{calendly_link}'}, {'{triage_first}'}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Emergency Detection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Escalation Keywords (comma-separated)</Label>
                <Input 
                  value={(form.escalation_keywords || []).join(', ')} 
                  onChange={(e) => onChange('escalation_keywords', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} 
                  placeholder="emergency, urgent, fire, flood, leak"
                />
                <p className="text-xs text-gray-500 mt-1">🚨 When detected, {agentName} alerts admins and attempts transfer</p>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !company?.id} className="bg-blue-600 hover:bg-blue-700">
              <Save className="w-4 h-4 mr-2" /> {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      <Dialer 
        open={showDialer} 
        onOpenChange={setShowDialer}
        defaultNumber={selectedContact.phone}
        defaultName={selectedContact.name}
      />

      <SMSDialog
        open={showSMS}
        onOpenChange={setShowSMS}
        defaultTo={selectedContact.phone}
        defaultName={selectedContact.name}
      />
    </div>
    </>
  );
}