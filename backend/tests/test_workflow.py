from io import BytesIO
import struct
import wave

import pytest
from PIL import Image

from backend.app.core.crypto import AuthenticationError, encrypt
from backend.app.core.envelope import EnvelopeError, parse_envelope
from backend.app.services.workflow import (
    InvalidPNGError,
    InvalidWAVError,
    UnsupportedMethodError,
    hide_wav_in_png,
    recover_wav_from_png,
)
from backend.app.stego.lsb import CapacityError
from backend.app.stego.png_chunk import embed_payload
from backend.app.utils.hashing import sha256_hex
from backend.app.utils.pixel_analysis import compare_png_pixels


PASSWORD = "workflow password"


def _wav() -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b"\x00\x00\x10\x00\x20\x00\x30\x00")
    return output.getvalue()


def _png(size: tuple[int, int] = (256, 256)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, (40, 80, 120)).save(output, format="PNG")
    return output.getvalue()


@pytest.mark.parametrize("method", ["chunk", "lsb"])
def test_wav_round_trip_preserves_bytes_and_hash(method: str) -> None:
    original = _wav()
    embedded = hide_wav_in_png(original, _png(), PASSWORD, method)
    recovered = recover_wav_from_png(embedded, PASSWORD, method)
    assert recovered == original
    assert sha256_hex(recovered) == sha256_hex(original)


@pytest.mark.parametrize("method", ["chunk", "lsb"])
def test_encoded_image_pixel_analysis_matches_real_pixels(method: str) -> None:
    cover = _png()
    stego = hide_wav_in_png(_wav(), cover, PASSWORD, method)
    result = compare_png_pixels(cover, stego, region_x=8, region_y=9, region_size=8)

    with Image.open(BytesIO(cover)) as original_image:
        original_pixels = original_image.convert("RGBA").tobytes()
    with Image.open(BytesIO(stego)) as stego_image:
        stego_pixels = stego_image.convert("RGBA").tobytes()

    expected_map = []
    expected_changed_pixels = 0
    expected_changed_channels = 0
    for y in range(256):
        row = []
        for x in range(256):
            offset = (y * 256 + x) * 4
            differences = [abs(original_pixels[offset + channel] - stego_pixels[offset + channel]) for channel in range(3)]
            expected_changed_pixels += any(differences)
            expected_changed_channels += sum(difference > 0 for difference in differences)
            row.append(max(differences))
        expected_map.append(row)

    assert result["dimensions_match"] is True
    assert result["original_pixel_sha256"] == result["stego_pixel_sha256"] if method == "chunk" else result["original_pixel_sha256"] != result["stego_pixel_sha256"]
    assert result["changed_pixel_count"] == expected_changed_pixels
    assert result["changed_channel_count"] == expected_changed_channels
    assert result["difference_map"]["values"] == expected_map
    assert result["region"]["x"] == 8
    assert result["region"]["y"] == 9
    assert result["region"]["size"] == 8

    if method == "chunk":
        assert result["pixel_equal"] is True
        assert result["changed_pixel_count"] == 0
        assert max(map(max, result["difference_map"]["values"])) == 0
    else:
        assert result["pixel_equal"] is False
        assert expected_changed_pixels > 0
        assert result["max_channel_difference"] == 1


def test_invalid_wav_and_png_are_rejected() -> None:
    with pytest.raises(InvalidWAVError):
        hide_wav_in_png(b"", _png(), PASSWORD, "chunk")
    with pytest.raises(InvalidWAVError):
        hide_wav_in_png(b"not wav", _png(), PASSWORD, "chunk")
    with pytest.raises(InvalidPNGError):
        hide_wav_in_png(_wav(), b"not png", PASSWORD, "chunk")
    with pytest.raises(InvalidPNGError):
        recover_wav_from_png(b"not png", PASSWORD, "chunk")


def test_wav_with_short_declared_data_chunk_is_rejected() -> None:
    malformed = bytearray(_wav())
    data_offset = malformed.index(b"data")
    struct.pack_into("<I", malformed, data_offset + 4, 12)
    with pytest.raises(InvalidWAVError):
        hide_wav_in_png(malformed, _png(), PASSWORD, "chunk")


@pytest.mark.parametrize("method", ["chunk", "lsb"])
def test_wrong_password_does_not_return_audio(method: str) -> None:
    embedded = hide_wav_in_png(_wav(), _png(), PASSWORD, method)
    with pytest.raises(AuthenticationError):
        recover_wav_from_png(embedded, "wrong password", method)


def test_malformed_and_tampered_envelopes_fail_safely() -> None:
    malformed = embed_payload(_png(), b"not an envelope")
    with pytest.raises(EnvelopeError):
        recover_wav_from_png(malformed, PASSWORD, "chunk")

    encrypted = encrypt(_wav(), PASSWORD)
    parsed = parse_envelope(encrypted)
    ciphertext_offset = len(parsed.header) + len(parsed.salt) + len(parsed.nonce)
    tampered = bytearray(encrypted)
    tampered[ciphertext_offset] ^= 1
    tampered_png = embed_payload(_png(), tampered)
    with pytest.raises(AuthenticationError):
        recover_wav_from_png(tampered_png, PASSWORD, "chunk")


def test_lsb_insufficient_capacity_is_clear() -> None:
    with pytest.raises(CapacityError):
        hide_wav_in_png(_wav(), _png((8, 8)), PASSWORD, "lsb")


def test_unsupported_method_is_rejected() -> None:
    with pytest.raises(UnsupportedMethodError):
        hide_wav_in_png(_wav(), _png(), PASSWORD, "unknown")
    with pytest.raises(UnsupportedMethodError):
        recover_wav_from_png(_png(), PASSWORD, "unknown")
