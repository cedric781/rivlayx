'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import * as marketplace from '@rivlayx/core/marketplace/types';
import { resolveTypeValues } from '@rivlayx/db/schema';
import { humanizeCategory, humanizeResolveType } from '@/lib/marketplace/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/toast/toast-provider';

/** Exact creator-tier filter options (Sprint 16). */
const TIER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'trusted', label: 'Trusted' },
  { value: 'gold', label: 'Gold' },
  { value: 'silver', label: 'Silver' },
  { value: 'bronze', label: 'Bronze' },
  { value: 'new', label: 'New' },
];

const inputStyle: React.CSSProperties = {
  padding: '0.4rem 0.55rem',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  fontSize: 14,
  background: '#fff',
};

export function MarketplaceFilters() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();

  const [q, setQ] = useState(sp.get('q') ?? '');
  const [category, setCategory] = useState(sp.get('category') ?? '');
  const [sport, setSport] = useState(sp.get('sport') ?? '');
  const [resolveType, setResolveType] = useState(sp.get('resolveType') ?? '');
  const [tier, setTier] = useState(sp.get('tier') ?? '');
  const [minStake, setMinStake] = useState(sp.get('minStake') ?? '');
  const [maxStake, setMaxStake] = useState(sp.get('maxStake') ?? '');

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    const section = sp.get('section');
    if (section) params.set('section', section);
    if (q.trim()) params.set('q', q.trim());
    if (category) params.set('category', category);
    if (sport) params.set('sport', sport);
    if (resolveType) params.set('resolveType', resolveType);
    if (tier) params.set('tier', tier);
    if (minStake) params.set('minStake', minStake);
    if (maxStake) params.set('maxStake', maxStake);
    router.push(params.toString() ? `/bets?${params.toString()}` : '/bets');
  }

  function clear() {
    const hadFilters = Boolean(
      q || category || sport || resolveType || tier || minStake || maxStake,
    );
    setQ('');
    setCategory('');
    setSport('');
    setResolveType('');
    setTier('');
    setMinStake('');
    setMaxStake('');
    const section = sp.get('section');
    router.push(section ? `/bets?section=${section}` : '/bets');
    if (hadFilters) toast.info('Filters cleared');
  }

  return (
    <form
      onSubmit={apply}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.6rem',
        alignItems: 'center',
        padding: '0.9rem',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        background: '#fafafa',
        marginBottom: '1.25rem',
      }}
    >
      <Input
        label="Search bets"
        hideLabel
        type="search"
        placeholder="Search bets…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        fullWidth={false}
        containerStyle={{ flex: '1 1 200px' }}
        style={{
          padding: '0.4rem 0.55rem',
          borderColor: 'var(--rx-color-paper-border-strong)',
          fontSize: 'var(--rx-font-size-base)',
        }}
      />

      <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} aria-label="Category">
        <option value="">All categories</option>
        {marketplace.categoryFacetValues.map((c) => (
          <option key={c} value={c}>
            {humanizeCategory(c)}
          </option>
        ))}
      </select>

      <select value={sport} onChange={(e) => setSport(e.target.value)} style={inputStyle} aria-label="Sport">
        <option value="">Any sport</option>
        {marketplace.SPORT_CATEGORIES.map((s) => (
          <option key={s} value={s}>
            {humanizeCategory(s)}
          </option>
        ))}
      </select>

      <select
        value={resolveType}
        onChange={(e) => setResolveType(e.target.value)}
        style={inputStyle}
        aria-label="Resolve type"
      >
        <option value="">Any resolve</option>
        {resolveTypeValues.map((r) => (
          <option key={r} value={r}>
            {humanizeResolveType(r)}
          </option>
        ))}
      </select>

      <select value={tier} onChange={(e) => setTier(e.target.value)} style={inputStyle} aria-label="Creator tier">
        <option value="">All tiers</option>
        {TIER_OPTIONS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      <Input
        label="Minimum stake"
        hideLabel
        type="number"
        inputMode="decimal"
        min="0"
        placeholder="Min $"
        value={minStake}
        onChange={(e) => setMinStake(e.target.value)}
        fullWidth={false}
        containerStyle={{ flex: '1 1 110px', minWidth: 0 }}
        style={{
          width: '100%',
          padding: '0.4rem 0.55rem',
          borderColor: 'var(--rx-color-paper-border-strong)',
          fontSize: 'var(--rx-font-size-base)',
        }}
      />
      <Input
        label="Maximum stake"
        hideLabel
        type="number"
        inputMode="decimal"
        min="0"
        placeholder="Max $"
        value={maxStake}
        onChange={(e) => setMaxStake(e.target.value)}
        fullWidth={false}
        containerStyle={{ flex: '1 1 110px', minWidth: 0 }}
        style={{
          width: '100%',
          padding: '0.4rem 0.55rem',
          borderColor: 'var(--rx-color-paper-border-strong)',
          fontSize: 'var(--rx-font-size-base)',
        }}
      />

      <Button
        type="submit"
        variant="primary"
        size="sm"
        style={{
          padding: '0.4rem 0.55rem',
          fontSize: 'var(--rx-font-size-base)',
          borderColor: 'var(--rx-color-paper-border-strong)',
        }}
      >
        Apply
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={clear}
        style={{
          padding: '0.4rem 0.55rem',
          fontSize: 'var(--rx-font-size-base)',
          fontWeight: 'var(--rx-font-weight-normal)',
          borderColor: 'var(--rx-color-paper-border-strong)',
        }}
      >
        Clear
      </Button>
    </form>
  );
}
