import React from 'react';
import { Button } from '../../ui/button';
import { auditBannerText } from './loanScheduleUtils';

/** Amber banner on the Loans screen when the schedule audit finds legacy schedules. */
const ScheduleAuditBanner = ({ audit, onReview }) => {
  const text = auditBannerText(audit);
  if (!text) return null;
  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 sm:flex-row sm:items-center sm:justify-between"
      role="status"
      data-testid="schedule-audit-banner"
    >
      <div className="space-y-1 text-sm">
        <p className="font-semibold">{text.title}</p>
        <p>{text.detail}</p>
      </div>
      <Button type="button" variant="outline" className="shrink-0 border-amber-400 bg-white" onClick={onReview}>
        Review &amp; repair
      </Button>
    </div>
  );
};

export default ScheduleAuditBanner;
