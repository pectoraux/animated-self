"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  CheckCircle2,
  CircleAlert,
  Info,
  KeyRound,
  Loader2,
  Lock,
  LockOpen,
  ScanFace,
  Sparkles,
  Upload,
  Wand2,
  XCircle,
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
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useCharacterStore, type UiCharacter } from "@/lib/character-store";
import { engineUrl, ENGINE_PORT } from "@contracts/types";
import type {
  GenProviderInfo,
  GenerateCharacterRequest,
  TransferCharacterRequest,
  UploadCharacterRequest,
} from "@contracts/types";
import { LivenessDialog } from "@/components/studio/liveness-dialog";

const HEALTH_TIMEOUT_MS = 1500;
const GEN_TIMEOUT_MS = 30_000;

type EngineProbe =
  | { status: "probing" }
  | { status: "demo" }
  | { status: "live" };

/**
 * Phase 2 — Create Character panel.
 *
 * Three creation routes (Text → Character, Selfie → Character, Upload), a
 * provider dropdown that reflects /api/characters/providers, conditional API
 * key entry for BYOK providers, and a liveness → bind dialog that flips a
 * freshly-created character from consented=false to consented=true.
 *
 * When the Python engine isn't reachable (the typical sandbox state), the
 * panel runs an honest demo path: simulated generation after ~2s, simulated
 * liveness after ~1.5s, with a visible "Simulated" badge — exactly like the
 * existing Studio panel.
 */
