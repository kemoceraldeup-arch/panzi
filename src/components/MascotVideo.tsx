// src/components/MascotVideo.tsx
// Panzi's mascot as a silent video clip — used where the mascot should feel
// alive (welcome page, "you're all set" page) instead of the static Mascot
// image. The clip plays once and settles on its last frame rather than
// looping; see the `active` prop for how a screen replays it.

import React, { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleProp, View, ViewStyle } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTheme } from '../theme/ThemeProvider';

export type MascotVideoClip = 'wave' | 'jump' | 'jumpV2';

const CLIPS: Record<MascotVideoClip, any> = {
  wave: require('../../assets/mascot/panzi-wave-v2.mp4'),
  jump: require('../../assets/mascot/panzi-jump.mp4'),
  // Same animation, re-exported with the background baked in as #FFF8E8
  // (colors.backgroundLight) instead of white, so it blends into the All
  // Set page without needing the transparent sprite-sheet treatment.
  jumpV2: require('../../assets/mascot/panzi-jump-v2.mp4'),
};

type MascotVideoProps = {
  clip: MascotVideoClip;
  // Renders a fixed size x size box. Omit to have the video fill whatever
  // space `style` gives its wrapper (e.g. a flex: 1 parent).
  size?: number;
  style?: StyleProp<ViewStyle>;
  contentFit?: 'contain' | 'cover' | 'fill';
  // The clip plays through once and then holds on its last frame — it never
  // loops. Flipping `active` false and back to true replays it from the
  // start, which is how a screen re-triggers the mascot when the user
  // navigates away and returns. Screens that mount fresh each time can leave
  // this alone; mounting counts as becoming active.
  active?: boolean;
};

/** The colour the clips were rendered against, baked into the files. */
const BAKED_BACKDROP = '#FFF8E8';

export default function MascotVideo({
  clip,
  size,
  style,
  contentFit = 'contain',
  active = true,
}: MascotVideoProps) {
  const { scheme } = useTheme();
  const player = useVideoPlayer(CLIPS[clip], (player) => {
    player.loop = false;
    player.muted = true;
    player.play();
  });

  // Once the clip has run through we must not start it again on our own —
  // otherwise the autoplay retry below would quietly turn it back into a loop.
  // Cleared whenever we deliberately replay.
  const hasEnded = useRef(false);
  useEffect(() => {
    const sub = player.addListener('playToEnd', () => {
      hasEnded.current = true;
    });
    return () => sub.remove();
  }, [player]);

  // Replay on the false -> true edge only. Tracking the previous value keeps a
  // re-render with active still true from restarting a clip mid-play.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active === wasActive.current) return;
    wasActive.current = active;
    if (active) {
      hasEnded.current = false;
      // replay() only seeks back to the start; it doesn't resume a paused
      // player, so the clip would sit frozen on frame one without play().
      player.replay();
      player.play();
    } else {
      player.pause();
    }
  }, [active, player]);

  // On web, useVideoPlayer's setup callback can fire before the underlying
  // <video> element is attached, so play() silently no-ops. Re-triggering
  // once the player reports it's actually ready makes autoplay reliable.
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    if (active && !hasEnded.current && status === 'readyToPlay' && !player.playing) {
      player.play();
    }
  }, [active, status, player]);

  // expo-video's native VideoView doesn't reliably fill a flex/percentage-
  // sized parent on iOS — it needs concrete pixel dimensions. When no fixed
  // `size` is given, measure the wrapper via onLayout and pass that through
  // as explicit width/height instead of '100%', which was leaving a sliver
  // of the parent unfilled (visible as a black edge behind the video).
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);

  function handleLayout(e: LayoutChangeEvent) {
    // Round up so the native video surface is never fractionally smaller
    // than its container — a hairline gap there shows through as black
    // (the wrapper has no opaque backing of its own).
    const w = Math.ceil(e.nativeEvent.layout.width);
    const h = Math.ceil(e.nativeEvent.layout.height);
    if (w !== measured?.width || h !== measured?.height) {
      setMeasured({ width: w, height: h });
    }
  }

  // iOS 16+ runs Live Text analysis on paused video frames and, if it finds
  // any text, floats a recognition button over the bottom of the view. The
  // mascot's apron reads "panzi", so the button appeared the moment a clip
  // settled on its last frame. It defaults to on — the mascot is decoration,
  // there's nothing here worth selecting.
  const videoProps = {
    player,
    contentFit,
    nativeControls: false,
    fullscreenOptions: { enable: false },
    allowsPictureInPicture: false,
    allowsVideoFrameAnalysis: false,
  } as const;

  // The clips have a cream background baked into the video file — they were
  // authored against the light theme and there is no alpha channel to key out.
  // On a charcoal page that reads as a stray pale rectangle, so in dark mode
  // the clip is given a rounded plate in exactly the colour it was authored
  // against. Same pixels, but now it looks like a deliberate illustration panel
  // rather than a rendering fault.
  //
  // In light mode the plate is the page colour and rounds nothing, so the
  // existing screens are pixel-identical to before.
  const plate =
    scheme === 'dark'
      ? { backgroundColor: BAKED_BACKDROP, borderRadius: 28, overflow: 'hidden' as const }
      : null;

  if (size != null) {
    return (
      <View style={[plate, style]}>
        <VideoView style={{ width: size, height: size }} {...videoProps} />
      </View>
    );
  }

  return (
    <View style={[plate, style]} onLayout={handleLayout}>
      {measured && (
        <VideoView
          style={{ width: measured.width, height: measured.height }}
          {...videoProps}
        />
      )}
    </View>
  );
}
