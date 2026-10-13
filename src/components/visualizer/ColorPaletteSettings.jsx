import React, { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Upload, Sparkles, Palette } from "lucide-react";
import { toast } from "sonner";
import {
  BUILT_IN_SIDING_BRANDS,
  BUILT_IN_ROOF_BRANDS,
  MANUFACTURER_SIDING_PALETTES,
  MANUFACTURER_ROOF_PALETTES,
  compressPhoto,
} from "@/components/visualizer/colorOptions";

const unwrap = (raw) => (raw?.error ? raw : (raw?.data ?? raw));

const BUILT_INS = [
  ...BUILT_IN_SIDING_BRANDS
    .filter(b => b.id !== "generic")
    .map(b => ({ ...b, section: "siding", colors: MANUFACTURER_SIDING_PALETTES[b.id] || [] })),
  ...BUILT_IN_ROOF_BRANDS
    .filter(b => b.id !== "generic")
    .map(b => ({ ...b, section: "roof", colors: MANUFACTURER_ROOF_PALETTES[b.id] || [] })),
];

function ColorChipRow({ colors = [] }) {
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {colors.slice(0, 20).map(c => (
        <div
          key={c.name}
          title={c.name}
          className="w-5 h-5 rounded-full border border-white/50 shadow-sm"
          style={{ backgroundColor: c.hex || "#ccc" }}
        />
      ))}
      {colors.length > 20 && (
        <span className="text-xs text-gray-400 self-center">+{colors.length - 20} more</span>
      )}
    </div>
  );
}

