import React, { useRef, useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, MapPin } from 'lucide-react';

export function GoogleAddressAutocomplete({ onAddressSelect, placeholder = "Enter property address...", initialAddress = "" }) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inputValue, setInputValue] = useState(initialAddress || '');
  const isSelectingRef = useRef(false);
  
  const onAddressSelectRef = useRef(onAddressSelect);
  useEffect(() => {
    onAddressSelectRef.current = onAddressSelect;
  }, [onAddressSelect]);

  // Sync initial address
  useEffect(() => {
    if (initialAddress !== undefined && initialAddress !== inputValue) {
      setInputValue(initialAddress || '');
    }
  }, [initialAddress]);

  useEffect(() => {
    const initAutocomplete = () => {
      if (!window.google?.maps?.places) {
        return false;
      }

      if (!inputRef.current) {
        return false;
      }

      // Don't re-initialize if already done
      if (autocompleteRef.current) {
        setIsLoading(false);
        return true;
      }

      try {
        console.log('🚀 Initializing Google Places Autocomplete...');
        
        const options = {
          types: ['geocode', 'establishment'],
          componentRestrictions: { country: 'us' },
          fields: ['formatted_address', 'geometry', 'address_components', 'place_id']
        };

        autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, options);

        autocompleteRef.current.addListener('place_changed', () => {
          isSelectingRef.current = true;
          const place = autocompleteRef.current.getPlace();
          console.log('🔍 Place selected:', place);

          if (!place?.place_id) {
            const typedValue = inputRef.current?.value || '';
            if (typedValue && onAddressSelectRef.current) {
              onAddressSelectRef.current(typedValue, null);
            }
            isSelectingRef.current = false;
            return;
          }

          let fullAddress = place.formatted_address;

          if (place.address_components) {
            const getComponent = (type) => place.address_components.find(c => c.types.includes(type));
            
            const streetNum = getComponent('street_number')?.long_name || '';
            const street = getComponent('route')?.long_name || '';
            const city = getComponent('locality')?.long_name || 
                         getComponent('sublocality')?.long_name || 
                         getComponent('neighborhood')?.long_name || '';
            const state = getComponent('administrative_area_level_1')?.short_name || '';
            const zip = getComponent('postal_code')?.long_name || '';

            if (street && city && state) {
              fullAddress = `${streetNum} ${street}`.trim();
              fullAddress += `, ${city}, ${state}`;
              if (zip) fullAddress += ` ${zip}`;
            }
          }

          console.log('✅ Address selected:', fullAddress);
          setInputValue(fullAddress);
          
          if (onAddressSelectRef.current) {
            onAddressSelectRef.current(fullAddress, place);
          }

          setTimeout(() => {
            isSelectingRef.current = false;
          }, 300);
        });

        setIsLoading(false);
        console.log('✅ Google Places Autocomplete initialized');
        return true;
      } catch (err) {
        console.error('Error initializing Google Places:', err);
        setError('Failed to initialize address autocomplete');
        setIsLoading(false);
        return false;
      }
    };

    // Try immediately
    if (!initAutocomplete()) {
      const retryInterval = setInterval(() => {
        if (initAutocomplete()) {
          clearInterval(retryInterval);
        }
      }, 500);
      
      // Stop retrying after 10 seconds
      setTimeout(() => {
        clearInterval(retryInterval);
        if (!autocompleteRef.current) {
          setError('Google Maps failed to load. Please refresh the page.');
          setIsLoading(false);
        }
      }, 10000);

      return () => {
        clearInterval(retryInterval);
      };
    }
  }, []);

  if (error) {
    return (
      <Alert className="border-red-200 bg-red-50">
        <AlertDescription className="text-red-800">{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="relative w-full">
      {isLoading && (
        <div className="absolute left-3 top-1/2 transform -translate-y-1/2 z-10">
          <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
        </div>
      )}
      {!isLoading && (
        <div className="absolute left-3 top-1/2 transform -translate-y-1/2 z-10">
          <MapPin className="w-4 h-4 text-green-600" />
        </div>
      )}
      <input
        ref={inputRef}
        type="text"
        placeholder={isLoading ? "Loading..." : placeholder}
        className={`flex h-9 w-full rounded-md border bg-white px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm pl-10 ${!isLoading ? 'border-green-500 focus:border-green-600' : 'border-input'}`}
        disabled={isLoading}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={() => {
          setTimeout(() => {
            if (isSelectingRef.current) return;
            const currentValue = inputRef.current?.value || '';
            if (currentValue && onAddressSelectRef.current) {
              onAddressSelectRef.current(currentValue, null);
            }
          }, 300);
        }}
      />
      
      <style>{`
        .pac-container {
          background-color: white !important;
          border-radius: 8px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          border: 1px solid #e5e7eb;
          margin-top: 4px;
          font-family: inherit;
          z-index: 2147483647 !important;
          position: fixed !important;
        }
        
        .pac-item {
          padding: 12px 16px;
          cursor: pointer;
          border-top: 1px solid #f3f4f6;
          font-size: 14px;
          line-height: 1.5;
        }
        
        .pac-item:first-child {
          border-top: none;
        }
        
        .pac-item:hover {
          background-color: #f9fafb;
        }
        
        .pac-item-selected,
        .pac-item-selected:hover {
          background-color: #eff6ff;
        }
        
        .pac-icon {
          display: none;
        }
        
        .pac-item-query {
          font-weight: 500;
          color: #111827;
        }
        
        .pac-matched {
          font-weight: 600;
          color: #2563eb;
        }
      `}</style>
    </div>
  );
}