-- Allow runtime roles to use internal agent logs without exposing them to
-- Supabase client roles or granting the HTTP app cross-tenant visibility.
-- agent_logs has no tenant_id; its parent agent_jobs row supplies ownership.
ALTER TABLE public.agent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spr_app_agent_logs_select ON public.agent_logs;
CREATE POLICY spr_app_agent_logs_select ON public.agent_logs
  FOR SELECT TO spr_app_runtime
  USING (
    EXISTS (
      SELECT 1 FROM public.agent_jobs AS job
      WHERE job.id = agent_logs.job_id
        AND job.tenant_id = current_setting('app.tenant_id', true)
    )
  );

DROP POLICY IF EXISTS spr_app_agent_logs_insert ON public.agent_logs;
CREATE POLICY spr_app_agent_logs_insert ON public.agent_logs
  FOR INSERT TO spr_app_runtime
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agent_jobs AS job
      WHERE job.id = agent_logs.job_id
        AND job.tenant_id = current_setting('app.tenant_id', true)
    )
  );

DROP POLICY IF EXISTS spr_worker_agent_logs ON public.agent_logs;
CREATE POLICY spr_worker_agent_logs ON public.agent_logs
  FOR ALL TO spr_worker_runtime USING (true) WITH CHECK (true);
