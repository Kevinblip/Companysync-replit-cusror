import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, MapPin, AlertTriangle, TrendingUp, Users, DollarSign, Calendar, Cloud, Wind, Snowflake, Droplet, Download, ChevronRight, Phone, Mail } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import useTranslation from "@/hooks/useTranslation";

export default function StormReport() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [selectedStorm, setSelectedStorm] = useState(null);
  const [potentialLeads, setPotentialLeads] = useState({});
  const [isLoadingLeads, setIsLoadingLeads] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  // Get storm ID from URL immediately (don't wait for company to load)
  const stormId = new URLSearchParams(location.search).get('id');

  // Fetch the specific storm by ID directly — storms are shared (not per-company)
  const { data: stormEntity } = useQuery({
    queryKey: ['storm-by-id', stormId],
    queryFn: () => base44.functions.invoke('getStormById', { stormId }),
    enabled: !!stormId,
    select: (res) => res?.data?.storm || null,
  });

  // Sync storm entity into selectedStorm state (for analyzeLeadPotential)
  useEffect(() => {
    if (stormEntity && (!selectedStorm || selectedStorm.id !== stormEntity.id)) {
      setSelectedStorm(stormEntity);
      analyzeLeadPotential(stormEntity);
    }
  }, [stormEntity]);

  const { data: leads = [] } = useQuery({
    queryKey: ['leads-for-storm', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers-for-storm', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const analyzeLeadPotential = async (storm) => {
    setIsLoadingLeads(true);
    
    // Estimate potential leads based on storm severity and affected areas
    const affectedCount = storm.affected_areas?.length || 0;
    const multiplier = 
      storm.severity === 'extreme' ? 500 :
      storm.severity === 'severe' ? 250 :
      100;
    
    const estimatedLeads = affectedCount * multiplier;
    
    // Check existing leads from this storm
    const existingStormLeads = leads.filter(l => 
      l.source === 'storm_tracker' && 
      l.lead_source?.includes(storm.title)
    );
    
    setPotentialLeads({
      estimated: estimatedLeads,
      existing: existingStormLeads.length,
      untapped: estimatedLeads - existingStormLeads.length,
      conversion_potential: estimatedLeads * 0.15 // Assume 15% conversion
    });
    
    setIsLoadingLeads(false);
  };

  const getSeverityConfig = (severity) => {
    const configs = {
      extreme: { 
        color: 'bg-red-100 text-red-800 border-red-300',
        icon: AlertTriangle,
        label: 'EXTREME',
        priority: 'Immediate Action Required',
        action: 'Deploy all available teams'
      },
      severe: { 
        color: 'bg-orange-100 text-orange-800 border-orange-300',
        icon: AlertTriangle,
        label: 'SEVERE',
        priority: 'High Priority',
        action: 'Mobilize response teams within 24 hours'
      },
      moderate: { 
        color: 'bg-yellow-100 text-yellow-800 border-yellow-300',
        icon: Cloud,
        label: 'MODERATE',
        priority: 'Monitor Closely',
        action: 'Prepare marketing campaigns'
      },
    };
    return configs[severity] || configs.moderate;
  };

  const getStormTypeIcon = (type) => {
    const icons = {
      hail: Droplet,
      tornado: Wind,
      high_wind: Wind,
      winter_storm: Snowflake,
      thunderstorm: Cloud,
      flood: Droplet,
    };
    return icons[type] || Cloud;
  };

  const getRecommendedActions = (storm) => {
    const actions = [];
    
    if (storm.severity === 'extreme' || storm.severity === 'severe') {
      actions.push({
        priority: 'high',
        title: '🚨 Immediate Response',
        description: 'Deploy inspection teams to affected areas within 24-48 hours',
        icon: Users
      });
      actions.push({
        priority: 'high',
        title: '📱 Contact Existing Customers',
        description: 'Reach out to customers in affected zip codes to offer inspections',
        icon: Phone
      });
    }
    
    actions.push({
      priority: 'medium',
      title: '📧 Email Campaign',
      description: `Launch targeted email campaign to ${storm.affected_areas?.length || 0} affected areas`,
      icon: Mail
    });
    
    actions.push({
      priority: 'medium',
      title: '🎯 Generate Leads',
      description: 'Use Property Importer to identify damaged properties in affected areas',
      icon: TrendingUp
    });
    
    if (storm.event_type === 'hail' && storm.hail_size_inches >= 1) {
      actions.push({
        priority: 'high',
        title: '🏠 Roof Inspections',
        description: `Hail size ${storm.hail_size_inches}" - High probability of roof damage. Offer free inspections.`,
        icon: AlertTriangle
      });
    }
    
    if (storm.event_type === 'high_wind' && storm.wind_speed_mph >= 75) {
      actions.push({
        priority: 'high',
        title: '🌪️ Wind Damage Assessment',
        description: `${storm.wind_speed_mph} mph winds - Check for siding, gutters, and shingle damage`,
        icon: Wind
      });
    }
    
    return actions;
  };

  const calculateBusinessImpact = (storm) => {
    const affectedCount = storm.affected_areas?.length || 0;
    
    let propertiesAtRisk = 0;
    let estimatedRevenue = 0;
    
    switch (storm.severity) {
      case 'extreme':
        propertiesAtRisk = affectedCount * 5000;
        estimatedRevenue = propertiesAtRisk * 8000 * 0.15; // 15% conversion, $8k avg job
        break;
      case 'severe':
        propertiesAtRisk = affectedCount * 2500;
        estimatedRevenue = propertiesAtRisk * 7000 * 0.12;
        break;
      default:
        propertiesAtRisk = affectedCount * 1000;
        estimatedRevenue = propertiesAtRisk * 6000 * 0.08;
    }
    
    return {
      propertiesAtRisk,
      estimatedRevenue,
      responseWindow: storm.severity === 'extreme' ? '24-48 hours' : '3-7 days',
      competitorActivity: storm.severity === 'extreme' ? 'Very High' : storm.severity === 'severe' ? 'High' : 'Moderate'
    };
  };

  if (!selectedStorm) {
    return (
      <div className="p-6 space-y-4">
        <Button variant="outline" onClick={() => navigate(createPageUrl('StormTracking'))}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t.common.back}
        </Button>
        
        <Card>
          <CardContent className="p-12 text-center">
            <AlertTriangle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h2 className="text-xl font-semibold mb-2">{t.common.noResults}</h2>
            <p className="text-gray-500">Please select a storm from the Storm Tracking page to view detailed reports.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const severityConfig = getSeverityConfig(selectedStorm.severity);
  const StormIcon = getStormTypeIcon(selectedStorm.event_type);
  const recommendations = getRecommendedActions(selectedStorm);
  const businessImpact = calculateBusinessImpact(selectedStorm);

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => navigate(createPageUrl('StormTracking'))}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t.common.back}
        </Button>
        
        <Button className="bg-blue-600 hover:bg-blue-700">
          <Download className="w-4 h-4 mr-2" />
          {t.common.export}
        </Button>
      </div>

      {/* Storm Header */}
      <Card className="bg-gradient-to-br from-blue-600 to-purple-600 text-white">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <StormIcon className="w-8 h-8" />
                <h1 className="text-3xl font-bold">{selectedStorm.title}</h1>
              </div>
              <p className="text-blue-100 mb-4">{selectedStorm.description}</p>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-blue-200">{t.calendar.type}</p>
                  <p className="text-lg font-semibold capitalize">{selectedStorm.event_type?.replace(/_/g, ' ')}</p>
                </div>
                <div>
                  <p className="text-xs text-blue-200">{t.common.status}</p>
                  <Badge className="bg-white/20 text-white border-white/30 mt-1">
                    {selectedStorm.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-blue-200">{t.common.date}</p>
                  <p className="text-sm font-semibold">
                    {format(new Date(selectedStorm.start_time), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-blue-200">{t.customers.source}</p>
                  <p className="text-sm font-semibold">{selectedStorm.source}</p>
                </div>
              </div>
            </div>
            
            <Badge className={`${severityConfig.color} text-lg px-4 py-2 font-bold border-2`}>
              {severityConfig.label}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Business Impact Analysis */}
      <Card className="border-l-4 border-l-green-600">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-600" />
            {t.reports.performance}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center p-4 bg-purple-50 rounded-lg border border-purple-200">
              <p className="text-sm text-gray-600 mb-1">Properties at Risk</p>
              <p className="text-3xl font-bold text-purple-600">
                {businessImpact.propertiesAtRisk.toLocaleString()}
              </p>
            </div>
            
            <div className="text-center p-4 bg-green-50 rounded-lg border border-green-200">
              <p className="text-sm text-gray-600 mb-1">Potential Revenue</p>
              <p className="text-3xl font-bold text-green-600">
                ${(businessImpact.estimatedRevenue / 1000000).toFixed(1)}M
              </p>
              <p className="text-xs text-gray-500 mt-1">15% conversion rate</p>
            </div>
            
            <div className="text-center p-4 bg-orange-50 rounded-lg border border-orange-200">
              <p className="text-sm text-gray-600 mb-1">Response Window</p>
              <p className="text-2xl font-bold text-orange-600">
                {businessImpact.responseWindow}
              </p>
              <p className="text-xs text-gray-500 mt-1">Before competition</p>
            </div>
            
            <div className="text-center p-4 bg-red-50 rounded-lg border border-red-200">
              <p className="text-sm text-gray-600 mb-1">Competitor Activity</p>
              <p className="text-2xl font-bold text-red-600">
                {businessImpact.competitorActivity}
              </p>
              <p className="text-xs text-gray-500 mt-1">Expected competition</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Storm Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-blue-600">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <MapPin className="w-10 h-10 text-blue-600" />
              <div>
                <p className="text-sm text-gray-600">Affected Areas</p>
                <p className="text-3xl font-bold text-gray-900">
                  {selectedStorm.affected_areas?.length || 0}
                </p>
                <p className="text-xs text-gray-500">Counties/Zones</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {selectedStorm.hail_size_inches && (
          <Card className="border-l-4 border-l-purple-600">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <Droplet className="w-10 h-10 text-purple-600" />
                <div>
                  <p className="text-sm text-gray-600">Hail Size</p>
                  <p className="text-3xl font-bold text-gray-900">
                    {selectedStorm.hail_size_inches}"
                  </p>
                  <p className="text-xs text-gray-500">
                    {selectedStorm.hail_size_inches >= 2.75 ? 'Baseball+' :
                     selectedStorm.hail_size_inches >= 2 ? 'Golf Ball+' :
                     selectedStorm.hail_size_inches >= 1.75 ? 'Quarter+' : 'Penny+'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {selectedStorm.wind_speed_mph && (
          <Card className="border-l-4 border-l-orange-600">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <Wind className="w-10 h-10 text-orange-600" />
                <div>
                  <p className="text-sm text-gray-600">Wind Speed</p>
                  <p className="text-3xl font-bold text-gray-900">
                    {selectedStorm.wind_speed_mph}
                  </p>
                  <p className="text-xs text-gray-500">mph</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-l-4 border-l-green-600">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <MapPin className="w-10 h-10 text-green-600" />
              <div>
                <p className="text-sm text-gray-600">Impact Radius</p>
                <p className="text-3xl font-bold text-gray-900">
                  {selectedStorm.radius_miles}
                </p>
                <p className="text-xs text-gray-500">miles</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Affected Areas Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-blue-600" />
            Affected Areas ({selectedStorm.affected_areas?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4 bg-blue-50 border-blue-200">
            <AlertDescription className="text-blue-900">
              <strong>What this means:</strong> These {selectedStorm.affected_areas?.length || 0} counties/zones are currently under weather alerts. 
              Each area represents potential customers who may need your services.
            </AlertDescription>
          </Alert>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {selectedStorm.affected_areas?.map((area, idx) => (
              <div key={idx} className="p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition-colors">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <span className="font-medium text-sm">{area}</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="text-xs h-7 w-full"
                    onClick={() => navigate(createPageUrl('PropertyDataImporter') + `?location=${encodeURIComponent(area)}`)}
                  >
                    <Users className="w-3 h-3 mr-1" />
                    {t.common.search}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Lead Generation Potential */}
 
    </div>
  );
}