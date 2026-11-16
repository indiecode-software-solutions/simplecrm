import { corsHeaders, createServiceClients, jsonResponse } from "../_shared/authBridge.ts";

Deno.serve(async (req) => {
  // 1. CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 2. Health check or 1x1 GIF tracking pixel support (GET)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const trackingId = url.searchParams.get("id") || url.searchParams.get("pid") || url.searchParams.get("tracking_id");

    if (!trackingId) {
      return jsonResponse({
        status: "active",
        service: "simplecrm Website Pixel Ingestion",
        timestamp: new Date().toISOString(),
      });
    }

    // Process lightweight GET beacon
    await processPixelHit({
      tracking_id: trackingId,
      event_name: url.searchParams.get("event") || "PageView",
      page_url: url.searchParams.get("url") || req.headers.get("referer") || "",
      page_title: url.searchParams.get("title") || "",
      site_domain: url.searchParams.get("domain") || "",
      referrer: url.searchParams.get("ref") || "",
      utm_source: url.searchParams.get("utm_source") || "",
      utm_medium: url.searchParams.get("utm_medium") || "",
      utm_campaign: url.searchParams.get("utm_campaign") || "",
      session_id: url.searchParams.get("sid") || "",
      metadata: {},
    }, req);

    // Return 1x1 transparent GIF for image-tag tracking
    const gif1x1 = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
      0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21,
      0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
      0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
      0x01, 0x00, 0x3b,
    ]);

    return new Response(gif1x1, {
      headers: {
        ...corsHeaders,
        "Content-Type": "image/gif",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  }

  // 3. Process POST payload (sendBeacon or fetch)
  if (req.method === "POST") {
    try {
      const url = new URL(req.url);
      let payload: Record<string, any> = {};

      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        try {
          payload = await req.json();
        } catch {
          payload = {};
        }
      } else {
        try {
          const text = await req.text();
          payload = JSON.parse(text);
        } catch {
          payload = {};
        }
      }

      const trackingId =
        payload.tracking_id ||
        payload.pixel_id ||
        payload.id ||
        url.searchParams.get("id") ||
        url.searchParams.get("pid") ||
        url.searchParams.get("tracking_id");

      if (!trackingId) {
        return jsonResponse({ error: "Missing required tracking_id" }, 400);
      }

      payload.tracking_id = trackingId;
      const res = await processPixelHit(payload, req);

      return jsonResponse(res);
    } catch (err: any) {
      console.error("[Website Pixel] Error:", err);
      return jsonResponse({ error: err.message || "Failed to log event" }, 500);
    }
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
});

async function processPixelHit(payload: Record<string, any>, req: Request) {
  const { adminClient } = createServiceClients();
  const rawId = String(payload.tracking_id || "").trim();

  // Find company by pixel_id, id, or slug
  let companyId: string | null = null;

  // 1. Check direct pixel_id
  const { data: compByPixel } = await adminClient
    .from("companies")
    .select("id")
    .eq("pixel_id", rawId)
    .maybeSingle();

  if (compByPixel?.id) {
    companyId = compByPixel.id;
  } else {
    // 2. Check if rawId is UUID matching companies.id
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(rawId)) {
      const { data: compById } = await adminClient
        .from("companies")
        .select("id")
        .eq("id", rawId)
        .maybeSingle();
      if (compById?.id) companyId = compById.id;
    } else if (rawId.startsWith("px_")) {
      // Stripped uuid or slug
      const cleaned = rawId.replace(/^px_/, "");
      const { data: compBySlug } = await adminClient
        .from("companies")
        .select("id")
        .eq("slug", cleaned)
        .maybeSingle();
      if (compBySlug?.id) companyId = compBySlug.id;
    }
  }

  if (!companyId) {
    // Fallback: look up default or single company
    const { data: fallbackComp } = await adminClient
      .from("companies")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    companyId = fallbackComp?.id || null;
  }

  if (!companyId) {
    return { success: false, error: "Workspace not found for tracking_id" };
  }

  let domain = String(payload.site_domain || "").trim();
  if (!domain) {
    const origin = req.headers.get("origin") || req.headers.get("referer") || payload.page_url;
    if (origin) {
      try {
        domain = new URL(origin).hostname;
      } catch {
        domain = "";
      }
    }
  }

  const eventPayload = {
    company_id: companyId,
    tracking_id: rawId,
    event_name: String(payload.event_name || payload.event || "PageView").trim(),
    page_url: String(payload.page_url || payload.url || "").trim(),
    page_title: String(payload.page_title || payload.title || "").trim(),
    site_domain: domain,
    referrer: String(payload.referrer || payload.ref || "").trim(),
    utm_source: String(payload.utm_source || "").trim(),
    utm_medium: String(payload.utm_medium || "").trim(),
    utm_campaign: String(payload.utm_campaign || "").trim(),
    session_id: String(payload.session_id || payload.sid || "").trim(),
    metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
  };

  const { data: inserted, error: insertError } = await adminClient
    .from("website_pixel_events")
    .insert([eventPayload])
    .select("id, event_name, created_at")
    .single();

  if (insertError) {
    console.warn("[Website Pixel] Insert error:", insertError.message);
    return { success: false, error: insertError.message };
  }

  return {
    success: true,
    event_id: inserted.id,
    event_name: inserted.event_name,
    timestamp: inserted.created_at,
  };
}
