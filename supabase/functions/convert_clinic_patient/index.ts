// ============================================================
// Anestheo /v2 - convert_clinic_patient (Stage 3)
// Account-linked convergence: turns a COMPLETED clinic-invited patient into
// a real auth.users patient + the canonical bridge rows (patient_surgeries /
// care_requests / preop_questionnaires), so they enter the SAME pipeline as a
// consultation-request patient. Service-role, token-authenticated, idempotent.
//
// Guardrails honoured:
//  - New patients only (caller invokes on completion; no backfill here).
//  - No auto-approval: questionnaire enters review_state='pending'.
//  - No silent merge: existing auth user WITH an active surgery -> conflict.
//  - SMTP never blocks: magic link is always returned for manual delivery.
//
// Deploy:  supabase functions deploy convert_clinic_patient --no-verify-jwt
//   (verify_jwt=false: q.html is unauthenticated; the clinic token is the proof)
// Env (provided by the Edge runtime): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// Map clinic questionnaire answers -> bridge answers. Preserves the FULL
// original under _clinic_source so nothing is lost; normalises the basics.
function mapAnswers(src: Record<string, any>) {
  const a: Record<string, any> = { ...src };
  if (src.sex) a.sex = /^f/i.test(src.sex) ? "F" : (/^m/i.test(src.sex) ? "M" : src.sex);
  a._clinic_source = src;
  a._converted_from = "clinic";
  return a;
}

// Find an existing auth user by email (paginated; clinic-scale).
async function findUserByEmail(admin: any, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data || !data.users || data.users.length === 0) return null;
    const hit = data.users.find((u: any) => (u.email || "").toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ status: "error", message: "POST only" }, 405);

  try {
    const { token } = await req.json().catch(() => ({}));
    if (!token) return json({ status: "error", message: "Missing token" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, svc, { auth: { persistSession: false } });

    // 1. Load clinic patient by token.
    const { data: cp } = await admin.from("clinic_patients").select("*").eq("token", token).maybeSingle();
    if (!cp) return json({ status: "error", message: "Invalid token" }, 404);

    // 2. Idempotent: already converted.
    if (cp.auth_user_id) return json({ status: "already", user_id: cp.auth_user_id });

    // 3. Must have completed the questionnaire.
    if (cp.questionnaire_status !== "completed") return json({ status: "not_ready" });

    // 4. Email required for the account-linked flow.
    const email = (cp.email || "").trim().toLowerCase();
    if (!email) return json({ status: "needs_email" });

    // 5. Resolve identity (conflict-safe; no silent merge).
    let userId: string;
    const existing = await findUserByEmail(admin, email);
    if (existing) {
      const { data: ps } = await admin.from("patient_surgeries").select("id").eq("patient_id", existing.id).limit(1);
      const { data: pq } = await admin.from("preop_questionnaires").select("patient_id").eq("patient_id", existing.id).limit(1);
      if ((ps && ps.length) || (pq && pq.length)) {
        // HTTP 200 so supabase-js delivers it in `data` (not `error`); the
        // caller branches on `status`. No silent merge.
        return json({ status: "conflict", message: "This email already has an Anestheo patient account. Please verify before linking." });
      }
      userId = existing.id;
    } else {
      const { data: cu, error: ce } = await admin.auth.admin.createUser({
        email, email_confirm: false,
        user_metadata: { role: "patient", full_name: cp.patient_name, source: "clinic_invite" },
      });
      if (ce || !cu?.user) return json({ status: "error", message: ce?.message || "User creation failed" }, 500);
      userId = cu.user.id;
    }

    // 6. Create canonical bridge rows (origin='clinic'; review_state='pending').
    const now = new Date().toISOString();
    const { data: surgery, error: se } = await admin.from("patient_surgeries").insert({
      patient_id: userId, origin: "clinic", assigned_doctor_id: cp.doctor_id,
      procedure_type: cp.procedure, surgery_date: cp.surgery_date, hospital: cp.hospital,
      clinic_patient_id: cp.id, assigned_at: now,
    }).select("id").single();
    if (se || !surgery) return json({ status: "error", message: "Surgery insert: " + (se?.message || "failed") }, 500);

    const { error: cre } = await admin.from("care_requests").insert({
      patient_id: userId, doctor_id: cp.doctor_id, surgery_id: surgery.id, status: "accepted",
      patient_name: cp.patient_name, procedure: cp.procedure, surgery_date: cp.surgery_date,
      origin_method: "clinic_invite", responded_at: now,
    });
    if (cre) return json({ status: "error", message: "Care request insert: " + cre.message }, 500);

    const { error: qe } = await admin.from("preop_questionnaires").insert({
      patient_id: userId, status: "submitted", completion: 100, review_state: "pending",
      answers: mapAnswers(cp.questionnaire_answers || {}),
      risk_flags: (cp.questionnaire_answers && cp.questionnaire_answers._flags) || [],
    });
    if (qe) return json({ status: "error", message: "Questionnaire insert: " + qe.message }, 500);

    // 7. Stamp the link (idempotency) only after all rows succeed.
    await admin.from("clinic_patients").update({ auth_user_id: userId, converted_at: now }).eq("id", cp.id);

    // 8. Magic link: always return it (SMTP must not block conversion).
    let magic_link: string | null = null;
    try {
      const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
      magic_link = link?.properties?.action_link || null;
    } catch (_) { /* SMTP/link best-effort; conversion already succeeded */ }

    return json({ status: "converted", user_id: userId, surgery_id: surgery.id, magic_link, email_sent: false });
  } catch (e) {
    return json({ status: "error", message: String((e as any)?.message || e) }, 500);
  }
});
