import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { InspectionPill } from "@/components/inspections/InspectionPill";
import { localToday } from "@/utils/localDate";
import { hasManualCustomerInspection, isCustomerInspected, saveCustomerInspectionMarks } from "@/utils/customerInspectionStatus";

export function CustomerInspectionStatus({ record, job, photoCount, navigate, onMark, onClear }) {
  const manual = hasManualCustomerInspection(record) && job?.status !== 'completed';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {manual ? (
        <button type="button"
          className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-800"
          title={`Manually marked inspected on ${record.manual_inspected_date}${onClear ? '. Click to correct this mark.' : ''}`}
          onClick={event => { event.stopPropagation(); onClear?.(record); }}>
          <CheckCircle2 className="h-3 w-3" /> Inspected · {record.manual_inspected_date}
        </button>
      ) : <InspectionPill record={record} job={job} photoCount={photoCount} navigate={navigate} />}
      {onMark && !isCustomerInspected(record, job) && (
        <button type="button" className="text-xs font-medium text-blue-700 hover:underline"
          onClick={event => { event.stopPropagation(); onMark(record); }}>
          Mark inspected
        </button>
      )}
    </div>
  );
}

export function CustomerInspectionStatusDialog({ selection, email, onDismiss, onSaved }) {
  const queryClient = useQueryClient();
  const open = !!selection;
  const [date, setDate] = useState(localToday());
  useEffect(() => { if (open) setDate(localToday()); }, [open]);
  const mutation = useMutation({
    mutationFn: payload => saveCustomerInspectionMarks({
      ...payload, update: (id, data) => base44.entities.Customer.update(id, data),
    }),
    onSuccess: async result => {
      if (result.successCount) {
        await queryClient.invalidateQueries({ queryKey: ['customers'] });
        queryClient.invalidateQueries({ queryKey: ['customer'] });
      }
      if (result.failed.length) {
        toast.error(`${result.successCount} updated; ${result.failed.length} could not be saved. ${result.failed[0].error}`);
      } else {
        toast.success(selection?.clear ? 'Manual inspection mark cleared.' : `${result.successCount} customer${result.successCount === 1 ? '' : 's'} marked inspected.`);
      }
      onSaved(result);
    },
    onError: error => toast.error(error.message),
  });
  return (
    <Dialog open={open} onOpenChange={value => { if (!value && !mutation.isPending) onDismiss(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{selection?.clear ? 'Clear manual inspection mark?' : 'Mark customers as inspected'}</DialogTitle>
          <DialogDescription>
            {selection?.clear ? 'This only clears the manual mark. Existing inspection reports are not changed.' :
              'Records inspection status only. It does not create a report or change any scheduled inspection.'}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-32 overflow-auto text-sm">
          {(selection?.customers || []).map(customer => <div key={customer.id}>{customer.name}</div>)}
        </div>
        {!selection?.clear && (
          <div className="space-y-2">
            <Label htmlFor="customer-inspection-date">Date inspected</Label>
            <Input id="customer-inspection-date" type="date" value={date} max={localToday()} onChange={event => setDate(event.target.value)} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={mutation.isPending} onClick={onDismiss}>Cancel</Button>
          <Button disabled={mutation.isPending || (!selection?.clear && !date)}
            onClick={() => mutation.mutate({ customers: selection.customers, clear: selection.clear, date, email })}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mutation.isPending ? 'Saving…' : selection?.clear ? 'Clear manual mark' : `Mark ${selection?.customers.length || 0} inspected`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
