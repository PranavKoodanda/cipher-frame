// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { inspectSinglePng } from "./singleImageAnalysis";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("reads actual single-image histograms and selected RGBA pixels", async () => {
  const rgba = new Uint8ClampedArray(8 * 8 * 4);
  rgba.set([12, 34, 56, 78], (3 * 8 + 2) * 4);
  const bitmap = { width: 8, height: 8, close: vi.fn() };
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
  const context = { drawImage: vi.fn(), getImageData: () => ({ data: rgba }) };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);

  const result = await inspectSinglePng(new File(["png"], "cover.png"), { x: 0, y: 0, size: 8 });

  expect(result.histograms.red[12]).toBeCloseTo(100 / 64);
  expect(result.histograms.green[34]).toBeCloseTo(100 / 64);
  expect(result.histograms.blue[56]).toBeCloseTo(100 / 64);
  expect(result.region.pixels[3][2]).toEqual([12, 34, 56, 78]);
  expect(bitmap.close).toHaveBeenCalledOnce();
});

it("processes large images in bounded tiles and yields during analysis", async () => {
  const bitmap = { width: 768, height: 768, close: vi.fn() };
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
  const reads = [];
  const context = {
    drawImage: vi.fn(),
    getImageData: (_x, _y, width, height) => {
      reads.push([width, height]);
      const data = new Uint8ClampedArray(width * height * 4);
      for (let offset = 0; offset < data.length; offset += 4) data.set([12, 34, 56, 255], offset);
      return { data };
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  const yieldTimer = vi.spyOn(globalThis, "setTimeout");

  const result = await inspectSinglePng(new File(["png"], "large.png"));

  expect(reads).toHaveLength(10);
  expect(reads.slice(0, 9)).toEqual(Array(9).fill([256, 256]));
  expect(reads.at(-1)).toEqual([16, 16]);
  expect(yieldTimer).toHaveBeenCalledWith(expect.any(Function), 0);
  expect(result.histograms.red[12]).toBe(100);
  expect(result.region.pixels[0][0]).toEqual([12, 34, 56, 255]);
  expect(bitmap.close).toHaveBeenCalledOnce();
});
