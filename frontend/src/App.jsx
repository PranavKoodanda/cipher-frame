import { useEffect, useRef, useState } from "react";
import { analyzeImages, checkHealth, hideAudio, recoverAudio } from "./api";

const METHODS = [
  {
    id: "chunk",
    name: "PNG Chunk",
    description: "Stores the encrypted payload in a custom PNG chunk.",
  },
  {
    id: "lsb",
    name: "LSB",
    description: "Embeds payload bits in image pixels; capacity depends on dimensions.",
  },
];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ProductMark() {
  return <span className="product-mark" aria-hidden="true"><span /></span>;
}

function StatusIndicator({ status }) {
  const labels = { checking: "Checking API", connected: "API connected", unavailable: "API unavailable" };
  return (
    <div className={`api-status ${status}`} role="status">
      <span className="status-dot" />
      {labels[status]}
    </div>
  );
}

function PasswordField({ value, onChange, id }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-wrap">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        required
      />
      <button
        className="visibility-button"
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}

function FileDrop({ id, label, accept, file, onFile, onRemove, hint, preview }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!file && inputRef.current) inputRef.current.value = "";
  }, [file]);

  const chooseFile = (candidate) => {
    if (candidate && candidate.type) onFile(candidate);
  };
  return (
    <div className="field-group">
      <div className="field-heading">
        <label htmlFor={id}>{label}</label>
        <span>{hint}</span>
      </div>
      <div
        className={`drop-zone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          chooseFile(event.dataTransfer.files[0]);
        }}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          onChange={(event) => chooseFile(event.target.files[0])}
        />
        {file ? (
          <div className="file-selected">
            {preview}
            <div className="file-details">
              <strong>{file.name}</strong>
              <span>{formatBytes(file.size)}</span>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                inputRef.current.value = "";
                onRemove();
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <button type="button" className="drop-action" onClick={() => inputRef.current?.click()}>
            <span className="upload-glyph" aria-hidden="true">↑</span>
            <span><strong>Drop file here</strong> or browse</span>
            <small>{accept === ".wav,audio/wav" ? "WAV audio only" : "PNG image only"}</small>
          </button>
        )}
      </div>
    </div>
  );
}

function MethodSelector({ method, onChange }) {
  return (
    <fieldset className="field-group method-field">
      <legend>Embedding method</legend>
      <div className="method-options">
        {METHODS.map((option) => (
          <label className={`method-option ${method === option.id ? "selected" : ""}`} key={option.id}>
            <input
              type="radio"
              name="method"
              value={option.id}
              checked={method === option.id}
              onChange={() => onChange(option.id)}
            />
            <span className="radio-mark" />
            <span><strong>{option.name}</strong><small>{option.description}</small></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Result({ type, blob, onReset }) {
  const isPng = type === "hide";
  const filename = isPng ? "stego.png" : "recovered.wav";
  return (
    <section className="result-panel" aria-live="polite">
      <div className="result-icon" aria-hidden="true">✓</div>
      <div className="result-copy">
        <span className="eyebrow">Operation complete</span>
        <h2>{isPng ? "Audio hidden successfully" : "Audio recovered successfully"}</h2>
        <p><strong>{filename}</strong><span>{formatBytes(blob.size)}</span></p>
      </div>
      <button className="primary-button result-button" type="button" onClick={() => downloadBlob(blob, filename)}>
        Download {isPng ? "PNG" : "WAV"} <span aria-hidden="true">↓</span>
      </button>
      <button className="secondary-button" type="button" onClick={onReset}>Start another</button>
    </section>
  );
}

function PanelHeading({ eyebrow, title }) {
  return <div className="panel-heading"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>;
}

function Histogram({ cover, stego, channel }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!cover || !stego || !canvasRef.current) return undefined;
    let active = true;
    const read = (file) => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const values = [new Array(256).fill(0), new Array(256).fill(0), new Array(256).fill(0), new Array(256).fill(0)];
        for (let index = 0; index < pixels.length; index += 4) {
          values[0][pixels[index]] += 1;
          values[1][pixels[index + 1]] += 1;
          values[2][pixels[index + 2]] += 1;
          values[3][Math.round(.299 * pixels[index] + .587 * pixels[index + 1] + .114 * pixels[index + 2])] += 1;
        }
        URL.revokeObjectURL(url);
        resolve({ width: canvas.width, height: canvas.height, values });
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image decode failed")); };
      image.src = url;
    });
    Promise.all([read(cover), read(stego)]).then(([first, second]) => {
      if (!active) return;
      const canvas = canvasRef.current;
      const height = 220;
      const channels = channel === "rgb" ? [0, 1, 2] : [channel === "red" ? 0 : channel === "green" ? 1 : channel === "blue" ? 2 : 3];
      const colors = ["#ef8e92", "#6cc394", "#22d3ee", "#a78bfa"];
      const draw = () => {
        const width = canvas.clientWidth || 600;
        const scale = window.devicePixelRatio || 1;
        canvas.width = width * scale;
        canvas.height = height * scale;
        const context = canvas.getContext("2d");
        context.setTransform(scale, 0, 0, scale, 0, 0);
        context.clearRect(0, 0, width, height);
        const max = Math.max(...channels.flatMap((index) => [...first.values[index], ...second.values[index]]), 1);
        channels.forEach((index) => [first.values[index], second.values[index]].forEach((values, imageIndex) => {
          context.strokeStyle = colors[index];
          context.globalAlpha = imageIndex ? 1 : .45;
          context.lineWidth = 1.5;
          context.beginPath();
          values.forEach((value, point) => {
            const x = point * width / 255;
            const y = height - (value / max) * (height - 12);
            point ? context.lineTo(x, y) : context.moveTo(x, y);
          });
          context.stroke();
        }));
        context.globalAlpha = 1;
      };
      draw();
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(draw);
        observer.observe(canvas.parentElement || canvas);
        canvas._histogramObserver = observer;
      } else {
        window.addEventListener("resize", draw);
        canvas._histogramResizeFallback = draw;
      }
    }).catch(() => undefined);
    return () => {
      active = false;
      if (canvasRef.current?._histogramObserver) {
        canvasRef.current._histogramObserver.disconnect();
        delete canvasRef.current._histogramObserver;
      }
      if (canvasRef.current?._histogramResizeFallback) {
        window.removeEventListener("resize", canvasRef.current._histogramResizeFallback);
        delete canvasRef.current._histogramResizeFallback;
      }
    };
  }, [cover, stego, channel]);
  if (!cover || !stego) return <p className="empty-analysis">Encode a cover image to compare actual decoded pixels.</p>;
  return <><canvas ref={canvasRef} className="histogram-canvas" /><div className="chart-axis"><span>0</span><span>Pixel intensity (0–255)</span><span>255</span></div><div className="legend"><span>Cover (faint)</span><span>Stego (solid)</span></div></>;
}

function Timings({ record, labels }) {
  if (!record) return <p className="empty-analysis">No completed operation.</p>;
  return Object.entries(labels).map(([key, label]) => <div className="measurement" key={key}><span>{label}</span><strong>{record.timings[key] == null ? "—" : `${record.timings[key].toFixed(2)} ms`}</strong></div>);
}

function TimingBreakdown({ record, labels, kind }) {
  if (!record) return <p className="empty-analysis">No completed operation.</p>;
  const serverTime = record.timings.backend_processing_ms;
  const elapsedTime = record.timings.frontend_operation_ms;
  return (
    <details className="timing-details">
      <summary>
        <span>{kind} timing summary</span>
        <span className="timing-summary-values">
          <strong>Server {serverTime == null ? "—" : `${serverTime.toFixed(2)} ms`}</strong>
          <strong>Elapsed {elapsedTime == null ? "—" : `${elapsedTime.toFixed(2)} ms`}</strong>
        </span>
      </summary>
      <div className="timing-summary-note">Server processing and browser elapsed time are independent measurements; they are not added together.</div>
      <div className="timing-breakdown"><Timings record={record} labels={labels} /></div>
    </details>
  );
}

function ImageQuality({ cover, stego }) {
  const [metrics, setMetrics] = useState(null);
  useEffect(() => {
    if (!cover || !stego) { setMetrics(null); return undefined; }
    setMetrics(null);
    let active = true;
    const read = (file) => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        URL.revokeObjectURL(url);
        resolve({ width: canvas.width, height: canvas.height, pixels });
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image decode failed")); };
      image.src = url;
    });
    Promise.all([read(cover), read(stego)]).then(([first, second]) => {
      if (!active) return;
      if (first.width !== second.width || first.height !== second.height) {
        setMetrics({ error: "Cover and stego dimensions differ." });
        return;
      }
      let sum = 0;
      for (let index = 0; index < first.pixels.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          const difference = first.pixels[index + channel] - second.pixels[index + channel];
          sum += difference * difference;
        }
      }
      const mse = sum / (first.width * first.height * 3);
      setMetrics({ mse, psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse) });
    }).catch(() => setMetrics(null));
    return () => { active = false; };
  }, [cover, stego]);
  if (!metrics) return null;
  if (metrics.error) return <p className="empty-analysis">{metrics.error}</p>;
  return <div className="quality-metrics"><span>MSE <strong>{metrics.mse.toFixed(4)}</strong></span><span>PSNR <strong>{Number.isFinite(metrics.psnr) ? `${metrics.psnr.toFixed(2)} dB` : "∞ (identical pixels)"}</strong></span></div>;
}

function HistogramComparison({ analysis, channel, difference }) {
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  useEffect(() => {
    if (!analysis?.dimensions_match) return undefined;
    const draw = () => {
      const selected = channel === "rgb" ? ["red", "green", "blue"] : [channel === "grayscale" ? "grayscale" : channel];
      const colors = { red: "#ef8e92", green: "#6cc394", blue: "#22d3ee", grayscale: "#a78bfa" };
      [leftRef.current, rightRef.current].forEach((canvas, side) => {
        if (!canvas) return;
        const width = canvas.clientWidth || 260;
        const height = 150;
        const scale = window.devicePixelRatio || 1;
        canvas.width = width * scale;
        canvas.height = height * scale;
        const context = canvas.getContext("2d");
        context.setTransform(scale, 0, 0, scale, 0, 0);
        context.clearRect(0, 0, width, height);
        const values = analysis.histograms[side ? "stego" : "original"];
        const max = Math.max(...selected.flatMap((name) => values[name]), 0.01);
        selected.forEach((name) => {
          context.strokeStyle = colors[name];
          context.lineWidth = 1.5;
          context.beginPath();
          values[name].forEach((value, index) => {
            const x = index * width / 255;
            const y = height - value * height / max;
            index ? context.lineTo(x, y) : context.moveTo(x, y);
          });
          context.stroke();
        });
        if (difference) {
          const first = analysis.histograms.original[selected[0]];
          const second = analysis.histograms.stego[selected[0]];
          context.strokeStyle = "#f8c56d";
          context.beginPath();
          first.forEach((value, index) => {
            const x = index * width / 255;
            const y = height / 2 - (value - second[index]) * height / max;
            index ? context.lineTo(x, y) : context.moveTo(x, y);
          });
          context.stroke();
          context.strokeStyle = "rgba(255,255,255,.5)";
          context.beginPath();
          context.moveTo(0, height / 2);
          context.lineTo(width, height / 2);
          context.stroke();
        }
      });
    };
    draw();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(draw);
    if (observer) {
      observer.observe(leftRef.current?.parentElement);
      observer.observe(rightRef.current?.parentElement);
    } else window.addEventListener("resize", draw);
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", draw);
    };
  }, [analysis, channel, difference]);
  if (!analysis?.dimensions_match) return <p className="empty-analysis">No comparison yet. Encode audio to inspect the cover and stego image.</p>;
  const selectedLabel = channel === "rgb" ? "RGB channels" : `${channel} channel`;
  return <><div className="histogram-comparison"><div><h3>Original cover</h3><canvas ref={leftRef} className="histogram-canvas" /><div className="chart-axis"><span>0</span><span>Pixel intensity (0–255)</span><span>255</span></div></div><div><h3>Encoded stego</h3><canvas ref={rightRef} className="histogram-canvas" /><div className="chart-axis"><span>0</span><span>Pixel intensity (0–255)</span><span>255</span></div></div></div><div className="chart-y-label">Share of pixels (%)</div><div className="legend chart-legend"><span><i className="legend-line cover-line" />Cover (faint)</span><span><i className="legend-line stego-line" />Stego (solid)</span><span className="legend-channel">{selectedLabel}</span>{difference && <span><i className="legend-line difference-line" />Difference from cover</span>}</div></>;
}

function PixelMatrix({ analysis }) {
  const [selected, setSelected] = useState({ x: 0, y: 0 });
  if (!analysis?.region) return <p className="empty-analysis">No pixel region yet. Encode audio to inspect synchronized cover and stego pixels.</p>;
  const selectPixel = (x, y) => setSelected({ x, y });
  const render = (values, other, label) => (
    <div>
      <h3>{label}</h3>
      <div className="pixel-matrix" style={{ "--pixel-size": analysis.region.size }}>
        {values.map((row, y) => row.map((pixel, x) => {
          const changed = pixel.some((value, channel) => value !== other[y][x][channel]);
          const active = selected.x === x && selected.y === y;
          return (
            <button
              className={`pixel ${changed ? "changed" : ""} ${active ? "selected" : ""}`}
              key={`${x}-${y}`}
              type="button"
              onClick={() => selectPixel(x, y)}
              style={{ "--pixel-color": `rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${pixel[3] / 255})` }}
              aria-label={`${label} pixel at ${analysis.region.x + x}, ${analysis.region.y + y}`}
            />
          );
        }))}
      </div>
    </div>
  );
  const original = analysis.region.original[selected.y]?.[selected.x] || [0, 0, 0, 0];
  const stego = analysis.region.stego[selected.y]?.[selected.x] || [0, 0, 0, 0];
  return (
    <div className="pixel-inspector">
      <div className="pixel-comparison">
        {render(analysis.region.original, analysis.region.stego, "Original cover")}
        {render(analysis.region.stego, analysis.region.original, "Encoded stego")}
      </div>
      <div className="selected-pixel">
        <strong>Selected pixel</strong>
        <span>Coordinates ({analysis.region.x + selected.x}, {analysis.region.y + selected.y})</span>
        <span>Original RGBA ({original.join(", ")})</span>
        <span>Encoded RGBA ({stego.join(", ")})</span>
      </div>
      <div className="pixel-legend"><span><i className="pixel-swatch changed-swatch" />Changed RGB channel</span><span><i className="pixel-swatch selected-swatch" />Selected coordinate</span></div>
    </div>
  );
}

function ComparisonSummary({ analysis }) {
  if (!analysis?.dimensions_match) return null;
  const psnr = Number.isFinite(analysis.psnr) ? `${analysis.psnr.toFixed(2)} dB` : "Infinity";
  return (
    <div className="comparison-summary" aria-label="Comparison summary">
      <div className={`summary-stat ${analysis.pixel_equal ? "good" : "attention"}`}>
        <span>Pixel match</span>
        <strong>{analysis.pixel_equal ? "Exact" : "Changed"}</strong>
      </div>
      <div className="summary-stat">
        <span>Changed pixels</span>
        <strong>{analysis.changed_pixel_percentage.toFixed(3)}%</strong>
      </div>
      <div className="summary-stat">
        <span>MSE</span>
        <strong>{analysis.mse.toFixed(4)}</strong>
      </div>
      <div className="summary-stat">
        <span>PSNR</span>
        <strong>{psnr}</strong>
      </div>
    </div>
  );
}

function AnalysisTabs({
  analysis,
  cover,
  stego,
  analysisError,
  analysisTab,
  setAnalysisTab,
  channel,
  setChannel,
  showHistogramDifference,
  setShowHistogramDifference,
  regionSize,
  setRegionSize,
  regionX,
  setRegionX,
  regionY,
  setRegionY,
  refreshAnalysis,
  operationMethod,
}) {
  const comparisonAvailable = Boolean(analysis?.dimensions_match && cover && stego);
  const tabs = [
    ["overview", "Overview"],
    ["pixels", "Pixel inspector"],
    ["technical", "Technical details"],
  ];
  return (
    <section className="analysis-content">
      <div className="analysis-tabs" role="tablist" aria-label="Analysis views">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={analysisTab === id ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={analysisTab === id}
            onClick={() => setAnalysisTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="operation-context">{operationMethod ? `Results from Encode · ${operationMethod === "lsb" ? "LSB" : "PNG Chunk"}` : "Awaiting an encode result"}</div>
      {analysisError && <div className="error-message" role="alert">{analysisError}</div>}
      {analysisTab === "overview" && (
        <>
          <ComparisonSummary analysis={analysis} />
          <div className="analysis-controls">
            <label>Channel <select value={channel} disabled={!comparisonAvailable} onChange={(event) => setChannel(event.target.value)}><option value="rgb">RGB</option><option value="red">Red</option><option value="green">Green</option><option value="blue">Blue</option><option value="grayscale">Grayscale</option></select></label>
            <label className={!comparisonAvailable ? "control-disabled" : ""}><input type="checkbox" checked={showHistogramDifference} disabled={!comparisonAvailable} onChange={(event) => setShowHistogramDifference(event.target.checked)} /> Difference view</label>
          </div>
          <HistogramComparison analysis={analysis} channel={channel} difference={showHistogramDifference} />
          <ImageQuality cover={cover} stego={stego} />
          <details className="collapsible-analysis">
            <summary>Difference map <span>Show changed-channel intensity by pixel</span></summary>
            <DifferenceMap analysis={analysis} />
          </details>
        </>
      )}
      {analysisTab === "pixels" && (
        <>
          <div className="pixel-controls">
            <label>Region <select disabled={!comparisonAvailable} value={regionSize} onChange={(event) => { const size = Number(event.target.value); setRegionSize(size); refreshAnalysis(regionX, regionY, size); }}><option value="8">8 × 8</option><option value="16">16 × 16</option><option value="32">32 × 32</option></select></label>
            <label className={!comparisonAvailable ? "control-disabled" : ""}>X <input disabled={!comparisonAvailable} type="number" min="0" value={regionX} onChange={(event) => { const x = Number(event.target.value); setRegionX(x); }} /></label>
            <label className={!comparisonAvailable ? "control-disabled" : ""}>Y <input disabled={!comparisonAvailable} type="number" min="0" value={regionY} onChange={(event) => { const y = Number(event.target.value); setRegionY(y); }} /></label>
            <button type="button" className="secondary-button" disabled={!comparisonAvailable} onClick={() => refreshAnalysis(regionX, regionY, regionSize)}>Update region</button>
          </div>
          <PixelMatrix analysis={analysis} />
        </>
      )}
      {analysisTab === "technical" && (
        <>
          <IntegrityStats analysis={analysis} />
          <p className="panel-note">Pixel hashes are hashes of decoded RGBA buffers, not PNG file hashes. LSB changes are measured; PNG Chunk should produce exact equality.</p>
        </>
      )}
    </section>
  );
}

function DifferenceMap({ analysis }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!analysis?.difference_map || !canvasRef.current) return undefined;
    const map = analysis.difference_map;
    const canvas = canvasRef.current;
    const draw = () => {
      const width = canvas.clientWidth || map.width;
      const height = canvas.clientHeight || 180;
      const scale = window.devicePixelRatio || 1;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      context.setTransform(scale, 0, 0, scale, 0, 0);
      const cellWidth = width / map.width;
      const cellHeight = height / map.height;
      map.values.forEach((row, y) => row.forEach((value, x) => {
        context.fillStyle = value === 0 ? "#101827" : `rgb(255,${Math.max(20, 220 - value)},${Math.max(20, 220 - value)})`;
        context.fillRect(x * cellWidth, y * cellHeight, cellWidth + 1, cellHeight + 1);
      }));
    };
    draw();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(draw);
    observer?.observe(canvas.parentElement);
    if (!observer) window.addEventListener("resize", draw);
    return () => { observer?.disconnect(); if (!observer) window.removeEventListener("resize", draw); };
  }, [analysis]);
  return analysis?.difference_map ? <div><canvas ref={canvasRef} className="difference-map" /><div className="difference-legend"><span>Zero difference</span><span>Maximum absolute channel difference</span></div></div> : null;
}

function IntegrityStats({ analysis }) {
  if (!analysis?.dimensions_match) return null;
  const rows = [
    ["Pixel equality", analysis.pixel_equal ? "YES" : "NO"],
    ["Total pixels", analysis.pixel_count],
    ["Changed pixels", `${analysis.changed_pixel_count} (${analysis.changed_pixel_percentage.toFixed(3)}%)`],
    ["Changed RGB channels", analysis.changed_channel_count],
    ["Maximum channel difference", analysis.max_channel_difference],
    ["Mean absolute error", analysis.mean_absolute_error.toFixed(4)],
    ["MSE", analysis.mse.toFixed(4)],
    ["PSNR", Number.isFinite(analysis.psnr) ? `${analysis.psnr.toFixed(2)} dB` : "Infinity"],
    ["Original RGBA pixel SHA-256", analysis.original_pixel_sha256],
    ["Stego RGBA pixel SHA-256", analysis.stego_pixel_sha256],
  ];
  return <div className="integrity-stats">{rows.map(([label, value]) => <div className="measurement" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}

function PerformancePanel({ encoding, decoding, encodeMethod, decodeMethod }) {
  const frontendLabels = { requestToHeadersMs: "Frontend to headers", responseTransferMs: "Response body download", requestDurationMs: "Frontend request total", frontend_operation_ms: "Frontend operation total" };
  return <section className="panel performance-panel"><PanelHeading eyebrow="04 / PERFORMANCE" title="Performance & remarks" /><p className="panel-note">Summaries show server processing and total browser elapsed time separately. Expand a run for stage timings.</p><div className="measurement-group"><div className="operation-context">{`Encode · ${encodeMethod === "lsb" ? "LSB" : "PNG Chunk"}`}</div><TimingBreakdown kind="Encoding" record={encoding} labels={{ file_validation_ms: "File validation", scrypt_key_derivation_ms: "Scrypt derivation", aes_gcm_encryption_ms: "AES-GCM encryption", payload_embedding_ms: "Payload embedding", backend_processing_ms: "Server processing", ...frontendLabels }} /></div><div className="measurement-group"><div className="operation-context">{`Decode · ${decodeMethod === "lsb" ? "LSB" : "PNG Chunk"}`}</div><TimingBreakdown kind="Decoding" record={decoding} labels={{ png_validation_ms: "PNG validation", payload_extraction_ms: "Payload extraction", scrypt_key_derivation_ms: "Scrypt derivation", aes_gcm_decryption_ms: "AES-GCM decrypt/auth", wav_validation_ms: "WAV validation", backend_processing_ms: "Server processing", ...frontendLabels }} /></div></section>;
}

function App() {
  const [mode, setMode] = useState("hide");
  const [apiStatus, setApiStatus] = useState("checking");
  const [wav, setWav] = useState(null);
  const [image, setImage] = useState(null);
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState("chunk");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const imageUrl = useRef(null);

  useEffect(() => {
    let active = true;
    checkHealth().then((healthy) => active && setApiStatus(healthy ? "connected" : "unavailable"));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    return () => {
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    };
  }, []);

  const selectImage = (file) => {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    imageUrl.current = file ? URL.createObjectURL(file) : null;
    setImage(file);
    setError("");
  };

  const reset = () => {
    setWav(null);
    selectImage(null);
    setPassword("");
    setError("");
    setResult(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const blob = mode === "hide"
        ? await hideAudio({ wav, image, password, method })
        : await recoverAudio({ image, password, method });
      setResult({ type: mode, blob });
    } catch (requestError) {
      setError(requestError.message || "The operation could not be completed.");
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = Boolean(image && password && (mode === "recover" || wav)) && !loading;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <ProductMark />
          <div><strong>Audio / Image</strong><span>STEGANOGRAPHY WORKBENCH</span></div>
        </div>
        <nav className="main-nav" aria-label="Primary navigation">
          <button className={mode === "hide" ? "active" : ""} onClick={() => { setMode("hide"); setResult(null); setError(""); }} type="button">Hide Audio</button>
          <button className={mode === "recover" ? "active" : ""} onClick={() => { setMode("recover"); setResult(null); setError(""); }} type="button">Recover Audio</button>
        </nav>
        <StatusIndicator status={apiStatus} />
      </header>

      <main className="workspace">
        <div className="intro">
          <div>
            <span className="eyebrow">
              {mode === "hide" ? "SECURE MEDIA / ENCODE" : "SECURE MEDIA / DECODE"}
            </span>
            <h1>{mode === "hide" ? "Hide audio inside an image" : "Recover your original audio"}</h1>
            <p>{mode === "hide"
              ? "Encrypt a WAV file and embed it into a PNG image."
              : "Extract the encrypted payload and recover the WAV using the correct password and embedding method."}</p>
          </div>
          <div className="mode-label"><span className="mode-line" />{mode === "hide" ? "ENCODE" : "DECODE"}</div>
        </div>

        {result ? <Result type={result.type} blob={result.blob} onReset={reset} /> : (
          <form className="workspace-grid" onSubmit={submit}>
            <div className="input-column">
              {mode === "hide" && (
                <FileDrop id="wav-file" label="Audio file" hint="Required / WAV" accept=".wav,audio/wav" file={wav} onFile={(file) => { setWav(file); setError(""); }} onRemove={() => setWav(null)} />
              )}
              <FileDrop
                id="png-file"
                label={mode === "hide" ? "Cover image" : "Stego image"}
                hint="Required / PNG"
                accept=".png,image/png"
                file={image}
                onFile={selectImage}
                onRemove={() => selectImage(null)}
                preview={imageUrl.current && <img src={imageUrl.current} alt="" className="image-preview" />}
              />
            </div>
            <div className="settings-column">
              <MethodSelector method={method} onChange={setMethod} />
              <div className="field-group">
                <div className="field-heading"><label htmlFor="password">Password</label><span>Required</span></div>
                <PasswordField id="password" value={password} onChange={setPassword} />
                <p className="field-note">The same password is required to recover this audio. It is never stored.</p>
              </div>
              <div className="submit-area">
                {error && <div className="error-message" role="alert"><span>!</span>{error}</div>}
                <button className="primary-button submit-button" type="submit" disabled={!canSubmit}>
                  {loading ? <><span className="spinner" aria-hidden="true" />{mode === "hide" ? "Encrypting..." : "Recovering..."}</> : mode === "hide" ? "Encrypt & Hide Audio" : "Recover Audio"}
                  {!loading && <span aria-hidden="true">→</span>}
                </button>
                <p className="security-note"><span>▣</span> AES-256-GCM authenticated encryption</p>
              </div>
            </div>
          </form>
        )}
      </main>
      <footer className="footer">
        <span>Built by Pranav K M</span>
        <a href="https://github.com/PranavKoodanda" target="_blank" rel="noopener noreferrer">GitHub Profile</a>
      </footer>
    </div>
  );
}

function WorkbenchPanels({
  panel,
  encode,
  decode,
  wav,
  cover,
  decodeImage,
  encodeMethod,
  setEncodeMethod,
  decodeMethod,
  setDecodeMethod,
  encodePassword,
  setEncodePassword,
  decodePassword,
  setDecodePassword,
  busy,
  errors,
  encoding,
  generatedStegoUrl,
  decoding,
  selectWav,
  selectCover,
  selectDecodeImage,
  generatedStego,
  useStegoForDecode,
  analysisProps,
}) {
  return (
    <div className="panel-columns">
      <div className="panel-column panel-column-tasks">
        {panel(1, "Encode audio", <><form onSubmit={encode}><FileDrop id="encode-wav" label="WAV audio" hint="Required" accept=".wav,audio/wav" file={wav} onFile={selectWav} onRemove={() => selectWav(null)} /><FileDrop id="cover-png" label="Cover PNG image" hint="Required" accept=".png,image/png" file={cover} onFile={selectCover} onRemove={() => selectCover(null)} /><MethodSelector method={encodeMethod} onChange={setEncodeMethod} /><div className="field-group"><div className="field-heading"><label htmlFor="encode-password">Password</label><span>Required</span></div><PasswordField id="encode-password" value={encodePassword} onChange={setEncodePassword} /></div><button className="primary-button submit-button" type="submit" disabled={!wav || !cover || !encodePassword || busy}>{busy === "encode" ? "Encoding..." : "Encrypt & hide audio"}</button>{errors.encode && <div className="error-message" role="alert">{errors.encode}</div>}</form>{encoding && <div className="success-area"><strong>Stego PNG ready</strong><span>{formatBytes(encoding.metadata.stego_image_size)} · download or continue to decoding</span><div><a className="download-link" href={generatedStegoUrl} download="stego.png">Download PNG</a><button type="button" className="secondary-button" onClick={useStegoForDecode}>Use this image to decode</button></div></div>}</>)}
        {panel(3, "Decode audio", <><form onSubmit={decode}><FileDrop id="stego-png" label="Stego PNG image" hint="Required" accept=".png,image/png" file={decodeImage} onFile={selectDecodeImage} onRemove={() => selectDecodeImage(null)} /><MethodSelector method={decodeMethod} onChange={setDecodeMethod} /><div className="field-group"><div className="field-heading"><label htmlFor="decode-password">Password</label><span>Required</span></div><PasswordField id="decode-password" value={decodePassword} onChange={setDecodePassword} /></div><button className="primary-button submit-button" type="submit" disabled={!decodeImage || !decodePassword || busy}>{busy === "decode" ? "Recovering..." : "Recover audio"}</button>{errors.decode && <div className="error-message" role="alert">{errors.decode}</div>}</form>{decoding && <div className="success-area"><strong>WAV recovered successfully</strong><span>{formatBytes(decoding.blob.size)} · exact bytes returned</span><button className="download-link" type="button" onClick={() => downloadBlob(decoding.blob, "recovered.wav")}>Download WAV</button></div>}</>)}
      </div>
      <div className="panel-column panel-column-results">
        {panel(2, "Analysis", <AnalysisTabs {...analysisProps} />)}
        <PerformancePanel encoding={encoding} decoding={decoding} encodeMethod={encodeMethod} decodeMethod={decodeMethod} />
      </div>
    </div>
  );
}

function EnhancedApp() {
  const [apiStatus, setApiStatus] = useState("checking");
  const [wav, setWav] = useState(null);
  const [cover, setCover] = useState(null);
  const [generatedStego, setGeneratedStego] = useState(null);
  const [decodeImage, setDecodeImage] = useState(null);
  const [coverUrl, setCoverUrl] = useState(null);
  const [generatedStegoUrl, setGeneratedStegoUrl] = useState(null);
  const [decodeImageUrl, setDecodeImageUrl] = useState(null);
  const [encodePassword, setEncodePassword] = useState("");
  const [decodePassword, setDecodePassword] = useState("");
  const [encodeMethod, setEncodeMethod] = useState("chunk");
  const [decodeMethod, setDecodeMethod] = useState("chunk");
  const [channel, setChannel] = useState("rgb");
  const [showHistogramDifference, setShowHistogramDifference] = useState(false);
  const [regionSize, setRegionSize] = useState(16);
  const [regionX, setRegionX] = useState(0);
  const [regionY, setRegionY] = useState(0);
  const [analysis, setAnalysis] = useState(null);
  const [analysisTab, setAnalysisTab] = useState("overview");
  const [analysisError, setAnalysisError] = useState("");
  const [encoding, setEncoding] = useState(null);
  const [decoding, setDecoding] = useState(null);
  const [errors, setErrors] = useState({ encode: "", decode: "" });
  const [busy, setBusy] = useState("");

  useEffect(() => { checkHealth().then((healthy) => setApiStatus(healthy ? "connected" : "unavailable")); }, []);
  useEffect(() => () => {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    if (generatedStegoUrl) URL.revokeObjectURL(generatedStegoUrl);
    if (decodeImageUrl) URL.revokeObjectURL(decodeImageUrl);
  }, [coverUrl, generatedStegoUrl, decodeImageUrl]);

  const selectCover = (file) => {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    setCover(file);
    setCoverUrl(file ? URL.createObjectURL(file) : null);
    setEncoding(null);
    setGeneratedStego(null);
    setAnalysis(null);
    setAnalysisTab("overview");
    setAnalysisError("");
    if (generatedStegoUrl) URL.revokeObjectURL(generatedStegoUrl);
    setGeneratedStegoUrl(null);
  };
  const selectWav = (file) => {
    setWav(file);
    setEncoding(null);
    setGeneratedStego(null);
    setAnalysis(null);
    setAnalysisTab("overview");
    setAnalysisError("");
    if (generatedStegoUrl) URL.revokeObjectURL(generatedStegoUrl);
    setGeneratedStegoUrl(null);
  };
  const selectDecodeImage = (file) => {
    if (decodeImageUrl) URL.revokeObjectURL(decodeImageUrl);
    setDecodeImage(file);
    setDecoding(null);
    setDecodeImageUrl(file ? URL.createObjectURL(file) : null);
  };
  const useStegoForDecode = () => {
    if (!generatedStego) return;
    selectDecodeImage(generatedStego);
    setDecodeMethod(encodeMethod);
  };
  const encode = async (event) => {
    event.preventDefault();
    setErrors((current) => ({ ...current, encode: "" }));
    setEncoding(null);
    setGeneratedStego(null);
    if (generatedStegoUrl) URL.revokeObjectURL(generatedStegoUrl);
    setGeneratedStegoUrl(null);
    setBusy("encode");
    const started = performance.now();
    try {
      const response = await hideAudio({ wav, image: cover, password: encodePassword, method: encodeMethod });
      setEncoding({ ...response.server, timings: { ...response.server.timings, ...response.frontend, frontend_operation_ms: performance.now() - started }, date: new Date().toISOString() });
      setGeneratedStego(new File([response.blob], "stego.png", { type: "image/png" }));
      if (generatedStegoUrl) URL.revokeObjectURL(generatedStegoUrl);
      setGeneratedStegoUrl(URL.createObjectURL(response.blob));
      setAnalysis(await analyzeImages({
        original: cover,
        stego: response.blob,
        x: regionX,
        y: regionY,
        size: regionSize,
      }));
      setAnalysisError("");
    } catch (error) {
      setErrors((current) => ({ ...current, encode: error.message }));
      setAnalysis(null);
      setAnalysisError("Pixel analysis could not be completed.");
    } finally { setBusy(""); }
  };
  const decode = async (event) => {
    event.preventDefault();
    setErrors((current) => ({ ...current, decode: "" }));
    setDecoding(null);
    setBusy("decode");
    const started = performance.now();
    try {
      const response = await recoverAudio({ image: decodeImage, password: decodePassword, method: decodeMethod });
      setDecoding({ ...response.server, timings: { ...response.server.timings, ...response.frontend, frontend_operation_ms: performance.now() - started }, blob: response.blob, date: new Date().toISOString() });
    } catch (error) {
      setErrors((current) => ({ ...current, decode: error.message }));
    } finally { setBusy(""); }
  };
  const panel = (number, title, content) => <section className="panel"><PanelHeading eyebrow={`0${number} / ${title.toUpperCase()}`} title={title} />{content}</section>;
  const refreshAnalysis = async (x, y, size) => {
    if (!cover || !generatedStego) return;
    setAnalysis(null);
    setAnalysisError("");
    try {
      setAnalysis(await analyzeImages({ original: cover, stego: generatedStego, x, y, size }));
    } catch (error) {
      setAnalysisError(error.message || "Pixel analysis could not be completed.");
    }
  };
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><ProductMark /><div><strong>Audio / Image</strong><span>STEGANOGRAPHY WORKBENCH</span></div></div><StatusIndicator status={apiStatus} /></header>
    <main className="workspace"><div className="intro"><div><span className="eyebrow">SECURE MEDIA / ANALYSIS WORKBENCH</span><h1>Audio-in-Image Steganography</h1><p>Encrypt WAV audio, embed it in PNG, and inspect actual image and timing results.</p></div></div>
    <WorkbenchPanels panel={panel} encode={encode} decode={decode} wav={wav} cover={cover} decodeImage={decodeImage} encodeMethod={encodeMethod} setEncodeMethod={setEncodeMethod} decodeMethod={decodeMethod} setDecodeMethod={setDecodeMethod} encodePassword={encodePassword} setEncodePassword={setEncodePassword} decodePassword={decodePassword} setDecodePassword={setDecodePassword} busy={busy} errors={errors} encoding={encoding} generatedStegoUrl={generatedStegoUrl} generatedStego={generatedStego} decoding={decoding} selectWav={selectWav} selectCover={selectCover} selectDecodeImage={selectDecodeImage} useStegoForDecode={useStegoForDecode} analysisProps={{ analysis, cover, stego: generatedStego, operationMethod: encoding ? encodeMethod : null, analysisError, analysisTab, setAnalysisTab, channel, setChannel, showHistogramDifference, setShowHistogramDifference, regionSize, setRegionSize, regionX, setRegionX, regionY, setRegionY, refreshAnalysis }} />
    </main>
    <footer className="footer"><span>Built by Pranav K M</span><a href="https://github.com/PranavKoodanda" target="_blank" rel="noopener noreferrer">GitHub Profile</a></footer>
  </div>;
}

export default EnhancedApp;
