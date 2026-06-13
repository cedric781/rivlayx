'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { marketplace } from '@rivlayx/core';
import { resolveTypeValues } from '@rivlayx/db';
import { humanizeCategory, humanizeResolveType } from '@/lib/marketplace/format';

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

  const [q, setQ] = useState(sp.get('q') ?? '');
  const [category, setCategory] = useState(sp.get('category') ?? '');
  const [sport, setSport] = useState(sp.get('sport') ?? '');
  const [resolveType, setResolveType] = useState(sp.get('resolveType') ?? '');
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
    if (minStake) params.set('minStake', minStake);
    if (maxStake) params.set('maxStake', maxStake);
    router.push(params.toString() ? `/bets?${params.toString()}` : '/bets');
  }

  function clear() {
    setQ('');
    setCategory('');
    setSport('');
    setResolveType('');
    setMinStake('');
    setMaxStake('');
    const section = sp.get('section');
    router.push(section ? `/bets?section=${section}` : '/bets');
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
      <input
        type="search"
        placeholder="Search bets…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ ...inputStyle, flex: '1 1 200px' }}
        aria-label="Search bets"
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

      <input
        type="number"
        inputMode="decimal"
        min="0"
        placeholder="Min $"
        value={minStake}
        onChange={(e) => setMinStake(e.target.value)}
        style={{ ...inputStyle, width: 90 }}
        aria-label="Minimum stake"
      />
      <input
        type="number"
        inputMode="decimal"
        min="0"
        placeholder="Max $"
        value={maxStake}
        onChange={(e) => setMaxStake(e.target.value)}
        style={{ ...inputStyle, width: 90 }}
        aria-label="Maximum stake"
      />

      <button
        type="submit"
        style={{ ...inputStyle, cursor: 'pointer', background: '#1f2937', color: '#fff', fontWeight: 600 }}
      >
        Apply
      </button>
      <button type="button" onClick={clear} style={{ ...inputStyle, cursor: 'pointer' }}>
        Clear
      </button>
    </form>
  );
}
