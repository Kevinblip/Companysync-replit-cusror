import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WASTE_DROPDOWN, WASTE_PRESETS } from "@/utils/wasteFactor";

export default function WasteFactorControl({
  trade,
  appliedPercent,
  suggestedPercent,
  reason,
  suggestedReason,
  isManual,
  onChange,
  onReset,
}) {
  const applied = Number(appliedPercent);
  const suggested = Number(suggestedPercent);
  const options = [...WASTE_DROPDOWN];
  if (Number.isFinite(applied) && !options.includes(applied)) options.push(applied);
  options.sort((a, b) => a - b);
  const value = Number.isFinite(applied) ? String(applied) : String(suggested || 10);
  const displayReason = isManual ? "Manual override" : (reason || suggestedReason || "");

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3" data-testid={`waste-control-${trade}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-700">Waste</span>
        <Select value={value} onValueChange={(next) => onChange(Number(next))}>
          <SelectTrigger data-testid={`select-waste-${trade}`} className="h-8 w-[108px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((percent) => (
              <SelectItem key={percent} value={String(percent)}>{percent}%</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isManual && (
          <Badge className="bg-amber-100 text-amber-900 border border-amber-300" data-testid={`badge-waste-manual-${trade}`}>
            Manual override
          </Badge>
        )}
        <span className="text-xs text-gray-600" data-testid={`waste-reason-${trade}`}>{displayReason}</span>
      </div>
      {isManual && suggestedReason && (
        <p className="text-xs text-gray-500 mt-1">Suggested: {suggestedReason}</p>
      )}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {WASTE_PRESETS.map((percent) => (
          <button
            key={percent}
            type="button"
            data-testid={`waste-preset-${trade}-${percent}`}
            onClick={() => onChange(percent)}
            className={`px-2.5 py-1 text-xs font-medium rounded-full border ${
              applied === percent
                ? "border-blue-500 bg-blue-50 text-blue-800"
                : "border-gray-200 bg-gray-50 text-gray-700"
            }`}
          >
            {percent}%
          </button>
        ))}
        {isManual && (
          <button
            type="button"
            data-testid={`waste-reset-${trade}`}
            onClick={onReset}
            className="px-2.5 py-1 text-xs font-medium rounded-full border border-teal-400 bg-teal-50 text-teal-800"
          >
            Reset to suggested
          </button>
        )}
      </div>
    </div>
  );
}
