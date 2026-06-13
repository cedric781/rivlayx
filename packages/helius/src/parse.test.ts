import { describe, expect, it } from 'vitest';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import { ParseError, parseSplTransfer } from './parse';
import { buildMockTokenTransfer } from './mock-webhook';

const VAULT_ATA = 'VaultAta1111111111111111111111111111111111';
const OTHER_MINT = 'OtherMint11111111111111111111111111111111';
const OTHER_DEST = 'OtherAta1111111111111111111111111111111111';

const opts = { expectedMint: USDC_MINT_ADDRESS, expectedDestAta: VAULT_ATA };

describe('parseSplTransfer — happy path', () => {
  it('extracts the USDC transfer to the vault ATA', () => {
    const event = buildMockTokenTransfer({
      sourceWallet: 'UserWallet111111111111111111111111111111111',
      destAta: VAULT_ATA,
      amountUsdc: 25.5,
    });
    const parsed = parseSplTransfer(event, opts);
    expect(parsed.signature).toBe(event.signature);
    expect(parsed.amountUsdc).toBe('25.500000');
    expect(parsed.destAta).toBe(VAULT_ATA);
    expect(parsed.mint).toBe(USDC_MINT_ADDRESS);
  });

  it('formats integer amounts at full USDC precision', () => {
    const event = buildMockTokenTransfer({
      sourceWallet: 'UserWallet111111111111111111111111111111111',
      destAta: VAULT_ATA,
      amountUsdc: 100,
    });
    const parsed = parseSplTransfer(event, opts);
    expect(parsed.amountUsdc).toBe('100.000000');
  });

  it('handles fractional sub-cent amounts', () => {
    const event = buildMockTokenTransfer({
      sourceWallet: 'UserWallet111111111111111111111111111111111',
      destAta: VAULT_ATA,
      amountUsdc: 0.123456,
    });
    const parsed = parseSplTransfer(event, opts);
    expect(parsed.amountUsdc).toBe('0.123456');
  });
});

describe('parseSplTransfer — rejects bad structure', () => {
  it('rejects non-USDC mint', () => {
    const event = buildMockTokenTransfer({
      sourceWallet: 'UserWallet111111111111111111111111111111111',
      destAta: VAULT_ATA,
      amountUsdc: 10,
      mint: OTHER_MINT,
    });
    try {
      parseSplTransfer(event, opts);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).code).toBe('WRONG_MINT');
    }
  });

  it('rejects USDC transfer to wrong destination', () => {
    const event = buildMockTokenTransfer({
      sourceWallet: 'UserWallet111111111111111111111111111111111',
      destAta: OTHER_DEST,
      amountUsdc: 10,
    });
    try {
      parseSplTransfer(event, opts);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).code).toBe('WRONG_DESTINATION');
    }
  });

  it('picks the matching transfer when event has multiple legs', () => {
    const event = buildMockTokenTransfer({
      sourceWallet: 'UserWallet111111111111111111111111111111111',
      destAta: VAULT_ATA,
      amountUsdc: 10,
    });
    // Inject a non-matching leg before the USDC one.
    event.tokenTransfers.unshift({
      fromUserAccount: 'Other111111111111111111111111111111111111',
      toUserAccount: 'Other211111111111111111111111111111111111',
      fromTokenAccount: null,
      toTokenAccount: null,
      tokenAmount: 999,
      mint: OTHER_MINT,
      tokenStandard: 'Fungible',
    });
    const parsed = parseSplTransfer(event, opts);
    expect(parsed.amountUsdc).toBe('10.000000');
  });
});
