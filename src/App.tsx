import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Clipboard, Download, MousePointer2, RefreshCw, Swords, Upload } from 'lucide-react';

/** 크롭 영역은 표시 크기와 무관하도록 0~1 비율로 저장한다. */
type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type HandleId = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

type Point = { x: number; y: number };

type DragState = {
  pointerId: number;
  pointerType: string;
  mode: 'create' | 'move' | 'resize';
  handle?: HandleId;
  origin: Point;
  startRect: CropRect;
  previousRect: CropRect | null;
  moved: boolean;
};

const MAX_IMAGES = 10;
const LEFT_COLUMN_COUNT = 5;
/** 손가락으로 살짝 눌렀을 때 기존 선택이 지워지지 않게 하는 최소 크기(비율). */
const MIN_CROP_SIZE = 0.01;
const LOUPE_SIZE = 116;
const LOUPE_ZOOM = 2.5;

const LEFT_ACCENT = '#2563eb';
const RIGHT_ACCENT = '#dc2626';

/** 결과 이미지만 봐도 어느 쪽이 공격인지 알 수 있도록 열 위에 붙이는 표시. */
const SIDE_MODES = [
  { id: 'left-attack', label: '왼쪽 공격', leftLabel: '공격', rightLabel: '수비' },
  { id: 'right-attack', label: '오른쪽 공격', leftLabel: '수비', rightLabel: '공격' },
  { id: 'none', label: '표시 안 함', leftLabel: null, rightLabel: null },
] as const;

type SideModeId = (typeof SIDE_MODES)[number]['id'];

