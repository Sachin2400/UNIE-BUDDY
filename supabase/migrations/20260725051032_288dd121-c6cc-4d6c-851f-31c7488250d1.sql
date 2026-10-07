
CREATE TABLE public.mcq_sets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  count INTEGER NOT NULL,
  mcq_ids UUID[] NOT NULL DEFAULT '{}',
  adaptive JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mcq_sets_user_hash_idx ON public.mcq_sets(user_id, content_hash, count);
CREATE INDEX mcq_sets_user_created_idx ON public.mcq_sets(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mcq_sets TO authenticated;
GRANT ALL ON public.mcq_sets TO service_role;
ALTER TABLE public.mcq_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own mcq_sets" ON public.mcq_sets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
