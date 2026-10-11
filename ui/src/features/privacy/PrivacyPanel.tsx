import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/LanguageContext";
import { usePrivacy } from "./PrivacyContext";

function isUsable(element: HTMLElement | null): element is HTMLElement {
  return !!element && element.isConnected && !(element as HTMLButtonElement).disabled && !element.closest("[inert], [hidden]");
}

/**
 * Non-blocking privacy settings (a region, not a modal): the page stays usable while it is shown.
 * External maps are the ONLY optional category. Accepting does not cover the chat assistant.
 */
export function PrivacyPanel() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const privacy = usePrivacy();
  const titleId = useId();
  const checkId = useId();
  const [ticked, setTicked] = useState<boolean | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const checkRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(false);
  const { panelOpen, panelView, openCount, takeInvoker } = privacy;

  // Entering the settings view (from the choice view, the footer or the map placeholder) lands on the checkbox.
  useEffect(() => {
    if (panelOpen && panelView === "settings") checkRef.current?.focus();
  }, [panelOpen, panelView, openCount]);

  // After the panel closes, hand focus back only if it was inside the panel when the user acted:
  // the opening element if it is still usable (the map placeholder button vanishes once maps are on), else the
  // footer settings button, else main. Focus that was elsewhere is never touched.
  useEffect(() => {
    if (panelOpen || !restoreFocus.current) return;
    restoreFocus.current = false;
    const target = [takeInvoker(), document.querySelector<HTMLElement>("[data-privacy-footer-trigger]"), document.getElementById("main")].find(isUsable);
    target?.focus({ preventScroll: true });
  }, [panelOpen, takeInvoker]);

  if (!panelOpen) return null;
  // On the legal pages a fixed overlay would cover the text being read, so there the panel sits in the normal
  // document flow (same DOM position, same behaviour). Everywhere else it floats.
  const inline = pathname === "/impressum" || pathname === "/datenschutz";
  const dismiss = (action: () => void) => () => {
    restoreFocus.current = !!panelRef.current?.contains(document.activeElement);
    setTicked(null);
    action();
  };
  const p = t.privacy;
  const checked = ticked ?? privacy.mapsAccepted;

  return (
    <section
      ref={panelRef}
      aria-labelledby={titleId}
      data-placement={inline ? "inline" : "floating"}
      className={
        inline
          ? "container-page my-4 max-w-4xl rounded-lg border border-border bg-background p-5"
          : "fixed bottom-6 left-6 z-40 w-[26rem] max-w-[calc(100vw-3rem)] rounded-lg border border-border bg-background p-5 shadow-float"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={titleId} className="text-[1.25rem] leading-tight">
          {p.title}
        </h2>
        <Button variant="ghost" size="icon-sm" aria-label={p.close} onClick={dismiss(privacy.close)}>
          <X aria-hidden="true" />
        </Button>
      </div>

      {privacy.panelView === "choice" ? (
        <>
          <p className="mt-3 text-sm text-foreground-soft">{p.intro}</p>
          <p className="mt-2 text-sm text-muted-foreground">{p.closeNote}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={dismiss(privacy.accept)}>{p.accept}</Button>
            <Button variant="outline" onClick={dismiss(privacy.reject)}>
              {p.reject}
            </Button>
            <Button variant="ghost" onClick={() => { setTicked(null); privacy.showSettings(); }}>
              {p.settings}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="mt-3 flex items-start gap-3">
            <input ref={checkRef} id={checkId} type="checkbox" checked={checked} onChange={(event) => setTicked(event.target.checked)} className="mt-1 size-5 shrink-0 accent-primary" />
            <label htmlFor={checkId} className="text-sm">
              <span className="font-semibold text-foreground">{p.mapsLabel}</span>
              <span className="mt-1 block text-foreground-soft">{p.mapsDetail}</span>
            </label>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{p.memoryNote}</p>
          <p className="mt-2 text-sm text-muted-foreground">{p.chatSeparate}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={dismiss(() => privacy.saveMaps(checked))}>{p.save}</Button>
            <Button variant="ghost" onClick={dismiss(privacy.close)}>
              {p.closeButton}
            </Button>
          </div>
        </>
      )}
      <p className="mt-4 text-sm">
        <Link to="/datenschutz" className="font-medium text-primary underline decoration-1 underline-offset-4 hover:text-primary-hover">
          {t.legal.privacyLink}
        </Link>
      </p>
    </section>
  );
}
