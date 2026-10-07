CREATE TABLE public.mcq_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mcq_id uuid NOT NULL REFERENCES public.mcqs(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  topic text,
  subject text,
  difficulty text,
  picked_index integer NOT NULL,
  is_correct boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, mcq_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mcq_attempts TO authenticated;
GRANT ALL ON public.mcq_attempts TO service_role;

ALTER TABLE public.mcq_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own mcq_attempts"
  ON public.mcq_attempts FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX mcq_attempts_user_topic_idx ON public.mcq_attempts (user_id, topic);
CREATE INDEX mcq_attempts_user_subject_idx ON public.mcq_attempts (user_id, subject);