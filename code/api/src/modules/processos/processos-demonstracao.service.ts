import { HttpStatus, Injectable } from '@nestjs/common';
import { hojeLisboa, somarDiasUteis } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import {
  FICHEIROS_DEMONSTRACAO,
  gerarCertidaoDemonstracao,
  gerarProjetoDemonstracao,
  gerarTermoDemonstracao,
} from './projeto-demonstracao-pdf.js';

/** O processo do design (V2 · Apoio ao técnico). Tudo fictício. */
export const PROCESSO_DEMONSTRACAO = {
  numero: 412,
  assunto: 'Porta na cozinha',
  morada: 'Rua de Camões, 85',
  freguesia: 'Creixomil',
  // Coordenadas de demonstração: dentro do "Espaço residencial consolidado"
  // e fora do "Centro Histórico" das zonas de demonstração do PDM.
  lat: 41.437,
  lng: -8.305,
  requerente: 'Sandra Martins',
  descricao:
    'Abertura de um vão de porta em parede interior, entre a cozinha e a sala, e remodelação da cozinha, numa moradia unifamiliar.',
};

/**
 * Dados de demonstração para as verificações automáticas: um processo de
 * comunicação prévia "Porta na cozinha" com o projeto em PDF (gerado aqui),
 * o termo de responsabilidade e a certidão. Idempotente: se já existe,
 * devolve-o. Marcado `processos.demonstracao` e na linha do tempo.
 */
