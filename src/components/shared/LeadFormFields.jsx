import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function LeadFormFields({ formData, setFormData, staffProfiles, t }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Primary Contact *</Label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            required
            placeholder="John Doe"
            className="h-12 text-base"
          />
        </div>
        <div>
          <Label>Company</Label>
          <Input
            value={formData.company}
            onChange={(e) => setFormData({...formData, company: e.target.value})}
            placeholder="ABC Corporation"
            className="h-12 text-base"
          />
        </div>
        <div>
          <Label>{t.leads.email}</Label>
          <Input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({...formData, email: e.target.value})}
            placeholder="john@example.com"
            className="h-12 text-base"
          />
        </div>
        <div>
          <Label>{t.leads.phone} 1</Label>
          <Input
            value={formData.phone}
            onChange={(e) => setFormData({...formData, phone: e.target.value})}
            placeholder="(555) 123-4567"
            className="h-12 text-base"
          />
        </div>
        <div>
          <Label>{t.leads.phone} 2</Label>
          <Input
            value={formData.phone_2}
            onChange={(e) => setFormData({...formData, phone_2: e.target.value})}
            placeholder="(555) 987-6543"
            className="h-12 text-base"
          />
        </div>
        <div>
          <Label>{t.leads.assignedTo}</Label>
          <Select
            value={formData.assigned_to_users && formData.assigned_to_users.length === 1
                  ? formData.assigned_to_users[0]
                  : (formData.assigned_to_users && formData.assigned_to_users.length > 1 ? "multiple_selected" : "unassigned")
            }
            onValueChange={(clickedEmail) => {
              const currentUsers = Array.isArray(formData.assigned_to_users) ? [...formData.assigned_to_users] : [];
              if (clickedEmail === "clear_all" || clickedEmail === "unassigned") {
                setFormData({ ...formData, assigned_to_users: [], assigned_to: "" });
              } else if (currentUsers.includes(clickedEmail)) {
                const updated = currentUsers.filter(u => u !== clickedEmail);
                setFormData({ ...formData, assigned_to_users: updated, assigned_to: updated[0] || "" });
              } else if (clickedEmail !== "multiple_selected") {
                const updated = [...currentUsers, clickedEmail];
                setFormData({ ...formData, assigned_to_users: updated, assigned_to: updated[0] || "" });
              }
            }}
          >
            <SelectTrigger className="h-12 text-base">
              <SelectValue placeholder="Select staff members">
                {formData.assigned_to_users && formData.assigned_to_users.length > 0
                  ? `${formData.assigned_to_users.length} assigned`
                  : "Select staff members"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              <SelectItem value="clear_all">Clear All</SelectItem>
              {staffProfiles
                .filter(staff => staff.user_email && staff.user_email.trim() !== "")
                .map(staff => {
                  const isSelected = formData.assigned_to_users?.includes(staff.user_email);
                  return (
                    <SelectItem key={staff.user_email} value={staff.user_email}>
                      <div className="flex items-center gap-2">
                        {isSelected && <span className="mr-2">✓</span>}
                        {staff.full_name || staff.user_email}
                      </div>
                    </SelectItem>
                  );
                })}
            </SelectContent>
          </Select>
          {formData.assigned_to_users && formData.assigned_to_users.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {formData.assigned_to_users.map(email => {
                const staff = staffProfiles.find(s => s.user_email === email);
                return (
                  <Badge key={email} variant="secondary" className="text-xs">
                    {staff?.full_name || email}
                  </Badge>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <Label>{t.leads.status}</Label>
          <Select value={formData.status} onValueChange={(v) => setFormData({...formData, status: v})}>
            <SelectTrigger className="h-12 text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">{t.leads.newLead}</SelectItem>
              <SelectItem value="contacted">{t.leads.contacted}</SelectItem>
              <SelectItem value="qualified">{t.leads.qualified}</SelectItem>
              <SelectItem value="proposal">{t.leads.proposalSent}</SelectItem>
              <SelectItem value="negotiation">{t.leads.negotiation}</SelectItem>
              <SelectItem value="won">{t.leads.won}</SelectItem>
              <SelectItem value="lost">{t.leads.lost}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="font-semibold mb-3">{t.leads.address}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="col-span-1 sm:col-span-2">
            <Label>Street</Label>
            <Input
              value={formData.street}
              onChange={(e) => setFormData({...formData, street: e.target.value})}
              placeholder="123 Main Street"
              className="h-12 text-base"
            />
          </div>
          <div>
            <Label>{t.leads.city}</Label>
            <Input
              value={formData.city}
              onChange={(e) => setFormData({...formData, city: e.target.value})}
              placeholder="Mansfield"
              className="h-12 text-base"
            />
          </div>
          <div>
            <Label>{t.leads.state}</Label>
            <Input
              value={formData.state}
              onChange={(e) => setFormData({...formData, state: e.target.value})}
              placeholder="OH"
              maxLength={2}
              className="h-12 text-base"
            />
          </div>
          <div>
            <Label>{t.leads.zip}</Label>
            <Input
              value={formData.zip}
              onChange={(e) => setFormData({...formData, zip: e.target.value})}
              placeholder="44903"
              className="h-12 text-base"
            />
          </div>
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="font-semibold mb-3">{t.leads.source}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>{t.leads.source}</Label>
            <Select value={formData.source} onValueChange={(v) => setFormData({...formData, source: v})}>
              <SelectTrigger className="h-12 text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual Entry</SelectItem>
                <SelectItem value="website">Website</SelectItem>
                <SelectItem value="referral">Referral</SelectItem>
                <SelectItem value="social_media">Social Media</SelectItem>
                <SelectItem value="advertisement">Advertisement</SelectItem>
                <SelectItem value="cold_call">Cold Call</SelectItem>
                <SelectItem value="storm_tracker">Storm Tracker</SelectItem>
                <SelectItem value="property_importer">Property Importer</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t.leads.value}</Label>
            <Input
              type="number"
              value={formData.value}
              onChange={(e) => setFormData({...formData, value: parseFloat(e.target.value)})}
              placeholder="0"
              className="h-12 text-base"
            />
          </div>
          <div className="col-span-1 sm:col-span-2">
            <Label>Source Details (Optional)</Label>
            <Input
              placeholder="e.g., Mansfield Hail Storm - Jan 15, 2024"
              value={formData.lead_source}
              onChange={(e) => setFormData({...formData, lead_source: e.target.value})}
              className="h-12 text-base"
            />
          </div>
          <div className="col-span-1 sm:col-span-2">
            <Label>Referred By <span className="text-gray-400 font-normal text-xs">(optional)</span></Label>
            <Input
              placeholder="Name of person who referred this lead"
              value={formData.referred_by}
              onChange={(e) => setFormData({...formData, referred_by: e.target.value})}
              className="h-12 text-base"
              data-testid="input-referred-by-lead"
            />
          </div>
        </div>
      </div>

      <div>
        <Label>{t.leads.notes}</Label>
        <Textarea
          value={formData.notes}
          onChange={(e) => setFormData({...formData, notes: e.target.value})}
          rows={3}
          placeholder="Add any additional notes about this lead..."
        />
      </div>
      <div className="flex items-center gap-3">
        <Switch
          checked={formData.is_active}
          onCheckedChange={(checked) => setFormData({...formData, is_active: checked})}
        />
        <Label>Active</Label>
      </div>
    </div>
  );
}
