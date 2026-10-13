import React, { useRef, useEffect, useState, useCallback } from 'react';
import { MapPin } from 'lucide-react';
import { base44 } from '@/api/base44Client';

/**
 * Address entry field with a Google-powered suggestions dropdown.
 *
 * IMPORTANT — why this does NOT use google.maps.places.Autocomplete (the legacy
 * widget):
 * The legacy widget attaches itself to the <input> and writes directly to its DOM
 * value. In this app that fought with React and froze typing after the first
 * character (you could type "5" of "5420" and no more). Instead, this component
 * uses the prediction SERVICE (AutocompleteService.getPlacePredictions) and
 * renders its OWN dropdown with React state. Nothing external touches the input,
 * so a normal controlled input is safe and never freezes.
 *
 * onAddressSelect(address, place):
 *  - Picking a suggestion → fires with a place object containing geometry
 *    (geometry.location.lat()/lng()), so consumers get coordinates directly.
 *  - Enter / "Find" with no suggestion picked → fires with null details, and the
 *    consumer resolves coordinates server-side (geocodeAddress).
 */
export function GoogleAddressAutocomplete({
  onAddressSelect,
  onAddressChange,
  placeholder = "Enter property address...",
  initialAddress = "",
}) {
  const [inputValue, setInputValue] = useState(initialAddress || "");
  const [predictions, setPredictions] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const containerRef = useRef(null);
  const isFocusedRef = useRef(false);
  const debounceRef = useRef(null);
  const readyRetryRef = useRef(null);          // timer used while Maps is still loading
  const latestQueryRef = useRef('');           // newest typed text (drops stale results)
  const reqSeqRef = useRef(0);                  // request id (drops out-of-order responses)
  const lastFiredRef = useRef({ value: '', time: 0 });

  const serviceRef = useRef(null);      // AutocompleteService
  const placesServiceRef = useRef(null); // PlacesService (for geometry lookups)
  const sessionTokenRef = useRef(null);

  const onAddressSelectRef = useRef(onAddressSelect);
  useEffect(() => { onAddressSelectRef.current = onAddressSelect; }, [onAddressSelect]);
  const onAddressChangeRef = useRef(onAddressChange);
  useEffect(() => { onAddressChangeRef.current = onAddressChange; }, [onAddressChange]);

  // AIEstimator loads Maps at page level, but this component is also used on
  // pages that can be opened directly (such as Storm Tracking). Make the
  // reusable field self-sufficient without adding the legacy Autocomplete
  // widget that caused the one-character typing freeze.
  useEffect(() => {
    let cancelled = false;
    const loadPlacesLibrary = async () => {
      if (window.google?.maps?.places) return;

      const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
      if (existingScript || window.__companysyncGoogleMapsLoading) return;
      window.__companysyncGoogleMapsLoading = true;
      let scriptAppended = false;

      try {
        let apiKey = '';
        try { apiKey = sessionStorage.getItem('_gmaps_key') || ''; } catch (_) {}
        if (!apiKey) {
          const response = await base44.functions.invoke('getGoogleMapsApiKey');
          apiKey = response?.data?.apiKey || '';
          if (apiKey) {
            try { sessionStorage.setItem('_gmaps_key', apiKey); } catch (_) {}
          }
        }
        if (!apiKey || cancelled || document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]')) return;

        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places,geometry`;
        script.async = true;
        script.defer = true;
        script.dataset.companysyncMaps = 'true';
        script.onload = () => { window.__companysyncGoogleMapsLoading = false; };
        script.onerror = () => {
          window.__companysyncGoogleMapsLoading = false;
          console.warn('[GoogleAddressAutocomplete] Failed to load Google Places');
        };
        document.head.appendChild(script);
        scriptAppended = true;
      } catch (error) {
        window.__companysyncGoogleMapsLoading = false;
        console.warn('[GoogleAddressAutocomplete] Could not load Google Places:', error.message);
      } finally {
        if (!scriptAppended) window.__companysyncGoogleMapsLoading = false;
      }
    };
    loadPlacesLibrary();
    return () => { cancelled = true; };
  }, []);

  // Keep the input in sync with an external initialAddress (e.g. pre-fill from a
  // customer record), but never overwrite what the user is actively typing.
  useEffect(() => {
    if (isFocusedRef.current) return;
    if (initialAddress !== undefined && initialAddress !== null) {
      setInputValue(initialAddress);
    }
  }, [initialAddress]);

  // Lazily create the Google services once the places library is ready.
  const ensureServices = useCallback(() => {
    if (!window.google?.maps?.places) return false;
    if (!serviceRef.current) {
      serviceRef.current = new window.google.maps.places.AutocompleteService();
    }
    if (!placesServiceRef.current) {
      placesServiceRef.current = new window.google.maps.places.PlacesService(document.createElement('div'));
    }
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
    }
    return true;
  }, []);

  const fireAddress = useCallback((address, details) => {
    const value = (address || '').trim();
    if (value.length < 5) return;
    const now = Date.now();
    const last = lastFiredRef.current;
    if (value === last.value && now - last.time < 1500) return; // suppress rapid duplicates only
    lastFiredRef.current = { value, time: now };
    if (onAddressSelectRef.current) onAddressSelectRef.current(value, details || null);
  }, []);

  const fetchPredictions = useCallback((text) => {
    if (readyRetryRef.current) { clearTimeout(readyRetryRef.current); readyRetryRef.current = null; }
    if (!text || text.trim().length < 3) {
      setPredictions([]);
      setOpen(false);
      return;
    }
    if (!ensureServices()) {
      // Maps not ready yet — retry once shortly, but only while this is still the
      // latest query, and keep the timer so it can be cleared on unmount.
      readyRetryRef.current = setTimeout(() => {
        if (latestQueryRef.current === text) fetchPredictions(text);
      }, 400);
      return;
    }
    const seq = ++reqSeqRef.current;
    serviceRef.current.getPlacePredictions(
      {
        input: text,
        componentRestrictions: { country: 'us' },
        types: ['address'],
        sessionToken: sessionTokenRef.current,
      },
      (preds, status) => {
        // Drop stale/out-of-order responses: a newer keystroke superseded this.
        if (seq !== reqSeqRef.current || latestQueryRef.current !== text) return;
        if (status === window.google.maps.places.PlacesServiceStatus.OK && preds?.length) {
          setPredictions(preds);
          setOpen(true);
          setHighlight(-1);
        } else {
          setPredictions([]);
          setOpen(false);
        }
      }
    );
  }, [ensureServices]);

  const handleChange = (e) => {
    const v = e.target.value;
    setInputValue(v);
    if (onAddressChangeRef.current) onAddressChangeRef.current(v);
    latestQueryRef.current = v;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(v), 220);
  };

  const selectPrediction = useCallback((pred) => {
    if (!pred) return;
    const description = pred.description || '';
    setInputValue(description);
    if (onAddressChangeRef.current) onAddressChangeRef.current(description);
    setPredictions([]);
    setOpen(false);
    setHighlight(-1);

    // Resolve geometry (coordinates) via Place Details; fall back to server-side
    // geocoding (details=null) if anything goes wrong.
    if (placesServiceRef.current && pred.place_id) {
      placesServiceRef.current.getDetails(
        {
          placeId: pred.place_id,
          fields: ['formatted_address', 'geometry', 'address_components', 'place_id'],
          sessionToken: sessionTokenRef.current,
        },
        (place, status) => {
          // Reset the session token after a completed lookup (Google billing).
          sessionTokenRef.current = window.google?.maps?.places
            ? new window.google.maps.places.AutocompleteSessionToken()
            : null;
          if (status === window.google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
            const addr = place.formatted_address || description;
            setInputValue(addr);
            if (onAddressChangeRef.current) onAddressChangeRef.current(addr);
            fireAddress(addr, place);
          } else {
            fireAddress(description, null);
          }
        }
      );
    } else {
      fireAddress(description, null);
    }
  }, [fireAddress]);

  const submitManual = useCallback(() => {
    fireAddress(inputValue, null);
    setOpen(false);
  }, [fireAddress, inputValue]);

  const handleKeyDown = (e) => {
    if (open && predictions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % predictions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h <= 0 ? predictions.length - 1 : h - 1));
        return;
      }
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault(); // don't submit a surrounding form
      if (open && highlight >= 0 && predictions[highlight]) {
        selectPrediction(predictions[highlight]);
      } else {
        submitManual();
      }
    }
  };

  // Close the dropdown when clicking outside the component.
  useEffect(() => {
    const onDocMouseDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (readyRetryRef.current) clearTimeout(readyRetryRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none">
        <MapPin className="w-4 h-4 text-green-600" />
      </div>
      <input
        type="text"
        value={inputValue}
        placeholder={placeholder}
        autoComplete="off"
        className="flex h-9 w-full rounded-md border border-green-500 bg-white px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus:border-green-600 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm pl-10"
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { isFocusedRef.current = true; if (predictions.length > 0) setOpen(true); }}
        onBlur={() => { isFocusedRef.current = false; }}
        data-testid="input-property-address"
      />

      {open && predictions.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-[100000] rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden"
          data-testid="list-address-suggestions"
        >
          {predictions.map((pred, i) => {
            const main = pred.structured_formatting?.main_text || pred.description;
            const secondary = pred.structured_formatting?.secondary_text || '';
            return (
              <button
                key={pred.place_id || i}
                type="button"
                // onMouseDown (not onClick) so it fires before the input blur.
                onMouseDown={(e) => { e.preventDefault(); selectPrediction(pred); }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-start gap-2 px-4 py-3 text-left text-sm border-t border-gray-100 first:border-t-0 ${i === highlight ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                data-testid={`suggestion-address-${i}`}
              >
                <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                <span className="leading-snug">
                  <span className="font-medium text-gray-900">{main}</span>
                  {secondary ? <span className="text-gray-500">{' '}{secondary}</span> : null}
                </span>
              </button>
            );
          })}
          <div className="flex justify-end px-3 py-1.5 bg-gray-50 border-t border-gray-100">
            <span className="text-[10px] text-gray-400">powered by Google</span>
          </div>
        </div>
      )}
    </div>
  );
}
