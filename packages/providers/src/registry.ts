import { ProviderError } from './errors';
import type { ResolveProvider, SupportedPredicate } from './types';

/**
 * In-memory registry of `ResolveProvider` instances. The auto-resolve runner
 * uses `getFor(predicate)` to pick the first registered provider that claims
 * support — order of registration determines precedence.
 */
export class ProviderRegistry {
  private providers: ResolveProvider[] = [];

  register(provider: ResolveProvider): void {
    this.providers.push(provider);
  }

  /** All registered providers, in registration order. */
  list(): readonly ResolveProvider[] {
    return this.providers;
  }

  /** First provider whose `supports(predicate)` returns true. */
  getFor(predicate: SupportedPredicate): ResolveProvider {
    const found = this.providers.find((p) => p.supports(predicate));
    if (!found) {
      throw new ProviderError(
        'NO_PROVIDER_FOR_PREDICATE',
        `no provider registered for predicate.type=${predicate.type}`,
      );
    }
    return found;
  }
}
