-- Requerimentos e processos: índices para os caminhos quentes.

-- Ferramentas do agente e ecrã ao vivo: o requerimento aberto da conversa.
CREATE INDEX requerimentos_conversa_idx ON requerimentos (conversa_id, estado) WHERE conversa_id IS NOT NULL;

-- Documentos já entregues de um requerimento ou de um processo (tem/faltam).
CREATE INDEX documentos_requerimento_idx ON documentos (requerimento_id) WHERE requerimento_id IS NOT NULL;
CREATE INDEX documentos_processo_idx ON documentos (processo_id) WHERE processo_id IS NOT NULL;

-- Lista do painel ordenada por prazo e "os meus processos".
CREATE INDEX processos_tecnico_idx ON processos (municipio_id, tecnico_id) WHERE tecnico_id IS NOT NULL;