export default function ColorPaletteSettings() {
  const queryClient = useQueryClient();
  const { myCompany } = useRoleBasedData();
  const companyId = myCompany?.id;

  const [extracting, setExtracting] = useState(false);
  const [brandName, setBrandName] = useState("");
  const [brandSection, setBrandSection] = useState("siding");
  const [previewColors, setPreviewColors] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const fileRef = useRef();

  const { data: palettesEntity, isLoading } = useQuery({
    queryKey: ["company-color-palettes", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const res = await base44.entities.list("CompanyColorPalettes", { company_id: companyId });
      return Array.isArray(res) ? res[0] || null : null;
    },
    enabled: !!companyId,
  });

  const customPalettes = palettesEntity?.custom_palettes || [];

  const saveMutation = useMutation({
    mutationFn: async (newCustom) => {
      const payload = { custom_palettes: newCustom };
      if (palettesEntity?.id) {
        return base44.entities.update("CompanyColorPalettes", palettesEntity.id, payload);
      } else {
        return base44.entities.create("CompanyColorPalettes", { company_id: companyId, ...payload });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-color-palettes", companyId] });
    },
  });

  const handleImageUpload = async (e) => {
    const file = (e.target.files || [])[0];
    e.target.value = "";
    if (!file) return;
    const compressed = await compressPhoto(file);
    if (!compressed) return;
    setPreviewImage(compressed.preview);
    setPreviewColors(null);
    setExtracting(true);
    try {
      const raw = await base44.functions.invoke("extractColorsFromImage", {
        companyId,
        image: { base64: compressed.base64, mimeType: compressed.mimeType },
      });
      const result = unwrap(raw);
      if (result?.success && result.colors?.length) {
        setPreviewColors(result.colors);
        toast.success(`Found ${result.colors.length} colors — review and save below.`);
      } else {
        toast.error(result?.error || "Could not extract colors from that image. Try a clearer chart.");
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExtracting(false);
    }
  };

  const handleSaveBrand = async () => {
    if (!brandName.trim()) return toast.error("Enter a brand name first");
    if (!previewColors?.length) return toast.error("Extract colors from an image first");
    const newBrand = {
      id: `custom_${Date.now()}`,
      label: brandName.trim(),
      section: brandSection,
      colors: previewColors,
    };
    await saveMutation.mutateAsync([...customPalettes, newBrand]);
    toast.success(`${brandName} palette saved!`);
    setBrandName("");
    setPreviewColors(null);
    setPreviewImage(null);
  };

  const handleDelete = async (brandId) => {
    if (!window.confirm("Remove this brand palette?")) return;
    await saveMutation.mutateAsync(customPalettes.filter(p => p.id !== brandId));
    toast.success("Brand palette removed.");
    queryClient.invalidateQueries({ queryKey: ["company-color-palettes", companyId] });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading palettes…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Palette className="w-4 h-4 text-purple-500" /> Color Palettes
        </h3>
        <p className="text-sm text-gray-500 mt-1">
          Add the siding and roofing manufacturer brands you carry. These appear in the Color Visualizer for you and your customers.
        </p>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Built-in brands (always available)</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {BUILT_INS.map(brand => (
            <div key={brand.id} className="bg-gray-50 rounded-lg p-3 border">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-sm text-gray-800">{brand.label}</span>
                  <Badge variant="outline" className="ml-2 text-xs capitalize">{brand.section}</Badge>
                </div>
                <span className="text-xs text-gray-400">{brand.colors.length} colors</span>
              </div>
              <ColorChipRow colors={brand.colors} />
            </div>
          ))}
        </div>
      </div>

      {customPalettes.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Your custom brands</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {customPalettes.map(brand => (
              <div key={brand.id} className="bg-white rounded-lg p-3 border relative group">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-sm text-gray-800">{brand.label}</span>
                    <Badge variant="outline" className="ml-2 text-xs capitalize">{brand.section}</Badge>
                  </div>
                  <button
                    onClick={() => handleDelete(brand.id)}
                    className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    data-testid={`delete-brand-${brand.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <ColorChipRow colors={brand.colors || []} />
                <p className="text-xs text-gray-400 mt-1">{brand.colors?.length || 0} colors</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <Card className="border-purple-200">
        <CardHeader className="pb-3 bg-purple-50/50 border-b">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" /> Add a Brand — AI Color Extraction
          </CardTitle>
          <p className="text-xs text-gray-500 mt-1">
            Take a photo of any manufacturer's color chart and the AI will automatically read all the color names and values.
          </p>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Brand name</label>
              <Input
                value={brandName}
                onChange={e => setBrandName(e.target.value)}
                placeholder="e.g. LP SmartSide"
                data-testid="brand-name-input"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Used for</label>
              <div className="flex gap-2">
                {["siding", "roof"].map(s => (
                  <button
                    key={s}
                    onClick={() => setBrandSection(s)}
                    className={`flex-1 py-2 rounded-md text-xs font-medium border transition-colors capitalize ${
                      brandSection === s
                        ? "bg-purple-600 text-white border-purple-600"
                        : "border-gray-300 text-gray-600 hover:border-purple-400"
                    }`}
                    data-testid={`section-${s}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 mb-2 block">Color chart photo</label>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-purple-200 rounded-lg p-4 flex flex-col items-center gap-2 hover:border-purple-400 hover:bg-purple-50/50 transition-colors"
              data-testid="upload-chart-btn"
            >
              {extracting ? (
                <>
                  <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
                  <span className="text-sm text-purple-600">Extracting colors…</span>
                </>
              ) : previewImage ? (
                <img src={previewImage} alt="Chart preview" className="w-full max-h-32 object-contain rounded" />
              ) : (
                <>
                  <Upload className="w-6 h-6 text-purple-300" />
                  <span className="text-sm text-gray-500">Upload a color chart photo</span>
                  <span className="text-xs text-gray-400">Manufacturer swatch cards, brochure pages, or online screenshots</span>
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageUpload}
              data-testid="chart-file-input"
            />
          </div>

          {previewColors && (
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">Extracted colors ({previewColors.length})</p>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 bg-gray-50 rounded-lg border">
                {previewColors.map((c, i) => (
                  <div key={i} className="flex items-center gap-1 bg-white rounded-full px-2 py-0.5 border text-xs shadow-sm">
                    <div
                      className="w-3 h-3 rounded-full border border-gray-200"
                      style={{ backgroundColor: c.hex || "#ccc" }}
                    />
                    <span className="text-gray-700">{c.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button
            onClick={handleSaveBrand}
            disabled={!previewColors?.length || !brandName.trim() || saveMutation.isPending}
            className="w-full bg-purple-600 hover:bg-purple-700"
            data-testid="save-brand-btn"
          >
            {saveMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
            ) : (
              <><Plus className="w-4 h-4 mr-2" /> Save Brand Palette</>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
