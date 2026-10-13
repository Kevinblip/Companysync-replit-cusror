import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, MapPin, Phone, Mail, Star, Navigation, Wrench, CheckCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

// Load Google Maps Script
function useGoogleMaps(apiKey) {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!apiKey) return;
    
    if (window.google && window.google.maps) {
      setIsLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => setIsLoaded(true);
    document.head.appendChild(script);

    return () => {
      // Cleanup if needed
    };
  }, [apiKey]);

  return isLoaded;
}

export default function SubcontractorFinder({ 
  open, 
  onOpenChange, 
  jobAddress, 
  jobLatitude,
  jobLongitude,
  requiredSpecialty, 
  companyId,
  onSubcontractorSelected 
}) {
  const [isSearching, setIsSearching] = useState(false);
  const [availableSubs, setAvailableSubs] = useState([]);
  const [searched, setSearched] = useState(false);
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState(null);

  useEffect(() => {
    base44.functions.invoke('getGoogleMapsApiKey')
      .then(response => setGoogleMapsApiKey(response.data.apiKey))
      .catch(err => console.error('Failed to load Google Maps API key:', err));
  }, []);

  const mapsLoaded = useGoogleMaps(googleMapsApiKey);

  useEffect(() => {
    if (open && jobLatitude && jobLongitude && !searched && mapsLoaded) {
      handleSearch();
    }
  }, [open, jobLatitude, jobLongitude, mapsLoaded]);

  const handleSearch = async () => {
    if (!jobLatitude || !jobLongitude) {
      alert('Missing job location coordinates');
      return;
    }

    setIsSearching(true);
    setSearched(true);

    try {
      const response = await base44.functions.invoke('findAvailableSubcontractors', {
        job_latitude: jobLatitude,
        job_longitude: jobLongitude,
        required_specialty: requiredSpecialty,
        company_id: companyId
      });

      console.log('🔍 Found subcontractors:', response.data);
      setAvailableSubs(response.data.subcontractors || []);
    } catch (error) {
      console.error('Error finding subcontractors:', error);
      alert('Failed to find subcontractors: ' + error.message);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSubcontractor = (sub) => {
    onSubcontractorSelected(sub);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-blue-600" />
            Find Available Subcontractors
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Job Info Banner */}
          <Alert className="bg-blue-50 border-blue-200">
            <MapPin className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              <strong>Job Location:</strong> {jobAddress}
              {requiredSpecialty && (
                <div className="mt-1">
                  <strong>Required Specialty:</strong> {requiredSpecialty}
                </div>
              )}
            </AlertDescription>
          </Alert>

          {/* Loading State */}
          {isSearching && (
            <div className="text-center py-12">
              <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
              <p className="text-gray-600">Calculating distances and matching specialists...</p>
            </div>
          )}

          {/* Results */}
          {!isSearching && searched && (
            <>
              {availableSubs.length === 0 ? (
                <div className="text-center py-12">
                  <Wrench className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No Subcontractors Available</h3>
                  <p className="text-gray-600 mb-4">
                    No subcontractors found within service radius for this job location
                    {requiredSpecialty && ` with ${requiredSpecialty} specialty`}.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                  >
                    Close
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-900">
                      {availableSubs.length} Available {availableSubs.length === 1 ? 'Subcontractor' : 'Subcontractors'}
                    </h3>
                    <Badge className="bg-green-100 text-green-700">
                      Sorted by Distance
                    </Badge>
                  </div>

                  <div className="space-y-3">
                    {availableSubs.map((sub, idx) => (
                      <Card key={sub.id} className="hover:shadow-lg transition-shadow border-l-4 border-blue-500">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center flex-shrink-0">
                                  <Wrench className="w-6 h-6 text-white" />
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className="font-bold text-lg">{sub.name}</h4>
                                    {idx === 0 && (
                                      <Badge className="bg-green-500 text-white">
                                        Closest
                                      </Badge>
                                    )}
                                  </div>
                                  {sub.contact_person && (
                                    <p className="text-sm text-gray-600">{sub.contact_person}</p>
                                  )}
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-3 mb-3">
                                <div className="flex items-center gap-2 text-sm">
                                  <Navigation className="w-4 h-4 text-blue-600" />
                                  <span className="font-semibold text-blue-600">
                                    {sub.distance_miles} mi away
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                  <MapPin className="w-4 h-4 text-gray-500" />
                                  <span className="text-gray-600">
                                    {sub.service_radius_miles} mi radius
                                  </span>
                                </div>
                                {sub.phone && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <Phone className="w-4 h-4 text-gray-500" />
                                    <a href={`tel:${sub.phone}`} className="text-blue-600 hover:underline">
                                      {sub.phone}
                                    </a>
                                  </div>
                                )}
                                {sub.email && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <Mail className="w-4 h-4 text-gray-500" />
                                    <a href={`mailto:${sub.email}`} className="text-blue-600 hover:underline truncate">
                                      {sub.email}
                                    </a>
                                  </div>
                                )}
                              </div>

                              <div className="flex flex-wrap gap-2 mb-3">
                                {sub.specialty?.map(spec => (
                                  <Badge 
                                    key={spec} 
                                    variant="outline"
                                    className={requiredSpecialty === spec ? 'bg-blue-100 border-blue-500 text-blue-700' : ''}
                                  >
                                    {spec}
                                  </Badge>
                                ))}
                              </div>

                              <div className="flex items-center gap-4 text-sm">
                                {sub.rating > 0 && (
                                  <div className="flex items-center gap-1">
                                    <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                                    <span className="font-medium">{sub.rating}/5</span>
                                  </div>
                                )}
                                {sub.total_jobs_completed > 0 && (
                                  <span className="text-gray-600">
                                    {sub.total_jobs_completed} jobs completed
                                  </span>
                                )}
                                {sub.hourly_rate && (
                                  <span className="text-gray-600">
                                    ${sub.hourly_rate}/hr
                                  </span>
                                )}
                                {sub.per_job_rate && (
                                  <span className="text-gray-600">
                                    ${sub.per_job_rate}/job
                                  </span>
                                )}
                              </div>
                            </div>

                            <Button
                              onClick={() => handleSelectSubcontractor(sub)}
                              className="bg-blue-600 hover:bg-blue-700"
                            >
                              <CheckCircle className="w-4 h-4 mr-2" />
                              Assign
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}