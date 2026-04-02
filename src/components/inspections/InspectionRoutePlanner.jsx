import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Calendar, ChevronDown, ChevronUp, Route, CheckCircle, Clock, Users } from "lucide-react";
import { format, isToday, isTomorrow, isPast } from "date-fns";
import { toast } from "react-hot-toast";

function extractCity(address) {
  if (!address) return "Unknown Location";
  const parts = address.split(',').map(s => s.trim());
  if (parts.length >= 3) {
    return parts[parts.length - 2].trim();
  }
  if (parts.length === 2) {
    return parts[0].trim();
  }
  return address.split(',')[0].trim() || "Unknown Location";
}

function formatDateLabel(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr + 'T00:00:00');
    if (isToday(d)) return "Today";
    if (isTomorrow(d)) return "Tomorrow";
    return format(d, 'MMM d, yyyy');
  } catch {
    return dateStr;
  }
}

function DateStatusBadge({ dates }) {
  if (!dates || dates.length === 0) {
    return <Badge className="bg-gray-100 text-gray-600 text-xs border-0">No dates set</Badge>;
  }
  if (dates.length === 1) {
    return (
      <Badge className="bg-green-100 text-green-700 text-xs border-0 flex items-center gap-1">
        <CheckCircle className="w-3 h-3" />
        All on {formatDateLabel(dates[0])}
      </Badge>
    );
  }
  return (
    <Badge className="bg-yellow-100 text-yellow-700 text-xs border-0 flex items-center gap-1">
      <Clock className="w-3 h-3" />
      {dates.length} different dates
    </Badge>
  );
}