const HANDLES: { id: HandleId; fx: number; fy: number; cursor: string; label: string }[] = [
  { id: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize', label: '왼쪽 위' },
  { id: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize', label: '위쪽' },
  { id: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize', label: '오른쪽 위' },
  { id: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize', label: '왼쪽' },
  { id: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize', label: '오른쪽' },
  { id: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize', label: '왼쪽 아래' },
  { id: 's', fx: 0.5, fy: 1, cursor: 'ns-resize', label: '아래쪽' },
  { id: 'se', fx: 1, fy: 1, cursor: 'nwse-resize', label: '오른쪽 아래' },
];

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export default function App() {
  const [images, setImages] = useState<string[]>([]);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [targetReplaceIndex, setTargetReplaceIndex] = useState<number | null>(null);
  const [sideModeId, setSideModeId] = useState<SideModeId>('left-attack');
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [loupePoint, setLoupePoint] = useState<Point | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const processFiles = useCallback(
    async (files: File[]) => {
      const imageFiles = files.filter(Boolean).filter((file) => file.type.startsWith('image/'));
      if (imageFiles.length === 0) return;

      const newImages = await Promise.all(imageFiles.map(readFileAsDataUrl));

      setImages((prevImages) => {
        if (targetReplaceIndex !== null) {
          const updatedImages = [...prevImages];
          updatedImages[targetReplaceIndex] = newImages[0];
          return updatedImages;
        }

        return [...prevImages, ...newImages].slice(0, MAX_IMAGES);
      });

      setTargetReplaceIndex(null);
      setCropRect(null);
      setResultImage(null);
    },
    [targetReplaceIndex],
  );

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    processFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items ?? []);
      const pastedFiles = items
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);

      processFiles(pastedFiles);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [processFiles]);

  /** 화면 회전이나 창 크기 변경에도 돋보기 배율이 맞도록 표시 크기를 추적한다. */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateSize = () => {
      setDisplaySize({ width: element.clientWidth, height: element.clientHeight });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [images.length]);

  const toNormalizedPoint = useCallback((clientX: number, clientY: number): Point | null => {
    const element = containerRef.current;
    if (!element) return null;

    const bounds = element.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;

    return {
      x: clamp01((clientX - bounds.left) / bounds.width),
      y: clamp01((clientY - bounds.top) / bounds.height),
    };
  }, []);

  const endDrag = useCallback((cancelled = false) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setIsDragging(false);
    setLoupePoint(null);
    if (!drag) return;

    /** 취소된 제스처거나 드래그 없이 톡 누르기만 했다면 직전 선택을 되살린다. */
    if (cancelled || (drag.mode === 'create' && !drag.moved)) {
      setCropRect(drag.previousRect);
    }
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;

      const point = toNormalizedPoint(event.clientX, event.clientY);
      if (!point) return;

      event.preventDefault();
      setLoupePoint(point);

      if (drag.mode === 'create') {
        const width = Math.abs(point.x - drag.origin.x);
        const height = Math.abs(point.y - drag.origin.y);
        if (width > MIN_CROP_SIZE || height > MIN_CROP_SIZE) {
          drag.moved = true;
        }

        setCropRect({
          x: Math.min(drag.origin.x, point.x),
          y: Math.min(drag.origin.y, point.y),
          width,
          height,
        });
        return;
      }

      if (drag.mode === 'move') {
        const deltaX = point.x - drag.origin.x;
        const deltaY = point.y - drag.origin.y;

        setCropRect({
          ...drag.startRect,
          x: Math.min(Math.max(drag.startRect.x + deltaX, 0), 1 - drag.startRect.width),
          y: Math.min(Math.max(drag.startRect.y + deltaY, 0), 1 - drag.startRect.height),
        });
        return;
      }

      const handle = drag.handle ?? 'se';
      let left = drag.startRect.x;
      let top = drag.startRect.y;
      let right = drag.startRect.x + drag.startRect.width;
      let bottom = drag.startRect.y + drag.startRect.height;

      if (handle.includes('w')) left = point.x;
      if (handle.includes('e')) right = point.x;
      if (handle.includes('n')) top = point.y;
      if (handle.includes('s')) bottom = point.y;

      const width = Math.max(Math.abs(right - left), MIN_CROP_SIZE);
      const height = Math.max(Math.abs(bottom - top), MIN_CROP_SIZE);

      setCropRect({
        x: Math.min(Math.min(left, right), 1 - width),
        y: Math.min(Math.min(top, bottom), 1 - height),
        width,
        height,
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (dragRef.current && event.pointerId !== dragRef.current.pointerId) return;
      endDrag();
    };

    /** 브라우저가 제스처를 가져간 경우(확대 등)에는 그리던 영역을 되돌린다. */
    const handlePointerCancel = (event: PointerEvent) => {
      if (dragRef.current && event.pointerId !== dragRef.current.pointerId) return;
      endDrag(true);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [endDrag, isDragging, toNormalizedPoint]);

  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    mode: DragState['mode'],
    handle?: HandleId,
  ) => {
    /** 두 손가락으로 확대하려는 동작이면 그리던 영역을 되돌리고 브라우저에 넘긴다. */
    if (dragRef.current) {
      endDrag(true);
      return;
    }

    if (event.button !== 0 && event.pointerType === 'mouse') return;

    const point = toNormalizedPoint(event.clientX, event.clientY);
    if (!point) return;

    event.preventDefault();
    event.stopPropagation();

    const startRect = cropRect ?? { x: point.x, y: point.y, width: 0, height: 0 };

    dragRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      mode,
      handle,
      origin: point,
      startRect,
      previousRect: cropRect,
      moved: false,
    };

    if (mode === 'create') {
      setCropRect({ x: point.x, y: point.y, width: 0, height: 0 });
    }

    setLoupePoint(point);
    setIsDragging(true);
  };

  const selectWholeImage = () => {
    setCropRect({ x: 0, y: 0, width: 1, height: 1 });
  };

  const clearSelection = () => {
    setCropRect(null);
  };

  const hasSelection = Boolean(cropRect && cropRect.width > MIN_CROP_SIZE && cropRect.height > MIN_CROP_SIZE);

  const sideMode = SIDE_MODES.find((mode) => mode.id === sideModeId) ?? SIDE_MODES[0];

  const selectionPixels =
    cropRect && naturalSize.width > 0
      ? {
          width: Math.round(cropRect.width * naturalSize.width),
          height: Math.round(cropRect.height * naturalSize.height),
        }
      : null;

  const generateComparison = async () => {
    if (!cropRect || !hasSelection || !imgRef.current) {
      alert('첫 번째 이미지에서 비교할 범위를 드래그해서 선택해 주세요.');
      return;
    }

    setIsProcessing(true);

    try {
      const sourceX = cropRect.x * imgRef.current.naturalWidth;
      const sourceY = cropRect.y * imgRef.current.naturalHeight;
      const sourceWidth = cropRect.width * imgRef.current.naturalWidth;
      const sourceHeight = cropRect.height * imgRef.current.naturalHeight;

      const padding = 16;
      const rowGap = 12;
      const middleGap = 40;
      const columnWidth = sourceWidth + padding * 2;

      /** 잘라낸 영역 크기가 제각각이라 표시 글자도 열 너비에 맞춰 키운다. */
      const labelFontSize = Math.round(Math.min(Math.max(columnWidth * 0.09, 20), 56));
      const headerHeight = sideMode.leftLabel ? Math.round(labelFontSize * 2.4) : 0;
      const columnHeight = headerHeight + sourceHeight * LEFT_COLUMN_COUNT + rowGap * 4 + padding * 2;

      const canvas = document.createElement('canvas');
      canvas.width = columnWidth * 2 + middleGap;
      canvas.height = columnHeight;

      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas context를 만들 수 없습니다.');
      }

      context.fillStyle = '#111827';
      context.fillRect(0, 0, canvas.width, canvas.height);

      const leftColumnX = 0;
      context.fillStyle = 'rgba(29, 78, 216, 0.15)';
      context.fillRect(leftColumnX, 0, columnWidth, columnHeight);
      context.strokeStyle = '#3b82f6';
      context.lineWidth = 4;
      context.strokeRect(leftColumnX + 2, 2, columnWidth - 4, columnHeight - 4);

      const rightColumnX = columnWidth + middleGap;
      context.fillStyle = 'rgba(185, 28, 28, 0.15)';
      context.fillRect(rightColumnX, 0, columnWidth, columnHeight);
      context.strokeStyle = '#ef4444';
      context.lineWidth = 4;
      context.strokeRect(rightColumnX + 2, 2, columnWidth - 4, columnHeight - 4);

      const drawSideLabel = (columnX: number, text: string, accent: string) => {
        context.font = `bold ${labelFontSize}px sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';

        const pillHeight = labelFontSize * 1.6;
        const pillWidth = context.measureText(text).width + labelFontSize * 1.8;
        const pillX = columnX + (columnWidth - pillWidth) / 2;
        const pillY = (headerHeight - pillHeight) / 2;

        context.fillStyle = accent;
        context.beginPath();
        if (typeof context.roundRect === 'function') {
          context.roundRect(pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
        } else {
          context.rect(pillX, pillY, pillWidth, pillHeight);
        }
        context.fill();

        context.fillStyle = '#ffffff';
        context.fillText(text, columnX + columnWidth / 2, pillY + pillHeight / 2);

        context.textAlign = 'left';
        context.textBaseline = 'alphabetic';
      };

      if (sideMode.leftLabel && sideMode.rightLabel) {
        drawSideLabel(leftColumnX, sideMode.leftLabel, LEFT_ACCENT);
        drawSideLabel(rightColumnX, sideMode.rightLabel, RIGHT_ACCENT);
      }

      for (let index = 0; index < images.length; index += 1) {
        const image = await loadImage(images[index]);
        const isLeft = index < LEFT_COLUMN_COUNT;
        const rowIndex = isLeft ? index : index - LEFT_COLUMN_COUNT;
        const drawX = isLeft ? leftColumnX + padding : rightColumnX + padding;
        const drawY = headerHeight + padding + rowIndex * (sourceHeight + rowGap);

        context.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          drawX,
          drawY,
          sourceWidth,
          sourceHeight,
        );

        context.fillStyle = 'rgba(0, 0, 0, 0.7)';
        context.fillRect(drawX, drawY, 32, 28);
        context.fillStyle = isLeft ? '#93c5fd' : '#fca5a5';
        context.font = 'bold 15px sans-serif';
        context.fillText(`${index + 1}`, drawX + 11, drawY + 19);
      }

      setResultImage(canvas.toDataURL('image/jpeg', 0.95));
    } catch (error) {
      console.error(error);
      alert('비교 이미지를 생성하는 중 문제가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  const resetAll = () => {
    setImages([]);
    setCropRect(null);
    setResultImage(null);
    setTargetReplaceIndex(null);
  };

  const loupeStyle: CSSProperties | null =
    loupePoint && images.length > 0 && displaySize.width > 0
      ? {
          width: LOUPE_SIZE,
          height: LOUPE_SIZE,
          top: loupePoint.y < 0.45 ? undefined : 8,
          bottom: loupePoint.y < 0.45 ? 8 : undefined,
          left: loupePoint.x > 0.55 ? 8 : undefined,
          right: loupePoint.x > 0.55 ? undefined : 8,
          backgroundImage: `url(${images[0]})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${displaySize.width * LOUPE_ZOOM}px ${displaySize.height * LOUPE_ZOOM}px`,
          backgroundPosition: `${LOUPE_SIZE / 2 - loupePoint.x * displaySize.width * LOUPE_ZOOM}px ${
            LOUPE_SIZE / 2 - loupePoint.y * displaySize.height * LOUPE_ZOOM
          }px`,
        }
      : null;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-800 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-bold text-slate-950">챔레나 비교 이미지 생성기</h1>
          <p className="text-sm text-slate-600 sm:text-base">
            최대 10장의 이미지를 올리거나 붙여넣고, 첫 이미지에서 선택한 같은 영역을 좌우 5장씩 비교 이미지로 만듭니다.
          </p>
        </header>

        {images.length === 0 ? (
          <section className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white p-10 text-center shadow-sm sm:p-12">
            <Upload className="mb-4 h-12 w-12 text-slate-400" />
            <h2 className="mb-2 text-lg font-semibold text-slate-900">이미지 업로드</h2>
            <p className="mb-2 text-sm text-slate-500">비교할 이미지를 최대 10장까지 선택해 주세요.</p>
            <p className="mb-6 flex items-center justify-center text-sm font-semibold text-blue-600">
              <Clipboard className="mr-1 h-4 w-4" />
              Ctrl+V 또는 Cmd+V로 이미지 붙여넣기도 가능합니다.
            </p>
            <label className="cursor-pointer rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700">
              이미지 파일 선택
              <input type="file" multiple accept="image/*" className="hidden" onChange={handleFileUpload} />
            </label>
          </section>
        ) : (
          <section className="space-y-6">
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                <span className="font-medium text-slate-700">준비된 이미지:</span>
                <span className="ml-2 font-bold text-blue-600">{images.length}장</span>
                {images.length < MAX_IMAGES && targetReplaceIndex === null && (
                  <span className="ml-2 text-slate-500">남은 {MAX_IMAGES - images.length}장은 추가할 수 있습니다.</span>
                )}
                {images.length === MAX_IMAGES && targetReplaceIndex === null && (
                  <span className="ml-2 font-medium text-green-600">10장이 모두 준비되었습니다.</span>
                )}
                {targetReplaceIndex !== null && (
                  <span className="ml-2 font-bold text-yellow-700">{targetReplaceIndex + 1}번 이미지 교체 대기 중</span>
                )}
              </div>
              <button
                type="button"
                onClick={resetAll}
                className="inline-flex items-center justify-center text-sm font-medium text-slate-500 hover:text-slate-800"
              >
                <RefreshCw className="mr-1 h-4 w-4" />
                초기화
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">이미지 확인 및 교체</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    1~5번은 왼쪽{sideMode.leftLabel ? `(${sideMode.leftLabel})` : ''}, 6~10번은 오른쪽
                    {sideMode.rightLabel ? `(${sideMode.rightLabel})` : ''}에 놓입니다.
                  </p>
                </div>
                {targetReplaceIndex !== null && (
                  <button
                    type="button"
                    onClick={() => setTargetReplaceIndex(null)}
                    className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-200"
                  >
                    교체 취소
                  </button>
                )}
              </div>
              <div className="grid grid-cols-5 gap-2 md:grid-cols-10">
                {Array.from({ length: MAX_IMAGES }).map((_, index) => (
                  <button
                    type="button"
                    key={index}
                    onClick={() => {
                      if (index < images.length) {
                        setTargetReplaceIndex(targetReplaceIndex === index ? null : index);
                      }
                    }}
                    className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-all ${
                      targetReplaceIndex === index
                        ? 'border-yellow-500 ring-2 ring-yellow-300'
                        : index < images.length
                          ? 'cursor-pointer border-slate-200 hover:border-blue-400'
                          : 'border-dashed border-slate-200 bg-slate-50'
                    }`}
                  >
                    <span
                      className={`absolute left-0 top-0 z-10 rounded-br px-1.5 py-0.5 text-[10px] text-white ${
                        index < LEFT_COLUMN_COUNT ? 'bg-blue-600' : 'bg-red-600'
                      }`}
                    >
                      {index + 1}
                    </span>

                    {index < images.length ? (
                      <img src={images[index]} alt={`${index + 1}번 이미지`} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[10px] text-slate-300">
                        비어있음
                      </span>
                    )}

                    {targetReplaceIndex === index && (
                      <span className="absolute inset-0 flex flex-col items-center justify-center bg-yellow-950/70">
                        <span className="mb-1 text-[10px] font-bold text-white">교체 대기 중</span>
                        <label className="cursor-pointer rounded bg-yellow-500 px-2 py-1 text-[10px] text-white hover:bg-yellow-600">
                          파일 찾기
                          <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                        </label>
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {targetReplaceIndex === null && images.length < MAX_IMAGES && (
                <div className="mt-3 text-center">
                  <label className="cursor-pointer text-xs text-blue-600 underline hover:text-blue-800">
                    파일 선택으로 나머지 채우기
                    <input type="file" multiple accept="image/*" className="hidden" onChange={handleFileUpload} />
                  </label>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-slate-800">
                  <MousePointer2 className="h-5 w-5 text-blue-500" />
                  <h2 className="text-lg font-semibold">1. 첫 이미지에서 범위 설정</h2>
                </div>
                <p className="text-sm text-slate-500">
                  이미지 위를 손가락이나 마우스로 드래그해 영역을 그리고, 모서리 손잡이를 끌어 크기를, 영역 안쪽을 끌어
                  위치를 다듬으세요. 두 손가락으로는 화면 확대가 그대로 됩니다.
                </p>

                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                  <div
                    ref={containerRef}
                    className="relative inline-block max-w-full cursor-crosshair select-none"
                    style={{ touchAction: 'pinch-zoom', WebkitTouchCallout: 'none' } as CSSProperties}
                    onPointerDown={(event) => beginDrag(event, 'create')}
                    onContextMenu={(event) => event.preventDefault()}
                  >
                    <img
                      ref={imgRef}
                      src={images[0]}
                      alt="첫 번째 이미지"
                      className="block max-w-full rounded"
                      draggable="false"
                      onLoad={(event) =>
                        setNaturalSize({
                          width: event.currentTarget.naturalWidth,
                          height: event.currentTarget.naturalHeight,
                        })
                      }
                    />

                    {cropRect && (
                      <>
                        <div
                          className="absolute cursor-move border-2 border-red-500 bg-red-500/20"
                          style={{
                            left: `${cropRect.x * 100}%`,
                            top: `${cropRect.y * 100}%`,
                            width: `${cropRect.width * 100}%`,
                            height: `${cropRect.height * 100}%`,
                          }}
                          onPointerDown={(event) => beginDrag(event, 'move')}
                        />

                        {HANDLES.map((handle) => (
                          <div
                            key={handle.id}
                            role="button"
                            aria-label={`${handle.label} 크기 조절`}
                            className="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                            style={{
                              left: `${(cropRect.x + cropRect.width * handle.fx) * 100}%`,
                              top: `${(cropRect.y + cropRect.height * handle.fy) * 100}%`,
                              cursor: handle.cursor,
                            }}
                            onPointerDown={(event) => beginDrag(event, 'resize', handle.id)}
                          >
                            <span className="h-4 w-4 rounded-full border-2 border-white bg-red-500 shadow-md" />
                          </div>
                        ))}
                      </>
                    )}

                    {loupeStyle && (
                      <div
                        className="pointer-events-none absolute z-20 overflow-hidden rounded-full border-2 border-white shadow-xl ring-1 ring-slate-900/30"
                        style={loupeStyle}
                      >
                        <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-red-500/70" />
                        <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-red-500/70" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    {selectionPixels && hasSelection
                      ? `선택 영역: ${selectionPixels.width} × ${selectionPixels.height} px`
                      : '아직 선택된 영역이 없습니다.'}
                  </span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      onClick={selectWholeImage}
                      className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-700 transition-colors hover:bg-slate-200"
                    >
                      전체 선택
                    </button>
                    <button
                      type="button"
                      onClick={clearSelection}
                      disabled={!cropRect}
                      className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-50"
                    >
                      선택 지우기
                    </button>
                  </span>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <Swords className="h-4 w-4 text-slate-500" />
                    <h3 className="text-sm font-semibold text-slate-900">공격·수비 표시</h3>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {SIDE_MODES.map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        aria-pressed={sideModeId === mode.id}
                        onClick={() => setSideModeId(mode.id)}
                        className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                          sideModeId === mode.id
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-slate-900'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>

                  <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                    {sideMode.leftLabel && sideMode.rightLabel ? (
                      <>
                        결과 이미지 위쪽에
                        <span className="rounded-full bg-blue-600 px-2 py-0.5 font-bold text-white">
                          {sideMode.leftLabel}
                        </span>
                        <span className="rounded-full bg-red-600 px-2 py-0.5 font-bold text-white">
                          {sideMode.rightLabel}
                        </span>
                        순서로 표시됩니다.
                      </>
                    ) : (
                      '결과 이미지에 공격·수비를 표시하지 않습니다.'
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={generateComparison}
                  disabled={isProcessing || !hasSelection}
                  className={`w-full rounded-lg py-3 font-bold text-white transition-all ${
                    !hasSelection
                      ? 'cursor-not-allowed bg-slate-400'
                      : 'bg-blue-600 shadow-md hover:bg-blue-700 hover:shadow-lg'
                  }`}
                >
                  {isProcessing ? '생성 중...' : '2. 비교 이미지 생성하기'}
                </button>
              </div>

              <div className="space-y-4">
                <h2 className="flex h-7 items-center text-lg font-semibold text-slate-800">결과 미리보기</h2>

                {resultImage ? (
                  <div className="space-y-4">
                    <div className="flex max-h-[600px] justify-center overflow-auto rounded-xl bg-slate-950 p-4 shadow-inner">
                      <img src={resultImage} alt="비교 결과" className="h-auto max-w-full rounded" />
                    </div>

                    <a
                      href={resultImage}
                      download="comparison_result.jpg"
                      className="flex w-full items-center justify-center rounded-lg bg-green-600 py-3 font-bold text-white shadow-md transition-all hover:bg-green-700 hover:shadow-lg"
                    >
                      <Download className="mr-2 h-5 w-5" />
                      비교 이미지 다운로드
                    </a>
                  </div>
                ) : (
                  <div className="flex h-[400px] items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 text-center text-slate-400">
                    <p>범위를 지정하고 생성하기 버튼을 눌러 주세요.</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
