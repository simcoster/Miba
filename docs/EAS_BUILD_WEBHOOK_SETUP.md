# EAS Build Webhook Setup

When an **internal** or **production** build completes successfully, this webhook automatically updates `app_config.min_build_number` in Supabase so older app versions see the update prompt.

## 1. Deploy the Edge Function

```bash
# Deploy the function (requires Supabase CLI and being logged in)
supabase functions deploy eas-build-webhook
```

## 2. Set the Webhook Secret

Generate a random secret (at least 16 characters) and store it in Supabase:

```bash
# Generate a secret (example)
openssl rand -hex 32

# Set it as a Supabase secret (use the value from above)
supabase secrets set EAS_WEBHOOK_SECRET=your-generated-secret-here
```

## 3. Create the EAS Webhook

```bash
eas webhook:create
```

When prompted:

1. **Event type:** `BUILD`
2. **URL:** `https://qfdxnpryufkgdstergej.supabase.co/functions/v1/eas-build-webhook`
3. **Secret:** Use the **same** secret you set in step 2

## 4. Verify

1. Run an internal or production build: `eas build --profile internal --platform android`
2. When the build finishes, EAS will POST to your webhook
3. Check `app_config` in Supabase — `min_build_number` should be updated to the new build number

## Behavior

- **internal** and **production** builds → updates `min_build_number`
- **preview** and **development** builds → ignored (no update)
- Failed or canceled builds → ignored
- Signature is verified; only requests from EAS with the correct secret are accepted

## Troubleshooting

- **401 Invalid signature:** Ensure `EAS_WEBHOOK_SECRET` in Supabase matches the secret you set in `eas webhook:create`
- **Webhook not firing:** Run `eas webhook:list` to confirm the webhook exists and is configured for BUILD events
- **min_build_number not updating:** Check Supabase Edge Function logs in the dashboard
