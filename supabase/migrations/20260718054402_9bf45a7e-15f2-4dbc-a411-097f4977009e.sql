
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TYPE public.newspaper_status AS ENUM ('pending','processing','completed','failed');

CREATE TABLE public.newspapers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  status public.newspaper_status NOT NULL DEFAULT 'pending',
  page_count INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX ON public.newspapers(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.newspapers TO authenticated;
GRANT ALL ON public.newspapers TO service_role;
ALTER TABLE public.newspapers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own newspapers" ON public.newspapers FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_newspapers_updated BEFORE UPDATE ON public.newspapers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newspaper_id UUID NOT NULL REFERENCES public.newspapers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  subject TEXT,
  topics TEXT[] NOT NULL DEFAULT '{}',
  gs_paper TEXT,
  upsc_relevance_score INTEGER CHECK (upsc_relevance_score BETWEEN 0 AND 100),
  upsc_reasoning TEXT,
  is_hot_topic BOOLEAN NOT NULL DEFAULT false,
  page_number INTEGER,
  bookmarked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.articles(user_id, created_at DESC);
CREATE INDEX ON public.articles(newspaper_id);
CREATE INDEX ON public.articles(user_id, subject);
CREATE INDEX articles_hot_idx ON public.articles(user_id) WHERE is_hot_topic = true;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.articles TO authenticated;
GRANT ALL ON public.articles TO service_role;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own articles" ON public.articles FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users read own pdfs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'newspapers' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users upload own pdfs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'newspapers' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own pdfs" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'newspapers' AND auth.uid()::text = (storage.foldername(name))[1]);
