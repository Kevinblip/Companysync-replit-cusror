import React, { useState, useEffect } from "react";
import PdfViewer from "@/components/PdfViewer";
import { useQuery } from "@tanstack/react-query";

async function callBase44Function(functionName, data) {
  const proxyPath = `/api/public/${functionName === 'getSigningSession' ? 'get-signing-session' : 'sign-contract'}`;

  const response = await fetch(proxyPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Server returned invalid response (status ${response.status})`);
  }
  if (!response.ok) {
    const errorMsg = parsed?.error || parsed?.message || `Request failed with status ${response.status}`;
    throw new Error(errorMsg);
  }
  return parsed;
}
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle, X, Eye, Maximize2 } from "lucide-react";
import SignaturePad from "../components/SignaturePad";

export default function SignContractCustomer() {
  const [token, setToken] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [signatureData, setSignatureData] = useState(null);
  const [isSignatureReady, setIsSignatureReady] = useState(false);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [showFilledPreview, setShowFilledPreview] = useState(false);

  useEffect(() => {
    console.log('🎬 Component mounted');
    console.log('🌐 Full URL:', window.location.href);
    
    const params = new URLSearchParams(window.location.search);
    const extractedToken = params.get('token');
    console.log('🎫 Extracted token:', extractedToken);
    setToken(extractedToken);
  }, []);

  const { data: sessionData, isLoading: sessionLoading, error: sessionError } = useQuery({
    queryKey: ['signing-session-token', token],
    queryFn: async () => {
      console.log('🔍 Fetching session with token:', token);
      
      const result = await callBase44Function('getSigningSession', { token });
      console.log('✅ Session result:', result);
      
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to load session');
      }
      
      return result;
    },
    enabled: !!token,
    retry: 2,
    retryDelay: 1000,
  });

  const session = sessionData?.session;
  const template = sessionData?.template;

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    console.log('🔍 Submit clicked');
    console.log('Signature ready:', isSignatureReady);
    console.log('Has signature data:', !!signatureData);
    
    if (!isSignatureReady || !signatureData) {
      alert('❌ Please sign the document first');
      return;
    }

    if (!template?.fillable_fields) {
      alert('❌ Contract template data is missing');
      return;
    }

    const customerFields = template.fillable_fields.filter(f => f.filled_by === 'customer' && f.field_type !== 'signature');
    const missingRequired = customerFields.filter(f => f.required && !formValues[f.field_name]);
    
    if (missingRequired.length > 0) {
      alert(`❌ Please fill in: ${missingRequired.map(f => f.field_label).join(', ')}`);
      return;
    }

    setIsSubmitting(true);

    try {
      console.log('📤 Calling signContractCustomer...');
      const result = await callBase44Function('signContractCustomer', {
        token, fields: formValues, signature: signatureData,
      });
      console.log('📥 Result:', result);
      
      if (result?.success) {
        alert('Contract signed successfully!');
        window.location.reload();
      } else {
        throw new Error(result?.error || 'Failed to sign contract');
      }
    } catch (error) {
      console.error('❌ Error:', error);
      alert('❌ Error: ' + error.message);
      setIsSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="p-12 text-center">
            <X className="w-16 h-16 mx-auto mb-4 text-red-600" />
            <h2 className="text-2xl font-bold mb-2">Invalid Link</h2>
            <p className="text-gray-600">No signing token found in URL</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (sessionError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="p-12 text-center">
            <X className="w-16 h-16 mx-auto mb-4 text-red-600" />
            <h2 className="text-2xl font-bold mb-2">Error Loading Session</h2>
            <p className="text-gray-600">{sessionError.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (sessionLoading || !session || !template) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="ml-3 text-gray-600">Loading contract...</p>
      </div>
    );
  }

  if (session.status === 'completed') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="p-12 text-center">
            <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-600" />
            <h2 className="text-2xl font-bold mb-2">Contract Already Signed</h2>
            <p className="text-gray-600 mb-6">This contract has already been completed.</p>
            {session.final_pdf_url && (
              <Button
                onClick={() => window.open(session.final_pdf_url, '_blank')}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Download Signed Contract
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const customerFields = template.fillable_fields?.filter(f => f.filled_by === 'customer') || [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Sign Contract</h1>
        <p className="text-gray-500 mt-1">{template.template_name}</p>
        <Badge className="mt-2 bg-green-100 text-green-700">
          Customer Signature
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form Side */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Complete Your Information</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilledPreview(true)}
              >
                <Eye className="w-4 h-4 mr-2" />
                Preview Form
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription>
                <strong>From:</strong> {session.rep_name}
                <br />
                <strong>Contract:</strong> {session.contract_name}
              </AlertDescription>
            </Alert>

            {customerFields.map((field) => {
              if (field.field_type === 'signature') return null;

              return (
                <div key={field.field_name}>
                  <Label>
                    {field.field_label}
                    {field.required && <span className="text-red-500"> *</span>}
                  </Label>
                  {field.field_type === 'date' ? (
                    <Input
                      type="date"
                      value={formValues[field.field_name] || ''}
                      onChange={(e) => setFormValues({...formValues, [field.field_name]: e.target.value})}
                      required={field.required}
                    />
                  ) : field.field_type === 'email' ? (
                    <Input
                      type="email"
                      value={formValues[field.field_name] || ''}
                      onChange={(e) => setFormValues({...formValues, [field.field_name]: e.target.value})}
                      placeholder={field.placeholder}
                      required={field.required}
                    />
                  ) : field.field_type === 'phone' ? (
                    <Input
                      type="tel"
                      value={formValues[field.field_name] || ''}
                      onChange={(e) => setFormValues({...formValues, [field.field_name]: e.target.value})}
                      placeholder={field.placeholder || "(XXX) XXX-XXXX"}
                      required={field.required}
                    />
                  ) : (
                    <Input
                      type="text"
                      value={formValues[field.field_name] || ''}
                      onChange={(e) => setFormValues({...formValues, [field.field_name]: e.target.value})}
                      placeholder={field.placeholder}
                      required={field.required}
                    />
                  )}
                </div>
              );
            })}

            <div className="border-t pt-4 mt-4">
              <Label className="text-lg font-bold text-gray-900 block mb-2">
                Your Signature *
              </Label>
              <p className="text-sm text-gray-600 mb-3">
                Draw your signature using your mouse or finger
              </p>
              <SignaturePad 
                onSignatureChange={(data, hasSignature) => {
                  console.log('📝 Signature change:', { hasData: !!data, hasSignature });
                  setSignatureData(data);
                  setIsSignatureReady(hasSignature);
                }}
              />
            </div>

            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !isSignatureReady}
              className="w-full bg-green-600 hover:bg-green-700 text-lg py-6"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5 mr-2" />
                  Sign Contract
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* PDF Preview Side */}
        <div className="sticky top-6">
          <Card className="h-[800px]">
            <CardHeader className="border-b bg-gray-50">
              <div className="flex items-center justify-between">
                <CardTitle>Original Template</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPdfPreview(true)}
                  className="text-blue-600 hover:text-blue-700"
                >
                  <Maximize2 className="w-4 h-4 mr-1" />
                  Full Screen
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 h-[720px] flex flex-col">
              <PdfViewer
                src={`/api/proxy-pdf?url=${encodeURIComponent(template.original_file_url || '')}`}
                className="w-full flex-1 border-0"
                title="Contract Preview"
              />
              <div className="text-center py-1 bg-gray-50 border-t">
                <a href={template.original_file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                  Open in new tab ↗
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Full Screen Original Preview */}
      {showPdfPreview && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-6xl h-[95vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b bg-gray-50">
              <h2 className="text-xl font-bold">Original Template</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowPdfPreview(false)}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col">
              <PdfViewer
                src={`/api/proxy-pdf?url=${encodeURIComponent(template.original_file_url || '')}`}
                className="w-full flex-1 border-0"
                title="Contract Full Preview"
              />
              <div className="text-center py-1 bg-gray-50 border-t">
                <a href={template.original_file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                  Open in new tab ↗
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filled Data Preview for Customer */}
      {showFilledPreview && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-3xl max-h-[95vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b bg-gray-50">
              <h2 className="text-xl font-bold">Your Filled Information</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowFilledPreview(false)}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="bg-blue-50 border-l-4 border-blue-600 p-4 mb-4">
                <p className="text-sm text-gray-700"><strong>Contract:</strong> {session.contract_name}</p>
                <p className="text-sm text-gray-700"><strong>From:</strong> {session.rep_name}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-green-900 mb-3 text-lg">✅ Rep Has Filled:</h4>
                  {session.rep_fields && Object.keys(session.rep_fields).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(session.rep_fields).map(([key, value]) => {
                        const field = template.fillable_fields?.find(f => f.field_name === key);
                        return (
                          <div key={key} className="bg-green-50 p-3 rounded border border-green-200">
                            <Label className="text-sm text-gray-600">{field?.field_label || key}</Label>
                            <p className="font-medium mt-1">{value}</p>
                          </div>
                        );
                      })}
                      {session.rep_signature_url && (
                        <div className="bg-green-50 p-3 rounded border border-green-200">
                          <Label className="text-sm text-gray-600">Rep Signature</Label>
                          <img src={session.rep_signature_url} alt="Rep Signature" className="h-16 mt-2 border rounded bg-white p-2" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">No fields filled by rep yet</p>
                  )}
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-semibold text-blue-900 mb-3 text-lg">📝 You're Filling:</h4>
                  {customerFields.length === 0 ? (
                    <p className="text-gray-500 text-sm">No fields for you to fill</p>
                  ) : (
                    <div className="space-y-2">
                      {customerFields.map(field => {
                        if (field.field_type === 'signature') {
                          return (
                            <div key={field.field_name} className="bg-white p-3 rounded border">
                              <Label className="text-sm text-gray-600">{field.field_label}</Label>
                              {signatureData ? (
                                <img src={signatureData} alt="Your Signature" className="h-16 mt-2 border rounded bg-gray-50 p-2" />
                              ) : (
                                <p className="text-orange-500 text-sm mt-1">[Not signed yet]</p>
                              )}
                            </div>
                          );
                        }
                        return (
                          <div key={field.field_name} className="bg-white p-3 rounded border">
                            <Label className="text-sm text-gray-600">{field.field_label}</Label>
                            <p className="font-medium mt-1">
                              {formValues[field.field_name] || <span className="text-gray-400">[Not filled]</span>}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}