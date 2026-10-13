import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { matchesStormFilter, STORM_FILTER_KEYS } from '@/lib/stormFilter';
import { InspectionPill } from '@/pages/Leads';

function makeLead(over = {}) {
  return { id: 'lead-1', name: 'Test Lead', status: 'new', value: 0, ...over };
}

function makeJob(over = {}) {
  return {
    id: 'job-1',
    status: 'scheduled',
    scheduled_date: new Date().toISOString(),
    assigned_to_name: 'Inspector Ivy',
    property_address: '123 Main St',
    ...over,
  };
}

describe('matchesStormFilter (Storm Mode chip predicate)', () => {
  const today = new Date('2026-04-18T12:00:00');
  const yesterday = new Date('2026-04-17T12:00:00');

  // Sanity: every chip key in Leads.jsx is covered by the helper.
  it('exposes all five chip keys', () => {
    expect(STORM_FILTER_KEYS).toEqual([
      'all',
      'not_inspected',
      'scheduled_today',
      'inspected_no_estimate',
      'sold',
    ]);
  });

  it('"all" returns every lead', () => {
    expect(matchesStormFilter(makeLead(), null, 'all', today)).toBe(true);
    expect(matchesStormFilter(makeLead(), makeJob(), 'all', today)).toBe(true);
  });

  it('"not_inspected" only matches leads with no inspection job', () => {
    expect(matchesStormFilter(makeLead(), null, 'not_inspected', today)).toBe(true);
    expect(matchesStormFilter(makeLead(), makeJob(), 'not_inspected', today)).toBe(false);
  });

  describe('"scheduled_today"', () => {
    it('matches a job with a scheduled status and today scheduled_date', () => {
      const job = makeJob({ status: 'scheduled', scheduled_date: today.toISOString() });
      expect(matchesStormFilter(makeLead(), job, 'scheduled_today', today)).toBe(true);
    });

    it('matches assigned/in_progress/draft as well', () => {
      for (const status of ['assigned', 'in_progress', 'draft']) {
        const job = makeJob({ status, scheduled_date: today.toISOString() });
        expect(matchesStormFilter(makeLead(), job, 'scheduled_today', today)).toBe(true);
      }
    });

    it('rejects a completed job even if its scheduled_date is today', () => {
      const job = makeJob({ status: 'completed', scheduled_date: today.toISOString() });
      expect(matchesStormFilter(makeLead(), job, 'scheduled_today', today)).toBe(false);
    });

    it('rejects a job scheduled for a different day', () => {
      const job = makeJob({ status: 'scheduled', scheduled_date: yesterday.toISOString() });
      expect(matchesStormFilter(makeLead(), job, 'scheduled_today', today)).toBe(false);
    });

    it('rejects a job with no scheduled_date at all', () => {
      const job = makeJob({ status: 'scheduled', scheduled_date: null });
      expect(matchesStormFilter(makeLead(), job, 'scheduled_today', today)).toBe(false);
    });

    it('rejects leads with no inspection job', () => {
      expect(matchesStormFilter(makeLead(), null, 'scheduled_today', today)).toBe(false);
    });
  });

  describe('"inspected_no_estimate"', () => {
    it('matches a completed inspection with zero/null lead value', () => {
      const job = makeJob({ status: 'completed' });
      expect(matchesStormFilter(makeLead({ value: 0 }), job, 'inspected_no_estimate', today)).toBe(true);
      expect(matchesStormFilter(makeLead({ value: null }), job, 'inspected_no_estimate', today)).toBe(true);
    });

    it('rejects a completed inspection that already has an estimate value', () => {
      const job = makeJob({ status: 'completed' });
      expect(matchesStormFilter(makeLead({ value: 1500 }), job, 'inspected_no_estimate', today)).toBe(false);
    });

    it('rejects non-completed inspections', () => {
      const job = makeJob({ status: 'scheduled' });
      expect(matchesStormFilter(makeLead({ value: 0 }), job, 'inspected_no_estimate', today)).toBe(false);
    });

    it('rejects leads with no inspection job', () => {
      expect(matchesStormFilter(makeLead({ value: 0 }), null, 'inspected_no_estimate', today)).toBe(false);
    });
  });

  it('"sold" only matches leads with status === "won"', () => {
    expect(matchesStormFilter(makeLead({ status: 'won' }), null, 'sold', today)).toBe(true);
    expect(matchesStormFilter(makeLead({ status: 'new' }), null, 'sold', today)).toBe(false);
    expect(matchesStormFilter(makeLead({ status: 'won' }), makeJob(), 'sold', today)).toBe(true);
  });
});

