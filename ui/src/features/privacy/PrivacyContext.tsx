import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type MapChoice = "unset" | "accepted" | "rejected";

type PrivacyValue = {
  /** External maps are the only optional category. They are allowed only after an explicit acceptance. */
  mapsAllowed: boolean;
  panelOpen: boolean;
  panelView: "choice" | "settings";
  /** Whether the saved choice is currently "accepted" (for the settings checkbox). */
  mapsAccepted: boolean;
  accept: () => void;
  reject: () => void;
  saveMaps: (allowed: boolean) => void;
  showSettings: () => void;
  /** Reopens the panel in its settings view. Pass the clicked element so focus can return to it afterwards. */
  openSettings: (invoker?: HTMLElement | null) => void;
  close: () => void;
  /** Bumps on every openSettings call so the panel can move focus even when it is already in the settings view. */
  openCount: number;
  /** Returns (and forgets) the element that opened the settings, if any. */
  takeInvoker: () => HTMLElement | null;
};

const PrivacyContext = createContext<PrivacyValue | null>(null);

/**
 * The privacy choice lives in memory only: it survives in-app navigation and is forgotten on reload.
 * Deliberately no cookie, no localStorage, no sessionStorage: a consent record would itself be new device storage.
 */
export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [maps, setMaps] = useState<MapChoice>("unset");
  const [dismissed, setDismissed] = useState(false);
  const [reopened, setReopened] = useState(false);
  const [panelView, setPanelView] = useState<"choice" | "settings">("choice");
  const [openCount, setOpenCount] = useState(0);
  const invokerRef = useRef<HTMLElement | null>(null);

  const settle = useCallback((next: MapChoice) => {
    setMaps(next);
    setReopened(false);
    setPanelView("choice");
  }, []);

  const value = useMemo<PrivacyValue>(
    () => ({
      mapsAllowed: maps === "accepted",
      mapsAccepted: maps === "accepted",
      panelOpen: reopened || (maps === "unset" && !dismissed),
      panelView,
      accept: () => settle("accepted"),
      reject: () => settle("rejected"),
      saveMaps: (allowed) => settle(allowed ? "accepted" : "rejected"),
      showSettings: () => setPanelView("settings"),
      openSettings: (invoker) => {
        invokerRef.current = invoker ?? null;
        setPanelView("settings");
        setReopened(true);
        setOpenCount((count) => count + 1);
      },
      openCount,
      takeInvoker: () => {
        const invoker = invokerRef.current;
        invokerRef.current = null;
        return invoker;
      },
      // Closing without a choice keeps maps blocked ("unset" never allows anything).
      close: () => {
        setReopened(false);
        setPanelView("choice");
        if (maps === "unset") setDismissed(true);
      },
    }),
    [maps, dismissed, reopened, panelView, openCount, settle],
  );
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyValue {
  const context = useContext(PrivacyContext);
  if (!context) throw new Error("usePrivacy must be used inside <PrivacyProvider>");
  return context;
}
