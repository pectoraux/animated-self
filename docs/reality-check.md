# Reality check — where open-source models can't hit the stated bar today

The spec asks for honest flagging rather than optimistic answers. These are the
places the design has to bend around what the model landscape actually supports.

## 1. No real-time *full-body* neural reenactment — out of scope, and not close
THA3 and its peers drive **head + shoulders only**. Full-body pose-driven
anime synthesis at 30fps does not exist in open source at usable quality
(AnimateDiff / ControlNet video are seconds-per-frame, not real-time). The spec
correctly scopes this out for v1. Live full-body would require a fundamentally
different (and much heavier) pipeline.

## 2. THA3 live needs a discrete GPU — integrated graphics miss the budget
On an RTX 3060+ the THA3 forward pass is ~20–35ms. On CPU it is ~200ms+
(unusable). The <100ms glass-to-glass target is **only achievable on a CUDA
GPU**. We surface this to the user via `/api/health` → `capabilities.cuda` and
the control panel must refuse live mode (offering async quality mode instead)
when CUDA is absent.

## 3. Audio-driven *live* anime lip-sync is not real-time in open source
SadTalker / Wav2Lip approach real-time on strong GPUs but (a) are not
anime-native and (b) quality is below THA3. No open model does sub-100ms
audio→anime-frame. **Therefore v1 live is video-driven (pose from webcam);
audio-driven is async-only (Phase 3 diffusion).** The `PoseVector` carries an
optional `audio_level` hook for Phase 4 voice conversion, but no per-frame
audio→frame model runs live.

## 4. Diffusion anime reenactment is NOT interactive speed — that's why it's async
AniPortrait / EchoMimic / SadTalker-v2 produce minutes of compute per second of
output. Anyone claiming real-time diffusion anime reenactment is either using a
heavily distilled model with poor quality or is misrepresenting throughput.
Phase 3 is explicitly **offline**. We never route it through the live WS.

## 5. THA3 degrades outside training distribution
Large head yaw/pitch (>~0.5 rad), hands entering frame, extreme expressions
produce artifacts. Live mode will show these on wild movement; the async
diffusion path is the quality escape hatch for recorded content. The pose
mapper clamps to sane ranges but cannot fully prevent this.

## 6. Cross-platform virtual camera without a driver install is impossible
- Windows / macOS: requires OBS Studio installed (provides "OBS Virtual Camera").
- Linux: requires `v4l2loopback` kernel module (`modprobe v4l2loopback`).
`pyvirtualcam` is the bridge but it does not ship the driver. The app must
document/bundle these; there is no pure-software workaround.

## 7. Consent/liveness is a deterrent + audit trail, not a cryptographic proof
Liveness (randomized motion challenge) defeats static-photo spoofing. Binding
the consent token to a face embedding (Phase 2) defeats casual "drive someone
else's avatar." It does **not** defeat a determined adversary who deepfakes a
real-time selfie back at the liveness check. We pair it with abuse reporting
(Phase 5) and never claim it is unbreakable. This is the honest framing —
overselling it would be irresponsible for a deepfake-adjacent tool.

## 8. BYOK means the app cannot guarantee character-generation quality
LLM/image-gen calls are user-supplied keys. The app never bills or rate-limits
them. This means generation latency/quality vary per user and the app can't
SLA the experience. This is an explicit trade for the "never holds model usage"
constraint.
