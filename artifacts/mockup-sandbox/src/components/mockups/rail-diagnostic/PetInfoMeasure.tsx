import { useEffect, useRef, useState } from "react";

/**
 * Diagnostic: replicate FeedPage's petInfo block with EXACT styles
 * (RN-web output: flex column, gap 3, left 18 / right 80 on a 390px page →
 * content width 292px) and measure real rendered heights for each variant.
 *
 * Variants match the production posts under investigation:
 *  A. Solo pet, no caption      → name row + breed + "View full photo ↗"
 *  B. Solo pet, 1-line caption  → name row + breed + caption
 *  C. Two pets ("with Newt"), 1-line caption → name row + with-row + breed + caption
 */

const shadow = { textShadow: "0 1px 4px rgba(0,0,0,0.55)" } as const;
const sysFont =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

function Block({
  name,
  withPets,
  caption,
  onMeasure,
}: {
  name: string;
  withPets?: string;
  caption: string;
  onMeasure: (h: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) onMeasure(ref.current.getBoundingClientRect().height);
  }, [onMeasure]);
  return (
    <div
      ref={ref}
      style={{
        width: 292, // 390 − left 18 − right 80
        display: "flex",
        flexDirection: "column",
        gap: 3,
        fontFamily: sysFont,
        background: "#10161f",
        color: "#F0F4F8",
      }}
    >
      {/* identityRow: name (22/700) + AddToPackLink (fixed height 40, ring 30) */}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
        <span
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 0.2,
            marginRight: 6,
            whiteSpace: "nowrap",
            ...shadow,
          }}
        >
          {name}
        </span>
        <div
          style={{
            marginLeft: 6,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            height: 40,
            padding: "0 7px",
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              border: "1px solid rgba(240,244,248,0.35)",
            }}
          />
        </div>
      </div>
      {withPets && (
        <div style={{ fontSize: 12, marginTop: 2, color: "rgba(240,244,248,0.7)", ...shadow }}>
          {"with "}
          <span style={{ fontWeight: 600, textDecoration: "underline" }}>{withPets}</span>
        </div>
      )}
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: 0.3,
          color: "rgba(240,244,248,0.75)",
          ...shadow,
        }}
      >
        Mixed Breed
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: "18px",
          marginTop: 2,
          fontStyle: "italic",
          color: "rgba(240,244,248,0.9)",
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          ...shadow,
        }}
      >
        {caption}
        {"\u00A0"}
        <span style={{ fontSize: 12, fontStyle: "normal", opacity: 0.6 }}>↗</span>
      </div>
    </div>
  );
}

export function PetInfoMeasure() {
  const [h, setH] = useState<Record<string, number>>({});
  const set = (k: string) => (v: number) => setH((p) => (p[k] === v ? p : { ...p, [k]: v }));
  // Feed geometry on 390×844, insets.bottom = 34:
  const height = 844;
  const bottomOffset = 34 + 110; // 144
  const railBottomY = height - (bottomOffset + 144); // FIT_RAIL_LIFT = 144
  return (
    <div style={{ padding: 20, background: "#060B10", minHeight: "100vh", color: "#fff", fontFamily: sysFont }}>
      <Block name="Ripley" caption="View full photo" onMeasure={set("A_solo_noCaption")} />
      <div style={{ height: 20 }} />
      <Block name="Newt" caption="Newt in a tree" onMeasure={set("B_solo_caption")} />
      <div style={{ height: 20 }} />
      <Block name="Ripley" withPets="Newt" caption="Looking for squirrels" onMeasure={set("C_withRow_caption")} />
      <div style={{ height: 20 }} />
      <pre style={{ fontSize: 14, lineHeight: "22px" }}>
        {Object.entries(h)
          .map(
            ([k, v]) =>
              `${k}: petInfoH=${v.toFixed(1)}px  chromeTopY=${(height - bottomOffset - v).toFixed(1)}  railBottomY=${railBottomY}  clearance=${(height - bottomOffset - v - railBottomY).toFixed(1)}px`,
          )
          .join("\n")}
      </pre>
    </div>
  );
}
