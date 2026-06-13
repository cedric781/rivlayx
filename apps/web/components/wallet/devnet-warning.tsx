export function DevnetWarning({ network }: { network: 'devnet' | 'mainnet-beta' }) {
  if (network === 'mainnet-beta') return null;
  return (
    <div
      role="alert"
      style={{
        background: '#3a2c0a',
        color: '#f0c674',
        padding: '0.75rem 1rem',
        borderRadius: 6,
        border: '1px solid #5c4a1a',
        marginBottom: '1.5rem',
        fontSize: 14,
      }}
    >
      <strong>Solana devnet</strong> — do not send mainnet USDC. Use a devnet faucet only.
    </div>
  );
}
