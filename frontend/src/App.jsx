import { useEffect, useRef, useState } from "react";
import { analyzeImages, checkHealth, hideAudio, recoverAudio } from "./api";
import { inspectSinglePng } from "./singleImageAnalysis";
import { DIFFERENCE_AMPLIFICATIONS, differenceDisplayIntensity } from "./differenceMap";

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

function HistogramComparison({ analysis, channel, difference, originalLabel = "Original cover", stegoLabel = "Encoded stego" }) {
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
  return <><div className="histogram-comparison"><div><h3>{originalLabel}</h3><canvas ref={leftRef} className="histogram-canvas" /><div className="chart-axis"><span>0</span><span>Pixel intensity (0–255)</span><span>255</span></div></div><div><h3>{stegoLabel}</h3><canvas ref={rightRef} className="histogram-canvas" /><div className="chart-axis"><span>0</span><span>Pixel intensity (0–255)</span><span>255</span></div></div></div><div className="chart-y-label">Share of pixels (%)</div><div className="legend chart-legend"><span><i className="legend-line cover-line" />{originalLabel}</span><span><i className="legend-line stego-line" />{stegoLabel}</span><span className="legend-channel">{selectedLabel}</span>{difference && <span><i className="legend-line difference-line" />Difference</span>}</div></>;
}

function PixelMatrix({ analysis, originalLabel = "Original cover", stegoLabel = "Encoded stego" }) {
  const [selected, setSelected] = useState({ x: 0, y: 0 });
  useEffect(() => setSelected({ x: 0, y: 0 }), [analysis?.region?.x, analysis?.region?.y, analysis?.region?.size]);
  if (!analysis?.region) return <p className="empty-analysis">No pixel region yet. Encode audio to inspect synchronized cover and stego pixels.</p>;
  const selectPixel = (x, y) => setSelected({ x, y });
  const render = (values, other, label) => (
    <div>
      <h3>{label}</h3>
      <div className="pixel-matrix" style={{ "--pixel-size": analysis.region.size }}>
        {values.map((row, y) => row.map((pixel, x) => {
          const pairedPixel = other[y]?.[x];
          const changed = pairedPixel && pixel.some((value, channel) => value !== pairedPixel[channel]);
          const active = selected.x === x && selected.y === y;
          const coordinate = `(${analysis.region.x + x}, ${analysis.region.y + y})`;
          const rgba = pixel.join(", ");
          return (
            <button
              className={`pixel ${changed ? "changed" : ""} ${active ? "selected" : ""}`}
              key={`${x}-${y}`}
              type="button"
              onClick={() => selectPixel(x, y)}
              style={{ "--pixel-color": `rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${pixel[3] / 255})` }}
              title={`${label} pixel ${coordinate}: RGBA (${rgba})${changed ? "; differs from paired pixel" : "; unchanged"}`}
              aria-label={`${label} pixel at ${coordinate}, RGBA ${rgba}${changed ? ", changed" : ", unchanged"}`}
            />
          );
        }))}
      </div>
    </div>
  );
  const original = analysis.region.original[selected.y]?.[selected.x];
  const stego = analysis.region.stego[selected.y]?.[selected.x];
  if (!original || !stego) return <p className="inline-error" role="alert">Pixel region data is incomplete; inspect the region again.</p>;
  return (
    <div className="pixel-inspector">
      <div className="pixel-comparison">
        {render(analysis.region.original, analysis.region.stego, originalLabel)}
        {render(analysis.region.stego, analysis.region.original, stegoLabel)}
      </div>
      <div className="selected-pixel">
        <strong>Selected pixel</strong>
        <span>X: {analysis.region.x + selected.x} px · Y: {analysis.region.y + selected.y} px</span>
        <span>Original RGBA ({original.join(", ")})</span>
        <span>Stego RGBA ({stego.join(", ")})</span>
        <span>ΔR: {stego[0] - original[0]} · ΔG: {stego[1] - original[1]} · ΔB: {stego[2] - original[2]} · ΔA: {stego[3] - original[3]}</span>
        <span>Pixel changed: {stego.some((value, channel) => value !== original[channel]) ? "Yes" : "No"}</span>
      </div>
      <div className="pixel-legend"><span><i className="pixel-swatch changed-swatch" />Changed: red inset frame</span><span><i className="pixel-swatch unchanged-swatch" />Unchanged: no red frame</span><span><i className="pixel-swatch selected-swatch" />Selected coordinate</span></div>
    </div>
  );
}

function SingleHistogram({ data, label, channel }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return undefined;
    const draw = () => {
      const width = canvas.clientWidth || 260;
      const height = 150;
      const scale = window.devicePixelRatio || 1;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, width, height);
      const names = channel === "rgb" ? ["red", "green", "blue"] : [channel];
      const max = Math.max(...names.flatMap((name) => data.histograms[name]), 0.01);
      const colors = { red: "#f07178", green: "#69d3a8", blue: "#7aa8ff", grayscale: "#e6edf7" };
      names.forEach((name) => {
        context.strokeStyle = colors[name];
        context.lineWidth = 1.5;
        context.beginPath();
        data.histograms[name].forEach((value, index) => {
          const px = index * width / 255;
          const py = height - value * height / max;
          index ? context.lineTo(px, py) : context.moveTo(px, py);
        });
        context.stroke();
      });
    };
    draw();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(draw);
    observer?.observe(canvas.parentElement);
    if (!observer) window.addEventListener("resize", draw);
    return () => { observer?.disconnect(); if (!observer) window.removeEventListener("resize", draw); };
  }, [data, channel]);
  return <div className="single-histogram"><h3>{label} · individual histogram</h3><canvas ref={canvasRef} className="histogram-canvas" role="img" aria-label={`${label} ${channel} histogram`} /><div className="chart-axis"><span>0</span><span>Pixel intensity (0–255)</span><span>255</span></div></div>;
}

