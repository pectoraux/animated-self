/**
 * Shared client-side character store.
 *
 * Phase 2 — the Create Character panel creates characters that must appear in
 * the Studio picker (locked until consented, selectable after). Rather than
 * lift state through a React context with prop drilling across the page, both
 * the Studio panel and the Create Character panel read/write this small
 * Zustand store. Server-side hydration isn't a concern: this is a pure client
 * island (the Studio panel is already 'use client').
 *
 * The stock characters (Aoi / Ren / Yuki) are seeded from demo-characters so
 * the picker is never empty, exactly like the Phase 1 behavior.
 */
import { create } from "zustand";
import {
  demoCharacters,
  type DemoCharacter,
} from "@/lib/demo-characters";
import type { Character, CharacterSource } from "@/contracts/types";

/**
 * A character as the UI knows it — a Character plus the synthetic gradient /
 * initial used for the demo-mode faux thumbnail (matching DemoCharacter).
 */
export interface UiCharacter extends Character {
  gradient: string;
  initial: string;
  blurb: string;
  /** True if this character was created in demo mode (engine not connected). */
  simulated?: boolean;
}

function fromDemo(d: DemoCharacter): UiCharacter {
  return {
    id: d.id,
    name: d.name,
    source: d.source,
    thumbnail_url: d.thumbnail_url,
    consented: d.consented,
    tags: d.tags,
    gradient: d.gradient,
    initial: d.initial,
    blurb: d.blurb,
  };
}

/**
 * Pick a deterministic gradient + initial for a freshly-created character
 * (generated/uploaded) so the picker thumbnail looks coherent with the stock
 * trio even when there's no real image to show.
 */
const GRADIENT_PALETTE = [
  "linear-gradient(135deg, #fda4af 0%, #f43f5e 40%, #9f1239 100%)",
  "linear-gradient(135deg, #fcd34d 0%, #f59e0b 50%, #92400e 100%)",
  "linear-gradient(135deg, #d8b4fe 0%, #a855f7 50%, #6b21a8 100%)",
  "linear-gradient(135deg, #99f6e4 0%, #14b8a6 50%, #115e59 100%)",
  "linear-gradient(135deg, #fbcfe8 0%, #ec4899 50%, #9d174d 100%)",
  "linear-gradient(135deg, #fed7aa 0%, #fb923c 50%, #9a3412 100%)",
];

function synthThumbnail(name: string, salt: number): {
  gradient: string;
  initial: string;
} {
  const gradient = GRADIENT_PALETTE[salt % GRADIENT_PALETTE.length]!;
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return { gradient, initial };
}

interface CharacterStoreState {
  /** Stable list shown in both the Studio picker and Create panel: stock first,
   *  then generated/uploaded in creation order. */
  characters: UiCharacter[];
  /** Id of the currently-selected character in the Studio picker. */
  selectedId: string;
  /** Engine connectivity, shared so Create panel + Studio agree on demo mode. */
  engineConnected: boolean;

  setSelected: (id: string) => void;
  setEngineConnected: (connected: boolean) => void;

  /** Append a created character (generated or uploaded). Returns the new id. */
  addCreated: (input: {
    name: string;
    source: Extract<CharacterSource, "generated" | "uploaded">;
    simulated?: boolean;
    tags?: string[];
  }) => string;

  /** Flip a character's consented flag (after a successful liveness bind). */
  setConsented: (id: string) => void;

  /** Replace the stock list with the engine's real list (when connected). */
  setStockFromEngine: (list: Character[]) => void;
}

let salt = 0;

export const useCharacterStore = create<CharacterStoreState>((set, get) => ({
  characters: demoCharacters.map(fromDemo),
  selectedId: demoCharacters[0]!.id,
  engineConnected: false,

  setSelected: (id) => set({ selectedId: id }),
  setEngineConnected: (connected) => set({ engineConnected: connected }),

  addCreated: ({ name, source, simulated, tags }) => {
    const id =
      source === "generated"
        ? `gen-${simulated ? "demo" : "real"}-${Math.random()
            .toString(36)
            .slice(2, 8)}`
        : `upload-${simulated ? "demo" : "real"}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;
    const { gradient, initial } = synthThumbnail(name, salt++);
    const chars = get().characters;
    const newChar: UiCharacter = {
      id,
      name: name.trim() || (source === "generated" ? "New character" : "Upload"),
      source,
      thumbnail_url: `/api/characters/${id}/thumbnail`,
      consented: false,
      tags: tags ?? [],
      gradient,
      initial,
      blurb:
        source === "generated"
          ? "Created from prompt. Locked until liveness."
          : "Uploaded PNG. Locked until liveness.",
      simulated,
    };
    set({ characters: [...chars, newChar] });
    return id;
  },

  setConsented: (id) =>
    set((s) => ({
      characters: s.characters.map((c) =>
        c.id === id ? { ...c, consented: true, blurb: "Bound to your face." } : c,
      ),
    })),

  setStockFromEngine: (list) =>
    set((s) => {
      // Replace stock chars with the engine's list, keep generated/uploaded.
      const created = s.characters.filter((c) => c.source !== "stock");
      const rebuilt: UiCharacter[] = [
        ...list
          .filter((c) => c.source === "stock")
          .map((c, i) => {
            const fb = demoCharacters[i % demoCharacters.length]!;
            return {
              id: c.id,
              name: c.name,
              source: "stock" as const,
              thumbnail_url: c.thumbnail_url,
              consented: c.consented,
              tags: c.tags,
              gradient: fb.gradient,
              initial: fb.initial,
              blurb: fb.blurb,
            } satisfies UiCharacter;
          }),
        ...created,
      ];
      const stillExists = rebuilt.some((c) => c.id === s.selectedId);
      return {
        characters: rebuilt,
        selectedId: stillExists ? s.selectedId : (rebuilt[0]?.id ?? s.selectedId),
      };
    }),
}));
