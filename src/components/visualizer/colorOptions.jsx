import React from "react";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";

export const SIDING_COLORS = [
  { name: "Arctic White", hex: "#F5F4EF" },
  { name: "Sailcloth", hex: "#E8E4D8" },
  { name: "Navajo Beige", hex: "#D4C4A8" },
  { name: "Tuscan Beige", hex: "#D4BC96" },
  { name: "Woodland Beige", hex: "#C5B89A" },
  { name: "Autumn Tan", hex: "#C9A87D" },
  { name: "Aged Pewter", hex: "#A0A09A" },
  { name: "Cobblestone", hex: "#A09B90" },
  { name: "Gauntlet Gray", hex: "#7A8088" },
  { name: "Night Gray", hex: "#5A6472" },
  { name: "Iron Gray", hex: "#5C5C60" },
  { name: "Ironstone", hex: "#5A5650" },
  { name: "Timber Bark", hex: "#8B7355" },
  { name: "Woodstock Brown", hex: "#6B4F3A" },
  { name: "Heathered Moss", hex: "#7A8B6C" },
  { name: "Boothbay Blue", hex: "#4A7A8A" },
  { name: "Deep Ocean", hex: "#2C5F7A" },
  { name: "Midnight Blue", hex: "#1A3A5C" },
  { name: "Countrylane Red", hex: "#8B3B3B" },
  { name: "Midnight Black", hex: "#2A2A2A" },
];

// ── Built-in manufacturer palettes ───────────────────────────────────────────
// Siding brands: color name → hex (approximate from manufacturer charts).
// Hex is used ONLY for swatch display — the AI prompt uses the name string.
export const BUILT_IN_SIDING_BRANDS = [
  { id: "gentek", label: "Gentek" },
  { id: "certainteed", label: "CertainTeed" },
  { id: "james_hardie", label: "James Hardie" },
  { id: "lp_smartside", label: "LP SmartSide" },
];

export const BUILT_IN_ROOF_BRANDS = [
  { id: "owens_corning", label: "Owens Corning" },
  { id: "certainteed_roof", label: "CertainTeed" },
];

