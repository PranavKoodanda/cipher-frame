// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { analyzeImages, checkHealth, hideAudio, recoverAudio } from "./api";
import { inspectSinglePng } from "./singleImageAnalysis";

vi.mock("./api", () => ({
  analyzeImages: vi.fn(),
  checkHealth: vi.fn(),
  hideAudio: vi.fn(),
  recoverAudio: vi.fn(),
}));
vi.mock("./singleImageAnalysis", () => ({ inspectSinglePng: vi.fn() }));

const timingData = {
  timings: {
    file_validation_ms: 1.2,
    scrypt_key_derivation_ms: 2.3,
    aes_gcm_encryption_ms: 3.4,
    payload_embedding_ms: 4.5,
    backend_processing_ms: 11.4,
  },
  metadata: { stego_image_size: 128, image_width: 16, image_height: 16, method: "chunk" },
};
const response = () => ({
  blob: new Blob(["png"], { type: "image/png" }),
  server: timingData,
  frontend: { requestDurationMs: 20 },
});
const canvasFillColors = [];
const canvasPaints = [];

function pixelComparison({ x = 0, y = 0, size = 16, width = 64, height = 64 } = {}) {
  const pixel = (px, py, changed = false) => [100 + px % 50 + Number(changed), 80 + py % 50, 40 - Number(changed), 255];
  const original = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => pixel(x + column, y + row)));
  const stego = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => pixel(x + column, y + row, row === 1 && column === 2)));
  const differenceMap = Array.from({ length: height }, () => Array(width).fill(0));
  differenceMap[y + 1][x + 2] = 1;
  const channelCount = width * height * 3;
  return {
    dimensions_match: true,
    width,
    height,
    pixel_count: width * height,
    pixel_equal: false,
    changed_pixel_count: 1,
    changed_pixel_percentage: 100 / (width * height),
    changed_channel_count: 2,
    max_channel_difference: 1,
    mean_absolute_error: 2 / channelCount,
    mse: 2 / channelCount,
    psnr: 10 * Math.log10((255 * 255) / (2 / channelCount)),
    original_pixel_sha256: "original-hash",
    stego_pixel_sha256: "stego-hash",
    histograms: {
      original: { red: Array(256).fill(0), green: Array(256).fill(0), blue: Array(256).fill(0), grayscale: Array(256).fill(0), alpha: Array(256).fill(0) },
      stego: { red: Array(256).fill(0), green: Array(256).fill(0), blue: Array(256).fill(0), grayscale: Array(256).fill(0), alpha: Array(256).fill(0) },
    },
    region: { x, y, size, original, stego },
    difference_map: { width, height, values: differenceMap },
  };
}

function singlePixels({ x = 0, y = 0, size = 16 } = {}) {
  const values = Array.from({ length: 256 }, () => Array(256).fill(0));
  values[10][50] = 100;
  return {
    width: 64,
    height: 64,
    pixel_count: 4096,
    histograms: { red: values.map((row) => [...row])[0], green: [...values[0]], blue: [...values[0]], alpha: [...values[0]], grayscale: [...values[0]] },
    region: { x, y, size, pixels: Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => [50 + x + column, 70 + y + row, 90, 255])) },
  };
}

async function provideEncodeInputs(user = userEvent.setup()) {
  render(<App />);
  await user.upload(screen.getByLabelText("WAV AUDIO PAYLOAD"), new File(["wav"], "voice.wav", { type: "audio/wav" }));
  await user.upload(screen.getByLabelText("PNG COVER CARRIER"), new File(["png"], "cover.png", { type: "image/png" }));
  await user.type(screen.getByLabelText("ENCRYPTION PASSPHRASE"), "secret");
  return user;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  checkHealth.mockResolvedValue(true);
  analyzeImages.mockResolvedValue(pixelComparison());
  inspectSinglePng.mockImplementation((file, region) => Promise.resolve(singlePixels(region)));
  hideAudio.mockResolvedValue(response());
  recoverAudio.mockResolvedValue({ ...response(), blob: new Blob(["wav"], { type: "audio/wav" }), server: { timings: { backend_processing_ms: 1 }, metadata: { method: "chunk" } } });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:steg-test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  canvasFillColors.length = 0;
  canvasPaints.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({
    fillStyle: "",
    fillRect: vi.fn(function (...coordinates) { canvasFillColors.push(this.fillStyle); canvasPaints.push({ color: this.fillStyle, coordinates }); }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), strokeRect: vi.fn(),
  }));
});

