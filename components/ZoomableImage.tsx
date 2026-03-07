import React, { useCallback, useMemo } from 'react';
import { Image, ImageSourcePropType } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

type ZoomableImageProps = {
  source: ImageSourcePropType;
  style: { width: number; height: number };
  onScaleChange?: (scale: number) => void;
};

export function ZoomableImage({ source, style, onScaleChange }: ZoomableImageProps) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onUpdate((e) => {
          scale.value = savedScale.value * e.scale;
        })
        .onEnd(() => {
          if (scale.value < 1) {
            scale.value = withSpring(1, { damping: 15 });
            savedScale.value = 1;
            translateX.value = withSpring(0);
            translateY.value = withSpring(0);
            savedTranslateX.value = 0;
            savedTranslateY.value = 0;
          } else if (scale.value > 4) {
            scale.value = withSpring(4);
            savedScale.value = 4;
          } else {
            savedScale.value = scale.value;
          }
        }),
    []
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((e) => {
          if (scale.value > 1) {
            translateX.value = savedTranslateX.value + e.translationX;
            translateY.value = savedTranslateY.value + e.translationY;
          }
        })
        .onEnd(() => {
          savedTranslateX.value = translateX.value;
          savedTranslateY.value = translateY.value;
        }),
    []
  );

  const composedGesture = useMemo(
    () => Gesture.Simultaneous(pinchGesture, panGesture),
    [pinchGesture, panGesture]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const notifyScale = useCallback((s: number) => onScaleChange?.(s), [onScaleChange]);
  useAnimatedReaction(
    () => scale.value,
    (s) => runOnJS(notifyScale)(s)
  );

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View style={animatedStyle}>
        <Image source={source} style={style} resizeMode="contain" />
      </Animated.View>
    </GestureDetector>
  );
}
