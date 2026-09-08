BEGIN;

-- 0075: Client users must never receive another MSP client's in-app
-- notifications. The HTTP route is tenant-scoped, but notifications point to
-- alert_subscriptions rather than carrying client_id themselves. The original
-- generic tenant RLS policy therefore stopped at the MSP boundary. Bind Client
-- visibility to the subscription's client_id and the authenticated app.user_id.
-- Non-Client roles retain tenant-wide notification visibility; the worker
-- cross-tenant policy remains separate and is not weakened.

DROP POLICY IF EXISTS spr_tenant_isolation ON public.in_app_notifications;

CREATE POLICY spr_tenant_isolation ON public.in_app_notifications
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    AND (
      spr_current_user_role() <> 'Client'
      OR EXISTS (
        SELECT 1
        FROM public.alert_subscriptions s
        JOIN public.users u ON u.id = NULLIF(current_setting('app.user_id', true), '')::integer
        WHERE s.id = in_app_notifications.subscription_id
          AND s.tenant_id = in_app_notifications.tenant_id
          AND s.client_id = u.client_id
          AND u.role = 'Client'
      )
    )
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)
    AND (
      spr_current_user_role() <> 'Client'
      OR EXISTS (
        SELECT 1
        FROM public.alert_subscriptions s
        JOIN public.users u ON u.id = NULLIF(current_setting('app.user_id', true), '')::integer
        WHERE s.id = in_app_notifications.subscription_id
          AND s.tenant_id = in_app_notifications.tenant_id
          AND s.client_id = u.client_id
          AND u.role = 'Client'
      )
    )
  );

COMMIT;
