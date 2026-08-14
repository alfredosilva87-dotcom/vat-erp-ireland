"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  defaultQuad, rectToQuadHomography, suggestedOutputSize, warpQuadToRect,
  type Point, type Quad,
} from "@/lib/perspective";

/**
 * "Arrumar as bordas" depois da foto (camada B4) — o meio-termo combinado com
 * o Alfredo em vez do scanner ao vivo.
 *
 * Detecção de borda em tempo real pela câmera é semanas de trabalho com risco
 * de verdade no Safari do iPhone. Isto entrega quase o mesmo resultado sem
 * esse risco: a pessoa arrasta os 4 cantos sobre a foto JÁ TIRADA, e o recorte
 * é matemática de perspectiva pura (`lib/perspective.ts`, testada à parte) —
 * sem IA, sem biblioteca de visão computacional, sem depender de a câmera do
 * navegador expor o que uma engine de detecção precisaria.
 *
 * "Pular" sempre existe e manda a foto inteira, sem recorte — porque o objetivo
 * é impressionar quem já validou a ideia, não travar quem só quer mandar rápido.
 */

const HANDLE_TOUCH_RADIUS = 22; // px de tela — maior que o ponto visual, para o dedo não errar

interface Props {
  file: File | Blob;
  onConfirm: (blob: Blob, mime: string) => void;
  onSkip: (file: File | Blob) => void;
  onCancel: () => void;
}

