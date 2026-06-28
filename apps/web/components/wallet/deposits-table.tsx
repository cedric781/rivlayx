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
  borderBottom: '1px solid #2c3036',
  fontSize: 14,
  verticalAlign: 'middle' as const,
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
          <th style={{ ...cellStyle, textAlign: 'left' as const, opacity: 0.6 }}>Amount</th>
          <th style={{ ...cellStyle, textAlign: 'left' as const, opacity: 0.6 }}>Status</th>
          <th style={{ ...cellStyle, textAlign: 'left' as const, opacity: 0.6 }}>From</th>
          <th style={{ ...cellStyle, textAlign: 'left' as const, opacity: 0.6 }}>Tx</th>
          <th style={{ ...cellStyle, textAlign: 'right' as const, opacity: 0.6 }}>Detected</th>
        </tr>
      </thead>
      <tbody>
        {deposits.map((d) => (
          <tr key={d.id}>
            <td style={cellStyle}>{formatUsdc(d.amountUsdc)}</td>
            <td style={cellStyle}>
              <DepositStatusBadge status={d.status} />
            </td>
            <td style={cellStyle}>
              <code style={{ fontSize: 12 }}>{truncateAddress(d.sourceWallet)}</code>
            </td>
            <td style={cellStyle}>
              <a
                href={explorerHref(d.txSignature, network)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#5b8def', fontSize: 12 }}
              >
                {truncateAddress(d.txSignature, 6, 6)} ↗
              </a>
            </td>
            <td style={{ ...cellStyle, textAlign: 'right' as const, opacity: 0.7, fontSize: 13 }}>
              {d.detectedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC
            </td>
          </tr>
        ))}
      </tbody>
      </table>
    </TableScroll>
  );
}
