-- Migration: Website Pixel Events and Real-time Activity Tracking

-- 1. Ensure pixel_id on companies
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS pixel_id text;
UPDATE public.companies SET pixel_id = 'px_' || replace(id::text, '-', '') WHERE pixel_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_pixel_id ON public.companies(pixel_id);

-- 2. Create website_pixel_events table
CREATE TABLE IF NOT EXISTS public.website_pixel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tracking_id text NOT NULL,
  event_name text NOT NULL DEFAULT 'PageView',
  page_url text,
  page_title text,
  site_domain text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  session_id text,
  metadata jsonb DEFAULT '{}'::jsonb
);

-- 3. Indexes for fast aggregation & stream queries
CREATE INDEX IF NOT EXISTS idx_pixel_events_company_time ON public.website_pixel_events(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pixel_events_tracking_id ON public.website_pixel_events(tracking_id);

-- 4. Enable RLS and tenant isolation
ALTER TABLE public.website_pixel_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_website_pixel_events" ON public.website_pixel_events;
CREATE POLICY "tenant_isolation_website_pixel_events"
  ON public.website_pixel_events FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

GRANT ALL ON public.website_pixel_events TO service_role;
GRANT SELECT, INSERT ON public.website_pixel_events TO authenticated;

-- 5. Enable Supabase Realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'website_pixel_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.website_pixel_events;
  END IF;
END $$;
