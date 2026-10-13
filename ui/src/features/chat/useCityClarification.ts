import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { CitySlug } from "../../data/types";
import type { AssistantRequest } from "./assistantClient";

/** The one request whose latest reply was a clarification. Component memory only: never stored, never sent as history. */
export type PendingClarification = { generation: number; request: AssistantRequest; messageId: number };

const BARE_CITY = /^(bamberg|bayreuth)[?.!]*$/i;

/** A typed answer that is exactly a pilot city name (any case, optional trailing ?.!), else null. */
export function bareCity(text: string): CitySlug | null {
  const match = BARE_CITY.exec(text.trim());
  return match ? (match[1]!.toLowerCase() as CitySlug) : null;
}

/**
 * Request generations plus the pending city clarification. Every request carries the generation it started in;
 * `reset` (Cancel, a new unrelated question, page or language change, unmount) bumps it, so any older completion
 * is ignored entirely. `onReset` lets the widget drop its own request state tied to the discarded generation.
 */
export function useCityClarification(contextKey: string, onReset: () => void) {
  const generation = useRef(0);
  const [pending, setPending] = useState<PendingClarification | null>(null);

  function reset() {
    generation.current += 1;
    setPending(null);
    onReset();
  }

  // Page context or language changed: the pending question no longer belongs to what the user sees.
  const contextChanged = useEffectEvent(reset);
  const seenContext = useRef(contextKey);
  useLayoutEffect(() => {
    if (seenContext.current === contextKey) return;
    seenContext.current = contextKey;
    contextChanged();
  }, [contextKey]);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  return {
    pending,
    /** The generation a request starting now belongs to. */
    token: () => generation.current,
    isCurrent: (token: number) => token === generation.current,
    offer: (request: AssistantRequest, messageId: number, token: number) => setPending({ generation: token, request, messageId }),
    /** Takes the snapshot for a choice; null if none is current. */
    consume: (): PendingClarification | null => {
      if (!pending || pending.generation !== generation.current) return null;
      setPending(null);
      return pending;
    },
    reset,
  };
}