export default function InspectionRoutePlanner({ inspections, onUpdateDates, isUpdating }) {
  const [expandedCity, setExpandedCity] = useState(null);
  const [selectedByCity, setSelectedByCity] = useState({});
  const [dateByCity, setDateByCity] = useState({});

  const cityGroups = useMemo(() => {
    const groups = {};
    for (const inspection of inspections) {
      const city = extractCity(inspection.property_address);
      if (!groups[city]) groups[city] = [];
      groups[city].push(inspection);
    }
    return Object.entries(groups)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([city, items]) => {
        const dates = [...new Set(items.map(i => i.inspection_date).filter(Boolean))];
        return {
          city,
          inspections: items,
          uniqueDates: dates,
          allSameDay: dates.length <= 1,
        };
      });
  }, [inspections]);

  const toggleSelection = (city, id) => {
    setSelectedByCity(prev => {
      const set = new Set(prev[city] || []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, [city]: new Set(set) };
    });
  };

  const toggleSelectAll = (city, ids) => {
    setSelectedByCity(prev => {
      const current = prev[city] || new Set();
      const allSelected = ids.every(id => current.has(id));
      return { ...prev, [city]: allSelected ? new Set() : new Set(ids) };
    });
  };

  const scheduleSelected = async (city, cityInspections) => {
    const date = dateByCity[city];
    if (!date) {
      toast.error("Please pick a date first.");
      return;
    }
    const selected = selectedByCity[city] || new Set();
    if (selected.size === 0) {
      toast.error("Select at least one inspection.");
      return;
    }
    const ids = [...selected];
    await onUpdateDates(ids, date);
    setSelectedByCity(prev => ({ ...prev, [city]: new Set() }));
    toast.success(`Scheduled ${ids.length} inspection${ids.length > 1 ? 's' : ''} for ${formatDateLabel(date)}`);
  };

  const totalInspections = inspections.length;
  const groupedCount = cityGroups.filter(g => g.inspections.length > 1).length;

  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
        <Route className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-semibold text-blue-900">Route Planner</p>
          <p className="text-sm text-blue-700 mt-0.5">
            {totalInspections} inspection{totalInspections !== 1 ? 's' : ''} grouped by city.
            {groupedCount > 0 && ` ${groupedCount} area${groupedCount > 1 ? 's' : ''} have multiple jobs — schedule them on the same day to save travel time.`}
          </p>
        </div>
      </div>

      {cityGroups.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <MapPin className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No inspections to plan</p>
          <p className="text-sm mt-1">Add inspections with addresses to get started.</p>
        </div>
      )}

      {cityGroups.map(({ city, inspections: cityInspections, uniqueDates, allSameDay }) => {
        const isExpanded = expandedCity === city;
        const selectedSet = selectedByCity[city] || new Set();
        const selectedCount = selectedSet.size;
        const allSelected = cityInspections.length > 0 && cityInspections.every(i => selectedSet.has(i.id));
        const hasMultiple = cityInspections.length > 1;

        return (
          <Card key={city} className={`overflow-hidden transition-shadow hover:shadow-md ${
            allSameDay && uniqueDates.length === 1 ? 'border-green-200' : 
            hasMultiple ? 'border-blue-200' : 'border-gray-200'
          }`}>
            <CardHeader
              className={`cursor-pointer py-4 ${
                allSameDay && uniqueDates.length === 1 ? 'bg-green-50' :
                hasMultiple ? 'bg-blue-50' : 'bg-gray-50'
              }`}
              onClick={() => setExpandedCity(isExpanded ? null : city)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    hasMultiple ? 'bg-blue-100' : 'bg-gray-100'
                  }`}>
                    <MapPin className={`w-5 h-5 ${hasMultiple ? 'text-blue-600' : 'text-gray-500'}`} />
                  </div>
                  <div>
                    <CardTitle className="text-base font-semibold">{city}</CardTitle>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        <Users className="w-3 h-3 mr-1" />
                        {cityInspections.length} job{cityInspections.length > 1 ? 's' : ''}
                      </Badge>
                      <DateStatusBadge dates={uniqueDates} />
                      {hasMultiple && (
                        <span className="text-xs text-blue-600 font-medium">
                          💡 Group these together!
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3 border border-gray-200 flex-wrap gap-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => toggleSelectAll(city, cityInspections.map(i => i.id))}
                      className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                    />
                    <span className="text-sm font-medium text-gray-700">
                      {allSelected ? 'Deselect all' : 'Select all'}
                    </span>
                  </label>
                  <div className="flex-1" />
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <input
                      type="date"
                      value={dateByCity[city] || ''}
                      onChange={e => setDateByCity(prev => ({ ...prev, [city]: e.target.value }))}
                      className="border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => scheduleSelected(city, cityInspections)}
                    disabled={selectedCount === 0 || !dateByCity[city] || isUpdating}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    data-testid={`btn-schedule-${city}`}
                  >
                    <Calendar className="w-3 h-3 mr-1" />
                    {selectedCount > 0 ? `Schedule ${selectedCount} Job${selectedCount > 1 ? 's' : ''}` : 'Schedule Selected'}
                  </Button>
                </div>

                <div className="space-y-2">
                  {cityInspections.map(inspection => {
                    const isSelected = selectedSet.has(inspection.id);
                    const dateLabel = formatDateLabel(inspection.inspection_date);
                    return (
                      <label
                        key={inspection.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200 hover:bg-gray-50'
                        }`}
                        data-testid={`inspection-row-${inspection.id}`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelection(city, inspection.id)}
                          className="w-4 h-4 rounded border-gray-300 flex-shrink-0 cursor-pointer"
                        />
                        <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-gray-900 truncate">
                            {inspection.customer_name || 'Unknown Customer'}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{inspection.property_address}</p>
                        </div>
                        <div className={`flex items-center gap-1 text-xs flex-shrink-0 px-2 py-1 rounded-full ${
                          dateLabel ? 'bg-gray-100 text-gray-600' : 'bg-orange-50 text-orange-600'
                        }`}>
                          <Calendar className="w-3 h-3" />
                          {dateLabel || 'No date'}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
