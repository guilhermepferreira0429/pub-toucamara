-- "Que regra valia no dia X" (FUN §12): cada versão de uma fonte vale desde
-- vigor_desde (data legal, quando se sabe) ou, sem ela, desde que foi lida
-- pela primeira vez — lida_em muda quando o mesmo texto volta a ser lido, por
-- isso não serve para isto.
ALTER TABLE fonte_versoes ADD COLUMN criada_em timestamptz;
UPDATE fonte_versoes SET criada_em = lida_em WHERE criada_em IS NULL;
ALTER TABLE fonte_versoes ALTER COLUMN criada_em SET NOT NULL,
  ALTER COLUMN criada_em SET DEFAULT now();
CREATE INDEX fonte_versoes_fonte_inicio_idx
  ON fonte_versoes (fonte_id, (coalesce(vigor_desde, (criada_em AT TIME ZONE 'UTC')::date)));
