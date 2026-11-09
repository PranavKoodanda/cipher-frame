const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

async function readError(response) {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // Fall through to the status text for non-JSON responses.
  }
  return response.statusText || "The request could not be completed.";
}

async function request(path, formData) {
  const requestStarted = performance.now();
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      body: formData,
    });
  } catch {
    throw new Error("The API is unavailable. Check that the backend is running.");
  }

  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const headersReceived = performance.now();
  const blob = await response.blob();
  const bodyCompleted = performance.now();
  let server = null;
  try {
    const timingHeader = response.headers.get("X-Workflow-Timings");
    server = timingHeader ? JSON.parse(timingHeader) : null;
  } catch {
    throw new Error("The API returned invalid timing metadata.");
  }
  if (!server?.timings || !server?.metadata) {
    throw new Error("The API did not return workflow timing metadata.");
  }
  return {
    blob,
    server,
    frontend: {
      requestToHeadersMs: headersReceived - requestStarted,
      requestDurationMs: bodyCompleted - requestStarted,
      responseTransferMs: bodyCompleted - headersReceived,
    },
  };
}

export async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export function hideAudio({ wav, image, password, method }) {
  const formData = new FormData();
  formData.append("wav", wav);
  formData.append("image", image);
  formData.append("password", password);
  formData.append("method", method);
  return request("/api/hide", formData);
}

export function recoverAudio({ image, password, method }) {
  const formData = new FormData();
  formData.append("image", image);
  formData.append("password", password);
  formData.append("method", method);
  return request("/api/recover", formData);
}

export async function analyzeImages({ original, stego, x, y, size }) {
  const formData = new FormData();
  formData.append("original", original);
  formData.append("stego", stego);
  formData.append("region_x", String(x));
  formData.append("region_y", String(y));
  formData.append("region_size", String(size));
  const response = await fetch(`${API_BASE_URL}/api/analyze`, { method: "POST", body: formData });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}
