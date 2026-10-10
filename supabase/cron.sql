-- Calls the scan-deals Edge Function every hour. That's only a check: the
-- function itself skips (no ScraperAPI credits spent) while the laptop scanner
-- has reported a successful scan within the last 12h, and otherwise spaces its
-- own scans to at most one per 24h, further apart if credits run short - see
-- skipReason() in functions/scan-deals/index.ts. Hourly, so a laptop outage is
-- picked up within ~1h of the 12h mark.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'scan-openbox-deals',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://bedcfodwctfiaozaetsn.supabase.co/functions/v1/scan-deals',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || '__SERVICE_ROLE_KEY__',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check scheduled runs: select * from cron.job;
-- To check run history:    select * from cron.job_run_details order by start_time desc limit 20;
-- To remove the schedule:  select cron.unschedule('scan-openbox-deals');
