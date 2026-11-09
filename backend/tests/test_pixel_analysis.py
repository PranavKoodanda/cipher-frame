from io import BytesIO

import pytest
from PIL import Image

from backend.app.utils.pixel_analysis import PixelAnalysisError, compare_png_pixels


def _png(size=(4, 4), rgba=(10, 20, 30, 0)) -> bytes:
    output = BytesIO()
    Image.new("RGBA", size, rgba).save(output, format="PNG")
    return output.getvalue()


def test_identical_rgba_pixels_have_zero_difference_and_equal_hashes() -> None:
    image = _png((16, 16))
    result = compare_png_pixels(image, image)
    assert result["pixel_equal"] is True
    assert result["changed_pixel_count"] == 0
    assert result["changed_channel_count"] == 0
    assert result["mse"] == 0
    assert result["psnr"] == float("inf")
    assert result["original_pixel_sha256"] == result["stego_pixel_sha256"]
    assert max(map(max, result["difference_map"]["values"])) == 0


def test_changed_rgba_pixel_is_reported_with_actual_statistics() -> None:
    first = Image.new("RGBA", (8, 8), (10, 20, 30, 0))
    second = first.copy()
    second.putpixel((1, 0), (11, 20, 28, 255))
    first_bytes = BytesIO()
    second_bytes = BytesIO()
    first.save(first_bytes, format="PNG")
    second.save(second_bytes, format="PNG")
    result = compare_png_pixels(first_bytes.getvalue(), second_bytes.getvalue(), region_size=8)
    assert result["pixel_equal"] is False
    assert result["changed_pixel_count"] == 1
    assert result["changed_channel_count"] == 2
    assert result["max_channel_difference"] == 2
    assert result["region"]["original"][0][1] == [10, 20, 30, 0]
    assert result["region"]["stego"][0][1] == [11, 20, 28, 255]


def test_dimension_mismatch_and_invalid_region_are_safe() -> None:
    result = compare_png_pixels(_png((2, 2)), _png((3, 2)))
    assert result["dimensions_match"] is False
    with pytest.raises(PixelAnalysisError):
        compare_png_pixels(_png(), _png(), region_x=3)


def test_difference_map_is_bounded_for_large_images() -> None:
    image = _png((300, 260))
    result = compare_png_pixels(image, image)
    assert result["difference_map"]["width"] == 256
    assert result["difference_map"]["height"] == 256