describe('Storm Mode fixture: each chip narrows to the matching lead', () => {
  // The fixture mirrors what Kevin would see during a storm sweep.
  const today = new Date('2026-04-18T12:00:00');
  const notInspectedLead = makeLead({ id: 'lead-not', name: 'Not Inspected', value: 0 });
  const scheduledTodayLead = makeLead({ id: 'lead-sched', name: 'Scheduled Today', value: 0 });
  const completedZeroLead = makeLead({ id: 'lead-zero', name: 'Inspected Zero', value: 0 });
  const wonLead = makeLead({ id: 'lead-won', name: 'Won Lead', status: 'won', value: 5000 });

  const fixtures = [
    { lead: notInspectedLead, job: null },
    { lead: scheduledTodayLead, job: makeJob({ id: 'job-sched', status: 'scheduled', scheduled_date: today.toISOString() }) },
    { lead: completedZeroLead, job: makeJob({ id: 'job-done', status: 'completed', scheduled_date: today.toISOString() }) },
    { lead: wonLead, job: makeJob({ id: 'job-won', status: 'completed', scheduled_date: today.toISOString() }) },
  ];

  const visibleFor = (key) =>
    fixtures.filter(f => matchesStormFilter(f.lead, f.job, key, today)).map(f => f.lead.id);

  it('"all" shows every fixture lead', () => {
    expect(visibleFor('all')).toEqual(['lead-not', 'lead-sched', 'lead-zero', 'lead-won']);
  });

  it('"not_inspected" shows only the lead with no job', () => {
    expect(visibleFor('not_inspected')).toEqual(['lead-not']);
  });

  it('"scheduled_today" shows only the lead scheduled for today', () => {
    expect(visibleFor('scheduled_today')).toEqual(['lead-sched']);
  });

  it('"inspected_no_estimate" shows only the completed lead with zero value', () => {
    // wonLead is also completed but has value 5000 so it must be excluded.
    expect(visibleFor('inspected_no_estimate')).toEqual(['lead-zero']);
  });

  it('"sold" shows only the won lead', () => {
    expect(visibleFor('sold')).toEqual(['lead-won']);
  });
});

function renderWithQuery(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('<InspectionPill />', () => {
  it('renders the "Not Inspected" pill when no job exists', () => {
    const navigate = vi.fn();
    renderWithQuery(
      <InspectionPill lead={makeLead({ id: 'lead-x' })} job={null} photoCount={0} navigate={navigate} />
    );
    const pill = screen.getByTestId('pill-inspection-none-lead-x');
    expect(pill).toBeInTheDocument();
    fireEvent.click(pill);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('InspectionsDashboard'));
  });

  it('renders a status pill and opens a popover with inspector, photo count, and Open Inspection button', async () => {
    const navigate = vi.fn();
    const lead = makeLead({ id: 'lead-y' });
    const job = makeJob({
      id: 'job-y',
      status: 'completed',
      assigned_to_name: 'Inspector Ivy',
      scheduled_date: new Date('2026-04-18T10:00:00').toISOString(),
    });

    renderWithQuery(
      <InspectionPill lead={lead} job={job} photoCount={7} navigate={navigate} />
    );

    const pill = screen.getByTestId('pill-inspection-completed-lead-y');
    expect(pill).toBeInTheDocument();
    // Inspector initials and photo count are visible directly on the pill.
    expect(within(pill).getByText('II')).toBeInTheDocument();
    expect(within(pill).getByText('7')).toBeInTheDocument();

    fireEvent.click(pill);

    const popover = await screen.findByTestId('popover-inspection-job-y');
    expect(within(popover).getByText('Inspector Ivy')).toBeInTheDocument();
    expect(within(popover).getByText('7')).toBeInTheDocument();
    const openButton = within(popover).getByTestId('button-open-inspection-job-y');
    expect(openButton).toBeInTheDocument();
    fireEvent.click(openButton);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('jobId=job-y'));
  });
});