export default function DocumentCropper({ file, onConfirm, onSkip, onCancel }: Props) {
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [displayWidth, setDisplayWidth] = useState(0);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // A foto vem como Blob (já reduzida por PhoneCapture); aqui só se exibe.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    const size = { width: el.naturalWidth, height: el.naturalHeight };
    setNatural(size);
    setQuad(defaultQuad(size.width, size.height));
  }, []);

  // O container tem a MESMA proporção da imagem (sem letterbox), então a escala
  // é um número só — largura exibida sobre largura real — sem precisar calcular
  // deslocamento de centralização do `object-fit: contain`.
  useEffect(() => {
    if (!natural || !containerRef.current) return;
    const measure = () => setDisplayWidth(containerRef.current!.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [natural]);

  const scale = natural && displayWidth ? displayWidth / natural.width : 0;
  const displayHeight = natural ? natural.height * scale : 0;

  const toDisplay = (p: Point): Point => ({ x: p.x * scale, y: p.y * scale });
  const toNatural = (p: Point): Point => ({ x: p.x / scale, y: p.y / scale });

  const movePoint = useCallback((index: number, displayPoint: Point) => {
    if (!natural) return;
    const clamped = {
      x: Math.min(Math.max(displayPoint.x, 0), natural.width),
      y: Math.min(Math.max(displayPoint.y, 0), natural.height),
    };
    setQuad((prev) => {
      if (!prev) return prev;
      const next = [...prev] as Quad;
      next[index] = clamped;
      return next;
    });
  }, [natural]);

  const onHandlePointerDown = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    // `setPointerCapture` lança se o navegador não reconhecer este pointerId
    // como um ponteiro "ativo" — encontrado testando com eventos sintéticos,
    // mas o mesmo pode acontecer com um multitoque real numa pilha de
    // navegador menos comum. Sem o try/catch, a exceção não capturada
    // interrompia a função ANTES de `setDragging` rodar: o dedo continuava na
    // tela, mas o círculo nunca saía do lugar — falha muda, sem erro visível
    // nenhum, porque a captura é só uma melhoria de robustez, não o que
    // decide se o arrasto funciona.
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* segue sem captura */ }
    setDragging(index);
  };
  const onHandlePointerMove = (e: React.PointerEvent) => {
    if (dragging === null || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const displayPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    movePoint(dragging, toNatural(displayPoint));
  };
  const endDrag = () => setDragging(null);

  const svgQuad = useMemo(() => {
    if (!quad) return "";
    return quad.map((p) => toDisplay(p)).map((p) => `${p.x},${p.y}`).join(" ");
  }, [quad, scale]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Recorta e endireita. O teto de 1600px no lado mais longo é de propósito
   * menor que o dos 2000px de `PhoneCapture.shrink`: depois do recorte, o
   * documento já preenche o quadro — não sobra fundo para justificar mais
   * pixel, e o custo do laço pixel a pixel cresce com o quadrado do tamanho.
   */
  const confirm = useCallback(async () => {
    if (!quad || !imgUrl) return;
    setBusy(true);
    try {
      const img = new Image();
      img.src = imgUrl;
      await img.decode();

      const { width, height } = suggestedOutputSize(quad, 1600);
      const h = rectToQuadHomography(width, height, quad);
      if (!h) { onSkip(file); return; } // quadrilátero degenerado: manda a foto inteira em vez de travar

      const src = document.createElement("canvas");
      src.width = img.naturalWidth;
      src.height = img.naturalHeight;
      const sctx = src.getContext("2d")!;
      sctx.drawImage(img, 0, 0);
      const srcData = sctx.getImageData(0, 0, src.width, src.height);

      const out = document.createElement("canvas");
      out.width = width;
      out.height = height;
      const octx = out.getContext("2d")!;
      const outData = octx.createImageData(width, height);

      warpQuadToRect(srcData, outData, h);
      octx.putImageData(outData, 0, 0);

      out.toBlob((blob) => {
        if (blob) onConfirm(blob, "image/jpeg");
        else onSkip(file);
      }, "image/jpeg", 0.85);
    } catch {
      // Decodificação ou canvas falhou (raro, mas HEIC mal suportado existe):
      // a foto original ainda é um documento válido, não perder o envio por isso.
      onSkip(file);
    } finally {
      setBusy(false);
    }
  }, [quad, imgUrl, file, onConfirm, onSkip]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink/95">
      <div className="flex items-center justify-between px-4 py-3">
        <button className="text-sm font-medium text-white/80" onClick={onCancel}>
          {t("crop.cancel")}
        </button>
        <p className="text-sm font-medium text-white">{t("crop.title")}</p>
        <button className="text-sm font-medium text-white/80" onClick={() => onSkip(file)}>
          {t("crop.skip")}
        </button>
      </div>

      <p className="px-4 pb-2 text-center text-xs text-white/60">{t("crop.hint")}</p>

      <div className="flex flex-1 items-center justify-center overflow-hidden px-4">
        <div
          ref={containerRef}
          className="relative w-full max-w-md touch-none select-none"
          style={{ aspectRatio: natural ? `${natural.width} / ${natural.height}` : undefined }}
          onPointerMove={onHandlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {imgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt="" className="absolute inset-0 h-full w-full rounded-lg object-contain"
              onLoad={onImgLoad} />
          )}

          {quad && scale > 0 && (
            <svg className="absolute inset-0 h-full w-full" width={displayWidth} height={displayHeight}
              style={{ pointerEvents: "none" }}>
              <polygon points={svgQuad} fill="rgb(124 92 252 / 0.22)" stroke="rgb(124 92 252)" strokeWidth={2} />
            </svg>
          )}

          {quad && scale > 0 && quad.map((p, i) => {
            const d = toDisplay(p);
            return (
              <div key={i}
                className="absolute rounded-full border-2 border-white bg-brand shadow-lg"
                style={{
                  left: d.x, top: d.y, width: 26, height: 26,
                  transform: "translate(-50%, -50%)",
                  touchAction: "none",
                  padding: HANDLE_TOUCH_RADIUS - 13,
                  marginLeft: -(HANDLE_TOUCH_RADIUS - 13),
                  marginTop: -(HANDLE_TOUCH_RADIUS - 13),
                }}
                onPointerDown={onHandlePointerDown(i)}
              />
            );
          })}
        </div>
      </div>

      <div className="p-4">
        <button className="btn-primary h-14 w-full text-base" onClick={confirm} disabled={busy || !quad}>
          {busy ? t("crop.working") : t("crop.confirm")}
        </button>
      </div>
    </div>
  );
}
