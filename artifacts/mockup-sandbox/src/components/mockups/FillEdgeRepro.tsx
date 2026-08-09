// FillEdgeRepro — visual verification harness for the FillEdgeSoftener
// treatment, mounting the REAL FocalImage from the mobile app (via the
// react-native → react-native-web + expo-linear-gradient .web.js aliases in
// vite.config.ts).
//
// Left frame:  real FocalImage (current code, WITH softener)
// Right frame: manual replica of the OLD layer stack (no softener) for A/B.
//
// Crop data mimics the live "Stretching!" post: vertical-only zoom-out,
// cropY=-0.185, cropH=1.334 → exposed fill bands top and bottom (~14% each
// of frame height), meeting the black page background at the frame edge.
import { useEffect, useMemo, useState } from "react";
// @ts-expect-error no bundled types for react-native-web in this sandbox
import { Image, StyleSheet, View, Text } from "react-native-web";
// The real component under test:
// eslint-disable-next-line import/no-relative-packages
import FocalImage from "../../../../mobile/components/FocalImage";

const FRAME_W = 360;
const FRAME_H = 640;

// Same crop rect shape as the live post (x/w full-width, vertical zoom-out).
const CROP = { x: 0, y: -0.185, w: 1, h: 1.334 };
const FILL_COLOR = "#7a6a52"; // sampled-color stand-in (warm carpet tone)

/** Generate a deterministic bright "pet photo" + tiny blur thumb via canvas. */
function makeImages(): { photo: string; thumb: string } {
  const W = 800;
  const H = 800; // square-ish source, like a 1:1-shot photo
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  // Bright warm background so the fill bands are light — worst case for a
  // subtle dark fade being invisible... or clearly visible.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#e8d9b8");
  bg.addColorStop(1, "#b89a6e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // "Pet": dark blob + details so the photo region is obvious.
  ctx.fillStyle = "#3a2f24";
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.62, 220, 150, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(W / 2 - 160, H * 0.45, 90, 80, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8d9b8";
  ctx.beginPath();
  ctx.ellipse(W / 2 - 185, H * 0.43, 14, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#5a4a38";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6); // photo border → hard edge marker
  const photo = c.toDataURL("image/jpeg", 0.9);

  // Tiny thumb (16px) like the compose-time crop_fill_thumb.
  const t = document.createElement("canvas");
  t.width = 16;
  t.height = 16;
  const tctx = t.getContext("2d")!;
  tctx.drawImage(c, 0, 0, 16, 16);
  const thumb = t.toDataURL("image/jpeg", 0.7);
  return { photo, thumb };
}

/** Manual replica of the OLD (pre-softener) fill stack for A/B comparison. */
function OldStack({ photo, thumb }: { photo: string; thumb: string }) {
  // Same rect-driven cover math as FocalImage, hardcoded for this rect.
  const scale = Math.max(FRAME_W / (CROP.w * 800), FRAME_H / (CROP.h * 800));
  const iw = 800 * scale;
  const ih = 800 * scale;
  const left = -CROP.x * 800 * scale + (FRAME_W - CROP.w * 800 * scale) / 2;
  const top = -CROP.y * 800 * scale + (FRAME_H - CROP.h * 800 * scale) / 2;
  return (
    <View style={{ width: FRAME_W, height: FRAME_H, overflow: "hidden" }}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: FILL_COLOR }]} />
      <Image
        source={{ uri: thumb }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        blurRadius={2}
      />
      <Image
        source={{ uri: photo }}
        style={{ position: "absolute", left, top, width: iw, height: ih }}
      />
    </View>
  );
}

export default function FillEdgeRepro() {
  const [imgs, setImgs] = useState<{ photo: string; thumb: string } | null>(null);
  useEffect(() => setImgs(makeImages()), []);
  const frames = useMemo(() => imgs, [imgs]);
  if (!frames) return null;
  return (
    <div style={{ background: "#000", minHeight: "100vh", padding: 24, display: "flex", gap: 32 }}>
      <div>
        <div style={{ color: "#fff", fontFamily: "monospace", marginBottom: 8 }}>
          REAL FocalImage (with softener)
        </div>
        <FocalImage
          source={{ uri: frames.photo }}
          style={{ width: FRAME_W, height: FRAME_H }}
          cropX={CROP.x}
          cropY={CROP.y}
          cropW={CROP.w}
          cropH={CROP.h}
          mode="cover"
          cropFillColor={FILL_COLOR}
          cropFillThumb={frames.thumb}
        />
      </div>
      <div>
        <div style={{ color: "#fff", fontFamily: "monospace", marginBottom: 8 }}>
          OLD stack (no softener)
        </div>
        <OldStack photo={frames.photo} thumb={frames.thumb} />
      </div>
      <Text style={{ color: "#888", position: "absolute", bottom: 4, left: 24, fontSize: 11 }}>
        crop y={CROP.y} h={CROP.h} — exposed fill bands top+bottom
      </Text>
    </div>
  );
}
