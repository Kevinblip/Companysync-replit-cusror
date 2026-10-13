import React, { useRef, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function AnnotatedRoofView({ satelliteImageUrl, satelliteImageBase64, detectedLines, measurements }) {
  const containerRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [visibleLayers, setVisibleLayers] = useState({
    ridge: true,
    hip: true,
    valley: true,
    rake: true,
    eave: true,
    step_flashing: true
  });

  const imageToDisplay = satelliteImageBase64 || satelliteImageUrl;

  const lineConfig = {
    ridge: { color: '#9333ea', label: 'Ridge', width: 4 },
    hip: { color: '#3b82f6', label: 'Hip', width: 4 },
    valley: { color: '#10b981', label: 'Valley', width: 4 },
    rake: { color: '#f97316', label: 'Rake', width: 4 },
    eave: { color: '#ef4444', label: 'Eave', width: 4 },
    step_flashing: { color: '#eab308', label: 'Step Flashing', width: 3 }
  };

  const handleImageLoad = (e) => {
    console.log('✅ Image loaded successfully');
    const img = e.target;
    setImageDimensions({ width: img.offsetWidth, height: img.offsetHeight });
    setImageLoaded(true);
    setImageError(false);
  };

  const handleImageError = (e) => {
    console.error('❌ Failed to load satellite image:', e);
    setImageError(true);
    setImageLoaded(false);
  };

  // Convert normalized coordinates (0-1000) to percentage for CSS positioning
  const getLineStyle = (line, config) => {
    const x1Pct = (line.x1 / 1000) * 100;
    const y1Pct = (line.y1 / 1000) * 100;
    const x2Pct = (line.x2 / 1000) * 100;
    const y2Pct = (line.y2 / 1000) * 100;
    
    // Calculate line length and angle
    const dx = x2Pct - x1Pct;
    const dy = y2Pct - y1Pct;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    return {
      position: 'absolute',
      left: `${x1Pct}%`,
      top: `${y1Pct}%`,
      width: `${length}%`,
      height: `${config.width}px`,
      backgroundColor: config.color,
      transform: `rotate(${angle}deg)`,
      transformOrigin: '0 50%',
      boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
      borderRadius: '2px',
      zIndex: 10
    };
  };

  const toggleLayer = (layer) => {
    setVisibleLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  };

  const hasAnyLines = detectedLines && Object.values(detectedLines).some(lines => lines && Array.isArray(lines) && lines.length > 0);

  console.log('🎨 AnnotatedRoofView rendering:', { 
    hasImageUrl: !!satelliteImageUrl, 
    hasLines: hasAnyLines,
    imageLoaded,
    detectedLines 
  });

  if (!imageToDisplay) {
    console.log('❌ No satellite image provided');
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-500">Waiting for satellite image...</p>
        </CardContent>
      </Card>
    );
  }

  if (!hasAnyLines) {
    console.log('⚠️ No lines detected, returning null to show Google Maps view');
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="w-5 h-5 text-purple-600" />
            Gemini Vision - Detected Roof Features
          </CardTitle>
          <Badge className="bg-purple-100 text-purple-700">
            Interactive View
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Layer Toggle Controls */}
        <div className="flex flex-wrap gap-2 p-3 bg-gray-50 rounded-lg border">
          {Object.entries(lineConfig).map(([key, config]) => {
            const lineCount = detectedLines[key]?.length || 0;
            const measurement = measurements?.[`${key}_lf`] || 0;
            const confidence = measurements?.[`${key}_confidence`] || 0;
            
            if (lineCount === 0) return null;

            return (
              <Button
                key={key}
                variant={visibleLayers[key] ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleLayer(key)}
                className="text-xs"
                style={visibleLayers[key] ? { backgroundColor: config.color, borderColor: config.color } : {}}
              >
                {visibleLayers[key] ? <Eye className="w-3 h-3 mr-1" /> : <EyeOff className="w-3 h-3 mr-1" />}
                {config.label} ({lineCount}) • {measurement} LF • {confidence}%
              </Button>
            );
          })}
        </div>

        {/* Annotated Image with SVG Overlay */}
        <div ref={containerRef} className="relative">
          {!imageLoaded && !imageError && (
            <div className="flex items-center justify-center bg-gray-100 rounded-lg min-h-[300px]">
              <div className="text-center">
                <div className="animate-spin w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full mx-auto mb-2"></div>
                <p className="text-sm text-gray-600">Loading satellite view...</p>
              </div>
            </div>
          )}
          
          {imageError && (
            <div className="min-h-[300px] flex items-center justify-center bg-gray-100 rounded-lg absolute inset-0 z-0">
              <p className="text-sm text-red-600">Could not load satellite image - Showing detected lines only</p>
            </div>
          )}

          <img 
            src={imageToDisplay} 
            alt="Satellite view with roof lines" 
            className="w-full rounded-lg shadow-lg border-2 border-gray-200"
            style={{ maxHeight: '600px', objectFit: 'contain', display: imageLoaded ? 'block' : 'none' }}
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
          
          {/* SVG Overlay for Lines */}
          {(imageLoaded || imageError) && detectedLines && (
            <svg 
              className="absolute inset-0 w-full h-full pointer-events-none z-10"
              style={{ maxHeight: '600px', position: imageError ? 'relative' : 'absolute', minHeight: imageError ? '300px' : 'auto' }}
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
            >
              {Object.entries(detectedLines).map(([type, lines]) => {
                if (!visibleLayers[type] || !lines || lines.length === 0) return null;
                const config = lineConfig[type];
                if (!config) return null;
                
                return lines.map((line, idx) => (
                  <g key={`${type}-${idx}`}>
                    <line
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                      stroke={config.color}
                      strokeWidth={config.width * 2.5}
                      strokeLinecap="round"
                      filter="drop-shadow(0 2px 2px rgba(0,0,0,0.5))"
                    />
                    <text
                      x={(line.x1 + line.x2) / 2 + 10}
                      y={(line.y1 + line.y2) / 2 - 10}
                      fill={config.color}
                      fontSize="28"
                      fontWeight="bold"
                      style={{ textShadow: '0 0 4px white, 0 0 4px white' }}
                    >
                      {config.label}
                    </text>
                  </g>
                ));
              })}
            </svg>
          )}
        </div>

        {/* Legend */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          {Object.entries(lineConfig).map(([key, config]) => {
            const lineCount = detectedLines[key]?.length || 0;
            if (lineCount === 0) return null;
            
            return (
              <div key={key} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                <div 
                  className="w-4 h-4 rounded-full" 
                  style={{ backgroundColor: config.color }}
                ></div>
                <span className="font-medium">{config.label}</span>
                <span className="text-gray-500">({lineCount} lines)</span>
              </div>
            );
          })}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs text-blue-900">
            <strong>💡 How to use:</strong> Click the colored buttons above to show/hide different roof features. 
            Each color represents a different type of roof line detected by Gemini Vision AI.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}