import React from 'react';
import {
  TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/Colors';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
};

export function Button({
  label, onPress, variant = 'primary', loading = false,
  disabled = false, style, textStyle, fullWidth = true,
}: ButtonProps) {
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const isDisabled = disabled || loading;

  if (variant === 'primary') {
    return (
      <TouchableOpacity
        onPress={handlePress}
        disabled={isDisabled}
        activeOpacity={0.85}
        style={[fullWidth && styles.fullWidth, style]}
      >
        <LinearGradient
          colors={[Colors.gradientStart, Colors.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.base, isDisabled && styles.disabled]}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={[styles.primaryText, textStyle]}>{label}</Text>
          }
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  const variantStyle = { secondary: styles.secondary, ghost: styles.ghost, danger: styles.danger }[variant];
  const variantTextStyle = { secondary: styles.secondaryText, ghost: styles.ghostText, danger: styles.dangerText }[variant];

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={isDisabled}
      activeOpacity={0.75}
      style={[styles.base, variantStyle, isDisabled && styles.disabled, fullWidth && styles.fullWidth, style]}
    >
      {loading
        ? <ActivityIndicator color={variant === 'danger' ? Colors.danger : Colors.primary} size="small" />
        : <Text style={[variantTextStyle, textStyle]}>{label}</Text>
      }
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20,
    alignItems: 'center', justifyContent: 'center', minHeight: 50,
  },
  fullWidth: { width: '100%' },
  disabled: { opacity: 0.5 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: { backgroundColor: Colors.surfaceAlt, borderWidth: 1.5, borderColor: Colors.border },
  secondaryText: { color: Colors.text, fontSize: 16, fontWeight: '600' },
  ghost: { backgroundColor: 'transparent' },
  ghostText: { color: Colors.primary, fontSize: 16, fontWeight: '600' },
  danger: { backgroundColor: Colors.dangerLight, borderWidth: 1.5, borderColor: Colors.danger },
  dangerText: { color: Colors.danger, fontSize: 16, fontWeight: '600' },
});