function SinglePixelMatrix({ data, role, label, missingNotice }) {
  const [selected, setSelected] = useState({ x: 0, y: 0 });
  useEffect(() => setSelected({ x: 0, y: 0 }), [data]);
  if (!data?.region) return null;
  const values = data.region.pixels;
  const pixel = values[selected.y]?.[selected.x] || [0, 0, 0, 0];
  return <div className="pixel-inspector"><div className="pixel-comparison single-pixel"><div><h3>{label}</h3><div className="pixel-matrix" style={{ "--pixel-size": data.region.size }}>{values.map((row, y) => row.map((value, x) => <button key={`${x}-${y}`} className={`pixel ${selected.x === x && selected.y === y ? "selected" : ""}`} type="button" onClick={() => setSelected({ x, y })} style={{ "--pixel-color": `rgba(${value[0]}, ${value[1]}, ${value[2]}, ${value[3] / 255})` }} aria-label={`${role} pixel at (${data.region.x + x}, ${data.region.y + y}), RGBA ${value.join(", ")}`} title={`RGBA (${value.join(", ")})`} />))}</div></div>{missingNotice}</div><div className="selected-pixel"><strong>Selected pixel · {label}</strong><span>X: {data.region.x + selected.x} px · Y: {data.region.y + selected.y} px</span><span>RGBA ({pixel.join(", ")})</span></div></div>;
}

