// EAS Build webhook: updates app_config.min_build_number when internal/production builds complete.
// Set EAS_WEBHOOK_SECRET when deploying; use the same secret with `eas webhook:create`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hmac } from "https://deno.land/x/hmac@v2.0.1/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, expo-signature",
};

const PROFILES_TO_UPDATE = ["internal", "production"];

function verifySignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = "sha1=" + hmac("sha1", secret, body, "utf8", "hex");
  return signature === expected;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const body = await req.text();
  const signature = req.headers.get("expo-signature");
  const secret = Deno.env.get("EAS_WEBHOOK_SECRET");

  if (!verifySignature(body, signature, secret ?? "")) {
    return new Response("Invalid signature", { status: 401, headers: corsHeaders });
  }

  let payload: {
    status?: string;
    metadata?: { buildProfile?: string; appBuildVersion?: string };
  };
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }

  if (payload.status !== "finished") {
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  const buildProfile = payload.metadata?.buildProfile;
  if (!buildProfile || !PROFILES_TO_UPDATE.includes(buildProfile)) {
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  const appBuildVersion = payload.metadata?.appBuildVersion;
  if (!appBuildVersion) {
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { error } = await supabase
    .from("app_config")
    .upsert({ key: "min_build_number", value: appBuildVersion }, { onConflict: "key" });

  if (error) {
    console.error("Failed to update min_build_number:", error);
    return new Response("Database error", { status: 500, headers: corsHeaders });
  }

  return new Response("OK", { status: 200, headers: corsHeaders });
});