afterEach(() => cleanup());

describe("Cipher Frame workspace", () => {
  it("navigates between all six pages using named navigation controls", async () => {
    const user = userEvent.setup();
    render(<App />);
    for (const [label, heading] of [
      ["Histogram Analysis", "Histogram Analysis"],
      ["Pixel Lab", "Pixel Lab"],
      ["Decode", "Decode & Recover"],
      ["Performance", "Performance"],
      ["Run History", "Run History"],
      ["Workbench", "Cryptographic Workbench"],
    ]) {
      await user.click(screen.getByRole("button", { name: label }));
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
  });

  it("keeps only API status at the sidebar bottom and a balanced Live Workspace topbar", () => {
    const { container } = render(<App />);
    const sidebar = container.querySelector(".sidebar");
    const topbar = container.querySelector(".main .topbar");
    expect(sidebar.querySelectorAll(".side-nav button")).toHaveLength(6);
    expect(sidebar.querySelector(".project-card")).toBeTruthy();
    expect(sidebar.querySelectorAll(".sidebar-bottom .api-status")).toHaveLength(1);
    expect(sidebar.querySelector(".sidebar-bottom").children).toHaveLength(1);
    expect(sidebar.querySelector(".operator, .avatar")).toBeNull();
    expect(topbar.textContent).toContain("LIVE WORKSPACE");
    expect(topbar.querySelector(".api-status")).toBeNull();
    expect(topbar.querySelector("button")).toBeNull();
  });

  it("preserves selected workbench state when navigating away and back", async () => {
    const user = await provideEncodeInputs();
    await user.click(screen.getByRole("button", { name: "Decode" }));
    await user.click(screen.getByRole("button", { name: "Workbench" }));
    expect(screen.getByText("voice.wav")).toBeTruthy();
    expect(screen.getByText("cover.png")).toBeTruthy();
    expect(screen.getByLabelText("ENCRYPTION PASSPHRASE").value).toBe("secret");
  });

  it("records successful encoding and displays backend stage timings", async () => {
    const user = await provideEncodeInputs();
    await user.click(screen.getByRole("button", { name: /ENCODE & VALIDATE/i }));
    expect(await screen.findByText("ENCODING VERIFIED")).toBeTruthy();
    expect(await screen.findByText("2.30 ms")).toBeTruthy();
    expect(hideAudio).toHaveBeenCalledOnce();
    expect(analyzeImages).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem("steg-os-history"))[0].status).toBe("completed");
  });

  it("reports encoding failure without creating a successful run", async () => {
    hideAudio.mockRejectedValueOnce(new Error("invalid WAV"));
    const user = await provideEncodeInputs();
    await user.click(screen.getByRole("button", { name: /ENCODE & VALIDATE/i }));
    expect((await screen.findByRole("alert")).textContent).toContain("invalid WAV");
    expect(screen.queryByText("ENCODING VERIFIED")).toBeNull();
    expect(JSON.parse(localStorage.getItem("steg-os-history"))[0].status).toBe("failed");
  });

  it("keeps successful encoding and output when subsequent pixel analysis fails", async () => {
    analyzeImages.mockRejectedValueOnce(new Error("analysis unavailable"));
    const user = await provideEncodeInputs();
    await user.click(screen.getByRole("button", { name: /ENCODE & VALIDATE/i }));
    expect(await screen.findByText("ENCODING VERIFIED")).toBeTruthy();
    expect(screen.getByRole("link", { name: /DOWNLOAD STEGO PNG/i })).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain("analysis unavailable");
    expect(JSON.parse(localStorage.getItem("steg-os-history"))[0].status).toBe("completed");
  });

  it("hands the generated stego PNG to Decode and selects the encoding method", async () => {
    const user = await provideEncodeInputs();
    await user.click(screen.getByRole("radio", { name: /LSB/ }));
    hideAudio.mockResolvedValueOnce({ ...response(), server: { ...timingData, metadata: { ...timingData.metadata, method: "lsb" } } });
    await user.click(screen.getByRole("button", { name: /ENCODE & VALIDATE/i }));
    await screen.findByText("ENCODING VERIFIED");
    await user.click(screen.getByRole("button", { name: "USE THIS IMAGE TO DECODE" }));

    expect(screen.getByRole("heading", { name: "Decode & Recover" })).toBeTruthy();
    expect(screen.getByText("stego.png")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /LSB/ }).checked).toBe(true);
    expect(screen.getByLabelText("DECRYPTION PASSPHRASE").value).toBe("");
    expect(screen.getByLabelText("STEGO PNG INPUT").parentElement.parentElement.textContent).toContain("stego.png");

    await user.type(screen.getByLabelText("DECRYPTION PASSPHRASE"), "decode-secret");
    await waitFor(() => expect(screen.getByRole("button", { name: "RECOVER AUDIO" }).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "RECOVER AUDIO" }));
    await screen.findByText("AUTHENTICATED WAV");
    const request = recoverAudio.mock.calls[0][0];
    expect(request.image.name).toBe("stego.png");
    expect(request.method).toBe("lsb");
    expect(JSON.stringify(localStorage.getItem("steg-os-history"))).not.toContain("decode-secret");
  });

  it("keeps Pixel Lab open while inspecting, updates real values, and retains the last region on failure", async () => {
    const user = await provideEncodeInputs();
    analyzeImages.mockResolvedValueOnce(pixelComparison());
    await user.click(screen.getByRole("button", { name: /ENCODE & VALIDATE/i }));
    await screen.findByText("ENCODING VERIFIED");
    await user.click(screen.getByRole("button", { name: "Pixel Lab" }));
    expect(await screen.findByText("Displayed range: X 0–15, Y 0–15 · 256 pixels")).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Region size"), "8");
    fireEvent.change(screen.getByLabelText("Top-left X (pixels)"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Top-left Y (pixels)"), { target: { value: "3" } });
    let resolveInspection;
    analyzeImages.mockReturnValueOnce(new Promise((resolve) => { resolveInspection = resolve; }));
    await user.click(screen.getByRole("button", { name: "INSPECT REGION" }));
    expect(screen.getByText(/Inspecting region; the previous valid comparison remains visible/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pixel Lab" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "RETURN TO WORKBENCH" })).toBeNull();
    expect(window.location.pathname).toBe("/");
    expect(screen.getByText("Displayed range: X 0–15, Y 0–15 · 256 pixels")).toBeTruthy();

    resolveInspection(pixelComparison({ x: 2, y: 3, size: 8 }));
    expect(await screen.findByText("Displayed range: X 2–9, Y 3–10 · 64 pixels")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Original cover pixel at \(4, 4\)/i }));
    expect(screen.getByText("Original RGBA (104, 84, 40, 255)")).toBeTruthy();
    expect(screen.getByText("Stego RGBA (105, 84, 39, 255)")).toBeTruthy();
    expect(screen.getByText("ΔR: 1 · ΔG: 0 · ΔB: -1 · ΔA: 0")).toBeTruthy();
    expect(screen.getByText("Pixel changed: Yes")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Top-left X (pixels)"), { target: { value: "4" } });
    analyzeImages.mockRejectedValueOnce(new Error("region API failed"));
    await user.click(screen.getByRole("button", { name: "INSPECT REGION" }));
    expect((await screen.findByRole("alert")).textContent).toContain("region API failed");
    expect(screen.getByText("Displayed range: X 2–9, Y 3–10 · 64 pixels")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pixel Lab" })).toBeTruthy();
  });

  it("rejects an out-of-bounds region without requesting or clearing current pixels", async () => {
    const user = await provideEncodeInputs();
    analyzeImages.mockResolvedValueOnce(pixelComparison());
    await user.click(screen.getByRole("button", { name: /ENCODE & VALIDATE/i }));
    await screen.findByText("ENCODING VERIFIED");
    await user.click(screen.getByRole("button", { name: "Pixel Lab" }));
    fireEvent.change(screen.getByLabelText("Top-left X (pixels)"), { target: { value: "60" } });
    await user.click(screen.getByRole("button", { name: "INSPECT REGION" }));
    expect((await screen.findByRole("alert")).textContent).toContain("must fit within the 64 × 64 image");
    expect(analyzeImages).toHaveBeenCalledOnce();
    expect(screen.getByText("Displayed range: X 0–15, Y 0–15 · 256 pixels")).toBeTruthy();
  });

  it("renders an identical PNG Chunk comparison as a black, zero-range difference map", async () => {
    const samePixels = pixelComparison();
    samePixels.pixel_equal = true;
    samePixels.changed_pixel_count = 0;
    samePixels.changed_pixel_percentage = 0;
    samePixels.changed_channel_count = 0;
    samePixels.max_channel_difference = 0;
    samePixels.mean_absolute_error = 0;
    samePixels.mse = 0;
    samePixels.psnr = Infinity;
    samePixels.stego_pixel_sha256 = samePixels.original_pixel_sha256;
    samePixels.region.stego = samePixels.region.original.map((row) => row.map((pixel) => [...pixel]));
    samePixels.difference_map.values = Array.from({ length: 64 }, () => Array(64).fill(0));
    const user = await provideEncodeInputs();
    analyzeImages.mockResolvedValueOnce(samePixels);
    await user.click(screen.getByRole("button", { name: /ENCODE & VALIDATE/i }));
    await screen.findByText("ENCODING VERIFIED");
    await user.click(screen.getByRole("button", { name: "Histogram Analysis" }));
    expect(await screen.findByText("No pixel differences detected.")).toBeTruthy();
    expect(screen.getByRole("img", { name: /RGB difference heatmap, actual range 0 to 0, display amplification 1 times/ })).toBeTruthy();
    expect(screen.getByText("Actual minimum: 0")).toBeTruthy();
    expect(screen.getByText("Actual maximum: 0")).toBeTruthy();
    expect(screen.getByText(/Identical decoded pixels are expected for PNG Custom Chunk embedding/)).toBeTruthy();
    expect(screen.queryByText(/expanded across red intensity|mapped to red intensity 48/i)).toBeNull();
    expect(canvasFillColors.length).toBeGreaterThan(0);
    expect(new Set(canvasFillColors)).toEqual(new Set(["rgb(0, 0, 0)"]));
  });

  it("amplifies display brightness without changing actual difference values or metrics", async () => {
    const user = await provideEncodeInputs();
    await user.click(screen.getByRole("radio", { name: /LSB/ }));
    const actualComparison = pixelComparison();
    analyzeImages.mockResolvedValueOnce(actualComparison);
    await user.click(screen.getByRole("button", { name: /ENCODE & VALIDATE/i }));
    await screen.findByText("ENCODING VERIFIED");
    await user.click(screen.getByRole("button", { name: "Histogram Analysis" }));

    const summary = screen.getByLabelText("Comparison summary").textContent;
    const map = screen.getByRole("img", { name: /actual range 0 to 1/i });
    expect(actualComparison.difference_map.values[1][2]).toBe(1);
    expect(canvasPaints.some(({ color, coordinates }) => color === "rgb(1, 0, 0)" && coordinates[0] === 2 && coordinates[1] === 1)).toBe(true);
    expect(screen.getByText("Maximum RGB difference").parentElement.textContent).toContain("1 / 255");
    expect(screen.getByRole("group", { name: "Difference map display amplification" }).querySelectorAll("button")).toHaveLength(3);

    expect(canvasFillColors).toContain("rgb(1, 0, 0)");
    for (const [label, intensity] of [[/Amplified \(10/, 10], [/Amplified \(50/, 50], [/Actual \(1/, 1]]) {
      canvasFillColors.length = 0;
      await user.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(canvasFillColors).toContain(`rgb(${intensity}, 0, 0)`));
      expect(screen.getByLabelText("Comparison summary").textContent).toBe(summary);
      expect(screen.getByText("Actual maximum: 1")).toBeTruthy();
      expect(actualComparison.difference_map.values[1][2]).toBe(1);
      expect(map.getAttribute("aria-label")).toContain("display amplification");
    }
  });

  it("keeps the full-image map in Histogram Analysis and leaves Pixel Lab region inspection intact", async () => {
    const user = await provideEncodeInputs();
    analyzeImages.mockResolvedValueOnce(pixelComparison());
    await user.click(screen.getByRole("button", { name: /ENCODE & VALIDATE/i }));
    await screen.findByText("ENCODING VERIFIED");
    await user.click(screen.getByRole("button", { name: "Pixel Lab" }));
    expect(document.querySelectorAll(".pixel-matrix")).toHaveLength(2);
    expect(document.querySelectorAll(".pixel-matrix .pixel")).toHaveLength(512);
    expect(document.querySelectorAll(".pixel-matrix .pixel.changed")).toHaveLength(2);
    expect(document.querySelector(".difference-map")).toBeNull();
    expect(screen.getByRole("button", { name: "INSPECT REGION" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Histogram Analysis" }));
    expect(document.querySelectorAll(".difference-map")).toHaveLength(1);
  });

  it("labels the actual LSB difference range and maps changed pixels to red", async () => {
    const user = await provideEncodeInputs();
    await user.click(screen.getByRole("radio", { name: /LSB/ }));
    analyzeImages.mockResolvedValueOnce(pixelComparison());
    await user.click(screen.getByRole("button", { name: /ENCODE & VALIDATE/i }));
    await screen.findByText("ENCODING VERIFIED");
    await user.click(screen.getByRole("button", { name: "Histogram Analysis" }));
    expect(await screen.findByText(/LSB can change many pixels while changing each channel by only 1/)).toBeTruthy();
    expect(screen.getByRole("img", { name: /RGB difference heatmap, actual range 0 to 1/ })).toBeTruthy();
    expect(screen.getByText("Actual maximum: 1")).toBeTruthy();
    expect(canvasFillColors).toContain("rgb(1, 0, 0)");
  });

  it("recovers audio and reports recovery failure", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Decode" }));
    await user.upload(screen.getByLabelText("STEGO PNG INPUT"), new File(["png"], "stego.png", { type: "image/png" }));
    await user.type(screen.getByLabelText("DECRYPTION PASSPHRASE"), "secret");
    await user.click(screen.getByRole("button", { name: "RECOVER AUDIO" }));
    expect(await screen.findByText("AUTHENTICATED WAV")).toBeTruthy();
    expect(recoverAudio).toHaveBeenCalledOnce();

    recoverAudio.mockRejectedValueOnce(new Error("wrong password"));
    await user.click(screen.getByRole("button", { name: "RECOVER AUDIO" }));
    expect((await screen.findByRole("alert")).textContent).toContain("wrong password");
  });

  it("persists run history across remounts", async () => {
    const user = await provideEncodeInputs();
    await user.click(screen.getByRole("button", { name: /ENCODE & VALIDATE/i }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("steg-os-history"))).toHaveLength(1));
    cleanup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Run History" }));
    expect(screen.getByText("voice.wav")).toBeTruthy();
    expect(screen.getByText("LOCAL TIME")).toBeTruthy();
  });

  it("shows an image-selection prompt instead of a dashboard return screen when no image exists", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Histogram Analysis" }));
    expect(screen.getByText("Select an original cover or stego PNG to begin image analysis.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Pixel Lab" }));
    expect(screen.getByText("Select an original cover or stego PNG to inspect pixel values.")).toBeTruthy();
    expect(analyzeImages).not.toHaveBeenCalled();
  });

  it("shows the original-cover histogram and then compares it with an inline-selected stego PNG", async () => {
    const user = userEvent.setup();
    render(<App />);
    const cover = new File(["cover"], "reference.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("PNG COVER CARRIER"), cover);
    await user.click(screen.getByRole("button", { name: "Histogram Analysis" }));
    expect(await screen.findByText(/Original cover · individual histogram/i)).toBeTruthy();
    expect(screen.getByText("Stego image required")).toBeTruthy();
    expect(screen.queryByText("Difference histogram")).toBeNull();
    const stego = new File(["stego"], "external-stego.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("SELECT STEGO PNG"), stego);
    await waitFor(() => expect(analyzeImages).toHaveBeenCalledWith(expect.objectContaining({ original: cover, stego })));
    expect(await screen.findByText(/TWO-IMAGE COMPARISON/)).toBeTruthy();
  });

  it("shows an uploaded stego histogram and compares it with an inline-selected reference cover", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Decode" }));
    const stego = new File(["stego"], "external-stego.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("STEGO PNG INPUT"), stego);
    await user.click(screen.getByRole("button", { name: "Histogram Analysis" }));
    expect(await screen.findByText(/Stego image · individual histogram/i)).toBeTruthy();
    expect(screen.getByText("Original reference image required")).toBeTruthy();
    const reference = new File(["reference"], "original.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("SELECT ORIGINAL COVER"), reference);
    await waitFor(() => expect(analyzeImages).toHaveBeenCalledWith(expect.objectContaining({ original: reference, stego })));
    expect(await screen.findByText(/TWO-IMAGE COMPARISON/)).toBeTruthy();
  });

  it("shows a single-image analysis error and retries without refreshing", async () => {
    const user = userEvent.setup();
    render(<App />);
    inspectSinglePng.mockRejectedValueOnce(new Error("image decode failed"));
    await user.upload(screen.getByLabelText("PNG COVER CARRIER"), new File(["cover"], "cover.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "Histogram Analysis" }));
    expect((await screen.findByRole("alert")).textContent).toContain("image decode failed");
    await user.click(screen.getByRole("button", { name: "RETRY ANALYSIS" }));
    expect(await screen.findByText(/Original Cover · individual histogram/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(inspectSinglePng).toHaveBeenCalledTimes(2);
  });

  it("shows a histogram comparison after encoding without decoding", async () => {
    const user = await provideEncodeInputs();
    await user.click(screen.getByRole("button", { name: /ENCODE & VALIDATE/i }));
    await screen.findByText("ENCODING VERIFIED");
    await user.click(screen.getByRole("button", { name: "Histogram Analysis" }));
    expect(await screen.findByText(/TWO-IMAGE COMPARISON/)).toBeTruthy();
    expect(screen.getByText("Difference histogram")).toBeTruthy();
  });

  it("shows original RGBA values in Pixel Lab and adds comparison after selecting a stego PNG", async () => {
    const user = userEvent.setup();
    render(<App />);
    const cover = new File(["cover"], "reference.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("PNG COVER CARRIER"), cover);
    await user.click(screen.getByRole("button", { name: "Pixel Lab" }));
    expect(await screen.findByText("RGBA (50, 70, 90, 255)")).toBeTruthy();
    expect(screen.getByText("Stego image required to perform pixel comparison.")).toBeTruthy();
    const stego = new File(["stego"], "external-stego.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("SELECT STEGO PNG"), stego);
    await waitFor(() => expect(analyzeImages).toHaveBeenCalledWith(expect.objectContaining({ original: cover, stego })));
    expect(await screen.findByText(/TWO-IMAGE COMPARISON/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Original Cover pixel at \(2, 1\).*changed/i }));
    expect(screen.getByText(/Pixel changed: Yes/)).toBeTruthy();
  });

  it("shows actual stego pixels and adds comparison after selecting its original reference", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Decode" }));
    const stego = new File(["stego"], "external-stego.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("STEGO PNG INPUT"), stego);
    await user.click(screen.getByRole("button", { name: "Pixel Lab" }));
    expect(await screen.findByText("Original reference image required for comparative analysis.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /stego pixel at \(0, 0\), RGBA 50, 70, 90, 255/i })).toBeTruthy();
    const reference = new File(["reference"], "original.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("SELECT ORIGINAL COVER"), reference);
    await waitFor(() => expect(analyzeImages).toHaveBeenCalledWith(expect.objectContaining({ original: reference, stego })));
    expect(await screen.findByText(/TWO-IMAGE COMPARISON/)).toBeTruthy();
  });

  it("shows the encoded pixel comparison in Pixel Lab without decoding", async () => {
    const user = await provideEncodeInputs();
    await user.click(screen.getByRole("button", { name: /ENCODE & VALIDATE/i }));
    await screen.findByText("ENCODING VERIFIED");
    await user.click(screen.getByRole("button", { name: "Pixel Lab" }));
    expect(await screen.findByText(/TWO-IMAGE COMPARISON/)).toBeTruthy();
    expect(screen.getByText("Original RGBA (100, 80, 40, 255)")).toBeTruthy();
    expect(screen.getByText("Stego RGBA (100, 80, 40, 255)")).toBeTruthy();
  });
});
