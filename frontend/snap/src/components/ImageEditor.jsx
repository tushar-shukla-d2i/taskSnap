import { useEffect, useRef, useState, useCallback } from "react";
import * as fabric from "fabric";

// ─── Tool IDs ────────────────────────────────────────────────────────────────
const TOOLS = {
  SELECT:  "select",
  RECT:    "rect",
  CIRCLE:  "circle",
  ELLIPSE: "ellipse",
  TEXT:    "text",
  CROP:    "crop",
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function ImageEditor({ imageUrl, onClose }) {
  const canvasElRef   = useRef(null);
  const fabricRef     = useRef(null);
  const drawingRef    = useRef(null);
  const originRef     = useRef({ x: 0, y: 0 });
  const cropRectRef   = useRef(null);
  const isDrawingRef  = useRef(false);
  const historyRef    = useRef([]);
  const redoStackRef  = useRef([]);

  // Keep latest tool/color values accessible inside canvas event closures
  // without having to re-register events every time state changes.
  const activeToolRef  = useRef(TOOLS.SELECT);
  const strokeColorRef = useRef("#ef4444");
  const fillColorRef   = useRef("transparent");
  const strokeWidthRef = useRef(3);
  const fontSizeRef    = useRef(22);
  const useFillRef     = useRef(false);

  const [activeTool,  setActiveTool]  = useState(TOOLS.SELECT);
  const [strokeColor, setStrokeColor] = useState("#ef4444");
  const [fillColor,   setFillColor]   = useState("transparent");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [fontSize,    setFontSize]    = useState(22);
  const [useFill,     setUseFill]     = useState(false);
  const [canUndo,     setCanUndo]     = useState(false);
  const [canRedo,     setCanRedo]     = useState(false);
  const [cropMode,    setCropMode]    = useState(false);

  // Sync refs whenever state changes
  useEffect(() => { activeToolRef.current  = activeTool;  }, [activeTool]);
  useEffect(() => { strokeColorRef.current = strokeColor; }, [strokeColor]);
  useEffect(() => { fillColorRef.current   = fillColor;   }, [fillColor]);
  useEffect(() => { strokeWidthRef.current = strokeWidth; }, [strokeWidth]);
  useEffect(() => { fontSizeRef.current    = fontSize;    }, [fontSize]);
  useEffect(() => { useFillRef.current     = useFill;     }, [useFill]);

  // ─── Snapshot helpers ──────────────────────────────────────────────────────
  const pushSnapshot = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    historyRef.current.push(canvas.toJSON(["name"]));
    redoStackRef.current = [];
    setCanUndo(historyRef.current.length > 1);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || historyRef.current.length <= 1) return;
    redoStackRef.current.push(historyRef.current.pop());
    const snapshot = historyRef.current[historyRef.current.length - 1];
    canvas.loadFromJSON(snapshot).then(() => {
      canvas.renderAll();
      setCanUndo(historyRef.current.length > 1);
      setCanRedo(redoStackRef.current.length > 0);
    });
  }, []);

  const redo = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || redoStackRef.current.length === 0) return;
    const snapshot = redoStackRef.current.pop();
    historyRef.current.push(snapshot);
    canvas.loadFromJSON(snapshot).then(() => {
      canvas.renderAll();
      setCanUndo(historyRef.current.length > 1);
      setCanRedo(redoStackRef.current.length > 0);
    });
  }, []);

  // ─── Apply tool mode to canvas ────────────────────────────────────────────
  const applyToolMode = useCallback((tool, canvas) => {
    if (!canvas) return;

    if (tool === TOOLS.SELECT) {
      canvas.isDrawingMode = false;
      canvas.selection     = true;
      canvas.defaultCursor = "default";
      canvas.forEachObject((obj) => {
        if (obj.name !== "__bg__") {
          obj.selectable = true;
          obj.evented    = true;
        }
      });
    } else {
      canvas.isDrawingMode = false;
      canvas.selection     = false;
      canvas.defaultCursor = tool === TOOLS.TEXT ? "text" : "crosshair";
      canvas.forEachObject((obj) => {
        if (obj.name !== "__bg__") {
          obj.selectable = false;
          obj.evented    = false;
        }
      });
    }
    canvas.renderAll();
  }, []);

  // ─── Canvas bootstrap — runs once on mount ────────────────────────────────
  useEffect(() => {
    if (!imageUrl || !canvasElRef.current) return;

    const container = canvasElRef.current.parentElement;
    const W = container.clientWidth  || 900;
    const H = container.clientHeight || 600;

    const canvas = new fabric.Canvas(canvasElRef.current, {
      width:  W,
      height: H,
      selection: true,
      preserveObjectStacking: true,
    });
    fabricRef.current = canvas;

    // ── Load background image ──
    fabric.FabricImage.fromURL(imageUrl, { crossOrigin: "anonymous" }).then((img) => {
      const scale = Math.min(W / img.width, H / img.height, 1);
      img.set({
        left:       (W - img.width  * scale) / 2,
        top:        (H - img.height * scale) / 2,
        scaleX:     scale,
        scaleY:     scale,
        selectable: false,
        evented:    false,
        name:       "__bg__",
      });
      canvas.add(img);
      canvas.sendObjectToBack(img);
      canvas.renderAll();
      historyRef.current = [canvas.toJSON(["name"])];
    });

    // ─── Mouse:down — start drawing ──────────────────────────────────────────
    canvas.on("mouse:down", (opt) => {
      const tool = activeToolRef.current;
      if (tool === TOOLS.SELECT) return;

      // Prevent default fabric drag-select
      opt.e.preventDefault();
      isDrawingRef.current = true;

      const pointer = canvas.getScenePoint(opt.e);
      originRef.current = { x: pointer.x, y: pointer.y };

      // ── Text: place & enter edit immediately ──
      if (tool === TOOLS.TEXT) {
        isDrawingRef.current = false;
        const text = new fabric.IText("Type here", {
          left:        pointer.x,
          top:         pointer.y,
          fontSize:    fontSizeRef.current,
          fill:        strokeColorRef.current,
          fontFamily:  "Outfit, sans-serif",
          fontWeight:  "normal",
          selectable:  true,
          evented:     true,
          editable:    true,
          name:        "text_" + Date.now(),
        });
        canvas.add(text);
        canvas.renderAll();
        // Small delay to let the canvas settle before entering edit
        setTimeout(() => {
          canvas.setActiveObject(text);
          text.enterEditing();
          text.selectAll();
          canvas.renderAll();
        }, 50);
        pushSnapshot();
        return;
      }

      const shapeProps = {
        stroke:        strokeColorRef.current,
        strokeWidth:   strokeWidthRef.current,
        fill:          useFillRef.current ? fillColorRef.current : "transparent",
        selectable:    false,
        evented:       false,
        strokeUniform: true,
        name:          tool + "_" + Date.now(),
      };

      // ── Rect / Crop ──
      if (tool === TOOLS.RECT || tool === TOOLS.CROP) {
        const isCrop = tool === TOOLS.CROP;
        const rect = new fabric.Rect({
          left:   pointer.x,
          top:    pointer.y,
          width:  1,
          height: 1,
          ...shapeProps,
          ...(isCrop && {
            fill:            "rgba(139,92,246,0.18)",
            stroke:          "#8b5cf6",
            strokeDashArray: [6, 4],
          }),
        });
        canvas.add(rect);
        drawingRef.current = rect;
        if (isCrop) cropRectRef.current = rect;
      }

      // ── Circle ──
      if (tool === TOOLS.CIRCLE) {
        const circle = new fabric.Circle({
          left:   pointer.x,
          top:    pointer.y,
          radius: 1,
          originX: "left",
          originY: "top",
          ...shapeProps,
        });
        canvas.add(circle);
        drawingRef.current = circle;
      }

      // ── Ellipse ──
      if (tool === TOOLS.ELLIPSE) {
        const ellipse = new fabric.Ellipse({
          left: pointer.x,
          top:  pointer.y,
          rx: 1, ry: 1,
          originX: "left",
          originY: "top",
          ...shapeProps,
        });
        canvas.add(ellipse);
        drawingRef.current = ellipse;
      }
    });

    // ─── Mouse:move — resize the shape being drawn ───────────────────────────
    canvas.on("mouse:move", (opt) => {
      if (!isDrawingRef.current || !drawingRef.current) return;

      const pointer = canvas.getScenePoint(opt.e);
      const ox = originRef.current.x;
      const oy = originRef.current.y;
      const tool = activeToolRef.current;

      if (tool === TOOLS.RECT || tool === TOOLS.CROP) {
        const left   = Math.min(ox, pointer.x);
        const top    = Math.min(oy, pointer.y);
        const width  = Math.abs(pointer.x - ox);
        const height = Math.abs(pointer.y - oy);
        drawingRef.current.set({ left, top, width, height });
      }

      if (tool === TOOLS.CIRCLE) {
        const dx = pointer.x - ox;
        const dy = pointer.y - oy;
        const r  = Math.sqrt(dx * dx + dy * dy) / 2;
        drawingRef.current.set({
          left:   (ox + pointer.x) / 2 - r,
          top:    (oy + pointer.y) / 2 - r,
          radius: Math.max(r, 1),
        });
      }

      if (tool === TOOLS.ELLIPSE) {
        drawingRef.current.set({
          left: Math.min(ox, pointer.x),
          top:  Math.min(oy, pointer.y),
          rx:   Math.max(Math.abs(pointer.x - ox) / 2, 1),
          ry:   Math.max(Math.abs(pointer.y - oy) / 2, 1),
        });
      }

      canvas.renderAll();
    });

    // ─── Mouse:up — finalise shape ───────────────────────────────────────────
    canvas.on("mouse:up", () => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;

      const shape = drawingRef.current;
      drawingRef.current = null;

      if (!shape) return;

      if (activeToolRef.current === TOOLS.CROP) {
        // Crop rect stays on canvas; user clicks "Confirm Crop"
        return;
      }

      // Make the finished shape selectable
      shape.set({ selectable: true, evented: true });
      canvas.renderAll();
      pushSnapshot();
    });

    // ─── Object modified → snapshot ──────────────────────────────────────────
    canvas.on("object:modified", () => pushSnapshot());

    // ─── Keyboard shortcuts ──────────────────────────────────────────────────
    const handleKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      const isEditing = tag === "INPUT" || tag === "TEXTAREA";

      if (!isEditing && (e.key === "Delete" || e.key === "Backspace")) {
        const obj = canvas.getActiveObject();
        if (obj && obj.name !== "__bg__") {
          canvas.remove(obj);
          canvas.discardActiveObject();
          canvas.renderAll();
          pushSnapshot();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      canvas.dispose();
      fabricRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // ─── React to tool changes ────────────────────────────────────────────────
  useEffect(() => {
    applyToolMode(activeTool, fabricRef.current);
  }, [activeTool, applyToolMode]);

  // ─── Crop confirm ─────────────────────────────────────────────────────────
  const confirmCrop = useCallback(() => {
    const canvas   = fabricRef.current;
    const cropRect = cropRectRef.current;
    if (!canvas || !cropRect) return;

    const bounds = cropRect.getBoundingRect();
    if (bounds.width < 5 || bounds.height < 5) { cancelCrop(); return; }

    canvas.remove(cropRect);
    cropRectRef.current = null;
    canvas.renderAll();

    // Draw current canvas to a temp canvas, slice to bounds
    const { left, top, width, height } = bounds;
    const src = canvas.toDataURL({ format: "png" });
    const img2 = new Image();
    img2.onload = () => {
      const tmp = document.createElement("canvas");
      tmp.width  = width;
      tmp.height = height;
      tmp.getContext("2d").drawImage(img2, left, top, width, height, 0, 0, width, height);
      const croppedUrl = tmp.toDataURL("image/png");

      canvas.clear();
      fabric.FabricImage.fromURL(croppedUrl, { crossOrigin: "anonymous" }).then((newImg) => {
        const W = canvas.width;
        const H = canvas.height;
        const scale = Math.min(W / newImg.width, H / newImg.height, 1);
        newImg.set({
          left:       (W - newImg.width  * scale) / 2,
          top:        (H - newImg.height * scale) / 2,
          scaleX:     scale,
          scaleY:     scale,
          selectable: false,
          evented:    false,
          name:       "__bg__",
        });
        canvas.add(newImg);
        canvas.sendObjectToBack(newImg);
        canvas.renderAll();
        historyRef.current = [canvas.toJSON(["name"])];
        setCanUndo(false);
        setCanRedo(false);
        setCropMode(false);
        setActiveTool(TOOLS.SELECT);
      });
    };
    img2.src = src;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancelCrop = useCallback(() => {
    const canvas = fabricRef.current;
    if (cropRectRef.current && canvas) {
      canvas.remove(cropRectRef.current);
      cropRectRef.current = null;
      canvas.renderAll();
    }
    setCropMode(false);
    setActiveTool(TOOLS.SELECT);
  }, []);

  // ─── Download ─────────────────────────────────────────────────────────────
  const downloadImage = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.discardActiveObject();
    canvas.renderAll();
    const dataUrl = canvas.toDataURL({ format: "png", multiplier: 1 });
    const link = document.createElement("a");
    link.href     = dataUrl;
    link.download = `tasksnap-annotated-${Date.now()}.png`;
    link.click();
  }, []);

  // ─── Select tool ──────────────────────────────────────────────────────────
  const selectTool = (tool) => {
    if (tool !== TOOLS.CROP && cropRectRef.current) cancelCrop();
    setCropMode(tool === TOOLS.CROP);
    setActiveTool(tool);
  };

  const toolButtons = [
    { id: TOOLS.SELECT,  label: "↖ Select",  title: "Select & move objects" },
    { id: TOOLS.RECT,    label: "▭ Rect",    title: "Draw rectangle" },
    { id: TOOLS.CIRCLE,  label: "◯ Circle",  title: "Draw circle" },
    { id: TOOLS.ELLIPSE, label: "⬭ Ellipse", title: "Draw ellipse" },
    { id: TOOLS.TEXT,    label: "T Text",     title: "Click to place editable text" },
    { id: TOOLS.CROP,    label: "✂ Crop",    title: "Crop image" },
  ];

  return (
    <div className="image-editor">
      {/* ── Toolbar ── */}
      <div className="editor-toolbar">
        <div className="toolbar-tools">
          {toolButtons.map((btn) => (
            <button
              key={btn.id}
              className={`tool-btn ${activeTool === btn.id ? "active" : ""}`}
              onClick={() => selectTool(btn.id)}
              title={btn.title}
            >
              {btn.label}
            </button>
          ))}
        </div>

        <div className="toolbar-divider" />

        {/* Color & stroke controls */}
        <div className="toolbar-controls">
          <label className="control-group" title="Stroke / text color">
            <span className="control-label">Color</span>
            <input
              type="color"
              className="color-input"
              value={strokeColor}
              onChange={(e) => setStrokeColor(e.target.value)}
            />
          </label>

          <label className="control-group" title="Fill color (shapes)">
            <span className="control-label">Fill</span>
            <input
              type="color"
              className="color-input"
              value={fillColor === "transparent" ? "#ffffff" : fillColor}
              onChange={(e) => setFillColor(e.target.value)}
              disabled={!useFill}
              style={{ opacity: useFill ? 1 : 0.3 }}
            />
            <input
              type="checkbox"
              id="use-fill"
              checked={useFill}
              onChange={(e) => setUseFill(e.target.checked)}
              className="fill-checkbox"
              title="Enable fill"
            />
          </label>

          <label className="control-group" title="Stroke width">
            <span className="control-label">Width</span>
            <select
              className="stroke-select"
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 6, 8, 10].map((w) => (
                <option key={w} value={w}>{w}px</option>
              ))}
            </select>
          </label>

          {activeTool === TOOLS.TEXT && (
            <label className="control-group" title="Font size">
              <span className="control-label">Size</span>
              <select
                className="stroke-select"
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
              >
                {[12, 14, 16, 18, 20, 22, 24, 28, 32, 40, 48].map((s) => (
                  <option key={s} value={s}>{s}px</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="toolbar-divider" />

        {/* Actions */}
        <div className="toolbar-actions">
          <button className="action-btn-editor" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↩ Undo</button>
          <button className="action-btn-editor" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">↪ Redo</button>
          <button className="action-btn-editor download-btn" onClick={downloadImage} title="Download annotated PNG">📥 Download</button>
          {onClose && (
            <button className="action-btn-editor close-btn" onClick={onClose} title="Close editor">✕ Close</button>
          )}
        </div>
      </div>

      {/* ── Crop bar ── */}
      {cropMode && (
        <div className="crop-bar">
          <span>✂ Draw a crop region on the canvas, then confirm.</span>
          <button className="crop-confirm-btn" onClick={confirmCrop}>✔ Confirm Crop</button>
          <button className="crop-cancel-btn"  onClick={cancelCrop}>✕ Cancel</button>
        </div>
      )}

      {/* ── Canvas ── */}
      <div className="editor-canvas-wrapper">
        <canvas ref={canvasElRef} />
      </div>
    </div>
  );
}
