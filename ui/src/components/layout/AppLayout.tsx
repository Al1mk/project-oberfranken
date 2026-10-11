import { useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigationType } from "react-router";
import { getCityPage } from "@/data/cityPages";
import { ChatWidget } from "@/features/chat/ChatWidget";
import { PrivacyPanel } from "@/features/privacy/PrivacyPanel";
import { useI18n } from "@/i18n/LanguageContext";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

export function AppLayout() {
  const { t } = useI18n();
  const { pathname, hash, key } = useLocation();
  const navigationType = useNavigationType();
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);
  const city = getCityPage(pathname.replace(/^\//, ""));

  // Route changes: scroll to the hash target, or reset scroll and move focus to the new page.
  useEffect(() => {
    const changedPage = previousPath.current !== pathname;
    previousPath.current = pathname;
    if (hash) {
      const id = decodeURIComponent(hash.slice(1));
      // Instant on purpose: a smooth scroll is cancelled when the freshly mounted page shifts layout (images, carousel).
      document.getElementById(id)?.scrollIntoView?.({ behavior: "instant" });
      // Anchor navigation lands on the section heading so keyboard and screen-reader users start there.
      const heading = document.getElementById(`${id}-title`);
      heading?.focus({ preventScroll: true });
      if (navigationType !== "POP" || !heading) return;

      // History traversal: the browser runs its own "scroll to fragment" step after popstate and, because the
      // section is not focusable, drops focus to the page body. Re-assert the heading once that step is done
      // (on hashchange, or on the next frame when the hash did not change). Bounded: one shot, only if focus
      // fell back to the body, so it never takes focus from where the user has moved it.
      const reassert = () => {
        if (document.activeElement === document.body || document.activeElement === null) heading.focus({ preventScroll: true });
      };
      let frame = requestAnimationFrame(() => {
        reassert();
        frame = requestAnimationFrame(reassert);
      });
      window.addEventListener("hashchange", reassert, { once: true });
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("hashchange", reassert);
      };
    }
    if (changedPage) {
      window.scrollTo?.(0, 0);
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [pathname, hash, key, navigationType]);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="absolute top-3 left-4 z-50 -translate-y-[160%] rounded-md bg-foreground px-4 py-2 font-semibold text-background transition-transform focus-visible:translate-y-0"
      >
        {t.meta.skipToContent}
      </a>
      <PrivacyPanel />
      <SiteHeader />
      <main id="main" ref={mainRef} tabIndex={-1} className="flex-1 focus:outline-none">
        <Outlet />
      </main>
      <SiteFooter />
      <ChatWidget city={city} />
    </div>
  );
}
