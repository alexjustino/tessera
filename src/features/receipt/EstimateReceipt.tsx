import { useMemo } from 'react';

import type { Item } from '@/domain/item';
import { calibrationOf, forecastTask } from '@/domain/confidence';
import { applyProposal, receiptOf } from '@/domain/receipt';
import { useNow } from '@/ui/useNow';

import { ReceiptPanel } from './ReceiptPanel';
import { useLedger } from './useLedger';

/**
 * The receipt for an estimate being typed: mounted only while the draft
 * differs from what is stored, so opening a task reads nothing more than it
 * did before — the year of calendar the receipt needs is fetched when there
 * is a price to show, not on every open.
 */
export function EstimateReceipt({ task, minutes }: { task: Item; minutes: number | null }) {
  const now = useNow(null);
  const ledger = useLedger(now);

  const priced = useMemo(() => {
    if (ledger === null) return null;
    const proposal = { kind: 'estimate', itemId: task.id, minutes } as const;
    const receipt = receiptOf(ledger, proposal, now);
    const applied = applyProposal(ledger.items, proposal, now);
    // The range is drawn from finished work, which the change does not touch.
    const calibration = calibrationOf(ledger.items, ledger.tracked);
    const forecast =
      applied === null
        ? null
        : forecastTask({ ...ledger, items: applied.items }, calibration, task.id);
    return { receipt, forecast, sample: calibration.sample };
  }, [ledger, task.id, minutes, now]);

  return (
    <ReceiptPanel
      receipt={priced?.receipt ?? null}
      forecast={priced?.forecast ?? null}
      sample={priced?.sample ?? 0}
    />
  );
}
