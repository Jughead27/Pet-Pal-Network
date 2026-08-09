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
  const onListLayout = useCallback(() => {
    if (doneRef.current) return;
    let frames = 0;
    const MAX_FRAMES = 30;
    const tick = () => {
      const node: HTMLElement | null =
        listRef.current?.getScrollableNode?.() ?? null;
      if (!node) {
        push(`f${frames}: NO NODE`);
      } else {
        const idx = Math.max(
          0,
          dataRef.current.findIndex((d) => d.id === `post-${TARGET}`),
        );
        const expected = idx * PAGE_H;
        const st = node.scrollTop;
        const ch = node.scrollHeight;
        if (doneRef.current) {
          // post-done observation frames
          push(`f${frames} (post-done): scrollTop=${st} contentH=${ch} itemAt=${Math.round(st / PAGE_H)}`);
        } else if (Math.abs(st - expected) <= 1) {
          push(`f${frames}: MATCH scrollTop=${st} contentH=${ch} -> done`);
          doneRef.current = true;
        } else {
          node.scrollTop = expected;
          const after = node.scrollTop;
          push(
            `f${frames}: scrollTop=${st} contentH=${ch} SET->${expected} readback=${after}${Math.abs(after - expected) <= 1 ? " STUCK -> done" : " CLAMPED"}`,
          );
          if (Math.abs(after - expected) <= 1) doneRef.current = true;
        }
      }
      frames += 1;
      if (frames < MAX_FRAMES + 30) requestAnimationFrame(tick); // keep observing 30 frames past done
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
