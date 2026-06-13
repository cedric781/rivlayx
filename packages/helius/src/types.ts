import { z } from 'zod';

/**
 * Solana base58 pubkeys are 32-44 chars. We allow a wider band for safety —
 * the cryptographic check happens elsewhere; this schema is shape-only.
 */
const SolanaAddressSchema = z.string().min(32).max(64);

export const tokenTransferSchema = z.object({
  fromUserAccount: SolanaAddressSchema,
  toUserAccount: SolanaAddressSchema,
  fromTokenAccount: SolanaAddressSchema.nullable(),
  toTokenAccount: SolanaAddressSchema.nullable(),
  tokenAmount: z.number().finite().nonnegative(),
  mint: SolanaAddressSchema,
  tokenStandard: z.string().optional(),
});
export type TokenTransfer = z.infer<typeof tokenTransferSchema>;

export const tokenTransferEventSchema = z.object({
  type: z.literal('TOKEN_TRANSFER'),
  signature: z.string().min(40).max(128),
  slot: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
  tokenTransfers: z.array(tokenTransferSchema).min(1),
});
export type TokenTransferEvent = z.infer<typeof tokenTransferEventSchema>;

/**
 * Helius enhanced webhooks deliver an array of events. For Sprint 4 we only
 * accept TOKEN_TRANSFER; other event types are rejected at parse time.
 */
export const webhookEnvelopeSchema = z.array(tokenTransferEventSchema);
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;
