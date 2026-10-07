-- Multi-key round-robin API key pool for load distribution

-- Store multiple API keys per provider
CREATE TABLE IF NOT EXISTS public.ai_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL, -- 'gemini', 'groq'
  key_name TEXT NOT NULL,  -- display name
  encrypted_key TEXT NOT NULL, -- encrypted at rest
  is_active BOOLEAN DEFAULT true,
  rate_limit_rps INTEGER DEFAULT 1, -- requests per second this key can handle
  total_requests INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_api_keys_provider_active 
  ON ai_api_keys(provider, is_active);

-- Round-robin counter per provider
CREATE TABLE IF NOT EXISTS public.ai_key_round_robin (
  provider TEXT PRIMARY KEY,
  current_index INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Function to get next key (round-robin)
--
-- Notes on the previous version of this function, which failed to create with
-- a plpgsql syntax error:
--   * "RETURNING current_index INTO STRICT current_index" is not valid
--     plpgsql — STRICT is only allowed on SELECT INTO, not RETURNING INTO.
--   * The output column `current_index` collided with the local variable of
--     the same name, making the later OFFSET reference ambiguous.
--   * The modulo could divide by zero when a provider had no active keys.
--
-- A stable, deterministic ordering (by created_at, then id) is required: the
-- round-robin cursor is meaningless if row order can change between calls.
CREATE OR REPLACE FUNCTION public.get_next_api_key(p_provider TEXT)
RETURNS TABLE (
  key_id UUID,
  encrypted_key TEXT,
  rate_limit_rps INTEGER
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total   integer;
  v_next    integer;
BEGIN
  SELECT count(*)::integer
    INTO v_total
    FROM public.ai_api_keys
   WHERE provider = p_provider
     AND is_active = true;

  -- Nothing to hand out; return no rows rather than dividing by zero.
  IF v_total = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.ai_key_round_robin (provider, current_index, updated_at)
  VALUES (p_provider, 0, now())
  ON CONFLICT (provider) DO UPDATE
    SET current_index = (
          (public.ai_key_round_robin.current_index + 1) % v_total
        ),
        updated_at = now()
  RETURNING public.ai_key_round_robin.current_index INTO v_next;

  RETURN QUERY
  SELECT ak.id, ak.encrypted_key, ak.rate_limit_rps
    FROM public.ai_api_keys ak
   WHERE ak.provider = p_provider
     AND ak.is_active = true
   ORDER BY ak.created_at, ak.id
   LIMIT 1
   OFFSET v_next;
END;
$$;

-- Function to mark key as used
CREATE OR REPLACE FUNCTION public.mark_key_used(p_key_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ai_api_keys 
  SET total_requests = total_requests + 1,
      last_used_at = now(),
      updated_at = now()
  WHERE id = p_key_id;
END;
$$;