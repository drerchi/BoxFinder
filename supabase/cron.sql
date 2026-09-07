-- Runs the scan-deals Edge Function 1x/day at 9:00 Europe/Prague.
-- pg_cron runs on fixed UTC, no DST awareness: 7 UTC = 9:00 CEST (summer,
-- currently in effect). Once EU clocks fall back in late October, this drifts
-- to 8:00 local until manually bumped to hour 8 for CET (winter).
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'scan-openbox-deals',
  '0 7 * * *',
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
