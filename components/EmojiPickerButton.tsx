import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import EmojiPickerModal, { emojiData } from '@hiraku-ai/react-native-emoji-picker';
import Colors from '@/constants/Colors';

interface EmojiPickerButtonProps {
  emoji: string;
  onEmojiSelect: (emoji: string) => void;
  size?: number;
}

export function EmojiPickerButton({ emoji, onEmojiSelect, size = 52 }: EmojiPickerButtonProps) {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <TouchableOpacity
        style={[styles.button, { width: size, height: size, borderRadius: size / 2 }]}
        onPress={() => setVisible(true)}
        activeOpacity={0.7}
      >
        <Text style={[styles.emojiText, { fontSize: size * 0.54 }]}>{emoji}</Text>
      </TouchableOpacity>
      <EmojiPickerModal
        visible={visible}
        onClose={() => setVisible(false)}
        onEmojiSelect={(e) => {
          onEmojiSelect(e);
          setVisible(false);
        }}
        emojis={emojiData}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
  },
  emojiText: {},
});
