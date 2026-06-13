import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import { CopyButton } from './copy-button';
import { formatUsdc, truncateAddress } from './format';

export interface DepositInstructionsProps {
  vaultAta: string;
  network: 'devnet' | 'mainnet-beta';
  minDepositUsdc: number;
  maxSingleDepositUsdc: number;
  maxTvlUsdc: number;
  currentTvlUsdc: string;
}

const codeStyle = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
  background: '#13161a',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: 13,
  wordBreak: 'break-all' as const,
};

export function DepositInstructions({
  vaultAta,
  network,
  minDepositUsdc,
  maxSingleDepositUsdc,
  maxTvlUsdc,
  currentTvlUsdc,
}: DepositInstructionsProps) {
  const headroom = Math.max(0, maxTvlUsdc - Number(currentTvlUsdc));
  return (
    <section
      style={{
        background: '#13161a',
        border: '1px solid #2c3036',
        borderRadius: 12,
        padding: '1.5rem',
      }}
    >
      <h2 style={{ marginTop: 0 }}>Send USDC to RivlayX vault</h2>
      <p style={{ opacity: 0.7, fontSize: 14 }}>
        From your linked Solana wallet, send USDC on <strong>{network}</strong> to the address
        below. We&apos;ll detect the transfer and credit your balance after Solana finality.
      </p>

      <div style={{ marginTop: '1.5rem' }}>
        <div
          style={{
            fontSize: 12,
            textTransform: 'uppercase',
            opacity: 0.6,
            letterSpacing: 0.4,
            marginBottom: '0.3rem',
          }}
        >
          Vault USDC address
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <code style={codeStyle}>{vaultAta}</code>
          <CopyButton text={vaultAta} label="Copy address" />
        </div>
      </div>

      <div style={{ marginTop: '1.25rem' }}>
        <div
          style={{
            fontSize: 12,
            textTransform: 'uppercase',
            opacity: 0.6,
            letterSpacing: 0.4,
            marginBottom: '0.3rem',
          }}
        >
          USDC mint ({network})
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <code style={codeStyle}>{truncateAddress(USDC_MINT_ADDRESS, 8, 8)}</code>
          <CopyButton text={USDC_MINT_ADDRESS} label="Copy mint" />
        </div>
      </div>

      <div
        style={{
          marginTop: '1.5rem',
          padding: '1rem',
          background: '#0b0d10',
          borderRadius: 8,
          border: '1px solid #2c3036',
          fontSize: 14,
        }}
      >
        <strong>Safety brakes (Fase 1)</strong>
        <ul style={{ margin: '0.5rem 0 0 1.25rem', padding: 0, lineHeight: 1.7 }}>
          <li>
            Minimum per deposit: <strong>{formatUsdc(minDepositUsdc)} USDC</strong>
          </li>
          <li>
            Maximum per deposit: <strong>{formatUsdc(maxSingleDepositUsdc)} USDC</strong>
          </li>
          <li>
            Platform TVL cap: <strong>{formatUsdc(maxTvlUsdc)} USDC</strong> — your remaining
            headroom: <strong>{formatUsdc(headroom)} USDC</strong>
          </li>
          <li>Deposits outside these bounds are auto-rejected (no balance change).</li>
        </ul>
      </div>
    </section>
  );
}