@Injectable()
export class ProcessosDemonstracaoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly municipios: MunicipiosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async carregar(m: Municipio, u: UtilizadorPainel) {
    const zonas = await this.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM zonas_pdm WHERE municipio_id = $1',
      [m.id],
    );
    const tem_zonas_pdm = (zonas[0]?.n ?? 0) > 0;
    const [ja] = await this.db.query<{ id: string; numero: string }>(
      `SELECT id, numero FROM processos
       WHERE municipio_id = $1 AND demonstracao AND assunto = $2
       ORDER BY criado_em LIMIT 1`,
      [m.id, PROCESSO_DEMONSTRACAO.assunto],
    );
    if (ja) {
      return {
        processo_id: ja.id,
        numero: ja.numero,
        criado: false,
        tem_zonas_pdm,
        demonstracao: true,
      };
    }

    const [tipo] = await this.db.query<{
      id: string;
      prazo_dias_uteis: number;
    }>(
      `SELECT id, prazo_dias_uteis FROM tipos_processo
       WHERE municipio_id = $1 AND codigo = 'CP' ORDER BY ativo DESC LIMIT 1`,
      [m.id],
    );
    if (!tipo) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'sem_tipo_cp',
        'Falta o tipo de processo "CP" (comunicação prévia) para criar o processo de demonstração.',
      );
    }
    const tiposDoc = await this.db.query<{ id: string; nome: string }>(
      'SELECT id, nome FROM tipo_processo_documentos WHERE tipo_processo_id = $1 ORDER BY ordem',
      [tipo.id],
    );
    const tipoDoc = (re: RegExp) =>
      tiposDoc.find((x) => re.test(x.nome))?.id ?? null;

    const [projeto, termo, certidao] = await Promise.all([
      gerarProjetoDemonstracao(),
      gerarTermoDemonstracao(),
      gerarCertidaoDemonstracao(),
    ]);
    const hoje = hojeLisboa();
    const ano = Number(hoje.slice(0, 4));
    const feriados = await this.municipios.feriados(m.id);
    const inicio = hoje;
    const fim = somarDiasUteis(inicio, tipo.prazo_dias_uteis, feriados);

    const r = await this.db.transaction(async (tx) => {
      // O número do design se estiver livre; senão um com DEMO.
      let numero = `CP ${PROCESSO_DEMONSTRACAO.numero}/${ano}`;
      const [ocupado] = await tx.query(
        'SELECT 1 FROM processos WHERE municipio_id = $1 AND numero = $2',
        [m.id, numero],
      );
      if (ocupado) numero = `CP DEMO-${PROCESSO_DEMONSTRACAO.numero}/${ano}`;

      const [mun] = await tx.query<{ id: string }>(
        'INSERT INTO municipes (municipio_id, nome) VALUES ($1, $2) RETURNING id',
        [m.id, PROCESSO_DEMONSTRACAO.requerente],
      );
      const [p] = await tx.query<{ id: string }>(
        `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, morada,
           freguesia, lat, lng, fase, prazo_inicio, prazo_fim, demonstracao)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'apreciacao', $10, $11, true) RETURNING id`,
        [
          m.id,
          numero,
          tipo.id,
          mun.id,
          PROCESSO_DEMONSTRACAO.assunto,
          PROCESSO_DEMONSTRACAO.morada,
          PROCESSO_DEMONSTRACAO.freguesia,
          PROCESSO_DEMONSTRACAO.lat,
          PROCESSO_DEMONSTRACAO.lng,
          inicio,
          fim,
        ],
      );
      await tx.query(
        `INSERT INTO requerimentos (municipio_id, municipe_id, tipo_processo_id, dados, estado,
           assinatura, assinado_em, processo_id)
         VALUES ($1, $2, $3, $4, 'entregue', 'simulada', now(), $5)`,
        [
          m.id,
          mun.id,
          tipo.id,
          JSON.stringify({
            morada_obra: `${PROCESSO_DEMONSTRACAO.morada}, ${PROCESSO_DEMONSTRACAO.freguesia}`,
            descricao: PROCESSO_DEMONSTRACAO.descricao,
          }),
          p.id,
        ],
      );
      const documentos: {
        chave: string;
        tamanho: number;
        tipo: string | null;
        descricao: string | null;
        verificacao: unknown;
        emitido: string;
      }[] = [
        {
          chave: FICHEIROS_DEMONSTRACAO.certidao,
          tamanho: certidao.length,
          tipo: tipoDoc(/certid[aã]o/i),
          descricao: 'Certidão do registo predial (demonstração)',
          verificacao: [
            {
              regra: 'validade',
              ok: true,
              detalhe: 'Emitida há menos de 6 meses',
            },
          ],
          emitido: '2026-10-01',
        },
        {
          chave: FICHEIROS_DEMONSTRACAO.termo,
          tamanho: termo.length,
          tipo: tipoDoc(/termo\s+de\s+responsabilidade/i),
          descricao: 'Termo de responsabilidade (demonstração)',
          verificacao: [
            { regra: 'assinatura', ok: true, detalhe: 'Assinatura visível' },
          ],
          emitido: '2026-10-05',
        },
        {
          chave: FICHEIROS_DEMONSTRACAO.projeto,
          tamanho: projeto.length,
          tipo: null,
          descricao: 'Projeto de arquitetura',
          verificacao: null,
          emitido: '2026-10-05',
        },
      ];
      for (const d of documentos) {
        await tx.query(
          `INSERT INTO documentos (municipio_id, processo_id, tipo_documento_id, ficheiro_key, mime,
             tamanho, origem, verificacao_estado, verificacao, emitido_em, descricao)
           VALUES ($1, $2, $3, $4, 'application/pdf', $5, 'upload', $6, $7, $8, $9)`,
          [
            m.id,
            p.id,
            d.tipo,
            d.chave,
            d.tamanho,
            d.verificacao ? 'valido' : 'por_verificar',
            d.verificacao ? JSON.stringify(d.verificacao) : null,
            d.emitido,
            d.tipo ? null : d.descricao,
          ],
        );
      }
      await tx.query(
        `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, interno, dados)
         VALUES ($1, 'criado', $2, 'utilizador', $3, true, '{"demonstracao": true}')`,
        [
          p.id,
          'Processo de demonstração criado no painel (dados fictícios: requerente, morada, projeto e termo).',
          u.id,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'carregar_processo_demonstracao',
          objetoTipo: 'processo',
          objetoId: p.id,
          dados: { numero },
        },
        tx,
      );
      return { id: p.id, numero };
    });
    return {
      processo_id: r.id,
      numero: r.numero,
      criado: true,
      tem_zonas_pdm,
      demonstracao: true,
    };
  }
}
