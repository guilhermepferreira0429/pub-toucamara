-- Análise de projetos de obras por tipo de operação (V4 #2): ampliação ou
-- anexo, moradia nova, piscina, muro, fachada, demolição, mudança de uso e
-- alteração interior.
--
-- O perfil com que cada verificação correu (e quem o escolheu: o técnico, o
-- requerimento, o tipo de processo ou o texto), para a cache e para manter a
-- escolha do técnico nas verificações seguintes.
ALTER TABLE processo_verificacoes ADD COLUMN perfil jsonb;  -- {codigo, escolhido_por, ambiguo, candidatos[]}

-- Parâmetros urbanísticos da zona do PDM (índices de implantação e de
-- construção, pisos, cércea, afastamentos, altura dos muros, usos admitidos,
-- estacionamento). null = a câmara ainda não os carregou: nas zonas de
-- demonstração usam-se os valores de demonstração do código.
ALTER TABLE zonas_pdm ADD COLUMN parametros jsonb;
