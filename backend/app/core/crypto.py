"""Password-based AES-256-GCM encryption for the project envelope."""

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
import secrets
from time import perf_counter

from .envelope import (
    NONCE_LENGTH,
    SALT_LENGTH,
    TAG_LENGTH,
    build_header,
    parse_envelope,
)
from .validation import require_bytes, require_password

DEFAULT_SCRYPT_LOG_N = 16
DEFAULT_SCRYPT_R = 8
DEFAULT_SCRYPT_P = 1


class AuthenticationError(ValueError):
    """Raised when a password or authenticated payload is invalid."""


def _derive_key_timed(
    password: str, salt: bytes, log_n: int, r: int, p: int
) -> tuple[bytes, float]:
    started = perf_counter()
    key = _derive_key(password, salt, log_n, r, p)
    return key, (perf_counter() - started) * 1000


def _derive_key(password: str, salt: bytes, log_n: int, r: int, p: int) -> bytes:
    """Derive a 256-bit key with the Scrypt parameters stored in the envelope."""
    return Scrypt(
        salt=salt,
        length=32,
        n=1 << log_n,
        r=r,
        p=p,
    ).derive(password.encode("utf-8"))


def encrypt(
    payload: bytes | bytearray | memoryview,
    password: str,
    *,
    log_n: int = DEFAULT_SCRYPT_LOG_N,
    r: int = DEFAULT_SCRYPT_R,
    p: int = DEFAULT_SCRYPT_P,
) -> bytes:
    """Encrypt *payload* and return a self-contained authenticated envelope."""
    plaintext = require_bytes(payload, "payload")
    require_password(password)
    salt = secrets.token_bytes(SALT_LENGTH)
    nonce = secrets.token_bytes(NONCE_LENGTH)
    key = _derive_key(password, salt, log_n, r, p)
    header = build_header(log_n, r, p, len(plaintext))
    encrypted = AESGCM(key).encrypt(nonce, plaintext, header)
    return header + salt + nonce + encrypted[:-TAG_LENGTH] + encrypted[-TAG_LENGTH:]


def encrypt_timed(
    payload: bytes | bytearray | memoryview,
    password: str,
    *,
    log_n: int = DEFAULT_SCRYPT_LOG_N,
    r: int = DEFAULT_SCRYPT_R,
    p: int = DEFAULT_SCRYPT_P,
) -> tuple[bytes, float, float]:
    """Encrypt a payload and return envelope, Scrypt time, and AES-GCM time."""
    plaintext = require_bytes(payload, "payload")
    require_password(password)
    salt = secrets.token_bytes(SALT_LENGTH)
    nonce = secrets.token_bytes(NONCE_LENGTH)
    key, scrypt_ms = _derive_key_timed(password, salt, log_n, r, p)
    header = build_header(log_n, r, p, len(plaintext))
    started = perf_counter()
    encrypted = AESGCM(key).encrypt(nonce, plaintext, header)
    aes_ms = (perf_counter() - started) * 1000
    return (
        header + salt + nonce + encrypted[:-TAG_LENGTH] + encrypted[-TAG_LENGTH:],
        scrypt_ms,
        aes_ms,
    )


def decrypt(envelope: bytes | bytearray | memoryview, password: str) -> bytes:
    """Authenticate and decrypt an envelope, raising on any authentication failure."""
    require_password(password)
    parsed = parse_envelope(require_bytes(envelope, "envelope"))
    key = _derive_key(password, parsed.salt, parsed.log_n, parsed.r, parsed.p)
    try:
        return AESGCM(key).decrypt(
            parsed.nonce,
            parsed.ciphertext + parsed.tag,
            parsed.header,
        )
    except InvalidTag as exc:
        raise AuthenticationError("invalid password or tampered encrypted payload") from exc


def decrypt_timed(
    envelope: bytes | bytearray | memoryview, password: str
) -> tuple[bytes, float, float]:
    """Decrypt a payload and return plaintext, Scrypt time, and AES-GCM time."""
    require_password(password)
    parsed = parse_envelope(require_bytes(envelope, "envelope"))
    key, scrypt_ms = _derive_key_timed(
        password, parsed.salt, parsed.log_n, parsed.r, parsed.p
    )
    started = perf_counter()
    try:
        plaintext = AESGCM(key).decrypt(
            parsed.nonce,
            parsed.ciphertext + parsed.tag,
            parsed.header,
        )
    except InvalidTag as exc:
        raise AuthenticationError("invalid password or tampered encrypted payload") from exc
    return plaintext, scrypt_ms, (perf_counter() - started) * 1000
