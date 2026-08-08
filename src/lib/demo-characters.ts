/**
 * Stock character fallback for the Studio panel demo mode.
 *
 * Mirrors engine/characters/manifest.json. When the Python engine is NOT
 * reachable (typical in this sandbox — no GPU, no virtual cam), the Studio
 * panel renders these three so the UX is still demonstrable.
 *
 * The real list comes from GET /api/characters?XTransformPort=3031 when the
 * engine is connected. Source of truth = engine/characters/manifest.json.
 */

export interface DemoCharacter {
  id: string;
  name: string;
  source: "stock" | "generated" | "uploaded";
  thumbnail_url: string;
  consented: boolean;
  tags: string[];
  /** CSS gradient used for the faux thumbnail in demo mode. */
  gradient: string;
  /** Initials shown on the faux thumbnail. */
  initial: string;
  /** Short tagline shown under the name in the picker. */
  blurb: string;
}

export const demoCharacters: DemoCharacter[] = [
  {
    id: "stock-aoi",
    name: "Aoi",
    source: "stock",
    thumbnail_url: "/api/characters/stock-aoi/thumbnail",
    consented: true,
    tags: ["female", "blue-hair", "default"],
    gradient:
      "linear-gradient(135deg, #f9a8d4 0%, #ec4899 35%, #be185d 100%)",
    initial: "A",
    blurb: "Calm, soft-spoken default.",
  },
  {
    id: "stock-ren",
    name: "Ren",
    source: "stock",
    thumbnail_url: "/api/characters/stock-ren/thumbnail",
    consented: true,
    tags: ["male", "dark-hair"],
    gradient:
      "linear-gradient(135deg, #d6d3d1 0%, #78716c 45%, #292524 100%)",
    initial: "R",
    blurb: "Neutral, low-saturation look.",
  },
  {
    id: "stock-yuki",
    name: "Yuki",
    source: "stock",
    thumbnail_url: "/api/characters/stock-yuki/thumbnail",
    consented: true,
    tags: ["female", "white-hair"],
    gradient:
      "linear-gradient(135deg, #fde68a 0%, #f59e0b 45%, #b45309 100%)",
    initial: "Y",
    blurb: "Bright, high-contrast palette.",
  },
];

export const demoCharacterById = (id: string): DemoCharacter | undefined =>
  demoCharacters.find((c) => c.id === id);
