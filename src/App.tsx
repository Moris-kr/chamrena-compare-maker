import { useCallback, useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { Clipboard, Download, MousePointer2, RefreshCw, Upload } from 'lucide-react';

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MAX_IMAGES = 10;
const LEFT_COLUMN_COUNT = 5;

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
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [targetReplaceIndex, setTargetReplaceIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

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

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    setStartPos({ x, y });
    setCropRect({ x, y, width: 0, height: 0 });
    setIsDrawing(true);
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const currentY = Math.max(0, Math.min(event.clientY - rect.top, rect.height));

    setCropRect({
      x: Math.min(startPos.x, currentX),
      y: Math.min(startPos.y, currentY),
      width: Math.abs(currentX - startPos.x),
      height: Math.abs(currentY - startPos.y),
    });
  };

  useEffect(() => {
    const handleMouseUp = () => setIsDrawing(false);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const generateComparison = async () => {
    if (!cropRect || cropRect.width === 0 || cropRect.height === 0 || !imgRef.current) {
      alert('첫 번째 이미지에서 비교할 범위를 드래그해서 선택해 주세요.');
      return;
    }

    setIsProcessing(true);

    try {
      const scaleX = imgRef.current.naturalWidth / imgRef.current.width;
      const scaleY = imgRef.current.naturalHeight / imgRef.current.height;

      const sourceX = cropRect.x * scaleX;
      const sourceY = cropRect.y * scaleY;
      const sourceWidth = cropRect.width * scaleX;
      const sourceHeight = cropRect.height * scaleY;

      const padding = 16;
      const rowGap = 12;
      const middleGap = 40;
      const columnWidth = sourceWidth + padding * 2;
      const columnHeight = sourceHeight * LEFT_COLUMN_COUNT + rowGap * 4 + padding * 2;

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

      for (let index = 0; index < images.length; index += 1) {
        const image = await loadImage(images[index]);
        const isLeft = index < LEFT_COLUMN_COUNT;
        const rowIndex = isLeft ? index : index - LEFT_COLUMN_COUNT;
        const drawX = isLeft ? leftColumnX + padding : rightColumnX + padding;
        const drawY = padding + rowIndex * (sourceHeight + rowGap);

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
                <h2 className="text-sm font-semibold text-slate-900">이미지 확인 및 교체</h2>
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
                <p className="text-sm text-slate-500">이미지 위를 드래그해서 비교할 영역을 지정하세요.</p>

                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                  <div
                    ref={containerRef}
                    className="relative inline-block max-w-full cursor-crosshair select-none"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                  >
                    <img
                      ref={imgRef}
                      src={images[0]}
                      alt="첫 번째 이미지"
                      className="block max-w-full rounded"
                      draggable="false"
                    />

                    {cropRect && (
                      <div
                        className="pointer-events-none absolute border-2 border-red-500 bg-red-500/20"
                        style={{
                          left: `${cropRect.x}px`,
                          top: `${cropRect.y}px`,
                          width: `${cropRect.width}px`,
                          height: `${cropRect.height}px`,
                        }}
                      />
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={generateComparison}
                  disabled={isProcessing || !cropRect || cropRect.width === 0}
                  className={`w-full rounded-lg py-3 font-bold text-white transition-all ${
                    !cropRect || cropRect.width === 0
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
