-- Base partilhada: login do painel e partições da auditoria.

-- Links mágicos do painel: guarda-se só o hash do token; uso único.
CREATE TABLE links_magicos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utilizador_id  uuid NOT NULL REFERENCES utilizadores(id),
  token_hash     bytea UNIQUE NOT NULL,
  expira_em      timestamptz NOT NULL,
  usado_em       timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

-- A 0001 só criou outubro de 2026: sem partição o INSERT falha. Meses até ao
-- fim de 2027 e uma partição por defeito para nunca perder um registo.
DO $$
DECLARE
  inicio date := date '2026-11-01';
BEGIN
  WHILE inicio < date '2028-01-01' LOOP
    EXECUTE format(
      'CREATE TABLE audit_log_%s PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
      to_char(inicio, 'YYYY_MM'), inicio, (inicio + interval '1 month')::date);
    inicio := (inicio + interval '1 month')::date;
  END LOOP;
END $$;
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;
