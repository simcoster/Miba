# Miba — Setup Guide

## Prerequisites

1. **Node.js** (LTS, v22+) — https://nodejs.org
2. **Expo Go** app on your phone — App Store / Google Play
3. **Supabase account** — https://supabase.com

---

## Step 1 — Install dependencies

```bash
cd C:\dev\Miba
npm install
```

---

## Step 2 — Set up the database

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project (`qfdxnpryufkgdstergej`)
3. Go to **SQL Editor** → **New query**
4. Paste the entire contents of `supabase/schema.sql`
5. Click **Run**

---

## Step 3 — Enable Google Sign-In

### In Supabase:
1. Go to **Authentication → Providers → Google**
2. Toggle it **on**
3. You'll need a Google OAuth Client ID + Secret (see below)

### In Google Cloud Console:
1. Go to https://console.cloud.google.com
2. Create a new project (or use an existing one)
3. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client**
4. Set **Application type**: Web application
5. Under **Authorized redirect URIs**, add:
   - `https://qfdxnpryufkgdstergej.supabase.co/auth/v1/callback`
6. Copy the **Client ID** and **Client Secret** into Supabase → Authentication → Google provider
7. Under **OAuth consent screen**, add your test email(s)

> **Important:** For native mobile deep links, add these redirect URIs in Supabase:
> `Authentication → URL Configuration → Redirect URLs`:
>
> | Environment | Redirect URL(s) | Notes |
> | ----------- | --------------- | ----- |
> | Expo Go (local dev) | `exp://**` | Wildcard covers any dev machine IP on your LAN |
> | Standalone (testers) | `miba://`, `miba:///` | For the APK/AAB from `eas build --profile production` |

---

## Step 4 — (Optional) Location autocomplete

When creating or editing an activity, the location field supports Google Places autocomplete. To enable it:

1. In [Google Cloud Console](https://console.cloud.google.com), enable **Places API (New)** and **Street View Static API** (for address cover images when no place photo exists)
2. Create an API key (or use an existing one) under **APIs & Services → Credentials**
3. Add to your environment (e.g. `.env` or `app.config.js`):
   ```
   EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=your_api_key_here
   ```
4. Restrict the key (recommended): **Application restrictions** → iOS/Android app, or **API restrictions** → restrict to Places API only

**Billing:** The app uses session tokens so that selecting a place bills as one Place Details request (~$0.017) instead of per keystroke. Abandoned searches use the free 10,000 Autocomplete requests/month allowance.

---

## Step 5 — Run the app

```bash
npx expo start
```

- Scan the QR code with **Expo Go** (Android) or the **Camera app** (iPhone)
- The app should load on your phone!

---

## Step 6 — (Optional) Build standalone app for testers

To build a standalone APK/AAB for testers (no Expo Go required):

```bash
eas build --platform android --profile production
```

Testers install the resulting APK/AAB directly. OAuth redirects use `miba://` — ensure those URLs are in Supabase (see Step 3).

For internal-only distribution (no Play Store), use `--profile preview` instead.

**Environment variables:** The app has fallbacks for Supabase URL and anon key. For production, consider setting `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in [expo.dev](https://expo.dev) → Project → Environment variables.

**Google Maps API key (Android):** The Maps SDK (chat location pins) needs the key in the manifest at build time. Add `GOOGLE_MAPS_API_KEY` to EAS env vars with the same value as `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`, assigned to development, preview, and production. Without it, the map will crash on Android.

**google-services.json (Android):** This file is in `.gitignore` and must not be committed. For local dev, keep a copy in the project root (download from [Firebase Console](https://console.firebase.google.com) → Project settings → Your apps). For EAS builds, add it as a file-type environment variable:

1. Go to [expo.dev](https://expo.dev) → your project → **Environment variables**
2. **Add variable** → Name: `GOOGLE_SERVICES_JSON`, Type: **File**, upload your `google-services.json`
3. Assign to `preview` and `production` environments
4. Set visibility to **Secret**

If `google-services.json` was previously committed, run `git rm --cached google-services.json` and commit to stop tracking it (the file stays on disk).

---

## Project structure

```
app/
  _layout.tsx          ← Root layout + auth guard
  (auth)/
    login.tsx          ← Google sign-in screen
  (app)/
    _layout.tsx        ← Tab navigator
    index.tsx          ← Home feed (all upcoming activities)
    circles.tsx        ← Your circles list
    profile.tsx        ← Profile + settings
    circle/
      new.tsx          ← Create a new circle
      [id].tsx         ← Circle detail + members
      [id]/invite.tsx  ← Add members by name search
    activity/
      new.tsx          ← Create activity (with circle + date picker)
      [id].tsx         ← Activity detail + RSVP

components/            ← Reusable UI components
contexts/              ← AuthContext (session management)
lib/
  supabase.ts          ← Supabase client
  types.ts             ← TypeScript types
constants/
  Colors.ts            ← Yellow-orange color palette
supabase/
  schema.sql           ← Full DB schema + RLS policies
```

---

## Upgrading Expo

> **⚠️ Warning:** Upgrading the Expo SDK (`expo`, `expo-router`, or other Expo packages) or adding/changing plugins in `app.config.ts` **requires a full EAS build**. OTA updates (EAS Update) only push JavaScript — they cannot update native code.
>
> Before running `npx expo install --fix`, `npx expo install expo@latest`, or similar:
> 1. Plan for a new build: `eas build --profile <your-profile> --platform <android|ios>`
> 2. Testers will need to install the new build; OTA updates alone will not apply the upgrade.

---

## Troubleshooting

**"Invalid OAuth redirect" error on login:**
Make sure you added `miba://`, `miba:///` (standalone) and `exp://**` (Expo Go) to Supabase's allowed redirect URLs.

**App can't connect to Supabase:**
Check that `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are correct in `lib/supabase.ts`.

**Phone can't find the Expo dev server:**
Your phone and computer must be on the same Wi-Fi network. The `exp://**` wildcard in Supabase covers any dev machine IP.

**Location autocomplete not showing:**
Ensure `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` is set and Places API (New) is enabled in Google Cloud. Without the key, the location field works as a plain text input.
