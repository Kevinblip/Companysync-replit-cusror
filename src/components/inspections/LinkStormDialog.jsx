import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, CheckCircle, Cloud } from 'lucide-react';
import { format } from 'date-fns';

export default function LinkStormDialog({ isOpen, onOpenChange, currentStormId, onStormLinked }) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedStormId, setSelectedStormId] = useState(currentStormId || null);

    const { data: stormEvents = [], isLoading } = useQuery({
        queryKey: ['storm-events-all'],
        queryFn: () => base44.entities.StormEvent.list('-start_time', 100),
        initialData: [],
    });

    const filteredStorms = React.useMemo(() => {
        if (!searchQuery) return stormEvents;
        const lowerQuery = searchQuery.toLowerCase();
        return stormEvents.filter(storm => {
            const titleMatch = storm.title?.toLowerCase().includes(lowerQuery);
            const areaMatch = storm.affected_areas?.some(area => area.toLowerCase().includes(lowerQuery));
            const dateMatch = storm.start_time && format(new Date(storm.start_time), 'yyyy-MM-dd').includes(lowerQuery);
            return titleMatch || areaMatch || dateMatch;
        });
    }, [stormEvents, searchQuery]);

    const handleLink = () => {
        onStormLinked(selectedStormId);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>⚡ Link Storm Event</DialogTitle>
                </DialogHeader>
                <div className="flex-1 overflow-hidden">
                    <Command shouldFilter={false}>
                        <CommandInput
                            placeholder="Search storm or city..."
                            value={searchQuery}
                            onValueChange={setSearchQuery}
                        />
                        <CommandList className="max-h-[500px]">
                            {isLoading ? (
                                <div className="py-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading storms...
                                </div>
                            ) : (
                                <>
                                    <CommandEmpty>No storm found.</CommandEmpty>
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
                                                    <div className="flex justify-between items-center">
                                                        <span className="font-semibold">{storm.title}</span>
                                                        <span className="text-xs text-muted-foreground">
                                                            {format(new Date(storm.start_time), 'MMM d, yyyy')}
                                                        </span>
                                                    </div>
                                                    <div className="text-xs text-gray-600 mt-1">
                                                        📍 {storm.affected_areas?.join(', ')}
                                                    </div>
                                                    <div className="flex gap-2 mt-1">
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
                                                    </div>
                                                </div>
                                                {selectedStormId === storm.id && (
                                                    <CheckCircle className="ml-auto h-4 w-4 text-primary" />
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