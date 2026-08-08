// ============================================================
// Anestheo - youtube-latest
// Server-side proxy for the official Anestheo YouTube channel. Resolves the
// channel handle -> uploads playlist -> latest videos (+ durations) using the
// YouTube Data API, and returns a small JSON array the patient dashboard
// renders. The API key stays server-side (never exposed to the browser), and
// the response is CORS-enabled so the dashboard can call it directly.
//
// Returns: [{ id, title, published, duration, thumb }]  (duration as M:SS / H:MM:SS)
//
// Deploy:  supabase functions deploy youtube-latest --no-verify-jwt
// Secret:  supabase secrets set YOUTUBE_API_KEY=AIza...   (referrer/IP-restricted)
// Optional secret: YOUTUBE_CHANNEL=@anestheo  (defaults to @anestheo)
// ============================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=900" },
  });
}

// ISO-8601 (PT#H#M#S) -> "M:SS" or "H:MM:SS"
function fmtDuration(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const h = +(m[1] || 0), mi = +(m[2] || 0), s = +(m[3] || 0);
  const pad = (n: number) => (n < 10 ? "0" : "") + n;
  return h ? `${h}:${pad(mi)}:${pad(s)}` : `${mi}:${pad(s)}`;
}

async function yt(path: string, key: string) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}&key=${key}`);
  if (!r.ok) throw new Error(`youtube ${path.split("?")[0]} ${r.status}`);
  return r.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("YOUTUBE_API_KEY");
    if (!key) return json({ error: "not_configured" }, 200); // dashboard falls back gracefully

    const url = new URL(req.url);
    const handle = (url.searchParams.get("channel") || Deno.env.get("YOUTUBE_CHANNEL") || "@anestheo").replace(/^@/, "");
    const max = Math.min(Math.max(parseInt(url.searchParams.get("max") || "6", 10) || 6, 1), 12);

    // 1) handle -> uploads playlist id
    const ch = await yt(`channels?part=contentDetails&forHandle=${encodeURIComponent(handle)}`, key);
    const uploads = ch?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) return json([], 200);

    // 2) uploads -> latest videos
    const pl = await yt(`playlistItems?part=snippet,contentDetails&maxResults=${max}&playlistId=${uploads}`, key);
    const items = (pl.items || [])
      .map((it: any) => {
        const th = it.snippet?.thumbnails || {};
        return {
          id: it.contentDetails?.videoId,
          title: it.snippet?.title || "",
          published: it.contentDetails?.videoPublishedAt || it.snippet?.publishedAt || "",
          thumb: (th.medium || th.high || th.default || {}).url || "",
          duration: "",
          views: 0,
        };
      })
      .filter((v: any) => v.id);

    // 3) durations + view counts (contentDetails + statistics)
    const ids = items.map((i: any) => i.id).join(",");
    if (ids) {
      try {
        const vd = await yt(`videos?part=contentDetails,statistics&id=${ids}`, key);
        const dmap: Record<string, string> = {};
        const vmap: Record<string, number> = {};
        (vd.items || []).forEach((v: any) => {
          dmap[v.id] = v.contentDetails?.duration;
          vmap[v.id] = parseInt(v.statistics?.viewCount || "0", 10) || 0;
        });
        items.forEach((i: any) => { i.duration = fmtDuration(dmap[i.id] || ""); i.views = vmap[i.id] || 0; });
      } catch (_) { /* duration/views are optional */ }
    }

    return json(items, 200);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 200); // never break the dashboard
  }
});
