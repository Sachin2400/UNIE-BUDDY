-- Enable pg_cron + pg_net (both required to make outbound HTTP from the database)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Vault holds the service-role key used to authenticate the cron -> Edge
-- Function call. Created here (idempotently) so the DO block below can safely
-- reference vault.decrypted_secrets.
CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;

-- ---------------------------------------------------------------------------
-- Queue worker schedule
-- ---------------------------------------------------------------------------
-- IMPORTANT: a 5-field cron expression has NO seconds field, so '*/30 * * * *'
-- means "at minute 0 and 30" i.e. every 30 MINUTES, not every 30 seconds.
-- The earlier version of this migration relied on that misreading and the
-- worker effectively almost never ran.
--
-- pg_cron does accept a 6th (seconds) field when configured with
-- cron.use_second_interval = on, but that is a server-level setting we do not
-- control here. A 2-minute cadence is used instead: newspaper processing takes
-- minutes anyway, and each invocation drains up to MAX_JOBS_PER_INVOCATION
-- queued jobs, so throughput does not depend on how often we poll.
-- ---------------------------------------------------------------------------
-- The worker authenticates with the service-role key, which must not be
-- hardcoded in a migration that lives in version control. It is read from
-- Supabase Vault. One-time setup (run ONCE in the SQL editor, not a migration):
--
--   SELECT vault.create_secret(
--     'eyJhbGciOi...',            -- your service_role key
--     'service_role_key',
--     'Service role key for the process-queue Edge Function'
--   );
--
-- If the secret is absent we do NOT hard-fail: the queue still works via the
-- `processQueueWorker` server function, and the operator can create the
-- schedule later. Failing here would block every other pending migration.
DO $$
DECLARE
  secret_present boolean;
  existing_job   bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
  ) INTO secret_present;

  IF NOT secret_present THEN
    RAISE NOTICE
      'Skipping cron schedule: Vault secret ''service_role_key'' is not set up. '
      'Run the vault.create_secret(...) call documented above, then '
      'SELECT cron.schedule(...) to enable the automatic worker.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('process-newspaper-queue');

  SELECT cron.schedule(
    'process-newspaper-queue',
    '*/2 * * * *',  -- every 2 minutes
    $outer$
    SELECT net.http_post(
      url := 'https://mjaxonvnbkifddzrftqj.supabase.co/functions/v1/process-queue',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'service_role_key'
          LIMIT 1
        ),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
    $outer$
  ) INTO existing_job;

  RAISE NOTICE 'Scheduled process-newspaper-queue as job %.', existing_job;
END;
$$;

-- To unschedule later: SELECT cron.unschedule('process-newspaper-queue');
