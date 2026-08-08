"""Tests for the pose math — the one place in this codebase with nontrivial
linear algebra and no coverage (finding #4).

Covers:
  * transformation_matrix_to_euler: identity, pure yaw/pitch/roll, round-trip.
  * pose_vector_to_tha3: clamping, key mapping, missing-key defaults,
    symmetric blink, gaze sign conventions, smile/frown split.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from models import PoseVector, HeadPose, EyeState, MouthState
from pipeline.pose import (
    pose_vector_to_tha3,
    transformation_matrix_to_euler,
)
from backends import THA3_POSE_KEYS


# --------------------------------------------------------------------------- euler
def _rot_matrix(yaw: float, pitch: float, roll: float) -> np.ndarray:
    """Build a 4x4 facial transformation matrix from euler angles (radians).

    Convention must match transformation_matrix_to_euler, which decomposes
    R = Rz(yaw) @ Ry(pitch) @ Rx(roll)  (the ZYX/Tait-Bryan convention
    MediaPipe's facialTransformationMatrixes uses).
    """
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    cr, sr = math.cos(roll), math.sin(roll)
    rz = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]])
    ry = np.array([[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]])
    rx = np.array([[1, 0, 0], [0, cr, -sr], [0, sr, cr]])
    r3 = rz @ ry @ rx
    m = np.eye(4)
    m[:3, :3] = r3
    return m


def test_euler_identity():
    m = np.eye(4)
    yaw, pitch, roll = transformation_matrix_to_euler(m)
    assert yaw == pytest.approx(0, abs=1e-9)
    assert pitch == pytest.approx(0, abs=1e-9)
    assert roll == pytest.approx(0, abs=1e-9)


@pytest.mark.parametrize("yaw,pitch,roll", [
    (0.3, 0.0, 0.0),
    (0.0, 0.25, 0.0),
    (0.0, 0.0, -0.2),
    (0.2, 0.15, 0.1),
    (-0.4, -0.1, 0.3),
])
def test_euler_round_trip(yaw, pitch, roll):
    m = _rot_matrix(yaw, pitch, roll)
    y, p, r = transformation_matrix_to_euler(m)
    assert y == pytest.approx(yaw, abs=1e-4)
    assert p == pytest.approx(pitch, abs=1e-4)
    assert r == pytest.approx(roll, abs=1e-4)


def test_euler_accepts_flat_array():
    # MediaPipe hands back a flat 16-element list; ensure reshape works.
    flat = np.eye(4).flatten().tolist()
    y, p, r = transformation_matrix_to_euler(np.array(flat))
    assert (y, p, r) == (0, 0, 0)


# --------------------------------------------------------------------------- pose vector mapping
def _pose(**kw) -> PoseVector:
    head = HeadPose(yaw=kw.get("yaw", 0), pitch=kw.get("pitch", 0), roll=kw.get("roll", 0))
    le = EyeState(blink=kw.get("lb", 0), pupil_x=kw.get("lpx", 0))
    re = EyeState(blink=kw.get("rb", 0), pupil_x=kw.get("rpx", 0))
    mouth = MouthState(open=kw.get("mo", 0), smile=kw.get("sm", 0), pucker=kw.get("pu", 0))
    return PoseVector(
        ts_ms=0, head=head, left_eye=le, right_eye=re, mouth=mouth,
        left_brow=kw.get("lbrow", 0), right_brow=kw.get("rbrow", 0),
    )


def test_pose_mapping_only_returns_known_keys():
    d = pose_vector_to_tha3(_pose())
    assert set(d.keys()) == set(THA3_POSE_KEYS)


def test_pose_mapping_neutral_defaults_to_zero():
    d = pose_vector_to_tha3(_pose())
    for k in THA3_POSE_KEYS:
        assert d[k] == 0.0, f"{k} should default to 0 for a neutral pose"


def test_pose_mapping_blink_symmetric():
    d = pose_vector_to_tha3(_pose(lb=1.0, rb=1.0))
    assert d["eye_blink_left"] == 1.0
    assert d["eye_blink_right"] == 1.0


def test_pose_mapping_blink_clamped_to_unit():
    d = pose_vector_to_tha3(_pose(lb=5.0))
    assert d["eye_blink_left"] == 1.0  # clamped, not 5.0


def test_pose_mapping_gaze_sign_convention():
    # pupil_x > 0 = look right.
    # Left eye: looking right = toward the nose = look_IN_left.
    # Right eye: looking right = away from the nose = look_OUT_right.
    d = pose_vector_to_tha3(_pose(lpx=0.5, rpx=0.5))
    assert d["eye_look_in_left"] == 0.5
    assert d["eye_look_out_left"] == 0.0
    assert d["eye_look_out_right"] == 0.5
    assert d["eye_look_in_right"] == 0.0


def test_pose_mapping_smile_frown_split():
    d = pose_vector_to_tha3(_pose(sm=0.7))
    assert d["mouth_smile"] == 0.7
    assert d["mouth_frown"] == 0.0
    d2 = pose_vector_to_tha3(_pose(sm=-0.4))
    assert d2["mouth_smile"] == 0.0
    assert d2["mouth_frown"] == 0.4


def test_pose_mapping_brow_up_down_split():
    d = pose_vector_to_tha3(_pose(lbrow=0.6, rbrow=-0.3))
    assert d["eyebrow_up_left"] == 0.6
    assert d["eyebrow_down_left"] == 0.0
    assert d["eyebrow_up_right"] == 0.0
    assert d["eyebrow_down_right"] == 0.3


def test_pose_mapping_head_rotation_passes_through():
    d = pose_vector_to_tha3(_pose(yaw=0.2, pitch=-0.15, roll=0.05))
    assert d["head_yaw"] == 0.2
    assert d["head_pitch"] == -0.15
    assert d["head_roll"] == 0.05
