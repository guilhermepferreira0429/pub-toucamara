import { Injectable } from '@nestjs/common';
import { somarDiasUteis } from '../../common/dias-uteis.js';
import { proximoNumero } from '../../common/numeracao.js';
import { DatabaseService } from '../../database/database.service.js';
import { diaLocal, instanteLocal } from '../marcacoes/vagas.js';
import {
  Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import {
  MESES_CADUCIDADE_OMISSAO,
  recuarDiasUteis,
  somarMeses,
} from './regras.js';

/** Os processos de demonstração das antecipações (chave → quem e o quê). */
export const PROCESSOS_ANTECIPACAO = [
  {
    chave: 'antecipacao:pedido',
    pessoa: 'rosa',
    assunto: 'Telheiro nas traseiras da casa',
    morada: 'Rua de Camões, 33',
    freguesia: 'Creixomil',
  },
  {
    chave: 'antecipacao:prazo_camara',
    pessoa: 'jorge',
    assunto: 'Substituição da cobertura do armazém',
    morada: 'Rua Dr. Avelino Germano, 14',
    freguesia: 'Azurém',
  },
  {
    chave: 'antecipacao:alvara',
    pessoa: 'fernando',
    assunto: 'Ampliação da moradia (1.º andar)',
    morada: 'Rua de Vila Flor, 77',
    freguesia: 'Urgezes',
  },
] as const;

export type ChaveAntecipacaoDemo =
  (typeof PROCESSOS_ANTECIPACAO)[number]['chave'];

function deslocar(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Para o "preparar demo": três processos com momentos nos próximos dias,
 * com datas relativas a hoje.
 * - pedido: falta um documento pedido há 8 dias úteis, o prazo acaba daqui
 *   a 2 dias úteis (o agente explica o que enviar);
 * - prazo_camara: comunicação prévia em apreciação com o prazo da câmara a
 *   acabar daqui a 2 dias úteis (aviso ao munícipe e alerta à chefia);
 * - alvara: obra admitida há quase 12 meses e por começar (caducidade).
 * Quem chama (DemoService) guarda a chave em `demo_registos`: correr outra
 * vez não cria outro.
 */
@Injectable()
export class AntecipacoesDemoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly municipios: MunicipiosService,
  ) {}

  async criar(
    m: Municipio,
    chave: ChaveAntecipacaoDemo,
    municipeId: string,
    agora = new Date(),
  ): Promise<string | null> {
    const def = PROCESSOS_ANTECIPACAO.find((p) => p.chave === chave);
    if (!def) return null;
    const [tipo] = await this.db.query<{ id: string; nome: string }>(
      `SELECT id, nome FROM tipos_processo
       WHERE municipio_id = $1 AND codigo = 'CP' ORDER BY ativo DESC LIMIT 1`,
      [m.id],
    );
    if (!tipo) throw new Error('falta o tipo de processo CP');
    const feriados = await this.municipios.feriados(m.id);
    const hoje = diaLocal(agora, m.fuso);
    const ano = Number(hoje.slice(0, 4));
    const as = (dia: string, hhmm: string) => instanteLocal(dia, hhmm, m.fuso);

    return this.db.transaction(async (tx) => {
      const n = await proximoNumero(tx, m.id, 'CP', ano);
      const numero = `CP ${n}/${ano}`;
      let fase = 'apreciacao';
      let entrada = recuarDiasUteis(hoje, 15, feriados);
      let prazoInicio: string | null = entrada;
      let prazoFim: string | null = null;
      let decidido: Date | null = null;
      if (chave === 'antecipacao:pedido') {
        fase = 'documentos';
        entrada = recuarDiasUteis(hoje, 10, feriados);
        prazoInicio = null;
      } else if (chave === 'antecipacao:prazo_camara') {
        prazoFim = somarDiasUteis(hoje, 2, feriados);
        entrada = recuarDiasUteis(hoje, 18, feriados);
        prazoInicio = entrada;
      } else {
        fase = 'notificado';
        // Admitida há 12 meses menos 10 dias: caduca daqui a 10 dias.
        const dia = deslocar(somarMeses(hoje, -MESES_CADUCIDADE_OMISSAO), 10);
        decidido = as(dia, '15:30');
        entrada = recuarDiasUteis(dia, 25, feriados);
        prazoInicio = entrada;
        prazoFim = dia;
      }
      const [p] = await tx.query<{ id: string }>(
        `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, morada,
           freguesia, fase, prazo_inicio, prazo_fim, decisao, decidido_em, criado_em, atualizado_em,
           demonstracao)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::fase_processo, $9, $10, $11, $12, $13, now(), true)
         RETURNING id`,
        [
          m.id,
          numero,
          tipo.id,
          municipeId,
          def.assunto,
          def.morada,
          def.freguesia,
          fase,
          prazoInicio,
          prazoFim,
          decidido ? 'admitido' : null,
          decidido,
          as(entrada, '10:05'),
        ],
      );
      const evento = (
        tipoEv: string,
        descricao: string,
        em: Date,
        dados: Record<string, unknown> = {},
      ) =>
        tx.query<{ id: string }>(
          `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, dados, em)
           VALUES ($1, $2, $3, 'sistema', $4, $5) RETURNING id`,
          [
            p.id,
            tipoEv,
            descricao,
            JSON.stringify({ demonstracao: true, ...dados }),
            em,
          ],
        );
      await evento(
        'criado',
        `Comunicação prévia entregue. Processo ${numero} aberto.`,
        as(entrada, '10:05'),
      );
      if (chave === 'antecipacao:pedido') {
        const pedidoDia = recuarDiasUteis(hoje, 8, feriados);
        const prazo = somarDiasUteis(pedidoDia, 10, feriados);
        const descricao =
          'Termo de responsabilidade do técnico autor do projeto';
        const [ev] = await evento(
          'documento_pedido',
          `Pedido ao munícipe: ${descricao}, até ${prazo.split('-').reverse().join('/')}.`,
          as(pedidoDia, '11:20'),
          { nome: descricao, prazo },
        );
        await tx.query(
          `INSERT INTO processo_pedidos (processo_id, evento_id, descricao, pedido_em, prazo)
           VALUES ($1, $2, $3, $4, $5)`,
          [p.id, ev.id, descricao, as(pedidoDia, '11:20'), prazo],
        );
      } else {
        await evento(
          'fase',
          'Passou a apreciação técnica.',
          as(deslocar(entrada, 1), '09:30'),
        );
      }
      if (decidido) {
        await evento(
          'decisao',
          'Comunicação prévia admitida. Ofício enviado ao requerente.',
          decidido,
          { decisao: 'admitido' },
        );
      }
      return p.id;
    });
  }
}
