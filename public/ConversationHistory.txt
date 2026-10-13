import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, Bot, User, Archive, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';
import useCurrentCompany from "@/components/hooks/useCurrentCompany";

export default function ConversationHistory() {
    const [searchTerm, setSearchTerm] = useState('');

    const { data: user } = useQuery({
        queryKey: ['current-user'],
        queryFn: () => base44.auth.me(),
    });

    const { company: myCompany } = useCurrentCompany(user);

    const { data: history = [], isLoading } = useQuery({
        queryKey: ['conversationHistory', myCompany?.id],
        queryFn: () => myCompany ? base44.entities.ConversationHistory.filter({ company_id: myCompany.id }, '-created_date', 500) : [],
        enabled: !!myCompany,
        initialData: [],
    });

    const groupedConversations = useMemo(() => {
        if (!history || history.length === 0) return {};
        
        const grouped = history.reduce((acc, msg) => {
            const sessionId = msg.session_id;
            if (!acc[sessionId]) {
                acc[sessionId] = [];
            }
            acc[sessionId].push(msg);
            return acc;
        }, {});

        for (const sessionId in grouped) {
            grouped[sessionId].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        }
        
        return grouped;
    }, [history]);

    const filteredSessionIds = useMemo(() => {
        const lowercasedSearch = searchTerm.toLowerCase();
        if (!lowercasedSearch) {
            return Object.keys(groupedConversations).sort((a, b) => {
                const dateA = new Date(groupedConversations[a][0].created_date);
                const dateB = new Date(groupedConversations[b][0].created_date);
                return dateB - dateA;
            });
        }

        return Object.keys(groupedConversations).filter(sessionId => {
            const messages = groupedConversations[sessionId];
            return messages.some(msg => 
                msg.message_content.toLowerCase().includes(lowercasedSearch)
            );
        }).sort((a, b) => {
            const dateA = new Date(groupedConversations[a][0].created_date);
            const dateB = new Date(groupedConversations[b][0].created_date);
            return dateB - dateA;
        });
    }, [searchTerm, groupedConversations]);

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
                <Archive className="w-8 h-8 text-gray-700" />
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Conversation History</h1>
                    <p className="text-gray-500 mt-1">Review and search your past conversations with Lexi AI.</p>
                </div>
            </div>
            
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <Input 
                    placeholder="Search conversations..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 text-base"
                />
            </div>

            {isLoading ? (
                <div className="flex justify-center items-center h-64">
                    <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
                </div>
            ) : filteredSessionIds.length === 0 ? (
                <Card className="text-center p-12">
                    <CardContent>
                        <MessageSquare className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                        <h3 className="text-xl font-semibold text-gray-700">No Conversations Found</h3>
                        <p className="text-gray-500 mt-2">
                            {searchTerm ? 'Try a different search term.' : 'Your chat history with Lexi will appear here.'}
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-6">
                    {filteredSessionIds.map(sessionId => {
                        const sessionMessages = groupedConversations[sessionId];
                        const firstMessage = sessionMessages[0];
                        
                        return (
                            <Card key={sessionId} className="shadow-md hover:shadow-lg transition-shadow">
                                <CardHeader>
                                    <CardTitle className="text-lg">
                                        Conversation from {format(new Date(firstMessage.created_date), 'MMMM d, yyyy, h:mm a')}
                                    </CardTitle>
                                    <CardDescription>Session ID: {sessionId}</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {sessionMessages.map(msg => (
                                        <div key={msg.id} className={`flex items-start gap-3 ${msg.message_role === 'user' ? 'justify-end' : ''}`}>
                                            {msg.message_role === 'assistant' && <Bot className="w-5 h-5 text-purple-600 flex-shrink-0 mt-1" />}
                                            <div className={`max-w-[80%] rounded-lg p-3 ${msg.message_role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>
                                                <p className="text-sm whitespace-pre-wrap">{msg.message_content}</p>
                                                <p className="text-xs opacity-70 mt-2 text-right">
                                                    {format(new Date(msg.created_date), 'h:mm a')}
                                                </p>
                                            </div>
                                            {msg.message_role === 'user' && <User className="w-5 h-5 text-blue-600 flex-shrink-0 mt-1" />}
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}
        </div>
    );
}