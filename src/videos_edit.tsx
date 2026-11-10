// Gerado pelo llama studio: montagem de vídeos a partir de uma lista de edição (src/edit/<Nome>.ts).
// Não edite este arquivo: o studio o substitui a cada video_edit. Mude a lista de edição.
import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type Layout = "full" | "fit" | "react" | "pip" | "side";
export type Transition = "cut" | "fade" | "slide" | "wipe" | "zoom";
export type Filter = "none" | "bw" | "warm" | "cold" | "vivid" | "dark";

/** Região do quadro de origem, em frações (0..1). */
export type Crop = { x: number; y: number; w: number; h: number };

export type Cam = {
  /** arquivo em public/, ex.: "facecam.mp4" (o mesmo do trecho quando a facecam está na gravação) */
  src: string;
  /** onde a câmera começa (segundos no arquivo dela), em sincronia com o início do trecho */
  from: number;
  /** só esta região do quadro (a facecam dentro da gravação) */
  crop?: Crop;
  volume?: number;
  /** 0..1: ponto do quadro que fica no centro ao recortar */
  focusX?: number;
  focusY?: number;
};

export type Text = {
  text: string;
  /** segundos desde o início do trecho */
  at: number;
  dur: number;
  pos?: "top" | "center" | "bottom";
  style?: "title" | "label" | "thumb";
};

/** Por cima do vídeo: emoji, imagem de public/, seta ou círculo de destaque. x/y: centro na tela (0..1). */
export type Overlay = {
  kind: "emoji" | "image" | "arrow" | "circle";
  text?: string;
  src?: string;
  at: number;
  dur: number;
  x: number;
  y: number;
  size?: number;
  angle?: number;
  color?: string;
  anim?: "pop" | "shake" | "none";
};

export type Punch = { at: number; scale?: number; dur?: number };

export type Clip = {
  src: string;
  /** início e fim no arquivo, em segundos */
  from: number;
  to: number;
  layout?: Layout;
  cam?: Cam;
  /** react: fração da altura para a câmera em cima (padrão 0.5); pip: tamanho da janela (padrão 0.3) */
  split?: number;
  corner?: "tl" | "tr" | "bl" | "br";
  focusX?: number;
  focusY?: number;
  /** só esta região do quadro (ex.: a área do jogo, sem a facecam) */
  crop?: Crop;
  /** focusX ao longo do trecho: [segundos desde o início no arquivo, x] (o studio calcula com focusX "auto") */
  track?: [number, number][];
  speed?: number;
  volume?: number;
  mute?: boolean;
  filter?: Filter;
  /** aproximação lenta ao longo do trecho: escala no fim (ex.: 1.12) */
  zoom?: number;
  /** aproximações rápidas de ênfase, em segundos desde o início do trecho */
  punch?: Punch[];
  /** transição para entrar neste trecho */
  transition?: Transition;
  transitionDur?: number;
  texts?: Text[];
  overlays?: Overlay[];
};

export type Edl = {
  fps: number;
  width: number;
  height: number;
  background?: string;
  clips: Clip[];
  music?: { src: string; volume?: number; from?: number };
  captions?: {
    style?: "tiktok" | "line" | "none";
    /** de qual áudio vem a fala: o vídeo principal ou a câmera */
    source?: "main" | "cam";
    pos?: "bottom" | "center" | "top";
    color?: string;
    highlight?: string;
  };
  /** largura e altura de cada arquivo (o studio mede), para recortar com precisão */
  sizes?: Record<string, [number, number]>;
};

type Word = { text: string; startMs: number; endMs: number };

const FILTERS: Record<Filter, string> = {
  none: "none",
  bw: "grayscale(1) contrast(1.1)",
  warm: "sepia(0.25) saturate(1.2) hue-rotate(-8deg)",
  cold: "saturate(0.9) hue-rotate(12deg) brightness(1.03)",
  vivid: "saturate(1.45) contrast(1.08)",
  dark: "brightness(0.75) contrast(1.15)",
};

