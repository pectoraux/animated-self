"""MediaPipe landmarks -> THA3 pose dict.

In the LIVE path this mapping happens **in the browser** (MediaPipe Tasks JS),
which produces a `PoseVector` (see engine/models.py) sent over the WS. The
engine receives that `PoseVector` and this module converts it into the exact
parameter dict the THA3 `Poser` expects.

The same mapping is reused by the ASYNC render path (when we re-drive from a
recorded video file using MediaPipe Python) so live and async stay visually
consistent.

Reference blendshape names come from MediaPipe FaceLandmarker
(`output_blendshapes` + `facialTransformationMatrixes`).
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np

from models import PoseVector
from backends import THA3_POSE_KEYS


def _clamp(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, float(x)))


def transformation_matrix_to_euler(matrix: np.ndarray) -> tuple[float, float, float]:
    """4x4 facial transformation matrix -> (yaw, pitch, roll) in radians.

    MediaPipe gives a row-major 4x4; the upper-left 3x3 is the rotation.
    """
    m = np.asarray(matrix, dtype=np.float64).reshape(4, 4)
    r = m[:3, :3]
    # Decompose with a numerically stable method.
    pitch = math.asin(_clamp(-r[2, 0], -1, 1))
    if abs(math.cos(pitch)) > 1e-6:
        yaw = math.atan2(r[1, 0], r[0, 0])
        roll = math.atan2(r[2, 1], r[2, 2])
    else:
        yaw = math.atan2(-r[0, 1], r[1, 1])
        roll = 0.0
    return yaw, pitch, roll


def pose_vector_to_tha3(pose: PoseVector) -> dict[str, float]:
    """Convert a wire `PoseVector` into the THA3 parameter dict.

    THA3's convention (from the demo's poser params):
      * eye_blink_*: 0 = open, 1 = closed
      * eye_look_in/out_*: [-1, 1] gaze
      * mouth_open / mouth_smile / mouth_frown / mouth_pucker: [0,1] / [-1,1]
      * head_pitch/yaw/roll: radians, small range (~±0.5 rad is the safe zone;
        beyond that THA3 artifacts — see docs/reality-check.md)
    """
    yaw, pitch, roll = pose.head.yaw, pose.head.pitch, pose.head.roll

    # Pupil gaze: combine look-in/out into the two eyes (mirror appropriately).
    # MediaPipe's eyeLookInLeft means the eye looks toward the nose; we map
    # pupil_x>0 = look right.
    lx = _clamp(pose.left_eye.pupil_x)
    rx = _clamp(pose.right_eye.pupil_x)

    d: dict[str, float] = {
        "eye_blink_left": _clamp(pose.left_eye.blink, 0, 1),
        "eye_blink_right": _clamp(pose.right_eye.blink, 0, 1),
        # THA3 splits horizontal gaze into look_in / look_out per eye.
        "eye_look_in_left": max(0.0, lx),
        "eye_look_out_left": max(0.0, -lx),
        "eye_look_in_right": max(0.0, -rx),
        "eye_look_out_right": max(0.0, rx),
        "eye_dilation_left": _clamp(pose.left_eye.pupil_y, 0, 1),
        "eye_dilation_right": _clamp(pose.right_eye.pupil_y, 0, 1),
        # Brows: PoseVector gives a single signed value per brow; map to
        # THA3's up/down pair.
        "eyebrow_up_left": max(0.0, pose.left_brow),
        "eyebrow_down_left": max(0.0, -pose.left_brow),
        "eyebrow_up_right": max(0.0, pose.right_brow),
        "eyebrow_down_right": max(0.0, -pose.right_brow),
        "eyebrow_steep_left": 0.0,
        "eyebrow_steep_right": 0.0,
        # Mouth
        "mouth_open": _clamp(pose.mouth.open, 0, 1),
        "mouth_smile": max(0.0, pose.mouth.smile),
        "mouth_frown": max(0.0, -pose.mouth.smile),
        "mouth_pucker": _clamp(pose.mouth.pucker, 0, 1),
        "mouth_lower": 0.0,
        "mouth_upper": 0.0,
        # Head rotation. Note: large yaws/pitches degrade THA3 output.
        "head_pitch": float(pitch),
        "head_yaw": float(yaw),
        "head_roll": float(roll),
    }
    # Defensive: only keep keys the loaded model actually knows.
    return {k: d.get(k, 0.0) for k in THA3_POSE_KEYS}


def mediapipe_to_pose_vector(
    blendshapes: list[dict[str, float]],
    transformation_matrix: np.ndarray | None,
    ts_ms: int,
) -> PoseVector:
    """Build a PoseVector from raw MediaPipe output (used by the async path
    and the consent/liveness check; the live path builds PoseVector in-browser
    and never calls this).

    `blendshapes` is a list of {categoryName: score} dicts (52 ARKit shapes).
    """
    bs: dict[str, float] = {}
    for b in blendshapes:
        bs.update(b)

    def g(name: str) -> float:
        return float(bs.get(name, 0.0))

    yaw = pitch = roll = 0.0
    if transformation_matrix is not None:
        yaw, pitch, roll = transformation_matrix_to_euler(transformation_matrix)

    return PoseVector(
        ts_ms=ts_ms,
        head=__import__("models").HeadPose(yaw=yaw, pitch=pitch, roll=roll),
        left_eye=__import__("models").EyeState(
            blink=g("eyeBlinkLeft"),
            pupil_x=g("eyeLookOutLeft") - g("eyeLookInLeft"),
            pupil_y=0.0,
        ),
        right_eye=__import__("models").EyeState(
            blink=g("eyeBlinkRight"),
            pupil_x=g("eyeLookOutRight") - g("eyeLookInRight"),
            pupil_y=0.0,
        ),
        mouth=__import__("models").MouthState(
            open=g("jawOpen"),
            smile=g("mouthSmileLeft") + g("mouthSmileRight") - (g("mouthFrownLeft") + g("mouthFrownRight")),
            pucker=g("mouthPucker"),
        ),
        left_brow=g("browOuterUpLeft") - g("browDownLeft"),
        right_brow=g("browOuterUpRight") - g("browDownRight"),
    )
