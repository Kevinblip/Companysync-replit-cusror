import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, Cloud, MapPin } from 'lucide-react';
import { format } from 'date-fns';

/**
 * Extract the 2-letter US state abbreviation from a free-text address string.
 * Handles common formats:
 *   "123 Main St, Atlanta, GA 30301"
 *   "City, GA"
 *   "GA 30301"
 */
function parseStateFromAddress(address) {
    if (!address) return null;
    // Look for ", XX " or ", XX\n" or "XX DDDDD" pattern
    const m = address.match(/,\s*([A-Z]{2})\s*(?:\d{5})?(?:\s*[-–]\s*\d{4})?(?:\s*,|\s*$)/);
    if (m) return m[1];
    // Fallback: bare two-letter token at end
    const m2 = address.trim().match(/\b([A-Z]{2})\s*(?:\d{5})?\s*$/);
    if (m2) return m2[1];
    return null;
}

export default function LinkStormDialog({ isOpen, onOpenChange, currentStormId, onStormLinked, jobAddress }) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedStormId, setSelectedStormId] = useState(currentStormId || null);

    const stateCode = useMemo(() => parseStateFromAddress(jobAddress), [jobAddress]);

    // Use getStormsInArea with a stateFilter when we know the job's state so the
    // list is pre-scoped to relevant events.  Fall back to listStormEvents (all
    // events) only when no address is available.
    const { data: stormEvents = [], isLoading } = useQuery({
        queryKey: ['storm-events-for-link', stateCode],
        queryFn: async () => {
            if (stateCode) {
                // Look back 365 days — covers the full claims window
                const res = await base44.functions.invoke('getStormsInArea', {
                    stateFilter: stateCode,
                    daysBack: 365,
                    limit: 200,
                });
                const storms = res?.data?.storms ?? res?.storms ?? [];
                return storms;
            } else {
                // No location data — load all recent storms
                const res = await base44.functions.invoke('listStormEvents', { limit: 500 });
                return res?.data?.storms ?? res?.storms ?? [];
            }
        },
        enabled: isOpen,
        staleTime: 5 * 60 * 1000,
    });

    const filteredStorms = useMemo(() => {
        if (!searchQuery.trim()) return stormEvents;
        const q = searchQuery.toLowerCase().trim();
        return stormEvents.filter(storm => {
            const titleMatch  = storm.title?.toLowerCase().includes(q);
            const areaMatch   = storm.affected_areas?.some(a => a.toLowerCase().includes(q));
            const stateMatch  = storm.nws_state?.toLowerCase().includes(q);
            // Date search: match however the user types it — "aug 10", "august",
            // "8/10", "8/10/2026", "2026-08-10", or just "2026".
            let dateMatch = false;
            if (storm.start_time) {
                const d = new Date(storm.start_time);
                if (!isNaN(d)) {
                    dateMatch = [
                        format(d, 'yyyy-MM-dd'),
                        format(d, 'MMM d, yyyy'),
                        format(d, 'MMMM d, yyyy'),
                        format(d, 'M/d/yyyy'),
                        format(d, 'M/d'),
                        format(d, 'MM/dd/yyyy'),
                    ].some(s => s.toLowerCase().includes(q));
                }
            }
            return titleMatch || areaMatch || stateMatch || dateMatch;
        });
    }, [stormEvents, searchQuery]);

    const handleLink = () => {
        onStormLinked(selectedStormId);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        ⚡ Link Storm Event
                        {stateCode && (
                            <Badge variant="secondary" className="text-xs font-normal flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                Showing storms near {stateCode}
                            </Badge>
                        )}
                    </DialogTitle>
                    {jobAddress && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                            Job address: {jobAddress}
                        </p>
                    )}
                </DialogHeader>
                <div className="flex-1 overflow-hidden">
                    <Command shouldFilter={false}>
                        <CommandInput
                            placeholder={stateCode ? `Search ${stateCode} storms by name, city, or date…` : 'Search by storm, city, or date…'}
                            value={searchQuery}
                            onValueChange={setSearchQuery}
                        />
                        <CommandList className="max-h-[500px]">
                            {isLoading ? (
                                <div className="py-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {stateCode ? `Loading storms near ${stateCode}…` : 'Loading storms…'}
                                </div>
                            ) : (
                                <>
                                    <CommandEmpty>
                                        {stateCode
                                            ? `No storms found for ${stateCode}. Try searching by city or date.`
                                            : 'No storm found.'}
                                    </CommandEmpty>
                                    <CommandGroup>
                                        <CommandItem
                                            value="none"
                                            onSelect={() => setSelectedStormId(null)}
                                        >
                                            <span className="text-gray-500">None (Remove link)</span>
                                        </CommandItem>
                                        {filteredStorms.map((storm) => (
                                            <CommandItem
                                                key={storm.id}
                                                value={storm.id}
                                                onSelect={() => setSelectedStormId(storm.id)}
                                            >
                                                <div className="flex flex-col w-full">
                                                    <div className="flex justify-between items-center gap-2">
                                                        <span className="font-semibold truncate">{storm.title}</span>
                                                        <span className="text-xs text-muted-foreground shrink-0">
                                                            {storm.start_time && format(new Date(storm.start_time), 'MMM d, yyyy')}
                                                        </span>
                                                    </div>
                                                    {(storm.affected_areas?.length > 0 || storm.nws_state) && (
                                                        <div className="text-xs text-gray-600 mt-1 truncate">
                                                            📍 {storm.affected_areas?.join(', ') || storm.nws_state}
                                                        </div>
                                                    )}
                                                    <div className="flex gap-2 mt-1 flex-wrap">
                                                        {storm.hail_size_inches > 0 && (
                                                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-blue-200 bg-blue-50 text-blue-700">
                                                                {storm.hail_size_inches}" Hail
                                                            </Badge>
                                                        )}
                                                        {storm.wind_speed_mph > 0 && (
                                                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-orange-200 bg-orange-50 text-orange-700">
                                                                {storm.wind_speed_mph} mph Wind
                                                            </Badge>
                                                        )}
                                                        {storm.distance_miles != null && (
                                                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-green-200 bg-green-50 text-green-700">
                                                                ~{storm.distance_miles} mi
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                                {selectedStormId === storm.id && (
                                                    <CheckCircle className="ml-auto h-4 w-4 text-primary shrink-0" />
                                                )}
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                </>
                            )}
                        </CommandList>
                    </Command>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleLink} disabled={selectedStormId === currentStormId}>
                        <Cloud className="w-4 h-4 mr-2" />
                        {selectedStormId ? 'Link Storm' : 'Remove Link'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
