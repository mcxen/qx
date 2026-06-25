import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Image as TauriImage } from "@tauri-apps/api/image";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import {
  Circle,
  Copy,
  Crop,
  Download,
  Droplets,
  FileInput,
  FileJson,
  Grid3X3,
  MousePointer2,
  MoveUpRight,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import Konva from "konva";
import {
  Arrow as KonvaArrow,
  Ellipse,
  Image as KonvaImage,
  Layer,
  Rect,
  Stage,
  Text,
  Transformer,
} from "react-konva";
import { Select, SegmentedControl, Slider } from "../../components/ui";
import {
  parseQxShot,
  SCREENSHOT_COLORS,
  serializeQxShot,
  type AnnotationShape,
  type CanvasImage,
  type PrivacyRegion,
  type QxShotProject,
  type ScreenshotToolMode,
  useScreenshotEditorStore,
} from "./editorStore";

type ExportFormat = "png" | "jpeg" | "webp";

const TOOL_DEFS: {
  mode: ScreenshotToolMode;
  label: string;
  icon: React.ElementType;
}[] = [
  { mode: "select", label: "Select", icon: MousePointer2 },
  { mode: "arrow", label: "Arrow", icon: MoveUpRight },
  { mode: "rectangle", label: "Rect", icon: Square },
  { mode: "ellipse", label: "Oval", icon: Circle },
  { mode: "text", label: "Text", icon: Type },
  { mode: "blur", label: "Blur", icon: Droplets },
  { mode: "pixelate", label: "Pixel", icon: Grid3X3 },
  { mode: "crop", label: "Crop", icon: Crop },
];

function resolveCssColor(color: string) {
  if (!color.startsWith("var(")) return color;
  const name = color.slice(4, -1).trim();
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || color;
}

function useLoadedImage(src: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImage(img);
    img.src = src;
    return () => setImage(null);
  }, [src]);
  return image;
}

