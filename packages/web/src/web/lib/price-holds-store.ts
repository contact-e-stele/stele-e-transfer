// K-008: "Preis halten" im Browser — EIN gemeinsamer Abruf für alle Badges (Listings/Produkte), nicht je Produkt.
// Schalten schreibt nur das Feld (POST /api/price-holds), sendet nichts an eBay.
import { useSyncExternalStore } from "react";
import type { PriceHolds, PriceHoldNotice } from "../../shared/price-hold";

interface HoldsState { holds: PriceHolds; notices: PriceHoldNotice[]; loaded: boolean }
let state: HoldsState = { holds: {}, notices: [], loaded: false };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export function loadPriceHolds(force = false): Promise<void> {
  if (inflight && !force) return inflight;
  inflight = fetch("/api/price-holds")
    .then(r => (r.ok ? r.json() : null))
    .then((d: { holds?: PriceHolds; notices?: PriceHoldNotice[] } | null) => {
      state = { holds: d?.holds ?? {}, notices: d?.notices ?? [], loaded: true };
      emit();
    })
    .catch(() => { state = { ...state, loaded: true }; emit(); });
  return inflight;
}

export function usePriceHolds(): HoldsState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); if (!state.loaded) void loadPriceHolds(); return () => listeners.delete(l); },
    () => state,
  );
}

export async function togglePriceHold(productId: number, skuId: string | null, hold: boolean): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/price-holds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, skuId, hold }) });
    const d = await res.json() as { ok?: boolean; error?: string };
    if (!res.ok || !d.ok) return { ok: false, error: d.error ?? "Halten konnte nicht gespeichert werden" };
    await loadPriceHolds(true);
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e) }; }
}