/** Quadros de cada trecho e onde ele começa (as transições sobrepõem o fim do anterior). */
export function edlTimeline(edl: Edl): { start: number; len: number; enter: number; exit: number }[] {
  const out: { start: number; len: number; enter: number; exit: number }[] = [];
  let at = 0;
  edl.clips.forEach((c, i) => {
    const len = Math.max(1, Math.round(((c.to - c.from) / (c.speed || 1)) * edl.fps));
    const prev = out[i - 1];
    let enter = 0;
    if (prev && c.transition && c.transition !== "cut") {
      enter = Math.round((c.transitionDur || 0.5) * edl.fps);
      enter = Math.max(1, Math.min(enter, Math.floor(len / 2), Math.floor(prev.len / 2)));
      prev.exit = enter;
      at -= enter;
    }
    out.push({ start: at, len, enter, exit: 0 });
    at += len;
  });
  return out;
}

export function edlFrames(edl: Edl): number {
  const t = edlTimeline(edl);
  const last = t[t.length - 1];
  return last ? Math.max(1, last.start + last.len) : 1;
}

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Um vídeo preenchendo a caixa (boxW x boxH), recortado no ponto de foco. Com as medidas do arquivo, o
 *  focusX é exatamente o centro do recorte (0..1 dentro da região) e dá para usar só uma região (crop). */
const Fill: React.FC<{
  src: string;
  from: number;
  fps: number;
  speed: number;
  volume: number | ((f: number) => number);
  muted: boolean;
  focusX?: number;
  focusY?: number;
  track?: [number, number][];
  crop?: Crop;
  size?: [number, number];
  boxW: number;
  boxH: number;
  fit?: boolean;
  filter: string;
}> = ({ src, from, fps, speed, volume, muted, focusX, focusY, track, crop, size, boxW, boxH, fit, filter }) => {
  const frame = useCurrentFrame();
  const t = (frame / fps) * speed;
  const fx = track && track.length > 1 ? interpolate(t, track.map((p) => p[0]), track.map((p) => p[1]), clamp) : track && track.length ? track[0][1] : focusX ?? 0.5;
  const fy = focusY ?? 0.5;
  const video = (style: React.CSSProperties, mute: boolean) => (
    <OffthreadVideo src={staticFile(src)} trimBefore={Math.round(from * fps)} playbackRate={speed} volume={mute ? 0 : volume} muted={mute || muted} style={style} />
  );
  const blurred = fit
    ? video({ position: "absolute", width: "100%", height: "100%", objectFit: "cover", filter: "blur(40px) brightness(0.55)", transform: "scale(1.15)" }, true)
    : null;
  if (!size) {
    // sem as medidas: o navegador recorta (aproximado)
    const pos = `${Math.round(fx * 100)}% ${Math.round(fy * 100)}%`;
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        {blurred}
        {video({ position: "absolute", width: "100%", height: "100%", objectFit: fit ? "contain" : "cover", objectPosition: pos, filter }, false)}
      </AbsoluteFill>
    );
  }
  const [sw, sh] = size;
  const r = crop || { x: 0, y: 0, w: 1, h: 1 };
  const rw = r.w * sw;
  const rh = r.h * sh;
  const s = fit ? Math.min(boxW / rw, boxH / rh) : Math.max(boxW / rw, boxH / rh);
  // a janela visível: a caixa inteira (preencher) ou a região inteira no meio (fit)
  const winW = fit ? rw * s : boxW;
  const winH = fit ? rh * s : boxH;
  const offX = fit ? 0 : Math.min(Math.max(fx * rw * s - boxW / 2, 0), rw * s - boxW);
  const offY = fit ? 0 : Math.min(Math.max(fy * rh * s - boxH / 2, 0), rh * s - boxH);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {blurred}
      <div style={{ position: "absolute", left: (boxW - winW) / 2, top: (boxH - winH) / 2, width: winW, height: winH, overflow: "hidden" }}>
        {video({ position: "absolute", left: -(r.x * sw * s + offX), top: -(r.y * sh * s + offY), width: sw * s, height: sh * s, maxWidth: "none", objectFit: "fill", filter }, false)}
      </div>
    </AbsoluteFill>
  );
};

