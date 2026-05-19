const tokenCache = {
  accessToken: "",
  expiresAt: 0
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "halo-dispatch-api" });
      }

      if (url.pathname === "/api/halo/action" && request.method === "POST") {
        const body = await request.json();
        return json(await handleDashboardAction(body, env));
      }

      if (url.pathname.startsWith("/api/halo/") && request.method === "GET") {
        const haloPath = url.pathname.replace("/api/halo", "/api");
        return json(await haloRequest(env, haloPath + url.search, { method: "GET" }));
      }

      return json({ ok: false, error: "Not found" }, 404);
    } catch (error) {
      return json({ ok: false, error: error.message || String(error) }, 500);
    }
  }
};

async function handleDashboardAction(body, env) {
  const { action, payload = {} } = body || {};
  const mapped = mapDashboardAction(action, payload, env);

  if (!mapped) {
    return {
      ok: true,
      mode: "unmapped",
      message: "Action received by Worker. Add the Halo endpoint mapping after confirming tenant /apidoc fields.",
      action,
      payload
    };
  }

  return haloRequest(env, mapped.path, {
    method: mapped.method,
    body: mapped.body
  });
}

function mapDashboardAction(action, payload, env) {
  switch (action) {
    case "refreshReports":
      return null;
    case "createAppointment":
      return null;
    case "updateAppointment":
      return null;
    case "createAllDayTask":
    case "moveToAllDayTask":
      return null;
    case "assignTicketDateOnly":
    case "moveToDateOnlyTask":
      return null;
    default:
      return null;
  }
}

async function haloRequest(env, path, options = {}) {
  const accessToken = await getAccessToken(env);
  const response = await fetch(new URL(path, env.HALO_RESOURCE_SERVER).toString(), {
    method: options.method || "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const data = text ? safeJson(text) : null;

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `HaloPSA API returned ${response.status}`);
  }

  return { ok: true, data };
}

async function getAccessToken(env) {
  validateEnv(env);
  const now = Date.now();

  if (tokenCache.accessToken && tokenCache.expiresAt > now + 60000) {
    return tokenCache.accessToken;
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.HALO_CLIENT_ID,
    client_secret: env.HALO_CLIENT_SECRET,
    scope: env.HALO_SCOPE || "all"
  });

  const response = await fetch(env.HALO_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || "Unable to authenticate with HaloPSA");
  }

  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAt = now + ((data.expires_in || 3600) * 1000);
  return tokenCache.accessToken;
}

function validateEnv(env) {
  const missing = ["HALO_AUTH_URL", "HALO_RESOURCE_SERVER", "HALO_CLIENT_ID", "HALO_CLIENT_SECRET"]
    .filter(key => !env[key]);

  if (missing.length) {
    throw new Error(`Missing Worker secret/variable: ${missing.join(", ")}`);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
