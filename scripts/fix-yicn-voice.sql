-- Fix YICN Roofing AssistantSettings voice_id from invalid Polly.Joanna to valid Gemini voice Aoede
-- Task #7: Fix YICN voice consistency & email transcripts
UPDATE generic_entities
SET data = jsonb_set(data, '{voice_id}', '"Aoede"')
WHERE entity_type = 'AssistantSettings'
  AND company_id = 'loc_mmdvp1h5_e8i9eb'
  AND data->>'voice_id' = 'Polly.Joanna';