/** Emojis, imagens, setas e círculos por cima, cada um no seu instante. */
const OverlayLayer: React.FC<{ items: Overlay[]; fps: number; width: number; height: number }> = ({ items, fps, width, height }) => {
  const frame = useCurrentFrame();
  const t = frame / fps;
  return (
    <>
      {items.map((o, i) => {
        if (t < o.at || t > o.at + o.dur) return null;
        const local = (t - o.at) * fps;
        const end = o.dur * fps;
        const anim = o.anim || "pop";
        const pop = anim === "none" ? 1 : interpolate(local, [0, 5, 8], [0, 1.15, 1], clamp);
        const out = interpolate(local, [end - 5, end], [1, 0], clamp);
        const shake = anim === "shake" ? Math.sin(local * 1.7) * 6 : 0;
        const size = (o.size || (o.kind === "circle" ? 0.3 : 0.25)) * width;
        const color = o.color || (o.kind === "arrow" || o.kind === "circle" ? "#ff2d2d" : "#ffffff");
        let el: React.ReactNode = null;
        if (o.kind === "emoji") el = <div style={{ fontSize: size * 0.8, lineHeight: 1, textAlign: "center", filter: "drop-shadow(0 6px 12px rgba(0,0,0,0.5))" }}>{o.text}</div>;
        if (o.kind === "image" && o.src) el = <Img src={staticFile(o.src)} style={{ width: size, height: "auto", display: "block", filter: "drop-shadow(0 6px 12px rgba(0,0,0,0.5))" }} />;
        if (o.kind === "circle") {
          // o círculo se desenha (traço animado)
          const draw = interpolate(local, [0, 10], [0, 1], clamp);
          const c = Math.PI * 92;
          el = (
            <svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: "visible" }}>
              <circle cx="50" cy="50" r="46" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - draw)} />
            </svg>
          );
        }
        if (o.kind === "arrow") {
          el = (
            <svg width={size} height={size * 0.5} viewBox="0 0 100 50" style={{ overflow: "visible", transform: `rotate(${o.angle ?? 0}deg)` }}>
              <path d="M2 25 H70" stroke={color} strokeWidth="9" strokeLinecap="round" />
              <path d="M62 6 L96 25 L62 44 Z" fill={color} />
            </svg>
          );
        }
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: o.x * width,
              top: o.y * height,
              transform: `translate(-50%, -50%) translateX(${shake}px) scale(${pop})`,
              opacity: out,
            }}
          >
            {el}
          </div>
        );
      })}
    </>
  );
};

