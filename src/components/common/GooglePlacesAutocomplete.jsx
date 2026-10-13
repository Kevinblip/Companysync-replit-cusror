import React, { useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';

export default function GooglePlacesAutocomplete({ apiKey, value, onPlaceSelected, onChange }) {
    const inputRef = useRef(null);
    const autocompleteRef = useRef(null);

    useEffect(() => {
        if (!apiKey || !inputRef.current) return;

        // Load Google Maps script
        if (!window.google) {
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
            script.async = true;
            script.defer = true;
            script.onload = initAutocomplete;
            document.head.appendChild(script);
        } else {
            initAutocomplete();
        }

        function initAutocomplete() {
            if (!window.google || !inputRef.current) return;

            autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
                types: ['address'],
                componentRestrictions: { country: 'us' }
            });

            autocompleteRef.current.addListener('place_changed', () => {
                const place = autocompleteRef.current.getPlace();
                if (place.formatted_address) {
                    // Call the parent's handler with the full address
                    onPlaceSelected(place.formatted_address);
                    
                    // Also trigger onChange to ensure React state updates
                    if (onChange) {
                        onChange({ target: { value: place.formatted_address } });
                    }
                }
            });
        }

        return () => {
            if (autocompleteRef.current && window.google) {
                window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
            }
        };
    }, [apiKey, onPlaceSelected]);

    return (
        <Input
            ref={inputRef}
            value={value}
            onChange={onChange}
            placeholder="Start typing an address..."
            autoComplete="new-password"
            onKeyDown={(e) => {
                // Prevent form submission on Enter when autocomplete is open
                if (e.key === 'Enter' && document.querySelector('.pac-container:not([style*="display: none"])')) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }}
        />
    );
}