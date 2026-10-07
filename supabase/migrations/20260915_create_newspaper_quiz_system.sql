-- ============================================================
-- UNIE BUDDY — NEWSPAPER PRELIMS QUIZ SYSTEM
-- ============================================================

CREATE TABLE public.daily_quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  newspaper_id UUID NOT NULL
    REFERENCES public.newspapers(id)
    ON DELETE CASCADE,

  title TEXT NOT NULL,

  question_count INTEGER NOT NULL
    CHECK (question_count > 0),

  duration_seconds INTEGER NOT NULL
    CHECK (duration_seconds > 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, newspaper_id)
);

CREATE INDEX daily_quizzes_user_idx
  ON public.daily_quizzes(user_id, created_at DESC);

CREATE INDEX daily_quizzes_newspaper_idx
  ON public.daily_quizzes(newspaper_id);


-- ============================================================
-- QUIZ QUESTIONS
-- ============================================================

CREATE TABLE public.daily_quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  quiz_id UUID NOT NULL
    REFERENCES public.daily_quizzes(id)
    ON DELETE CASCADE,

  article_id UUID NOT NULL
    REFERENCES public.articles(id)
    ON DELETE CASCADE,

  question TEXT NOT NULL,

  options JSONB NOT NULL,

  correct_index INTEGER NOT NULL
    CHECK (correct_index BETWEEN 0 AND 3),

  explanation TEXT,

  topic TEXT,

  subject TEXT,

  difficulty TEXT
    CHECK (difficulty IN ('easy', 'medium', 'hard')),

  question_order INTEGER NOT NULL
    CHECK (question_order > 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (quiz_id, question_order)
);

CREATE INDEX daily_quiz_questions_quiz_idx
  ON public.daily_quiz_questions(quiz_id, question_order);

CREATE INDEX daily_quiz_questions_article_idx
  ON public.daily_quiz_questions(article_id);


-- ============================================================
-- QUIZ ATTEMPTS
-- ============================================================

CREATE TABLE public.quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  quiz_id UUID NOT NULL
    REFERENCES public.daily_quizzes(id)
    ON DELETE CASCADE,

  user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  submitted_at TIMESTAMPTZ,

  score NUMERIC(6,2),

  correct INTEGER NOT NULL DEFAULT 0,

  incorrect INTEGER NOT NULL DEFAULT 0,

  unanswered INTEGER NOT NULL DEFAULT 0,

  time_taken_seconds INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX quiz_attempts_user_idx
  ON public.quiz_attempts(user_id, created_at DESC);

CREATE INDEX quiz_attempts_quiz_idx
  ON public.quiz_attempts(quiz_id);


-- ============================================================
-- INDIVIDUAL ANSWERS
-- ============================================================

CREATE TABLE public.quiz_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  attempt_id UUID NOT NULL
    REFERENCES public.quiz_attempts(id)
    ON DELETE CASCADE,

  question_id UUID NOT NULL
    REFERENCES public.daily_quiz_questions(id)
    ON DELETE CASCADE,

  selected_index INTEGER
    CHECK (selected_index BETWEEN 0 AND 3),

  is_correct BOOLEAN,

  marked_for_review BOOLEAN NOT NULL DEFAULT false,

  time_spent_seconds INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (attempt_id, question_id)
);

CREATE INDEX quiz_answers_attempt_idx
  ON public.quiz_answers(attempt_id);


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.daily_quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_answers ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- DAILY QUIZZES
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.daily_quizzes
TO authenticated;

GRANT ALL
ON public.daily_quizzes
TO service_role;

CREATE POLICY "Users manage own daily quizzes"
ON public.daily_quizzes
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);


-- ============================================================
-- QUIZ QUESTIONS
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.daily_quiz_questions
TO authenticated;

GRANT ALL
ON public.daily_quiz_questions
TO service_role;

CREATE POLICY "Users manage own quiz questions"
ON public.daily_quiz_questions
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.daily_quizzes q
    WHERE q.id = daily_quiz_questions.quiz_id
      AND q.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.daily_quizzes q
    WHERE q.id = daily_quiz_questions.quiz_id
      AND q.user_id = auth.uid()
  )
);


-- ============================================================
-- QUIZ ATTEMPTS
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.quiz_attempts
TO authenticated;

GRANT ALL
ON public.quiz_attempts
TO service_role;

CREATE POLICY "Users manage own quiz attempts"
ON public.quiz_attempts
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);


-- ============================================================
-- QUIZ ANSWERS
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.quiz_answers
TO authenticated;

GRANT ALL
ON public.quiz_answers
TO service_role;

CREATE POLICY "Users manage own quiz answers"
ON public.quiz_answers
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.quiz_attempts a
    WHERE a.id = quiz_answers.attempt_id
      AND a.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.quiz_attempts a
    WHERE a.id = quiz_answers.attempt_id
      AND a.user_id = auth.uid()
  )
);