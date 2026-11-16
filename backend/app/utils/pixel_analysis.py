"""Canonical RGBA pixel comparison for cover and stego PNG images."""

from hashlib import sha256
import math
from io import BytesIO
from typing import Any

from PIL import Image, UnidentifiedImageError


class PixelAnalysisError(ValueError):
    """Raised when images cannot be decoded or compared."""


def _decode(data: bytes, name: str) -> tuple[Image.Image, bytes]:
    try:
        with Image.open(BytesIO(data)) as image:
            if image.format != "PNG":
                raise PixelAnalysisError(f"{name} must be a PNG image")
            image.load()
            rgba = image.convert("RGBA")
            return rgba.copy(), rgba.tobytes()
    except (UnidentifiedImageError, OSError) as error:
        raise PixelAnalysisError(f"{name} is not a valid PNG image") from error


def _histogram(pixels: bytes) -> dict[str, list[float]]:
    channels = [[0] * 256 for _ in range(4)]
    grayscale = [0] * 256
    for offset in range(0, len(pixels), 4):
        red, green, blue = pixels[offset : offset + 3]
        channels[0][red] += 1
        channels[1][green] += 1
        channels[2][blue] += 1
        channels[3][pixels[offset + 3]] += 1
        grayscale[round(0.299 * red + 0.587 * green + 0.114 * blue)] += 1
    total = len(pixels) // 4
    return {
        "red": [value * 100 / total for value in channels[0]],
        "green": [value * 100 / total for value in channels[1]],
        "blue": [value * 100 / total for value in channels[2]],
        "alpha": [value * 100 / total for value in channels[3]],
        "grayscale": [value * 100 / total for value in grayscale],
    }


def _region(
    pixels: bytes, width: int, height: int, x: int, y: int, size: int
) -> list[list[list[int]]]:
    if size not in {8, 16, 32}:
        raise PixelAnalysisError("region size must be 8, 16, or 32")
    if x < 0 or y < 0 or x + size > width or y + size > height:
        raise PixelAnalysisError("pixel region is outside image dimensions")
    return [
        [
            list(pixels[((y + row) * width + x + column) * 4 : ((y + row) * width + x + column + 1) * 4])
            for column in range(size)
        ]
        for row in range(size)
    ]


def _difference_map(
    first: bytes, second: bytes, width: int, height: int
) -> dict[str, Any]:
    map_width = min(width, 256)
    map_height = min(height, 256)
    cells = [[0] * map_width for _ in range(map_height)]
    for y in range(height):
        target_y = min(map_height - 1, y * map_height // height)
        for x in range(width):
            target_x = min(map_width - 1, x * map_width // width)
            offset = (y * width + x) * 4
            difference = max(
                abs(first[offset] - second[offset]),
                abs(first[offset + 1] - second[offset + 1]),
                abs(first[offset + 2] - second[offset + 2]),
            )
            cells[target_y][target_x] = max(cells[target_y][target_x], difference)
    return {"width": map_width, "height": map_height, "values": cells}


def compare_png_pixels(
    original: bytes,
    stego: bytes,
    *,
    region_x: int = 0,
    region_y: int = 0,
    region_size: int = 16,
) -> dict[str, Any]:
    """Return exact RGBA statistics and bounded visualization data."""
    first_image, first = _decode(original, "original")
    second_image, second = _decode(stego, "stego")
    width, height = first_image.size
    if first_image.size != second_image.size:
        return {
            "dimensions_match": False,
            "original": {"width": width, "height": height},
            "stego": {"width": second_image.width, "height": second_image.height},
        }
    pixels = width * height
    changed_pixels = 0
    changed_channels = 0
    max_difference = 0
    absolute_error = 0
    squared_error = 0
    for offset in range(0, len(first), 4):
        differences = [abs(first[offset + channel] - second[offset + channel]) for channel in range(3)]
        absolute_error += sum(differences)
        squared_error += sum(value * value for value in differences)
        max_difference = max(max_difference, *differences)
        changed_channels += sum(value != 0 for value in differences)
        changed_pixels += any(value != 0 for value in differences)
    channel_count = pixels * 3
    mse = squared_error / channel_count
    return {
        "dimensions_match": True,
        "width": width,
        "height": height,
        "pixel_count": pixels,
        "pixel_equal": first == second,
        "changed_pixel_count": changed_pixels,
        "changed_pixel_percentage": changed_pixels * 100 / pixels,
        "changed_channel_count": changed_channels,
        "max_channel_difference": max_difference,
        "mean_absolute_error": absolute_error / channel_count,
        "mse": mse,
        "psnr": math.inf if mse == 0 else 10 * math.log10((255 * 255) / mse),
        "original_pixel_sha256": sha256(first).hexdigest(),
        "stego_pixel_sha256": sha256(second).hexdigest(),
        "histograms": {"original": _histogram(first), "stego": _histogram(second)},
        "region": {
            "x": region_x,
            "y": region_y,
            "size": region_size,
            "original": _region(first, width, height, region_x, region_y, region_size),
            "stego": _region(second, width, height, region_x, region_y, region_size),
        },
        "difference_map": _difference_map(first, second, width, height),
    }
