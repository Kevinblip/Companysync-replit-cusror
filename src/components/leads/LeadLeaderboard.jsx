import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, Medal, Award, TrendingUp, Flame, ThermometerSun, Snowflake } from "lucide-react";
import { format } from "date-fns";

export default function LeadLeaderboard({ leadScores, leads, onLeadClick }) {
  // Sort leads by score and get top 10
  const topLeads = [...leadScores]
    .sort((a, b) => (b.total_score || 0) - (a.total_score || 0))
    .slice(0, 10);

  const getLeadData = (leadId) => {
    return leads.find(l => l.id === leadId);
  };

  const getRankIcon = (index) => {
    if (index === 0) return <Trophy className="w-6 h-6 text-yellow-500" />;
    if (index === 1) return <Medal className="w-6 h-6 text-gray-400" />;
    if (index === 2) return <Award className="w-6 h-6 text-orange-600" />;
    return (
      <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
        {index + 1}
      </div>
    );
  };

  const getTemperatureIcon = (temperature) => {
    if (temperature === 'hot') return <Flame className="w-4 h-4 text-red-500" />;
    if (temperature === 'warm') return <ThermometerSun className="w-4 h-4 text-orange-500" />;
    return <Snowflake className="w-4 h-4 text-blue-500" />;
  };

  const getTemperatureColor = (temperature) => {
    if (temperature === 'hot') return 'bg-red-50 border-red-200';
    if (temperature === 'warm') return 'bg-orange-50 border-orange-200';
    return 'bg-blue-50 border-blue-200';
  };

  return (
    <Card className="bg-white shadow-lg">
      <CardHeader className="border-b bg-gradient-to-r from-yellow-50 to-orange-50">
        <CardTitle className="flex items-center gap-2 text-xl">
          <Trophy className="w-6 h-6 text-yellow-600" />
          Lead Leaderboard
          <Badge variant="outline" className="ml-auto">Top 10</Badge>
        </CardTitle>
        <p className="text-sm text-gray-600 mt-1">Hottest leads by engagement score</p>
      </CardHeader>
      <CardContent className="p-0">
        {topLeads.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Trophy className="w-16 h-16 mx-auto mb-3 text-gray-300" />
            <p className="font-medium">No scored leads yet</p>
            <p className="text-sm">Start engaging with leads to see them here!</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {topLeads.map((score, index) => {
              const lead = getLeadData(score.lead_id);
              const isTopThree = index < 3;
              
              return (
                <div
                  key={score.id}
                  onClick={() => onLeadClick && lead && onLeadClick(lead)}
                  className={`p-4 flex items-center gap-4 hover:bg-gray-50 cursor-pointer transition-colors ${
                    isTopThree ? getTemperatureColor(score.temperature) : ''
                  }`}
                >
                  {/* Rank */}
                  <div className="flex-shrink-0">
                    {getRankIcon(index)}
                  </div>

                  {/* Lead Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 truncate">
                        {score.lead_name || 'Unknown Lead'}
                      </p>
                      {getTemperatureIcon(score.temperature)}
                    </div>
                    
                    {lead && (
                      <div className="flex items-center gap-2 mt-1">
                        {lead.company && (
                          <span className="text-xs text-gray-500">{lead.company}</span>
                        )}
                        {lead.status && (
                          <Badge variant="outline" className="text-xs">
                            {lead.status}
                          </Badge>
                        )}
                      </div>
                    )}
                    
                    {score.last_activity && (
                      <p className="text-xs text-gray-500 mt-1">
                        Last activity: {format(new Date(score.last_activity), 'MMM d, h:mm a')}
                      </p>
                    )}
                  </div>

                  {/* Score */}
                  <div className="flex-shrink-0 text-right">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`${
                          score.temperature === 'hot'
                            ? 'bg-red-100 text-red-700 border-red-300'
                            : score.temperature === 'warm'
                            ? 'bg-orange-100 text-orange-700 border-orange-300'
                            : 'bg-blue-100 text-blue-700 border-blue-300'
                        } font-bold text-lg px-3 py-1`}
                      >
                        {score.total_score}
                      </Badge>
                    </div>
                    
                    {score.score_history && score.score_history.length > 0 && (
                      <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                        <TrendingUp className="w-3 h-3" />
                        {score.score_history.length} activities
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}