export const MANUFACTURER_SIDING_PALETTES = {
  certainteed: [
    { name: "Colonial White", hex: "#F0EDE2" },
    { name: "Heritage Cream", hex: "#EAD890" },
    { name: "Autumn Yellow", hex: "#E2D070" },
    { name: "Light Maple", hex: "#D4B87A" },
    { name: "Buckskin", hex: "#C2A070" },
    { name: "Desert Tan", hex: "#C0A070" },
    { name: "Sandpiper", hex: "#CCC0A0" },
    { name: "Sandstone Beige", hex: "#C4AE88" },
    { name: "Savannah Wicker", hex: "#B2A080" },
    { name: "Suede", hex: "#BAA888" },
    { name: "Canyon Blend", hex: "#A88A6A" },
    { name: "Timber Blend", hex: "#9A8470" },
    { name: "Natural Clay", hex: "#A89076" },
    { name: "Silver Ash", hex: "#B8B4AC" },
    { name: "Flagstone", hex: "#888278" },
    { name: "Granite Gray", hex: "#8C8C8C" },
    { name: "Arctic Blend", hex: "#8A8A8A" },
    { name: "Frontier Blend", hex: "#9C8A7A" },
    { name: "Glacier Blend", hex: "#B4C2C6" },
    { name: "Sterling Gray", hex: "#8A9292" },
    { name: "Charcoal Clay", hex: "#585852" },
    { name: "Spruce", hex: "#787E70" },
    { name: "Cedar Arbor", hex: "#706560" },
    { name: "Herringbone", hex: "#A89880" },
    { name: "Meadow Blend", hex: "#B2C090" },
    { name: "Seagrass", hex: "#94A270" },
    { name: "Green Tea", hex: "#98B280" },
    { name: "Cypress", hex: "#8A9870" },
    { name: "Ivy Green", hex: "#4A5A48" },
    { name: "Pacific Blue", hex: "#667898" },
    { name: "Mountain Cedar", hex: "#8A5830" },
    { name: "Sable Brown", hex: "#4A3830" },
    { name: "HeartStone", hex: "#7C4C38" },
    { name: "Autumn Red", hex: "#893020" },
    { name: "Terra Cotta", hex: "#A85830" },
  ],
  gentek: [
    // Classic Colours
    { name: "Snow White",      hex: "#F6F5F2" },
    { name: "Linen",           hex: "#EEE9DC" },
    { name: "Sandstone",       hex: "#EAE3C8" },
    { name: "Maize",           hex: "#F0E8B0" },
    { name: "Almond",          hex: "#E0D5B8" },
    { name: "Monterey Sand",   hex: "#C5B898" },
    { name: "Wicker",          hex: "#C0AF88" },
    { name: "Canyon Clay",     hex: "#C0B4A8" },
    { name: "Pebble",          hex: "#AFA090" },
    { name: "Pearl",           hex: "#DCDBD6" },
    { name: "Dover Gray",      hex: "#C0C4CC" },
    { name: "Storm",           hex: "#8E9AA0" },
    { name: "Chesapeake Gray", hex: "#7A8A8C" },
    { name: "Sage",            hex: "#9CA88C" },
    { name: "Juniper Grove",   hex: "#8A9878" },
    // Designer Colours
    { name: "Majestic Brick",  hex: "#7A2A28" },
    { name: "Dark Drift",      hex: "#A08070" },
    { name: "Rockport Brown",  hex: "#887060" },
    { name: "Espresso",        hex: "#4A3028" },
    { name: "Smoked Timber",   hex: "#5A4030" },
    { name: "Meadow Fern",     hex: "#788060" },
    { name: "Moonlit Moss",    hex: "#607060" },
    { name: "Rockwell Blue",   hex: "#7890A8" },
    { name: "Coastal Blue",    hex: "#4A6878" },
    { name: "Midnight Surf",   hex: "#3A5068" },
    { name: "Marine Dusk",     hex: "#485878" },
    { name: "Hudson Slate",    hex: "#505A68" },
    { name: "Windswept Smoke", hex: "#687070" },
    { name: "Iron Ore",        hex: "#4A4040" },
    // Variegated Colours
    { name: "Aspen",           hex: "#C8C0B0" },
    { name: "Earthen",         hex: "#C4B898" },
    { name: "Willow",          hex: "#C8CCC8" },
    { name: "Rainforest",      hex: "#707870" },
  ],
  provia: [
    { name: "White", hex: "#F0EEE8" },
    { name: "Colonial White", hex: "#EEEAE0" },
    { name: "Heritage Cream", hex: "#E8D898" },
    { name: "Almond", hex: "#E8D8B0" },
    { name: "Natural", hex: "#C8B880" },
    { name: "Sandstone", hex: "#C4B090" },
    { name: "Birch", hex: "#D4C888" },
    { name: "Savannah", hex: "#B8A068" },
    { name: "Autumn", hex: "#C48F38" },
    { name: "Clay", hex: "#B49878" },
    { name: "Flagstone", hex: "#9A9080" },
    { name: "Slate", hex: "#788888" },
    { name: "Granite", hex: "#8A8888" },
    { name: "Dark Gray", hex: "#585858" },
    { name: "Pacific Blue", hex: "#6888A8" },
    { name: "Oxford Blue", hex: "#485888" },
    { name: "Seagrass", hex: "#849470" },
    { name: "Cedar", hex: "#A87848" },
    { name: "English Walnut", hex: "#583020" },
  ],
  james_hardie: [
    // Whites & Light Neutrals
    { name: "Arctic White",       hex: "#F5F4EF" },
    { name: "Sail Cloth",         hex: "#EAE3CC" },
    { name: "Navajo Beige",       hex: "#E8D8A8" },
    { name: "Monterey Cream",     hex: "#EAE098" },
    { name: "Pale Yellow",        hex: "#EDE498" },
    // Tans & Beiges
    { name: "Khaki Brown",        hex: "#C8AA78" },
    { name: "Autumn Tan",         hex: "#C8A870" },
    { name: "Desert Tan",         hex: "#C8B480" },
    { name: "Sandstone Beige",    hex: "#C4B090" },
    { name: "Cobblestone",        hex: "#A09080" },
    { name: "Monterey Taupe",     hex: "#B0A090" },
    // Grays
    { name: "Pearl Gray",         hex: "#C8CCCC" },
    { name: "Light Mist",         hex: "#D8DCD8" },
    { name: "Natural Gray",       hex: "#B0ACAC" },
    { name: "Aged Pewter",        hex: "#9A9888" },
    { name: "Gauntlet Gray",      hex: "#808890" },
    { name: "Iron Gray",          hex: "#787870" },
    { name: "Night Gray",         hex: "#6C6C68" },
    { name: "Midnight Black",     hex: "#302828" },
    // Browns
    { name: "Timber Bark",        hex: "#706050" },
    { name: "Woodstock Brown",    hex: "#8A6858" },
    { name: "Chestnut Brown",     hex: "#7A4C38" },
    { name: "Roasted Hazelnut",   hex: "#7A5038" },
    // Greens
    { name: "Celadon",            hex: "#A8B8A0" },
    { name: "Mountain Sage",      hex: "#789078" },
    { name: "Heathered Moss",     hex: "#9CA880" },
    { name: "Woodland Green",     hex: "#587050" },
    // Blues
    { name: "Boothbay Blue",      hex: "#688898" },
    { name: "Deep Ocean",         hex: "#3A5870" },
    // Reds & Accents
    { name: "Countrylane Red",    hex: "#883028" },
    { name: "Traditional Red",    hex: "#9A3020" },
    // Additional ColorPlus shades
    { name: "Gray Slate",         hex: "#7A8888" },
    { name: "Primed",             hex: "#D4CEC4" },
  ],
  lp_smartside: [
    // Whites & Creams
    { name: "White",              hex: "#F0EEEA" },
    { name: "Natural Cream",      hex: "#EAE4C0" },
    { name: "Parchment",          hex: "#EAE2C4" },
    { name: "Harvest Wheat",      hex: "#D0BE78" },
    { name: "Yellow Birch",       hex: "#D0B868" },
    // Tans & Beiges
    { name: "Desert Tan",         hex: "#C8B888" },
    { name: "Sandstone",          hex: "#C8B898" },
    // Browns
    { name: "Brownstone",         hex: "#8A6850" },
    { name: "Musket Brown",       hex: "#7A5E48" },
    { name: "Tanner's Brown",     hex: "#7A5840" },
    // Greens
    { name: "Sage Green",         hex: "#889878" },
    { name: "Woodland Green",     hex: "#506050" },
    { name: "Forest Green",       hex: "#4A6040" },
    // Blues
    { name: "Slate Blue",         hex: "#8098A8" },
    { name: "Classic Blue",       hex: "#6080A0" },
    { name: "Heritage Blue",      hex: "#5A7890" },
    // Grays
    { name: "Pewter",             hex: "#9A9898" },
    { name: "Cape Cod Gray",      hex: "#989898" },
    { name: "Timber Gray",        hex: "#8A8878" },
    { name: "Flagstone Gray",     hex: "#8A8880" },
    { name: "Storm Gray",         hex: "#707878" },
    { name: "Iron",               hex: "#686868" },
    // Reds
    { name: "Autumn Red",         hex: "#8A3828" },
    { name: "Rustic Red",         hex: "#8A3028" },
  ],
};

