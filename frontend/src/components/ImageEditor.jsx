import { useEffect, useRef, useState, useCallback } from "react";
import * as fabric from "fabric";

// ─── Tool IDs ────────────────────────────────────────────────────────────────
const TOOLS = {
  SELECT:   "select",
  FREEHAND: "freehand",
  RECT:     "rect",
  CIRCLE:   "circle",
  ELLIPSE:  "ellipse",
  TEXT:     "text",
  CROP:     "crop",
  ARROW:    "arrow",
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function ImageEditor({ imageUrl, onClose }) {
  const canvasElRef    = useRef(null);
  const fabricRef      = useRef(null);
  const zoomWrapperRef = useRef(null); // CSS zoom is applied to this div
  const drawingRef     = useRef(null);
  const originRef      = useRef({ x: 0, y: 0 });
  const cropRectRef    = useRef(null);
  const isDrawingRef   = useRef(false);
  const historyRef     = useRef([]);
  const redoStackRef   = useRef([]);
  const editorZoomRef  = useRef(1); // mirrors editorZoom state for event closures

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
  const [editorZoom,  setEditorZoom]  = useState(1);

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
    historyRef.current.push(canvas.toJSON(["name", "selectable", "evented"]));
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
      const objs = canvas.getObjects();
      if (objs.length > 0) {
        objs[0].set({ selectable: false, evented: false, name: "__bg__" });
      }
      setTimeout(() => applyToolMode(activeToolRef.current, canvas), 0);
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
      const objs = canvas.getObjects();
      if (objs.length > 0) {
        objs[0].set({ selectable: false, evented: false, name: "__bg__" });
      }
      setTimeout(() => applyToolMode(activeToolRef.current, canvas), 0);
      canvas.renderAll();
      setCanUndo(historyRef.current.length > 1);
      setCanRedo(redoStackRef.current.length > 0);
    });
  }, []);

  // ─── Zoom helpers (CSS zoom only — never touches canvas dimensions) ──────────
  // The canvas element always stays at its original pixel size.
  // CSS `zoom` on the wrapper div scales the visual appearance AND its layout
  // footprint, so the overflow:auto scroll container shows real scrollbars.
  const handleZoomIn = useCallback(() => {
    setEditorZoom(z => { const n = Math.min(z * 1.2, 10); editorZoomRef.current = n; return n; });
  }, []);

  const handleZoomOut = useCallback(() => {
    setEditorZoom(z => { const n = Math.max(z / 1.2, 0.1); editorZoomRef.current = n; return n; });
  }, []);

  const handleZoomReset = useCallback(() => {
    editorZoomRef.current = 1;
    setEditorZoom(1);
  }, []);

  // Wheel-based zoom on the wrapper div (registered with passive:false so we can preventDefault)
  useEffect(() => {
    const wrapper = zoomWrapperRef.current;
    if (!wrapper) return;
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setEditorZoom(prev => {
        const next = Math.min(Math.max(prev * (0.999 ** e.deltaY), 0.1), 10);
        editorZoomRef.current = next;
        return next;
      });
    };
    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", onWheel);
  }, []);

  // ─── Apply tool mode ──────────────────────────────────────────────────────
  const applyToolMode = useCallback((tool, canvas) => {
    if (!canvas) return;
    if (tool === TOOLS.SELECT) {
      canvas.isDrawingMode = false;
      canvas.selection     = true;
      canvas.defaultCursor = "default";
      canvas.forEachObject((obj) => {
        if (obj.name !== "__bg__") { obj.selectable = true; obj.evented = true; }
      });
    } else if (tool === TOOLS.TEXT) {
      canvas.isDrawingMode = false;
      canvas.selection     = false;
      canvas.defaultCursor = "text";
      canvas.forEachObject((obj) => {
        if (obj.name !== "__bg__") {
          if (obj.type === "i-text" || obj instanceof fabric.IText) {
            obj.selectable = true;
            obj.evented = true;
          } else {
            obj.selectable = false;
            obj.evented = false;
          }
        }
      });
    } else if (tool === TOOLS.FREEHAND) {
      canvas.isDrawingMode = true;
      if (!canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      }
      canvas.freeDrawingBrush.color = strokeColorRef.current;
      canvas.freeDrawingBrush.width = strokeWidthRef.current;

      canvas.selection     = false;
      canvas.defaultCursor = "crosshair";
      canvas.forEachObject((obj) => {
        if (obj.name !== "__bg__") { obj.selectable = false; obj.evented = false; }
      });
    } else {
      canvas.isDrawingMode = false;
      canvas.selection     = false;
      canvas.defaultCursor = "crosshair";
      canvas.forEachObject((obj) => {
        if (obj.name !== "__bg__") { obj.selectable = false; obj.evented = false; }
      });
    }
    canvas.renderAll();
  }, []);

  useEffect(() => {
    if (!imageUrl || !canvasElRef.current) return;
    let isDisposed = false;

    const canvas = new fabric.Canvas(canvasElRef.current, {
      selection: true, preserveObjectStacking: true,
    });
    fabricRef.current = canvas;

    fabric.FabricImage.fromURL(imageUrl, { crossOrigin: "anonymous" }).then((img) => {
      if (isDisposed) return;
      const originalW = img.width || 900;
      const originalH = img.height || 600;
      canvas.setDimensions({ width: originalW, height: originalH });
      img.set({
        left: 0, top: 0,
        originX: "left", originY: "top",
        scaleX: 1, scaleY: 1, selectable: false, evented: false, name: "__bg__",
      });
      canvas.add(img);
      canvas.sendObjectToBack(img);
      canvas.renderAll();
      historyRef.current = [canvas.toJSON(["name", "selectable", "evented"])];
    }).catch(err => {
      console.error("Failed to load image into editor:", err);
    });

    // NOTE: mouse:wheel is intentionally NOT registered on canvas.
    // Wheel zoom is handled by the wrapper div listener above (CSS zoom approach).

    // Save history when a freehand path is drawn
    canvas.on("path:created", () => {
      pushSnapshot();
    });

    canvas.on("mouse:down", (opt) => {
      // Pan on Alt key or middle mouse
      if (opt.e.altKey || opt.e.button === 1) {
        canvas.isDragging = true;
        canvas.selection = false;
        canvas.lastPosX = opt.e.clientX;
        canvas.lastPosY = opt.e.clientY;
        opt.e.preventDefault();
        return;
      }

      const tool = activeToolRef.current;
      if (tool === TOOLS.SELECT || tool === TOOLS.FREEHAND) return;
      if (opt.target && opt.target.name !== "__bg__") return;
      opt.e.preventDefault();
      
      if (tool === TOOLS.CROP && cropRectRef.current) {
        canvas.remove(cropRectRef.current);
        cropRectRef.current = null;
        canvas.renderAll();
      }
      
      isDrawingRef.current = true;
      const pointer = opt.scenePoint || canvas.getScenePoint(opt.e);
      originRef.current = { x: pointer.x, y: pointer.y };

      if (tool === TOOLS.TEXT) {
        isDrawingRef.current = false;
        const text = new fabric.IText("Type here", {
          left: pointer.x, top: pointer.y,
          fontSize: fontSizeRef.current, fill: strokeColorRef.current,
          fontFamily: "Outfit, sans-serif", selectable: true, evented: true,
          editable: true, name: "text_" + Date.now(),
        });
        canvas.add(text);
        canvas.renderAll();
        setTimeout(() => {
          canvas.setActiveObject(text);
          text.enterEditing();
          text.selectAll();
          canvas.renderAll();
        }, 50);
        pushSnapshot();
        selectTool(TOOLS.SELECT);
        return;
      }

      const shapeProps = {
        stroke: strokeColorRef.current, strokeWidth: strokeWidthRef.current,
        fill: useFillRef.current ? fillColorRef.current : "transparent",
        selectable: false, evented: false, strokeUniform: true,
        originX: "left", originY: "top",
        name: tool + "_" + Date.now(),
      };

      if (tool === TOOLS.RECT || tool === TOOLS.CROP) {
        const isCrop = tool === TOOLS.CROP;
        const rect = new fabric.Rect({
          left: pointer.x, top: pointer.y, width: 1, height: 1, ...shapeProps,
          ...(isCrop && { fill: "rgba(139,92,246,0.18)", stroke: "#8b5cf6", strokeDashArray: [6, 4] }),
        });
        canvas.add(rect);
        drawingRef.current = rect;
        if (isCrop) {
          cropRectRef.current = rect;
        }
      }
      if (tool === TOOLS.CIRCLE) {
        const circle = new fabric.Circle({
          left: pointer.x, top: pointer.y, radius: 1,
          originX: "left", originY: "top", ...shapeProps,
        });
        canvas.add(circle);
        drawingRef.current = circle;
      }
      if (tool === TOOLS.ELLIPSE) {
        const ellipse = new fabric.Ellipse({
          left: pointer.x, top: pointer.y, rx: 1, ry: 1,
          originX: "left", originY: "top", ...shapeProps,
        });
        canvas.add(ellipse);
        drawingRef.current = ellipse;
      }
      if (tool === TOOLS.ARROW) {
        const arrow = new fabric.Path(`M ${pointer.x} ${pointer.y} L ${pointer.x} ${pointer.y}`, {
          ...shapeProps,
          fill: "transparent",
        });
        canvas.add(arrow);
        drawingRef.current = arrow;
      }
    });

    canvas.on("mouse:move", (opt) => {
      if (canvas.isDragging) {
        const e = opt.e;
        const vpt = canvas.viewportTransform;
        vpt[4] += e.clientX - canvas.lastPosX;
        vpt[5] += e.clientY - canvas.lastPosY;
        canvas.requestRenderAll();
        canvas.lastPosX = e.clientX;
        canvas.lastPosY = e.clientY;
        return;
      }

      if (!isDrawingRef.current || !drawingRef.current) return;
      const pointer = opt.scenePoint || canvas.getScenePoint(opt.e);
      const ox = originRef.current.x, oy = originRef.current.y;
      const tool = activeToolRef.current;
      if (tool === TOOLS.RECT || tool === TOOLS.CROP) {
        const isCrop = tool === TOOLS.CROP;
        let pX = pointer.x;
        let pY = pointer.y;
        let oX = ox;
        let oY = oy;

        if (isCrop) {
          pX = Math.max(0, Math.min(pX, canvas.width));
          pY = Math.max(0, Math.min(pY, canvas.height));
          oX = Math.max(0, Math.min(oX, canvas.width));
          oY = Math.max(0, Math.min(oY, canvas.height));
        }

        const newW = Math.abs(pX - oX);
        const newH = Math.abs(pY - oY);
        drawingRef.current.set({
          left: Math.min(oX, pX), top: Math.min(oY, pY),
          width: newW, height: newH,
        });
        drawingRef.current.setCoords();
      }
      if (tool === TOOLS.CIRCLE) {
        const dx = pointer.x - ox, dy = pointer.y - oy;
        const r = Math.sqrt(dx * dx + dy * dy) / 2;
        drawingRef.current.set({
          left: (ox + pointer.x) / 2 - r, top: (oy + pointer.y) / 2 - r, radius: Math.max(r, 1),
        });
        drawingRef.current.setCoords();
      }
      if (tool === TOOLS.ELLIPSE) {
        drawingRef.current.set({
          left: Math.min(ox, pointer.x), top: Math.min(oy, pointer.y),
          rx: Math.max(Math.abs(pointer.x - ox) / 2, 1), ry: Math.max(Math.abs(pointer.y - oy) / 2, 1),
        });
        drawingRef.current.setCoords();
      }
      if (tool === TOOLS.ARROW) {
        const x2 = pointer.x;
        const y2 = pointer.y;
        const angle = Math.atan2(y2 - oy, x2 - ox);
        const headLength = Math.max(15, strokeWidthRef.current * 4);
        const x3 = x2 - headLength * Math.cos(angle - Math.PI / 6);
        const y3 = y2 - headLength * Math.sin(angle - Math.PI / 6);
        const x4 = x2 - headLength * Math.cos(angle + Math.PI / 6);
        const y4 = y2 - headLength * Math.sin(angle + Math.PI / 6);
        const pathData = `M ${ox} ${oy} L ${x2} ${y2} M ${x3} ${y3} L ${x2} ${y2} L ${x4} ${y4}`;
        
        canvas.remove(drawingRef.current);
        const arrow = new fabric.Path(pathData, {
          stroke: strokeColorRef.current,
          strokeWidth: strokeWidthRef.current,
          fill: "transparent",
          selectable: false,
          evented: false,
          strokeUniform: true,
          originX: "left",
          originY: "top",
          name: tool + "_" + Date.now(),
        });
        canvas.add(arrow);
        drawingRef.current = arrow;
      }
      canvas.renderAll();
    });

    canvas.on("mouse:up", () => {
      if (canvas.isDragging) {
        canvas.setViewportTransform(canvas.viewportTransform);
        canvas.isDragging = false;
        if (activeToolRef.current === TOOLS.SELECT) {
          canvas.selection = true;
        }
        return;
      }

      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      const shape = drawingRef.current;
      drawingRef.current = null;
      if (!shape) return;
      if (activeToolRef.current === TOOLS.CROP) {
        if (cropRectRef.current) {
          cropRectRef.current.set({
            selectable: true,
            evented: true,
            lockRotation: true,
            lockSkewingX: true,
            lockSkewingY: true,
          });
          cropRectRef.current.setControlsVisibility({ mtr: false });
          cropRectRef.current.setCoords();
          canvas.setActiveObject(cropRectRef.current);
        }
        canvas.renderAll();
        return;
      }
      shape.set({ selectable: true, evented: true });
      shape.setCoords();
      canvas.renderAll();
      pushSnapshot();
    });

    canvas.on("object:modified", () => pushSnapshot());

    const handleKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      const isEditing = tag === "INPUT" || tag === "TEXTAREA";
      if (!isEditing && (e.key === "Delete" || e.key === "Backspace")) {
        const obj = canvas.getActiveObject();
        if (obj && obj.name !== "__bg__") {
          canvas.remove(obj); canvas.discardActiveObject(); canvas.renderAll(); pushSnapshot();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => { 
      isDisposed = true;
      window.removeEventListener("keydown", handleKeyDown); 
      canvas.dispose(); 
      fabricRef.current = null; 
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  useEffect(() => { applyToolMode(activeTool, fabricRef.current); }, [activeTool, applyToolMode]);

  // ─── Crop confirm ─────────────────────────────────────────────────────────
  const confirmCrop = useCallback(() => {
    const canvas = fabricRef.current;
    const cropRect = cropRectRef.current;
    if (!canvas || !cropRect) {
      console.log("ABORTING: canvas=", !!canvas, "cropRect=", !!cropRect);
      return;
    }
    
    cropRect.setCoords();
    const bounds = cropRect.getBoundingRect();
    
    let left = Math.max(0, bounds.left);
    let top = Math.max(0, bounds.top);
    let right = Math.min(canvas.width, bounds.left + bounds.width);
    let bottom = Math.min(canvas.height, bounds.top + bounds.height);
    
    let width = right - left;
    let height = bottom - top;

    if (width < 5 || height < 5) { cancelCrop(); return; }
    
    // Remove the crop rectangle so it doesn't appear in the snapshot
    canvas.remove(cropRect);
    cropRectRef.current = null;
    canvas.renderAll();
    
    try {
      // 1. Snapshot the entire canvas (flattens annotations into the image)
      const src = canvas.toDataURL({ format: "png", multiplier: 1 });
      
      // 2. Use an HTML Image element to load it
      const img2 = new Image();
      img2.onload = () => {
        try {
          // 3. Create an off-screen canvas sized exactly to the crop rectangle
          const tmp = document.createElement("canvas");
          tmp.width = Math.max(1, Math.round(width)); 
          tmp.height = Math.max(1, Math.round(height));
          
          // 4. Draw ONLY the cropped portion of the full image onto the off-screen canvas
          const ctx = tmp.getContext("2d");
          ctx.drawImage(
            img2, 
            Math.round(left), Math.round(top), Math.round(width), Math.round(height), // Source slice
            0, 0, Math.round(width), Math.round(height) // Destination
          );
          
          // 5. Get the base64 of the cropped image
          const croppedUrl = tmp.toDataURL("image/png");
          
          // 6. Safely remove ALL existing objects from the Fabric canvas (copy array first to avoid mutation skipping)
          const objects = [...canvas.getObjects()];
          objects.forEach(obj => canvas.remove(obj));
          
          // 7. Load the newly cropped image back into Fabric
          fabric.FabricImage.fromURL(croppedUrl, { crossOrigin: "anonymous" }).then((newImg) => {
            console.log("Cropped image loaded into Fabric.");
            const W = newImg.width || tmp.width;
            const H = newImg.height || tmp.height;
            
            // Resize Fabric canvas to the cropped size
            canvas.setDimensions({ width: W, height: H });
            
            newImg.set({
              left: 0, top: 0,
              originX: "left", originY: "top",
              scaleX: 1, scaleY: 1, selectable: false, evented: false, name: "__bg__",
            });
            
            canvas.add(newImg); 
            canvas.sendObjectToBack(newImg); 
            canvas.renderAll();
            
            historyRef.current = [canvas.toJSON(["name", "selectable", "evented"])];
            setCanUndo(false); setCanRedo(false); setCropMode(false); setActiveTool(TOOLS.SELECT);
            console.log("Crop complete.");
          }).catch(err => console.error("Crop load error:", err));
        } catch (err) {
          console.error("Crop processing error:", err);
        }
      };
      img2.onerror = (err) => console.error("Failed to load full image for cropping", err);
      img2.src = src;
    } catch (err) {
      console.error("Crop toDataURL error:", err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancelCrop = useCallback(() => {
    const canvas = fabricRef.current;
    if (cropRectRef.current && canvas) { canvas.remove(cropRectRef.current); cropRectRef.current = null; canvas.renderAll(); }
    setCropMode(false); setActiveTool(TOOLS.SELECT);
  }, []);

  // Update brush settings dynamically when color/width change
  useEffect(() => {
    const canvas = fabricRef.current;
    if (canvas && activeTool === TOOLS.FREEHAND && canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = strokeColor;
      canvas.freeDrawingBrush.width = strokeWidth;
    }
  }, [strokeColor, strokeWidth, activeTool]);

  const downloadImage = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.discardActiveObject(); canvas.renderAll();
    const dataUrl = canvas.toDataURL({ format: "png", multiplier: 1 });
    const link = document.createElement("a");
    link.href = dataUrl; link.download = `tasksnap-annotated-${Date.now()}.png`; link.click();
  }, []);

  const selectTool = (tool) => {
    // Clicking the already-active tool (other than Select) toggles back to Select
    const next = (tool !== TOOLS.SELECT && tool === activeTool) ? TOOLS.SELECT : tool;
    if (next !== TOOLS.CROP && cropRectRef.current) cancelCrop();
    setCropMode(next === TOOLS.CROP);
    setActiveTool(next);
  };

  const toolButtons = [
    { id: TOOLS.SELECT,   label: "↖ Select",  title: "Select & move objects" },
    { id: TOOLS.FREEHAND, label: "✏️ Freehand", title: "Draw freely" },
    { id: TOOLS.RECT,     label: "▭ Rect",    title: "Draw rectangle" },
    { id: TOOLS.CIRCLE,   label: "◯ Circle",  title: "Draw circle" },
    { id: TOOLS.ELLIPSE,  label: "⬭ Ellipse", title: "Draw ellipse" },
    { id: TOOLS.ARROW,    label: "➔ Arrow",   title: "Draw arrow" },
    { id: TOOLS.TEXT,     label: "T Text",    title: "Click to place editable text" },
    { id: TOOLS.CROP,     label: "✂ Crop",    title: "Crop image" },
  ];

  return (
    <div className="image-editor">
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

        <div className="toolbar-controls">
          <label className="control-group" title="Stroke / text color">
            <span className="control-label">Color</span>
            <input type="color" className="color-input" value={strokeColor}
              onChange={(e) => setStrokeColor(e.target.value)} />
          </label>

          <label className="control-group" title="Fill color (shapes)">
            <span className="control-label">Fill</span>
            <input type="color" className="color-input"
              value={fillColor === "transparent" ? "#ffffff" : fillColor}
              onChange={(e) => setFillColor(e.target.value)}
              disabled={!useFill} style={{ opacity: useFill ? 1 : 0.3 }} />
            <input type="checkbox" id="use-fill" checked={useFill}
              onChange={(e) => setUseFill(e.target.checked)}
              className="fill-checkbox" title="Enable fill" />
          </label>

          <label className="control-group" title="Stroke width">
            <span className="control-label">Width</span>
            <select className="stroke-select" value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}>
              {[1, 2, 3, 4, 6, 8, 10].map((w) => (
                <option key={w} value={w}>{w}px</option>
              ))}
            </select>
          </label>

          {activeTool === TOOLS.TEXT && (
            <label className="control-group" title="Font size">
              <span className="control-label">Size</span>
              <select className="stroke-select" value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}>
                {[12, 14, 16, 18, 20, 22, 24, 28, 32, 40, 48].map((s) => (
                  <option key={s} value={s}>{s}px</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-actions">
          <button className="action-btn-editor" onClick={handleZoomIn} title="Zoom In">🔍+</button>
          <button className="action-btn-editor" onClick={handleZoomOut} title="Zoom Out">🔍-</button>
          <button className="action-btn-editor" onClick={handleZoomReset} title="Reset Zoom">🔍=</button>
          <div className="toolbar-divider" />
          <button className="action-btn-editor" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↩ Undo</button>
          <button className="action-btn-editor" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">↪ Redo</button>
          <button className="action-btn-editor download-btn" onClick={downloadImage} title="Download annotated PNG">📥 Save</button>
          {onClose && (
            <button className="action-btn-editor close-btn" onClick={onClose} title="Close editor">✕ Close</button>
          )}
        </div>
      </div>

      {cropMode && (
        <div className="crop-bar">
          <span>✂ Draw a crop region on the canvas, then confirm.</span>
          <button className="crop-confirm-btn" onClick={confirmCrop}>✔ Confirm Crop</button>
          <button className="crop-cancel-btn" onClick={cancelCrop}>✕ Cancel</button>
        </div>
      )}

      <div className="editor-canvas-wrapper">
        {/* CSS zoom wrapper — scales visually AND layout so scrollbars appear */}
        <div
          ref={zoomWrapperRef}
          style={{ zoom: editorZoom, display: "inline-block", flexShrink: 0 }}
        >
          <canvas ref={canvasElRef} />
        </div>
      </div>
    </div>
  );
}
