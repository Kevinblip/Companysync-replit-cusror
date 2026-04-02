import { useState, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";

function PdfPage({ pdf, pageNum, scale }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    let renderTask = null;

    pdf.getPage(pageNum).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      renderTask = page.render({ canvasContext: ctx, viewport });
      return renderTask.promise;
    });

    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
    };
  }, [pdf, pageNum, scale]);

  return (
    <canvas
      ref={canvasRef}
      className="block mx-auto shadow mb-2"
      style={{ maxWidth: "100%" }}
    />
  );
}

export default function PdfViewer({ src, className, title, style }) {
  const [pdf, setPdf] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdf(null);
    setNumPages(0);

    const loadFromUrl = (url) =>
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        });

    const loadPdf = async () => {
      let buffer;
      if (!src.startsWith('http')) {
        // Relative path — try loading directly from root domain first
        try {
          buffer = await loadFromUrl(src);
        } catch {
          // Direct load failed — fall back to the API proxy
          const proxyUrl = `/api/proxy-pdf?url=${encodeURIComponent(window.location.origin + src)}`;
          buffer = await loadFromUrl(proxyUrl);
        }
      } else {
        buffer = await loadFromUrl(src);
      }
      if (cancelled) return;
      const pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;
      if (cancelled) return;
      setPdf(pdfDoc);
      setNumPages(pdfDoc.numPages);
      setLoading(false);
    };

    loadPdf().catch((err) => {
      if (cancelled) return;
      setError(err.message);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [src]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className || ""}`} style={style}>
        <div className="text-center text-gray-500">
          <div className="animate-spin w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-sm">Loading PDF...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className || ""}`} style={style}>
        <div className="text-center text-gray-500 p-4">
          <p className="text-sm font-medium mb-1">Unable to load PDF</p>
          <p className="text-xs text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!pdf) return null;

  return (
    <div
      className={`overflow-y-auto bg-gray-200 p-2 ${className || ""}`}
      style={style}
    >
      {Array.from({ length: numPages }, (_, i) => (
        <PdfPage key={i + 1} pdf={pdf} pageNum={i + 1} scale={1.5} />
      ))}
    </div>
  );
}
