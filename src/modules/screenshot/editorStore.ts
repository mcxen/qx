import { create } from "zustand";
import { temporal } from "zundo";

export type ScreenshotToolMode =
  | "select"
  | "arrow"
  | "rectangle"
  | "ellipse"
  | "text"
  | "blur"
  | "pixelate"
  | "crop";

export interface CanvasImage {
  id: string;
  src: string;
  sourcePath?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

interface AnnotationBase {
  id: string;
  x: number;
  y: number;
}

export interface ArrowAnnotation extends AnnotationBase {
  type: "arrow";
  points: number[];
  stroke: string;
  strokeWidth: number;
}

export interface RectAnnotation extends AnnotationBase {
  type: "rectangle";
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface EllipseAnnotation extends AnnotationBase {
  type: "ellipse";
  radiusX: number;
  radiusY: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface TextAnnotation extends AnnotationBase {
  type: "text";
  text: string;
  fontSize: number;
  fill: string;
}

export type AnnotationShape =
  | ArrowAnnotation
  | RectAnnotation
  | EllipseAnnotation
  | TextAnnotation;

export interface PrivacyRegion {
  id: string;
  type: "blur" | "pixelate";
  x: number;
  y: number;
  width: number;
  height: number;
  intensity: number;
}

export interface QxShotProject {
  version: number;
  createdAt: string;
  updatedAt: string;
  canvas: {
    width: number;
    height: number;
  };
  images: CanvasImage[];
  annotations: AnnotationShape[];
  privacyRegions: PrivacyRegion[];
}

interface ScreenshotEditorState {
  canvasWidth: number;
  canvasHeight: number;
  images: CanvasImage[];
  annotations: AnnotationShape[];
  privacyRegions: PrivacyRegion[];
  selectedId: string | null;
  activeTool: ScreenshotToolMode;
  strokeColor: string;
  strokeWidth: number;
  setCanvasSize: (width: number, height: number) => void;
  setActiveTool: (tool: ScreenshotToolMode) => void;
  setStrokeColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setSelectedId: (id: string | null) => void;
  addImage: (image: CanvasImage) => void;
  updateImage: (id: string, updates: Partial<CanvasImage>) => void;
  setImages: (images: CanvasImage[]) => void;
  addAnnotation: (annotation: AnnotationShape) => void;
  updateAnnotation: (id: string, updates: Partial<AnnotationShape>) => void;
  removeAnnotation: (id: string) => void;
  addPrivacyRegion: (region: PrivacyRegion) => void;
  updatePrivacyRegion: (id: string, updates: Partial<PrivacyRegion>) => void;
  removePrivacyRegion: (id: string) => void;
  removeSelected: () => void;
  loadProject: (project: QxShotProject) => void;
  resetEditor: () => void;
}

export const SCREENSHOT_COLORS = [
  "var(--qx-danger)",
  "var(--qx-accent)",
  "var(--qx-text-secondary)",
  "var(--qx-text-tertiary)",
  "var(--qx-text-primary)",
  "var(--qx-text-on-accent)",
];

const initialData = {
  canvasWidth: 960,
  canvasHeight: 540,
  images: [] as CanvasImage[],
  annotations: [] as AnnotationShape[],
  privacyRegions: [] as PrivacyRegion[],
  selectedId: null as string | null,
  activeTool: "select" as ScreenshotToolMode,
  strokeColor: "var(--qx-accent)",
  strokeWidth: 4,
};

export const useScreenshotEditorStore = create<ScreenshotEditorState>()(
  temporal(
    (set) => ({
      ...initialData,
      setCanvasSize: (canvasWidth, canvasHeight) => set({ canvasWidth, canvasHeight }),
      setActiveTool: (activeTool) => set({ activeTool }),
      setStrokeColor: (strokeColor) => set({ strokeColor }),
      setStrokeWidth: (strokeWidth) => set({ strokeWidth }),
      setSelectedId: (selectedId) => set({ selectedId }),
      addImage: (image) => set((state) => ({ images: [...state.images, image] })),
      updateImage: (id, updates) =>
        set((state) => ({
          images: state.images.map((image) =>
            image.id === id ? { ...image, ...updates } : image,
          ),
        })),
      setImages: (images) => set({ images }),
      addAnnotation: (annotation) =>
        set((state) => ({ annotations: [...state.annotations, annotation] })),
      updateAnnotation: (id, updates) =>
        set((state) => ({
          annotations: state.annotations.map((annotation) =>
            annotation.id === id
              ? ({ ...annotation, ...updates } as AnnotationShape)
              : annotation,
          ),
        })),
      removeAnnotation: (id) =>
        set((state) => ({
          annotations: state.annotations.filter((annotation) => annotation.id !== id),
          selectedId: state.selectedId === id ? null : state.selectedId,
        })),
      addPrivacyRegion: (region) =>
        set((state) => ({ privacyRegions: [...state.privacyRegions, region] })),
      updatePrivacyRegion: (id, updates) =>
        set((state) => ({
          privacyRegions: state.privacyRegions.map((region) =>
            region.id === id ? { ...region, ...updates } : region,
          ),
        })),
      removePrivacyRegion: (id) =>
        set((state) => ({
          privacyRegions: state.privacyRegions.filter((region) => region.id !== id),
          selectedId: state.selectedId === id ? null : state.selectedId,
        })),
      removeSelected: () =>
        set((state) => {
          if (!state.selectedId) return state;
          return {
            images: state.images.filter((image) => image.id !== state.selectedId),
            annotations: state.annotations.filter(
              (annotation) => annotation.id !== state.selectedId,
            ),
            privacyRegions: state.privacyRegions.filter(
              (region) => region.id !== state.selectedId,
            ),
            selectedId: null,
          };
        }),
      loadProject: (project) =>
        set({
          canvasWidth: project.canvas.width,
          canvasHeight: project.canvas.height,
          images: project.images,
          annotations: project.annotations,
          privacyRegions: project.privacyRegions,
          selectedId: null,
          activeTool: "select",
        }),
      resetEditor: () => set(initialData),
    }),
    {
      partialize: (state) => ({
        canvasWidth: state.canvasWidth,
        canvasHeight: state.canvasHeight,
        images: state.images,
        annotations: state.annotations,
        privacyRegions: state.privacyRegions,
      }),
      limit: 50,
    },
  ),
);

export function serializeQxShot(): QxShotProject {
  const state = useScreenshotEditorStore.getState();
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    canvas: {
      width: state.canvasWidth,
      height: state.canvasHeight,
    },
    images: state.images,
    annotations: state.annotations,
    privacyRegions: state.privacyRegions,
  };
}

export function parseQxShot(contents: string): QxShotProject {
  const data = JSON.parse(contents) as Partial<QxShotProject>;
  if (data.version !== 1 || !data.canvas || !Array.isArray(data.images)) {
    throw new Error("Invalid .qxshot project");
  }
  return {
    version: 1,
    createdAt: data.createdAt ?? new Date().toISOString(),
    updatedAt: data.updatedAt ?? new Date().toISOString(),
    canvas: data.canvas,
    images: data.images,
    annotations: data.annotations ?? [],
    privacyRegions: data.privacyRegions ?? [],
  };
}
