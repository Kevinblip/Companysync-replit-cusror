import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  FileText, 
  Users, 
  DollarSign, 
  Briefcase,
  Phone,
  Mail,
  Calendar,
  CheckCircle2
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";

export default function Activity() {
  const {
    user,
    myCompany,
    isAdmin,
    filterLeads,
    filterCustomers,
    filterTasks,
    filterInvoices,
  } = useRoleBasedData();

  const { data: allLeads = [] } = useQuery({
    queryKey: ['leads', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Lead.filter({ company_id: myCompany.id }, "-created_date", 100) : [],
    enabled: !!myCompany?.id,
    initialData: [],
  });

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 100) : [],
    enabled: !!myCompany?.id,
    initialData: [],
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Task.filter({ company_id: myCompany.id }, "-created_date", 100) : [],
    enabled: !!myCompany?.id,
    initialData: [],
  });

  const { data: allInvoices = [] } = useQuery({
    queryKey: ['invoices', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Invoice.filter({ company_id: myCompany.id }, "-created_date", 100) : [],
    enabled: !!myCompany?.id,
    initialData: [],
  });

  const { data: rawCommunications = [] } = useQuery({
    queryKey: ['communications', myCompany?.id],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      try {
        const comms = await base44.entities.Communication.filter({ company_id: myCompany.id }, "-created_date", 100);
        return Array.isArray(comms) ? comms : [];
      } catch (error) {
        console.error('Error fetching communications:', error);
        return [];
      }
    },
    enabled: !!myCompany?.id,
    initialData: [],
  });

  // Apply role-based filtering
  const customers = React.useMemo(() => filterCustomers(allCustomers), [allCustomers, filterCustomers]);
  const leads = React.useMemo(() => filterLeads(allLeads), [allLeads, filterLeads]);
  const tasks = React.useMemo(() => filterTasks(allTasks), [allTasks, filterTasks]);
  const invoices = React.useMemo(() => filterInvoices(allInvoices, customers), [allInvoices, customers, filterInvoices]);

  // Filter communications based on visible customers and leads
  const communications = React.useMemo(() => {
    if (!Array.isArray(rawCommunications)) return [];
    
    const validComms = rawCommunications.filter(comm => {
      if (!comm || typeof comm !== 'object') return false;
      if (!comm.communication_type) return false;
      if (!comm.id) return false;
      return true;
    });

    // Admin sees all communications
    if (isAdmin) return validComms;

    // Non-admin sees only communications with their assigned customers/leads
    const customerNames = customers.map(c => c.name);
    const leadNames = leads.map(l => l.name);
    
    return validComms.filter(comm => 
      customerNames.includes(comm.contact_name) || 
      leadNames.includes(comm.contact_name) ||
      comm.created_by === user?.email
    );
  }, [rawCommunications, isAdmin, customers, leads, user]);

  const activities = React.useMemo(() => {
    const validLeads = Array.isArray(leads) ? leads.filter(l => l && l.id) : [];
    const validCustomers = Array.isArray(customers) ? customers.filter(c => c && c.id) : [];
    const validTasks = Array.isArray(tasks) ? tasks.filter(t => t && t.id) : [];
    const validInvoices = Array.isArray(invoices) ? invoices.filter(i => i && i.id) : [];
    const validComms = Array.isArray(communications) ? communications.filter(c => c && c.id && c.communication_type) : [];

    const items = [
      ...validLeads.map(l => ({ type: 'lead', data: l, icon: Users, color: 'text-blue-600' })),
      ...validCustomers.map(c => ({ type: 'customer', data: c, icon: Users, color: 'text-green-600' })),
      ...validTasks.map(t => ({ type: 'task', data: t, icon: CheckCircle2, color: 'text-purple-600' })),
      ...validInvoices.map(i => ({ type: 'invoice', data: i, icon: DollarSign, color: 'text-orange-600' })),
      ...validComms.map(c => ({ 
        type: 'communication', 
        data: c, 
        icon: c.communication_type === 'email' ? Mail : Phone, 
        color: 'text-indigo-600' 
      }))
    ];

    return items.sort((a, b) => {
      const dateA = a.data?.created_date ? new Date(a.data.created_date) : new Date(0);
      const dateB = b.data?.created_date ? new Date(b.data.created_date) : new Date(0);
      return dateB - dateA;
    });
  }, [leads, customers, tasks, invoices, communications]);

  const getActivityText = (activity) => {
    if (!activity || !activity.type || !activity.data) return 'Activity recorded';

    switch(activity.type) {
      case 'lead':
        return `New lead added: ${activity.data.name || 'Unknown'}`;
      case 'customer':
        return `New customer: ${activity.data.name || 'Unknown'}`;
      case 'task':
        return `Task created: ${activity.data.name || 'Unknown'}`;
      case 'invoice':
        return `Invoice ${activity.data.invoice_number || 'N/A'} created for ${activity.data.customer_name || 'Unknown'}`;
      case 'communication':
        return `${activity.data.communication_type || 'communication'} with ${activity.data.contact_name || 'Unknown'}`;
      default:
        return 'Activity recorded';
    }
  };

  const formatDateSafe = (dateString) => {
    if (!dateString) return 'Unknown date';
    try {
      // Use parseISO to handle the string, then format it.
      // This is more robust than new Date() for ISO strings.
      const date = parseISO(dateString);
      return format(date, 'MMM d, yyyy h:mm a');
    } catch (error) {
      console.warn("Date formatting error:", error);
      // Fallback for weird date formats
      return dateString;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Activity Feed</h1>
        <p className="text-gray-500 mt-1">Track all recent activities in your CRM</p>
      </div>

      <Card className="bg-white shadow-md">
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {activities.slice(0, 50).map((activity, idx) => {
              if (!activity || !activity.data || !activity.icon) return null;

              const Icon = activity.icon;
              
              return (
                <div key={`${activity.type}-${activity.data.id}-${idx}`} className="flex items-start gap-4 pb-4 border-b last:border-b-0">
                  <div className={`w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0`}>
                    <Icon className={`w-5 h-5 ${activity.color || 'text-gray-600'}`} />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{getActivityText(activity)}</p>
                    <p className="text-sm text-gray-500 mt-1">
                      {formatDateSafe(activity.data.created_date)}
                      {activity.data.created_by && ` • by ${activity.data.created_by}`}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {activity.type}
                  </Badge>
                </div>
              );
            })}
            {activities.length === 0 && (
              <div className="py-12 text-center text-gray-500">
                No activity yet
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}