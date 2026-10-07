
CREATE TABLE public.mcqs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  question TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_index INTEGER NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  explanation TEXT,
  difficulty TEXT,
  topic TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mcqs_article_id_idx ON public.mcqs(article_id);
CREATE INDEX mcqs_user_id_idx ON public.mcqs(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mcqs TO authenticated;
GRANT ALL ON public.mcqs TO service_role;
ALTER TABLE public.mcqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own mcqs" ON public.mcqs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
