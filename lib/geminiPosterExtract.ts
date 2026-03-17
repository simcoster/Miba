/**
 * Extract event details from a poster/screenshot image using Gemini API.
 */

import { parse } from 'date-fns';

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const PROMPT = `I am attaching an image. First, determine if this image is actually a poster or advertisement for an event (concert, meetup, party, workshop, etc.). It should clearly promote a specific event with details like date, time, or location.

If the image is NOT an event poster (e.g. a random photo, meme, screenshot of a chat, generic image, or unrelated content), set is_event_poster to false and use null for other fields.

If it IS an event poster, set is_event_poster to true and extract: event_name, event_type, date or dates, start_time, location or locations, venue name, and description.

Keep the original language of the poster. If the poster is in Hebrew (or any other language), do NOT translate to English — preserve the text as written, including the location.

For the description field: format it nicely with clear line breaks. Put each fact, sentence, or bullet point on its own line (use \\n to separate lines). If the poster mixes Hebrew and English, put each language block on a separate line. Do NOT concatenate everything into one long unformatted string — preserve the structure and readability of the original poster.

Return ONLY valid JSON, no markdown or explanation. Use null for missing fields. Include is_event_poster (boolean) in the response.`;

export interface ExtractedEvent {
  is_event_poster?: boolean;
  event_name: string | null;
  event_type?: string | null;
  date?: string | null;
  dates?: string | string[] | null;
  start_time?: string | null;
  location?: string | null;
  locations?: string | string[] | null;
  location_or_locations?: string | string[] | null;
  venue_name?: string | null;
  description?: string | null;
}

export interface ParsedPosterResult {
  isEventPoster: boolean;
  title: string;
  description: string;
  location: string;
  activityTime: Date;
}

function parseJsonFromResponse(text: string): ExtractedEvent | null {
  let cleaned = text.trim();
  // Strip markdown code blocks if present
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }
  try {
    return JSON.parse(cleaned) as ExtractedEvent;
  } catch {
    return null;
  }
}

function parseActivityTime(extracted: ExtractedEvent): Date {
  const dateStr = extracted.date ?? (Array.isArray(extracted.dates) ? extracted.dates[0] : extracted.dates) ?? null;
  const timeStr = extracted.start_time ?? null;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(19, 0, 0, 0); // default: tomorrow 7pm

  if (!dateStr && !timeStr) return tomorrow;

  let date: Date | null = null;

  // Try parsing date
  if (dateStr && typeof dateStr === 'string') {
    const formats = [
      'yyyy-MM-dd',
      'MMM d, yyyy',
      'MMMM d, yyyy',
      'M/d/yyyy',
      'd/M/yyyy',
      'MM/dd/yyyy',
      'dd/MM/yyyy',
    ];
    for (const fmt of formats) {
      try {
        date = parse(dateStr.trim(), fmt, new Date());
        if (!isNaN(date.getTime())) break;
      } catch {
        // continue
      }
    }
    if (!date || isNaN(date.getTime())) {
      date = new Date(dateStr);
      if (isNaN(date.getTime())) date = null;
    }
  }

  if (!date || isNaN(date.getTime())) {
    date = new Date();
    date.setDate(date.getDate() + 1);
  }

  // Apply time if provided
  if (timeStr && typeof timeStr === 'string') {
    const t = timeStr.trim().toLowerCase();
    const hourMatch = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (hourMatch) {
      let h = parseInt(hourMatch[1], 10);
      const m = hourMatch[2] ? parseInt(hourMatch[2], 10) : 0;
      const pm = hourMatch[3] === 'pm';
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
      date.setHours(h, m, 0, 0);
    }
  } else {
    date.setHours(19, 0, 0, 0);
  }

  if (date <= new Date()) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

/** Cached model output for testing sub-destinations without calling Gemini */
export const TEST_CACHED_EXTRACTED_EVENT: ExtractedEvent = {
  is_event_poster: true,
  event_name: 'Fetish Social',
  event_type: 'Social event, Karaoke Night, Darkroom',
  date: '20/3/2026',
  start_time: '21:00',
  location: 'ALENBY 38, TLV',
  venue_name: 'MASH central',
  description:
    'IM*FC\nמג"ף מועדון גברים בפטיש ISRAEL MEN\'S FETISH CLUB\nDarkroom\nחדר חושך\nKaraoke Night!\nקריוקי!\nלבוש פטיש על כל סוגיו\nwear your fetish gear\nHAPPY HOUR 21:00-23:00\n45NIS COCKTAILS\nMASH central',
};

/** Parse cached event into ParsedPosterResult — for testing sub-destinations without Gemini */
export function getTestCachedParsedResult(): ParsedPosterResult {
  const e = TEST_CACHED_EXTRACTED_EVENT;
  const title = (e.event_name ?? '').trim() || 'Untitled Event';
  const eventType = (e.event_type ?? '').trim();
  const desc = (e.description ?? '').trim();
  const description = eventType && desc ? `${eventType} - ${desc}` : eventType || desc;
  const location = typeof e.location === 'string' ? e.location.trim() : '';
  return {
    isEventPoster: true,
    title,
    description,
    location,
    activityTime: parseActivityTime(e),
  };
}

export async function extractEventFromPoster(
  base64Image: string,
  mimeType: string = 'image/jpeg'
): Promise<ParsedPosterResult> {
  console.log('[geminiPosterExtract] Starting extraction...');
  if (!API_KEY) {
    throw new Error('Gemini API key not configured');
  }

  const res = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: mimeType === 'image/png' ? 'image/png' : 'image/jpeg',
                data: base64Image,
              },
            },
            { text: PROMPT },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.log('[geminiPosterExtract] Full API response:', JSON.stringify(data, null, 2));
    throw new Error('No response from Gemini');
  }

  console.log('[geminiPosterExtract] Model JSON response:', text);

  const extracted = parseJsonFromResponse(text);
  if (!extracted) {
    throw new Error('Could not parse event details from image');
  }

  const isEventPoster = extracted.is_event_poster === true;

  const title = (extracted.event_name ?? '').trim() || 'Untitled Event';
  const eventType = (extracted.event_type ?? '').trim();
  const desc = (extracted.description ?? '').trim();
  const description = eventType && desc ? `${eventType} - ${desc}` : eventType || desc;
  const rawLocation =
    (typeof extracted.location === 'string' ? extracted.location : null) ??
    (typeof extracted.location_or_locations === 'string' ? extracted.location_or_locations : null) ??
    (Array.isArray(extracted.locations) ? extracted.locations[0] : extracted.locations) ??
    (Array.isArray(extracted.location_or_locations) ? extracted.location_or_locations[0] : null) ??
    '';
  const location = typeof rawLocation === 'string' ? rawLocation.trim() : '';

  return {
    isEventPoster,
    title,
    description,
    location,
    activityTime: parseActivityTime(extracted),
  };
}
