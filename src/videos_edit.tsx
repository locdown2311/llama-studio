// Gerado pelo llama studio: montagem de vídeos a partir de uma lista de edição (src/edit/<Nome>.ts).
// Não edite este arquivo: o studio o substitui a cada video_edit. Mude a lista de edição.
import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Audio,
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

export type Cam = {
  /** arquivo em public/, ex.: "facecam.mp4" */
  src: string;
  /** onde a câmera começa (segundos no arquivo dela), em sincronia com o início do trecho */
  from: number;
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
  style?: "title" | "label";
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

/** Um vídeo preenchendo a caixa, recortado no ponto de foco. */
const Fill: React.FC<{
  src: string;
  from: number;
  fps: number;
  speed: number;
  volume: number | ((f: number) => number);
  muted: boolean;
  focusX?: number;
  focusY?: number;
  fit?: boolean;
  filter: string;
}> = ({ src, from, fps, speed, volume, muted, focusX, focusY, fit, filter }) => {
  const pos = `${Math.round((focusX ?? 0.5) * 100)}% ${Math.round((focusY ?? 0.5) * 100)}%`;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {fit ? (
        // proporção diferente: o próprio vídeo, desfocado, preenche as sobras
        <OffthreadVideo
          src={staticFile(src)}
          trimBefore={Math.round(from * fps)}
          playbackRate={speed}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover", filter: "blur(40px) brightness(0.55)", transform: "scale(1.15)" }}
        />
      ) : null}
      <AbsoluteFill>
        <OffthreadVideo
          src={staticFile(src)}
          trimBefore={Math.round(from * fps)}
          playbackRate={speed}
          volume={volume}
          muted={muted}
          style={{ width: "100%", height: "100%", objectFit: fit ? "contain" : "cover", objectPosition: pos, filter }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
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
        const title = (x.style || "title") === "title";
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
                fontWeight: 800,
                fontSize: width * (title ? 0.07 : 0.045),
                lineHeight: 1.1,
                color: title ? "#ffffff" : "#111111",
                background: title ? "transparent" : "#ffd84d",
                padding: title ? 0 : `${width * 0.01}px ${width * 0.025}px`,
                borderRadius: width * 0.012,
                textAlign: "center",
                textShadow: title ? "0 4px 18px rgba(0,0,0,0.75)" : "none",
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
  const camVol = clip.cam ? clip.cam.volume ?? 1 : 0;

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
      fit={layout === "fit"}
      filter={filter}
    />
  );
  const cam = clip.cam ? (
    <Fill src={clip.cam.src} from={clip.cam.from} fps={fps} speed={speed} volume={vol(camVol)} muted={camVol === 0} focusX={clip.cam.focusX} focusY={clip.cam.focusY} filter={filter} />
  ) : null;

  let body: React.ReactNode = main;
  if (layout === "react" && cam) {
    const top = Math.round(height * Math.min(0.8, Math.max(0.2, clip.split || 0.5)));
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
    const w = Math.round(width * Math.min(0.6, Math.max(0.15, clip.split || 0.3)));
    const h = Math.round((w * 9) / 16) * (height > width ? 1.6 : 1);
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
