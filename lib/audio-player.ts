"use client";

// Shared, module-level singleton <audio> element (2026-08-19, Anis: "Can you
// make the call 'play' in the tool... nothing happens when clicking on the
// headphones"). Root cause of "nothing happens": the recording links were
// plain <a href target="_blank"> anchors - whether that plays audibly or
// silently downloads depends entirely on the browser's handling of the
// dialer server's Content-Type header for that MP3, which isn't something
// this app controls. A real inline player sidesteps that entirely.
//
// A module-level singleton (not one <audio> per row) is deliberate: the
// call picker can render 70+ recording buttons on one page, and only one
// call should ever be audible at a time - starting a second recording must
// stop the first, the same way any real player behaves. useSyncExternalStore
// (same pattern already used for the sidebar's collapsed state) is how
// components subscribe to this outside-React mutable source without an
// effect-driven re-render.

let audioEl: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let isLoading = false;
const listeners = new Set<() => void>();

// useSyncExternalStore requires getSnapshot to return a referentially
// stable value when nothing has actually changed - returning a fresh
// object literal on every call (the original bug here) makes React think
// the store changed on every render, which re-triggers the render, which
// calls getSnapshot again... an infinite loop ("Maximum update depth
// exceeded"). Caching the snapshot object and only replacing it when the
// underlying values change is the fix.
let cachedSnapshot: { currentUrl: string | null; isLoading: boolean } = { currentUrl: null, isLoading: false };

function notify() {
  cachedSnapshot = { currentUrl, isLoading };
  for (const listener of listeners) listener();
}

function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.addEventListener("ended", () => {
      currentUrl = null;
      isLoading = false;
      notify();
    });
    audioEl.addEventListener("error", () => {
      currentUrl = null;
      isLoading = false;
      notify();
    });
    audioEl.addEventListener("canplay", () => {
      isLoading = false;
      notify();
    });
  }
  return audioEl;
}

export function subscribeAudioPlayer(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAudioPlayerSnapshot() {
  return cachedSnapshot;
}

const serverSnapshot = { currentUrl: null, isLoading: false };
export function getAudioPlayerServerSnapshot() {
  return serverSnapshot;
}

/** Toggles playback of `url` - starts it (stopping whatever else was
 * playing) if it isn't the current one, pauses it if it already is. */
export function toggleAudioPlayback(url: string) {
  const audio = getAudio();
  if (!audio) return;

  if (currentUrl === url) {
    audio.pause();
    currentUrl = null;
    isLoading = false;
    notify();
    return;
  }

  audio.src = url;
  currentUrl = url;
  isLoading = true;
  notify();
  audio.play().catch(() => {
    currentUrl = null;
    isLoading = false;
    notify();
  });
}