function MissingImageNotice({ title, children, label, onSelect }) {
  return <div className="missing-image-notice"><span className="missing-image-icon" aria-hidden="true">!</span><div><strong>{title}</strong><p>{children}</p><label className="inline-image-upload">{label}<input type="file" accept=".png,image/png" onChange={(event) => { const file = event.target.files?.[0]; if (file) onSelect(file); event.target.value = ""; }} /></label></div></div>;
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
        <strong>{analysis.changed_pixel_count.toLocaleString()}</strong>
        <small>{analysis.changed_pixel_percentage.toFixed(2)}% of image</small>
      </div>
      <div className="summary-stat"><span>Maximum RGB difference</span><strong>{analysis.max_channel_difference} / 255</strong></div>
      <div className="summary-stat"><span>Mean absolute error</span><strong>{analysis.mean_absolute_error.toFixed(4)}</strong></div>
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

function DifferenceMap({ analysis, operationMethod }) {
  const map = analysis?.difference_map;
  const canvasRef = useRef(null);
  const [amplification, setAmplification] = useState(1);
  const [hovered, setHovered] = useState(null);
  useEffect(() => {
    if (!map || !canvasRef.current) return undefined;
    const canvas = canvasRef.current;
    canvas.width = map.width;
    canvas.height = map.height;
    const context = canvas.getContext("2d");
    context.setTransform(1, 0, 0, 1, 0, 0);
    map.values.forEach((row, y) => row.forEach((value, x) => {
      const intensity = differenceDisplayIntensity(value, amplification);
      context.fillStyle = `rgb(${intensity}, 0, 0)`;
      context.fillRect(x, y, 1, 1);
    }));
    return undefined;
  }, [analysis, map, amplification]);
  if (!map) return null;
  const minimum = map.values.reduce((minValue, row) => row.reduce((rowMinimum, value) => Math.min(rowMinimum, value), minValue), Number.POSITIVE_INFINITY);
  const maximum = map.values.reduce((maxValue, row) => row.reduce((rowMaximum, value) => Math.max(rowMaximum, value), maxValue), 0);
  const saturationThreshold = Math.ceil(255 / amplification);
  const saturatedPixels = map.values.reduce((count, row) => count + row.filter((value) => value >= saturationThreshold).length, 0);
  const mapIsFullResolution = map.width === analysis.width && map.height === analysis.height;
  const interpretation = analysis.pixel_equal
    ? "0.00% of pixels changed. Decoded pixel values are identical; the maximum RGB-channel difference was 0 out of 255."
    : `${analysis.changed_pixel_percentage.toFixed(2)}% of pixels changed. The maximum RGB-channel difference was ${analysis.max_channel_difference < 255 ? "only " : ""}${analysis.max_channel_difference} out of 255.`;
  const onMapPointerMove = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = Math.min(map.width - 1, Math.floor((event.clientX - bounds.left) * map.width / bounds.width));
    const y = Math.min(map.height - 1, Math.floor((event.clientY - bounds.top) * map.height / bounds.height));
    setHovered({ x, y, difference: map.values[y][x] });
  };
  return <div className="difference-map-panel">
    <div className="difference-amplification" role="group" aria-label="Difference map display amplification">
      {DIFFERENCE_AMPLIFICATIONS.map((factor) => <button key={factor} type="button" aria-pressed={amplification === factor} className={amplification === factor ? "active" : ""} onClick={() => setAmplification(factor)}>{factor === 1 ? `Actual (1\u00d7)` : `Amplified (${factor}\u00d7)`}</button>)}
    </div>
    <p className="difference-display-label">{amplification === 1 ? `Actual difference scale (0\u2013255)` : `Amplified visual scale (actual D \u00d7 ${amplification}, clipped at 255)`}</p>
    <canvas ref={canvasRef} className="difference-map" width={map.width} height={map.height} style={{ "--difference-aspect": `${map.width} / ${map.height}` }} role="img" aria-label={`RGB difference heatmap, actual range ${minimum} to ${maximum}, display amplification ${amplification} times`} onPointerMove={onMapPointerMove} onPointerLeave={() => setHovered(null)} />
    <div className="difference-visual-scale"><span>Actual D = 0</span><div aria-hidden="true" /><span>{amplification === 1 ? "Actual D = 255" : `Actual D \u2265 ${saturationThreshold} \u2192 saturated`}</span></div>
    <div className="difference-legend"><span>Actual minimum: {minimum}</span><span>Actual maximum: {maximum}</span></div>
    {hovered ? <p className="difference-hover" aria-live="polite">{mapIsFullResolution ? "Pixel" : "Map cell"} X: {hovered.x} | Y: {hovered.y} | Actual D: {hovered.difference}/255 | Display: {differenceDisplayIntensity(hovered.difference, amplification)}/255 at {amplification}\u00d7</p> : <p className="difference-hover">Hover over the map for its coordinates and actual difference value.</p>}
    <p className="difference-interpretation">{interpretation}</p>
    <p className="panel-note">{amplification === 1 ? "Black means no RGB difference; red intensity equals the actual maximum absolute RGB-channel difference D." : "Amplified brightness is for visibility only and does not represent actual pixel-difference magnitude. Actual values and all metrics remain unchanged."} {operationMethod === "lsb" ? "LSB can change many pixels while changing each channel by only 1." : analysis.pixel_equal ? "Identical decoded pixels are expected for PNG Custom Chunk embedding." : "D is the maximum absolute difference among the red, green, and blue channels."}</p>
    {saturatedPixels > 0 && <p className="difference-saturation" role="status">Display saturation: {saturatedPixels.toLocaleString()} map {saturatedPixels === 1 ? "cell is" : "cells are"} at full red; hover to inspect actual D.</p>}
    {analysis.pixel_equal && maximum === 0 && <p className="difference-empty">No pixel differences detected.</p>}
    {!analysis.pixel_equal && maximum === 0 && <p className="difference-empty">No RGB differences detected.</p>}
  </div>;
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
          <div><strong>CIPHER FRAME</strong><span>SECURE WORKSTATION</span></div>
        </div>
        <nav className="main-nav" aria-label="Primary navigation">
          <button className={mode === "hide" ? "active" : ""} onClick={() => { setMode("hide"); setResult(null); setError(""); }} type="button">Hide Audio</button>
          <button className={mode === "recover" ? "active" : ""} onClick={() => { setMode("recover"); setResult(null); setError(""); }} type="button">Recover Audio</button>
        </nav>
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

function StegIcon({ name, size = 17 }) {
  const paths = {
    workbench: <><path d="M4 5.5h16M6.5 5.5v13h11v-13M9 9h6M9 12.5h6M9 16h3" /></>,
    histogram: <><path d="M4 19V5M4 19h16" /><path d="m6.5 15 3-4 3 2 4-6 2.5 2.5" /></>,
    pixels: <><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="6" height="6" /></>,
    decode: <><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" /><path d="M5 18v2h14v-2" /></>,
    performance: <><path d="M5 18a8 8 0 1 1 14 0" /><path d="m12 14 4-5M4 18h16" /></>,
    history: <><path d="M4 12a8 8 0 1 0 2.2-5.5L4 8.7" /><path d="M4 4v4.7h4.7M12 7v5l3 2" /></>,
    dots: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    audio: <><path d="M9 18V6l9-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="15.5" cy="16" r="2.5" /></>,
    image: <><rect x="3" y="5" width="18" height="14" rx="1" /><circle cx="8" cy="10" r="1.5" /><path d="m5 17 4.5-4 3 3 2-2 4.5 3" /></>,
    key: <><circle cx="8" cy="12" r="4" /><path d="M12 12h8M17 12v3M14 12v2" /></>,
    shield: <><path d="M12 3 5 6v5c0 4.4 2.8 8.1 7 10 4.2-1.9 7-5.6 7-10V6z" /><path d="m9 12 2 2 4-4" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const NAV_ITEMS = [
  ["workbench", "Workbench", "workbench"],
  ["histogram", "Histogram Analysis", "histogram"],
  ["pixels", "Pixel Lab", "pixels"],
  ["decode", "Decode", "decode"],
  ["performance", "Performance", "performance"],
  ["history", "Run History", "history"],
];

function Sidebar({ page, setPage, historyCount, apiStatus }) {
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><span /><span /><span /></div><div><strong>CIPHER FRAME</strong><small>Secure Audio-in-Image Steganography Workstation</small></div></div>
    <div className="project-card"><span className="eyebrow">ACTIVE PROJECT</span><strong>CIPHER FRAME</strong><span className="project-file">Secure Audio-in-Image Steganography Workstation</span></div>
    <nav className="side-nav"><span className="nav-label">INSTRUMENTS</span>{NAV_ITEMS.map(([id, label, icon]) => <button key={id} aria-label={label} title={label} className={page === id ? "active" : ""} type="button" onClick={() => setPage(id)}><StegIcon name={icon} /><span>{label}</span>{id === "history" && <b>{historyCount}</b>}</button>)}</nav>
    <div className="sidebar-bottom"><StatusIndicator status={apiStatus} /></div>
  </aside>;
}

function PipelineStep({ number, title, detail, timing }) {
  const complete = timing != null;
  return <div className={`pipeline-step ${complete ? "done" : "idle"}`}><div className="step-rail"><i>{complete ? <StegIcon name="check" size={12} /> : number}</i><span /></div><div className="step-copy"><span>{title}</span><strong>{complete ? `${timing.toFixed(2)} ms` : detail}</strong></div><b>{complete ? "DONE" : "AFTER RESPONSE"}</b></div>;
}

function Preflight({ apiStatus, wav, cover, password, method, encoding, error, analysisError }) {
  const checks = [
    ["API connectivity", apiStatus === "connected"],
    ["WAV payload selected", Boolean(wav)],
    ["PNG carrier selected", Boolean(cover)],
    ["Passphrase supplied", Boolean(password)],
    [method === "chunk" ? "PNG chunk embedding selected" : "RGB LSB embedding selected", true],
  ];
  return <div className="preflight"><span className="field-label">PRE-FLIGHT VALIDATION</span>{checks.map(([label, passed]) => <div key={label}><StegIcon name={passed ? "check" : "dots"} size={15} /><span>{label}</span><b className={passed ? "verified-text" : "pending-text"}>{passed ? "OK" : "WAIT"}</b></div>)}{error && <div className="inline-error" role="alert">{error}</div>}{encoding && !analysisError && <div className="inline-success"><StegIcon name="check" size={15} /> Stego PNG created successfully.</div>}{analysisError && <div className="inline-error" role="alert">Stego PNG created; pixel analysis failed: {analysisError}</div>}</div>;
}

function OperationState({ status }) {
  const labels = { idle: "WAITING", ready: "READY", running: "RUNNING", completed: "COMPLETED", failed: "FAILED" };
  return <span className={`operation-state ${status}`}>{labels[status] || labels.idle}</span>;
}

function PageHeader({ eyebrow, title, description, children }) {
  return <div className="page-head"><div><span className="eyebrow cyan">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{children}</div>;
}

function HistogramPage({ analysis, singleAnalysis, singleRole, singleLabel, sourceContext, hasOriginal, hasStego, originalFile, stegoFile, selectMissingOriginal, selectMissingStego, analysisLoading, analysisError, channel, setChannel, showHistogramDifference, setShowHistogramDifference, operationMethod, refreshAnalysis, regionX, regionY, regionSize }) {
  const paired = Boolean(analysis?.dimensions_match);
  const availableImage = singleAnalysis && singleRole;
  const missingStego = !hasStego && hasOriginal;
  const missingOriginal = !hasOriginal && hasStego;
  const originalLabel = sourceContext === "reference" ? "Reference Cover" : "Original Cover";
  const stegoLabel = sourceContext === "encode" ? "Generated Stego" : "Uploaded Stego";
  const comparisonLabel = sourceContext === "encode" ? "TWO-IMAGE COMPARISON · ORIGINAL COVER / GENERATED STEGO" : sourceContext === "cover-pair" ? "TWO-IMAGE COMPARISON · ORIGINAL COVER / UPLOADED STEGO" : "TWO-IMAGE COMPARISON · REFERENCE COVER / UPLOADED STEGO";
  return <><PageHeader eyebrow="IMAGE DISTRIBUTION ANALYSIS" title="Histogram Analysis" description="Inspect actual image distributions and compare images when both source roles are available."><span className={`pill ${paired ? "verified" : ""}`}>{paired ? comparisonLabel : availableImage ? `${singleLabel.toUpperCase()} ONLY` : "AWAITING IMAGE"}</span></PageHeader><section className="panel instrument-panel">
    <div className="analysis-controls"><label>Channel <select value={channel} disabled={analysisLoading} onChange={(event) => setChannel(event.target.value)}><option value="rgb">RGB</option><option value="red">Red</option><option value="green">Green</option><option value="blue">Blue</option><option value="grayscale">Grayscale</option></select></label>{paired && <label><input type="checkbox" checked={showHistogramDifference} disabled={analysisLoading} onChange={(event) => setShowHistogramDifference(event.target.checked)} /> Difference histogram</label>}</div>
    {analysisLoading && <p className="region-loading" role="status">Reading actual image pixels…</p>}{analysisError && <div className="inline-error" role="alert"><span>{analysisError}</span><button type="button" className="button" disabled={analysisLoading} onClick={() => refreshAnalysis(regionX, regionY, regionSize)}>RETRY ANALYSIS</button></div>}
    {paired ? <><ComparisonSummary analysis={analysis} /><HistogramComparison analysis={analysis} channel={channel} difference={showHistogramDifference} originalLabel={originalLabel} stegoLabel={stegoLabel} /><details className="collapsible-analysis" open><summary>Difference map <span>Maximum absolute RGB-channel difference by pixel</span></summary><DifferenceMap analysis={analysis} operationMethod={operationMethod} /></details></> : availableImage ? <div className="histogram-comparison single-image-comparison"><SingleHistogram data={singleAnalysis} label={singleLabel} channel={channel} />{missingStego && <MissingImageNotice title="Stego image required" label="SELECT STEGO PNG" onSelect={selectMissingStego}>Upload or generate the encoded stego PNG to compare pixel distributions, MSE, PSNR and image differences.</MissingImageNotice>}{missingOriginal && <MissingImageNotice title="Original reference image required" label="SELECT ORIGINAL COVER" onSelect={selectMissingOriginal}>Upload the original carrier PNG to compare its pixel distributions and image differences against the stego image.</MissingImageNotice>}</div> : analysisLoading ? null : <p className="empty-analysis">Select an original cover or stego PNG to begin image analysis.</p>}
  </section></>;
}

function PixelLabPage({ analysis, singleAnalysis, singleRole, singleLabel, sourceContext, hasOriginal, hasStego, selectMissingOriginal, selectMissingStego, regionSize, setRegionSize, regionX, setRegionX, regionY, setRegionY, refreshAnalysis, analysisLoading, analysisError, operationMethod }) {
  const paired = Boolean(analysis?.dimensions_match);
  const availableImage = singleAnalysis && singleRole;
  const missingStego = !hasStego && hasOriginal;
  const missingOriginal = !hasOriginal && hasStego;
  if (!paired && !availableImage) return <><PageHeader eyebrow="DECODED PIXEL FORENSICS" title="Pixel Lab" description="Inspect actual image pixels. Comparative values are shown only when both image roles are available."><span className="pill">{analysisLoading ? "READING IMAGE" : "AWAITING IMAGE"}</span></PageHeader><section className="panel instrument-panel">{analysisLoading ? <p className="region-loading" role="status">Reading actual image pixels…</p> : <p className="empty-analysis">Select an original cover or stego PNG to inspect pixel values.</p>}{analysisError && <div className="inline-error" role="alert">{analysisError}</div>}</section></>;
  const region = analysis?.region;
  const singleRegion = singleAnalysis?.region;
  const activeRegion = paired ? region : singleRegion;
  const endX = activeRegion.x + activeRegion.size - 1;
  const endY = activeRegion.y + activeRegion.size - 1;
  const originalLabel = sourceContext === "reference" ? "Reference Cover" : "Original Cover";
  const stegoLabel = sourceContext === "encode" ? "Generated Stego" : "Uploaded Stego";
  const comparisonLabel = sourceContext === "encode" ? "TWO-IMAGE COMPARISON · ORIGINAL COVER / GENERATED STEGO" : sourceContext === "cover-pair" ? "TWO-IMAGE COMPARISON · ORIGINAL COVER / UPLOADED STEGO" : "TWO-IMAGE COMPARISON · REFERENCE COVER / UPLOADED STEGO";
  return <><PageHeader eyebrow="DECODED PIXEL FORENSICS" title="Pixel Lab" description="Inspect actual original and stego pixel values. Comparative values are shown only when both images are available."><span className="pill">{paired ? comparisonLabel : `${singleLabel.toUpperCase()} ONLY`}</span></PageHeader><section className="panel instrument-panel">
    <div className="pixel-controls">
      <label htmlFor="pixel-region-size">Region size</label><select id="pixel-region-size" disabled={analysisLoading} value={regionSize} onChange={(event) => setRegionSize(Number(event.target.value))}><option value="8">8 × 8</option><option value="16">16 × 16</option><option value="32">32 × 32</option></select>
      <label htmlFor="pixel-region-x">Top-left X (pixels)</label><input id="pixel-region-x" disabled={analysisLoading} type="number" min="0" step="1" value={regionX} onChange={(event) => setRegionX(Number(event.target.value))} />
      <label htmlFor="pixel-region-y">Top-left Y (pixels)</label><input id="pixel-region-y" disabled={analysisLoading} type="number" min="0" step="1" value={regionY} onChange={(event) => setRegionY(Number(event.target.value))} />
      <button type="button" className="secondary-button" disabled={analysisLoading} onClick={() => refreshAnalysis(regionX, regionY, regionSize)}>{analysisLoading ? "INSPECTING..." : "INSPECT REGION"}</button>
    </div>
    <p className="region-help">Region size determines the number of inspected pixels. Top-left X is the horizontal starting coordinate; top-left Y is the vertical starting coordinate. {paired ? "Both images use the same coordinates and dimensions." : "Coordinates refer to the available image."} Image dimensions: {paired ? `${analysis.width} × ${analysis.height}` : `${singleAnalysis.width} × ${singleAnalysis.height}`} pixels.</p>
    <p className="region-summary" aria-live="polite">Displayed range: X {activeRegion.x}–{endX}, Y {activeRegion.y}–{endY} · {activeRegion.size * activeRegion.size} pixels</p>
    {analysisLoading && <p className="region-loading" role="status">Inspecting region; the previous valid comparison remains visible.</p>}
    {analysisError && <div className="inline-error" role="alert">{analysisError}</div>}
    {paired ? <><PixelMatrix analysis={analysis} originalLabel={originalLabel} stegoLabel={stegoLabel} /></> : <SinglePixelMatrix data={singleAnalysis} role={singleRole} label={singleLabel} missingNotice={missingStego ? <MissingImageNotice title="Stego image required to perform pixel comparison." label="SELECT STEGO PNG" onSelect={selectMissingStego}>The original matrix shows actual cover RGBA values. The stego matrix, changed-pixel count, channel deltas, difference map and image metrics require the encoded stego PNG.</MissingImageNotice> : <MissingImageNotice title="Original reference image required for comparative analysis." label="SELECT ORIGINAL COVER" onSelect={selectMissingOriginal}>The stego matrix shows actual pixel values. Changed-pixel count, channel differences, difference map, MAE, MSE and PSNR require the original carrier.</MissingImageNotice>} />}
  </section></>;
}

function DecodePage({ decode, decodeImage, selectDecodeImage, referenceImage, selectReferenceImage, decodeMethod, setDecodeMethod, decodePassword, setDecodePassword, decoding, error, busy, onWorkbench }) {
  return <><PageHeader eyebrow="AUTHENTICATED RECOVERY" title="Decode & Recover" description="Extract, authenticate, decrypt, and download the original WAV payload."><OperationState status={busy === "decode" ? "running" : decoding ? "completed" : error ? "failed" : "ready"} /></PageHeader><section className="panel instrument-panel decode-page-panel"><form className="decode-page-form" onSubmit={decode}><FileDrop id="decode-page-image" label="STEGO PNG INPUT" hint="Required" accept=".png,image/png" file={decodeImage} onFile={selectDecodeImage} onRemove={() => selectDecodeImage(null)} /><FileDrop id="reference-cover" label="REFERENCE COVER (OPTIONAL)" hint="For image comparison" accept=".png,image/png" file={referenceImage} onFile={selectReferenceImage} onRemove={() => selectReferenceImage(null)} /><MethodSelector method={decodeMethod} onChange={setDecodeMethod} /><div className="field-group"><div className="field-heading"><label htmlFor="decode-page-password">DECRYPTION PASSPHRASE</label><span>Required</span></div><PasswordField id="decode-page-password" value={decodePassword} onChange={setDecodePassword} /></div><button className="button primary" type="submit" disabled={!decodeImage || !decodePassword || busy}>{busy === "decode" ? "RECOVERING..." : "RECOVER AUDIO"}</button>{error && <div className="inline-error" role="alert">{error}</div>}</form><div className="decode-result-column">{decoding ? <><span className="eyebrow green">AUTHENTICATED WAV</span><h2>recovered.wav</h2><p>{formatBytes(decoding.blob.size)} · {decoding.metadata.method} · backend validation complete</p><button className="download-link" type="button" onClick={() => downloadBlob(decoding.blob, "recovered.wav")}>DOWNLOAD WAV</button></> : <><span className="eyebrow">RECOVERY STATUS</span><OperationState status={busy === "decode" ? "running" : error ? "failed" : "ready"} /><p>Use the generated stego PNG or select a compatible PNG carrier to begin recovery.</p><button type="button" className="button" onClick={onWorkbench}>OPEN WORKBENCH</button></>}</div></section></>;
}

function PerformancePage({ encoding, decoding, encodeMethod, decodeMethod, history, onWorkbench }) {
  const completed = history.filter((record) => record.status === "completed");
  return <><PageHeader eyebrow="EXECUTION TELEMETRY" title="Performance" description="Measured frontend and backend timings from completed operations."><span className="pill">{completed.length} COMPLETED RUNS</span></PageHeader><PerformancePanel encoding={encoding} decoding={decoding} encodeMethod={encodeMethod} decodeMethod={decodeMethod} /><section className="panel history-preview"><div className="panel-head"><div><span className="section-num">H</span><strong>HISTORICAL OPERATIONS</strong></div></div>{completed.length ? completed.slice(0, 8).map((record) => <div className="history-row" key={record.id}><span>{record.operation.toUpperCase()}</span><strong>{record.filename}</strong><span>{record.method}</span><b>{record.duration_ms.toFixed(2)} ms</b><OperationState status="completed" /></div>) : <p className="panel-note">No completed operations recorded yet.</p>}</section></>;
}

function HistoryPage({ history, clearHistory }) {
  return <><PageHeader eyebrow="CASE ACTIVITY LEDGER" title="Run History" description="Local metadata for completed and failed operations. Passphrases, keys, and file contents are never stored."><button type="button" className="button" onClick={clearHistory} disabled={!history.length}>CLEAR LOCAL HISTORY</button></PageHeader><section className="panel history-panel"><div className="history-table-head"><span>OPERATION</span><span>FILE</span><span>METHOD</span><span>STATUS</span><span>DURATION</span><span>LOCAL TIME</span></div>{history.length ? history.map((record) => <div className="history-row" key={record.id}><span>{record.operation.toUpperCase()}</span><strong>{record.filename}</strong><span>{record.method}</span><OperationState status={record.status === "completed" ? "completed" : "failed"} /><b>{record.duration_ms == null ? "—" : `${record.duration_ms.toFixed(2)} ms`}</b><span>{new Date(record.created_at).toLocaleTimeString()}</span></div>) : <p className="panel-note">No local operations recorded yet.</p>}</section></>;
}

function WorkbenchPanels({
  encode,
  decode,
  wav,
  cover,
  referenceImage,
  selectReferenceImage,
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
  apiStatus,
  page,
  history,
  clearHistory,
  encodeStatus,
  decodeStatus,
  setPage,
}) {
  const panel = (number, title, content, className = "") => <section className={`panel ${className}`}><div className="panel-head"><div><span className="section-num">{number}</span><strong>{title}</strong></div></div>{content}</section>;
  if (page === "histogram") return <HistogramPage {...analysisProps} />;
  if (page === "pixels") return <PixelLabPage {...analysisProps} />;
  if (page === "decode") return <DecodePage decode={decode} decodeImage={decodeImage} selectDecodeImage={selectDecodeImage} referenceImage={referenceImage} selectReferenceImage={selectReferenceImage} decodeMethod={decodeMethod} setDecodeMethod={setDecodeMethod} decodePassword={decodePassword} setDecodePassword={setDecodePassword} decoding={decoding} error={errors.decode} busy={busy} onWorkbench={() => setPage("workbench")} />;
  if (page === "performance") return <PerformancePage encoding={encoding} decoding={decoding} encodeMethod={encodeMethod} decodeMethod={decodeMethod} history={history} onWorkbench={() => setPage("workbench")} />;
  if (page === "history") return <HistoryPage history={history} clearHistory={clearHistory} />;
  return <>
    <PageHeader eyebrow="ENCODING WORKSPACE" title="Cryptographic Workbench" description="Encrypt WAV payloads and embed authenticated ciphertext into PNG carriers."><OperationState status={encodeStatus} /></PageHeader>
    <div className="workbench-grid">
      {panel("01", "INPUT MATERIAL", <div className="panel-body"><form className="compact-form" onSubmit={encode}><FileDrop id="encode-wav" label="WAV AUDIO PAYLOAD" hint="Required" accept=".wav,audio/wav" file={wav} onFile={selectWav} onRemove={() => selectWav(null)} /><FileDrop id="cover-png" label="PNG COVER CARRIER" hint="Required" accept=".png,image/png" file={cover} onFile={selectCover} onRemove={() => selectCover(null)} /><div className="field-group"><div className="field-heading"><label htmlFor="encode-password">ENCRYPTION PASSPHRASE</label><span>Required</span></div><PasswordField id="encode-password" value={encodePassword} onChange={setEncodePassword} /></div><MethodSelector method={encodeMethod} onChange={setEncodeMethod} /></form></div>, "input-panel")}
      {panel("02", "CRYPTOGRAPHIC PIPELINE", <><div className="request-progress" role="status">{encodeStatus === "running" ? "Hide request in progress…" : encodeStatus === "completed" ? "Backend workflow timings" : "Stage timings appear after the backend responds"}</div><div className="pipeline"><PipelineStep number="01" title="FILE VALIDATION" detail="WAV and PNG validation" timing={encoding?.timings.file_validation_ms} /><PipelineStep number="02" title="KEY DERIVATION" detail="Scrypt password-based key derivation" timing={encoding?.timings.scrypt_key_derivation_ms} /><PipelineStep number="03" title="AUTHENTICATED ENCRYPTION" detail="AES-256-GCM encryption" timing={encoding?.timings.aes_gcm_encryption_ms} /><PipelineStep number="04" title="PAYLOAD EMBEDDING" detail={encodeMethod === "chunk" ? "Custom stEg PNG chunk insertion" : "RGB channel least-significant bits"} timing={encoding?.timings.payload_embedding_ms} /><PipelineStep number="05" title="TOTAL BACKEND WORKFLOW" detail="Backend processing, including validation" timing={encoding?.timings.backend_processing_ms} /></div><div className="pipeline-note"><StegIcon name="shield" /><div><strong>Cryptographic configuration</strong><span>AES-256-GCM with Scrypt key derivation. Salt and nonce are generated by the backend.</span></div></div></>, "pipeline-panel")}
      {panel("03", "EXECUTION & VALIDATION", <div className="execution-content"><div className="execution-status"><OperationState status={encodeStatus} /></div><Preflight apiStatus={apiStatus} wav={wav} cover={cover} password={encodePassword} method={encodeMethod} encoding={encoding} error={errors.encode} analysisError={analysisProps.analysisError} />{encoding ? <div className="result-content"><div className="success-seal"><StegIcon name="check" size={25} /></div><span className="eyebrow green">ENCODING VERIFIED</span><h2>stego.png</h2><p>{formatBytes(encoding.metadata.stego_image_size)} · {encoding.metadata.image_width} × {encoding.metadata.image_height} · {encoding.metadata.method}</p><a className="button primary" href={generatedStegoUrl} download="stego.png"><StegIcon name="decode" /> DOWNLOAD STEGO PNG</a><button className="button" type="button" onClick={useStegoForDecode}>USE THIS IMAGE TO DECODE</button></div> : <><button className="button primary execute-button" type="button" onClick={encode} disabled={!wav || !cover || !encodePassword || busy}>{busy === "encode" ? "ENCODING..." : <><StegIcon name="shield" /> ENCODE & VALIDATE</>}</button><small className="action-note">Creates an authenticated encrypted stego PNG through the FastAPI workflow.</small></>}</div>, "execution-panel")}
    </div>
  </>;
}

function EnhancedApp() {
  const [apiStatus, setApiStatus] = useState("checking");
  const [wav, setWav] = useState(null);
  const [cover, setCover] = useState(null);
  const [referenceImage, setReferenceImage] = useState(null);
  const [analysisContext, setAnalysisContext] = useState("none");
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
  const [showHistogramDifference, setShowHistogramDifference] = useState(true);
  const [regionSize, setRegionSize] = useState(16);
  const [regionX, setRegionX] = useState(0);
  const [regionY, setRegionY] = useState(0);
  const [analysis, setAnalysis] = useState(null);
  const [singleAnalysis, setSingleAnalysis] = useState(null);
  const [singleRole, setSingleRole] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisTab, setAnalysisTab] = useState("overview");
  const [analysisError, setAnalysisError] = useState("");
  const analysisRequestRef = useRef(false);
  const analysisRunRef = useRef(0);
  const [encoding, setEncoding] = useState(null);
  const [decoding, setDecoding] = useState(null);
  const [errors, setErrors] = useState({ encode: "", decode: "" });
  const [busy, setBusy] = useState("");
  const [page, setPage] = useState("workbench");
  const [encodeStatus, setEncodeStatus] = useState("waiting");
  const [decodeStatus, setDecodeStatus] = useState("waiting");
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("steg-os-history") || "[]");
    } catch {
      return [];
    }
  });

  const originalSource = analysisContext === "encode" ? cover
    : analysisContext === "decode" ? referenceImage
    : analysisContext === "manual-pair" ? cover
      : analysisContext === "reference-pair" ? referenceImage
        : analysisContext === "cover" ? cover : null;
  const stegoSource = analysisContext === "encode" ? generatedStego
    : analysisContext === "decode" || analysisContext === "manual-pair" || analysisContext === "reference-pair" ? decodeImage : null;
  const singleSource = originalSource && !stegoSource ? originalSource : stegoSource && !originalSource ? stegoSource : null;
  const currentSingleRole = singleSource ? (singleSource === stegoSource ? "stego" : "original") : null;
  const currentSingleLabel = currentSingleRole === "stego" ? "Stego Image" : singleSource === referenceImage ? "Reference Cover" : "Original Cover";
  const sourceContext = analysisContext === "encode" ? "encode" : analysisContext === "manual-pair" ? "cover-pair" : "reference";

  useEffect(() => {
    if (!originalSource && !stegoSource && !singleSource) {
      analysisRunRef.current += 1;
      analysisRequestRef.current = false;
      setAnalysis(null);
      setSingleAnalysis(null);
      setSingleRole(null);
      setAnalysisLoading(false);
      setAnalysisError("");
      return undefined;
    }
    let active = true;
    const runId = ++analysisRunRef.current;
    analysisRequestRef.current = true;
    setAnalysis(null);
    setSingleAnalysis(null);
    setSingleRole(currentSingleRole);
    setAnalysisError("");
    setAnalysisLoading(true);
    const request = originalSource && stegoSource
      ? analyzeImages({ original: originalSource, stego: stegoSource, x: regionX, y: regionY, size: regionSize }).then((result) => {
        if (!result.dimensions_match) throw new Error("The original and stego images have different dimensions.");
        if (active) setAnalysis(result);
      })
      : inspectSinglePng(singleSource, { x: regionX, y: regionY, size: regionSize }).then((result) => {
        if (active) setSingleAnalysis(result);
      });
    request.catch((error) => { if (active) setAnalysisError(error.message || "Image analysis could not be completed."); }).finally(() => {
      if (active && analysisRunRef.current === runId) {
        analysisRequestRef.current = false;
        setAnalysisLoading(false);
      }
    });
    return () => { active = false; };
  }, [originalSource, stegoSource, singleSource]);

  useEffect(() => { checkHealth().then((healthy) => setApiStatus(healthy ? "connected" : "unavailable")); }, []);
  useEffect(() => { localStorage.setItem("steg-os-history", JSON.stringify(history)); }, [history]);
  useEffect(() => () => {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    if (generatedStegoUrl) URL.revokeObjectURL(generatedStegoUrl);
    if (decodeImageUrl) URL.revokeObjectURL(decodeImageUrl);
  }, [coverUrl, generatedStegoUrl, decodeImageUrl]);

  const clearEncodeResult = (nextPassword = encodePassword) => {
    setEncoding(null);
    setGeneratedStego(null);
    setAnalysis(null);
    setAnalysisContext(cover ? "cover" : "none");
    setAnalysisError("");
    setErrors((current) => ({ ...current, encode: "" }));
    setEncodeStatus(wav && cover && nextPassword ? "ready" : "waiting");
    if (generatedStegoUrl) URL.revokeObjectURL(generatedStegoUrl);
    setGeneratedStegoUrl(null);
  };
  const clearDecodeResult = (nextPassword = decodePassword) => {
    setDecoding(null);
    setErrors((current) => ({ ...current, decode: "" }));
    setDecodeStatus(decodeImage && nextPassword ? "ready" : "waiting");
  };
  const selectCover = (file) => {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    setCover(file);
    setAnalysisContext(file ? "cover" : "none");
    setCoverUrl(file ? URL.createObjectURL(file) : null);
    setEncodeStatus(file && wav && encodePassword ? "ready" : "waiting");
    setEncoding(null);
    setGeneratedStego(null);
    setErrors((current) => ({ ...current, encode: "" }));
    setAnalysis(null);
    setAnalysisTab("overview");
    setAnalysisError("");
    if (generatedStegoUrl) URL.revokeObjectURL(generatedStegoUrl);
    setGeneratedStegoUrl(null);
  };
  const selectWav = (file) => {
    setWav(file);
    setAnalysisContext(cover ? "cover" : "none");
    setEncodeStatus(file && cover && encodePassword ? "ready" : "waiting");
    setEncoding(null);
    setGeneratedStego(null);
    setErrors((current) => ({ ...current, encode: "" }));
    setAnalysis(null);
    setAnalysisTab("overview");
    setAnalysisError("");
    if (generatedStegoUrl) URL.revokeObjectURL(generatedStegoUrl);
    setGeneratedStegoUrl(null);
  };
  const selectDecodeImage = (file, context = "decode") => {
    if (decodeImageUrl) URL.revokeObjectURL(decodeImageUrl);
    setDecodeImage(file);
    setAnalysisContext(file ? context : (cover ? "cover" : "none"));
    setDecodeStatus(file ? "ready" : "waiting");
    setDecoding(null);
    setErrors((current) => ({ ...current, decode: "" }));
    setDecodeImageUrl(file ? URL.createObjectURL(file) : null);
  };
  const selectReferenceImage = (file) => {
    setReferenceImage(file);
    if (file) setAnalysisContext("decode");
    else setAnalysisContext(decodeImage ? "decode" : cover ? "cover" : "none");
  };
  const selectMissingStego = (file) => selectDecodeImage(file, referenceImage && originalSource === referenceImage ? "reference-pair" : "manual-pair");
  const selectMissingOriginal = (file) => selectReferenceImage(file);
  const useStegoForDecode = () => {
    if (!generatedStego) return;
    selectDecodeImage(generatedStego, "encode");
    setDecodeMethod(encodeMethod);
    setPage("decode");
  };
  const recordHistory = ({ operation, status, filename, method: recordMethod, durationMs, timings, metadata, error: recordError }) => {
    setHistory((current) => [{
      id: `${Date.now()}-${operation}`,
      operation,
      status,
      filename,
      method: recordMethod,
      duration_ms: durationMs,
      timings: timings || null,
      metadata: metadata || null,
      error: recordError || null,
      created_at: new Date().toISOString(),
    }, ...current].slice(0, 50));
  };
  const clearHistory = () => setHistory([]);
  const updateEncodeMethod = (nextMethod) => {
    if (nextMethod === encodeMethod) return;
    setEncodeMethod(nextMethod);
    clearEncodeResult();
  };
  const updateDecodeMethod = (nextMethod) => {
    if (nextMethod === decodeMethod) return;
    setDecodeMethod(nextMethod);
    clearDecodeResult();
  };
  const updateEncodePassword = (value) => { setEncodePassword(value); clearEncodeResult(value); };
  const updateDecodePassword = (value) => { setDecodePassword(value); clearDecodeResult(value); };
  const encode = async (event) => {
    event.preventDefault();
    setErrors((current) => ({ ...current, encode: "" }));
    setEncoding(null);
    setGeneratedStego(null);
    setAnalysis(null);
    setAnalysisError("");
    setEncodeStatus("running");
    if (generatedStegoUrl) URL.revokeObjectURL(generatedStegoUrl);
    setGeneratedStegoUrl(null);
    setBusy("encode");
    setEncodeStatus("running");
    const started = performance.now();
    let response;
    try {
      response = await hideAudio({ wav, image: cover, password: encodePassword, method: encodeMethod });
    } catch (error) {
      const durationMs = performance.now() - started;
      setEncodeStatus("failed");
      recordHistory({ operation: "encode", status: "failed", filename: wav?.name || "input.wav", method: encodeMethod, durationMs, error: error.message });
      setErrors((current) => ({ ...current, encode: error.message }));
      setBusy("");
      return;
    }

    const durationMs = performance.now() - started;
    const timings = { ...response.server.timings, ...response.frontend, frontend_operation_ms: durationMs };
    const completedEncoding = { ...response.server, timings, date: new Date().toISOString() };
    const stegoFile = new File([response.blob], "stego.png", { type: "image/png" });
    const stegoUrl = URL.createObjectURL(response.blob);
    setEncoding(completedEncoding);
    setEncodeStatus("completed");
    recordHistory({ operation: "encode", status: "completed", filename: wav?.name || "input.wav", method: encodeMethod, durationMs, timings, metadata: response.server.metadata });
    setGeneratedStego(stegoFile);
    setAnalysisContext("encode");
    if (generatedStegoUrl) URL.revokeObjectURL(generatedStegoUrl);
    setGeneratedStegoUrl(stegoUrl);
    setBusy("");
  };
  const decode = async (event) => {
    event.preventDefault();
    setErrors((current) => ({ ...current, decode: "" }));
    setDecoding(null);
    setBusy("decode");
    setDecodeStatus("running");
    const started = performance.now();
    try {
      const response = await recoverAudio({ image: decodeImage, password: decodePassword, method: decodeMethod });
      const durationMs = performance.now() - started;
      const timings = { ...response.server.timings, ...response.frontend, frontend_operation_ms: durationMs };
      setDecoding({ ...response.server, timings, blob: response.blob, date: new Date().toISOString() });
      setDecodeStatus("completed");
      recordHistory({ operation: "decode", status: "completed", filename: decodeImage?.name || "stego.png", method: decodeMethod, durationMs, timings, metadata: response.server.metadata });
    } catch (error) {
      const durationMs = performance.now() - started;
      setDecodeStatus("failed");
      recordHistory({ operation: "decode", status: "failed", filename: decodeImage?.name || "stego.png", method: decodeMethod, durationMs, error: error.message });
      setErrors((current) => ({ ...current, decode: error.message }));
    } finally { setBusy(""); }
  };
  const refreshAnalysis = async (x, y, size) => {
    if ((!singleSource && !(originalSource && stegoSource)) || analysisRequestRef.current) return;
    if (![8, 16, 32].includes(size)) {
      setAnalysisError("Choose a region size of 8, 16, or 32 pixels.");
      return;
    }
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
      setAnalysisError("Top-left X and Y must be whole numbers at or above zero.");
      return;
    }
    const dimensions = analysis || singleAnalysis;
    if (dimensions && (x + size > dimensions.width || y + size > dimensions.height)) {
      setAnalysisError(`The ${size} × ${size} region must fit within the ${dimensions.width} × ${dimensions.height} image.`);
      return;
    }
    analysisRequestRef.current = true;
    const runId = ++analysisRunRef.current;
    setAnalysisLoading(true);
    setAnalysisError("");
    try {
      if (originalSource && stegoSource) {
        const nextAnalysis = await analyzeImages({ original: originalSource, stego: stegoSource, x, y, size });
        if (!nextAnalysis.dimensions_match || !nextAnalysis.region) throw new Error("The selected image pair cannot be compared at this region.");
        if (analysisRunRef.current === runId) setAnalysis(nextAnalysis);
      } else {
        const nextAnalysis = await inspectSinglePng(singleSource, { x, y, size });
        if (analysisRunRef.current === runId) setSingleAnalysis(nextAnalysis);
      }
    } catch (error) {
      if (analysisRunRef.current === runId) setAnalysisError(error.message || "Pixel analysis could not be completed.");
    } finally {
      if (analysisRunRef.current === runId) {
        analysisRequestRef.current = false;
        setAnalysisLoading(false);
      }
    }
  };
  const activePage = NAV_ITEMS.find(([id]) => id === page)?.[1] || "Workbench";
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} historyCount={history.length} apiStatus={apiStatus} /><main className="main"><header className="topbar"><div><span className="breadcrumb">CIPHER FRAME /</span><strong>{activePage.toUpperCase()}</strong></div><div className="top-actions"><span className="pill">LIVE WORKSPACE</span></div></header><div className="page-wrap"><WorkbenchPanels encode={encode} decode={decode} wav={wav} cover={cover} referenceImage={referenceImage} selectReferenceImage={selectReferenceImage} decodeImage={decodeImage} encodeMethod={encodeMethod} setEncodeMethod={updateEncodeMethod} decodeMethod={decodeMethod} setDecodeMethod={updateDecodeMethod} encodePassword={encodePassword} setEncodePassword={updateEncodePassword} decodePassword={decodePassword} setDecodePassword={updateDecodePassword} busy={busy} errors={errors} encoding={encoding} generatedStegoUrl={generatedStegoUrl} generatedStego={generatedStego} decoding={decoding} selectWav={selectWav} selectCover={selectCover} selectDecodeImage={selectDecodeImage} useStegoForDecode={useStegoForDecode} apiStatus={apiStatus} page={page} setPage={setPage} history={history} clearHistory={clearHistory} encodeStatus={encodeStatus} decodeStatus={decodeStatus} analysisProps={{ analysis, singleAnalysis, singleRole, singleLabel: currentSingleLabel, sourceContext, hasOriginal: Boolean(originalSource), hasStego: Boolean(stegoSource), originalFile: originalSource, stegoFile: stegoSource, selectMissingOriginal, selectMissingStego, operationMethod: encoding ? encodeMethod : null, analysisError, analysisLoading, analysisTab, setAnalysisTab, channel, setChannel, showHistogramDifference, setShowHistogramDifference, regionSize, setRegionSize, regionX, setRegionX, regionY, setRegionY, refreshAnalysis }} /></div></main></div>;
}

export default EnhancedApp;