export const MANUFACTURER_ROOF_PALETTES = {
  owens_corning: [
    { name: "Onyx", hex: "#1C1C1C" },
    { name: "Shasta White", hex: "#E4DED0" },
    { name: "Estate Gray", hex: "#6E6E6E" },
    { name: "Quarry Gray", hex: "#909090" },
    { name: "Brownwood", hex: "#8A6848" },
    { name: "Driftwood", hex: "#A89068" },
    { name: "Teak", hex: "#8A7048" },
    { name: "Aged Oak", hex: "#A88A6A" },
    { name: "Desert Tan", hex: "#D0B47A" },
    { name: "Chateau Green", hex: "#496449" },
    { name: "Autumn Brown", hex: "#8A5030" },
    { name: "Harbor Blue", hex: "#4A6A8A" },
    { name: "Hearthstone", hex: "#8A7060" },
  ],
  certainteed_roof: [
    { name: "Moire Black", hex: "#1A1A1A" },
    { name: "Weathered Wood", hex: "#8B7355" },
    { name: "Charcoal Black", hex: "#3A3A3A" },
    { name: "Colonial Slate", hex: "#707070" },
    { name: "Resawn Shake", hex: "#9E8E7A" },
    { name: "Driftwood", hex: "#9A8468" },
    { name: "Heather Blend", hex: "#887080" },
    { name: "Shadow Gray", hex: "#808080" },
    { name: "Desert Rose", hex: "#B07878" },
    { name: "Mission Brown", hex: "#6B3A2A" },
    { name: "Georgetown Gray", hex: "#6A6A6A" },
  ],
};

// Merge built-in + custom palettes to get the full color list for a brand
export function getColorsForBrand(brandId, customPalettes = []) {
  if (MANUFACTURER_SIDING_PALETTES[brandId]) return MANUFACTURER_SIDING_PALETTES[brandId];
  const custom = customPalettes.find(p => p.id === brandId);
  if (custom?.colors) return custom.colors;
  return null;
}

