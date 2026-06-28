import Link from 'next/link';
import type { Deposit } from '@rivlayx/db';
import { DepositStatusBadge } from './deposit-status-badge';
import { formatUsdc, truncateAddress } from './format';
import { TableScroll } from '@/components/ui/table-scroll';
import { EmptyState } from '@/components/ui/empty-state';
import { IconArrowDownCircle } from '@/components/ui/icons';

export interface DepositsTableProps {
  deposits: Deposit[];
  network: 'devnet' | 'mainnet-beta';
  emptyMessage?: string;
}

const cellStyle = {
  padding: '0.6rem 0.75rem',
  borderBottom: '1px solid var(--rx-color-border)',
  fontSize: 'var(--rx-font-size-base)',
  verticalAlign: 'middle' as const,
};

const headStyle = {
  ...cellStyle,
  fontSize: 'var(--rx-font-size-xs)',
  fontWeight: 'var(--rx-font-weight-semibold)',
  textTransform: 'uppercase' as const,
  letterSpacing: 'var(--rx-letter-spacing-wide)',
  color: 'var(--rx-color-text-muted)',
};

function explorerHref(signature: string, network: 'devnet' | 'mainnet-beta'): string {
  const cluster = network === 'devnet' ? '?cluster=devnet' : '';
  return `https://solscan.io/tx/${signature}${cluster}`;
}

export function DepositsTable({ deposits, network, emptyMessage }: DepositsTableProps) {
  if (deposits.length === 0) {
    return (
      <EmptyState
        icon={<IconArrowDownCircle width={32} height={32} />}
        title="No deposits yet"
        hint={emptyMessage ?? 'Deposited USDC will show up here once detected on-chain.'}
        action={
          <Link
            href="/wallet/deposit"
            style={{
              display: 'inline-block',
              padding: '0.55rem 1.3rem',
              borderRadius: 'var(--rx-radius-lg)',
              background: 'var(--rx-color-primary)',
              color: 'var(--rx-color-primary-contrast)',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Deposit USDC
          </Link>
        }
      />
    );
  }

  return (
    <TableScroll>
      <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...headStyle, textAlign: 'left' as const }}>Amount</th>
          <th style={{ ...headStyle, textAlign: 'left' as const }}>Status</th>
          <th style={{ ...headStyle, textAlign: 'left' as const }}>From</th>
          <th style={{ ...headStyle, textAlign: 'left' as const }}>Tx</th>
          <th style={{ ...headStyle, textAlign: 'right' as const }}>Detected</th>
        </tr>
      </thead>
      <tbody>
        {deposits.map((d) => (
          <tr key={d.id}>
            <td style={{ ...cellStyle, fontWeight: 'var(--rx-font-weight-semibold)' }}>{formatUsdc(d.amountUsdc)}</td>
            <td style={cellStyle}>
              <DepositStatusBadge status={d.status} />
            </td>
            <td style={cellStyle}>
              <code style={{ fontSize: 'var(--rx-font-size-xs)' }}>{truncateAddress(d.sourceWallet)}</code>
            </td>
            <td style={cellStyle}>
              <a
                href={explorerHref(d.txSignature, network)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--rx-color-primary)', fontSize: 'var(--rx-font-size-xs)' }}
              >
                {truncateAddress(d.txSignature, 6, 6)} ↗
              </a>
            </td>
            <td style={{ ...cellStyle, textAlign: 'right' as const, color: 'var(--rx-color-text-faint)', fontSize: 'var(--rx-font-size-sm)' }}>
              {d.detectedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC
            </td>
          </tr>
        ))}
      </tbody>
      </table>
    </TableScroll>
  );
}
