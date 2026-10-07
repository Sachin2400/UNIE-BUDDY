-- Add processing_stage column to newspapers table for background job tracking

ALTER TYPE public.newspaper_status ADD VALUE IF NOT EXISTS 'accepted';

ALTER TABLE public.newspapers 
ADD COLUMN IF NOT EXISTS processing_stage TEXT;

COMMENT ON COLUMN public.newspapers.processing_stage IS 'Current processing stage: ocr_downloading, ocr_running, ai_analyzing, mcq_generating, completed, failed';