/**
 * Renders markdown-style text with clickable links, bold, italic, and colors.
 * Supports: **bold**, *italic*, [text](url), bare URLs, [primary]text[/primary]
 */
import React from 'react';
import { Text, StyleSheet, type TextStyle } from 'react-native';
import * as Linking from 'expo-linking';
import Colors from '@/constants/Colors';

type Segment =
  | { type: 'text'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'colored'; content: string; color: string };

const URL_REGEX = /https?:\/\/[^\s)\]>\u00A0]+/g;
const LINK_REGEX = /\[([^\]]*)\]\(([^)]+)\)/g;
const BOLD_REGEX = /\*\*([^*]+)\*\*/g;
const ITALIC_REGEX = /(?<!\*)\*([^*]+)\*(?!\*)/g;
const COLOR_REGEX = /\[(primary|red|green|orange)\]([^[]*)\[\/\1\]/gi;

function parseSegments(input: string): Segment[] {
  const segments: Segment[] = [];
  let remaining = input;

  const colorMap: Record<string, string> = {
    primary: Colors.primary,
    red: Colors.danger,
    green: Colors.success,
    orange: Colors.primary,
  };

  // Process [primary]text[/primary] and [red]text[/red] etc
  remaining = remaining.replace(COLOR_REGEX, (_, colorName, content) => {
    segments.push({ type: 'colored', content, color: colorMap[colorName.toLowerCase()] ?? Colors.text });
    return `\x00SEG${segments.length - 1}\x00`;
  });

  // Process [text](url)
  remaining = remaining.replace(LINK_REGEX, (_, text, url) => {
    segments.push({ type: 'link', text: text || url, url });
    return `\x00SEG${segments.length - 1}\x00`;
  });

  // Process **bold**
  remaining = remaining.replace(BOLD_REGEX, (_, content) => {
    segments.push({ type: 'bold', content });
    return `\x00SEG${segments.length - 1}\x00`;
  });

  // Process *italic*
  remaining = remaining.replace(ITALIC_REGEX, (_, content) => {
    segments.push({ type: 'italic', content });
    return `\x00SEG${segments.length - 1}\x00`;
  });

  // Process bare URLs
  remaining = remaining.replace(URL_REGEX, (url) => {
    segments.push({ type: 'link', text: url, url });
    return `\x00SEG${segments.length - 1}\x00`;
  });

  // Split by placeholders and rebuild final segments
  const parts = remaining.split(/(\x00SEG\d+\x00)/g);
  const result: Segment[] = [];
  for (const part of parts) {
    const match = part.match(/^\x00SEG(\d+)\x00$/);
    if (match) {
      result.push(segments[parseInt(match[1], 10)]!);
    } else if (part) {
      result.push({ type: 'text', content: part });
    }
  }
  return result;
}

export type RichTextProps = {
  children: string;
  style?: TextStyle;
  baseColor?: string;
  linkColor?: string;
};

export function RichText({ children, style, baseColor = Colors.text, linkColor = Colors.primary }: RichTextProps) {
  if (!children || typeof children !== 'string') {
    return <Text style={[styles.base, { color: baseColor }, style]} />;
  }

  const segments = parseSegments(children);

  return (
    <Text style={[styles.base, { color: baseColor }, style]}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <Text key={i} style={[styles.base, { color: baseColor }, style]}>{seg.content}</Text>;
        }
        if (seg.type === 'bold') {
          return (
            <Text key={i} style={[styles.base, styles.bold, { color: baseColor }, style]}>
              {seg.content}
            </Text>
          );
        }
        if (seg.type === 'italic') {
          return (
            <Text key={i} style={[styles.base, styles.italic, { color: baseColor }, style]}>
              {seg.content}
            </Text>
          );
        }
        if (seg.type === 'colored') {
          return (
            <Text key={i} style={[styles.base, { color: seg.color }, style]}>
              {seg.content}
            </Text>
          );
        }
        if (seg.type === 'link') {
          return (
            <Text
              key={i}
              style={[styles.base, styles.link, { color: linkColor }, style]}
              onPress={() => Linking.openURL(seg.url)}
              suppressHighlighting={false}
            >
              {seg.text}
            </Text>
          );
        }
        return null;
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontSize: 15,
  },
  bold: {
    fontWeight: '700',
  },
  italic: {
    fontStyle: 'italic',
  },
  link: {
    textDecorationLine: 'underline',
  },
});
