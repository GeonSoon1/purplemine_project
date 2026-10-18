'use client';

import { useEffect, useState } from 'react';
import { quotes, scripts } from './api';
import type { Script } from './types';

/** 대본 하위 화면 공통: 화면 제목용 대본 정보와 최신 견적서 id */
export function useScriptContext(scriptId: string) {
  const [script, setScript] = useState<Script | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    scripts.get(scriptId).then((s) => alive && setScript(s)).catch(() => {});
    quotes
      .list({ scriptId, pageSize: 20 })
      .then((p) => alive && setQuoteId((p.items.find((q) => q.isLatest) ?? p.items[0])?.id ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [scriptId]);

  return { script, quoteId };
}
