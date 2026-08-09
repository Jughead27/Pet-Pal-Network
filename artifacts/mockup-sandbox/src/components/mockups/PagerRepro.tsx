// Diagnostic repro of the Sniff pager: react-native-web FlatList with the
// EXACT same props as discovery.tsx's pager, plus the same web
// verify-and-correct loop. Logs per-frame scrollTop / content height /
// visible item so the failure mechanism can be read from the console.
import { useCallback, useEffect, useRef, useState } from "react";
// @ts-expect-error react-native-web ships no bundled types in this sandbox
import { FlatList, Text, View } from "react-native-web";

const ITEM_COUNT = 20;
const PAGE_H = 600; // fixed page height stand-in for windowHeight
const TARGET = new URLSearchParams(window.location.search).has("t")
  ? Number(new URLSearchParams(window.location.search).get("t"))
  : 5;

const DATA = Array.from({ length: ITEM_COUNT }, (_, i) => ({
  id: `post-${i}`,
  label: `POST #${i}`,
}));

const COLORS = ["#264653", "#2a9d8f", "#e9c46a", "#f4a261", "#e76f51"];

// ?delay=200 → mount the list with EMPTY data, then fill it after N ms —
// simulating a pager that mounts while the react-query result is briefly
// empty/stale (refetch in flight at tap time).
const DELAY = Number(new URLSearchParams(window.location.search).get("delay") ?? 0);

export default function PagerRepro() {
  const listRef = useRef<any>(null);
  const doneRef = useRef(false);
  const [data, setData] = useState<typeof DATA>(DELAY > 0 ? [] : DATA);
  useEffect(() => {
    if (DELAY > 0) {
      const t = setTimeout(() => {
        console.log(`[PagerRepro] DATA FILLED after ${DELAY}ms`);
        setData(DATA);
      }, DELAY);
      return () => clearTimeout(t);
    }
  }, []);
  // ?refetch=200 → data correct at mount, but its ARRAY IDENTITY is replaced
  // after N ms with identical contents — a react-query refetch resolving.
  const REFETCH = Number(new URLSearchParams(window.location.search).get("refetch") ?? 0);
  useEffect(() => {
    if (REFETCH > 0) {
      const t = setTimeout(() => {
        console.log(`[PagerRepro] REFETCH: new array identity after ${REFETCH}ms`);
        setData(DATA.map((d) => ({ ...d })));
      }, REFETCH);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Mirror discovery.tsx: startIndex resolved against CURRENT data at render.
  const startIndex = Math.max(0, data.findIndex((d) => d.id === `post-${TARGET}`));
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<string[]>([]);
  const push = useCallback((line: string) => {
    logRef.current = [...logRef.current, line];
    // eslint-disable-next-line no-console
    console.log(`[PagerRepro] ${line}`);
    setLog(logRef.current);
  }, []);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: PAGE_H,
      offset: PAGE_H * index,
      index,
    }),
    [],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: (typeof DATA)[number]; index: number }) => (
      <View
        style={{
          height: PAGE_H,
          backgroundColor: COLORS[index % COLORS.length],
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 64, color: "#fff" }}>{item.label}</Text>
      </View>
    ),
    [],
  );

  // Mirror of discovery.tsx runWebPagerCorrection, instrumented.
  // Like the real loop, the expected offset is re-resolved from CURRENT data
  // each frame (dataRef), not captured once.
  const dataRef = useRef(data);
  dataRef.current = data;
  // FIXED loop — exact mirror of the new discovery.tsx logic, instrumented,
  // plus 60 post-done observation frames to catch any snap yank-back.
  const onListLayout = useCallback(() => {
    if (doneRef.current) return;
    const MAX_TOTAL_FRAMES = 120;
    const MAX_SETTLE_FRAMES = 30;
    const STABLE_FRAMES = 12;
    let totalFrames = 0;
    let settleFrames = 0;
    let stableFrames = 0;
    let observeFrames = 0;
    let snapNode: HTMLElement | null = null;
    const restoreSnap = () => {
      if (snapNode) {
        snapNode.style.scrollSnapType = "";
        push(`snap RESTORED (computed=${getComputedStyle(snapNode).scrollSnapType})`);
        snapNode = null;
      }
    };
    const finish = (why: string) => {
      doneRef.current = true;
      restoreSnap();
      push(`DONE: ${why}`);
    };
    const tick = () => {
      const node: HTMLElement | null =
        listRef.current?.getScrollableNode?.() ?? null;
      if (doneRef.current) {
        if (node && observeFrames % 5 === 0)
          push(
            `obs f${observeFrames}: scrollTop=${node.scrollTop} contentH=${node.scrollHeight} itemAt=${Math.round(node.scrollTop / PAGE_H)}`,
          );
        observeFrames += 1;
        if (observeFrames < 60) requestAnimationFrame(tick);
        return;
      }
      if (node) {
        if (!snapNode) {
          snapNode = node;
          node.style.scrollSnapType = "none";
          push(`snap SUPPRESSED at f${totalFrames}`);
        }
        const idx = dataRef.current.findIndex((d) => d.id === `post-${TARGET}`);
        const st = node.scrollTop;
        const ch = node.scrollHeight;
        if (idx >= 0) {
          const expected = idx * PAGE_H;
          if (Math.abs(st - expected) <= 1) {
            stableFrames += 1;
            push(`f${totalFrames}: at ${st}/${ch} stable=${stableFrames}`);
            if (stableFrames >= STABLE_FRAMES) {
              finish(`stable at ${st} (idx ${idx})`);
              requestAnimationFrame(tick);
              return;
            }
          } else {
            stableFrames = 0;
            node.scrollTop = expected;
            push(`f${totalFrames}: scrollTop=${st} contentH=${ch} SET->${expected} readback=${node.scrollTop}`);
            settleFrames += 1;
            if (settleFrames >= MAX_SETTLE_FRAMES) {
              finish("settle cap");
              requestAnimationFrame(tick);
              return;
            }
          }
        } else if (totalFrames % 10 === 0) {
          push(`f${totalFrames}: target ABSENT, watching (scrollTop=${st} contentH=${ch})`);
        }
      }
      totalFrames += 1;
      if (totalFrames < MAX_TOTAL_FRAMES) requestAnimationFrame(tick);
      else finish("total cap");
    };
    push(`onLayout fired; target=${TARGET}`);
    requestAnimationFrame(tick);
  }, [push]);

  useEffect(() => {
    push(`mount; initialScrollIndex=${TARGET}`);
  }, [push]);

  return (
    <View style={{ flexDirection: "row", height: PAGE_H }}>
      <View style={{ width: 360, height: PAGE_H }}>
        <FlatList
          key="repro-pager"
          ref={listRef}
          data={data}
          renderItem={renderItem}
          keyExtractor={(item: (typeof DATA)[number]) => item.id}
          getItemLayout={getItemLayout}
          initialScrollIndex={startIndex}
          onLayout={onListLayout}
          pagingEnabled
          snapToInterval={PAGE_H}
          snapToAlignment="start"
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
          windowSize={3}
          maxToRenderPerBatch={2}
          initialNumToRender={1}
          removeClippedSubviews
        />
      </View>
      <View style={{ flex: 1, padding: 8 }}>
        {log.slice(-40).map((l, i) => (
          <Text key={i} style={{ fontSize: 10, fontFamily: "monospace" }}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}
