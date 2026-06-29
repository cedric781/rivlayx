import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import {
  PolicyViolationError,
  assertTransferAllowed,
  checkTransferAllowed,
  describeWalletPolicy,
  type PrivyTransferPolicy,
} from './privy-policy';

const addr = () => Keypair.generate().publicKey.toBase58();
const ESCROW = 'Escrow1111111111111111111111111111111111111';
const USER = 'User1111111111111111111111111111111111111111';
const POLICY: PrivyTransferPolicy = {
  usdcMint: USDC_MINT_ADDRESS,
  allowedDestinations: [ESCROW],
  maxAmountUsdc: '25',
};

const base = { fromWallet: USER, toWallet: ESCROW, amountUsdc: '10', mint: USDC_MINT_ADDRESS };

describe('checkTransferAllowed', () => {
  it('allows a USDC transfer to an allowlisted destination within cap', () => {
    expect(checkTransferAllowed(base, POLICY)).toEqual({ allowed: true });
  });

  it('denies a non-USDC mint', () => {
    const d = checkTransferAllowed({ ...base, mint: 'OtherMint11111111111111111111111111111111' }, POLICY);
    expect(d.allowed).toBe(false);
  });

  it('denies a destination not on the allowlist', () => {
    const d = checkTransferAllowed({ ...base, toWallet: 'Rando111111111111111111111111111111111111' }, POLICY);
    expect(d.allowed).toBe(false);
  });

  it('denies a self-transfer', () => {
    const d = checkTransferAllowed({ ...base, toWallet: USER, fromWallet: USER }, POLICY);
    // self == not allowlisted anyway, but the explicit self guard fires first
    expect(d.allowed).toBe(false);
  });

  it('denies a zero or negative amount', () => {
    expect(checkTransferAllowed({ ...base, amountUsdc: '0' }, POLICY).allowed).toBe(false);
    expect(checkTransferAllowed({ ...base, amountUsdc: '-5' }, POLICY).allowed).toBe(false);
  });

  it('denies an amount over the cap', () => {
    expect(checkTransferAllowed({ ...base, amountUsdc: '25.000001' }, POLICY).allowed).toBe(false);
    expect(checkTransferAllowed({ ...base, amountUsdc: '25' }, POLICY).allowed).toBe(true);
  });
});

describe('checkTransferAllowed — dynamic destinations (withdrawals)', () => {
  const mint = USDC_MINT_ADDRESS;
  const escrow = addr();
  const user = addr();
  const external = addr();
  const dyn: PrivyTransferPolicy = {
    usdcMint: mint,
    allowDynamicDestinations: true,
    deniedDestinations: [escrow],
    maxAmountUsdc: '25',
  };

  it('allows any valid external destination within cap', () => {
    expect(
      checkTransferAllowed({ fromWallet: user, toWallet: external, amountUsdc: '10', mint }, dyn),
    ).toEqual({ allowed: true });
  });

  it('denies a denied destination (the escrow wallet)', () => {
    const d = checkTransferAllowed({ fromWallet: user, toWallet: escrow, amountUsdc: '10', mint }, dyn);
    expect(d.allowed).toBe(false);
  });

  it('denies an invalid (non-base58) destination', () => {
    const d = checkTransferAllowed(
      { fromWallet: user, toWallet: 'not-a-valid-wallet!!!', amountUsdc: '10', mint },
      dyn,
    );
    expect(d.allowed).toBe(false);
  });

  it('denies a self-transfer even in dynamic mode', () => {
    expect(
      checkTransferAllowed({ fromWallet: user, toWallet: user, amountUsdc: '10', mint }, dyn).allowed,
    ).toBe(false);
  });

  it('still enforces the mint restriction and the amount cap', () => {
    expect(
      checkTransferAllowed({ fromWallet: user, toWallet: external, amountUsdc: '10', mint: addr() }, dyn)
        .allowed,
    ).toBe(false);
    expect(
      checkTransferAllowed({ fromWallet: user, toWallet: external, amountUsdc: '25.000001', mint }, dyn)
        .allowed,
    ).toBe(false);
    expect(
      checkTransferAllowed({ fromWallet: user, toWallet: external, amountUsdc: '25', mint }, dyn).allowed,
    ).toBe(true);
  });
});

describe('assertTransferAllowed', () => {
  it('throws PolicyViolationError on a denied transfer', () => {
    expect(() => assertTransferAllowed({ ...base, mint: 'X' }, POLICY)).toThrow(PolicyViolationError);
  });
  it('does not throw on an allowed transfer', () => {
    expect(() => assertTransferAllowed(base, POLICY)).not.toThrow();
  });
});

describe('describeWalletPolicy', () => {
  it('is default-deny with a single USDC transfer allow rule', () => {
    const spec = describeWalletPolicy(POLICY);
    expect(spec.defaultDeny).toBe(true);
    expect(spec.allow).toHaveLength(1);
    expect(spec.allow[0]?.mint).toBe(USDC_MINT_ADDRESS);
    expect(spec.allow[0]?.destinations).toEqual([ESCROW]);
    expect(spec.deny).toContain('system:transfer');
  });

  it('describes dynamic mode as any destination with a denied set', () => {
    const spec = describeWalletPolicy({
      usdcMint: USDC_MINT_ADDRESS,
      allowDynamicDestinations: true,
      deniedDestinations: [ESCROW],
      maxAmountUsdc: '25',
    });
    expect(spec.allow[0]?.destinations).toBe('any');
    expect(spec.allow[0]?.deniedDestinations).toEqual([ESCROW]);
  });
});
