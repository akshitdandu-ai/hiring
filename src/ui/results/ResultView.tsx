import type { BookingResult } from '../../model/types';
import { CarrierCard } from './CarrierCard';
import { ChecksPanel } from './ChecksPanel';
import { ConfirmationCard } from './ConfirmationCard';
import { StatusBanner } from './StatusBanner';

/** The full result for one booking: banner, issues, carrier, confirmation and next steps. */
export function ResultView({ result }: { result: BookingResult }) {
  return (
    <div className="space-y-4">
      <StatusBanner status={result.status} reason={result.statusReason} />
      <ChecksPanel result={result} />
      <CarrierCard result={result} />
      <ConfirmationCard result={result} />
    </div>
  );
}
