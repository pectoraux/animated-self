// TypeScript mirror of engine/models.py — the shared API contract.
// Source of truth is engine/models.py (Pydantic). Keep this in sync.
//
// The capture layer (Next.js control panel) imports these types; the inference
// layer (Python engine) exports the same shapes over the wire. Adding a phase
// (custom chars, voice, diffusion) MUST be additive here so Phase 1 clients
// keep working.

export type CharacterSource = "stock" | "generated" | "uploaded";

export interface Character {
  id: string;
  name: string;
  source: CharacterSource;
  thumbnail_url: string;
  consented: boolean;
  tags: string[];
}

// --- Live path: the per-frame wire message -------------------------------

export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface EyeState {
  blink: number; // [0,1]
  pupil_x: number; // [-1,1]
  pupil_y: number; // [-1,1]
}

export interface MouthState {
  open: number; // [0,1]
  smile: number; // [-1,1]
  pucker: number; // [0,1]
}

export interface PoseVector {
  ts_ms: number;
  head: HeadPose;
  left_eye: EyeState;
  right_eye: EyeState;
  mouth: MouthState;
  left_brow: number;
  right_brow: number;
  audio_level?: number | null; // Phase 4 hook
}

// --- Session -------------------------------------------------------------

export type OutputSink = "virtual_cam" | "preview" | "file";

export interface StartSessionRequest {
  character_id: string;
  output: OutputSink;
  consent_token?: string | null;
}

export interface StartSessionResponse {
  session_id: string;
  ws_url: string;
  character: Character;
  output: OutputSink;
  capabilities: Record<string, boolean>;
}

export interface FrameStats {
  type: "stats";
  fps_in: number;
  fps_out: number;
  infer_ms: number;
  queue_depth: number;
  dropped_stale: number;
  budget_warning: boolean;
}

// --- Async render (Phase 3 contract) -------------------------------------

export type RenderDriverType = "audio" | "video";

export interface RenderRequest {
  character_id: string;
  driver: RenderDriverType;
  driver_url: string;
  quality: "draft" | "high";
  consent_token?: string | null;
}

export type RenderJobStatus = "queued" | "running" | "rendering" | "done" | "failed";

export interface RenderJob {
  job_id: string;
  status: RenderJobStatus;
  /** 0..1 — server-side progress fraction. Multiply by 100 for a percentage bar. */
  progress: number;
  download_url?: string | null;
  error?: string | null;
}

// --- Consent / liveness --------------------------------------------------

export interface LivenessChallenge {
  challenge_id: string;
  steps: string[];
  issued_at: number;
}

export interface LivenessResult {
  challenge_id: string;
  passed: boolean;
  consent_token: string;
  reason?: string | null;
}

// Client payload for /api/consent/liveness/verify.
export interface LivenessVerifyRequest {
  challenge_id: string;
  detected_steps: string[];
  landmark_evidence: Record<string, unknown> | unknown[];
}

// --- Phase 2 — character generation (BYOK) -------------------------------

export interface GenProviderInfo {
  id: string;
  byok: boolean;
  requires_key: boolean;
  label: string;
}

export interface GenerateCharacterRequest {
  prompt: string;
  name: string;
  provider: string;
  api_key?: string | null;
}

export interface TransferCharacterRequest {
  selfie_b64: string;
  name: string;
  provider: string;
  api_key?: string | null;
}

export interface UploadCharacterRequest {
  name: string;
  image_b64: string;
}

export interface ConsentBindRequest {
  character_id: string;
  consent_token: string;
}

// --- Engine helpers ------------------------------------------------------

export const ENGINE_PORT = 3031;

/** Build a gateway-safe URL for an engine REST endpoint. */
export function engineUrl(path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}XTransformPort=${ENGINE_PORT}`;
}

/** Phase 3 — poll URL for a render job's status. */
export function renderJobUrl(jobId: string): string {
  return engineUrl(`/api/render/${encodeURIComponent(jobId)}`);
}

/** Phase 3 — download URL for a finished render job's MP4. */
export function renderDownloadUrl(jobId: string): string {
  return engineUrl(`/api/render/${encodeURIComponent(jobId)}/file`);
}

// --- Phase 4 — voice conversion (async, file-in file-out) ----------------

/**
 * Phase 4 — convert a creator's mic audio to the avatar's voice.
 *
 * Async: file in (base64-encoded), file out (WAV download_url). The
 * consent gate applies for bound custom characters exactly like the live and
 * async render paths — converting audio to sound like someone's avatar is
 * identity-affecting.
 *
 * Mirrors engine/models.py:VoiceConvertRequest.
 */
export interface VoiceConvertRequest {
  character_id: string;
  /** Base64-encoded audio (raw base64 or data URI). */
  audio_b64: string;
  /** Required for bound custom characters; ignored for stock. */
  consent_token?: string | null;
  /**
   * BYOK cloud API key. Required when the engine's converter is a cloud
   * provider (VOICE_CLOUD_PROVIDER set, e.g. ElevenLabs); ignored by the
   * external-command converter (VOICE_CONVERT_CMD). Never persisted by the
   * engine.
   */
  api_key?: string | null;
}

/**
 * Phase 4 — result of /api/voice/convert.
 *
 * On ok=true, download_url points at GET /api/voice/{out_id}/download
 * (a WAV file, valid for the engine process's lifetime). On ok=false, error
 * carries the reason. Note the engine raises HTTPException (503 unconfigured,
 * 403 consent fail, 502 conversion fail) rather than returning ok=false in
 * the body — callers must read the HTTP status.
 *
 * Mirrors engine/models.py:VoiceConvertResult.
 */
export interface VoiceConvertResult {
  ok: boolean;
  download_url?: string | null;
  error?: string | null;
}

/** Phase 4 — POST target for /api/voice/convert. */
export function voiceConvertUrl(): string {
  return engineUrl("/api/voice/convert");
}

/**
 * Phase 4 — download URL for a converted WAV. The engine returns
 * `/api/voice/{out_id}/download` in the convert response; this wraps it
 * through the gateway with the engine port query.
 */
export function voiceDownloadUrl(outId: string): string {
  return engineUrl(`/api/voice/${encodeURIComponent(outId)}/download`);
}

/** Build the WebSocket URL the control panel uses for the live pose stream. */
export function engineWsUrl(sessionId: string): string {
  // Relative path + query; the gateway rewrites to the engine port.
  const proto = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${typeof window !== "undefined" ? window.location.host : ""}/ws/live?session_id=${sessionId}&XTransformPort=${ENGINE_PORT}`;
}