const TextLayer: React.FC<{ texts: Text[]; fps: number; width: number }> = ({ texts, fps, width }) => {
  const frame = useCurrentFrame();
  const t = frame / fps;
  return (
    <>
      {texts.map((x, i) => {
        if (t < x.at || t > x.at + x.dur) return null;
        const local = (t - x.at) * fps;
        const inOut = interpolate(local, [0, 6, x.dur * fps - 6, x.dur * fps], [0, 1, 1, 0], clamp);
        const thumb = x.style === "thumb";
        const title = (x.style || "title") === "title" || thumb;
        const pos = x.pos || "top";
        return (
          <AbsoluteFill
            key={i}
            style={{
              justifyContent: pos === "top" ? "flex-start" : pos === "bottom" ? "flex-end" : "center",
              alignItems: "center",
              padding: width * 0.06,
            }}
          >
            <div
              style={{
                opacity: inOut,
                transform: `translateY(${(1 - inOut) * 20}px) scale(${0.96 + inOut * 0.04})`,
                fontFamily: "Inter, system-ui, sans-serif",
                fontWeight: thumb ? 900 : 800,
                fontSize: width * (thumb ? 0.11 : title ? 0.07 : 0.045),
                textTransform: thumb ? "uppercase" : "none",
                WebkitTextStroke: thumb ? `${Math.round(width * 0.006)}px #000000` : undefined,
                lineHeight: 1.1,
                color: thumb ? "#ffe600" : title ? "#ffffff" : "#111111",
                background: title ? "transparent" : "#ffd84d",
                padding: title ? 0 : `${width * 0.01}px ${width * 0.025}px`,
                borderRadius: width * 0.012,
                textAlign: "center",
                textShadow: thumb ? "0 8px 0 #000000, 0 10px 30px rgba(0,0,0,0.8)" : title ? "0 4px 18px rgba(0,0,0,0.75)" : "none",
                maxWidth: "92%",
              }}
            >
              {x.text}
            </div>
          </AbsoluteFill>
        );
      })}
    </>
  );
};

