'use client';

import { useCallback, useEffect, useState } from 'react';

export interface LoadState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (d: T) => void;
}

/** fetcher 는 useCallback 으로 고정해서 넘긴다. */
export function useLoad<T>(fetcher: () => Promise<T>): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetcher()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [fetcher, tick]);

  const reload = useCallback(() => {
    setLoading(true);
    setTick((t) => t + 1);
  }, []);

  return { data, error, loading, reload, setData };
}
