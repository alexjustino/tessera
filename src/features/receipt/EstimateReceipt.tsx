import { useMemo } from 'react';

import type { Item } from '@/domain/item';
import { receiptOf } from '@/domain/receipt';
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
  const receipt = useMemo(
    () =>
      ledger === null
        ? null
        : receiptOf(ledger, { kind: 'estimate', itemId: task.id, minutes }, now),
    [ledger, task.id, minutes, now],
  );
  return <ReceiptPanel receipt={receipt} />;
}
