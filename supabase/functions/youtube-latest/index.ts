// ============================================================
// Anestheo - youtube-latest
// Server-side proxy for the official Anestheo YouTube channel. Resolves the
// channel -> uploads playlist -> latest videos (+ durations) using the YouTube
// Data API, and returns a small JSON array the homepage and the dashboard
// render. The API key stays server-side (never exposed to the browser), and
// the response is CORS-enabled so the page can call it directly.
//
// Returns: [{ id, title, published, duration, thumb, views }]
//
// Deploy:  supabase functions deploy youtube-latest --no-verify-jwt
// Secrets: YOUTUBE_API_KEY=AIza...        (required)
//          YOUTUBE_CHANNEL_ID=UC...       (preferred: 24 chars, UC + 22)
//          YOUTUBE_CHANNEL=@anestheo      (fallback, resolved via forHandle)
//
// WHY THE CHANNEL ID IS PREFERRED
// A handle is a display name. It can be changed by its owner, and resolving it
// costs an extra dependency on forHandle behaving. A channel id never changes.
// So if YOUTUBE_CHANNEL_ID is set it is used directly and the handle lookup is
// skipped entirely.
//
// PRECEDENCE MATTERS HERE. The previous version read the channel from
// ?channel= FIRST, and every caller sends ?channel=@anestheo, so a
// YOUTUBE_CHANNEL secret could never take effect — and YOUTUBE_CHANNEL_ID was
// not read at all. Setting the secret therefore changed nothing. The id now
// wins over the query string, which is the only ordering under which
// configuring the function actually configures it.
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

/* Google's own reason, not just the status.
 *
 * This used to throw `youtube channels 400` and nothing else, which is the
 * least useful thing it could have said: 400 covers an invalid key, a
 * malformed parameter and a rejected restriction, and they need completely
 * different fixes. The body Google returns already distinguishes them, so it
 * is carried out to the caller verbatim. */
async function yt(path: string, key: string) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}&key=${key}`);
  const body = await r.text();
  if (!r.ok) {
    let reason = "", message = "";
    try {
      const e = JSON.parse(body)?.error;
      reason  = e?.errors?.[0]?.reason || e?.status || "";
      message = e?.message || "";
    } catch { /* non-JSON error body: fall through with the raw text */ }
    const what = path.split("?")[0];
    throw new Error(
      `youtube ${what} ${r.status}` +
      (reason ? ` [${reason}]` : "") +
      (message ? `: ${message}` : `: ${body.slice(0, 200)}`)
    );
  }
  return JSON.parse(body);
}

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("YOUTUBE_API_KEY");
    if (!key) return json({ error: "not_configured" }, 200);

    const url = new URL(req.url);
    const max = Math.min(Math.max(parseInt(url.searchParams.get("max") || "6", 10) || 6, 1), 12);

    /* 1) find the uploads playlist, by id if we have one, else by handle. */
    const channelId = (url.searchParams.get("channelId") ||
                       Deno.env.get("YOUTUBE_CHANNEL_ID") || "").trim();

    let uploads: string | undefined;

    if (channelId) {
      /* Say so plainly rather than passing it on. A channel id is UC plus 22
         characters; anything else is a typo or a truncated paste, and the API
         answers that with the same generic 400 it uses for a bad key, which
         sends whoever is debugging in the wrong direction entirely. */
      if (!CHANNEL_ID_RE.test(channelId)) {
        return json({
          error: `invalid_channel_id: expected 24 characters (UC + 22), got ${channelId.length} ` +
                 `("${channelId}"). Check YOUTUBE_CHANNEL_ID for a truncated paste.`,
        }, 200);
      }
      const ch = await yt(`channels?part=contentDetails&id=${encodeURIComponent(channelId)}`, key);
      uploads = ch?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) return json({ error: `channel_not_found: no channel with id ${channelId}` }, 200);
    } else {
      const handle = (url.searchParams.get("channel") ||
                      Deno.env.get("YOUTUBE_CHANNEL") || "@anestheo").replace(/^@/, "");
      const ch = await yt(`channels?part=contentDetails&forHandle=${encodeURIComponent(handle)}`, key);
      uploads = ch?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) return json({ error: `handle_not_found: @${handle} did not resolve to a channel` }, 200);
    }

    /* 2) uploads -> latest videos */
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

    /* 3) durations + view counts (contentDetails + statistics) */
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
    return json({ error: String((e as Error).message || e) }, 200); // never break the page
  }
});
