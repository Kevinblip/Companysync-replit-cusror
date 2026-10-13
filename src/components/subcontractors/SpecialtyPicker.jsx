import React, { useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const normalizeSpecialty = (value) => value.trim().replace(/\s+/g, ' ');

export default function SpecialtyPicker({ options, value, onChange }) {
  const [addedOptions, setAddedOptions] = useState([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newSpecialty, setNewSpecialty] = useState('');
  const [validationMessage, setValidationMessage] = useState('');
  const addButtonRef = useRef(null);

  const availableOptions = useMemo(() => {
    const unique = new Map();
    [...(options || []), ...addedOptions].forEach((option) => {
      if (typeof option !== 'string') return;
      const label = normalizeSpecialty(option);
      if (label && !unique.has(label.toLocaleLowerCase())) unique.set(label.toLocaleLowerCase(), label);
    });
    return [...unique.values()];
  }, [options, addedOptions]);

  const closeAddForm = () => {
    setIsAdding(false);
    setNewSpecialty('');
    setValidationMessage('');
    requestAnimationFrame(() => addButtonRef.current?.focus());
  };

  const addSpecialty = () => {
    const label = normalizeSpecialty(newSpecialty);
    if (!label) {
      setValidationMessage('Enter a specialty name.');
      return;
    }

    const existing = availableOptions.find(
      (option) => option.toLocaleLowerCase() === label.toLocaleLowerCase()
    );
    const specialty = existing || label;
    if (!existing) setAddedOptions((current) => [...current, specialty]);
    const nextValue = (value || []).filter(
      (item) => item.toLocaleLowerCase() !== specialty.toLocaleLowerCase()
    );
    onChange([...nextValue, specialty]);
    closeAddForm();
  };

  const toggleSpecialty = (specialty) => {
    const selected = value || [];
    onChange(
      selected.some((item) => item.toLocaleLowerCase() === specialty.toLocaleLowerCase())
        ? selected.filter((item) => item.toLocaleLowerCase() !== specialty.toLocaleLowerCase())
        : [...selected, specialty]
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {availableOptions.map((specialty) => {
          const isSelected = (value || []).some(
            (item) => item.toLocaleLowerCase() === specialty.toLocaleLowerCase()
          );
          return (
            <button
              key={specialty}
              type="button"
              aria-pressed={isSelected}
              onClick={() => toggleSpecialty(specialty)}
              className={`inline-flex min-h-8 items-center rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                isSelected
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {specialty}
            </button>
          );
        })}
        {!isAdding && (
          <Button
            ref={addButtonRef}
            type="button"
            variant="outline"
            size="icon"
            aria-label="Add specialty"
            onClick={() => {
              setIsAdding(true);
              setValidationMessage('');
            }}
            className="h-8 w-8 rounded-full"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
          </Button>
        )}
      </div>

      {isAdding && (
        <div className="mt-3 max-w-sm space-y-2">
          <label htmlFor="new-subcontractor-specialty" className="text-sm font-medium">
            New specialty
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="new-subcontractor-specialty"
              autoFocus
              maxLength={64}
              value={newSpecialty}
              placeholder="Decks"
              aria-invalid={Boolean(validationMessage)}
              aria-describedby={validationMessage ? 'specialty-validation' : undefined}
              onChange={(event) => {
                setNewSpecialty(event.target.value);
                if (validationMessage) setValidationMessage('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                  addSpecialty();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  closeAddForm();
                }
              }}
            />
            <Button type="button" size="sm" onClick={addSpecialty}>Add</Button>
            <Button type="button" size="sm" variant="outline" onClick={closeAddForm}>Cancel</Button>
          </div>
          {validationMessage && (
            <p id="specialty-validation" role="alert" className="text-sm text-red-600">
              {validationMessage}
            </p>
          )}
        </div>
      )}

      <p className="mt-2 text-xs text-gray-500">
        New specialties are kept in your choices when you save this subcontractor.
      </p>
    </div>
  );
}