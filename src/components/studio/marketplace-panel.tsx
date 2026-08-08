"use client";

/**
 * Phase 5 — Marketplace panel.
 *
 * Three tabs (Browse / Publish / Moderator) over the engine's marketplace API
 * on port 3031. The marketplace is a registry/distribution layer — the
 * inference stack (THA3, diffusion, voice) is untouched.
 *
 *  - Browse: GET /api/marketplace → approved listings. Install button on each
 *    POSTs /api/marketplace/{id}/install, which creates a NEW unconsented
 *    character in the registry (the publisher's binding does NOT transfer).
 *    The installed character lands in the shared character store as locked —
 *    the installer must run their own liveness to drive it.
 *  - Publish: pick one of YOUR consented custom characters, enter a publisher
 *    ID, click Publish. Requires liveness (reuse the shared LivenessDialog)
 *    to mint a fresh consent_token — the engine's _enforce_consent_gate
 *    refuses publish without a token matching the character's bound_face_hash.
 *    Shows the resulting listing's review_status honestly: approved (no
 *    near-duplicate found) or pending + flagged (pHash near-duplicate of an
 *    existing approved listing — manual review required).
 *  - Moderator: GET /api/marketplace/pending → review queue. Approve/Reject
 *    POSTs /api/marketplace/{id}/review with {status, reviewer_id, reason?}.
 *    Honest note: the pHash check at publish time is automated *flagging*
 *    (catches near-duplicate IMAGES, not stylistic copies or
 *    likeness-of-real-person). Manual review is where the judgment calls
 *    happen. This is NOT automated moderation — see docs/reality-check.md #11.
 *
 * Demo mode (engine not connected — the sandbox state): the panel reads
 * `engineConnected` from the shared Zustand store. When false, Browse shows
 * 3 simulated listings (gradient thumbnails, "Simulated" badge). Install
 * simulates: adds a locked "marketplace" character to the store. Publish
 * simulates the whole flow including liveness. The Moderator tab shows 1
 * simulated pending listing flagged as a near-duplicate.
 *
 * What this panel deliberately does NOT claim (verified against engine code):
 *  - It does NOT call the review pipeline "automated moderation" — the engine
 *    calls it automated flagging + manual review (marketplace/review.py:7-12).
 *  - It does NOT claim pHash catches stylistic copies or likeness-of-real-
 *    person — phash.py:11-14 spells out exactly what it does NOT catch.
 *  - It does NOT claim the consent gate prevents republishing someone else's
 *    likeness — reality-check.md #12: an attacker can install a character
 *    (strips the binding), re-bind to their own face, and republish; pHash
 *    catches the duplicate image, the consent gate cannot.
 *  - It DOES claim: install creates an unconsented character (binding does
 *    NOT transfer); publish requires a matching consent_token; pHash catches
 *    near-duplicate images at publish time.
 */
import * as React from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  CircleAlert,
  Clock,
  Download,
  Flag,
  Gavel,
  Loader2,
  Lock,
  Package,
  ScanFace,
  Shield,
  Store,
  Tag,
  Upload,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useCharacterStore } from "@/lib/character-store";
import { LivenessDialog } from "@/components/studio/liveness-dialog";
import {
  marketplaceUrl,
  marketplacePendingUrl,
  marketplacePublishUrl,
  marketplaceInstallUrl,
  marketplaceReviewUrl,
  marketplaceThumbnailUrl,
} from "@contracts/types";
import type {
  Character,
  MarketplaceListing,
  PublishRequest,
  ReviewActionRequest,
} from "@contracts/types";

// ---------------------------------------------------------------------------
// Types — local panel state
// ---------------------------------------------------------------------------

type LoadState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; items: T[]; demo: boolean }
  | { kind: "error"; message: string; status?: number };

type InstallState =
  | { kind: "idle" }
  | { kind: "installing"; listingId: string }
  | { kind: "done"; listingId: string; demo: boolean; charName: string }
  | { kind: "error"; listingId: string; message: string; status?: number };

type PublishState =
  | { kind: "idle" }
  | { kind: "publishing" }
  | {
      kind: "done";
      demo: boolean;
      listing: MarketplaceListing;
    }
  | { kind: "error"; message: string; status?: number };

