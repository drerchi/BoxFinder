-- Calls the scan-deals Edge Function once a day, at 13:05 Europe/Prague - a
-- single check: "did the laptop scan at all since ~8:00?" (skipReason() in
-- functions/scan-deals/index.ts checks last_local_scan_at against
-- LOCAL_CHECK_HOURS, default 5). If yes, you're home and this is a no-op. If
-- not, you're away for the day, so it scans once (spending ScraperAPI
-- credits) as that day's only catch-up - it won't fire again today even if
-- re-triggered.
-- 11:05 UTC = 13:05 CEST (summer, currently in effect) - bump to 12:05 UTC
-- for 13:05 CET once clocks fall back in late October.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'scan-openbox-deals',
  '5 11 * * *',
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
