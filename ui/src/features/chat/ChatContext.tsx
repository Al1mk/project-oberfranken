import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { AssistantClient } from "./assistantClient";

type ChatContextValue = {
  client: AssistantClient;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** The user has read the before-send notice. In memory only (reload resets it); information read, not a consent record. */
  noticeAcknowledged: boolean;
  acknowledgeNotice: () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

/**
 * Supplies the assistant client and the open/closed state of the chat panel.
 * The client is always injected: the app chooses it at bootstrap (AppProviders),
 * tests pass their own. This module never picks a default.
 */
export function ChatProvider({ children, client }: { children: ReactNode; client: AssistantClient }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((value) => !value), []);
  // Kept here, apart from the map choice in PrivacyContext: accepting maps never acknowledges this notice, and the reverse.
  // No cookie, localStorage or sessionStorage.
  const [noticeAcknowledged, setNoticeAcknowledged] = useState(false);
  const acknowledgeNotice = useCallback(() => setNoticeAcknowledged(true), []);

  const value = useMemo(
    () => ({ client, isOpen, open, close, toggle, noticeAcknowledged, acknowledgeNotice }),
    [client, isOpen, open, close, toggle, noticeAcknowledged, acknowledgeNotice],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChat must be used inside <ChatProvider>");
  return context;
}
