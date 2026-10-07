import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.115.0";

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return Response.json({ ok:false, error:"SUPABASE_RUNTIME_NOT_CONFIGURED" }, { status:500 });
  const db = createClient(url, key, { auth:{persistSession:false, autoRefreshToken:false} });
  const u = new URL(req.url);
  const limit = Math.max(1, Math.min(500, Number.parseInt(u.searchParams.get("limit") ?? "100",10) || 100));
  const offset = Math.max(0, Number.parseInt(u.searchParams.get("offset") ?? "0", 10) || 0);
  const { data, error, count } = await db
    .from("registry_ingestion_items")
    .select("id,provider,repository_owner,repository_name,canonical_url,status,discovery_agent,discovered_at,last_observed_at,default_branch,stars,language,license_spdx,quality_status", { count:"exact" })
    .order("stars", { ascending:false })
    .range(offset, offset + limit - 1);
  if (error) return Response.json({ ok:false, error:"REGISTRY_READ_FAILED" }, { status:500 });
  return Response.json({
    ok:true,
    count:count ?? data?.length ?? 0,
    offset,
    limit,
    items:data ?? [],
    semantics:{
      status:"discovered means SPR observed public repository metadata; it is not verification",
      quality_status:"unknown means no quality claim has been established"
    }
  }, { headers:{ "Cache-Control":"public, max-age=60, s-maxage=300" }});
});