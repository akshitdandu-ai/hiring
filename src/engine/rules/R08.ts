import type { Rule } from './types';

export const R08: Rule = ({ booking }) => {
  if (!booking.destinationType) return { findings: [], couldNotCheck: 'destination type is missing' };
  if (booking.destinationType !== 'Warehouse') return { findings: [] };
  if (booking.appointmentBooked === null) return { findings: [], couldNotCheck: 'the delivery appointment answer is missing' };
  if (booking.appointmentBooked) return { findings: [] };
  return {
    findings: [
      {
        ruleId: 'R-08',
        severity: 'Amber',
        scope: 'booking',
        problem: 'No delivery appointment booked for a warehouse delivery',
        evidence: `Destination type is Warehouse and the appointment is "No"${booking.fieldSources.appointmentBooked === 'default' ? ' (the cell was blank, so we treated it as No)' : ''}.`,
        fix: 'Book a delivery slot with the receiving warehouse before collection, or the delivery may be refused.',
      },
    ],
  };
};
