import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { MapPin, MessageCircle, SendHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CITY_PAGES } from "@/data/cityPages";
import type { CityPageData, CitySlug } from "@/data/types";
import { useI18n } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import type { AssistantReply, AssistantRequest } from "./assistantClient";
import { AssistantError, type AssistantErrorCode } from "./assistantContract";
import { useChat } from "./ChatContext";
import { ChatSources } from "./ChatSources";
import { CityClarification } from "./CityClarification";
import { bareCity, useCityClarification } from "./useCityClarification";

type ChatMessage = { id: number; role: "user"; text: string } | ({ id: number; role: "assistant" } & AssistantReply);

/**
 * A failed request, kept whole so "Try again" resends exactly what failed (same city and language) without a second user bubble.
 * `scope` marks a selected-city request: its retry belongs to that clarification generation and ends with it.
 */
type ChatFailure = { request: AssistantRequest; code: AssistantErrorCode | "unknown"; status?: number; scope?: number };

type ChatWidgetProps = {
  /** The city page the user is on, if any. Shown as context and sent with each request. */
  city: CityPageData | undefined;
};

const bubble = "rounded-lg px-4 py-3 text-[0.9375rem] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]";

export function ChatWidget({ city }: ChatWidgetProps) {
  const { t, language, localize } = useI18n();
  const { client, isOpen, close, toggle, noticeAcknowledged, acknowledgeNotice } = useChat();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  // After the first acknowledgement the notice is collapsed; the header button reopens it on demand.
  const [noticeReopened, setNoticeReopened] = useState(false);

  const panelId = useId();
  const noticeId = useId();
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const nextId = useRef(1);
  const pending = useRef<AbortController | null>(null);

  const place = city?.name ?? t.chat.greetingRegion;
  // Home is balanced: one question per pilot city and two for the whole pilot region. City pages keep their own city.
  const suggestions = city
    ? [localize(city.assistantExample), t.chat.suggestSights(city.name), t.chat.suggestRestaurants(city.name), t.chat.suggestSport(city.name)]
    : [localize(CITY_PAGES.bamberg.assistantExample), localize(CITY_PAGES.bayreuth.assistantExample), t.chat.suggestRegionalFood, t.chat.suggestSport(t.chat.bothCities)];

  const clarification = useCityClarification(`${city?.slug ?? ""}|${language}`, discardRequestState);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, status]);

  useEffect(() => () => pending.current?.abort(), []);

  const noticeVisible = !noticeAcknowledged || noticeReopened;

  /** Information read, not a consent: nothing is stored and sending never depends on it. Focus goes to the composer. */
  function acknowledge() {
    acknowledgeNotice();
    setNoticeReopened(false);
    inputRef.current?.focus();
  }

  function closePanel() {
    close();
    launcherRef.current?.focus();
  }

  /**
   * Called on every clarification reset. The in-flight browser request is aborted (an already started server call
   * still runs and is never repeated); its generation is stale, so it can no longer touch this state. A
   * selected-city retry ends with its clarification; ordinary failures keep their retry across context changes.
   */
  function discardRequestState() {
    pending.current?.abort();
    pending.current = null;
    if (status === "loading" || failure?.scope !== undefined) {
      setStatus("idle");
      setFailure(null);
    }
  }

  /** Asks the assistant. Does not touch the user's message, so a retry never duplicates it. */
  async function ask(request: AssistantRequest, scope?: number) {
    const token = clarification.token();
    setStatus("loading");
    setFailure(null);
    const controller = new AbortController();
    pending.current = controller;
    try {
      const reply = await client.send(request, { signal: controller.signal });
      if (!clarification.isCurrent(token)) return;
      const id = nextId.current++;
      setMessages((current) => [...current, { id, role: "assistant", ...reply }]);
      // A request that already carries a selected city is never asked to choose again.
      if (reply.kind === "clarification" && request.selectedCity == null) clarification.offer(request, id, token);
      setStatus("idle");
    } catch (error) {
      if (!clarification.isCurrent(token) || (error as Error).name === "AbortError") return;
      const kept = scope === undefined ? {} : { scope };
      setFailure(
        error instanceof AssistantError
          ? { request, code: error.code, ...(error.status !== undefined && { status: error.status }), ...kept }
          : { request, code: "unknown", ...kept },
      );
      setStatus("error");
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (message === "" || status === "loading" || pending.current) return;
    // A bare pilot city answers the pending clarification; anything else is a new question and discards it.
    const typedCity = clarification.pending && bareCity(message);
    if (typedCity) {
      setDraft("");
      choose(typedCity);
      return;
    }
    if (clarification.pending) clarification.reset();
    setMessages((current) => [...current, { id: nextId.current++, role: "user", text: message }]);
    setDraft("");
    // Suggestion buttons unmount after the first message; keep focus in the composer.
    inputRef.current?.focus();
    await ask({ message, city: city?.slug ?? null, language });
  }

  /** Resends the original question, page city and language with the chosen city. Shows the choice once; no navigation, no sticky city. */
  function choose(selectedCity: CitySlug) {
    if (pending.current) return;
    const snapshot = clarification.consume();
    if (!snapshot) return;
    const { message, city: pageCity, language: snapshotLanguage } = snapshot.request;
    setMessages((current) => [...current, { id: nextId.current++, role: "user", text: CITY_PAGES[selectedCity].name }]);
    inputRef.current?.focus();
    void ask({ message, city: pageCity, language: snapshotLanguage, selectedCity }, snapshot.generation);
  }

  function cancelClarification() {
    clarification.reset();
    inputRef.current?.focus();
  }

  function retry() {
    if (failure && status === "error" && !pending.current) {
      if (failure.scope !== undefined && !clarification.isCurrent(failure.scope)) return;
      inputRef.current?.focus();
      void ask(failure.request, failure.scope);
    }
  }

  function errorText(current: ChatFailure): string {
    const e = t.chat.errors;
    switch (current.code) {
      case "timeout":
        return e.timeout;
      case "http":
        return e.http(current.status ?? 0);
      case "invalid-json":
        return e.invalidJson;
      case "contract":
        return e.contract;
      default:
        return e.network;
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  function handlePanelKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      closePanel();
    }
  }

  return (
    <div className="pointer-events-none fixed right-8 bottom-8 z-50 flex flex-col items-end gap-4 *:pointer-events-auto">
      <section
        id={panelId}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        hidden={!isOpen}
        onKeyDown={handlePanelKeyDown}
        className="flex h-[min(38rem,calc(100vh-9rem))] w-[25rem] origin-bottom-right flex-col overflow-hidden rounded-lg border border-border bg-background shadow-float transition-[opacity,translate] duration-200 ease-(--ease-out-soft) starting:translate-y-3 starting:opacity-0"
      >
        <header className="border-b border-border px-5 pt-4 pb-3">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="min-w-0 text-[1.375rem] leading-tight">
              {t.chat.title}
            </h2>
            <Button variant="ghost" size="icon-sm" aria-label={t.chat.close} onClick={closePanel}>
              <X aria-hidden="true" />
            </Button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="inline-block rounded-sm bg-foreground px-2 py-0.5 text-[0.75rem] font-semibold text-background">{t.chat.aiLabel}</span>
            <p className="inline-flex items-center gap-1.5 rounded-sm bg-surface-cool px-2 py-0.5 text-[0.8125rem] text-foreground-soft">
              <MapPin className="size-3.5 text-primary" aria-hidden="true" />
              <span>
                {t.chat.contextLabel}: <strong className="font-semibold text-foreground">{city?.name ?? t.chat.contextRegion}</strong>
              </span>
            </p>
            {noticeAcknowledged && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 px-2 text-[0.8125rem]"
                aria-label={t.chat.noticeToggleLabel}
                aria-expanded={noticeReopened}
                aria-controls={noticeId}
                onClick={() => setNoticeReopened((value) => !value)}
              >
                {t.chat.noticeToggle}
              </Button>
            )}
          </div>
        </header>

        <p className="border-b border-border px-5 py-2 text-xs text-muted-foreground">{client.mode === "mock" ? t.chat.prototypeNotice : t.chat.liveNotice}</p>

        <ol ref={logRef} role="log" aria-live="polite" aria-label={t.chat.title} className="flex min-h-20 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-5 py-4">
          <li className="max-w-[88%] self-start">
            <span className="sr-only">{t.chat.assistant}: </span>
            <p className={cn(bubble, "bg-surface-cool")}>{t.chat.greeting(place)}</p>
          </li>
          {messages.map((message) => (
            <li
              key={message.id}
              data-role={message.role}
              data-kind={message.role === "assistant" ? message.kind : undefined}
              className={cn("flex max-w-[88%] flex-col", message.role === "user" ? "items-end self-end" : "self-start")}
            >
              <span className="sr-only">{message.role === "user" ? t.chat.you : t.chat.assistant}: </span>
              <p
                className={cn(
                  bubble,
                  message.role === "user" && "bg-foreground text-background",
                  message.role === "assistant" && message.kind !== "out-of-scope" && "bg-surface-cool",
                  message.role === "assistant" && message.kind === "out-of-scope" && "border-l-2 border-primary bg-primary-wash",
                )}
              >
                {message.text}
              </p>
              {message.role === "assistant" && message.isSample && <span className="mt-1 pl-1 text-xs text-muted-foreground">{t.chat.sampleResponse}</span>}
              {message.role === "assistant" && <ChatSources sources={message.sources} />}
              {message.id === clarification.pending?.messageId && message.id === messages.at(-1)?.id && (
                <CityClarification onChoose={choose} onCancel={cancelClarification} disabled={status === "loading"} />
              )}
            </li>
          ))}
          {status === "loading" && (
            <li className="self-start">
              <p className={cn(bubble, "inline-flex h-11 items-center gap-1.5 bg-surface-cool")}>
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    aria-hidden="true"
                    className="size-1.5 animate-pulse rounded-full bg-muted-foreground"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
                <span className="sr-only">{t.chat.typing}</span>
              </p>
            </li>
          )}
          {status === "error" && failure && (
            <li className="flex max-w-[88%] flex-col items-start gap-2 self-start">
              <p className={cn(bubble, "border-l-2 border-primary bg-primary-wash")} role="alert">
                {errorText(failure)}
              </p>
              <Button variant="outline" size="sm" onClick={retry}>
                {t.chat.retry}
              </Button>
            </li>
          )}
        </ol>

        {messages.length === 0 && (
          <div className="flex max-h-32 shrink-0 flex-col items-start gap-2 overflow-y-auto px-5 pb-4" role="group" aria-label={t.chat.suggestionsLabel}>
            <p className="text-xs text-muted-foreground" aria-hidden="true">
              {t.chat.suggestionsLabel}
            </p>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void send(suggestion)}
                className="rounded-md border border-border px-3 py-2 text-left text-sm text-foreground-soft transition-colors hover:border-primary hover:text-primary"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {/* Describes the real flow of the active client; the map choice has no effect on it. Capped in height so a long text scrolls inside itself instead of squeezing the messages. */}
        {noticeVisible && (
          <div id={noticeId} data-testid="chat-privacy-notice" className="flex max-h-32 shrink-0 flex-col border-t border-border text-xs text-muted-foreground">
            <p data-notice-text tabIndex={0} className="min-h-0 flex-1 overflow-y-auto px-5 pt-2">
              {client.mode === "http" ? t.chat.privacyNoticeHttp : t.chat.privacyNoticeMock}
            </p>
            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2">
              <Button size="sm" onClick={acknowledge}>
                {t.chat.noticeAck}
              </Button>
              <Link to="/datenschutz" className="font-medium text-primary underline decoration-1 underline-offset-2">
                {t.legal.privacyLink}
              </Link>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border px-4 py-3">
          <label className="sr-only" htmlFor={`${panelId}-input`}>
            {t.chat.inputLabel}
          </label>
          <Input
            ref={inputRef}
            id={`${panelId}-input`}
            value={draft}
            placeholder={t.chat.inputPlaceholder}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="icon" aria-label={t.chat.send} disabled={draft.trim() === "" || status === "loading"}>
            <SendHorizontal aria-hidden="true" />
          </Button>
        </form>
      </section>

      <button
        ref={launcherRef}
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={isOpen ? t.chat.launcherClose : t.chat.launcherOpen}
        onClick={toggle}
        className="grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-float transition-colors hover:bg-primary-hover active:scale-95"
      >
        <span className="grid *:col-start-1 *:row-start-1 *:transition-[opacity,rotate] *:duration-200">
          <MessageCircle className={cn("size-6", isOpen && "rotate-45 opacity-0")} aria-hidden="true" />
          <X className={cn("size-6", !isOpen && "-rotate-45 opacity-0")} aria-hidden="true" />
        </span>
      </button>
    </div>
  );
}