export function CreateCharacter() {
  const engine = useEngineProbe();
  const { providers } = useProviders(engine.status === "live");
  const [createdIds, setCreatedIds] = React.useState<string[]>([]);
  const [activeLivenessId, setActiveLivenessId] = React.useState<string | null>(
    null,
  );

  const characters = useCharacterStore((s) => s.characters);
  const addCreated = useCharacterStore((s) => s.addCreated);
  const setConsented = useCharacterStore((s) => s.setConsented);
  const setEngineConnected = useCharacterStore((s) => s.setEngineConnected);

  // Mirror probe state into the shared store so the Studio picker agrees.
  React.useEffect(() => {
    setEngineConnected(engine.status === "live");
  }, [engine.status, setEngineConnected]);

  const created = createdIds
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is UiCharacter => Boolean(c));

  const onCreated = React.useCallback((id: string) => {
    setCreatedIds((prev) => [...prev, id]);
  }, []);

  // The shared LivenessDialog surfaces the freshly-minted consent_token;
  // the Create Character flow doesn't need it (it just flips the store flag).
  const onConsented = React.useCallback(
    (id: string, _consentToken: string) => {
      setConsented(id);
      setActiveLivenessId(null);
    },
    [setConsented],
  );

  const isDemo = engine.status !== "live";

  return (
    <Card className="overflow-hidden border-neutral-800 bg-neutral-900/60">
      <CardHeader className="border-b border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-neutral-50">
              <Wand2 className="size-5 text-rose-300" />
              Create a character
            </CardTitle>
            <CardDescription className="text-neutral-400">
              Phase 2 — text, selfie, or upload. Generated characters start
              locked; complete liveness to drive them.
            </CardDescription>
          </div>
          <CreateEngineBadge engine={engine} />
        </div>
      </CardHeader>

      <CardContent className="space-y-6 p-6">
        <Tabs defaultValue="text" className="gap-4">
          <TabsList className="bg-neutral-950/60">
            <TabsTrigger
              value="text"
              className="data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-200"
            >
              <Sparkles className="size-3.5" />
              Text → Character
            </TabsTrigger>
            <TabsTrigger
              value="selfie"
              className="data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-200"
            >
              <Camera className="size-3.5" />
              Selfie → Character
            </TabsTrigger>
            <TabsTrigger
              value="upload"
              className="data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-200"
            >
              <Upload className="size-3.5" />
              Upload
            </TabsTrigger>
          </TabsList>

          <TabsContent value="text">
            <TextTab
              isDemo={isDemo}
              providers={providers}
              onCreated={onCreated}
            />
          </TabsContent>

          <TabsContent value="selfie">
            <SelfieTab
              isDemo={isDemo}
              providers={providers}
              onCreated={onCreated}
            />
          </TabsContent>

          <TabsContent value="upload">
            <UploadTab isDemo={isDemo} onCreated={onCreated} />
          </TabsContent>
        </Tabs>

        <Separator className="bg-neutral-800" />

        {/* Recently created characters */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Your characters
            </h3>
            <span className="font-mono text-[11px] text-neutral-500">
              {created.length} created
            </span>
          </div>
          {created.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950/30 p-6 text-center">
              <Sparkles className="mx-auto size-5 text-neutral-600" />
              <p className="mt-2 text-sm text-neutral-500">
                Nothing here yet. Generate a character above — it&rsquo;ll show
                up locked, ready for liveness.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {created.map((c) => (
                <CreatedCharacterCard
                  key={c.id}
                  character={c}
                  isDemo={isDemo}
                  onUnlock={() => setActiveLivenessId(c.id)}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>

      {/* Liveness → bind flow */}
      <LivenessDialog
        characterId={activeLivenessId}
        isDemo={isDemo}
        onClose={() => setActiveLivenessId(null)}
        onBound={onConsented}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Engine probe (shared with Studio via the store)
// ---------------------------------------------------------------------------

function useEngineProbe(): EngineProbe {
  const [state, setState] = React.useState<EngineProbe>({ status: "probing" });

  React.useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);

    fetch(`/api/health?XTransformPort=${ENGINE_PORT}`, {
      signal: ctrl.signal,
    })
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      )
      .then(() => {
        if (!cancelled) setState({ status: "live" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "demo" });
      })
      .finally(() => clearTimeout(timer));

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  return state;
}

function CreateEngineBadge({ engine }: { engine: EngineProbe }) {
  if (engine.status === "probing") {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-neutral-700 bg-neutral-900 text-neutral-300"
      >
        <Loader2 className="size-3.5 animate-spin" />
        Probing engine…
      </Badge>
    );
  }
  if (engine.status === "live") {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      >
        <CheckCircle2 className="size-3.5" />
        Engine connected · live generation
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-300"
    >
      <CircleAlert className="size-3.5" />
      Demo mode — simulated generation
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Provider dropdown (fetched from /api/characters/providers)
// ---------------------------------------------------------------------------

function useProviders(live: boolean) {
  const [providers, setProviders] = React.useState<GenProviderInfo[]>([
    { id: "demo", byok: false, requires_key: false, label: "Demo (no key)" },
  ]);

  React.useEffect(() => {
    if (!live) {
      setProviders([
        {
          id: "demo",
          byok: false,
          requires_key: false,
          label: "Demo (no key) — simulated",
        },
        {
          id: "openai",
          byok: true,
          requires_key: true,
          label: "OpenAI DALL·E 3 (BYOK)",
        },
      ]);
      return;
    }
    let cancelled = false;
    fetch(engineUrl("/api/characters/providers"))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((list: GenProviderInfo[]) => {
        if (cancelled || !Array.isArray(list) || list.length === 0) return;
        setProviders(list);
      })
      .catch(() => {
        if (cancelled) return;
        // Fall back to the static list if the engine hiccups.
        setProviders([
          {
            id: "demo",
            byok: false,
            requires_key: false,
            label: "Demo (no key)",
          },
        ]);
      });
    return () => {
      cancelled = true;
    };
  }, [live]);

  return { providers };
}

function ProviderSelect({
  value,
  onValueChange,
  providers,
}: {
  value: string;
  onValueChange: (v: string) => void;
  providers: GenProviderInfo[];
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-full bg-neutral-950/40">
        <SelectValue placeholder="Pick a provider" />
      </SelectTrigger>
      <SelectContent className="border-neutral-800 bg-neutral-900">
        {providers.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <span className="flex items-center gap-2">
              {p.label}
              {p.byok ? (
                <Badge
                  variant="outline"
                  className="border-rose-500/30 bg-rose-500/10 text-[9px] text-rose-200"
                >
                  BYOK
                </Badge>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ApiKeyField({
  value,
  onChange,
  providerLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  providerLabel: string;
}) {
  return (
    <div className="space-y-2">
      <Label
        htmlFor="api-key"
        className="text-neutral-300"
      >
        <KeyRound className="size-3.5 text-rose-300" />
        {providerLabel} API key
      </Label>
      <Input
        id="api-key"
        type="password"
        autoComplete="off"
        placeholder="sk-…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-neutral-950/40 font-mono text-sm"
      />
      <p className="text-[11px] leading-relaxed text-neutral-500">
        Sent per-request only. The engine never logs or persists the key — it
        calls the provider with your key and discards it.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Text → Character
// ---------------------------------------------------------------------------

interface TabProps {
  isDemo: boolean;
  providers: GenProviderInfo[];
  onCreated: (id: string) => void;
}

function TextTab({ isDemo, providers, onCreated }: TabProps) {
  const [name, setName] = React.useState("");
  const [prompt, setPrompt] = React.useState(
    "Anime girl with rose-pink hair, soft pastel palette, head-and-shoulders portrait, neutral expression, plain background",
  );
  const [providerId, setProviderId] = React.useState(
    providers[0]?.id ?? "demo",
  );
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const addCreated = useCharacterStore((s) => s.addCreated);

  const provider = providers.find((p) => p.id === providerId);
  const needsKey = provider?.requires_key === true;

  React.useEffect(() => {
    // If the provider list loads after first render, ensure selectedId exists.
    if (!providers.some((p) => p.id === providerId)) {
      setProviderId(providers[0]?.id ?? "demo");
    }
  }, [providers, providerId]);

  const canSubmit =
    !busy && name.trim().length > 0 && prompt.trim().length > 0 && (!needsKey || apiKey.trim().length > 0);

  const onSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!isDemo) {
        const body: GenerateCharacterRequest = {
          prompt: prompt.trim(),
          name: name.trim(),
          provider: providerId,
          api_key: needsKey ? apiKey.trim() : null,
        };
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), GEN_TIMEOUT_MS);
        try {
          const res = await fetch(engineUrl("/api/characters/generate"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
          if (!res.ok) {
            const txt = await res.text().catch(() => "");
            throw new Error(
              `Engine returned ${res.status}${txt ? `: ${txt.slice(0, 200)}` : ""}`,
            );
          }
          // Engine returns the new Character — but we don't strictly need its
          // response: the next /api/characters poll would surface it. To keep
          // the UX immediate we use addCreated with the local name + a tag.
          const id = addCreated({
            name: name.trim(),
            source: "generated",
            simulated: false,
            tags: ["from-prompt"],
          });
          onCreated(id);
        } finally {
          clearTimeout(timer);
        }
      } else {
        // Demo path: simulate ~2s of generation.
        await sleep(2000);
        const id = addCreated({
          name: name.trim(),
          source: "generated",
          simulated: true,
          tags: ["from-prompt"],
        });
        onCreated(id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="text-name" className="text-neutral-300">
          Character name
        </Label>
        <Input
          id="text-name"
          placeholder="e.g. Hana"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-neutral-950/40"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="text-prompt" className="text-neutral-300">
          Prompt
        </Label>
        <Textarea
          id="text-prompt"
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="bg-neutral-950/40 font-mono text-sm"
          placeholder="Describe the character: hair, palette, expression, framing…"
        />
        <p className="text-[11px] text-neutral-500">
          The engine forwards this verbatim to the provider&rsquo;s image model.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label className="text-neutral-300">Provider</Label>
          <ProviderSelect
            value={providerId}
            onValueChange={setProviderId}
            providers={providers}
          />
        </div>
        {needsKey ? (
          <ApiKeyField
            value={apiKey}
            onChange={setApiKey}
            providerLabel={provider?.label ?? "Provider"}
          />
        ) : null}
      </div>

      <SubmitRow
        busy={busy}
        disabled={!canSubmit}
        onSubmit={onSubmit}
        isDemo={isDemo}
        actionLabel="Generate character"
        icon={<Sparkles className="size-4" />}
      />

      {error ? (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
          <CircleAlert className="size-4" />
          <AlertTitle>Generation failed</AlertTitle>
          <AlertDescription className="text-amber-100/80">
            {error}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Selfie → Character
// ---------------------------------------------------------------------------

function SelfieTab({ isDemo, providers, onCreated }: TabProps) {
  const [name, setName] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [providerId, setProviderId] = React.useState(
    providers[0]?.id ?? "demo",
  );
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const addCreated = useCharacterStore((s) => s.addCreated);

  const provider = providers.find((p) => p.id === providerId);
  const needsKey = provider?.requires_key === true;

  React.useEffect(() => {
    if (!providers.some((p) => p.id === providerId)) {
      setProviderId(providers[0]?.id ?? "demo");
    }
  }, [providers, providerId]);

  React.useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const canSubmit =
    !busy &&
    name.trim().length > 0 &&
    file !== null &&
    (!needsKey || apiKey.trim().length > 0);

  const onSubmit = async () => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const selfieB64 = await fileToDataUrl(file);
      if (!isDemo) {
        const body: TransferCharacterRequest = {
          selfie_b64: selfieB64,
          name: name.trim(),
          provider: providerId,
          api_key: needsKey ? apiKey.trim() : null,
        };
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), GEN_TIMEOUT_MS);
        try {
          const res = await fetch(engineUrl("/api/characters/transfer"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
          if (!res.ok) {
            const txt = await res.text().catch(() => "");
            throw new Error(
              `Engine returned ${res.status}${txt ? `: ${txt.slice(0, 200)}` : ""}`,
            );
          }
          const id = addCreated({
            name: name.trim(),
            source: "generated",
            simulated: false,
            tags: ["from-selfie"],
          });
          onCreated(id);
        } finally {
          clearTimeout(timer);
        }
      } else {
        await sleep(2000);
        const id = addCreated({
          name: name.trim(),
          source: "generated",
          simulated: true,
          tags: ["from-selfie"],
        });
        onCreated(id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Alert className="border-rose-500/30 bg-rose-500/[0.06] text-rose-100">
        <Info className="size-4 text-rose-300" />
        <AlertTitle className="text-rose-200">
          Description-based, not pixel-level
        </AlertTitle>
        <AlertDescription className="text-neutral-300">
          The engine describes your selfie via a VLM, then generates an anime
          character matching the description. It is NOT identity-preserving
          img2img — that lands in Phase 3+.
        </AlertDescription>
      </Alert>

      <div className="grid gap-2">
        <Label htmlFor="selfie-name" className="text-neutral-300">
          Character name
        </Label>
        <Input
          id="selfie-name"
          placeholder="e.g. Self-portrait"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-neutral-950/40"
        />
      </div>

      <FileDrop
        accept="image/*"
        file={file}
        previewUrl={previewUrl}
        onPick={setFile}
        label="Drop a selfie (JPG/PNG) or click to choose"
        hint="The VLM uses this only to produce a text description — the image itself is not sent to the image model."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label className="text-neutral-300">Provider</Label>
          <ProviderSelect
            value={providerId}
            onValueChange={setProviderId}
            providers={providers}
          />
        </div>
        {needsKey ? (
          <ApiKeyField
            value={apiKey}
            onChange={setApiKey}
            providerLabel={provider?.label ?? "Provider"}
          />
        ) : null}
      </div>

      <SubmitRow
        busy={busy}
        disabled={!canSubmit}
        onSubmit={onSubmit}
        isDemo={isDemo}
        actionLabel="Transfer to anime"
        icon={<Camera className="size-4" />}
      />

      {error ? (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
          <CircleAlert className="size-4" />
          <AlertTitle>Transfer failed</AlertTitle>
          <AlertDescription className="text-amber-100/80">
            {error}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Upload
// ---------------------------------------------------------------------------

function UploadTab({ isDemo, onCreated }: TabProps) {
  const [name, setName] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const addCreated = useCharacterStore((s) => s.addCreated);

  React.useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const isPng = file?.type === "image/png";
  const canSubmit = !busy && name.trim().length > 0 && file !== null && isPng;

  const onSubmit = async () => {
    if (!file || !isPng) return;
    setError(null);
    setBusy(true);
    try {
      const imageB64 = await fileToDataUrl(file);
      if (!isDemo) {
        const body: UploadCharacterRequest = {
          name: name.trim(),
          image_b64: imageB64,
        };
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), GEN_TIMEOUT_MS);
        try {
          const res = await fetch(engineUrl("/api/characters/upload"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
          if (!res.ok) {
            const txt = await res.text().catch(() => "");
            throw new Error(
              `Engine returned ${res.status}${txt ? `: ${txt.slice(0, 200)}` : ""}`,
            );
          }
          const id = addCreated({
            name: name.trim(),
            source: "uploaded",
            simulated: false,
            tags: ["uploaded-png"],
          });
          onCreated(id);
        } finally {
          clearTimeout(timer);
        }
      } else {
        await sleep(1500);
        const id = addCreated({
          name: name.trim(),
          source: "uploaded",
          simulated: true,
          tags: ["uploaded-png"],
        });
        onCreated(id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Alert className="border-amber-500/30 bg-amber-500/[0.06] text-amber-100">
        <Info className="size-4 text-amber-300" />
        <AlertTitle className="text-amber-200">
          Starts locked — complete liveness to drive it
        </AlertTitle>
        <AlertDescription className="text-neutral-300">
          For users who already have an anime character PNG. The file is treated
          as a custom character and goes through the same consent gate — the
          uploader must prove they can drive this face before anyone can stream
          it.
        </AlertDescription>
      </Alert>

      <div className="grid gap-2">
        <Label htmlFor="upload-name" className="text-neutral-300">
          Character name
        </Label>
        <Input
          id="upload-name"
          placeholder="e.g. My OC"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-neutral-950/40"
        />
      </div>

      <FileDrop
        accept="image/png"
        file={file}
        previewUrl={previewUrl}
        onPick={setFile}
        label="Drop an anime PNG or click to choose"
        hint={
          file && !isPng
            ? "Only PNG is accepted for upload — re-export as PNG."
            : undefined
        }
        error={file !== null && !isPng}
      />

      <SubmitRow
        busy={busy}
        disabled={!canSubmit}
        onSubmit={onSubmit}
        isDemo={isDemo}
        actionLabel="Upload character"
        icon={<Upload className="size-4" />}
      />

      {error ? (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
          <CircleAlert className="size-4" />
          <AlertTitle>Upload failed</AlertTitle>
          <AlertDescription className="text-amber-100/80">
            {error}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Created character card — shows lock state + CTA
// ---------------------------------------------------------------------------

function CreatedCharacterCard({
  character,
  isDemo,
  onUnlock,
}: {
  character: UiCharacter;
  isDemo: boolean;
  onUnlock: () => void;
}) {
  const consented = character.consented;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={cn(
        "overflow-hidden rounded-lg border bg-neutral-950/40",
        consented
          ? "border-emerald-500/30"
          : "border-amber-500/30",
      )}
    >
      <div className="relative aspect-square">
        <div
          className="absolute inset-0"
          style={{ background: character.gradient, opacity: 0.6 }}
          aria-hidden
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-4xl font-bold text-white drop-shadow">
            {character.initial}
          </span>
        </div>
        <div className="absolute right-2 top-2">
          {consented ? (
            <Badge
              variant="outline"
              className="gap-1 border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
            >
              <LockOpen className="size-3" />
              Unlocked
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/40 bg-amber-500/15 text-amber-200"
            >
              <Lock className="size-3" />
              Locked
            </Badge>
          )}
        </div>
        {character.simulated ? (
          <div className="absolute left-2 top-2">
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/15 text-[10px] text-amber-200"
            >
              Simulated
            </Badge>
          </div>
        ) : null}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold text-neutral-100">
            {character.name}
          </p>
          <Badge
            variant="outline"
            className="border-neutral-700 bg-neutral-900 text-[10px] text-neutral-400"
          >
            {character.source === "generated" ? "generated" : "uploaded"}
          </Badge>
        </div>
        <p className="text-[11px] leading-relaxed text-neutral-500">
          {character.blurb}
        </p>
        {consented ? (
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-300">
            <CheckCircle2 className="size-3.5" />
            Bound to your face — selectable in the picker.
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={onUnlock}
            className="w-full bg-rose-500 text-white hover:bg-rose-400"
          >
            <ScanFace className="size-3.5" />
            Complete liveness to unlock
          </Button>
        )}
        {isDemo && !consented ? (
          <p className="text-[10px] leading-relaxed text-neutral-600">
            Liveness is simulated in demo mode.
          </p>
        ) : null}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Shared subcomponents
// ---------------------------------------------------------------------------

function SubmitRow({
  busy,
  disabled,
  onSubmit,
  isDemo,
  actionLabel,
  icon,
}: {
  busy: boolean;
  disabled: boolean;
  onSubmit: () => void;
  isDemo: boolean;
  actionLabel: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Button
        type="button"
        size="lg"
        onClick={onSubmit}
        disabled={disabled}
        className="bg-rose-500 text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
        {busy ? "Working…" : actionLabel}
      </Button>
      {isDemo ? (
        <span className="text-[11px] text-amber-200/80">
          Simulated — engine not connected, no real generation runs.
        </span>
      ) : null}
    </div>
  );
}

function FileDrop({
  accept,
  file,
  previewUrl,
  onPick,
  label,
  hint,
  error,
}: {
  accept: string;
  file: File | null;
  previewUrl: string | null;
  onPick: (f: File) => void;
  label: string;
  hint?: string;
  error?: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onPick(f);
  };

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        aria-label={label}
        className={cn(
          "relative grid place-items-center rounded-lg border-2 border-dashed p-6 text-center transition-colors",
          dragOver
            ? "border-rose-400 bg-rose-500/10"
            : error
              ? "border-amber-500/60 bg-amber-500/[0.04]"
              : "border-neutral-700 bg-neutral-950/40 hover:border-neutral-600 hover:bg-neutral-900/40",
        )}
      >
        {previewUrl ? (
          <div className="flex flex-col items-center gap-3">
            <img
              src={previewUrl}
              alt={file?.name ?? "Preview"}
              className="max-h-48 rounded-md border border-neutral-800 object-contain"
            />
            <p className="text-xs text-neutral-400">
              {file?.name} · click to replace
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-neutral-400">
            <Upload className="size-6 text-neutral-500" />
            <p className="text-sm text-neutral-300">{label}</p>
            <p className="text-[11px] text-neutral-500">
              Accepts {accept === "image/png" ? "PNG only" : "any image"}
            </p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            // Reset so picking the same file again still fires onChange.
            e.target.value = "";
          }}
        />
      </button>
      {hint ? (
        <p
          className={cn(
            "text-[11px] leading-relaxed",
            error ? "text-amber-300" : "text-neutral-500",
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}
