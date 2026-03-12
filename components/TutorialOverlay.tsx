import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTutorial } from '@/contexts/TutorialContext';
import Colors from '@/constants/Colors';

const HIGHLIGHT_RADIUS = 36;
const TOOLTIP_MARGIN = 16;

interface HighlightRect {
  cx: number;
  cy: number;
}

export function TutorialOverlay() {
  const { isActive, currentStep, currentStepIndex, getTarget, advance, skip } = useTutorial();
  const insets = useSafeAreaInsets();
  const [highlight, setHighlight] = useState<HighlightRect | null>(null);
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

  const measureTarget = useCallback(() => {
    if (!currentStep) { setHighlight(null); return; }

    const ref = getTarget(currentStep.targetName);
    if (ref?.current) {
      ref.current.measureInWindow((x, y, w, h) => {
        setHighlight({ cx: x + w / 2, cy: y + h / 2 });
      });
      return;
    }

    // Fallback: calculate tab bar position
    const tabCount = 6;
    const cx = (currentStep.tabIndex + 0.5) * (screenWidth / tabCount);
    const cy = screenHeight - insets.bottom - 32;
    setHighlight({ cx, cy });
  }, [currentStep, getTarget, screenWidth, screenHeight, insets.bottom]);

  useEffect(() => {
    if (!isActive || !currentStep) { setHighlight(null); return; }
    // Small delay to let navigation/layout settle
    const t = setTimeout(measureTarget, 600);
    return () => clearTimeout(t);
  }, [isActive, currentStep, currentStepIndex, measureTarget]);

  if (!isActive || !currentStep) return null;

  const tooltipInBottomHalf = highlight ? highlight.cy > screenHeight / 2 : false;
  const tooltipTop = highlight
    ? tooltipInBottomHalf
      ? highlight.cy - HIGHLIGHT_RADIUS - 160 - TOOLTIP_MARGIN
      : highlight.cy + HIGHLIGHT_RADIUS + TOOLTIP_MARGIN
    : screenHeight / 2 - 80;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent>
      <View style={[StyleSheet.absoluteFill, { pointerEvents: 'box-none' }]}>
        {/* Dim overlay — 4 rects forming a frame around the highlight circle */}
        {highlight ? (
          <>
            {/* Top */}
            <View
              style={[styles.dim, {
                top: 0,
                left: 0,
                right: 0,
                height: Math.max(0, highlight.cy - HIGHLIGHT_RADIUS),
                pointerEvents: 'none',
              }]}
            />
            {/* Bottom */}
            <View
              style={[styles.dim, {
                top: highlight.cy + HIGHLIGHT_RADIUS,
                left: 0,
                right: 0,
                bottom: 0,
                pointerEvents: 'none',
              }]}
            />
            {/* Left */}
            <View
              style={[styles.dim, {
                top: Math.max(0, highlight.cy - HIGHLIGHT_RADIUS),
                left: 0,
                width: Math.max(0, highlight.cx - HIGHLIGHT_RADIUS),
                height: HIGHLIGHT_RADIUS * 2,
                pointerEvents: 'none',
              }]}
            />
            {/* Right */}
            <View
              style={[styles.dim, {
                top: Math.max(0, highlight.cy - HIGHLIGHT_RADIUS),
                left: highlight.cx + HIGHLIGHT_RADIUS,
                right: 0,
                height: HIGHLIGHT_RADIUS * 2,
                pointerEvents: 'none',
              }]}
            />
            {/* Highlight ring */}
            <View
              style={[styles.highlightRing, {
                left: highlight.cx - HIGHLIGHT_RADIUS - 4,
                top: highlight.cy - HIGHLIGHT_RADIUS - 4,
                width: (HIGHLIGHT_RADIUS + 4) * 2,
                height: (HIGHLIGHT_RADIUS + 4) * 2,
                borderRadius: HIGHLIGHT_RADIUS + 4,
                pointerEvents: 'none',
              }]}
            />
          </>
        ) : (
          <View style={[styles.dim, StyleSheet.absoluteFill, { pointerEvents: 'none' }]} />
        )}

        {/* Tap backdrop to skip */}
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={skip} />

        {/* Tooltip card */}
        <View
          style={[styles.tooltip, {
            left: 20,
            right: 20,
            top: Math.max(insets.top + 8, Math.min(tooltipTop, screenHeight - 220)),
          }]}
        >
          <Text style={styles.stepIndicator}>
            {currentStepIndex + 1} / 4
          </Text>
          <Text style={styles.tooltipTitle}>{currentStep.title}</Text>
          <Text style={styles.tooltipBody}>{currentStep.body}</Text>
          <View style={styles.tooltipButtons}>
            <TouchableOpacity style={styles.ctaBtn} onPress={advance}>
              <Text style={styles.ctaBtnText}>{currentStep.cta}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.skipBtn} onPress={skip}>
              <Text style={styles.skipBtnText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  highlightRing: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: Colors.primary,
    backgroundColor: 'transparent',
  },
  tooltip: {
    position: 'absolute',
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 10,
  },
  stepIndicator: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  tooltipTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 8,
  },
  tooltipBody: {
    fontSize: 15,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginBottom: 18,
  },
  tooltipButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ctaBtn: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  ctaBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  skipBtn: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  skipBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
});
