import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function SignaturePad({ onSave, onSignatureChange, onCancel }) {
  const drawCanvasRef = useRef(null);
  const typeCanvasRef = useRef(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [signatureMode, setSignatureMode] = useState('draw');
  const [typedName, setTypedName] = useState('');
  const [selectedFont, setSelectedFont] = useState('Dancing Script');

  const signatureFonts = [
    { name: 'Dancing Script', style: 'cursive' },
    { name: 'Pacifico', style: 'cursive' },
    { name: 'Great Vibes', style: 'cursive' },
    { name: 'Allura', style: 'cursive' },
    { name: 'Sacramento', style: 'cursive' },
    { name: 'Satisfy', style: 'cursive' },
    { name: 'Alex Brush', style: 'cursive' },
    { name: 'Tangerine', style: 'cursive' },
    { name: 'Pinyon Script', style: 'cursive' },
    { name: 'Yellowtail', style: 'cursive' }
  ];

  // Load Google Fonts
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Pacifico&family=Great+Vibes&family=Allura&family=Sacramento&family=Satisfy&family=Alex+Brush&family=Tangerine:wght@700&family=Pinyon+Script&family=Yellowtail&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    
    return () => {
      if (document.head.contains(link)) {
        document.head.removeChild(link);
      }
    };
  }, []);

  // Setup drawing canvas
  useEffect(() => {
    if (signatureMode !== 'draw') return;
    
    const canvas = drawCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Set canvas size
    canvas.width = 600;
    canvas.height = 200;
    
    // White background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Drawing style
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    const getCoords = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      if (e.touches && e.touches[0]) {
        return {
          x: (e.touches[0].clientX - rect.left) * scaleX,
          y: (e.touches[0].clientY - rect.top) * scaleY
        };
      }
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    };

    const startDrawing = (e) => {
      e.preventDefault();
      isDrawing = true;
      setIsDrawing(true);
      const coords = getCoords(e);
      lastX = coords.x;
      lastY = coords.y;
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
    };

    const draw = (e) => {
      if (!isDrawing) return;
      e.preventDefault();
      
      const coords = getCoords(e);
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
      lastX = coords.x;
      lastY = coords.y;
    };

    const stopDrawing = (e) => {
      if (!isDrawing) return;
      e.preventDefault();
      
      isDrawing = false;
      setIsDrawing(false);
      setHasSignature(true);
      
      if (onSignatureChange) {
        const signatureData = canvas.toDataURL('image/png');
        console.log('✍️ Signature captured (draw mode)');
        onSignatureChange(signatureData, true);
      }
    };

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);
    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing, { passive: false });

    return () => {
      canvas.removeEventListener('mousedown', startDrawing);
      canvas.removeEventListener('mousemove', draw);
      canvas.removeEventListener('mouseup', stopDrawing);
      canvas.removeEventListener('mouseleave', stopDrawing);
      canvas.removeEventListener('touchstart', startDrawing);
      canvas.removeEventListener('touchmove', draw);
      canvas.removeEventListener('touchend', stopDrawing);
    };
  }, [signatureMode, onSignatureChange]);

  // Generate typed signature
  useEffect(() => {
    if (signatureMode !== 'type' || !typedName) {
      if (signatureMode === 'type' && !typedName) {
        setHasSignature(false);
        if (onSignatureChange) {
          onSignatureChange(null, false);
        }
      }
      return;
    }

    const canvas = typeCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = 600;
    canvas.height = 200;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#000000';
    ctx.font = `60px "${selectedFont}", cursive`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(typedName, canvas.width / 2, canvas.height / 2);

    setHasSignature(true);

    if (onSignatureChange) {
      const signatureData = canvas.toDataURL('image/png');
      console.log('✍️ Signature captured (type mode):', typedName);
      onSignatureChange(signatureData, true);
    }
  }, [typedName, selectedFont, signatureMode, onSignatureChange]);

  const clear = () => {
    setHasSignature(false);
    setTypedName('');
    
    if (signatureMode === 'draw' && drawCanvasRef.current) {
      const ctx = drawCanvasRef.current.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, drawCanvasRef.current.width, drawCanvasRef.current.height);
    } else if (signatureMode === 'type' && typeCanvasRef.current) {
      const ctx = typeCanvasRef.current.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, typeCanvasRef.current.width, typeCanvasRef.current.height);
    }
    
    if (onSignatureChange) {
      console.log('🗑️ Signature cleared');
      onSignatureChange(null, false);
    }
  };

  const handleModeChange = (newMode) => {
    setSignatureMode(newMode);
    setHasSignature(false);
    setTypedName('');
    if (onSignatureChange) {
      onSignatureChange(null, false);
    }
  };

  const handleSave = () => {
    if (!hasSignature) {
      alert('Please add a signature first');
      return;
    }
    
    const canvas = signatureMode === 'draw' ? drawCanvasRef.current : typeCanvasRef.current;
    if (!canvas) return;
    
    const signatureData = canvas.toDataURL('image/png');
    console.log('💾 Saving signature');
    
    if (onSave) {
      onSave(signatureData);
    } else if (onSignatureChange) {
      onSignatureChange(signatureData, true);
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={signatureMode} onValueChange={handleModeChange}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="draw">✏️ Draw Signature</TabsTrigger>
          <TabsTrigger value="type">⌨️ Type Signature</TabsTrigger>
        </TabsList>

        <TabsContent value="draw" className="space-y-3">
          <div className="bg-gray-50 p-2 rounded border-2 border-blue-300">
            <canvas
              ref={drawCanvasRef}
              className="w-full bg-white cursor-crosshair rounded"
              style={{ 
                height: '150px',
                touchAction: 'none',
                display: 'block'
              }}
            />
          </div>
          {isDrawing && (
            <p className="text-sm text-blue-600 font-medium">
              ✍️ Drawing...
            </p>
          )}
        </TabsContent>

        <TabsContent value="type" className="space-y-3">
          <div>
            <Label>Your Name</Label>
            <Input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Type your full name"
              className="text-lg"
            />
          </div>

          <div>
            <Label>Signature Style</Label>
            <Select value={selectedFont} onValueChange={setSelectedFont}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {signatureFonts.map((font) => (
                  <SelectItem 
                    key={font.name} 
                    value={font.name}
                    style={{ fontFamily: `"${font.name}", ${font.style}`, fontSize: '18px' }}
                  >
                    {font.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="bg-gray-50 p-2 rounded border-2 border-blue-300">
            <canvas
              ref={typeCanvasRef}
              className="w-full bg-white rounded"
              style={{ height: '150px', display: 'block' }}
            />
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={clear}
        >
          Clear
        </Button>
        {hasSignature && !isDrawing && (
          <span className="text-sm text-green-600 font-medium flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Ready to save
          </span>
        )}
        <div className="flex gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
          {onSave && (
            <Button
              type="button"
              onClick={handleSave}
              disabled={!hasSignature}
            >
              Save Signature
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}