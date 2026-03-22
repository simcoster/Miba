// Exchanges a Google OAuth authorization code for an access token.
// Used for importing contacts via People API - the client cannot exchange
// the code without the client secret, so we do it server-side.
// Requires: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (Supabase secrets)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Missing or invalid Authorization", { status: 401, headers: corsHeaders });
  }

  const jwt = authHeader.slice(7);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  let body: { code: string; redirect_uri: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }

  if (!body.code || typeof body.code !== "string" || !body.redirect_uri || typeof body.redirect_uri !== "string") {
    return new Response("Missing code or redirect_uri", { status: 400, headers: corsHeaders });
  }

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.error("Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET");
    return new Response("Server misconfigured", { status: 500, headers: corsHeaders });
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: body.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: body.redirect_uri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error("Google token exchange failed:", tokenRes.status, errText);
    return new Response(
      JSON.stringify({ error: "Token exchange failed" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "No access token in response" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ access_token: accessToken }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
