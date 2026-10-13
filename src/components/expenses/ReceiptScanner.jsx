import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, Upload, X, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function ReceiptScanner({ onDataExtracted, onReceiptUploaded }) {
  const [cameraMode, setCameraMode] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
      streamRef.current = stream;
      
      setCameraMode(true);
      
      // Wait for next frame to ensure DOM is updated
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('autoplay', 'true');
        
        try {
          await videoRef.current.play();
          console.log('✅ Video stream started successfully');
        } catch (playError) {
          console.error('Video play error:', playError);
          // Try one more time
          setTimeout(() => {
            videoRef.current?.play().catch(e => console.error('Retry play failed:', e));
          }, 500);
        }
      }
    } catch (error) {
      console.error('Camera error:', error);
      toast.error('Camera access denied: ' + error.message);
      setCameraMode(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraMode(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0);

    canvas.toBlob(async (blob) => {
      if (blob) {
        await processReceipt(blob, 'captured-receipt.jpg');
      }
    }, 'image/jpeg', 0.95);
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (file) {
      await processReceipt(file, file.name);
    }
  };

  const processReceipt = async (fileBlob, fileName) => {
    setScanning(true);
    stopCamera();

    try {
      // Upload receipt
      const file = new File([fileBlob], fileName, { type: fileBlob.type });
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      setPreviewImage(file_url);
      onReceiptUploaded?.(file_url);

      // Extract data using AI
      toast.info('🤖 AI analyzing receipt...');
      
      const result = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url: file_url,
        json_schema: {
          type: "object",
          properties: {
            vendor_name: { 
              type: "string", 
              description: "Name of the vendor, store, or company that issued the receipt (e.g., Home Depot, Lowe's, ABC Roofing)" 
            },
            amount: { 
              type: "number", 
              description: "Total amount paid (look for 'Total', 'Amount Paid', or final total at bottom)" 
            },
            expense_date: { 
              type: "string", 
              description: "Date of the transaction in YYYY-MM-DD format (look for 'Date', 'Transaction Date')" 
            },
            category: { 
              type: "string", 
              description: "Best matching category: materials, labor, subcontractor, utilities, fuel, equipment, software, meals, travel, insurance, rent, marketing, office_supplies, or other" 
            },
            description: { 
              type: "string", 
              description: "Brief description of items purchased or services rendered" 
            },
            payment_method: { 
              type: "string", 
              description: "How it was paid: cash, check, credit_card, debit_card, or bank_transfer" 
            },
            reference_number: { 
              type: "string", 
              description: "Check number, transaction ID, invoice number, or receipt number (look for 'Check #', 'Trans ID', 'Receipt #', or similar)" 
            }
          }
        }
      });

      if (result?.output) {
        const extractedData = {
          ...result.output,
          receipt_url: file_url
        };
        
        console.log('📊 Extracted data:', extractedData);
        
        if (onDataExtracted) {
          onDataExtracted(extractedData);
        }
        
        // Show success with details
        const details = [];
        if (extractedData.vendor_name) details.push(`Vendor: ${extractedData.vendor_name}`);
        if (extractedData.amount) details.push(`Amount: $${extractedData.amount}`);
        if (extractedData.reference_number) details.push(`Ref #: ${extractedData.reference_number}`);
        
        toast.success(`✅ Receipt scanned!\n${details.join(' • ')}`);
      } else {
        toast.warning('Receipt uploaded but no data extracted. Please fill manually.');
      }
    } catch (error) {
      toast.error('Failed to process receipt: ' + error.message);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-4">
      {!cameraMode && !previewImage && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={startCamera}
            className="flex-1"
          >
            <Camera className="w-4 h-4 mr-2" />
            Scan Receipt
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1"
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload Receipt
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      )}

      {cameraMode && (
        <div className="space-y-2">
          <div className="relative bg-gray-900 rounded-lg overflow-hidden" style={{ height: '350px', width: '100%' }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: 'scaleX(1)' }}
              onCanPlay={(e) => {
                console.log('✅ Video can play');
                e.target.play().catch(err => console.error('Play on canplay error:', err));
              }}
              onLoadedData={(e) => {
                console.log('✅ Video loaded data');
              }}
            />
            <div className="absolute inset-0 border-4 border-blue-500 pointer-events-none rounded-lg" />
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/50 px-3 py-1 rounded text-white text-xs">
              Position receipt in frame
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={capturePhoto}
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              disabled={scanning}
            >
              {scanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
              Capture
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={stopCamera}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {previewImage && (
        <div className="space-y-2">
          <div className="relative">
            <img src={previewImage} alt="Receipt" className="w-full rounded-lg border" />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="absolute top-2 right-2"
              onClick={() => {
                setPreviewImage(null);
                onReceiptUploaded?.(null);
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          {scanning && (
            <div className="flex items-center justify-center gap-2 text-blue-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Analyzing receipt...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}