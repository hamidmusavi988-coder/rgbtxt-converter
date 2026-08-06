import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownToLine, Check, ChevronRight, Clipboard, FileCode2, Image as ImageIcon, RefreshCw, ScanLine, Upload, X } from "lucide-react";

type Mode = "encode" | "decode";
type ImageResult = { name: string; width: number; height: number; text: string; sourceUrl: string };
type DecodeResult = { name: string; width: number; height: number; url: string };
const MAX_PIXELS = 4_000_000;

const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="icon-button">{children}</button>;
}

export default function App() {
  const [mode, setMode] = useState<Mode>("encode");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [imageResult, setImageResult] = useState<ImageResult | null>(null);
  const [rgbInput, setRgbInput] = useState("");
  const [rgbName, setRgbName] = useState("image.rgbtxt");
  const [decodeResult, setDecodeResult] = useState<DecodeResult | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const url = imageResult?.sourceUrl;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [imageResult?.sourceUrl]);

  useEffect(() => {
    const url = decodeResult?.url;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [decodeResult?.url]);

  const previewText = useMemo(() => {
    if (!imageResult) return "";
    const lines = imageResult.text.split("\n");
    return lines.slice(0, 8).join("\n") + (lines.length > 8 ? "\n..." : "");
  }, [imageResult]);

  const switchMode = (next: Mode) => { setMode(next); setError(""); setDragging(false); };

  const encodeImage = async (file: File) => {
    if (!file.type.startsWith("image/")) { setError("Choose a PNG, JPEG, WEBP, BMP, or GIF image."); return; }
    setBusy(true); setError("");
    let sourceUrl = "";
    try {
      sourceUrl = URL.createObjectURL(file);
      const image = new Image(); image.src = sourceUrl; await image.decode();
      if (image.naturalWidth * image.naturalHeight > MAX_PIXELS) throw new Error("Image is too large. Use an image under 4 million pixels.");
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas is not available in this browser.");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const lines = [`# RGBTXT v1 ${canvas.width}x${canvas.height}`];
      for (let y = 0; y < canvas.height; y += 1) {
        const row: string[] = [];
        for (let x = 0; x < canvas.width; x += 1) {
          const i = (y * canvas.width + x) * 4;
          row.push(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
        }
        lines.push(row.join(" "));
      }
      if (imageResult?.sourceUrl) URL.revokeObjectURL(imageResult.sourceUrl);
      setImageResult({ name: file.name.replace(/\.[^.]+$/, "") || "image", width: canvas.width, height: canvas.height, text: lines.join("\n"), sourceUrl });
    } catch (reason) {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      setError(reason instanceof Error ? reason.message : "The image could not be read.");
    } finally { setBusy(false); }
  };

  const readRgbFile = async (file: File) => {
    setError("");
    try { setRgbInput(await file.text()); setRgbName(file.name); setDecodeResult(null); }
    catch { setError("The RGBTXT file could not be read."); }
  };

  const decodeRgb = async () => {
    setBusy(true); setError("");
    try {
      const lines = rgbInput.trim().split(/\r?\n/);
      const match = (lines.shift()?.trim() ?? "").match(/^#\s*RGBTXT\s+v1\s+(\d+)x(\d+)$/i);
      if (!match) throw new Error("Invalid header. Expected: # RGBTXT v1 WIDTHxHEIGHT");
      const width = Number(match[1]), height = Number(match[2]);
      if (!width || !height || width * height > MAX_PIXELS) throw new Error("Dimensions must be valid and under 4 million pixels.");
      if (lines.length !== height) throw new Error(`Expected ${height} pixel rows, but found ${lines.length}.`);
      const data = new Uint8ClampedArray(width * height * 4);
      lines.forEach((line, y) => {
        const pixels = line.trim().split(/\s+/);
        if (pixels.length !== width) throw new Error(`Row ${y + 1} contains ${pixels.length} pixels; expected ${width}.`);
        pixels.forEach((pixel, x) => {
          const channels = pixel.split(",").map(Number);
          if (channels.length !== 3 || channels.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error(`Invalid RGB value at row ${y + 1}, column ${x + 1}.`);
          const i = (y * width + x) * 4;
          data[i] = channels[0]; data[i + 1] = channels[1]; data[i + 2] = channels[2]; data[i + 3] = 255;
        });
      });
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      canvas.getContext("2d")?.putImageData(new ImageData(data, width, height), 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PNG generation failed.");
      if (decodeResult?.url) URL.revokeObjectURL(decodeResult.url);
      setDecodeResult({ name: rgbName.replace(/\.[^.]+$/, "") || "image", width, height, url: URL.createObjectURL(blob) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The RGBTXT data could not be decoded."); }
    finally { setBusy(false); }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); setDragging(false);
    const file = event.dataTransfer.files[0]; if (!file) return;
    mode === "encode" ? encodeImage(file) : readRgbFile(file);
  };
  const download = (content: BlobPart, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement("a");
    a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  };
  const downloadDecoded = () => { if (decodeResult) { const a = document.createElement("a"); a.href = decodeResult.url; a.download = `${decodeResult.name}.png`; a.click(); } };
  const copyText = async () => { if (imageResult) { await navigator.clipboard.writeText(imageResult.text); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } };
  const clearCurrent = () => { setError(""); if (mode === "encode") setImageResult(null); else { setRgbInput(""); setDecodeResult(null); } };
  const onImageSelect = (e: ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) encodeImage(file); e.target.value = ""; };
  const onTextSelect = (e: ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) readRgbFile(file); e.target.value = ""; };

  return (
    <main className="app-shell">
      <div className="pixel-grid" aria-hidden="true" />
      <motion.header className="topbar" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5 }}>
        <a className="brand" href="#top" aria-label="RGBTXT home"><span className="brand-mark"><span /><span /><span /></span><span>RGBTXT</span></a>
        <span className="top-note">Lossless pixel exchange</span>
        <a className="format-link" href="#format">Format spec <ChevronRight size={15} /></a>
      </motion.header>

      <section id="top" className="hero">
        <motion.div className="hero-copy" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .08, duration: .55 }}>
          <p className="kicker"><ScanLine size={15} /> Image data, made readable</p>
          <h1>Pixels in.<br /><span>Plain text out.</span></h1>
          <p className="intro">Convert images into raw RGB pixel dumps, or rebuild a pristine PNG from RGBTXT data. Everything runs locally in your browser.</p>
        </motion.div>

        <motion.div className="converter" initial={{ opacity: 0, y: 28, scale: .99 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: .18, duration: .58 }}>
          <div className="mode-switch" role="tablist" aria-label="Conversion direction">
            <button className={mode === "encode" ? "active" : ""} onClick={() => switchMode("encode")} role="tab"><ImageIcon size={17} /> Image <span>to</span> RGBTXT</button>
            <button className={mode === "decode" ? "active" : ""} onClick={() => switchMode("decode")} role="tab"><FileCode2 size={17} /> RGBTXT <span>to</span> Image</button>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={mode} className="workspace" initial={{ opacity: 0, x: mode === "encode" ? -10 : 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: mode === "encode" ? 10 : -10 }} transition={{ duration: .2 }}>
              {mode === "encode" ? (!imageResult ? (
                <div className={`drop-zone ${dragging ? "dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop} onClick={() => imageInput.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && imageInput.current?.click()}>
                  <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/bmp,image/gif" hidden onChange={onImageSelect} />
                  <div className="drop-icon"><Upload size={26} /></div><h2>{busy ? "Reading pixels..." : "Drop an image here"}</h2><p>or <span>browse your files</span></p><small>PNG, JPEG, WEBP, BMP, GIF · up to 4MP</small>
                </div>
              ) : (
                <div className="result-layout">
                  <div className="image-preview"><img src={imageResult.sourceUrl} alt="Uploaded source" /><div className="file-caption"><div><strong>{imageResult.name}</strong><span>{imageResult.width} x {imageResult.height} px</span></div><IconButton label="Remove image" onClick={clearCurrent}><X size={18} /></IconButton></div></div>
                  <div className="code-result"><div className="result-head"><span>RGBTXT output</span><span>{formatBytes(new Blob([imageResult.text]).size)}</span></div><pre>{previewText}</pre><div className="result-actions"><button className="secondary-button" onClick={copyText}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? "Copied" : "Copy"}</button><button className="primary-button" onClick={() => download(imageResult.text, `${imageResult.name}.rgbtxt`, "text/plain")}><ArrowDownToLine size={17} /> Download .rgbtxt</button></div></div>
                </div>
              )) : (
                <div className="decode-layout">
                  <div className="input-pane"><div className="pane-head"><span>RGBTXT source</span><button onClick={() => textInput.current?.click()}><Upload size={14} /> Open file</button><input ref={textInput} type="file" accept=".rgbtxt,.txt,text/plain" hidden onChange={onTextSelect} /></div><textarea aria-label="RGBTXT source" value={rgbInput} onChange={(e) => { setRgbInput(e.target.value); setDecodeResult(null); }} placeholder={'# RGBTXT v1 2x2\n255,88,71 35,35,35\n35,35,35 245,214,66'} spellCheck={false} /><button className="primary-button decode-button" onClick={decodeRgb} disabled={!rgbInput.trim() || busy}>{busy ? <RefreshCw className="spin" size={17} /> : <ScanLine size={17} />} Reconstruct image</button></div>
                  <div className={`decoded-preview ${decodeResult ? "has-image" : ""}`}>{decodeResult ? <><img src={decodeResult.url} alt="Reconstructed RGBTXT output" /><strong>{decodeResult.width} x {decodeResult.height} px</strong><button className="primary-button" onClick={downloadDecoded}><ArrowDownToLine size={17} /> Download PNG</button></> : <><ImageIcon size={30} /><span>PNG preview</span><small>Your reconstructed image will appear here</small></>}</div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
          {error && <div className="error-line" role="alert"><X size={15} />{error}</div>}
        </motion.div>
      </section>

      <section id="format" className="format-section">
        <div><p className="section-index">01 / FORMAT</p><h2>One row.<br />Every pixel.</h2></div>
        <div className="format-copy"><p>RGBTXT is intentionally simple. A one-line header declares the dimensions. Every line after it maps to one image row, with pixels written as comma-separated red, green, and blue values.</p><div className="spec-code"><div><span className="line-number">01</span><code><b># RGBTXT v1</b> 3x1</code></div><div><span className="line-number">02</span><code><i>255,88,71</i> <em>35,35,35</em> <strong>245,214,66</strong></code></div></div><p className="privacy-note"><Check size={16} /> No uploads. No tracking. Your files stay on your device.</p></div>
      </section>
      <footer><span>RGBTXT CONVERTER</span><span>Browser-native image tooling</span></footer>
    </main>
  );
}