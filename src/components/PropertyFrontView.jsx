import { ExternalLink, Camera } from "lucide-react";

/**
 * Shows a satellite map of the property with a "View Street View" button.
 * Uses a no-API-key Google Maps embed so it always works.
 */
export default function PropertyFrontView({ address, className = '' }) {
  if (!address || address.trim().length < 5) return null;

  const encoded = encodeURIComponent(address);
  // Satellite embed — works with no API key, always shows the property from above
  const embedUrl = `https://maps.google.com/maps?q=${encoded}&t=k&z=19&ie=UTF8&iwloc=&output=embed`;
  // Street view link — opens Google Maps street view in new tab
  const svUrl = `https://www.google.com/maps?q=${encoded}&layer=c&cbp=12,0,,0,0`;

  return (
    <div className={`rounded-lg overflow-hidden border border-gray-200 ${className}`}>
      <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-gray-100">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
          <Camera className="w-3.5 h-3.5 text-indigo-500" />
          Property View
        </div>
        <a
          href={svUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 font-medium"
        >
          Open Street View
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      <div className="relative" style={{ height: '180px' }}>
        <iframe
          title={`Map of ${address}`}
          src={embedUrl}
          width="100%"
          height="180"
          style={{ border: 0, display: 'block' }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>
  );
}
