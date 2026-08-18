"use client";

import { useSyncExternalStore } from "react";
import { Headphones, Loader2, Pause } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  getAudioPlayerServerSnapshot,
  getAudioPlayerSnapshot,
  subscribeAudioPlayer,
  toggleAudioPlayback,
} from "@/lib/audio-player";
import { cn } from "@/lib/utils";

/** Inline play/pause for a real dialer recording URL (2026-08-19) - replaces
 * the old plain <a target="_blank"> link, which silently downloaded rather
 * than played depending on the dialer server's Content-Type header. Shares
 * one playback slot across every instance on the page (lib/audio-player.ts),
 * so picking a different call correctly stops the previous one. */
export function AudioPlayButton({
  url,
  size = "icon-xs",
  label = "Aufnahme",
}: {
  url: string;
  size?: "icon-xs" | "icon-sm" | "icon";
  label?: string;
}) {
  const { currentUrl, isLoading } = useSyncExternalStore(
    subscribeAudioPlayer,
    getAudioPlayerSnapshot,
    getAudioPlayerServerSnapshot,
  );
  const isThisPlaying = currentUrl === url;
  const isThisLoading = isThisPlaying && isLoading;

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleAudioPlayback(url);
      }}
      aria-label={isThisPlaying ? `${label} pausieren` : `${label} abspielen`}
      title={isThisPlaying ? `${label} pausieren` : `${label} abspielen`}
      className={cn(isThisPlaying && "text-primary")}
    >
      {isThisLoading ? (
        <Loader2 className="animate-spin" />
      ) : isThisPlaying ? (
        <Pause />
      ) : (
        <Headphones />
      )}
    </Button>
  );
}
