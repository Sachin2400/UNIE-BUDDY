-- Smart batching and result caching for AI analysis

-- Cache for article analyses (same topic → reuse)
CREATE TABLE IF NOT EXISTS public.article_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  subject TEXT,
  topics TEXT[],
  gs_paper TEXT,
  upsc_relevance_score INTEGER,
  upsc_reasoning TEXT,
  is_hot_topic BOOLEAN,
  provider TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '30 days'),
  hit_count INTEGER DEFAULT 0,
  UNIQUE(cache_key)
);

CREATE INDEX IF NOT EXISTS idx_article_cache_key ON article_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_article_cache_expires ON article_cache(expires_at);

-- Enable RLS
ALTER TABLE public.article_cache ENABLE ROW LEVEL SECURITY;

-- The cache is shared across all users (that is the point of it: identical
-- newspaper input must yield identical output), so it is readable by everyone
-- and writable only by the service role.
--
-- NOTE: PostgreSQL has no `CREATE POLICY IF NOT EXISTS`, so this is wrapped in
-- a DO block. Writing `CREATE POLICY IF NOT EXISTS ...` is a syntax error
-- (SQLSTATE 42601) and aborts the whole migration.
DROP POLICY IF EXISTS "Anyone can read article cache" ON public.article_cache;
CREATE POLICY "Anyone can read article cache"
  ON public.article_cache FOR SELECT
  USING (true);

-- The Edge Function worker runs as the service role, which bypasses RLS
-- entirely, so no INSERT/UPDATE policy is required here.


-- Function to get cached article
CREATE OR REPLACE FUNCTION public.get_cached_article(p_cache_key TEXT)
RETURNS TABLE (
  title TEXT,
  content TEXT,
  summary TEXT,
  subject TEXT,
  topics TEXT[],
  gs_paper TEXT,
  upsc_relevance_score INTEGER,
  upsc_reasoning TEXT,
  is_hot_topic BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE article_cache SET hit_count = hit_count + 1 WHERE cache_key = p_cache_key;
  
  RETURN QUERY
  SELECT ac.title, ac.content, ac.summary, ac.subject, ac.topics, 
         ac.gs_paper, ac.upsc_relevance_score, ac.upsc_reasoning, ac.is_hot_topic
  FROM article_cache ac
  WHERE ac.cache_key = p_cache_key
    AND ac.expires_at > now();
END;
$$;


-- Function to cache an article
CREATE OR REPLACE FUNCTION public.cache_article(
  p_cache_key TEXT,
  p_title TEXT,
  p_content TEXT,
  p_summary TEXT,
  p_subject TEXT,
  p_topics TEXT[],
  p_gs_paper TEXT,
  p_upsc_relevance_score INTEGER,
  p_upsc_reasoning TEXT,
  p_is_hot_topic BOOLEAN,
  p_provider TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO article_cache (
    cache_key, title, content, summary, subject, topics, 
    gs_paper, upsc_relevance_score, upsc_reasoning, is_hot_topic, provider
  ) VALUES (
    p_cache_key, p_title, p_content, p_summary, p_subject, p_topics, 
    p_gs_paper, p_upsc_relevance_score, p_upsc_reasoning, p_is_hot_topic, p_provider
  )
  ON CONFLICT (cache_key) DO UPDATE SET
    content = EXCLUDED.content,
    summary = EXCLUDED.summary,
    topics = EXCLUDED.topics,
    upsc_relevance_score = EXCLUDED.upsc_relevance_score,
    upsc_reasoning = EXCLUDED.upsc_reasoning,
    is_hot_topic = EXCLUDED.is_hot_topic,
    provider = EXCLUDED.provider,
    expires_at = now() + interval '30 days';
END;
$$;