export function getRoofColorsForBrand(brandId, customPalettes = []) {
  if (MANUFACTURER_ROOF_PALETTES[brandId]) return MANUFACTURER_ROOF_PALETTES[brandId];
  const custom = customPalettes.find(p => p.id === brandId && p.section === 'roof');
  if (custom?.colors) return custom.colors;
  return null;
}

export function BrandSelector({ label, brands, value, onChange }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
      <div className="flex flex-wrap gap-2">
        {brands.map(b => (
          <button
            key={b.id}
            onClick={() => onChange(b.id)}
            data-testid={`brand-${b.id}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              value === b.id
                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export const SIDING_MATERIALS = [
  { id: "vinyl", label: "Vinyl / Painted" },
  { id: "fiber_cement", label: "Fiber Cement" },
  { id: "wood_shake", label: "Wood Shake" },
  { id: "board_and_batten", label: "Board & Batten" },
  { id: "scalloped_shake", label: "Scalloped Shake" },
  { id: "stucco", label: "Stucco" },
  { id: "stone_veneer", label: "Stone Veneer" },
  { id: "brick", label: "Brick" },
];

export const CORNER_POST_STYLES = [
  { id: "standard", label: "Standard Trim" },
  { id: "wide_board", label: "Wide Board Wrap" },
  { id: "cedar_wrap", label: "Cedar / Wood Wrap" },
  { id: "stone_wrap", label: "Stone Accent Wrap" },
];

export const TRIM_COLORS = [
  { name: "Bright White", hex: "#FFFFFF" },
  { name: "Antique White", hex: "#FAEBD7" },
  { name: "Alabaster", hex: "#F2EDE4" },
  { name: "Light Gray", hex: "#D3D3D3" },
  { name: "Charcoal", hex: "#4A4A4A" },
  { name: "Black", hex: "#1A1A1A" },
];

export const SOFFIT_COLORS = [
  { name: "Bright White", hex: "#FFFFFF" },
  { name: "Antique White", hex: "#FAEBD7" },
  { name: "Alabaster", hex: "#F2EDE4" },
  { name: "Almond", hex: "#EFE6D3" },
  { name: "Light Gray", hex: "#D3D3D3" },
  { name: "Match Trim", hex: null, matchTrim: true },
];

export const SHUTTER_COLORS = [
  { name: "None", hex: null },
  { name: "Black", hex: "#1A1A1A" },
  { name: "Dark Navy", hex: "#1A2B4A" },
  { name: "Hunter Green", hex: "#2A5C2A" },
  { name: "Burgundy", hex: "#6B1A1A" },
  { name: "Charcoal", hex: "#4A4A4A" },
  { name: "Dark Brown", hex: "#3A2A1A" },
  { name: "White", hex: "#FFFFFF" },
];

export const ROOF_COLORS = [
  { name: "Charcoal", hex: "#4A4A4A" },
  { name: "Weathered Wood", hex: "#8B7355" },
  { name: "Aged Bark", hex: "#6B5B45" },
  { name: "Driftwood", hex: "#9E8E7A" },
  { name: "Desert Tan", hex: "#D4B896" },
  { name: "Mission Brown", hex: "#6B3A2A" },
  { name: "Estate Gray", hex: "#7A7A7A" },
  { name: "Antique Silver", hex: "#B0B0B0" },
  { name: "Barkwood", hex: "#7A6050" },
  { name: "Midnight Black", hex: "#1A1A1A" },
];

export const CORNER_POST_COLORS = [
  { name: "Match Siding", hex: null, matchSiding: true },
  { name: "White", hex: "#FFFFFF" },
  { name: "Almond", hex: "#EFE6D3" },
  { name: "Clay", hex: "#B99E7E" },
  { name: "Charcoal", hex: "#4A4A4A" },
  { name: "Black", hex: "#1A1A1A" },
];

export const GARAGE_DOOR_COLORS = [
  { name: "None (leave as-is)", hex: null },
  { name: "White", hex: "#FFFFFF" },
  { name: "Almond", hex: "#EFE6D3" },
  { name: "Sandstone", hex: "#C4B090" },
  { name: "Gray", hex: "#9A9A9A" },
  { name: "Charcoal", hex: "#4A4A4A" },
  { name: "Carriage Brown", hex: "#6B4A2A" },
  { name: "Black", hex: "#1A1A1A" },
  { name: "Match Siding", hex: null, matchSiding: true },
];

export const AWNING_COLORS = [
  { name: "None (leave as-is)", hex: null },
  { name: "White", hex: "#FFFFFF" },
  { name: "Almond", hex: "#EFE6D3" },
  { name: "Light Gray", hex: "#D3D3D3" },
  { name: "Charcoal", hex: "#4A4A4A" },
  { name: "Black", hex: "#1A1A1A" },
  { name: "Match Trim", hex: null, matchTrim: true },
  { name: "Match Siding", hex: null, matchSiding: true },
];

export const FRONT_DOOR_COLORS = [
  { name: "None (leave as-is)", hex: null },
  { name: "Red", hex: "#B22222" },
  { name: "Black", hex: "#1A1A1A" },
  { name: "Navy", hex: "#1A2B4A" },
  { name: "Forest Green", hex: "#2A5C2A" },
  { name: "White", hex: "#FFFFFF" },
  { name: "Almond", hex: "#EFE6D3" },
  { name: "Walnut Brown", hex: "#5C3D1E" },
  { name: "Charcoal", hex: "#4A4A4A" },
  { name: "Cobalt Blue", hex: "#1F4E9A" },
  { name: "Burgundy", hex: "#6B1A1A" },
  { name: "Sage Green", hex: "#7A9A6A" },
  { name: "Yellow", hex: "#D4A017" },
  { name: "Orange", hex: "#C45C1A" },
];

export function isLightColor(hex) {
  if (!hex) return true;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

export function hexForColorName(palette, name) {
  return palette.find(c => c.name === name)?.hex || null;
}

export function ColorSwatch({ color, selected, onClick, sidingHex, trimHex }) {
  const effectiveHex = color.matchSiding
    ? sidingHex
    : color.matchTrim
    ? trimHex
    : color.hex;
  const bgStyle = effectiveHex
    ? { backgroundColor: effectiveHex }
    : { background: "linear-gradient(135deg, #fff 45%, #bbb 45%)" };
  return (
    <button
      title={color.name}
      onClick={onClick}
      data-testid={`color-swatch-${color.name.toLowerCase().replace(/\s+/g, "-")}`}
      className={`relative w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center flex-shrink-0 ${
        selected
          ? "border-blue-500 scale-110 shadow-md ring-2 ring-blue-200"
          : "border-gray-300 hover:border-gray-500 hover:scale-105"
      }`}
      style={bgStyle}
    >
      {selected && effectiveHex && (
        <Check className={`w-3 h-3 ${isLightColor(effectiveHex) ? "text-gray-700" : "text-white"}`} />
      )}
      {selected && !effectiveHex && <Check className="w-3 h-3 text-gray-500" />}
    </button>
  );
}

export function ColorSection({ label, colors, value, onChange, sidingHex, trimHex }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between min-h-[24px]">
        <p className="text-sm font-semibold text-gray-700">{label}</p>
        {value && value !== "None" && (
          <Badge variant="outline" className="text-xs font-normal">{value}</Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {colors.map(c => (
          <ColorSwatch
            key={c.name}
            color={c}
            selected={value === c.name}
            onClick={() => onChange(c.name)}
            sidingHex={sidingHex}
            trimHex={trimHex}
          />
        ))}
      </div>
    </div>
  );
}

export function MaterialTypeSelector({ value, onChange }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-gray-700">Siding Material</p>
      <div className="flex flex-wrap gap-2">
        {SIDING_MATERIALS.map(m => (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            data-testid={`material-${m.id}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              value === m.id
                ? "bg-purple-600 text-white border-purple-600 shadow-sm"
                : "bg-white text-gray-600 border-gray-300 hover:border-purple-400 hover:text-purple-600"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CornerPostStyleSelector({ value, onChange }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-500">Corner Post Style</p>
      <div className="flex flex-wrap gap-2">
        {CORNER_POST_STYLES.map(s => (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            data-testid={`corner-style-${s.id}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              (value || "standard") === s.id
                ? "bg-purple-600 text-white border-purple-600 shadow-sm"
                : "bg-white text-gray-600 border-gray-300 hover:border-purple-400 hover:text-purple-600"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export async function compressPhoto(file) {
  return new Promise(resolve => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1280;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      resolve({ preview: dataUrl, base64: dataUrl.split(",")[1], mimeType: "image/jpeg", name: file.name });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

export async function urlToBase64(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Could not load the source photo");
  const blob = await resp.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve({ preview: dataUrl, base64: dataUrl.split(",")[1], mimeType: blob.type || "image/jpeg", name: "source" });
    };
    reader.onerror = () => reject(new Error("Could not read the source photo"));
    reader.readAsDataURL(blob);
  });
}
