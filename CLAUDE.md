# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm start                        # Start Expo dev server
npm run android                  # Run on Android
npm run ios                      # Run on iOS

# Database
npm run db:migrate               # Push migrations to Supabase (supabase db push)
npm run db:new                   # Create a new migration file

# OTA updates
npm run fix                      # Push JS fix to preview branch
npm run update:internal          # Push update to internal branch
npm run update:preview           # Push update to preview branch

# Builds (EAS) — these auto-bump version and run expo-doctor
npm run build:internal           # Build for both platforms (internal distribution)
npm run build:internal:android   # Android only
npm run build:production         # Production release for both platforms
npm run build:preview            # Preview APK (Android only, no version bump)
```

**Environment variables** (`.env` file needed locally):
- `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`
- `GOOGLE_MAPS_API_KEY`, `GOOGLE_SERVICES_JSON`, `GOOGLE_SERVICES_PLIST` (build-time, via EAS secrets)

## Architecture

**Miba** is a React Native social app (Expo 54, React 19, TypeScript) for creating and sharing activities with friend circles. Backend is Supabase (PostgreSQL + Auth + Realtime).

### Routing

Expo Router with file-based routing. Two top-level route groups:
- `app/(auth)/` — unauthenticated screens (login via Google OAuth)
- `app/(app)/` — tab navigator (authenticated), guarded in `app/_layout.tsx` via `AuthContext`

Tab screens: `index` (Updates feed), `events`, `circles`, `chats`, `mipo`, `profile`. All nested routes (`circle/[id]`, `activity/[id]`, etc.) are registered as `href: null` tabs so they render as full screens within the tab navigator.

### State Management

Three React Contexts (in `contexts/`):
- **`AuthContext`** — Supabase session + `Profile`, Google OAuth sign-in/out
- **`MipoContext`** — real-time location proximity state (`visibleState`, background task management)
- **`UpdatesCountContext`** — badge count for the Updates tab

### Data Layer

All DB access goes through the `supabase` client from `lib/supabase.ts`. That file contains two important patches:
1. **`getSession()` timeout fallback** — works around a gotrue-js deadlock after OAuth sign-in by racing `getSession()` against a 200 ms cache read
2. **`fetchWithTimeout`** — wraps all Supabase HTTP calls with an 8-second abort timeout

### Key Domain Types (`lib/types.ts`)

- `Activity` — the core entity (title, time, location, `is_limited`, `splash_art`, `rsvps`)
- `Circle` / `CircleMember` — friend groups
- `Rsvp` (`pending` | `in` | `out` | `maybe`)
- `Message` — in-activity chat; `type: 'system'` messages carry `metadata: EditMetadata` for edit diffs
- `MipoProximityEvent` — background location proximity detection

### Mipo (Location Proximity)

Background location tracking using `expo-location` + `expo-task-manager`. Logic split across:
- `lib/mipoLocation.ts` — core proximity computation
- `lib/mipoLocationTask.ts` — background task registration
- `lib/mipoNotifications.ts` — push notification triggers
- `contexts/MipoContext.tsx` — React integration + `visibleState`

### Database Migrations

All migrations live in `supabase/migrations/`. Use `npm run db:new` to scaffold, then `npm run db:migrate` to apply. The full schema (tables + RLS policies) is also in `supabase/schema.sql`.

### Styling

Single color palette: `constants/Colors.ts`. Primary brand color is `#F97316` (orange). No CSS-in-JS or theming library — everything uses `StyleSheet.create` with direct `Colors.*` references.

### Path Aliases

`@/` maps to the project root (configured in `tsconfig.json`). Use `@/lib/...`, `@/components/...`, `@/contexts/...`, etc.

### Build System Notes

- `scripts/bump-version.js` auto-increments `app.json` version before internal/production builds
- `scripts/check-eas-credits.js` validates remaining EAS build credits before starting
- `plugins/withGoogleMapsApiKey.js` and `plugins/withAndroidReleaseSigning.js` are custom Expo config plugins applied in `app.config.ts`
- EAS project ID: `2085bc90-aea9-4f54-be69-f93013f3cd39`
