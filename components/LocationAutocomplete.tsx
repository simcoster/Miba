/**
 * Location autocomplete using Google Places API (New) with session tokens.
 *
 * Session flow:
 * - On focus: generate new session token
 * - On every keystroke (debounced): pass same token to autocomplete
 * - On select: call Place Details with same token → one Place Details request billed
 * - Abandoned searches (no selection) use free Autocomplete allowance
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { fetchAutocomplete, fetchPlaceDetails, isApiConfigured, PlacePrediction } from '@/lib/placesApi';
import Colors from '@/constants/Colors';

const DEBOUNCE_MS = 300;

export interface ResolvedPlace {
  address: string;
  placeId: string;
  displayName: string;
}

interface LocationAutocompleteProps {
  value: string;
  onChangeText: (text: string) => void;
  /** Called when user selects a place from autocomplete (enables Maps link) */
  onResolvedPlace?: (place: ResolvedPlace) => void;
  placeholder?: string;
  style?: ViewStyle;
  inputStyle?: TextStyle;
  maxLength?: number;
  /** Whether to show the location icon in the input row */
  showIcon?: boolean;
}

export function LocationAutocomplete({
  value,
  onChangeText,
  onResolvedPlace,
  placeholder = 'Venue, address, or link…',
  style,
  inputStyle,
  maxLength = 150,
  showIcon = true,
}: LocationAutocompleteProps) {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInputRef = useRef('');

  const startNewSession = useCallback(() => {
    const token = Crypto.randomUUID();
    console.log('[LocationAutocomplete] New session started');
    setSessionToken(token);
  }, []);

  const fetchPredictions = useCallback(async (input: string, token: string) => {
    if (!input.trim() || input.trim().length < 2) {
      setPredictions([]);
      return;
    }
    console.log('[LocationAutocomplete] Fetching predictions for:', JSON.stringify(input));
    setLoading(true);
    try {
      const results = await fetchAutocomplete(input, token);
      console.log('[LocationAutocomplete] Got', results.length, 'predictions');
      setPredictions(results);
    } catch (e) {
      console.warn('[LocationAutocomplete]', e);
      setPredictions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChangeText = useCallback(
    (text: string) => {
      onChangeText(text);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!isApiConfigured()) {
        if (text.length > 0) console.log('[LocationAutocomplete] Typing but API not configured');
        setPredictions([]);
        return;
      }

      if (text.trim().length < 2) {
        setPredictions([]);
        return;
      }

      const token = sessionToken ?? Crypto.randomUUID();
      if (!sessionToken) setSessionToken(token);

      console.log('[LocationAutocomplete] Debouncing, will fetch in', DEBOUNCE_MS, 'ms');
      debounceRef.current = setTimeout(() => {
        lastInputRef.current = text;
        fetchPredictions(text, token);
      }, DEBOUNCE_MS);
    },
    [onChangeText, sessionToken, fetchPredictions]
  );

  const handleFocus = useCallback(() => {
    startNewSession();
  }, [startNewSession]);

  const handleSelect = useCallback(
    async (prediction: PlacePrediction) => {
      if (!sessionToken) return;

      setPredictions([]);
      setLoading(true);

      try {
        const details = await fetchPlaceDetails(prediction.placeId, sessionToken);
        if (details) {
          onChangeText(details.formattedAddress);
          onResolvedPlace?.({
            address: details.formattedAddress,
            placeId: details.placeId,
            displayName: details.displayName,
          });
        } else {
          onChangeText(prediction.fullText);
        }
      } catch {
        onChangeText(prediction.fullText);
      } finally {
        setLoading(false);
        setSessionToken(null);
      }
    },
    [sessionToken, onChangeText, onResolvedPlace]
  );

  const handleClear = useCallback(() => {
    onChangeText('');
    setPredictions([]);
    setSessionToken(null);
  }, [onChangeText]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const hasPredictions = predictions.length > 0;
  const showResults = isApiConfigured() && value.trim().length >= 2 && (hasPredictions || loading);

  return (
    <View style={[styles.container, style]}>
      <View style={styles.inputRow}>
        {showIcon && (
          <Ionicons
            name="location-outline"
            size={18}
            color={Colors.textSecondary}
            style={styles.inputIcon}
          />
        )}
        <TextInput
          style={[
            styles.input,
            showIcon && styles.inputWithIcon,
            inputStyle,
          ]}
          value={value}
          onChangeText={handleChangeText}
          onFocus={handleFocus}
          placeholder={placeholder}
          placeholderTextColor={Colors.textSecondary}
          maxLength={maxLength}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {loading && (
          <ActivityIndicator size="small" color={Colors.primary} style={styles.loader} />
        )}
        {value.length > 0 && !loading && (
          <TouchableOpacity onPress={handleClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {showResults && (
        <View style={styles.results}>
          {loading && predictions.length === 0 ? (
            <View style={styles.resultRow}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.resultPlaceholder}>Searching…</Text>
            </View>
          ) : (
            predictions.map((p) => (
              <TouchableOpacity
                key={p.placeId}
                style={styles.resultRow}
                onPress={() => handleSelect(p)}
                activeOpacity={0.7}
              >
                <Ionicons name="location-outline" size={16} color={Colors.textSecondary} />
                <View style={styles.resultText}>
                  <Text style={styles.resultMain} numberOfLines={1}>
                    {p.mainText}
                  </Text>
                  {p.secondaryText ? (
                    <Text style={styles.resultSecondary} numberOfLines={1}>
                      {p.secondaryText}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 0 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  inputIcon: {
    position: 'absolute',
    left: 14,
    top: 14,
    zIndex: 1,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.text,
    flex: 1,
  },
  inputWithIcon: { paddingLeft: 40 },
  loader: { marginLeft: 8 },
  results: {
    marginTop: 6,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  resultText: { flex: 1 },
  resultMain: { fontSize: 15, fontWeight: '600', color: Colors.text },
  resultSecondary: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  resultPlaceholder: { fontSize: 14, color: Colors.textSecondary, marginLeft: 8 },
});