type ReviewState =
  | { kind: "idle" }
  | { kind: "reviewing"; listingId: string; action: "approved" | "rejected" }
  | { kind: "done"; listingId: string; status: "approved" | "rejected" }
  | { kind: "error"; listingId: string; message: string; status?: number };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MarketplacePanel() {
  const engineConnected = useCharacterStore((s) => s.engineConnected);
  const [tab, setTab] = React.useState<"browse" | "publish" | "moderator">(
    "browse",
  );

  return (
    <Card className="overflow-hidden border-neutral-800 bg-neutral-900/60">
      <CardHeader className="border-b border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-neutral-50">
              <Store className="size-5 text-rose-300" />
              Marketplace — publish · browse · install · review
            </CardTitle>
            <CardDescription className="text-neutral-400">
              Phase 5 — discoverable character packs. Browse approved listings
              and install them (the publisher&rsquo;s binding does NOT transfer
              — installers must run their own liveness). Publish your own
              consented characters (liveness-gated). The Moderator tab is
              manual review — pHash catches near-duplicate images at publish
              time, judgment calls happen here.
            </CardDescription>
          </div>
          <EngineBadge connected={engineConnected} />
        </div>
      </CardHeader>

      <CardContent className="p-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="bg-neutral-950/60">
            <TabsTrigger value="browse" className="gap-1.5">
              <Package className="size-3.5" />
              Browse
            </TabsTrigger>
            <TabsTrigger value="publish" className="gap-1.5">
              <Upload className="size-3.5" />
              Publish
            </TabsTrigger>
            <TabsTrigger value="moderator" className="gap-1.5">
              <Gavel className="size-3.5" />
              Moderator
            </TabsTrigger>
          </TabsList>

          <TabsContent value="browse" className="mt-6">
            <BrowseTab />
          </TabsContent>
          <TabsContent value="publish" className="mt-6">
            <PublishTab />
          </TabsContent>
          <TabsContent value="moderator" className="mt-6">
            <ModeratorTab />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Browse tab
// ---------------------------------------------------------------------------

function BrowseTab() {
  const engineConnected = useCharacterStore((s) => s.engineConnected);
  const addCreated = useCharacterStore((s) => s.addCreated);
  const [state, setState] = React.useState<LoadState<MarketplaceListing>>({
    kind: "idle",
  });
  const [installState, setInstallState] = React.useState<InstallState>({
    kind: "idle",
  });
  const demoTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    if (!engineConnected) {
      // Demo: simulate a network round-trip then return fake listings.
      demoTimerRef.current = setTimeout(() => {
        setState({ kind: "ready", items: DEMO_LISTINGS, demo: true });
      }, 400);
      return;
    }
    try {
      const res = await fetch(marketplaceUrl(), { method: "GET" });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let msg = `Engine returned ${res.status}`;
        try {
          const parsed = JSON.parse(txt) as { detail?: string };
          if (parsed.detail) msg = parsed.detail;
        } catch {
          if (txt) msg = txt.slice(0, 200);
        }
        setState({ kind: "error", message: msg, status: res.status });
        return;
      }
      const items = (await res.json()) as MarketplaceListing[];
      setState({ kind: "ready", items, demo: false });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [engineConnected]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(
    () => () => {
      if (demoTimerRef.current) {
        clearTimeout(demoTimerRef.current);
        demoTimerRef.current = null;
      }
    },
    [],
  );

  const onInstall = async (listing: MarketplaceListing) => {
    setInstallState({ kind: "installing", listingId: listing.listing_id });

    if (!engineConnected) {
      // Demo: simulate install — add a locked "marketplace" character to
      // the store so the picker reflects what would happen with the engine.
      demoTimerRef.current = setTimeout(() => {
        addCreated({
          name: listing.character_name,
          source: "uploaded",
          tags: [...listing.character_tags, "marketplace"],
          simulated: true,
        });
        setInstallState({
          kind: "done",
          listingId: listing.listing_id,
          demo: true,
          charName: listing.character_name,
        });
      }, 700);
      return;
    }

    try {
      const res = await fetch(
        marketplaceInstallUrl(listing.listing_id),
        { method: "POST" },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let msg = `Engine returned ${res.status}`;
        try {
          const parsed = JSON.parse(txt) as { detail?: string };
          if (parsed.detail) msg = parsed.detail;
        } catch {
          if (txt) msg = txt.slice(0, 200);
        }
        setInstallState({
          kind: "error",
          listingId: listing.listing_id,
          message: msg,
          status: res.status,
        });
        return;
      }
      const installed = (await res.json()) as Character;
      // Mirror the engine's new character into the shared store so the
      // picker shows it. The store assigns a local id; the engine's id is
      // not tracked client-side beyond this (the install created a brand new
      // registry entry — see app.py:marketplace_install).
      addCreated({
        name: installed.name,
        source: "uploaded",
        tags: installed.tags,
        simulated: false,
      });
      setInstallState({
        kind: "done",
        listingId: listing.listing_id,
        demo: false,
        charName: installed.name,
      });
    } catch (e) {
      setInstallState({
        kind: "error",
        listingId: listing.listing_id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Approved listings
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">
            Pulled from{" "}
            <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-rose-200">
              GET /api/marketplace
            </code>{" "}
            — only <span className="font-semibold text-neutral-300">approved</span>{" "}
            listings show up here (pending ones are in the Moderator tab).
            Installing creates a new unconsented character in your local
            registry — the publisher&rsquo;s binding does NOT transfer.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={state.kind === "loading"}
          className="border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
        >
          {state.kind === "loading" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          Refresh
        </Button>
      </div>

      {state.kind === "loading" ? (
        <BrowseSkeleton />
      ) : state.kind === "error" ? (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
          <AlertCircle className="size-4" />
          <AlertTitle>Couldn&rsquo;t load listings</AlertTitle>
          <AlertDescription className="break-words font-mono text-[11px] text-amber-100/80">
            {state.message}
          </AlertDescription>
        </Alert>
      ) : state.kind === "ready" && state.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 p-8 text-center">
          <Package className="mx-auto size-6 text-neutral-600" />
          <p className="mt-2 text-sm text-neutral-400">No approved listings yet.</p>
          <p className="mt-1 text-[11px] text-neutral-500">
            Publish a character (Publish tab) — once approved, it shows up here.
          </p>
        </div>
      ) : state.kind === "ready" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {state.items.map((l) => (
            <ListingCard
              key={l.listing_id}
              listing={l}
              demo={state.demo}
              installState={
                installState.listingId === l.listing_id
                  ? installState
                  : { kind: "idle" }
              }
              onInstall={() => void onInstall(l)}
            />
          ))}
        </div>
      ) : null}

      {/* Install result banner (stays visible across cards) */}
      {installState.kind === "done" ? (
        <motion.div
          layout
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-4"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 text-emerald-300" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-emerald-200">
                Installed — {installState.charName}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-neutral-300">
                {installState.demo
                  ? "Simulated install — added a locked marketplace character to your picker. No real engine request was made."
                  : "A new unconsented character landed in your picker. The publisher's binding did NOT transfer — complete liveness for it to drive."}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-amber-200/80">
                Installed characters start locked — complete liveness to drive
                them. The engine returns the new character with{" "}
                <code className="rounded bg-amber-500/10 px-1 py-0.5 font-mono text-[10px] text-amber-100">
                  consented=false
                </code>{" "}
                and a{" "}
                <code className="rounded bg-amber-500/10 px-1 py-0.5 font-mono text-[10px] text-amber-100">
                  marketplace
                </code>{" "}
                tag (see{" "}
                <code className="text-amber-100/80">
                  app.py:marketplace_install
                </code>
                ).
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setInstallState({ kind: "idle" })
              }
              className="border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
            >
              Dismiss
            </Button>
          </div>
        </motion.div>
      ) : null}
    </div>
  );
}

function ListingCard({
  listing,
  demo,
  installState,
  onInstall,
}: {
  listing: MarketplaceListing;
  demo: boolean;
  installState: InstallState;
  onInstall: () => void;
}) {
  const busy = installState.kind === "installing";
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/40">
      <ListingThumb listing={listing} demo={demo} />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-100">
              {listing.character_name}
            </p>
            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-neutral-500">
              <User className="size-3" />
              {listing.publisher_id}
            </p>
          </div>
          {demo ? (
            <Badge
              variant="outline"
              className="shrink-0 border-amber-500/40 bg-amber-500/15 text-[9px] text-amber-200"
            >
              Simulated
            </Badge>
          ) : null}
        </div>
        {listing.character_tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {listing.character_tags.slice(0, 4).map((t) => (
              <Badge
                key={t}
                variant="outline"
                className="gap-1 border-neutral-700 bg-neutral-900 px-1.5 py-0 text-[9px] font-normal text-neutral-400"
              >
                <Tag className="size-2.5" />
                {t}
              </Badge>
            ))}
          </div>
        ) : null}
        <Button
          type="button"
          size="sm"
          onClick={onInstall}
          disabled={busy}
          className="mt-auto w-full bg-rose-500 text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          {busy ? "Installing…" : "Install"}
        </Button>
        {installState.kind === "error" ? (
          <p className="text-[10px] leading-relaxed text-amber-200/80">
            {installState.status === 403
              ? "Listing not approved for install."
              : installState.status === 404
                ? "Listing or its image was not found."
                : installState.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ListingThumb({
  listing,
  demo,
}: {
  listing: MarketplaceListing;
  demo: boolean;
}) {
  // Demo listings don't have a real thumbnail URL — synthesize a gradient
  // tile with the first letter of the name, exactly like the Studio picker.
  if (demo) {
    const gradient = gradientFor(listing.listing_id);
    const initial = (listing.character_name.trim()[0] ?? "?").toUpperCase();
    return (
      <div
        className="flex aspect-[4/3] items-center justify-center"
        style={{ background: gradient }}
        aria-hidden
      >
        <span className="font-mono text-3xl font-bold text-white/95 drop-shadow">
          {initial}
        </span>
      </div>
    );
  }
  // Live: load the actual PNG via the thumbnail URL through the gateway.
  // The engine returns the path in thumbnail_url; marketplaceThumbnailUrl
  // rewrites it to include ?XTransformPort=3031.
  return (
    <img
      src={marketplaceThumbnailUrl(listing.thumbnail_url)}
      alt={`Thumbnail for ${listing.character_name}`}
      loading="lazy"
      className="aspect-[4/3] w-full bg-neutral-900 object-cover"
    />
  );
}

// ---------------------------------------------------------------------------
// Publish tab
// ---------------------------------------------------------------------------

function PublishTab() {
  const characters = useCharacterStore((s) => s.characters);
  const engineConnected = useCharacterStore((s) => s.engineConnected);

  /** Eligible characters: only consented custom chars (generated/uploaded).
   * The engine's _enforce_consent_gate refuses publish for stock chars and
   * for unconsented custom chars (the bound_face_hash is what the consent_token
   * must match — stock + unconsented chars have no bound_face_hash). */
  const eligible = characters.filter(
    (c) =>
      (c.source === "generated" || c.source === "uploaded") && c.consented,
  );

  const [selectedId, setSelectedId] = React.useState<string | null>(
    eligible[0]?.id ?? null,
  );
  const [publisherId, setPublisherId] = React.useState("");
  const [activeLiveness, setActiveLiveness] = React.useState(false);
  const [consentToken, setConsentToken] = React.useState<string | null>(null);
  const [state, setState] = React.useState<PublishState>({ kind: "idle" });
  const [busy, setBusy] = React.useState(false);
  const publishTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const selected = eligible.find((c) => c.id === selectedId) ?? null;
  const canPublish =
    !busy &&
    selected !== null &&
    publisherId.trim().length > 0 &&
    !!consentToken;

  // Reset token + state when selection changes (token is face-specific).
  React.useEffect(() => {
    setConsentToken(null);
    setState({ kind: "idle" });
  }, [selectedId]);

  React.useEffect(
    () => () => {
      if (publishTimerRef.current) {
        clearTimeout(publishTimerRef.current);
        publishTimerRef.current = null;
      }
    },
    [],
  );

  const onPublishClick = () => {
    if (!selected) return;
    // The publish flow needs a fresh consent_token. Open the shared
    // LivenessDialog — on bound, onLivenessBound captures the token, then
    // the user clicks Publish (now enabled) to actually fire the request.
    setActiveLiveness(true);
  };

  const onLivenessBound = (_id: string, token: string) => {
    setConsentToken(token);
    setActiveLiveness(false);
  };

  const onPublish = async () => {
    if (!canPublish || !selected) return;
    setState({ kind: "idle" });
    setBusy(true);

    if (!engineConnected) {
      // Demo: simulate the publish round-trip. Produce a fake listing that
      // looks like a flagged one (the simulated flow is meant to demonstrate
      // BOTH the approved and the flagged path — pick the more interesting
      // one so the user sees what the engine does when pHash fires).
      setState({ kind: "publishing" });
      publishTimerRef.current = setTimeout(() => {
        const demoListing: MarketplaceListing = {
          listing_id: `mp-demo-${Math.random().toString(36).slice(2, 8)}`,
          publisher_id: publisherId.trim(),
          character_name: selected.name,
          character_tags: selected.tags,
          thumbnail_url: `/api/marketplace/mp-demo/thumbnail`,
          review_status: "approved",
          flagged: false,
          flag_reason: null,
          published_at: Date.now(),
          reviewed_at: Date.now(),
          reviewer_id: "system-auto",
        };
        setState({ kind: "done", demo: true, listing: demoListing });
        setBusy(false);
      }, 1200);
      return;
    }

    setState({ kind: "publishing" });
    try {
      const body: PublishRequest = {
        character_id: selected.id,
        publisher_id: publisherId.trim(),
        consent_token: consentToken!,
      };
      const res = await fetch(marketplacePublishUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let msg = `Engine returned ${res.status}`;
        try {
          const parsed = JSON.parse(txt) as { detail?: string };
          if (parsed.detail) msg = parsed.detail;
        } catch {
          if (txt) msg = txt.slice(0, 200);
        }
        setState({ kind: "error", message: msg, status: res.status });
        setBusy(false);
        return;
      }
      const listing = (await res.json()) as MarketplaceListing;
      setState({ kind: "done", demo: false, listing });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {eligible.length === 0 ? (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
          <Lock className="size-4" />
          <AlertTitle>No eligible characters to publish</AlertTitle>
          <AlertDescription className="text-amber-100/80">
            Only consented custom characters (Phase 2 — generated or uploaded,
            with liveness complete) can be published. Stock characters
            can&rsquo;t be published — they already ship with the engine. Use
            the Create Character panel above to make and bind one first.
          </AlertDescription>
        </Alert>
      ) : null}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Character to publish
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {eligible.map((c) => {
            const active = c.id === selectedId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                aria-pressed={active}
                aria-label={`Select ${c.name} to publish`}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-all",
                  active
                    ? "border-rose-500/60 bg-rose-500/10"
                    : "border-neutral-800 bg-neutral-950/40 hover:border-neutral-700 hover:bg-neutral-900",
                )}
              >
                <span
                  className="flex size-12 items-center justify-center rounded-full ring-1 ring-inset ring-black/30"
                  style={{ background: c.gradient }}
                  aria-hidden
                >
                  <span className="font-mono text-lg font-bold text-white/95">
                    {c.initial}
                  </span>
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1 text-xs font-medium",
                    active ? "text-rose-200" : "text-neutral-300",
                  )}
                >
                  {c.name}
                </span>
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 bg-emerald-500/10 px-1 py-0 text-[9px] text-emerald-200"
                >
                  consented
                </Badge>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          Only characters you have personally bound to your face appear here —
          the publish endpoint calls{" "}
          <code className="text-neutral-400">_enforce_consent_gate</code> (the
          same helper as live sessions, async render, and voice conversion), so
          the consent_token&rsquo;s face_hash must match the character&rsquo;s{" "}
          <code className="text-neutral-400">bound_face_hash</code>.
        </p>
      </div>

      <div>
        <Label
          htmlFor="mp-publisher-id"
          className="flex items-center gap-1.5 text-neutral-300"
        >
          <User className="size-3.5 text-rose-300" />
          Publisher ID
        </Label>
        <Input
          id="mp-publisher-id"
          type="text"
          autoComplete="off"
          placeholder="e.g. alice"
          value={publisherId}
          onChange={(e) => setPublisherId(e.target.value)}
          className="mt-1.5 bg-neutral-950/40 font-mono text-sm"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">
          Recorded on the listing as the publisher. Free-form text — the engine
          doesn&rsquo;t authenticate it (no user accounts yet); it&rsquo;s an
          audit-trail string. The publisher&rsquo;s{" "}
          <code className="text-neutral-400">bound_face_hash</code> is also
          recorded (from the consent_token) so a moderator can see who published
          this listing.
        </p>
      </div>

      {/* Liveness + Publish action */}
      <div className="space-y-3">
        {!consentToken ? (
          <Alert className="border-rose-500/30 bg-rose-500/[0.06] text-rose-100">
            <ScanFace className="size-4 text-rose-300" />
            <AlertTitle className="text-rose-200">
              Publish requires a fresh consent_token
            </AlertTitle>
            <AlertDescription className="text-neutral-300">
              The engine&rsquo;s <code className="text-rose-200">_enforce_consent_gate</code>{" "}
              (the same helper used for live sessions, async render, and voice
              conversion — no parallel check) refuses publish without a token
              whose face_hash matches this character&rsquo;s{" "}
              <code className="text-rose-200">bound_face_hash</code>. Only the
              creator who bound it can publish it. Re-run liveness to mint a
              fresh token, then click Publish.
            </AlertDescription>
          </Alert>
        ) : null}

        {!consentToken ? (
          <Button
            type="button"
            size="lg"
            onClick={onPublishClick}
            disabled={!selected}
            className="w-full bg-rose-500 text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ScanFace className="size-4" />
            Re-run liveness to publish
          </Button>
        ) : (
          <div className="space-y-2">
            <Button
              type="button"
              size="lg"
              onClick={onPublish}
              disabled={!canPublish}
              className="w-full bg-rose-500 text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {busy ? "Publishing…" : "Publish to marketplace"}
            </Button>
            <p className="text-[11px] text-emerald-300">
              Liveness verified — consent_token captured. Click Publish to send{" "}
              <code className="rounded bg-emerald-500/10 px-1 py-0.5 font-mono text-[10px]">
                POST /api/marketplace/publish
              </code>
              .
            </p>
          </div>
        )}

        {!engineConnected ? (
          <p className="text-[11px] text-amber-200/80">
            Demo mode — clicking Publish simulates a successful publish
            (~1.2s). The simulated listing would appear in the Browse tab if
            the engine were running.
          </p>
        ) : null}
      </div>

      {/* Publish result */}
      <PublishResult state={state} onReset={() => {
        setConsentToken(null);
        setState({ kind: "idle" });
      }} />

      <LivenessDialog
        characterId={activeLiveness && selected ? selected.id : null}
        isDemo={!engineConnected}
        onClose={() => setActiveLiveness(false)}
        onBound={onLivenessBound}
      />
    </div>
  );
}

function PublishResult({
  state,
  onReset,
}: {
  state: PublishState;
  onReset: () => void;
}) {
  if (state.kind === "idle") {
    return (
      <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 p-5 text-center">
        <Upload className="mx-auto size-5 text-neutral-600" />
        <p className="mt-2 text-sm text-neutral-500">
          No publish yet. Pick a character, run liveness, click Publish.
        </p>
      </div>
    );
  }
  if (state.kind === "publishing") {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4"
      >
        <div className="flex items-center gap-2 text-sm text-neutral-300">
          <Loader2 className="size-4 animate-spin text-rose-300" />
          {state.kind === "publishing" && "Computing pHash + checking near-duplicates…"}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          The engine encodes the character PNG, computes a 64-bit perceptual
          hash (DCT-based), and compares it against every approved listing via
          the duplicate checker. If a near-duplicate is found (Hamming
          distance ≤ 10), the listing is flagged and stays pending for manual
          review; otherwise it auto-approves.
        </p>
      </motion.div>
    );
  }
  if (state.kind === "error") {
    const isConsent = state.status === 403;
    const isNotFound = state.status === 404;
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
      >
        <Alert className="border-0 bg-transparent p-0 text-amber-200">
          <AlertCircle className="size-4" />
          <AlertTitle>
            {isConsent
              ? "Consent gate refused the request"
              : isNotFound
                ? "Character not found"
                : "Publish failed"}
          </AlertTitle>
          <AlertDescription className="break-words font-mono text-[11px] text-amber-100/80">
            {state.message}
          </AlertDescription>
        </Alert>
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          {isConsent
            ? "The consent_token's face_hash doesn't match this character's bound_face_hash. Re-run liveness for THIS character — tokens are face-specific."
            : isNotFound
              ? "The engine doesn't have a character with that id. If the engine restarted, the local registry may have been reset."
              : "Unexpected error from the engine."}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReset}
          className="mt-3 border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
        >
          Try again
        </Button>
      </motion.div>
    );
  }
  // state.kind === "done"
  const { listing, demo } = state;
  const isFlagged = listing.flagged;
  const isApproved = listing.review_status === "approved";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-lg border p-4",
        isApproved
          ? "border-emerald-500/30 bg-emerald-500/[0.06]"
          : "border-amber-500/40 bg-amber-500/10",
      )}
    >
      <div className="flex items-start gap-3">
        {isApproved ? (
          <CheckCircle2 className="mt-0.5 size-5 text-emerald-300" />
        ) : (
          <Flag className="mt-0.5 size-5 text-amber-300" />
        )}
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={cn(
                "text-sm font-semibold",
                isApproved ? "text-emerald-200" : "text-amber-200",
              )}
            >
              {demo
                ? isApproved
                  ? "Published (simulated) — auto-approved"
                  : "Published (simulated) — flagged for review"
                : isApproved
                  ? "Published — auto-approved"
                  : "Published — flagged for review"}
            </p>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                isApproved
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : "border-amber-500/40 bg-amber-500/15 text-amber-200",
              )}
            >
              {isApproved ? "approved" : "pending"}
            </Badge>
            {demo ? (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/15 text-[10px] text-amber-200"
              >
                Simulated
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-neutral-300">
            {isApproved
              ? "No near-duplicate found — the listing is live in Browse. Your character_name, character_tags, and PNG were copied into the listing (immutable after publish)."
              : "Near-duplicate of an existing listing — pending manual review. A moderator can approve or reject from the Moderator tab."}
          </p>
          {isFlagged && listing.flag_reason ? (
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/[0.08] p-2.5">
              <p className="text-[11px] font-semibold text-amber-200">
                Flag reason (honest — straight from the engine):
              </p>
              <p className="mt-1 break-words font-mono text-[11px] text-amber-100/80">
                {listing.flag_reason}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
                The pHash flagger caught a near-duplicate image — same PNG
                re-uploaded, resized/recompressed, or with minor edits. pHash
                does NOT catch stylistic copies or likeness-of-real-person
                (that needs a face-embedding model this project doesn&rsquo;t
                have). The manual review queue is where the judgment call
                happens.
              </p>
            </div>
          ) : null}
          <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
            Listing id:{" "}
            <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[10px] text-rose-200">
              {listing.listing_id}
            </code>
            . The publisher&rsquo;s bound_face_hash is recorded as an audit
            trail — it does NOT transfer to installers.
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onReset}
        className="mt-3 border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
      >
        Publish another
      </Button>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Moderator tab
// ---------------------------------------------------------------------------

function ModeratorTab() {
  const engineConnected = useCharacterStore((s) => s.engineConnected);
  const [state, setState] = React.useState<LoadState<MarketplaceListing>>({
    kind: "idle",
  });
  const [reviewerId, setReviewerId] = React.useState("");
  const [reviewState, setReviewState] = React.useState<ReviewState>({
    kind: "idle",
  });
  const loadTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    if (!engineConnected) {
      loadTimerRef.current = setTimeout(() => {
        setState({ kind: "ready", items: DEMO_PENDING, demo: true });
      }, 400);
      return;
    }
    try {
      const res = await fetch(marketplacePendingUrl(), { method: "GET" });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let msg = `Engine returned ${res.status}`;
        try {
          const parsed = JSON.parse(txt) as { detail?: string };
          if (parsed.detail) msg = parsed.detail;
        } catch {
          if (txt) msg = txt.slice(0, 200);
        }
        setState({ kind: "error", message: msg, status: res.status });
        return;
      }
      const items = (await res.json()) as MarketplaceListing[];
      setState({ kind: "ready", items, demo: false });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [engineConnected]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(
    () => () => {
      if (loadTimerRef.current) {
        clearTimeout(loadTimerRef.current);
        loadTimerRef.current = null;
      }
      if (reviewTimerRef.current) {
        clearTimeout(reviewTimerRef.current);
        reviewTimerRef.current = null;
      }
    },
    [],
  );

  const onReview = async (
    listing: MarketplaceListing,
    status: "approved" | "rejected",
  ) => {
    if (reviewerId.trim().length === 0) return;
    setReviewState({ kind: "reviewing", listingId: listing.listing_id, action: status });

    if (!engineConnected) {
      reviewTimerRef.current = setTimeout(() => {
        // Remove the reviewed listing from the local list (demo).
        setState((s) =>
          s.kind === "ready"
            ? {
                ...s,
                items: s.items.filter(
                  (l) => l.listing_id !== listing.listing_id,
                ),
              }
            : s,
        );
        setReviewState({ kind: "done", listingId: listing.listing_id, status });
      }, 700);
      return;
    }

    try {
      const body: ReviewActionRequest = {
        status,
        reviewer_id: reviewerId.trim(),
        reason: null,
      };
      const res = await fetch(marketplaceReviewUrl(listing.listing_id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let msg = `Engine returned ${res.status}`;
        try {
          const parsed = JSON.parse(txt) as { detail?: string };
          if (parsed.detail) msg = parsed.detail;
        } catch {
          if (txt) msg = txt.slice(0, 200);
        }
        setReviewState({
          kind: "error",
          listingId: listing.listing_id,
          message: msg,
          status: res.status,
        });
        return;
      }
      // The reviewed listing is no longer pending — drop it from the queue.
      setState((s) =>
        s.kind === "ready"
          ? {
              ...s,
              items: s.items.filter(
                (l) => l.listing_id !== listing.listing_id,
              ),
            }
          : s,
      );
      setReviewState({ kind: "done", listingId: listing.listing_id, status });
    } catch (e) {
      setReviewState({
        kind: "error",
        listingId: listing.listing_id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <div className="space-y-5">
      <Alert className="border-amber-500/30 bg-amber-500/[0.06] text-amber-100">
        <Shield className="size-4 text-amber-300" />
        <AlertTitle className="text-amber-200">
          This is manual review — not automated moderation
        </AlertTitle>
        <AlertDescription className="text-neutral-300">
          The pHash near-duplicate check at publish time is automated{" "}
          <span className="font-semibold text-amber-100">flagging</span> — it
          catches the same PNG re-uploaded (resized, recompressed, minor
          edits). It does NOT catch stylistic copies, likeness-of-real-person,
          or proof of original authorship. <span className="font-semibold text-amber-100">This
          queue is where the judgment calls happen.</span> See{" "}
          <code className="rounded bg-amber-500/10 px-1 py-0.5 font-mono text-[11px] text-amber-100">
            docs/reality-check.md
          </code>{" "}
          #11.
        </AlertDescription>
      </Alert>

      <div>
        <Label
          htmlFor="mp-reviewer-id"
          className="flex items-center gap-1.5 text-neutral-300"
        >
          <Shield className="size-3.5 text-rose-300" />
          Reviewer ID
        </Label>
        <Input
          id="mp-reviewer-id"
          type="text"
          autoComplete="off"
          placeholder="e.g. mod1"
          value={reviewerId}
          onChange={(e) => setReviewerId(e.target.value)}
          className="mt-1.5 bg-neutral-950/40 font-mono text-sm"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">
          Recorded on the listing as the reviewer (the engine returns 409 if
          the listing isn&rsquo;t currently pending — already approved or
          rejected).
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Pending review queue
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={state.kind === "loading"}
          className="border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
        >
          {state.kind === "loading" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          Refresh
        </Button>
      </div>

      {state.kind === "loading" ? (
        <ModeratorSkeleton />
      ) : state.kind === "error" ? (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
          <AlertCircle className="size-4" />
          <AlertTitle>Couldn&rsquo;t load the review queue</AlertTitle>
          <AlertDescription className="break-words font-mono text-[11px] text-amber-100/80">
            {state.message}
          </AlertDescription>
        </Alert>
      ) : state.kind === "ready" && state.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 p-8 text-center">
          <CheckCircle2 className="mx-auto size-6 text-emerald-500/70" />
          <p className="mt-2 text-sm text-neutral-400">
            Queue is empty.
          </p>
          <p className="mt-1 text-[11px] text-neutral-500">
            Either no listings are pending review, or every flagged listing has
            already been approved/rejected.
          </p>
        </div>
      ) : state.kind === "ready" ? (
        <div className="grid gap-3">
          {state.items.map((l) => (
            <PendingListingRow
              key={l.listing_id}
              listing={l}
              demo={state.demo}
              reviewerId={reviewerId.trim()}
              reviewState={
                reviewState.listingId === l.listing_id
                  ? reviewState
                  : { kind: "idle" }
              }
              onApprove={() => void onReview(l, "approved")}
              onReject={() => void onReview(l, "rejected")}
            />
          ))}
        </div>
      ) : null}

      {reviewState.kind === "done" ? (
        <motion.div
          layout
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "rounded-lg border p-3",
            reviewState.status === "approved"
              ? "border-emerald-500/30 bg-emerald-500/[0.06]"
              : "border-rose-500/30 bg-rose-500/[0.06]",
          )}
        >
          <p
            className={cn(
              "text-xs font-semibold",
              reviewState.status === "approved"
                ? "text-emerald-200"
                : "text-rose-200",
            )}
          >
            Listing {reviewState.listingId} → {reviewState.status}
          </p>
        </motion.div>
      ) : null}
    </div>
  );
}

function PendingListingRow({
  listing,
  demo,
  reviewerId,
  reviewState,
  onApprove,
  onReject,
}: {
  listing: MarketplaceListing;
  demo: boolean;
  reviewerId: string;
  reviewState: ReviewState;
  onApprove: () => void;
  onReject: () => void;
}) {
  const busy =
    reviewState.kind === "reviewing" &&
    reviewState.listingId === listing.listing_id;
  const isFlagged = listing.flagged;
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/40">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
        <div className="shrink-0">
          <ListingThumb listing={listing} demo={demo} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-neutral-100">
              {listing.character_name}
            </p>
            {demo ? (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/15 text-[9px] text-amber-200"
              >
                Simulated
              </Badge>
            ) : null}
            {isFlagged ? (
              <Badge
                variant="outline"
                className="gap-1 border-amber-500/40 bg-amber-500/15 text-[9px] text-amber-200"
              >
                <Flag className="size-2.5" />
                flagged
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1 border-neutral-700 bg-neutral-900 text-[9px] text-neutral-400"
              >
                <Clock className="size-2.5" />
                pending
              </Badge>
            )}
          </div>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-neutral-500">
            <User className="size-3" />
            publisher: {listing.publisher_id}
          </p>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            listing:{" "}
            <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[10px] text-rose-200">
              {listing.listing_id}
            </code>
          </p>
          {isFlagged && listing.flag_reason ? (
            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/[0.08] p-2">
              <p className="text-[10px] font-semibold text-amber-200">
                pHash flag reason:
              </p>
              <p className="mt-0.5 break-words font-mono text-[10px] text-amber-100/80">
                {listing.flag_reason}
              </p>
            </div>
          ) : null}
          {reviewState.kind === "error" ? (
            <p className="mt-2 text-[10px] leading-relaxed text-amber-200/80">
              {reviewState.status === 409
                ? "Listing is no longer pending (already reviewed)."
                : reviewState.status === 404
                  ? "Listing not found."
                  : reviewState.message}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onApprove}
            disabled={busy || reviewerId.length === 0}
            className="bg-emerald-500 text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && reviewState.kind === "reviewing" && reviewState.action === "approved" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            Approve
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onReject}
            disabled={busy || reviewerId.length === 0}
            variant="outline"
            className="border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && reviewState.kind === "reviewing" && reviewState.action === "rejected" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Gavel className="size-3.5" />
            )}
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components + demo data
// ---------------------------------------------------------------------------

function EngineBadge({ connected }: { connected: boolean }) {
  if (connected) {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      >
        <CheckCircle2 className="size-3.5" />
        Engine connected · live marketplace
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-300"
    >
      <CircleAlert className="size-3.5" />
      Demo mode — engine not connected
    </Badge>
  );
}

function BrowseSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/40"
        >
          <div className="aspect-[4/3] animate-pulse bg-neutral-900" />
          <div className="space-y-2 p-3">
            <div className="h-3.5 w-2/3 animate-pulse rounded bg-neutral-800" />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-neutral-800/70" />
            <div className="h-7 w-full animate-pulse rounded bg-neutral-800/50" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ModeratorSkeleton() {
  return (
    <div className="grid gap-3">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4"
        >
          <div className="flex gap-3">
            <div className="size-20 animate-pulse rounded bg-neutral-900" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/3 animate-pulse rounded bg-neutral-800" />
              <div className="h-2.5 w-1/4 animate-pulse rounded bg-neutral-800/70" />
              <div className="h-2.5 w-1/2 animate-pulse rounded bg-neutral-800/50" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Deterministic gradient for a simulated listing's faux thumbnail. */
function gradientFor(seed: string): string {
  const palette = [
    "linear-gradient(135deg, #fda4af 0%, #f43f5e 40%, #9f1239 100%)",
    "linear-gradient(135deg, #fcd34d 0%, #f59e0b 50%, #92400e 100%)",
    "linear-gradient(135deg, #d8b4fe 0%, #a855f7 50%, #6b21a8 100%)",
    "linear-gradient(135deg, #99f6e4 0%, #14b8a6 50%, #115e59 100%)",
    "linear-gradient(135deg, #fbcfe8 0%, #ec4899 50%, #9d174d 100%)",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return palette[h % palette.length]!;
}

/** Demo listings shown in Browse when the engine isn't connected. */
const DEMO_LISTINGS: MarketplaceListing[] = [
  {
    listing_id: "mp-demo-aoi",
    publisher_id: "alice",
    character_name: "Aoi (variant)",
    character_tags: ["female", "blue-hair", "soft"],
    thumbnail_url: "/api/marketplace/mp-demo-aoi/thumbnail",
    review_status: "approved",
    flagged: false,
    flag_reason: null,
    published_at: Date.now() - 1000 * 60 * 60 * 24 * 3,
    reviewed_at: Date.now() - 1000 * 60 * 60 * 24 * 3,
    reviewer_id: "system-auto",
  },
  {
    listing_id: "mp-demo-ren",
    publisher_id: "brian",
    character_name: "Ren (low-sat)",
    character_tags: ["male", "dark-hair"],
    thumbnail_url: "/api/marketplace/mp-demo-ren/thumbnail",
    review_status: "approved",
    flagged: false,
    flag_reason: null,
    published_at: Date.now() - 1000 * 60 * 60 * 24 * 1,
    reviewed_at: Date.now() - 1000 * 60 * 60 * 24 * 1,
    reviewer_id: "mod1",
  },
  {
    listing_id: "mp-demo-yuki",
    publisher_id: "carol",
    character_name: "Yuki (bright)",
    character_tags: ["female", "white-hair", "high-contrast"],
    thumbnail_url: "/api/marketplace/mp-demo-yuki/thumbnail",
    review_status: "approved",
    flagged: false,
    flag_reason: null,
    published_at: Date.now() - 1000 * 60 * 60 * 6,
    reviewed_at: Date.now() - 1000 * 60 * 60 * 6,
    reviewer_id: "system-auto",
  },
];

/** Demo pending listings shown in the Moderator tab when the engine isn't
 * connected. The flagged one demonstrates the pHash near-duplicate path —
 * it's the more interesting of the two to show. */
const DEMO_PENDING: MarketplaceListing[] = [
  {
    listing_id: "mp-demo-pending-1",
    publisher_id: "mallory",
    character_name: "Aoi (copy)",
    character_tags: ["female", "blue-hair"],
    thumbnail_url: "/api/marketplace/mp-demo-pending-1/thumbnail",
    review_status: "pending",
    flagged: true,
    flag_reason:
      "Near-duplicate of approved listing mp-demo-aoi (Hamming distance 4 <= 10). Manual review required.",
    published_at: Date.now() - 1000 * 60 * 12,
    reviewed_at: null,
    reviewer_id: null,
  },
];
