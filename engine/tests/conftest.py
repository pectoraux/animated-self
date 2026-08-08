"""Pytest config — make `engine/` importable as a package root.

Tests import `from pipeline.pose import ...` etc., matching how app.py imports
them (engine/ is on sys.path at runtime). This conftest prepends the engine
dir so tests run from anywhere without installing the package.
"""
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent
if str(ENGINE) not in sys.path:
    sys.path.insert(0, str(ENGINE))