/** Legenda acompanhando a fala do trecho (as palavras vêm do tempo do arquivo, então seguem os cortes). */
const CaptionLayer: React.FC<{ words: Word[]; from: number; speed: number; fps: number; edl: Edl }> = ({ words, from, speed, fps, edl }) => {
  const frame = useCurrentFrame();
  const c = edl.captions || {};
  const nowMs = (from + (frame / fps) * speed) * 1000;
  // páginas de até 4 palavras / 1,4 s, como nos vídeos curtos
  const pages: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    if (cur.length && (cur.length >= 4 || w.startMs - cur[0].startMs > 1400 || w.startMs - cur[cur.length - 1].endMs > 500)) {
      pages.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) pages.push(cur);
  let page: Word[] | null = null;
  for (const p of pages) {
    if (nowMs >= p[0].startMs - 80 && nowMs <= p[p.length - 1].endMs + 250) page = p;
  }
  if (!page) return null;
  const line = c.style === "line";
  const pos = c.pos || "bottom";
  return (
    <AbsoluteFill
      style={{
        justifyContent: pos === "top" ? "flex-start" : pos === "center" ? "center" : "flex-end",
        alignItems: "center",
        padding: `${edl.height * 0.12}px ${edl.width * 0.06}px`,
      }}
    >
      <div
        style={{
          fontFamily: "Inter, system-ui, sans-serif",
          fontWeight: line ? 600 : 900,
          fontSize: edl.width * (line ? 0.042 : edl.height > edl.width ? 0.075 : 0.05),
          textAlign: "center",
          lineHeight: 1.15,
          color: c.color || "#ffffff",
          textTransform: line ? "none" : "uppercase",
          textShadow: "0 0 10px rgba(0,0,0,0.9), 0 3px 0 rgba(0,0,0,0.9)",
          background: line ? "rgba(0,0,0,0.55)" : "transparent",
          padding: line ? "0.15em 0.5em" : 0,
          borderRadius: 8,
          maxWidth: "94%",
        }}
      >
        {page.map((w, i) => {
          const on = !line && nowMs >= w.startMs && nowMs < w.endMs + 60;
          return (
            <span key={i} style={{ color: on ? c.highlight || "#ffd84d" : undefined }}>
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const ClipView: React.FC<{ clip: Clip; edl: Edl; enter: number; exit: number; len: number; words: Record<string, Word[]> }> = ({
  clip,
  edl,
  enter,
  exit,
  len,
  words,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const fps = edl.fps;
  const speed = clip.speed || 1;
  const filter = FILTERS[clip.filter || "none"] || "none";
  const layout = clip.layout || "full";
  // entrada (transição deste trecho) e saída (a do próximo): som acompanha
  const inP = enter ? interpolate(frame, [0, enter], [0, 1], clamp) : 1;
  const vol = (base: number) => (f: number) => {
    const a = enter ? interpolate(f, [0, enter], [0, 1], clamp) : 1;
    const b = exit ? interpolate(f, [len - exit, len], [1, 0], clamp) : 1;
    return base * a * b;
  };
  const mainVol = clip.mute ? 0 : clip.volume ?? 1;
  // a facecam do mesmo arquivo já toca no vídeo principal: sem som em dobro
  const camVol = clip.cam ? clip.cam.volume ?? (clip.cam.src === clip.src ? 0 : 1) : 0;
  const sizes = edl.sizes || {};
  const split = Math.min(0.8, Math.max(0.2, clip.split || 0.5));
  const topH = Math.round(height * split);
  const pipW = Math.round(width * Math.min(0.6, Math.max(0.15, clip.split || 0.3)));
  const pipH = Math.round((pipW * 9) / 16) * (height > width ? 1.6 : 1);
  const mainBox: [number, number] = layout === "react" && clip.cam ? [width, height - topH] : layout === "side" && clip.cam ? [width / 2, height] : [width, height];
  const camBox: [number, number] = layout === "react" ? [width, topH] : layout === "side" ? [width / 2, height] : [pipW, pipH];

  // zoom lento + aproximações de ênfase
  let scale = interpolate(frame, [0, len], [1, clip.zoom || 1], clamp);
  for (const p of clip.punch || []) {
    const s = p.at * fps;
    const d = Math.max(4, (p.dur || 0.6) * fps);
    scale *= interpolate(frame, [s, s + 4, s + d, s + d + 6], [1, p.scale || 1.25, p.scale || 1.25, 1], clamp);
  }

  const t = clip.transition || "cut";
  let enterStyle: React.CSSProperties = {};
  if (enter && t === "fade") enterStyle = { opacity: inP };
  if (enter && t === "slide") enterStyle = { transform: `translateX(${(1 - inP) * 100}%)` };
  if (enter && t === "wipe") enterStyle = { clipPath: `inset(0 ${(1 - inP) * 100}% 0 0)` };
  if (enter && t === "zoom") enterStyle = { opacity: inP, transform: `scale(${1.25 - inP * 0.25})` };

  const main = (
    <Fill
      src={clip.src}
      from={clip.from}
      fps={fps}
      speed={speed}
      volume={vol(mainVol)}
      muted={mainVol === 0}
      focusX={clip.focusX}
      focusY={clip.focusY}
      track={clip.track}
      crop={clip.crop}
      size={sizes[clip.src]}
      boxW={mainBox[0]}
      boxH={mainBox[1]}
      fit={layout === "fit"}
      filter={filter}
    />
  );
  const cam = clip.cam ? (
    <Fill
      src={clip.cam.src}
      from={clip.cam.from}
      fps={fps}
      speed={speed}
      volume={vol(camVol)}
      muted={camVol === 0}
      focusX={clip.cam.focusX}
      focusY={clip.cam.focusY}
      crop={clip.cam.crop}
      size={sizes[clip.cam.src]}
      boxW={camBox[0]}
      boxH={camBox[1]}
      filter={filter}
    />
  ) : null;

  let body: React.ReactNode = main;
  if (layout === "react" && cam) {
    const top = topH;
    body = (
      <>
        <div style={{ position: "absolute", left: 0, top: 0, width, height: top, overflow: "hidden" }}>{cam}</div>
        <div style={{ position: "absolute", left: 0, top, width, height: height - top, overflow: "hidden" }}>{main}</div>
      </>
    );
  } else if (layout === "side" && cam) {
    body = (
      <>
        <div style={{ position: "absolute", left: 0, top: 0, width: width / 2, height, overflow: "hidden" }}>{main}</div>
        <div style={{ position: "absolute", left: width / 2, top: 0, width: width / 2, height, overflow: "hidden" }}>{cam}</div>
      </>
    );
  } else if (layout === "pip" && cam) {
    const w = pipW;
    const h = pipH;
    const m = Math.round(width * 0.03);
    const c = clip.corner || "br";
    body = (
      <>
        {main}
        <div
          style={{
            position: "absolute",
            width: w,
            height: h,
            left: c === "tl" || c === "bl" ? m : width - w - m,
            top: c === "tl" || c === "tr" ? m : height - h - m,
            borderRadius: w * 0.06,
            overflow: "hidden",
            boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
            border: "3px solid rgba(255,255,255,0.85)",
          }}
        >
          {cam}
        </div>
      </>
    );
  }

  // a fala vem do vídeo principal ou da câmera (decide a opção, não o nome do arquivo: podem ser o mesmo)
  const fromCam = !!(edl.captions && edl.captions.source === "cam" && clip.cam);
  const capSrc = edl.captions && edl.captions.style !== "none" ? (fromCam && clip.cam ? clip.cam.src : clip.src) : null;
  const capFrom = fromCam && clip.cam ? clip.cam.from : clip.from;
  const capWords = capSrc ? words[capSrc] : undefined;
  return (
    <AbsoluteFill style={enterStyle}>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>{body}</AbsoluteFill>
      {capWords ? <CaptionLayer words={capWords} from={capFrom} speed={speed} fps={fps} edl={edl} /> : null}
      {clip.overlays && clip.overlays.length ? <OverlayLayer items={clip.overlays} fps={fps} width={width} height={height} /> : null}
      {clip.texts && clip.texts.length ? <TextLayer texts={clip.texts} fps={fps} width={width} /> : null}
    </AbsoluteFill>
  );
};

/** Legendas de cada arquivo usado (public/captions/<nome>.json), se existirem. */
function useWords(edl: Edl): Record<string, Word[]> {
  const [words, setWords] = useState<Record<string, Word[]>>({});
  const [handle] = useState(() => (edl.captions && edl.captions.style !== "none" ? delayRender("legendas") : null));
  useEffect(() => {
    if (handle === null) return;
    const files: string[] = [];
    for (const c of edl.clips) {
      for (const s of [c.src, c.cam ? c.cam.src : ""]) if (s && files.indexOf(s) < 0) files.push(s);
    }
    Promise.all(
      files.map((f) => {
        const stem = f.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
        return fetch(staticFile(`captions/${stem}.json`))
          .then((r) => (r.ok ? r.json() : []))
          .then((list: { text: string; startMs: number; endMs: number }[]) => [f, list] as [string, Word[]])
          .catch(() => [f, []] as [string, Word[]]);
      }),
    ).then((pairs) => {
      const out: Record<string, Word[]> = {};
      for (const [f, list] of pairs) out[f] = list;
      setWords(out);
      continueRender(handle);
    });
  }, [edl, handle]);
  return words;
}

export const EditVideo: React.FC<{ edl: Edl }> = ({ edl }) => {
  const timeline = edlTimeline(edl);
  const words = useWords(edl);
  const total = edlFrames(edl);
  const music = edl.music;
  return (
    <AbsoluteFill style={{ backgroundColor: edl.background || "#000000" }}>
      {edl.clips.map((clip, i) => (
        <Sequence key={i} from={timeline[i].start} durationInFrames={timeline[i].len} name={`${i + 1}. ${clip.src} ${clip.from}-${clip.to}s`}>
          <ClipView clip={clip} edl={edl} enter={timeline[i].enter} exit={timeline[i].exit} len={timeline[i].len} words={words} />
        </Sequence>
      ))}
      {music ? (
        <Audio
          src={staticFile(music.src)}
          trimBefore={Math.round((music.from || 0) * edl.fps)}
          loop
          volume={(f) => (music.volume ?? 0.15) * interpolate(f, [0, 15, total - 30, total], [0, 1, 1, 0], clamp)}
        />
      ) : null}
    </AbsoluteFill>
  );
};