function ScreenshotImageNode({ image }: { image: CanvasImage }) {
  const htmlImage = useLoadedImage(image.src);
  const selectedId = useScreenshotEditorStore((state) => state.selectedId);
  const setSelectedId = useScreenshotEditorStore((state) => state.setSelectedId);
  const updateImage = useScreenshotEditorStore((state) => state.updateImage);
  const shapeRef = useRef<Konva.Image>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const selected = selectedId === image.id;

  useEffect(() => {
    if (selected && shapeRef.current && transformerRef.current) {
      transformerRef.current.nodes([shapeRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [selected]);

  return (
    <>
      <KonvaImage
        ref={shapeRef}
        image={htmlImage ?? undefined}
        x={image.x}
        y={image.y}
        width={image.width}
        height={image.height}
        draggable
        onClick={() => setSelectedId(image.id)}
        onTap={() => setSelectedId(image.id)}
        onDragEnd={(event) =>
          updateImage(image.id, {
            x: event.target.x(),
            y: event.target.y(),
          })
        }
        onTransformEnd={() => {
          const node = shapeRef.current;
          if (!node) return;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          updateImage(image.id, {
            x: node.x(),
            y: node.y(),
            width: Math.max(20, node.width() * scaleX),
            height: Math.max(20, node.height() * scaleY),
          });
        }}
      />
      {selected && <Transformer ref={transformerRef} rotateEnabled={false} />}
    </>
  );
}

function AnnotationNode({ annotation }: { annotation: AnnotationShape }) {
  const selectedId = useScreenshotEditorStore((state) => state.selectedId);
  const setSelectedId = useScreenshotEditorStore((state) => state.setSelectedId);
  const updateAnnotation = useScreenshotEditorStore((state) => state.updateAnnotation);
  const selected = selectedId === annotation.id;
  const nodeRef = useRef<Konva.Shape>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const common = {
    draggable: true,
    onClick: () => setSelectedId(annotation.id),
    onTap: () => setSelectedId(annotation.id),
    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) =>
      updateAnnotation(annotation.id, {
        x: event.target.x(),
        y: event.target.y(),
      } as Partial<AnnotationShape>),
  };

  useEffect(() => {
    if (selected && nodeRef.current && transformerRef.current) {
      transformerRef.current.nodes([nodeRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [selected]);

  let node: React.ReactNode;
  if (annotation.type === "arrow") {
    node = (
      <KonvaArrow
        ref={nodeRef as React.RefObject<Konva.Arrow>}
        {...common}
        x={annotation.x}
        y={annotation.y}
        points={annotation.points}
        stroke={annotation.stroke}
        fill={annotation.stroke}
        strokeWidth={annotation.strokeWidth}
        pointerLength={12}
        pointerWidth={12}
      />
    );
  } else if (annotation.type === "rectangle") {
    node = (
      <Rect
        ref={nodeRef as React.RefObject<Konva.Rect>}
        {...common}
        x={annotation.x}
        y={annotation.y}
        width={annotation.width}
        height={annotation.height}
        fill={annotation.fill}
        stroke={annotation.stroke}
        strokeWidth={annotation.strokeWidth}
        cornerRadius={6}
      />
    );
  } else if (annotation.type === "ellipse") {
    node = (
      <Ellipse
        ref={nodeRef as React.RefObject<Konva.Ellipse>}
        {...common}
        x={annotation.x}
        y={annotation.y}
        radiusX={annotation.radiusX}
        radiusY={annotation.radiusY}
        fill={annotation.fill}
        stroke={annotation.stroke}
        strokeWidth={annotation.strokeWidth}
      />
    );
  } else {
    node = (
      <Text
        ref={nodeRef as React.RefObject<Konva.Text>}
        {...common}
        x={annotation.x}
        y={annotation.y}
        text={annotation.text}
        fontSize={annotation.fontSize}
        fontFamily="Inter, system-ui, sans-serif"
        fill={annotation.fill}
      />
    );
  }

  return (
    <>
      {node}
      {selected && <Transformer ref={transformerRef} rotateEnabled={false} />}
    </>
  );
}

function PrivacyRegionNode({ region }: { region: PrivacyRegion }) {
  const selectedId = useScreenshotEditorStore((state) => state.selectedId);
  const setSelectedId = useScreenshotEditorStore((state) => state.setSelectedId);
  const updatePrivacyRegion = useScreenshotEditorStore((state) => state.updatePrivacyRegion);
  const selected = selectedId === region.id;
  const rectRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (selected && rectRef.current && transformerRef.current) {
      transformerRef.current.nodes([rectRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [selected]);

  return (
    <>
      <Rect
        ref={rectRef}
        x={region.x}
        y={region.y}
        width={region.width}
        height={region.height}
        fill={
          region.type === "blur"
            ? "rgba(160,160,160,0.72)"
            : "rgba(80,80,80,0.78)"
        }
        stroke="rgba(255,255,255,0.34)"
        strokeWidth={1}
        dash={region.type === "pixelate" ? [4, 4] : undefined}
        draggable
        onClick={() => setSelectedId(region.id)}
        onTap={() => setSelectedId(region.id)}
        onDragEnd={(event) =>
          updatePrivacyRegion(region.id, {
            x: event.target.x(),
            y: event.target.y(),
          })
        }
        onTransformEnd={() => {
          const node = rectRef.current;
          if (!node) return;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          updatePrivacyRegion(region.id, {
            x: node.x(),
            y: node.y(),
            width: Math.max(8, node.width() * scaleX),
            height: Math.max(8, node.height() * scaleY),
          });
        }}
      />
      {selected && <Transformer ref={transformerRef} rotateEnabled={false} />}
    </>
  );
}

function fitImageSize(naturalWidth: number, naturalHeight: number) {
  const maxW = 1120;
  const maxH = 720;
  const ratio = Math.min(1, maxW / naturalWidth, maxH / naturalHeight);
  return {
    width: Math.max(1, Math.round(naturalWidth * ratio)),
    height: Math.max(1, Math.round(naturalHeight * ratio)),
  };
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export default function ScreenshotEditor({
  activePath,
  onStatus,
  onSaved,
}: {
  activePath: string | null;
  onStatus: (message: string | null, tone?: "neutral" | "success" | "danger") => void;
  onSaved: (path?: string) => void;
}) {
  const stageRef = useRef<Konva.Stage>(null);
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawRect, setDrawRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [format, setFormat] = useState<ExportFormat>("png");
  const [quality, setQuality] = useState(90);
  const [scale, setScale] = useState<"1" | "2" | "3">("1");
  const [loadError, setLoadError] = useState<string | null>(null);

  const canvasWidth = useScreenshotEditorStore((state) => state.canvasWidth);
  const canvasHeight = useScreenshotEditorStore((state) => state.canvasHeight);
  const images = useScreenshotEditorStore((state) => state.images);
  const annotations = useScreenshotEditorStore((state) => state.annotations);
  const privacyRegions = useScreenshotEditorStore((state) => state.privacyRegions);
  const activeTool = useScreenshotEditorStore((state) => state.activeTool);
  const strokeColor = useScreenshotEditorStore((state) => state.strokeColor);
  const strokeWidth = useScreenshotEditorStore((state) => state.strokeWidth);
  const selectedId = useScreenshotEditorStore((state) => state.selectedId);
  const setCanvasSize = useScreenshotEditorStore((state) => state.setCanvasSize);
  const setActiveTool = useScreenshotEditorStore((state) => state.setActiveTool);
  const setStrokeColor = useScreenshotEditorStore((state) => state.setStrokeColor);
  const setStrokeWidth = useScreenshotEditorStore((state) => state.setStrokeWidth);
  const setSelectedId = useScreenshotEditorStore((state) => state.setSelectedId);
  const addImage = useScreenshotEditorStore((state) => state.addImage);
  const setImages = useScreenshotEditorStore((state) => state.setImages);
  const addAnnotation = useScreenshotEditorStore((state) => state.addAnnotation);
  const addPrivacyRegion = useScreenshotEditorStore((state) => state.addPrivacyRegion);
  const removeSelected = useScreenshotEditorStore((state) => state.removeSelected);
  const loadProject = useScreenshotEditorStore((state) => state.loadProject);
  const resetEditor = useScreenshotEditorStore((state) => state.resetEditor);
  const updateImage = useScreenshotEditorStore((state) => state.updateImage);

  const fitScale = useMemo(() => {
    const maxW = 760;
    const maxH = 430;
    return Math.min(1, maxW / canvasWidth, maxH / canvasHeight);
  }, [canvasHeight, canvasWidth]);

  const addImageFromPath = useCallback(
    (path: string) => {
      setLoadError(null);
      const src = convertFileSrc(path);
      const img = new window.Image();
      img.onload = () => {
        const fitted = fitImageSize(img.naturalWidth, img.naturalHeight);
        setCanvasSize(fitted.width, fitted.height);
        setImages([]);
        addImage({
          id: crypto.randomUUID(),
          src,
          sourcePath: path,
          x: 0,
          y: 0,
          width: fitted.width,
          height: fitted.height,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        });
        setSelectedId(null);
      };
      img.onerror = () => {
        setLoadError(`Failed to load ${path.split("/").pop() ?? "screenshot"}`);
        onStatus("Preview load failed", "danger");
      };
      img.src = src;
    },
    [addImage, onStatus, setCanvasSize, setImages, setSelectedId],
  );

  useEffect(() => {
    if (activePath) addImageFromPath(activePath);
  }, [activePath, addImageFromPath]);

  const pointer = () => {
    const stage = stageRef.current;
    const point = stage?.getPointerPosition();
    if (!stage || !point) return null;
    return {
      x: point.x / fitScale,
      y: point.y / fitScale,
    };
  };

  const addToolAt = (x: number, y: number) => {
    const color = resolveCssColor(strokeColor);
    const id = crypto.randomUUID();
    if (activeTool === "arrow") {
      addAnnotation({
        id,
        type: "arrow",
        x,
        y,
        points: [0, 0, 120, 0],
        stroke: color,
        strokeWidth,
      });
    } else if (activeTool === "rectangle") {
      addAnnotation({
        id,
        type: "rectangle",
        x,
        y,
        width: 140,
        height: 88,
        fill: "rgba(255,255,255,0.01)",
        stroke: color,
        strokeWidth,
      });
    } else if (activeTool === "ellipse") {
      addAnnotation({
        id,
        type: "ellipse",
        x,
        y,
        radiusX: 72,
        radiusY: 44,
        fill: "rgba(255,255,255,0.01)",
        stroke: color,
        strokeWidth,
      });
    } else if (activeTool === "text") {
      addAnnotation({
        id,
        type: "text",
        x,
        y,
        text: "Text",
        fontSize: 36,
        fill: color,
      });
    }
    setSelectedId(id);
  };

  const cropSelection = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      const image = images.find((item) => item.id === selectedId) ?? images[0];
      if (!image || rect.width < 8 || rect.height < 8) return;
      const htmlImage = new window.Image();
      htmlImage.onload = () => {
        const overlapX = Math.max(rect.x, image.x);
        const overlapY = Math.max(rect.y, image.y);
        const overlapRight = Math.min(rect.x + rect.width, image.x + image.width);
        const overlapBottom = Math.min(rect.y + rect.height, image.y + image.height);
        const overlapW = overlapRight - overlapX;
        const overlapH = overlapBottom - overlapY;
        if (overlapW < 8 || overlapH < 8) return;

        const scaleX = htmlImage.naturalWidth / image.width;
        const scaleY = htmlImage.naturalHeight / image.height;
        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = Math.round(overlapW);
        cropCanvas.height = Math.round(overlapH);
        const ctx = cropCanvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(
          htmlImage,
          Math.round((overlapX - image.x) * scaleX),
          Math.round((overlapY - image.y) * scaleY),
          Math.round(overlapW * scaleX),
          Math.round(overlapH * scaleY),
          0,
          0,
          Math.round(overlapW),
          Math.round(overlapH),
        );
        updateImage(image.id, {
          src: cropCanvas.toDataURL("image/png"),
          x: overlapX,
          y: overlapY,
          width: overlapW,
          height: overlapH,
          naturalWidth: Math.round(overlapW),
          naturalHeight: Math.round(overlapH),
        });
      };
      htmlImage.src = image.src;
    },
    [images, selectedId, updateImage],
  );

  const handleStageMouseDown = () => {
    const pos = pointer();
    if (!pos) return;
    if (activeTool === "select") {
      setSelectedId(null);
      return;
    }
    if (activeTool === "blur" || activeTool === "pixelate" || activeTool === "crop") {
      setDrawStart(pos);
      setDrawRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
      return;
    }
    addToolAt(pos.x, pos.y);
    setActiveTool("select");
  };

  const handleStageMouseMove = () => {
    if (!drawStart) return;
    const pos = pointer();
    if (!pos) return;
    setDrawRect({
      x: Math.min(drawStart.x, pos.x),
      y: Math.min(drawStart.y, pos.y),
      width: Math.abs(pos.x - drawStart.x),
      height: Math.abs(pos.y - drawStart.y),
    });
  };

  const handleStageMouseUp = () => {
    if (!drawRect || !drawStart) return;
    if (drawRect.width >= 8 && drawRect.height >= 8) {
      if (activeTool === "crop") {
        cropSelection(drawRect);
      } else if (activeTool === "blur" || activeTool === "pixelate") {
        addPrivacyRegion({
          id: crypto.randomUUID(),
          type: activeTool,
          x: drawRect.x,
          y: drawRect.y,
          width: drawRect.width,
          height: drawRect.height,
          intensity: activeTool === "blur" ? 10 : 8,
        });
      }
    }
    setDrawStart(null);
    setDrawRect(null);
    setActiveTool("select");
  };

  const stageData = async (exportScale: number, mimeType = "image/png") => {
    const stage = stageRef.current;
    if (!stage) throw new Error("No editor canvas");
    const dataUrl = stage.toDataURL({
      pixelRatio: exportScale / fitScale,
      mimeType,
      quality: quality / 100,
    });
    const img = new window.Image();
    img.src = dataUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to render editor image"));
    });
    const outW = Math.round(canvasWidth * exportScale);
    const outH = Math.round(canvasHeight * exportScale);
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create export canvas");
    ctx.drawImage(img, 0, 0, outW, outH);
    return ctx.getImageData(0, 0, outW, outH);
  };

  const exportFile = async () => {
    try {
      onStatus("Exporting", "neutral");
      const output = await save({
        defaultPath: `screenshot.${format}`,
        filters: [{ name: `${format.toUpperCase()} image`, extensions: [format] }],
      });
      if (!output) {
        onStatus(null);
        return;
      }
      const exportScale = Number(scale);
      const imageData = await stageData(exportScale, format === "png" ? "image/png" : "image/jpeg");
      const path = await invoke<string>("export_screenshot_image", {
        imageData: Array.from(new Uint8Array(imageData.data.buffer)),
        width: imageData.width,
        height: imageData.height,
        outputPath: output,
        format,
        quality,
      });
      onStatus("Saved", "success");
      onSaved(path);
    } catch (error) {
      onStatus(`Export failed: ${error}`, "danger");
    }
  };

  const copyEdited = async () => {
    try {
      const imageData = await stageData(Number(scale), "image/png");
      const canvas = document.createElement("canvas");
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to create clipboard canvas");
      ctx.putImageData(imageData, 0, 0);
      const tauriImage = await TauriImage.fromBytes(dataUrlToBytes(canvas.toDataURL("image/png")));
      await writeImage(tauriImage);
      onStatus("Copied", "success");
    } catch (error) {
      onStatus(`Copy failed: ${error}`, "danger");
    }
  };

  const saveProject = async () => {
    try {
      const output = await save({
        defaultPath: "Untitled.qxshot",
        filters: [{ name: "Qx Shot", extensions: ["qxshot"] }],
      });
      if (!output) return;
      const project = JSON.stringify(serializeQxShot(), null, 2);
      await invoke("save_screenshot_project", { path: output, contents: project });
      onStatus("Project saved", "success");
    } catch (error) {
      onStatus(`Save project failed: ${error}`, "danger");
    }
  };

  const openProject = async () => {
    try {
      const input = await open({
        multiple: false,
        filters: [{ name: "Qx Shot", extensions: ["qxshot"] }],
      });
      if (!input) return;
      const contents = await invoke<string>("read_screenshot_project", { path: input });
      const project: QxShotProject = parseQxShot(contents);
      loadProject(project);
      useScreenshotEditorStore.temporal.getState().clear();
      onStatus("Project loaded", "success");
    } catch (error) {
      onStatus(`Open project failed: ${error}`, "danger");
    }
  };

  const undo = () => useScreenshotEditorStore.temporal.getState().undo();
  const redo = () => useScreenshotEditorStore.temporal.getState().redo();

  return (
    <div className="qx-shot-editor">
      <div className="qx-shot-toolstrip" aria-label="Screenshot tools">
        {TOOL_DEFS.map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            type="button"
            className={`qx-icon-tool${activeTool === mode ? " is-active" : ""}`}
            onClick={() => setActiveTool(mode)}
            title={label}
            aria-label={label}
          >
            <Icon size={16} />
          </button>
        ))}
        <span className="qx-tool-separator" aria-hidden="true" />
        <button type="button" className="qx-icon-tool" onClick={undo} title="Undo" aria-label="Undo">
          <Undo2 size={16} />
        </button>
        <button type="button" className="qx-icon-tool" onClick={redo} title="Redo" aria-label="Redo">
          <Redo2 size={16} />
        </button>
        <button
          type="button"
          className="qx-icon-tool"
          onClick={removeSelected}
          disabled={!selectedId}
          title="Delete selected"
          aria-label="Delete selected"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div ref={stageWrapRef} className="qx-shot-stage-wrap">
        {images.length === 0 ? (
          <div className="qx-empty-state">
            {loadError ?? "Capture or select a screenshot to start editing"}
          </div>
        ) : (
          <Stage
            ref={stageRef}
            width={Math.round(canvasWidth * fitScale)}
            height={Math.round(canvasHeight * fitScale)}
            scaleX={fitScale}
            scaleY={fitScale}
            className="qx-shot-stage"
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
          >
            <Layer>
              <Rect width={canvasWidth} height={canvasHeight} fill="#fff" />
              {images.map((image) => (
                <ScreenshotImageNode key={image.id} image={image} />
              ))}
              {annotations.map((annotation) => (
                <AnnotationNode key={annotation.id} annotation={annotation} />
              ))}
              {privacyRegions.map((region) => (
                <PrivacyRegionNode key={region.id} region={region} />
              ))}
              {drawRect && (
                <Rect
                  x={drawRect.x}
                  y={drawRect.y}
                  width={drawRect.width}
                  height={drawRect.height}
                  stroke={resolveCssColor("var(--qx-accent)")}
                  dash={[6, 4]}
                  strokeWidth={1}
                  fill="rgba(0,0,0,0.05)"
                />
              )}
            </Layer>
          </Stage>
        )}
      </div>

      <div className="qx-shot-export-row">
        <SegmentedControl
          value={format}
          options={[
            { value: "png", label: "PNG" },
            { value: "jpeg", label: "JPG" },
            { value: "webp", label: "WEBP" },
          ]}
          onChange={setFormat}
        />
        <Select
          value={scale}
          options={[
            { value: "1", label: "1x" },
            { value: "2", label: "2x" },
            { value: "3", label: "3x" },
          ]}
          onChange={setScale}
          ariaLabel="Export scale"
        />
        {format !== "png" && (
          <Slider
            value={quality}
            min={10}
            max={100}
            step={5}
            onChange={setQuality}
            ariaLabel="Export quality"
          />
        )}
        <button type="button" className="qx-command-button" onClick={copyEdited}>
          <Copy size={14} />
          Copy
        </button>
        <button type="button" className="qx-command-button primary" onClick={exportFile}>
          <Download size={14} />
          Export
        </button>
        <button type="button" className="qx-command-button" onClick={saveProject}>
          <FileJson size={14} />
          Save
        </button>
        <button type="button" className="qx-command-button" onClick={openProject}>
          <FileInput size={14} />
          Open
        </button>
        <button type="button" className="qx-command-button ghost" onClick={resetEditor}>
          Reset
        </button>
      </div>

      <div className="qx-shot-style-row">
        <span>Color</span>
        {SCREENSHOT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`qx-shot-swatch${strokeColor === color ? " is-active" : ""}`}
            style={{ background: color }}
            onClick={() => setStrokeColor(color)}
            aria-label={`Use color ${color}`}
          />
        ))}
        <span>Stroke</span>
        <Slider
          value={strokeWidth}
          min={1}
          max={12}
          step={1}
          onChange={setStrokeWidth}
          ariaLabel="Stroke width"
        />
      </div>
    </div>
  );
}
