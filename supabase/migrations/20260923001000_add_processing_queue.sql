-- Processing queue for sequential newspaper background jobs

CREATE TABLE IF NOT EXISTS public.processing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newspaper_id UUID NOT NULL REFERENCES public.newspapers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting, running, done, failed
  priority INTEGER NOT NULL DEFAULT 0, -- higher = more urgent
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_processing_queue_status_priority
  ON public.processing_queue (status, priority DESC, created_at);

-- Enable RLS (idempotent; must run after the table exists)
ALTER TABLE public.processing_queue ENABLE ROW LEVEL SECURITY;

-- Users can see their own queue items
-- Dropped first so this migration is safely re-runnable: the table and this
-- policy may already exist from a partially applied earlier attempt, which
-- would otherwise abort with SQLSTATE 42710 ("policy already exists").
DROP POLICY IF EXISTS "Users can view own queue items" ON public.processing_queue;
CREATE POLICY "Users can view own queue items"
  ON public.processing_queue FOR SELECT
  USING (auth.uid() = user_id);

-- Users can enqueue processing for their own newspapers.
-- Without this policy every enqueue fails with 42501
-- ("new row violates row-level security policy for table processing_queue")
-- and the job silently falls back to an unthrottled in-process run.
DROP POLICY IF EXISTS "Users can enqueue own jobs" ON public.processing_queue;
CREATE POLICY "Users can enqueue own jobs"
  ON public.processing_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Deliberately NO user UPDATE/DELETE policy: job status transitions are owned
-- by the worker via the SECURITY DEFINER functions below (and by the service
-- role in the Edge Function, which bypasses RLS entirely).

-- Service role can manage queue (for worker)
-- No policy needed for service role

-- Function to claim next waiting job (atomic)
CREATE OR REPLACE FUNCTION public.claim_next_queue_job(worker_id TEXT)
RETURNS TABLE (
  id UUID,
  newspaper_id UUID,
  user_id UUID
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  UPDATE public.processing_queue
  SET status = 'running',
      started_at = now()
  WHERE id = (
    SELECT id FROM public.processing_queue
    WHERE status = 'waiting'
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, newspaper_id, user_id;
END;
$$;

-- Function to mark job done
CREATE OR REPLACE FUNCTION public.finish_queue_job(job_id UUID, success BOOLEAN, err_msg TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.processing_queue
  SET status = CASE WHEN success THEN 'done' ELSE 'failed' END,
      finished_at = now(),
      error_message = err_msg
  WHERE id = job_id;
END;
$$;