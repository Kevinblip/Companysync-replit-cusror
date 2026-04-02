import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import useTranslation from "@/hooks/useTranslation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  MessageCircle,
  Send,
  Paperclip,
  Search,
  User,
  Check,
  CheckCheck,
  Clock,
  Plus
} from "lucide-react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Messages() {
  const { t } = useTranslation();
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messageText, setMessageText] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [showNewMessageDialog, setShowNewMessageDialog] = useState(false);
  const [newMessageData, setNewMessageData] = useState({
    to_user_name: "",
    to_user_email: "",
    subject: "",
    message_body: ""
  });
  const messagesEndRef = useRef(null);
  const queryClient = useQueryClient();

  const { user, myCompany, isAdmin, hasPermission, effectiveUserEmail, filterCustomers, filterMessages } = useRoleBasedData();

  const { data: allMessages = [] } = useQuery({
    queryKey: ['messages-v2', myCompany?.id],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      const data = await base44.entities.Message.filter({ company_id: myCompany.id }, "-created_date", 1000);
      // Double check filter on client side
      return data.filter(m => m.company_id === myCompany.id);
    },
    initialData: [],
    refetchInterval: 5000, // Poll every 5 seconds
    enabled: !!myCompany?.id
  });

  const { data: rawCustomers = [] } = useQuery({
    queryKey: ['customers-v2', myCompany?.id],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      const data = await base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date");
      return data;
    },
    initialData: [],
    enabled: !!myCompany?.id
  });

  // 🔐 Filter customers using hook's canonical filter
  const customers = React.useMemo(() => filterCustomers(rawCustomers.filter(c => c.company_id === myCompany?.id)), [rawCustomers, myCompany?.id, filterCustomers]);

  // 🔐 Filter messages using hook's canonical filter (by customer relation + direct messages)
  const messages = React.useMemo(() => filterMessages(allMessages, customers), [allMessages, customers, filterMessages]);

  const sendMessageMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.entities.Message.create({
        ...data,
        company_id: myCompany?.id
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      setMessageText("");
      scrollToBottom();
    },
  });

  const startNewConversationMutation = useMutation({
    mutationFn: async (data) => {
      const conversationId = `conv_${Date.now()}`;
      return await base44.entities.Message.create({
        ...data,
        company_id: myCompany?.id,
        conversation_id: conversationId,
        from_user_email: user?.email,
        from_user_name: user?.full_name || 'Staff',
        is_read: false
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      setShowNewMessageDialog(false);
      setNewMessageData({
        to_user_name: "",
        to_user_email: "",
        subject: "",
        message_body: ""
      });
    },
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (messageId) => {
      return await base44.entities.Message.update(messageId, {
        is_read: true,
        read_at: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });

  // Group messages by conversation
  const conversations = React.useMemo(() => {
    const convMap = new Map();

    messages.forEach(msg => {
      const convId = msg.conversation_id || msg.id;
      if (!convMap.has(convId)) {
        convMap.set(convId, []);
      }
      convMap.get(convId).push(msg);
    });

    return Array.from(convMap.entries()).map(([convId, msgs]) => {
      const sortedMsgs = msgs.sort((a, b) => 
        new Date(a.created_date).getTime() - new Date(b.created_date).getTime()
      );
      const lastMsg = sortedMsgs[sortedMsgs.length - 1];
      const unreadCount = msgs.filter(m => !m.is_read && m.from_user_email !== user?.email).length;

      const otherParticipant = lastMsg.from_user_email === user?.email 
        ? { name: lastMsg.to_user_name, email: lastMsg.to_user_email }
        : { name: lastMsg.from_user_name, email: lastMsg.from_user_email };

      return {
        conversation_id: convId,
        messages: sortedMsgs,
        last_message: lastMsg,
        participant_name: otherParticipant.name,
        participant_email: otherParticipant.email,
        unread_count: unreadCount,
        updated_at: lastMsg.created_date
      };
    }).sort((a, b) => 
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }, [messages, user]);

  const filteredConversations = conversations.filter(conv =>
    conv.participant_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    conv.participant_email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [selectedConversation]);

  useEffect(() => {
    if (selectedConversation) {
      selectedConversation.messages.forEach(msg => {
        if (!msg.is_read && msg.from_user_email !== user?.email) {
          markAsReadMutation.mutate(msg.id);
        }
      });
    }
  }, [selectedConversation]);

  const handleSendMessage = () => {
    if (!messageText.trim() || !selectedConversation) return;

    sendMessageMutation.mutate({
      conversation_id: selectedConversation.conversation_id,
      from_user_email: user?.email,
      from_user_name: user?.full_name || 'Staff',
      to_user_email: selectedConversation.participant_email,
      to_user_name: selectedConversation.participant_name,
      message_body: messageText,
      is_read: false
    });
  };

  const handleStartNewConversation = () => {
    startNewConversationMutation.mutate(newMessageData);
  };

  const totalUnread = conversations.reduce((sum, conv) => sum + conv.unread_count, 0);

  return (
    <div className="p-6 h-[calc(100vh-6rem)]">
      <div className="h-full flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{t.communication.messages || "Messages"}</h1>
            <p className="text-gray-500 mt-1">Chat with customers in real-time</p>
          </div>

          <Dialog open={showNewMessageDialog} onOpenChange={setShowNewMessageDialog}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                {t.communication.newMessage}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t.communication.newMessage}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>{t.common.select} {t.customers.title.toLowerCase().replace(/s$/, '')}</Label>
                  <Select
                    value={newMessageData.to_user_email || undefined}
                    onValueChange={(email) => {
                      const customer = customers.find(c => c.email === email);
                      setNewMessageData(prev => ({
                        ...prev,
                        to_user_email: email,
                        to_user_name: customer?.name || ''
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t.common.select + "..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {customers
                        .filter(c => c.email && c.email.trim() !== '')
                        .map(customer => (
                          <SelectItem key={customer.id} value={customer.email}>
                            {customer.name} ({customer.email})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>{t.communication.subject}</Label>
                  <Input
                    value={newMessageData.subject}
                    onChange={(e) => setNewMessageData({...newMessageData, subject: e.target.value})}
                    placeholder={t.communication.subject}
                  />
                </div>

                <div>
                  <Label>{t.communication.message}</Label>
                  <Textarea
                    value={newMessageData.message_body}
                    onChange={(e) => setNewMessageData({...newMessageData, message_body: e.target.value})}
                    placeholder={t.communication.message + "..."}
                    rows={4}
                  />
                </div>

                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowNewMessageDialog(false)}
                  >
                    {t.common.cancel}
                  </Button>
                  <Button
                    onClick={handleStartNewConversation}
                    disabled={!newMessageData.to_user_email || !newMessageData.message_body}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    {t.communication.send}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="flex-1 flex flex-col overflow-hidden">
          <div className="flex flex-1 overflow-hidden">
            {/* Conversations List */}
            <div className="w-80 border-r bg-gray-50 flex flex-col">
              <div className="p-4 border-b bg-white">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder={t.common.search + "..."}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                {totalUnread > 0 && (
                  <div className="mt-2 px-3 py-2 bg-blue-50 rounded text-sm text-blue-700">
                    {totalUnread} {totalUnread > 1 ? t.communication.noMessages.replace("No messages found", "unread messages") : t.communication.noMessages.replace("No messages found", "unread message")}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                {filteredConversations.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <MessageCircle className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>{t.communication.noMessages}</p>
                  </div>
                ) : (
                  filteredConversations.map((conv) => (
                    <div
                      key={conv.conversation_id}
                      onClick={() => setSelectedConversation(conv)}
                      className={`p-4 border-b cursor-pointer hover:bg-white transition-colors ${
                        selectedConversation?.conversation_id === conv.conversation_id
                          ? 'bg-white border-l-4 border-l-blue-500'
                          : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold flex-shrink-0">
                          {conv.participant_name?.substring(0, 2).toUpperCase() || 'U'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="font-semibold text-gray-900 truncate">
                              {conv.participant_name || 'Unknown'}
                            </p>
                            {conv.unread_count > 0 && (
                              <Badge className="bg-blue-600 text-white">
                                {conv.unread_count}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-500 truncate">
                            {conv.last_message.message_body}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {format(new Date(conv.updated_at), 'MMM d, h:mm a')}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 flex flex-col">
              {!selectedConversation ? (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <MessageCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <p className="text-lg font-medium">{t.common.select} {t.communication.message.toLowerCase()}</p>
                    <p className="text-sm">{t.common.select} {t.communication.message.toLowerCase()} from the list to start chatting</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Chat Header */}
                  <div className="p-4 border-b bg-white flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold">
                      {selectedConversation.participant_name?.substring(0, 2).toUpperCase() || 'U'}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">
                        {selectedConversation.participant_name || 'Unknown'}
                      </p>
                      <p className="text-sm text-gray-500">
                        {selectedConversation.participant_email}
                      </p>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                    {selectedConversation.messages.map((msg) => {
                      const isSentByMe = msg.from_user_email === user?.email;
                      return (
                        <div
                          key={msg.id}
                          className={`flex ${isSentByMe ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`max-w-[70%]`}>
                            <div
                              className={`p-3 rounded-lg ${
                                isSentByMe
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-white text-gray-900 border'
                              }`}
                            >
                              {msg.subject && (
                                <p className="font-semibold text-sm mb-2 pb-2 border-b border-white/20">
                                  {msg.subject}
                                </p>
                              )}
                              <p className="text-sm">{msg.message_body}</p>
                            </div>
                            <div className={`flex items-center gap-1 mt-1 text-xs text-gray-500 ${isSentByMe ? 'justify-end' : 'justify-start'}`}>
                              <span>{format(new Date(msg.created_date), 'h:mm a')}</span>
                              {isSentByMe && (
                                msg.is_read ? (
                                  <CheckCheck className="w-3 h-3 text-blue-600" />
                                ) : (
                                  <Check className="w-3 h-3" />
                                )
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Message Input */}
                  <div className="p-4 border-t bg-white">
                    <div className="flex items-end gap-2">
                      <Textarea
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        placeholder={t.communication.message + "..."}
                        rows={2}
                        className="resize-none"
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                      />
                      <Button
                        onClick={handleSendMessage}
                        disabled={!messageText.trim() || sendMessageMutation.isPending}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      {t.communication.send} (Enter), {t.common.new} line (Shift+Enter)
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}