"""End-to-end WAV-in-PNG encryption and steganography workflows."""

from collections.abc import Buffer
from dataclasses import dataclass
from io import BytesIO
from time import perf_counter
import wave

from PIL import Image, UnidentifiedImageError

from backend.app.core.crypto import decrypt, decrypt_timed, encrypt, encrypt_timed
from backend.app.stego.lsb import extract_lsb, embed_lsb
from backend.app.stego.png_chunk import embed_payload, extract_payload

SUPPORTED_METHODS = frozenset(("chunk", "lsb"))


class WorkflowError(ValueError):
    """Base class for invalid workflow inputs or recovered data."""


class UnsupportedMethodError(WorkflowError):
    """Raised when a workflow method is not supported."""


class InvalidWAVError(WorkflowError):
    """Raised when input or recovered bytes are not a valid WAV file."""


class InvalidPNGError(WorkflowError):
    """Raised when a PNG cannot be decoded or validated."""


@dataclass(frozen=True, slots=True)
class WorkflowResult:
    """Binary workflow output plus measured backend stages and metadata."""

    data: bytes
    timings: dict[str, float]
    metadata: dict[str, object]


def _require_method(method: str) -> str:
    if not isinstance(method, str):
        raise TypeError("method must be a string")
    if method not in SUPPORTED_METHODS:
        raise UnsupportedMethodError(
            f"unsupported method {method!r}; expected 'chunk' or 'lsb'"
        )
    return method


def _require_bytes(value: Buffer, name: str) -> bytes:
    if not isinstance(value, Buffer):
        raise TypeError(f"{name} must be bytes-like")
    return bytes(value)


def _validate_wav(data: bytes) -> None:
    if not data:
        raise InvalidWAVError("WAV data must not be empty")
    try:
        with wave.open(BytesIO(data), "rb") as audio:
            frame_count = audio.getnframes()
            channel_count = audio.getnchannels()
            sample_width = audio.getsampwidth()
            if (
                channel_count <= 0
                or sample_width <= 0
                or frame_count <= 0
                or audio.getcomptype() != "NONE"
            ):
                raise InvalidWAVError("WAV must contain uncompressed PCM audio frames")
            frame_data = audio.readframes(frame_count)
            expected_length = frame_count * channel_count * sample_width
            if len(frame_data) != expected_length:
                raise InvalidWAVError("WAV frame data length is inconsistent")
    except (InvalidWAVError, wave.Error, EOFError) as error:
        if isinstance(error, InvalidWAVError):
            raise
        raise InvalidWAVError("invalid WAV data") from error


def _validate_png(png: bytes) -> None:
    try:
        _validate_png_with_pillow(png)
    except (ValueError, SyntaxError, UnidentifiedImageError, OSError) as error:
        raise InvalidPNGError("invalid PNG data") from error


def _validate_png_with_pillow(png: bytes) -> None:
    with Image.open(BytesIO(png)) as image:
        if image.format != "PNG":
            raise InvalidPNGError("input must be a PNG image")
        image.verify()


def hide_wav_in_png(
    wav_data: Buffer,
    png: Buffer,
    password: str,
    method: str,
) -> bytes:
    """Encrypt WAV bytes and embed the authenticated envelope in a PNG."""
    return hide_wav_in_png_timed(wav_data, png, password, method).data


def hide_wav_in_png_timed(
    wav_data: Buffer,
    png: Buffer,
    password: str,
    method: str,
) -> WorkflowResult:
    """Run hide workflow once and return output with measured backend stages."""
    total_started = perf_counter()
    selected_method = _require_method(method)
    raw_wav = _require_bytes(wav_data, "wav_data")
    raw_png = _require_bytes(png, "png")
    validation_started = perf_counter()
    _validate_wav(raw_wav)
    _validate_png(raw_png)
    validation_ms = (perf_counter() - validation_started) * 1000

    encrypted, scrypt_ms, aes_ms = encrypt_timed(raw_wav, password)
    embedding_started = perf_counter()
    if selected_method == "chunk":
        stego_png = embed_payload(raw_png, encrypted)
    else:
        try:
            with Image.open(BytesIO(raw_png)) as image:
                embedded = embed_lsb(image, encrypted)
                output = BytesIO()
                embedded.save(output, format="PNG")
                stego_png = output.getvalue()
        except OSError as error:
            raise InvalidPNGError("PNG cannot store the encrypted WAV envelope") from error
    embedding_ms = (perf_counter() - embedding_started) * 1000
    with Image.open(BytesIO(raw_png)) as image:
        width, height = image.size
    return WorkflowResult(
        stego_png,
        {
            "file_validation_ms": validation_ms,
            "scrypt_key_derivation_ms": scrypt_ms,
            "aes_gcm_encryption_ms": aes_ms,
            "payload_embedding_ms": embedding_ms,
            "backend_processing_ms": (perf_counter() - total_started) * 1000,
        },
        {
            "wav_size": len(raw_wav),
            "cover_image_size": len(raw_png),
            "stego_image_size": len(stego_png),
            "image_width": width,
            "image_height": height,
            "method": selected_method,
        },
    )


def recover_wav_from_png(png: Buffer, password: str, method: str) -> bytes:
    """Extract, authenticate, decrypt, and validate WAV bytes from a PNG."""
    return recover_wav_from_png_timed(png, password, method).data


def recover_wav_from_png_timed(
    png: Buffer, password: str, method: str
) -> WorkflowResult:
    """Run recovery once and return WAV bytes with measured backend stages."""
    total_started = perf_counter()
    selected_method = _require_method(method)
    raw_png = _require_bytes(png, "png")
    validation_started = perf_counter()
    _validate_png(raw_png)
    png_validation_ms = (perf_counter() - validation_started) * 1000

    extraction_started = perf_counter()
    encrypted = (
        extract_payload(raw_png)
        if selected_method == "chunk"
        else extract_lsb(raw_png)
    )
    extraction_ms = (perf_counter() - extraction_started) * 1000
    recovered, scrypt_ms, decrypt_ms = decrypt_timed(encrypted, password)
    wav_validation_started = perf_counter()
    _validate_wav(recovered)
    wav_validation_ms = (perf_counter() - wav_validation_started) * 1000
    with Image.open(BytesIO(raw_png)) as image:
        width, height = image.size
    return WorkflowResult(
        recovered,
        {
            "png_validation_ms": png_validation_ms,
            "payload_extraction_ms": extraction_ms,
            "scrypt_key_derivation_ms": scrypt_ms,
            "aes_gcm_decryption_ms": decrypt_ms,
            "wav_validation_ms": wav_validation_ms,
            "backend_processing_ms": (perf_counter() - total_started) * 1000,
        },
        {
            "stego_image_size": len(raw_png),
            "image_width": width,
            "image_height": height,
            "method": selected_method,
        },
    )
