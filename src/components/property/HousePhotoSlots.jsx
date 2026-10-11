import React from 'react';
import { Loader2 } from 'lucide-react';

const HOUSE_SLOTS = [
  { label: 'Front', emoji: '🏠', hint: 'Front face of house' },
  { label: 'Back', emoji: '🔄', hint: 'Rear of house' },
  { label: 'Left Side', emoji: '◀️', hint: 'Left side wall' },
  { label: 'Right Side', emoji: '▶️', hint: 'Right side wall' },
  { label: 'FL Corner', emoji: '↙️', hint: 'Front-left corner angle' },
  { label: 'FR Corner', emoji: '↘️', hint: 'Front-right corner angle' },
  { label: 'BL Corner', emoji: '↖️', hint: 'Back-left corner angle' },
  { label: 'BR Corner', emoji: '↗️', hint: 'Back-right corner angle' },
];

const GARAGE_SLOTS = [
  { label: 'Front', emoji: '🏗️', hint: 'Garage front' },
  { label: 'Back', emoji: '🔄', hint: 'Garage rear' },
  { label: 'Left Side', emoji: '◀️', hint: 'Left side' },
  { label: 'Right Side', emoji: '▶️', hint: 'Right side' },
  { label: 'FL Corner', emoji: '↙️', hint: 'Front-left corner angle' },
  { label: 'FR Corner', emoji: '↘️', hint: 'Front-right corner angle' },
];

export default function HousePhotoSlots({
  housePhotos = [],
  uploadingSlot,
  onSelect,
  onRemove,
  structureType = 'house',
}) {
  const slots = structureType === 'garage' ? GARAGE_SLOTS : HOUSE_SLOTS;
  return (
    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2" data-testid="house-photo-slots">
      {slots.map(slot => {
        const filled = housePhotos.find(p => p.label === slot.label);
        const isLoading = uploadingSlot === slot.label;
        return (
          <div key={slot.label} className="relative group" data-testid={`slot-${slot.label.replace(/\s+/g, '-').toLowerCase()}`}>
            <label className="cursor-pointer block">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) onSelect(e.target.files[0], slot.label); e.target.value = ''; }}
                disabled={isLoading || !!uploadingSlot}
              />
              <div className={`rounded-lg border-2 overflow-hidden transition-all ${filled ? 'border-cyan-400' : 'border-dashed border-cyan-300 hover:border-cyan-500'} bg-white`}>
                {filled ? (
                  <div className="relative">
                    <img src={filled.preview || filled.url} alt={slot.label} className="w-full h-20 object-cover" />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1">
                      <p className="text-white text-[10px] font-semibold truncate">{slot.emoji} {slot.label}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-20 px-1 text-center">
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 text-cyan-500 animate-spin mb-1" />
                    ) : (
                      <span className="text-xl mb-0.5">{slot.emoji}</span>
                    )}
                    <p className="text-[10px] font-semibold text-gray-600 leading-tight">{slot.label}</p>
                    <p className="text-[9px] text-gray-400 leading-tight mt-0.5">{isLoading ? 'Uploading…' : 'Tap to add'}</p>
                  </div>
                )}
              </div>
            </label>
            {filled && (
              <button
                type="button"
                data-testid={`button-remove-slot-${slot.label.replace(/\s+/g, '-').toLowerCase()}`}
                className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs leading-none z-10"
                onClick={() => onRemove(slot.label)}
              >×</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
