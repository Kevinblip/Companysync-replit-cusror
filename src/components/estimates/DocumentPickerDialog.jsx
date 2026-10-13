import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Search } from 'lucide-react';

const CATEGORY_LABELS = {
  all: 'All Documents',
  supplier_letters: 'Supplier Letters',
  rebuttal_docs: 'Rebuttal Docs',
  insurance: 'Insurance',
  contract: 'Contracts',
  estimate: 'Estimates',
  report: 'Reports',
  proposal: 'Proposals',
  warranty: 'Warranties',
  irc_code_letter: 'IRC Code Letters',
  insurance_claim: 'Insurance Claims',
  customer_communication: 'Customer Communication',
  billing: 'Billing',
  manufacturer_specs: 'Manufacturer Specs',
  other: 'Other',
};

/**
 * DocumentPickerDialog — lets the user pick one or more documents from the
 * company's Document library to attach to an estimate.
 *
 * Props:
 *   isOpen          — boolean
 *   onOpenChange    — (open) => void
 *   companyId       — string  (company id used to fetch documents)
 *   onSelect        — (docs: DocumentObject[]) => void  called with the newly selected docs
 *   alreadyAttached — DocumentObject[]  docs already on the estimate (shown as disabled)
 */
export default function DocumentPickerDialog({ isOpen, onOpenChange, companyId, onSelect, alreadyAttached = [] }) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('supplier_letters');
  const [selectedIds, setSelectedIds] = useState(new Set());

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', companyId],
    queryFn: () => companyId
      ? base44.entities.Document.filter({ company_id: companyId }, '-created_date')
      : [],
    enabled: !!companyId && isOpen,
    staleTime: 2 * 60 * 1000,
  });

  const filteredDocs = useMemo(() => {
    let docs = documents;
    if (categoryFilter !== 'all') docs = docs.filter(d => d.category === categoryFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      docs = docs.filter(d =>
        d.document_name?.toLowerCase().includes(q) ||
        d.description?.toLowerCase().includes(q)
      );
    }
    return docs;
  }, [documents, categoryFilter, search]);

  const alreadyAttachedIds = useMemo(() => new Set(alreadyAttached.map(d => d.id)), [alreadyAttached]);

  const handleToggle = (docId) => {
    if (alreadyAttachedIds.has(docId)) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId); else next.add(docId);
      return next;
    });
  };

  const handleConfirm = () => {
    const allSelected = documents.filter(d => selectedIds.has(d.id));
    onSelect(allSelected);
    setSelectedIds(new Set());
    setSearch('');
    setCategoryFilter('supplier_letters');
    onOpenChange(false);
  };

  const handleClose = () => {
    setSelectedIds(new Set());
    setSearch('');
    setCategoryFilter('supplier_letters');
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); else onOpenChange(true); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>📎 Attach from Document Library</DialogTitle>
        </DialogHeader>

        {/* Filters */}
        <div className="flex gap-2 flex-shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search documents…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-44 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                <SelectItem key={val} value={val}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Document list */}
        <div className="flex-1 overflow-y-auto border rounded-lg divide-y min-h-[200px]">
          {isLoading ? (
            <div className="py-10 flex flex-col items-center gap-2 text-gray-500 text-sm">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading documents…
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="py-10 text-center text-gray-500 text-sm">
              {documents.length === 0
                ? 'No documents in your library yet. Upload one from the Documents page.'
                : 'No documents match this filter.'}
            </div>
          ) : filteredDocs.map(doc => {
            const alreadyOn = alreadyAttachedIds.has(doc.id);
            const checked = selectedIds.has(doc.id) || alreadyOn;
            return (
              <div
                key={doc.id}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                  alreadyOn ? 'bg-green-50 opacity-70' : checked ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
                onClick={() => handleToggle(doc.id)}
              >
                <Checkbox
                  checked={checked}
                  disabled={alreadyOn}
                  onCheckedChange={() => handleToggle(doc.id)}
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{doc.document_name}</p>
                  {doc.description && (
                    <p className="text-xs text-gray-500 truncate mt-0.5">{doc.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {doc.category && (
                    <Badge variant="outline" className="text-[11px]">
                      {CATEGORY_LABELS[doc.category] || doc.category}
                    </Badge>
                  )}
                  {alreadyOn && (
                    <span className="text-xs font-medium text-green-700">✓ Attached</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-gray-500 flex-shrink-0">
          {documents.length} document{documents.length !== 1 ? 's' : ''} in library
          {alreadyAttached.length > 0 ? ` · ${alreadyAttached.length} already attached` : ''}
        </p>

        <DialogFooter className="flex-shrink-0">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            disabled={selectedIds.size === 0}
            onClick={handleConfirm}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {selectedIds.size > 0
              ? `Attach ${selectedIds.size} document${selectedIds.size > 1 ? 's' : ''}`
              : 'Select documents above'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
