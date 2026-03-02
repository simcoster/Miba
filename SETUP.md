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

> **Important:** For native mobile deep links, also add these as redirect URIs in Supabase:
> `Authentication → URL Configuration → Redirect URLs`:
> - `miba://auth/callback`
> - `exp://localhost:8081` (for Expo Go during development)
> - `exp://192.168.x.x:8081` (replace with your local IP — Expo will show this when you start)

---

## Step 4 — Run the app

```bash
npx expo start
```

- Scan the QR code with **Expo Go** (Android) or the **Camera app** (iPhone)
- The app should load on your phone!

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

## Troubleshooting

**"Invalid OAuth redirect" error on login:**
Make sure you added `miba://auth/callback` to Supabase's allowed redirect URLs.

**App can't connect to Supabase:**
Check that `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are correct in `lib/supabase.ts`.

**Phone can't find the Expo dev server:**
Your phone and computer must be on the same Wi-Fi network. Look at the IP shown in `expo start` and add `exp://192.168.x.x:8081` to Supabase redirect URLs.
