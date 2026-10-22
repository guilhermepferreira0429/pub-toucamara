-- Seed de Guimarães · quem entra no painel (link mágico por email; sem SMTP
-- configurado o link aparece no log da API: docker logs toucamara_api).
-- Os funcionários são de demonstração (domínio demo.toucamara.pt, não existe).
BEGIN;
INSERT INTO utilizadores (id, municipio_id, email, nome, perfil, servico_id) VALUES
 ('60000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  'toucamara@descortina.pt','Equipa Tou, Câmara?','admin',NULL),
 ('60000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001',
  'chefe.urbanismo@demo.toucamara.pt','Helena Machado','chefe_divisao','50000000-0000-4000-8000-000000000001'),
 ('60000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001',
  'tecnico.urbanismo@demo.toucamara.pt','Rui Salgado','tecnico','50000000-0000-4000-8000-000000000001'),
 ('60000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000001',
  'atendimento@demo.toucamara.pt','Marta Oliveira','atendimento','50000000-0000-4000-8000-000000000008'),
 ('60000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000001',
  'vereador@demo.toucamara.pt','Vereador do Urbanismo','vereador',NULL)
ON CONFLICT (id) DO UPDATE SET
  municipio_id = EXCLUDED.municipio_id, email = EXCLUDED.email, nome = EXCLUDED.nome,
  perfil = EXCLUDED.perfil, servico_id = EXCLUDED.servico_id, ativo = true;
COMMIT;
