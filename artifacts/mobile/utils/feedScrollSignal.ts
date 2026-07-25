/**
 * feedScrollSignal — lightweight cross-tab scroll-to-top signal.
 *
 * When the Add flow successfully posts, it stamps a timestamp here.
 * The Home screen watches its feed query's `dataUpdatedAt`; once that value
 * exceeds the stamp (meaning the refetch with the new post has landed), it
 * scrolls the FlatList to offset 0 and clears the signal.
 *
 * Module-level state is intentional: it survives component unmounts and
 * doesn't require React context or a global store. Only a single consumer
 * (the Home screen) ever reads or clears the value.
 */

let _signalTime = 0;

/**
 * Record that a post just succeeded. Call immediately before navigating home,
 * after the feed query has been invalidated.
 */
export function signalPostSuccess(): void {
  _signalTime = Date.now();
}

/**
 * The epoch-ms timestamp set by the most recent signalPostSuccess call,
 * or 0 if no signal is pending.
 */
export function getPostSuccessSignalTime(): number {
  return _signalTime;
}

/**
 * Consume and clear the signal. Call after acting on it so the next
 * ordinary tab switch doesn't trigger an unwanted scroll.
 */
export function clearPostSuccessSignal(): void {
  _signalTime = 0;
}
