import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { BrowseQuery, BrowseRange, PageMetadata } from '../api/types';
import { useResource } from './useResource';

export function useBrowse<T extends { pagination?: PageMetadata }>(fetchRows: (query: BrowseQuery) => Promise<T>, filterKey: 'status' | 'level' = 'status') {
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [search, setSearch] = useState(query);
  const [filter, setFilter] = useState(params.get(filterKey) ?? 'All');
  const [range, setRange] = useState<BrowseRange>(['7d', '30d', '90d'].includes(params.get('range') ?? '') ? params.get('range') as BrowseRange : 'all');
  const [page, setPage] = useState(1);
  const [before, setBefore] = useState<string>();
  useEffect(() => { const timer = setTimeout(() => setSearch(query), 250); return () => clearTimeout(timer); }, [query]);
  const load = useCallback(() => fetchRows({ page, q: search, range, before, [filterKey]: filter }), [fetchRows, page, search, range, before, filterKey, filter]);
  const resource = useResource(load, [page, search, range, before, filter]);
  useEffect(() => {
    const metadata = resource.data?.pagination;
    if (metadata?.page === page && page > Math.max(1, Math.ceil(metadata.total / metadata.pageSize))) {
      setBefore(metadata.asOf); setPage(Math.max(1, Math.ceil(metadata.total / metadata.pageSize)));
    }
  }, [resource.data?.pagination, page]);
  function reset() { setPage(1); setBefore(undefined); }
  function changePage(next: number) { setBefore(resource.data?.pagination?.asOf); setPage(next); }
  return { ...resource, query, filter, range, page,
    busy: resource.loading || search !== query,
    setQuery: (value: string) => { reset(); setQuery(value); },
    setFilter: (value: string) => { reset(); setFilter(value); },
    setRange: (value: BrowseRange) => { reset(); setRange(value); },
    setPage: changePage,
    refresh: () => { reset(); resource.reload(); },
  };
}
