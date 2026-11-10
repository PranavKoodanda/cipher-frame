// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { analyzeImages, checkHealth, hideAudio, recoverAudio } from "./api";

vi.mock("./api", () => ({
  analyzeImages: vi.fn(),
  checkHealth: vi.fn(),
  hideAudio: vi.fn(),
  recoverAudio: vi.fn(),
}));

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
  analyzeImages.mockResolvedValue({ dimensions_match: true, pixel_equal: true, region: { size: 1, original: [[[0, 0, 0, 255]]], stego: [[[0, 0, 0, 255]]] }, difference_map: { width: 1, height: 1, values: [[0]] }, changed_pixel_percentage: 0, mse: 0, psnr: Infinity });
  hideAudio.mockResolvedValue(response());
  recoverAudio.mockResolvedValue({ ...response(), blob: new Blob(["wav"], { type: "audio/wav" }), server: { timings: { backend_processing_ms: 1 }, metadata: { method: "chunk" } } });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:steg-test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
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

  it("shows analysis empty states until a valid image pair exists", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Histogram Analysis" }));
    expect(screen.getByText("NO COMPARISON DATA")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Pixel Lab" }));
    expect(screen.getByText("NO COMPARISON DATA")).toBeTruthy();
    expect(analyzeImages).not.toHaveBeenCalled();
  });
});
