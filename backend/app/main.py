"""FastAPI application for the audio-in-image steganography workflow."""

from collections.abc import Callable
import json
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from backend.app.core.crypto import AuthenticationError
from backend.app.core.envelope import EnvelopeError
from backend.app.services.workflow import (
    InvalidPNGError,
    InvalidWAVError,
    UnsupportedMethodError,
    hide_wav_in_png,
    recover_wav_from_png,
    hide_wav_in_png_timed,
    recover_wav_from_png_timed,
)
from backend.app.stego.lsb import LSBError
from backend.app.stego.png_chunk import PNGChunkError
from backend.app.utils.pixel_analysis import PixelAnalysisError, compare_png_pixels

app = FastAPI(
    title="Audio Image Steganography API",
    description="Encrypt WAV audio and hide it in PNG images.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://audio-image-steganography.vercel.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
    expose_headers=["Content-Disposition", "X-Workflow-Timings"],
)

Method = Literal["chunk", "lsb"]
WorkflowCallable = Callable[..., bytes]
MAX_WAV_UPLOAD_SIZE = 20 * 1024 * 1024
MAX_PNG_UPLOAD_SIZE = 20 * 1024 * 1024
UPLOAD_READ_CHUNK_SIZE = 1024 * 1024


async def _read_upload(
    upload: UploadFile,
    field_name: str,
    max_size: int,
) -> bytes:
    data = bytearray()
    try:
        while True:
            remaining = max_size - len(data)
            chunk = await upload.read(min(UPLOAD_READ_CHUNK_SIZE, remaining + 1))
            if not chunk:
                break
            data.extend(chunk)
            if len(data) > max_size:
                raise HTTPException(
                    status_code=413,
                    detail=f"{field_name} upload exceeds the {max_size} byte limit",
                )
    except OSError as error:
        raise HTTPException(
            status_code=400,
            detail=f"could not read {field_name} upload",
        ) from error
    if not data:
        raise HTTPException(status_code=400, detail=f"{field_name} upload is empty")
    return bytes(data)


def _run_workflow(workflow: WorkflowCallable, *args: object) -> bytes:
    try:
        return workflow(*args)
    except AuthenticationError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except (
        EnvelopeError,
        InvalidPNGError,
        InvalidWAVError,
        LSBError,
        PNGChunkError,
        UnsupportedMethodError,
        TypeError,
        ValueError,
        PixelAnalysisError,
    ) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/analyze")
async def analyze(
    original: UploadFile = File(..., description="Original cover PNG"),
    stego: UploadFile = File(..., description="Encoded stego PNG"),
    region_x: int = Form(0),
    region_y: int = Form(0),
    region_size: int = Form(16),
) -> dict[str, object]:
    """Compare decoded cover and stego RGBA pixel buffers."""
    original_data = await _read_upload(original, "original", MAX_PNG_UPLOAD_SIZE)
    stego_data = await _read_upload(stego, "stego", MAX_PNG_UPLOAD_SIZE)
    try:
        return compare_png_pixels(
            original_data,
            stego_data,
            region_x=region_x,
            region_y=region_y,
            region_size=region_size,
        )
    except PixelAnalysisError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


def _run_timed_workflow(workflow: Callable[..., object], *args: object) -> object:
    try:
        return workflow(*args)
    except AuthenticationError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except (
        EnvelopeError,
        InvalidPNGError,
        InvalidWAVError,
        LSBError,
        PNGChunkError,
        UnsupportedMethodError,
        TypeError,
        ValueError,
    ) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/api/health")
async def health() -> dict[str, str]:
    """Report that the API is available."""
    return {"status": "ok"}


@app.post("/api/hide")
async def hide(
    wav: UploadFile = File(..., description="PCM WAV audio to encrypt and hide"),
    image: UploadFile = File(..., description="PNG cover image"),
    password: str = Form(..., description="Password used for AES-GCM encryption"),
    method: Method = Form(..., description="Embedding method: chunk or lsb"),
) -> Response:
    """Encrypt an uploaded WAV and return a PNG containing the encrypted data."""
    wav_data = await _read_upload(wav, "wav", MAX_WAV_UPLOAD_SIZE)
    image_data = await _read_upload(image, "image", MAX_PNG_UPLOAD_SIZE)
    result = _run_timed_workflow(
        hide_wav_in_png_timed,
        wav_data,
        image_data,
        password,
        method,
    )
    result_data = result.data
    timing_header = json.dumps(
        {"timings": result.timings, "metadata": result.metadata},
        separators=(",", ":"),
    )
    return Response(
        content=result_data,
        media_type="image/png",
        headers={
            "Content-Disposition": 'attachment; filename="stego.png"',
            "X-Workflow-Timings": timing_header,
        },
    )


@app.post("/api/recover")
async def recover(
    image: UploadFile = File(..., description="PNG containing encrypted audio"),
    password: str = Form(..., description="Password used for AES-GCM decryption"),
    method: Method = Form(..., description="Embedding method: chunk or lsb"),
) -> Response:
    """Recover and return the decrypted WAV from an uploaded stego PNG."""
    image_data = await _read_upload(image, "image", MAX_PNG_UPLOAD_SIZE)
    result = _run_timed_workflow(
        recover_wav_from_png_timed,
        image_data,
        password,
        method,
    )
    timing_header = json.dumps(
        {"timings": result.timings, "metadata": result.metadata},
        separators=(",", ":"),
    )
    return Response(
        content=result.data,
        media_type="audio/wav",
        headers={
            "Content-Disposition": 'attachment; filename="recovered.wav"',
            "X-Workflow-Timings": timing_header,
        },
    )
