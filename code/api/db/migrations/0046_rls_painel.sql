-- RLS por município nos pedidos do painel (PLANO 4.12).
--
-- A role da app costuma ser dona das tabelas (e em Docker é superutilizador),
-- e essas ignoram o RLS. Por isso o painel corre com SET ROLE para
-- toucamara_painel (sem login, sem privilégios especiais) e com
-- app.municipio_id definido (DatabaseService, a partir do utilizador do
-- painel). As políticas só restringem essa role: o agente, os workers e as
-- páginas públicas ficam como estavam. Um WHERE municipio_id esquecido numa
-- consulta do painel deixa de mostrar dados de outra câmara.
--
-- aplicar_rls_painel() corre de novo depois de cada arranque que aplique
-- migrações (MigrationsService), para cobrir as tabelas novas.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'toucamara_painel') THEN
    CREATE ROLE toucamara_painel NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Sem permissão para criar a role toucamara_painel: o RLS do painel fica desligado.';
  WHEN duplicate_object OR unique_violation THEN
    NULL; -- outra base no mesmo servidor criou-a ao mesmo tempo
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'toucamara_painel')
     AND NOT pg_has_role(current_user, 'toucamara_painel', 'MEMBER') THEN
    EXECUTE format('GRANT toucamara_painel TO %I', current_user);
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sem permissão para GRANT toucamara_painel: o RLS do painel fica desligado.';
END $$;

CREATE OR REPLACE FUNCTION app_municipio() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.municipio_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION aplicar_rls_painel() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  t record;
  n integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'toucamara_painel') THEN
    RETURN 0;
  END IF;
  EXECUTE 'GRANT USAGE ON SCHEMA public, avaliacao TO toucamara_painel';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, avaliacao TO toucamara_painel';
  EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public, avaliacao TO toucamara_painel';
  -- O registo de auditoria e o histórico dos processos não se reescrevem.
  EXECUTE 'REVOKE UPDATE, DELETE ON audit_log, processo_eventos FROM toucamara_painel';
  FOR t IN
    SELECT c.table_schema AS esquema, c.table_name AS tabela
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.column_name = 'municipio_id'
      AND tb.table_type = 'BASE TABLE'
      AND c.table_schema IN ('public', 'avaliacao')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.esquema, t.tabela);
    EXECUTE format('DROP POLICY IF EXISTS painel_municipio ON %I.%I', t.esquema, t.tabela);
    EXECUTE format('DROP POLICY IF EXISTS fora_do_painel ON %I.%I', t.esquema, t.tabela);
    -- Lê o seu município e o que é de todos (municipio_id NULL: feriados
    -- nacionais, conjuntos genéricos); escreve só no seu.
    EXECUTE format(
      'CREATE POLICY painel_municipio ON %I.%I TO toucamara_painel
         USING (municipio_id IS NULL OR municipio_id = app_municipio())
         WITH CHECK (municipio_id = app_municipio())',
      t.esquema, t.tabela);
    -- Outras roles que não sejam donas (o dono não passa pelo RLS): tudo.
    EXECUTE format(
      'CREATE POLICY fora_do_painel ON %I.%I
         USING (current_user <> ''toucamara_painel'')
         WITH CHECK (current_user <> ''toucamara_painel'')',
      t.esquema, t.tabela);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

SELECT aplicar_rls_painel();
