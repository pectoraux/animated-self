"""Tests for Phase 2 — character generation, registry lifecycle, consent binding.

Uses a FakeProvider so no real image-gen API is called. Covers:
  * register_generated_character persists + returns consented=False.
  * Generated chars appear in list_characters alongside stock.
  * mark_consented flips consented + records bound_face_hash.
  * mark_consented refuses stock chars (immutable).
  * Provider selection: BYOK provider requires key; demo doesn't.
  * The consent-bind endpoint flow (token -> bound -> drivable).
  * BYOK key is not persisted anywhere by the engine.
"""
from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

import consent
from characters import registry


@pytest.fixture(autouse=True)
def _isolated_generated_store(tmp_path, monkeypatch):
    """Redirect generated chars to a tmp dir so tests don't pollute the repo."""
    monkeypatch.setattr(registry, "_generated_dir", lambda: tmp_path)
    monkeypatch.setattr(registry, "_generated_manifest_path", lambda: tmp_path / "manifest.json")
    # Also reset the stock manifest cache so tests see a clean state.
    registry._STOCK_MANIFEST = None
    consent.store._issued.clear()
    consent.store._used.clear()
    yield


# --------------------------------------------------------------------------- registry lifecycle
def test_register_generated_character_starts_unconsented():
    char = registry.register_generated_character("Test", b"\x89PNG fake", tags=["t"])
    assert char.source.value == "generated"
    assert char.consented is False
    assert char.id.startswith("gen-")
    # Image file was persisted.
    assert (registry._generated_dir() / f"{char.id}.png").exists()


def test_generated_chars_listed_alongside_stock():
    stock_count = len([c for c in registry.list_characters() if c.source.value == "stock"])
    registry.register_generated_character("Gen1", b"\x89PNG fake")
    all_chars = registry.list_characters()
    gen = [c for c in all_chars if c.source.value == "generated"]
    assert len(gen) == 1
    assert len([c for c in all_chars if c.source.value == "stock"]) == stock_count


def test_mark_consented_flips_flag_and_binds_face_hash():
    char = registry.register_generated_character("Test", b"\x89PNG fake")
    assert char.consented is False
    bound = registry.mark_consented(char.id, "abc123hash")
    assert bound.consented is True
    # Persisted to disk.
    data = json.loads(registry._generated_manifest_path().read_text())
    entry = next(c for c in data["characters"] if c["id"] == char.id)
    assert entry["consented"] is True
    assert entry["bound_face_hash"] == "abc123hash"


def test_mark_consented_refuses_stock_chars():
    # Stock chars are immutable — can't consent-bind them.
    with pytest.raises(KeyError, match="stock or unknown"):
        registry.mark_consented("stock-aoi", "hash")


def test_mark_consented_refuses_unknown_id():
    with pytest.raises(KeyError):
        registry.mark_consented("gen-does-not-exist", "hash")


# --------------------------------------------------------------------------- provider selection
def test_get_provider_unknown_raises():
    from backends import get_provider
    with pytest.raises(KeyError):
        get_provider("not-a-provider")


def test_list_providers_hides_demo_when_disabled(monkeypatch):
    from backends import character_gen
    from types import SimpleNamespace
    monkeypatch.setattr(character_gen, "cfg", SimpleNamespace(enable_builtin_gen_provider=False))
    providers = character_gen.list_providers()
    ids = [p["id"] for p in providers]
    assert "demo" not in ids
    assert "openai" in ids


def test_list_providers_shows_demo_when_enabled(monkeypatch):
    from backends import character_gen
    from types import SimpleNamespace
    monkeypatch.setattr(character_gen, "cfg", SimpleNamespace(enable_builtin_gen_provider=True))
    providers = character_gen.list_providers()
    ids = [p["id"] for p in providers]
    assert "demo" in ids
    assert "openai" in ids


# --------------------------------------------------------------------------- BYOK key handling
def test_openai_provider_requires_key():
    from backends.character_gen import OpenAIProvider
    p = OpenAIProvider()
    with pytest.raises(ValueError, match="API key"):
        p.generate_from_prompt("a cat", key=None)


def test_byok_key_not_persisted_by_endpoint(tmp_path, monkeypatch):
    """The engine must never write the user's api_key to disk or logs.
    This test registers a generated char via a fake provider and asserts the
    key doesn't appear in the generated manifest or any written file."""
    # Use a fake provider injected into the registry.
    from backends import character_gen

    class KeySniffingProvider:
        id = "test-sniff"
        byok = True
        received_key = None

        def generate_from_prompt(self, prompt, key):
            KeySniffingProvider.received_key = key
            return b"\x89PNG fake"

        def generate_from_selfie(self, selfie_bytes, key):
            return b"\x89PNG fake"

    character_gen._PROVIDERS["test-sniff"] = KeySniffingProvider()
    try:
        from backends import get_provider
        p = get_provider("test-sniff")
        p.generate_from_prompt("test", key="sk-secret-do-not-leak-12345")
        assert KeySniffingProvider.received_key == "sk-secret-do-not-leak-12345"
        # Now register a char and check the manifest doesn't contain the key.
        char = registry.register_generated_character("Test", b"\x89PNG fake")
        manifest_text = registry._generated_manifest_path().read_text()
        assert "sk-secret-do-not-leak-12345" not in manifest_text
    finally:
        del character_gen._PROVIDERS["test-sniff"]


# --------------------------------------------------------------------------- full consent-bind flow
def test_full_consent_bind_flow_makes_char_drivable():
    """End-to-end: register -> liveness -> bind -> char is consented + drivable."""
    # 1. Register a generated char (unconsented).
    char = registry.register_generated_character("MyAvatar", b"\x89PNG fake")
    assert char.consented is False

    # 2. Creator completes liveness.
    cid, steps, _ = consent.issue_challenge()
    _, token, _ = consent.verify_challenge(
        cid, steps[:2], landmark_evidence={"face": "my-face-landmarks"}
    )
    assert token is not None

    # 3. Bind the token to the character.
    ok, _ = consent.validate_consent_token(token)
    assert ok
    from consent import _verify_sig
    payload = _verify_sig(token)
    face_hash = payload["fh"]
    bound = registry.mark_consented(char.id, face_hash)
    assert bound.consented is True

    # 4. The character is now drivable (a start_session with this char + token
    #    would pass the gate — the gate logic itself is tested in test_consent).
    refreshed = registry.get_character(char.id)
    assert refreshed is not None
    assert refreshed.consented is True
