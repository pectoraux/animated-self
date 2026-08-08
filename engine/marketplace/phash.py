"""Perceptual hash (pHash) for near-duplicate image detection.

Used by the marketplace review pipeline to flag listings whose character
image is a near-duplicate of an existing approved listing — the main
automated check for "someone re-uploaded someone else's character PNG."

What pHash catches: exact re-uploads, resized/recompressed copies, minor
edits (brightness, cropping). The DCT-based hash is robust to these because
it captures low-frequency structure.

What pHash does NOT catch (be honest about this):
  * Stylistic copies — different art of a similar-looking character.
  * Likeness-of-real-person detection — that needs a face-embedding model.
  * Proof of original authorship — that's an IP/DMCA problem.

The threshold (HAMMING_THRESHOLD) is tuned for low false negatives (flag
anything plausibly similar for human review) rather than low false positives
(auto-reject). False positives just cost a reviewer's attention; false
negatives let a copy through. See docs/reality-check.md #11.

Implementation: standard DCT-based pHash (resize to 32x32 grayscale, 2D DCT,
keep top-left 8x8 low-frequency block, threshold at the median). 64-bit hash.
No external dependency beyond Pillow + numpy.
"""
from __future__ import annotations

import hashlib
import io
from pathlib import Path

import numpy as np


HASH_BITS = 64  # 8x8 block
HAMMING_THRESHOLD = 10  # flag for review if Hamming distance <= this


def compute_phash(image_bytes: bytes) -> str:
    """Compute a 64-bit perceptual hash of an image (PNG/JPEG bytes).

    Returns a 16-char hex string.
    """
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes)).convert("L").resize((32, 32))
    arr = np.asarray(img, dtype=np.float64)
    dct = _dct2d(arr)
    # Top-left 8x8 block = lowest frequencies.
    block = dct[:8, :8].flatten()
    # Exclude the DC term (block[0]) — it's the overall brightness, not structure.
    vals = block[1:]
    median = np.median(vals)
    bits = (vals > median).astype(np.uint8)
    # Pack 63 bits into a hex string (pad to 64).
    h = 0
    for b in bits:
        h = (h << 1) | int(b)
    h = (h << 1)  # pad to 64 bits
    return format(h, "016x")


def hamming_distance(hash_a: str, hash_b: str) -> int:
    """Hamming distance between two hex pHash strings."""
    a = int(hash_a, 16)
    b = int(hash_b, 16)
    return bin(a ^ b).count("1")


def is_near_duplicate(hash_a: str, hash_b: str, threshold: int = HAMMING_THRESHOLD) -> bool:
    """True if two pHashes are within the near-duplicate threshold."""
    return hamming_distance(hash_a, hash_b) <= threshold


def _dct2d(matrix: np.ndarray) -> np.ndarray:
    """2D Discrete Cosine Transform (Type II) of a square matrix.

    Uses the separability of the DCT: apply 1D DCT to rows, then columns.
    No scipy dependency — just numpy.
    """
    n = matrix.shape[0]
    # Build the DCT basis matrix.
    k = np.arange(n).reshape(-1, 1)
    j = np.arange(n).reshape(1, -1)
    basis = np.cos(np.pi * (2 * j + 1) * k / (2 * n))
    basis[0, :] *= 1.0 / np.sqrt(2)
    basis *= np.sqrt(2.0 / n)
    # DCT = basis @ matrix @ basis.T
    return basis @ matrix @ basis.T
